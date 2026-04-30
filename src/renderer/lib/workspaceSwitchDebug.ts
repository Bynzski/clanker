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

const PREFIX = '[workspace-residency]';

function log(event: string, data: Record<string, unknown> = {}): void {
  // Inline DEV guard — single branch, no function-call overhead in dev.
  if (typeof import.meta !== 'undefined' && import.meta.env && !import.meta.env.DEV) return;
  // Fallback for non-module environments (shouldn't occur in this codebase)
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') return;
  console.debug(PREFIX, event, data);
}

// ---------------------------------------------------------------------------
// Switch trace — in-memory context for correlating related events
// ---------------------------------------------------------------------------

let _activeSwitchId = 0;
let _currentSwitchId = 0;

export function startSwitch(fromWorkspaceId: string | null, toWorkspaceId: string): string {
  _currentSwitchId = ++_activeSwitchId;
  log('switch_start', {
    switchId: _currentSwitchId,
    fromWorkspace: fromWorkspaceId,
    toWorkspace: toWorkspaceId,
    timestamp: Date.now(),
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
