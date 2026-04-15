import {
  buildWorkspaceLayout,
  collectLeafPaneIds,
} from './workspaceLayout';
import type { GitStatus } from '../components/git/types';
import type { FileExplorerEntry } from '../../shared/types/fileExplorer';
import type {
  EditorPaneState,
  EditorTab,
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

export const createPane = (terminalId: string | null, position?: PanePosition): Pane => ({
  id: generatePaneId(),
  terminalId,
  position,
});

export const createWorkspaceId = () => generateId('workspace');

export const createDefaultExplorerState = () => ({
  explorerVisible: false,
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

/**
 * Default resource policy for new workspaces.
 * All subsystems warm by default: PTY processes run in main, xtermCache keeps
 * terminal state, and all workspace pane surfaces stay mounted in the shared
 * container (Phase 2 — single shared-container residency). Browser is warm
 * (bounds preserved); explorer is cached (active-workspace-only watcher).
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

export const sanitizeWorkspace = (workspace: WorkspaceTab): WorkspaceTab => ({
  ...workspace,
  lifecycle: workspace.lifecycle ?? 'active',
  terminals: [...workspace.terminals],
  panes: [...workspace.panes],
  explorerExpandedPaths: [...workspace.explorerExpandedPaths],
  explorerEntriesByPath: { ...workspace.explorerEntriesByPath },
  explorerLoadingPaths: [...workspace.explorerLoadingPaths],
  explorerErrorsByPath: { ...workspace.explorerErrorsByPath },
  browserOverlayCount: workspace.browserOverlayCount ?? 0,
  browserPane: workspace.browserPane
    ? { ...workspace.browserPane, locked: workspace.browserPane.locked ?? false }
    : null,
  editorTabs: [...workspace.editorTabs],
  showHiddenFiles: workspace.showHiddenFiles ?? true,
  gitChanges: [...(workspace.gitChanges ?? [])],
  editorPane: workspace.editorPane
    ? { ...workspace.editorPane, locked: workspace.editorPane.locked ?? false }
    : null,
  layoutRoot: buildWorkspaceLayout(workspace),
  runtimeState: sanitizeRuntimeState(workspace),
});

export function withWorkspaceLifecycle(
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

export function getWorkspaceNameFromPath(workspacePath: string): string {
  const trimmed = workspacePath.replace(/\/+$/, '');
  if (!trimmed) return 'Workspace';
  const baseName = trimmed.split('/').pop();
  return baseName && baseName.length > 0 ? baseName : 'Workspace';
}

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
    | 'explorerVisible'
    | 'explorerSidebarWidth'
    | 'explorerExpandedPaths'
    | 'explorerSelectedPath'
    | 'explorerEntriesByPath'
    | 'explorerLoadingPaths'
    | 'explorerErrorsByPath'
    | 'showHiddenFiles'
    | 'gitChanges'
    | 'editorVisible'
    | 'editorPane'
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
    explorerVisible: workspace.explorerVisible,
    explorerSidebarWidth: workspace.explorerSidebarWidth,
    explorerExpandedPaths: workspace.explorerExpandedPaths,
    explorerSelectedPath: workspace.explorerSelectedPath,
    explorerEntriesByPath: workspace.explorerEntriesByPath,
    explorerLoadingPaths: workspace.explorerLoadingPaths,
    explorerErrorsByPath: workspace.explorerErrorsByPath,
    showHiddenFiles: workspace.showHiddenFiles ?? true,
    gitChanges: workspace.gitChanges ?? [],
    editorVisible: workspace.editorVisible,
    editorPane: workspace.editorPane,
    editorTabs: workspace.editorTabs,
    activeEditorTabId: workspace.activeEditorTabId,
  };
}

export function syncActiveWorkspace(
  state: WorkspaceState,
  updateWorkspace: (workspace: WorkspaceTab) => WorkspaceTab
): Partial<WorkspaceState> {
  const nextWorkspaces = state.workspaces.map((workspace) =>
    workspace.id === state.activeWorkspaceId ? updateWorkspace(workspace) : workspace
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

export function patchWorkspaceById(
  state: WorkspaceState,
  workspaceId: string,
  updater: (workspace: WorkspaceTab) => WorkspaceTab
): Partial<WorkspaceState> {
  let updatedWorkspace: WorkspaceTab | null = null;
  const nextWorkspaces = state.workspaces.map((workspace) => {
    if (workspace.id === workspaceId) {
      updatedWorkspace = updater(workspace);
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

export function isEditorOperationPending(state: PendingEditorOperationsHolder, filePath: string): boolean {
  return filePath in state.pendingEditorOperations;
}

export function setEditorOperationPending(
  state: PendingEditorOperationsHolder,
  filePath: string,
  opType: string
): Record<string, string> {
  return { ...state.pendingEditorOperations, [filePath]: opType };
}

export function clearEditorOperationPending(
  state: PendingEditorOperationsHolder,
  filePath: string
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(state.pendingEditorOperations).filter(([key]) => key !== filePath)
  );
}

export function validateWorkspaceConsistency(state: Partial<WorkspaceState>): string[] {
  const warnings: string[] = [];

  // This validator is called with `Partial<WorkspaceState>` snapshots in many places.
  // Treat `undefined` fields as "not provided" (skip checks) to avoid false positives.
  const hasOwn = (key: keyof WorkspaceState): boolean =>
    Object.prototype.hasOwnProperty.call(state, key);

  // [W1,W2] Workspace invariants
  if (state.activeWorkspaceId === null && (state.workspaces?.length ?? 0) > 0) {
    warnings.push('W1 violated: activeWorkspaceId is null but workspaces[] is non-empty');
  }
  if (typeof state.activeWorkspaceId === 'string' && Array.isArray(state.workspaces)) {
    if (!state.workspaces.some(w => w.id === state.activeWorkspaceId)) {
      warnings.push(`W2 violated: activeWorkspaceId "${state.activeWorkspaceId}" not found in workspaces[]`);
    }
  }
  if (hasOwn('workspaces') && hasOwn('activeWorkspaceId') && Array.isArray(state.workspaces)) {
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

  // [T1,T2] Terminal invariants
  if (state.activeTerminalId === null && (state.terminals?.length ?? 0) > 0) {
    warnings.push('T1 violated: activeTerminalId is null but terminals[] is non-empty');
  }
  if (typeof state.activeTerminalId === 'string' && Array.isArray(state.terminals)) {
    if (!state.terminals.some(t => t.id === state.activeTerminalId)) {
      warnings.push(`T2 violated: activeTerminalId "${state.activeTerminalId}" not found in terminals[]`);
    }
  }

  // [L1,L2] Layout invariants
  if (hasOwn('layoutRoot')) {
    const layoutRoot = state.layoutRoot ?? null;

    if (layoutRoot === null) {
      if (Array.isArray(state.panes) && state.panes.length > 0) {
        warnings.push('L1 violated: layoutRoot is null but panes[] is non-empty');
      }
      if (state.browserVisible === true) {
        warnings.push('L1 violated: layoutRoot is null but browser is visible');
      }
      if (state.editorVisible === true) {
        warnings.push('L1 violated: layoutRoot is null but editor is visible');
      }
    } else {
      // Only validate this invariant when the relevant fields are present; missing booleans
      // should not be interpreted as "false" in partial snapshots.
      if (
        Array.isArray(state.panes)
        && state.panes.length === 0
        && state.browserVisible === false
        && state.editorVisible === false
      ) {
        warnings.push('L1 violated: layoutRoot is non-null but no panes exist and browser/editor are invisible');
      }

      const panes = state.panes;
      if (Array.isArray(panes) && hasOwn('browserPane') && hasOwn('editorPane')) {
        const leafPaneIds = collectLeafPaneIds(layoutRoot);
        const allValidPaneIds = new Set<string>([
          ...panes.map(p => p.id),
          ...(state.browserPane ? [state.browserPane.id] : []),
          ...(state.editorPane ? [state.editorPane.id] : []),
        ]);
        for (const paneId of leafPaneIds) {
          if (!allValidPaneIds.has(paneId)) {
            warnings.push(`L2 violated: layout pane "${paneId}" not found in panes[], browserPane, or editorPane`);
          }
        }
      }
    }
  }

  // [E1,E2] Editor invariants
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
