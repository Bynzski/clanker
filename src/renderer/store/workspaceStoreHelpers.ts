import {
  buildWorkspaceLayout,
  collectLeafPaneIds,
} from './workspaceLayout';
import { projectPageBrowser, retainSelectedPage, selectPage, synchronizePages, updateBrowserOwner } from './workspacePages';
import type { GitStatus } from '../components/git/types';
import { backfillCheckoutContexts, bindTerminalToCheckoutContext } from '../lib/checkoutContexts';
import type { FileExplorerEntry } from '../../shared/types/fileExplorer';
import type {
  BrowserPaneState,
  BrowserTab,
  EditorPaneState,
  EditorTab,
  NotesPaneState,
  Pane,
  PanePosition,
  WorkspaceResourcePolicy,
  WorkspaceResidencyState,
  WorkspaceLifecycleState,
  WorkspaceRuntimeState,
  WorkspaceTab,
} from './workspaceTypes';
import type {
  ActiveWorkspaceSnapshot,
  PendingEditorOperationsHolder,
  WorkspaceState,
} from './workspaceStoreTypes';

export const generateId = (prefix: string) => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
};

export const generatePaneId = () => generateId('pane');

const generateBrowserTabId = () => generateId('browser-tab');

/**
 * Default URL for new browser tabs and freshly-created browser panes.
 * Plan policy (browser-tabs-history v2.2): new tabs use the existing HTTP(S)
 * default page; do not introduce `about:blank` as a sentinel.
 */
export const DEFAULT_NEW_TAB_URL = 'https://github.com';

export function createDefaultBrowserTab(seedUrl?: string): BrowserTab {
  const url = typeof seedUrl === 'string' && seedUrl.length > 0 ? seedUrl : DEFAULT_NEW_TAB_URL;
  return {
    id: generateBrowserTabId(),
    url,
    title: '',
    canGoBack: false,
    canGoForward: false,
  };
}

function sanitizeBrowserTab(raw: unknown, fallbackUrl: string): BrowserTab | null {
  if (raw == null || typeof raw !== 'object') {
    return null;
  }
  const candidate = raw as Partial<BrowserTab>;
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
    return null;
  }
  return {
    id: candidate.id,
    url: typeof candidate.url === 'string' && candidate.url.length > 0 ? candidate.url : fallbackUrl,
    title: typeof candidate.title === 'string' ? candidate.title : '',
    canGoBack: candidate.canGoBack === true,
    canGoForward: candidate.canGoForward === true,
  };
}

/**
 * Repairs and normalizes a persisted/runtime browser pane:
 * - Ensures at least one valid tab exists; rebuilds with a default tab if missing/empty.
 * - Drops malformed tab entries; deduplicates by id (first occurrence wins).
 * - Coerces `activeTabId` to a valid tab; falls back to the first tab.
 */
function sanitizeBrowserPane(
  pane: BrowserPaneState | null | undefined,
  browserUrl: string,
): BrowserPaneState | null {
  if (pane == null) {
    return null;
  }

  const fallbackUrl = typeof browserUrl === 'string' && browserUrl.length > 0
    ? browserUrl
    : DEFAULT_NEW_TAB_URL;

  const rawTabs = Array.isArray(pane.tabs) ? pane.tabs : [];
  const seenIds = new Set<string>();
  const sanitizedTabs: BrowserTab[] = [];
  for (const rawTab of rawTabs) {
    const tab = sanitizeBrowserTab(rawTab, fallbackUrl);
    if (tab && !seenIds.has(tab.id)) {
      seenIds.add(tab.id);
      sanitizedTabs.push(tab);
    }
  }

  if (sanitizedTabs.length === 0) {
    sanitizedTabs.push(createDefaultBrowserTab(fallbackUrl));
  }

  const activeTabId = sanitizedTabs.some((tab) => tab.id === pane.activeTabId)
    ? pane.activeTabId
    : sanitizedTabs[0].id;

  return {
    id: pane.id,
    position: pane.position,
    ...(pane.remotePreviewInitialized ? { remotePreviewInitialized: true } : {}),
    tabs: sanitizedTabs,
    activeTabId,
  };
}

/**
 * Creates a fresh browser pane with one default tab.
 * Used by `toggleBrowser` and `updateBrowserPosition` when no pane exists yet.
 */
export function createDefaultBrowserPane(
  paneId: string,
  position: PanePosition,
  seedUrl?: string,
): BrowserPaneState {
  const tab = createDefaultBrowserTab(seedUrl);
  return {
    id: paneId,
    position,
    tabs: [tab],
    activeTabId: tab.id,
  };
}

export const createPane = (terminalId: string | null, position?: PanePosition): Pane => ({
  id: generatePaneId(),
  terminalId,
  position,
});

export const createWorkspaceId = () => generateId('workspace');

export const createDefaultExplorerState = () => ({
  explorerVisible: false,
  explorerPane: null as { id: string } | null,
  explorerSidebarWidth: 280,
  explorerExpandedPaths: [] as string[],
  explorerSelectedPath: null as string | null,
  explorerEntriesByPath: {} as Record<string, FileExplorerEntry[] | undefined>,
  explorerLoadingPaths: [] as string[],
  explorerErrorsByPath: {} as Record<string, string | null | undefined>,
  showHiddenFiles: true as boolean,
  gitChanges: [] as GitStatus[],
});

export const createDefaultEditorState = () => ({
  editorVisible: false,
  editorPane: null as EditorPaneState | null,
  editorTabs: [] as EditorTab[],
  activeEditorTabId: null as string | null,
});

export const createDefaultNotesState = () => ({
  notesVisible: false,
  notesPane: null as NotesPaneState | null,
});

/**
 * Default resource policy for new workspaces.
 * All subsystems start warm. The renderer warmth controller may later mark an
 * older parked workspace cold while PTY processes, cached xterm state, and the
 * native browser session continue independently. Explorer remains cached with
 * an active-workspace-only watcher.
 */
export const DEFAULT_RESOURCE_POLICY: WorkspaceResourcePolicy = {
  terminals: 'warm',
  browser: 'warm',
  explorer: 'cached',
  editor: 'warm',
};

/** Default runtime state for new workspaces. */
export const DEFAULT_RUNTIME_STATE: WorkspaceRuntimeState = {
  residencyState: 'warm',
  resourcePolicy: DEFAULT_RESOURCE_POLICY,
};

/**
 * Backfill helpers for persisted workspaces missing runtime metadata.
 * Older saved workspace objects may not have runtimeState fields.
 */
export function sanitizeRuntimeState(workspace: Partial<WorkspaceTab>): WorkspaceRuntimeState {
  if (workspace.runtimeState) {
    // Partial existing object — fill in missing sub-fields
    // Cast to partial resource policy to allow partial objects in test fixtures
    const partialPolicy = workspace.runtimeState.resourcePolicy as Partial<WorkspaceResourcePolicy> | undefined;
    return {
      residencyState: workspace.runtimeState.residencyState ?? 'warm',
      resourcePolicy: {
        terminals: partialPolicy?.terminals ?? 'warm',
        browser: partialPolicy?.browser ?? 'warm',
        explorer: partialPolicy?.explorer ?? 'cached',
        editor: partialPolicy?.editor ?? 'warm',
      },
    };
  }
  return { ...DEFAULT_RUNTIME_STATE };
}

export function areGitStatusListsEqual(a: GitStatus[], b: GitStatus[]): boolean {
  if (a === b) {
    return true;
  }

  if (a.length !== b.length) {
    return false;
  }

  return a.every((entry, index) =>
    entry.path === b[index]?.path &&
    entry.status === b[index]?.status &&
    entry.staged === b[index]?.staged
  );
}

export const sanitizeWorkspace = (workspace: WorkspaceTab): WorkspaceTab => {
  const explorerPane = workspace.explorerPane
    ? { ...workspace.explorerPane }
    : workspace.explorerVisible
      ? { id: generateId('explorer') }
      : null;
  const notesVisible = workspace.notesVisible ?? false;
  const notesPane = workspace.notesPane ? { ...workspace.notesPane } : null;
  const layoutSource = {
    ...workspace,
    explorerPane,
    notesVisible,
    notesPane,
  };

  const environmentId = workspace.environmentId || 'local';
  const environmentLabel = workspace.environmentLabel || (environmentId !== 'local' ? environmentId : 'Local');

  return synchronizePages(undefined, {
    ...workspace,
    environmentId,
    environmentLabel,
    lifecycle: workspace.lifecycle ?? 'active',
    checkoutContexts: backfillCheckoutContexts(workspace),
    terminals: workspace.terminals.map((terminal) => bindTerminalToCheckoutContext(terminal, workspace.id)),
    panes: [...workspace.panes],
    explorerExpandedPaths: [...workspace.explorerExpandedPaths],
    explorerEntriesByPath: { ...workspace.explorerEntriesByPath },
    explorerLoadingPaths: [...workspace.explorerLoadingPaths],
    explorerErrorsByPath: { ...workspace.explorerErrorsByPath },
    browserOverlayCount: workspace.browserOverlayCount ?? 0,
    browserPane: sanitizeBrowserPane(workspace.browserPane, workspace.browserUrl),
    pages: workspace.pages?.map((page) => {
      const pane = page.browser && sanitizeBrowserPane(page.browser.pane, page.browser.url);
      return { ...page, browser: page.browser ? { ...page.browser, pane: pane ?? null } : undefined };
    }),
    explorerPane,
    editorTabs: [...workspace.editorTabs],
    showHiddenFiles: workspace.showHiddenFiles ?? true,
    gitChanges: [...(workspace.gitChanges ?? [])],
    gitCurrentBranch: workspace.gitCurrentBranch ?? null,
    gitIsRepo: workspace.gitIsRepo ?? false,
    gitIsDetached: workspace.gitIsDetached ?? false,
    editorPane: workspace.editorPane ? { ...workspace.editorPane } : null,
    notesVisible,
    notesPane,
    layoutRevision: workspace.layoutRevision ?? 0,
    layoutUndoStack: [...(workspace.layoutUndoStack ?? [])],
    layoutRoot: buildWorkspaceLayout(layoutSource),
    runtimeState: sanitizeRuntimeState(workspace),
  });
};

function withWorkspaceLifecycle(
  workspace: WorkspaceTab,
  lifecycle: WorkspaceLifecycleState,
): WorkspaceTab {
  if (workspace.lifecycle === lifecycle) {
    return workspace;
  }

  return {
    ...workspace,
    lifecycle,
  };
}

export function assignWorkspaceLifecycles(
  workspaces: WorkspaceTab[],
  activeWorkspaceId: string | null,
): WorkspaceTab[] {
  return workspaces.map((workspace) => withWorkspaceLifecycle(
    workspace,
    workspace.id === activeWorkspaceId ? 'active' : 'parked',
  ));
}

export { getWorkspaceNameFromPath } from '../lib/workspaceLabels';

export function findWorkspaceById(
  workspaces: WorkspaceTab[],
  workspaceId: string | null | undefined,
): WorkspaceTab | null {
  if (workspaceId == null) {
    return null;
  }

  return workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
}

export function findActiveWorkspace(workspaces: WorkspaceTab[]): WorkspaceTab | null {
  return workspaces.find((workspace) => workspace.lifecycle === 'active') ?? null;
}

export function isWorkspaceActiveById(workspaces: WorkspaceTab[], workspaceId: string): boolean {
  const workspace = findWorkspaceById(workspaces, workspaceId);
  return workspace?.lifecycle === 'active';
}

/**
 * Returns true when the workspace is warm (surface residency is active).
 * A workspace is warm when its residencyState is 'warm'.
 * Cold, closing, or errored workspaces are not warm.
 */
export function isWorkspaceWarm(workspace: WorkspaceTab): boolean {
  return workspace.runtimeState?.residencyState === 'warm';
}

/**
 * Returns the resource policy for a workspace.
 * Always returns a valid policy object — missing sub-fields are filled with defaults.
 */
export function getWorkspaceResourcePolicy(workspace: WorkspaceTab): WorkspaceResourcePolicy {
  return sanitizeRuntimeState(workspace).resourcePolicy;
}

/**
 * Creates a new workspace with the given residency state, preserving
 * all other runtime state fields.
 */
export function withWorkspaceResidency(
  workspace: WorkspaceTab,
  residencyState: WorkspaceResidencyState,
): WorkspaceTab {
  return {
    ...workspace,
    runtimeState: {
      ...sanitizeRuntimeState(workspace),
      residencyState,
    },
  };
}

/**
 * Creates a new workspace with a merged resource policy.
 * Only the provided fields are updated; all others are preserved.
 */
export function withWorkspaceResourcePolicy(
  workspace: WorkspaceTab,
  partialPolicy: Partial<WorkspaceResourcePolicy>,
): WorkspaceTab {
  const current = sanitizeRuntimeState(workspace);
  return {
    ...workspace,
    runtimeState: {
      ...current,
      resourcePolicy: {
        ...current.resourcePolicy,
        ...partialPolicy,
      },
    },
  };
}

export function resolveWorkspaceByScope(
  state: Pick<WorkspaceState, 'workspaces' | 'activeWorkspaceId'>,
  workspaceId?: string | null,
): WorkspaceTab | null {
  return findWorkspaceById(state.workspaces, workspaceId ?? state.activeWorkspaceId);
}

/**
 * Returns the currently focused workspace (active workspace id), falling back
 * to the workspace marked lifecycle "active" if needed.
 *
 * Intended for global UI that lives outside WorkspaceScopeProvider and should
 * not read mirrored top-level fields that are maintained via syncActiveWorkspace.
 */
export function selectFocusedWorkspace(
  state: Pick<WorkspaceState, 'workspaces' | 'activeWorkspaceId'>,
): WorkspaceTab | null {
  if (state.activeWorkspaceId != null) {
    return findWorkspaceById(state.workspaces, state.activeWorkspaceId);
  }

  return findActiveWorkspace(state.workspaces);
}

export function resolveWorkspaceIdByScope(
  state: Pick<WorkspaceState, 'workspaces' | 'activeWorkspaceId'>,
  workspaceId?: string | null,
): string | null {
  return resolveWorkspaceByScope(state, workspaceId)?.id ?? null;
}

export function getActiveWorkspaceSnapshot(
  workspace: Pick<
    WorkspaceTab,
    | 'name'
    | 'workspacePath'
    | 'harness'
    | 'model'
    | 'terminals'
    | 'panes'
    | 'browserVisible'
    | 'browserOverlayCount'
    | 'browserUrl'
    | 'activeTerminalId'
    | 'browserPane'
    | 'layoutRoot'
    | 'layoutRevision'
    | 'layoutUndoStack'
    | 'explorerVisible'
    | 'explorerPane'
    | 'explorerSidebarWidth'
    | 'explorerExpandedPaths'
    | 'explorerSelectedPath'
    | 'explorerEntriesByPath'
    | 'explorerLoadingPaths'
    | 'explorerErrorsByPath'
    | 'showHiddenFiles'
    | 'gitChanges'
    | 'gitCurrentBranch'
    | 'gitIsRepo'
    | 'gitIsDetached'
    | 'editorVisible'
    | 'editorPane'
    | 'notesVisible'
    | 'notesPane'
    | 'editorTabs'
    | 'activeEditorTabId'
  >
): ActiveWorkspaceSnapshot {
  return {
    name: workspace.name,
    workspacePath: workspace.workspacePath,
    harness: workspace.harness,
    model: workspace.model,
    terminals: workspace.terminals,
    panes: workspace.panes,
    browserVisible: workspace.browserVisible,
    browserOverlayCount: workspace.browserOverlayCount ?? 0,
    browserUrl: workspace.browserUrl,
    activeTerminalId: workspace.activeTerminalId,
    browserPane: workspace.browserPane,
    layoutRoot: workspace.layoutRoot,
    layoutRevision: workspace.layoutRevision ?? 0,
    layoutUndoStack: workspace.layoutUndoStack ?? [],
    explorerVisible: workspace.explorerVisible,
    explorerPane: workspace.explorerPane ?? null,
    explorerSidebarWidth: workspace.explorerSidebarWidth,
    explorerExpandedPaths: workspace.explorerExpandedPaths,
    explorerSelectedPath: workspace.explorerSelectedPath,
    explorerEntriesByPath: workspace.explorerEntriesByPath,
    explorerLoadingPaths: workspace.explorerLoadingPaths,
    explorerErrorsByPath: workspace.explorerErrorsByPath,
    showHiddenFiles: workspace.showHiddenFiles ?? true,
    gitChanges: workspace.gitChanges ?? [],
    gitCurrentBranch: workspace.gitCurrentBranch ?? null,
    gitIsRepo: workspace.gitIsRepo ?? false,
    gitIsDetached: workspace.gitIsDetached ?? false,
    editorVisible: workspace.editorVisible,
    editorPane: workspace.editorPane,
    notesVisible: workspace.notesVisible ?? false,
    notesPane: workspace.notesPane ?? null,
    editorTabs: workspace.editorTabs,
    activeEditorTabId: workspace.activeEditorTabId,
  };
}

export function syncActiveWorkspace(
  state: WorkspaceState,
  updateWorkspace: (workspace: WorkspaceTab) => WorkspaceTab
): Partial<WorkspaceState> {
  const nextWorkspaces = state.workspaces.map((workspace) =>
    workspace.id === state.activeWorkspaceId ? synchronizePages(workspace, updateWorkspace(workspace)) : workspace
  );

  const activeWorkspace = findWorkspaceById(nextWorkspaces, state.activeWorkspaceId);

  if (activeWorkspace == null) {
    return { workspaces: nextWorkspaces };
  }

  return {
    ...getActiveWorkspaceSnapshot(activeWorkspace),
    workspaces: nextWorkspaces,
  };
}

/** Resolve a tab's owning Browser without changing the selected page. */
export function resolveBrowserTabOwner(workspace: WorkspaceTab | null, tabId: string): WorkspaceTab | null {
  if (!workspace) return null;
  if (!workspace.pages) return workspace.browserPane?.tabs.some((tab) => tab.id === tabId) ? workspace : null;
  const page = workspace.pages.find((entry) => entry.browser?.pane?.tabs.some((tab) => tab.id === tabId));
  return page ? projectPageBrowser(workspace, page) : null;
}

export function patchBrowserTabById(state: WorkspaceState, workspaceId: string, tabId: string | null | undefined,
  updater: (workspace: WorkspaceTab) => WorkspaceTab): Partial<WorkspaceState> {
  return patchWorkspaceById(state, workspaceId, (workspace) => {
    const target = tabId ?? workspace.browserPane?.activeTabId;
    return target ? updateBrowserOwner(workspace, target, updater) : tabId == null ? updater(workspace) : workspace;
  });
}

export function patchWorkspacePageById(state: WorkspaceState, workspaceId: string, pageId: string | undefined,
  updater: (workspace: WorkspaceTab) => WorkspaceTab): Partial<WorkspaceState> {
  return patchWorkspaceById(state, workspaceId, (workspace) => {
    if (!pageId || pageId === workspace.activePageId) return updater(workspace);
    if (!workspace.pages?.some((page) => page.id === pageId)) return workspace;
    const target = selectPage(workspace, pageId);
    return retainSelectedPage(workspace, synchronizePages(target, updater(target)));
  });
}

export function patchWorkspaceById(
  state: WorkspaceState,
  workspaceId: string,
  updater: (workspace: WorkspaceTab) => WorkspaceTab
): Partial<WorkspaceState> {
  let updatedWorkspace: WorkspaceTab | null = null;
  const nextWorkspaces = state.workspaces.map((workspace) => {
    if (workspace.id === workspaceId) {
      updatedWorkspace = synchronizePages(workspace, updater(workspace));
      return updatedWorkspace;
    }
    return workspace;
  });

  if (!updatedWorkspace) {
    return { workspaces: nextWorkspaces };
  }

  if (isWorkspaceActiveById(nextWorkspaces, workspaceId)) {
    return {
      ...getActiveWorkspaceSnapshot(updatedWorkspace),
      workspaces: nextWorkspaces,
    };
  }

  return { workspaces: nextWorkspaces };
}

function editorOperationKey(filePath: string, environmentId?: string): string {
  return environmentId && environmentId !== 'local' ? `${environmentId}::${filePath}` : filePath;
}

export function isEditorOperationPending(state: PendingEditorOperationsHolder, filePath: string, environmentId?: string): boolean {
  return editorOperationKey(filePath, environmentId) in state.pendingEditorOperations;
}

export function setEditorOperationPending(
  state: PendingEditorOperationsHolder,
  filePath: string,
  opType: string,
  environmentId?: string,
): Record<string, string> {
  return { ...state.pendingEditorOperations, [editorOperationKey(filePath, environmentId)]: opType };
}

export function clearEditorOperationPending(
  state: PendingEditorOperationsHolder,
  filePath: string,
  environmentId?: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(state.pendingEditorOperations).filter(([key]) => key !== editorOperationKey(filePath, environmentId))
  );
}

// validateWorkspaceConsistency is called with `Partial<WorkspaceState>` snapshots in many places.
// Treat `undefined` fields as "not provided" (skip checks) to avoid false positives.
function hasOwnState(state: Partial<WorkspaceState>, key: keyof WorkspaceState): boolean {
  return Object.prototype.hasOwnProperty.call(state, key);
}

function validateWorkspaceInvariants(state: Partial<WorkspaceState>): string[] {
  const warnings: string[] = [];

  if (state.activeWorkspaceId === null && (state.workspaces?.length ?? 0) > 0) {
    warnings.push('W1 violated: activeWorkspaceId is null but workspaces[] is non-empty');
  }
  if (typeof state.activeWorkspaceId === 'string' && Array.isArray(state.workspaces)) {
    if (!state.workspaces.some(w => w.id === state.activeWorkspaceId)) {
      warnings.push(`W2 violated: activeWorkspaceId "${state.activeWorkspaceId}" not found in workspaces[]`);
    }
  }
  if (hasOwnState(state, 'workspaces') && hasOwnState(state, 'activeWorkspaceId') && Array.isArray(state.workspaces)) {
    const activeLifecycleWorkspaces = state.workspaces.filter((workspace) => workspace.lifecycle === 'active');

    if (state.workspaces.length > 0 && activeLifecycleWorkspaces.length !== 1) {
      warnings.push(
        `W3 violated: expected exactly one active workspace lifecycle entry, found ${activeLifecycleWorkspaces.length}`,
      );
    }

    if (typeof state.activeWorkspaceId === 'string') {
      const activeWorkspace = state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId);
      if (activeWorkspace != null && activeWorkspace.lifecycle !== 'active') {
        warnings.push(
          `W4 violated: activeWorkspaceId "${state.activeWorkspaceId}" does not reference a workspace with lifecycle "active"`,
        );
      }
    }
  }

  return warnings;
}

function validateTerminalInvariants(state: Partial<WorkspaceState>): string[] {
  const warnings: string[] = [];
  if (!state.workspaces?.some((workspace) => workspace.pages) && state.activeTerminalId === null && (state.terminals?.length ?? 0) > 0) {
    warnings.push('T1 violated: activeTerminalId is null but terminals[] is non-empty');
  }

  if (typeof state.activeTerminalId === 'string' && Array.isArray(state.terminals)) {
    if (!state.terminals.some(t => t.id === state.activeTerminalId)) {
      warnings.push(`T2 violated: activeTerminalId "${state.activeTerminalId}" not found in terminals[]`);
    }
  }

  return warnings;
}

function validateLayoutInvariants(state: Partial<WorkspaceState>): string[] {
  const warnings: string[] = [];

  if (!hasOwnState(state, 'layoutRoot')) {
    return warnings;
  }

  const layoutRoot = state.layoutRoot ?? null;

  if (layoutRoot === null) {
    if (!state.workspaces?.some((workspace) => workspace.pages)) {
      if ((state.panes?.length ?? 0) > 0) warnings.push('L1 violated: layoutRoot is null but panes[] is non-empty');
      if (state.browserVisible) warnings.push('L1 violated: layoutRoot is null but browser is visible');
      if (state.editorVisible) warnings.push('L1 violated: layoutRoot is null but editor is visible');
      if (state.notesVisible) warnings.push('L1 violated: layoutRoot is null but notes is visible');
    }
    return warnings;
  }

  // Only validate this invariant when the relevant fields are present; missing booleans
  // should not be interpreted as "false" in partial snapshots.
  if (
    Array.isArray(state.panes)
    && state.panes.length === 0
    && state.browserVisible === false
    && state.editorVisible === false
    && state.notesVisible === false
  ) {
    warnings.push('L1 violated: layoutRoot is non-null but no terminal/browser/editor/notes panes exist');
  }

  const panes = state.panes;
  if (
    Array.isArray(panes)
    && hasOwnState(state, 'browserPane')
    && hasOwnState(state, 'explorerPane')
    && hasOwnState(state, 'editorPane')
    && hasOwnState(state, 'notesPane')
  ) {
    const leafPaneIds = collectLeafPaneIds(layoutRoot);
    const allValidPaneIds = new Set<string>([
      ...panes.map(p => p.id),
      ...(state.browserPane ? [state.browserPane.id] : []),
      ...(state.editorPane ? [state.editorPane.id] : []),
      ...(state.notesPane ? [state.notesPane.id] : []),
    ]);
    for (const paneId of leafPaneIds) {
      if (!allValidPaneIds.has(paneId)) {
        warnings.push(`L2 violated: layout pane "${paneId}" not found in panes[], browserPane, editorPane, or notesPane`);
      }
    }
  }

  return warnings;
}

function validateBrowserInvariants(state: Partial<WorkspaceState>): string[] {
  const warnings: string[] = [];

  if (!hasOwnState(state, 'browserPane') || state.browserPane == null) {
    return warnings;
  }

  const tabs = state.browserPane.tabs;
  if (!Array.isArray(tabs) || tabs.length === 0) {
    warnings.push('B1 violated: browserPane.tabs must contain at least one tab');
    return warnings;
  }

  const seen = new Set<string>();
  for (const tab of tabs) {
    if (seen.has(tab.id)) {
      warnings.push(`B2 violated: duplicate browser tab id "${tab.id}"`);
    }
    seen.add(tab.id);
  }

  const activeTabId = state.browserPane.activeTabId;
  if (activeTabId == null) {
    warnings.push('B3 violated: browserPane.activeTabId is null but tabs[] is non-empty');
  } else if (!tabs.some((tab) => tab.id === activeTabId)) {
    warnings.push(`B3 violated: browserPane.activeTabId "${activeTabId}" not found in browserPane.tabs[]`);
  } else if (typeof state.browserUrl === 'string') {
    const activeTab = tabs.find((tab) => tab.id === activeTabId);
    if (activeTab && activeTab.url !== state.browserUrl) {
      warnings.push(
        `B4 violated: browserUrl "${state.browserUrl}" does not match active tab url "${activeTab.url}"`,
      );
    }
  }

  return warnings;
}

function validateEditorInvariants(state: Partial<WorkspaceState>): string[] {
  const warnings: string[] = [];

  if (state.activeEditorTabId === null && (state.editorTabs?.length ?? 0) > 0) {
    warnings.push('E1 violated: activeEditorTabId is null but editorTabs[] is non-empty');
  }
  if (typeof state.activeEditorTabId === 'string' && Array.isArray(state.editorTabs)) {
    if (!state.editorTabs.some(t => t.id === state.activeEditorTabId)) {
      warnings.push(`E2 violated: activeEditorTabId "${state.activeEditorTabId}" not found in editorTabs[]`);
    }
  }

  return warnings;
}

function validatePageInvariants(state: Partial<WorkspaceState>): string[] {
  const warnings: string[] = [];
  for (const workspace of state.workspaces ?? []) {
    if (!workspace.pages) continue;
    if (!workspace.pages.length || !workspace.pages.some((page) => page.id === workspace.activePageId)) warnings.push('P1 violated: invalid active page');
    const ids = new Set<string>();
    const valid = new Set([...workspace.panes.map((pane) => pane.id), workspace.browserPane?.id, workspace.editorPane?.id, workspace.notesPane?.id]);
    const pageIds = new Set<string>();
    for (const page of workspace.pages) {
      if (pageIds.has(page.id)) warnings.push('P2 violated: duplicate page id');
      pageIds.add(page.id);
      const tiled = collectLeafPaneIds(page.layoutRoot);
      for (const id of tiled) {
        if (!valid.has(id) || ids.has(id)) warnings.push('P3 violated: invalid or duplicated pane membership');
        ids.add(id);
      }
      if (page.maximizedPaneId && !tiled.includes(page.maximizedPaneId)) warnings.push('P4 violated: invalid maximized pane');
    }
    for (const entry of workspace.minimizedPanes ?? []) {
      if (!valid.has(entry.paneId) || ids.has(entry.paneId) || !pageIds.has(entry.pageId)) warnings.push('P5 violated: invalid minimized pane');
      ids.add(entry.paneId);
    }
    const page = workspace.pages.find((entry) => entry.id === workspace.activePageId);
    if (page && page.layoutRoot !== workspace.layoutRoot) warnings.push('P6 violated: active page projection differs');
    if (workspace.panes.some((pane) => !ids.has(pane.id))) warnings.push('P7 violated: pane has no page membership');
  }
  return warnings;
}

export function validateWorkspaceConsistency(state: Partial<WorkspaceState>): string[] {
  return [
    ...validatePageInvariants(state),
    ...validateWorkspaceInvariants(state),
    ...validateTerminalInvariants(state),
    ...validateLayoutInvariants(state),
    ...validateBrowserInvariants(state),
    ...validateEditorInvariants(state),
  ];
}
