/**
 * Dev-only workspace residency instrumentation.
 *
 * Lightweight, structured logging to observe the current switch path in practice.
 * All functions are no-ops in production; guard checks are inlined at call sites.
 *
 * Event names (stable, grep-friendly):
 *   switch_start           – workspace switch initiated
 *   surface_mount         – surface became active (isActive=true transition)
 *   surface_unmount       – surface became inactive (isActive=false transition)
 *   surface_remount       – surface reactivated after being parked
 *   surface_react_mount   – WorkspaceSurface React component mounted
 *   surface_react_unmount – WorkspaceSurface React component unmounted
 *   terminal_cache_hit    – xterm found in cache on mount
 *   terminal_cache_miss   – new xterm created on mount
 *   terminal_detach       – xterm element detached on park
 *   browser_mount         – BrowserPanel workspace-level show
 *   browser_unmount       – BrowserPanel workspace-level hide
 *   browser_react_mount   – BrowserPanel React component mounted
 *   browser_react_unmount – BrowserPanel React component unmounted
 *   editor_react_mount    – EditorPane React component mounted
 *   editor_react_unmount  – EditorPane React component unmounted
 *   browser_first_bounds  – first bounds IPC after show
 *   editor_create         – EditorView created
 *   editor_destroy        – EditorView destroyed
 *
 * IMPORTANT: Distinction between lifecycle types:
 *   - React mount/unmount: actual component lifecycle (rare after Phase 2)
 *   - surface park/unpark: isActive state transition (frequent on switch)
 *   - workspace show/hide: browser panel visibility (frequent on switch)
 *   - editor create/destroy: EditorView instance (may fire on workspace change)
 */

import type { WorkspaceTab } from '../store/workspaceTypes';

const PREFIX = '[workspace-residency]';
const DEV = import.meta.env.DEV;
function readDebugPreference(): boolean {
  if (!DEV || typeof window === 'undefined') return false;
  try { return window.localStorage?.getItem('clanker.switchDebug') === '1'; }
  catch { return false; } // Storage can be disabled without disabling the workspace.
}
let enabled = readDebugPreference();
const events: { event: string; at: number; data: Record<string, unknown> }[] = [];
let startedAt = 0;
let targetWorkspaceId: string | null = null;

declare global {
  interface Window {
    clankerSwitchIpc?: { snapshot: (resetPeak?: boolean) => { counts: Record<string, number>; active: number; peak: number } };
    clankerSwitchDebug?: {
      enable: (value?: boolean) => void;
      clear: () => void;
      snapshot: () => { events: typeof events; ipc: ReturnType<NonNullable<Window['clankerSwitchIpc']>['snapshot']> | null };
    };
  }
}
if (DEV && typeof window !== 'undefined') window.clankerSwitchDebug = {
  enable(value = true) {
    enabled = value;
    try { window.localStorage?.setItem('clanker.switchDebug', value ? '1' : '0'); }
    catch { /* In-memory opt-in still works if preference storage is disabled. */ }
  },
  clear() { events.length = 0; window.clankerSwitchIpc?.snapshot(true); },
  snapshot: () => ({ events: structuredClone(events), ipc: window.clankerSwitchIpc?.snapshot() ?? null }),
};

const activationReferenceFields = ['terminals', 'panes', 'editorTabs', 'explorerExpandedPaths',
  'explorerEntriesByPath', 'explorerLoadingPaths', 'explorerErrorsByPath', 'browserPane', 'pages',
  'layoutRoot', 'layoutUndoStack', 'checkoutContexts', 'runtimeState', 'gitChanges', 'minimizedPanes',
  'pendingTerminalIds'] as const;

/** Synchronous activation-only reference changes, before resource effects; no payloads/paths. */
export function activationReferences(previous: WorkspaceTab, selected: WorkspaceTab): void {
  if (!DEV || !enabled) return;
  log('activation_references', { switchId: _currentSwitchId, workspaceId: selected.id,
    checked: activationReferenceFields.length,
    changed: activationReferenceFields.filter((key) => previous[key] !== selected[key]) });
}

/** Toolbar DOM commit, not compositor paint; fixed freshness labels, no status payload. */
export function gitPresentation(workspaceId: string | undefined, generation: number | undefined, freshness: 'loading' | 'last-known' | 'unavailable' | 'current', cacheHit: boolean): void {
  log('git_presentation', { workspaceId, generation, freshness, cacheHit, switchId: _currentSwitchId });
}

/** Profiler actualDuration is render CPU time, not paint or total switch latency. */
export function switchCommit(id: string, phase: string, actualDuration: number, _baseDuration: number, _startTime: number, commitTime: number): void {
  log('react_commit', { id, phase, actualDuration, commitTime, switchId: _currentSwitchId });
}

/** Two rAFs allow a paint opportunity; visible interactive shell proxy, not GPU presentation proof. */
export function observeUsableWorkspaceFrame(workspaceId: string, surface: HTMLElement): () => void {
  if (!DEV || !enabled) return () => {};
  const switchId = _currentSwitchId;
  const deadline = performance.now() + 5000;
  let frame = 0;
  let cancelled = false;
  let readyOnPreviousFrame = false;
  const check = () => {
    if (cancelled || switchId !== _currentSwitchId || targetWorkspaceId !== workspaceId) return;
    const layout = surface.querySelector('.dynamic-pane-layout');
    const rect = surface.getBoundingClientRect();
    const ready = document.visibilityState === 'visible' && surface.dataset.workspaceVisibility === 'active'
      && !surface.hasAttribute('inert') && rect.width > 0 && rect.height > 0 && layout !== null;
    if (ready && readyOnPreviousFrame) {
      log('first_usable_shell_frame', { workspaceId, switchId, elapsedMs: performance.now() - startedAt });
    } else if (performance.now() < deadline) {
      readyOnPreviousFrame = ready;
      frame = requestAnimationFrame(check);
    } else log('usable_frame_timeout', { workspaceId, switchId });
  };
  frame = requestAnimationFrame(check);
  return () => { cancelled = true; cancelAnimationFrame(frame); };
}

function log(event: string, data: Record<string, unknown> = {}): void {
  // Inline DEV guard — single branch, no function-call overhead in dev.
  if (typeof import.meta !== 'undefined' && import.meta.env && !import.meta.env.DEV) return;
  // Fallback for non-module environments (shouldn't occur in this codebase)
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') return;
  if (!enabled) return;
  const { activeFileName: _fileName, ...safeData } = data;
  void _fileName;
  events.push({ event, at: performance.now(), data: safeData });
  if (events.length > 512) events.shift();
  console.debug(PREFIX, event, safeData);
}

// ---------------------------------------------------------------------------
// Switch trace — in-memory context for correlating related events
// ---------------------------------------------------------------------------

let _activeSwitchId = 0;
let _currentSwitchId = 0;

/** Lets an already-active surface observe the final selection in a batched A→B→A. */
export function currentSwitchGeneration(): number { return _currentSwitchId; }

export function startSwitch(fromWorkspaceId: string | null, toWorkspaceId: string, warm = false): string {
  if (!DEV || !enabled) return '';
  _currentSwitchId = ++_activeSwitchId;
  startedAt = performance.now();
  targetWorkspaceId = toWorkspaceId;
  log('switch_start', {
    switchId: _currentSwitchId,
    fromWorkspace: fromWorkspaceId,
    toWorkspace: toWorkspaceId,
    timestamp: Date.now(),
    transition: warm ? 'warm' : 'cold',
    ipc: window.clankerSwitchIpc?.snapshot() ?? null,
  });
  return `[${_currentSwitchId}]`;
}


// ---------------------------------------------------------------------------
// Surface lifecycle
// ---------------------------------------------------------------------------

// NOTE: surfaceMount/surfaceUnmount track isActive state transitions (park/unpark),
// NOT React component mount/unmount. React components stay resident under the
// shared container. Use surfaceReactMount/surfaceReactUnmount for actual React lifecycle.

export function surfaceMount(
  workspaceId: string,
  isActive: boolean,
  previouslyParked: boolean,
): void {
  log(isActive ? (previouslyParked ? 'surface_remount' : 'surface_mount') : 'surface_mount', {
    workspaceId,
    isActive,
    previouslyParked,
    switchId: _currentSwitchId || null,
    timestamp: Date.now(),
  });
}

export function surfaceUnmount(workspaceId: string): void {
  log('surface_unmount', {
    workspaceId,
    switchId: _currentSwitchId || null,
    timestamp: Date.now(),
  });
}

// Actual React component mount/unmount instrumentation
export function surfaceReactMount(workspaceId: string): void {
  log('surface_react_mount', {
    workspaceId,
    switchId: _currentSwitchId || null,
    timestamp: Date.now(),
  });
}

export function surfaceReactUnmount(workspaceId: string): void {
  log('surface_react_unmount', {
    workspaceId,
    switchId: _currentSwitchId || null,
    timestamp: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

export function terminalCacheHit(terminalId: string | null, workspaceId: string | undefined | null): void {
  log('terminal_cache_hit', {
    terminalId,
    workspaceId: workspaceId ?? null,
    switchId: _currentSwitchId || null,
    timestamp: Date.now(),
  });
}

export function terminalCacheMiss(terminalId: string | null, workspaceId: string | undefined | null): void {
  log('terminal_cache_miss', {
    terminalId,
    workspaceId: workspaceId ?? null,
    switchId: _currentSwitchId || null,
    timestamp: Date.now(),
  });
}

export function terminalDetach(terminalId: string | null, workspaceId: string | undefined | null): void {
  log('terminal_detach', {
    terminalId,
    workspaceId: workspaceId ?? null,
    switchId: _currentSwitchId || null,
    timestamp: Date.now(),
  });
}


// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

// NOTE: browserMount/browserUnmount track workspace-level show/hide (NOT React
// component mount/unmount). Browser components stay resident under the shared
// container. Use browserReactMount/browserReactUnmount for actual React lifecycle.

export function browserMount(
  workspaceId: string,
  lastBoundsWasNull: boolean,
): void {
  log('browser_mount', {
    workspaceId,
    lastBoundsWasNull,
    switchId: _currentSwitchId || null,
    timestamp: Date.now(),
  });
}

export function browserUnmount(
  workspaceId: string,
  lastBoundsX: number | null,
  lastBoundsY: number | null,
  lastBoundsWidth: number | null,
  lastBoundsHeight: number | null,
): void {
  log('browser_unmount', {
    workspaceId,
    lastBounds: lastBoundsX !== null
      ? { x: lastBoundsX, y: lastBoundsY, width: lastBoundsWidth, height: lastBoundsHeight }
      : null,
    switchId: _currentSwitchId || null,
    timestamp: Date.now(),
  });
}

// Actual React component mount/unmount instrumentation
export function browserReactMount(workspaceId: string): void {
  log('browser_react_mount', {
    workspaceId,
    switchId: _currentSwitchId || null,
    timestamp: Date.now(),
  });
}

export function browserReactUnmount(workspaceId: string): void {
  log('browser_react_unmount', {
    workspaceId,
    switchId: _currentSwitchId || null,
    timestamp: Date.now(),
  });
}

export function browserFirstBounds(
  workspaceId: string,
  boundsX: number,
  boundsY: number,
  boundsWidth: number,
  boundsHeight: number,
): void {
  log('browser_first_bounds', {
    workspaceId,
    bounds: { x: boundsX, y: boundsY, width: boundsWidth, height: boundsHeight },
    isZeroByZero: boundsWidth === 0 && boundsHeight === 0,
    switchId: _currentSwitchId || null,
    timestamp: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

// Actual React component mount/unmount instrumentation
export function editorReactMount(
  workspaceId: string | undefined,
  activeTabId: string | null,
): void {
  log('editor_react_mount', {
    workspaceId: workspaceId ?? null,
    activeTabId,
    switchId: _currentSwitchId || null,
    timestamp: Date.now(),
  });
}

export function editorReactUnmount(
  workspaceId: string | undefined,
  activeTabId: string | null,
): void {
  log('editor_react_unmount', {
    workspaceId: workspaceId ?? null,
    activeTabId,
    switchId: _currentSwitchId || null,
    timestamp: Date.now(),
  });
}

// NOTE: editorCreate/editorDestroy track EditorView creation/destruction (NOT
// React component mount/unmount). The EditorView is created in a useEffect that
// depends on workspace context. These events may fire when workspace context
// changes even if the React component stays mounted. Editor caching is Phase 3.

export function editorCreate(
  workspaceId: string | undefined,
  activeTabId: string | null,
  activeFileName: string | null,
): void {
  log('editor_create', {
    workspaceId: workspaceId ?? null,
    activeTabId,
    activeFileName,
    switchId: _currentSwitchId || null,
    timestamp: Date.now(),
  });
}

export function editorDestroy(
  workspaceId: string | undefined,
  activeTabId: string | null,
  activeFileName: string | null,
): void {
  log('editor_destroy', {
    workspaceId: workspaceId ?? null,
    activeTabId,
    activeFileName,
    switchId: _currentSwitchId || null,
    timestamp: Date.now(),
  });
}
