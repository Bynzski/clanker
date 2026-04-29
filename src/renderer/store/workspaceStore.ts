import { create } from 'zustand';
import {
  buildWorkspaceLayout,
  collectLeafPaneIds,
  dockPaneToEdgeInLayout,
  GRID_COLS,
  GRID_ROWS,
  insertPaneAtEdgeGapInLayout,
  insertPaneAtEdgeSegmentInLayout,
  insertPaneIntoLayout,
  normalizeLayoutRoot,
  normalizePosition,
  removePaneFromLayout,
  setSplitRatioInLayout,
  swapPaneIdsInLayout,
} from './workspaceLayout';
import type {
  BrowserPaneState,
  BrowserTab,
  EditorTab,
  LayoutNode,
  Pane,
  Terminal,
  WorkspaceResourcePolicy,
  WorkspaceResidencyState,
  WorkspaceTab,
} from './workspaceTypes';
import type { WorkspaceState } from './workspaceStoreTypes';
import {
  areGitStatusListsEqual,
  assignWorkspaceLifecycles,
  clearEditorOperationPending,
  createDefaultBrowserPane,
  createDefaultBrowserTab,
  createDefaultEditorState,
  createDefaultExplorerState,
  createPane,
  createWorkspaceId,
  findActiveWorkspace,
  findWorkspaceById,
  generateId,
  getActiveWorkspaceSnapshot,
  getWorkspaceNameFromPath,
  isEditorOperationPending,
  isWorkspaceActiveById,
  isWorkspaceWarm,
  getWorkspaceResourcePolicy,
  patchWorkspaceById,
  resolveWorkspaceByScope,
  resolveWorkspaceIdByScope,
  sanitizeWorkspace,
  setEditorOperationPending,
  syncActiveWorkspace,
  validateWorkspaceConsistency,
  withWorkspaceResidency,
  withWorkspaceResourcePolicy,
} from './workspaceStoreHelpers';
import { preserveOriginalLineEndings } from '../lib/lineEndings';

export type {
  BrowserPaneState,
  EditorPaneState,
  EditorTab,
  GridViewport,
  LayoutLeaf,
  LayoutNode,
  LayoutSplit,
  Pane,
  PanePosition,
  Terminal,
  WorkspaceTab,
} from './workspaceTypes';

export type { DockEdge, EdgeGap, EdgeTerminal } from './workspaceLayout';
export { getEdgeGaps, getEdgeTerminals } from './workspaceLayout';

export * from './workspaceStoreHelpers';

/**
 * Workspace state for the active workspace and the collection of all workspaces.
 *
 * @invariant activeWorkspaceId === null - workspaces.length === 0
 *   When no workspaces exist, nothing can be active.
 *
 * @invariant activeWorkspaceId !== null -> workspaces.some(w => w.id === activeWorkspaceId)
 *   The active workspace ID always references an existing workspace.
 *
 * @invariant workspaces.length > 0 -> workspaces.filter(w => w.lifecycle === 'active').length === 1
 *   Exactly one workspace must be marked active in lifecycle state.
 *
 * @invariant activeTerminalId === null - terminals.length === 0
 *   When no terminals exist, no terminal can be active.
 *
 * @invariant activeTerminalId !== null -> terminals.some(t => t.id === activeTerminalId)
 *   The active terminal ID always references an existing terminal.
 *
 * @invariant layoutRoot === null - panes.length === 0 && !browserVisible && !editorVisible
 *   The layout tree only exists when there are visible panes.
 *
 * @invariant layoutRoot !== null -> all pane IDs in layoutRoot exist in
 *   panes[].id ∪ {browserPane?.id} ∪ {editorPane?.id}
 *   The layout tree only references valid pane IDs.
 *
 * @invariant activeEditorTabId === null - editorTabs.length === 0
 *   When no editor tabs are open, no tab can be active.
 *
 * @invariant activeEditorTabId !== null -> editorTabs.some(t => t.id === activeEditorTabId)
 *   The active editor tab ID always references an existing tab.
 */
const defaultWorkspaceState = {
  name: '',
  workspacePath: '',
  harness: 'codex',
  model: '',
  terminals: [] as Terminal[],
  panes: [] as Pane[],
  browserVisible: false,
  browserOverlayCount: 0,
  browserUrl: 'https://github.com',
  activeTerminalId: null as string | null,
  browserPane: null as BrowserPaneState | null,
  layoutRoot: null as LayoutNode | null,
  ...createDefaultExplorerState(),
  ...createDefaultEditorState(),
  gridViewport: { cols: GRID_COLS, rows: GRID_ROWS },
  layoutRevision: 0,
  pendingEditorOperations: {} as Record<string, string>,
  gitCurrentBranch: null as string | null,
  gitIsRepo: false,
  gitIsDetached: false,
};

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ...defaultWorkspaceState,
  workspaces: [],
  activeWorkspaceId: null,
  activeWorkspaceLifecycle: null,

  addWorkspace: (workspace) => set((state) => {
    const id = createWorkspaceId();
    const defaultName = workspace.name || getWorkspaceNameFromPath(workspace.workspacePath);
    const nextWorkspace: WorkspaceTab = sanitizeWorkspace({
      ...createDefaultExplorerState(),
      id,
      lifecycle: 'active',
      ...workspace,
      name: defaultName,
    });
    const nextWorkspaces = assignWorkspaceLifecycles([...state.workspaces, nextWorkspace], id);

    const nextState = {
      ...getActiveWorkspaceSnapshot(nextWorkspace),
      workspaces: nextWorkspaces,
      activeWorkspaceId: id,
      activeWorkspaceLifecycle: 'active' as const,
      layoutRevision: state.layoutRevision,
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after addWorkspace:', warnings);
      }
    }
    return nextState;
  }),

  getWorkspaceById: (id) => {
    return findWorkspaceById(get().workspaces, id);
  },

  getActiveWorkspace: () => {
    return findActiveWorkspace(get().workspaces);
  },

  isWorkspaceActive: (id) => {
    return isWorkspaceActiveById(get().workspaces, id);
  },

  selectWorkspace: (id) => set((state) => {
    const workspace = findWorkspaceById(state.workspaces, id);
    if (workspace == null) {
      return state;
    }

    const next = sanitizeWorkspace({
      ...workspace,
      lifecycle: 'active',
    });
    const nextWorkspaces = assignWorkspaceLifecycles(
      state.workspaces.map((entry) => entry.id === id ? next : entry),
      id,
    );
    const nextState = {
      ...getActiveWorkspaceSnapshot(next),
      workspaces: nextWorkspaces,
      gridViewport: state.gridViewport,
      layoutRevision: state.layoutRevision,
      activeWorkspaceId: id,
      activeWorkspaceLifecycle: 'active' as const,
    };

    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after selectWorkspace:', warnings);
      }
    }

    return nextState;
  }),

  closeWorkspace: (id) => set((state) => {
    const remaining = state.workspaces.filter((workspace) => workspace.id !== id);

    if (remaining.length === 0) {
      return {
        ...defaultWorkspaceState,
        workspaces: [],
        activeWorkspaceId: null,
        activeWorkspaceLifecycle: null,
      };
    }

    if (state.activeWorkspaceId === id) {
      const nextActive = remaining[Math.max(0, remaining.length - 1)];
      const nextWorkspaces = assignWorkspaceLifecycles(remaining, nextActive.id);
      return {
        ...getActiveWorkspaceSnapshot(nextActive),
        gridViewport: state.gridViewport,
        layoutRevision: state.layoutRevision,
        workspaces: nextWorkspaces,
        activeWorkspaceId: nextActive.id,
        activeWorkspaceLifecycle: 'active',
      };
    }

    const nextWorkspaces = assignWorkspaceLifecycles(remaining, state.activeWorkspaceId);
    return {
      workspaces: nextWorkspaces,
      activeWorkspaceLifecycle: 'active',
    };
  }),

  updateWorkspaceName: (id, name) => set((state) => ({
    ...(id === state.activeWorkspaceId ? { name } : {}),
    workspaces: state.workspaces.map((workspace) => (
      workspace.id === id ? { ...workspace, name } : workspace
    )),
  })),

  setWorkspacePath: (path) => set((state) => syncActiveWorkspace(state, (workspace) => ({
    ...workspace,
    workspacePath: path,
  }))),

  setHarness: (harness) => set((state) => syncActiveWorkspace(state, (workspace) => ({
    ...workspace,
    harness,
    model: '',
  }))),

  setModel: (model) => set((state) => syncActiveWorkspace(state, (workspace) => ({
    ...workspace,
    model,
  }))),

  // -------------------------------------------------------------------------
  // Workspace residency actions
  // -------------------------------------------------------------------------

  /**
   * Returns true if the workspace is warm (surface residency is active).
   * If no workspaceId is provided, operates on the active workspace.
   */
  isWorkspaceWarm: (workspaceId?: string) => {
    const id = workspaceId ?? get().activeWorkspaceId;
    const workspace = id ? findWorkspaceById(get().workspaces, id) : null;
    return workspace ? isWorkspaceWarm(workspace) : false;
  },

  /**
   * Gets the resource policy for a workspace by id.
   * Returns the policy with all sub-fields filled (never partial).
   */
  getWorkspaceResourcePolicy: (workspaceId: string) => {
    const workspace = findWorkspaceById(get().workspaces, workspaceId);
    return workspace ? getWorkspaceResourcePolicy(workspace) : null;
  },

  /**
   * Sets the residency state for a workspace by id.
   * Does not affect other runtime state fields.
   */
  setWorkspaceResidency: (workspaceId: string, residencyState: WorkspaceResidencyState) => set((state) => {
    return patchWorkspaceById(state, workspaceId, (workspace) =>
      withWorkspaceResidency(workspace, residencyState)
    );
  }),

  /**
   * Merges a partial resource policy into a workspace by id.
   * Only the provided fields are updated; all others are preserved.
   */
  setWorkspaceResourcePolicy: (workspaceId: string, partialPolicy: Partial<WorkspaceResourcePolicy>) => set((state) => {
    return patchWorkspaceById(state, workspaceId, (workspace) =>
      withWorkspaceResourcePolicy(workspace, partialPolicy)
    );
  }),

  addTerminal: (terminal) => set((state) => {
    const nextTerminals = [...state.terminals, terminal];
    const paneExists = state.panes.some((pane) => pane.terminalId === terminal.id);
    const nextPane = paneExists
      ? state.panes.find((pane) => pane.terminalId === terminal.id) ?? createPane(terminal.id)
      : createPane(terminal.id);
    const nextPanes = paneExists
      ? state.panes
      : [...state.panes, nextPane];

    const nextLayoutRoot = paneExists
      ? normalizeLayoutRoot(state.layoutRoot, {
          panes: nextPanes,
          browserPane: state.browserPane,
          browserVisible: state.browserVisible,
          editorPane: state.editorPane,
          editorVisible: state.editorVisible,
        })
      : insertPaneIntoLayout(state.layoutRoot, nextPane.id, {
          panes: state.panes,
          browserPane: state.browserPane,
          browserVisible: state.browserVisible,
          editorPane: state.editorPane,
          editorVisible: state.editorVisible,
          activeTerminalId: state.activeTerminalId,
        });

    const nextActiveTerminalId = terminal.id;

    const nextState = {
      terminals: nextTerminals,
      panes: nextPanes,
      activeTerminalId: nextActiveTerminalId,
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        terminals: nextTerminals,
        panes: nextPanes,
        activeTerminalId: nextActiveTerminalId,
        layoutRoot: nextLayoutRoot,
        model: state.model,
      })),
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after addTerminal:', warnings);
      }
    }

    return nextState;
  }),

  removeTerminal: (id) => set((state) => {
    const nextTerminals = state.terminals.filter((terminal) => terminal.id !== id);
    const paneToRemove = state.panes.find((pane) => pane.terminalId === id);
    const nextPanes = state.panes.filter((pane) => pane.terminalId !== id);
    const nextActiveTerminalId = state.activeTerminalId === id
      ? (nextTerminals.length > 0 ? nextTerminals[nextTerminals.length - 1].id : null)
      : state.activeTerminalId;
    const nextLayoutRoot = paneToRemove
      ? removePaneFromLayout(state.layoutRoot, paneToRemove.id)
      : state.layoutRoot;
    const nextState = {
      terminals: nextTerminals,
      panes: nextPanes,
      activeTerminalId: nextActiveTerminalId,
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        terminals: nextTerminals,
        panes: nextPanes,
        activeTerminalId: nextActiveTerminalId,
        layoutRoot: nextLayoutRoot,
      })),
    };

    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after removeTerminal:', warnings);
      }
    }


    return nextState;
  }),

  setActiveTerminal: (id) => set((state) => {
    const nextState = {
      activeTerminalId: id,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        activeTerminalId: id,
      })),
    };

    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after setActiveTerminal:', warnings);
      }
    }

    return nextState;
  }),

  toggleBrowser: () => set((state) => {
    const nextBrowserVisible = !state.browserVisible;
    const nextBrowserPane = nextBrowserVisible
      ? state.browserPane ?? createDefaultBrowserPane(
          generateId('browser'),
          { x: 0, y: 0, w: 6, h: 6 },
          state.browserUrl,
        )
      : state.browserPane;

    let nextLayoutRoot = state.layoutRoot;
    if (nextBrowserVisible) {
      const browserId = nextBrowserPane?.id ?? null;
      if (browserId != null) {
        if (state.browserVisible) {
          nextLayoutRoot = insertPaneIntoLayout(state.layoutRoot, browserId, {
            panes: state.panes,
            browserPane: nextBrowserPane,
            browserVisible: true,
            editorPane: state.editorPane,
            editorVisible: state.editorVisible,
            activeTerminalId: state.activeTerminalId,
          });
        } else {
          const currentIds = collectLeafPaneIds(state.layoutRoot ?? null);
          if (!currentIds.includes(browserId)) {
            nextLayoutRoot = insertPaneIntoLayout(state.layoutRoot, browserId, {
              panes: state.panes,
              browserPane: nextBrowserPane,
              browserVisible: true,
              editorPane: state.editorPane,
              editorVisible: state.editorVisible,
              activeTerminalId: state.activeTerminalId,
            });
          }
        }
      }
    } else {
      const browserId = state.browserPane?.id;
      if (browserId != null) {
        nextLayoutRoot = removePaneFromLayout(state.layoutRoot, browserId);
      }
    }

    return {
      browserVisible: nextBrowserVisible,
      browserPane: nextBrowserPane,
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        browserVisible: nextBrowserVisible,
        browserPane: nextBrowserPane,
        layoutRoot: nextLayoutRoot,
      })),
    };
  }),

  pushBrowserOverlay: (workspaceId) => set((state) => {
    const scopedWorkspaceId = resolveWorkspaceIdByScope(state, workspaceId);
    if (scopedWorkspaceId == null) {
      return {
        browserOverlayCount: state.browserOverlayCount + 1,
      };
    }

    return patchWorkspaceById(state, scopedWorkspaceId, (workspace) => ({
      ...workspace,
      browserOverlayCount: (workspace.browserOverlayCount ?? 0) + 1,
    }));
  }),

  popBrowserOverlay: (workspaceId) => set((state) => {
    const scopedWorkspaceId = resolveWorkspaceIdByScope(state, workspaceId);
    if (scopedWorkspaceId == null) {
      return {
        browserOverlayCount: Math.max(0, state.browserOverlayCount - 1),
      };
    }

    return patchWorkspaceById(state, scopedWorkspaceId, (workspace) => ({
      ...workspace,
      browserOverlayCount: Math.max(0, (workspace.browserOverlayCount ?? 0) - 1),
    }));
  }),

  setBrowserUrl: (url, workspaceId) => set((state) => {
    const scopedWorkspaceId = resolveWorkspaceIdByScope(state, workspaceId);
    if (scopedWorkspaceId == null) {
      return state;
    }

    return patchWorkspaceById(state, scopedWorkspaceId, (workspace) => {
      const browserPane = workspace.browserPane;
      if (browserPane == null) {
        return { ...workspace, browserUrl: url };
      }
      const activeTabId = browserPane.activeTabId;
      const nextTabs = browserPane.tabs.map((tab) =>
        tab.id === activeTabId ? { ...tab, url } : tab,
      );
      return {
        ...workspace,
        browserUrl: url,
        browserPane: { ...browserPane, tabs: nextTabs },
      };
    });
  }),

  updateWorkspaceBrowserUrl: (workspaceId, tabId, url, title) => set((state) => (
    patchWorkspaceById(state, workspaceId, (workspace) => {
      const browserPane = workspace.browserPane;
      if (browserPane == null) {
        // No pane: still mirror the URL for compatibility.
        return { ...workspace, browserUrl: url };
      }

      const targetTabId = tabId ?? browserPane.activeTabId;
      if (targetTabId == null) {
        return { ...workspace, browserUrl: url };
      }

      const targetExists = browserPane.tabs.some((tab) => tab.id === targetTabId);
      if (!targetExists) {
        return workspace;
      }

      const nextTabs = browserPane.tabs.map((tab) => {
        if (tab.id !== targetTabId) {
          return tab;
        }
        const nextTab: BrowserTab = { ...tab, url };
        if (typeof title === 'string') {
          nextTab.title = title;
        }
        return nextTab;
      });

      const isActive = targetTabId === browserPane.activeTabId;
      return {
        ...workspace,
        browserUrl: isActive ? url : workspace.browserUrl,
        browserPane: { ...browserPane, tabs: nextTabs },
      };
    })
  )),

  addBrowserTab: (workspaceId) => {
    const state = get();
    const scopedWorkspace = resolveWorkspaceByScope(state, workspaceId);
    if (scopedWorkspace == null || scopedWorkspace.browserPane == null) {
      return null;
    }

    const newTab = createDefaultBrowserTab();
    const newTabId = newTab.id;

    set((current) => patchWorkspaceById(current, scopedWorkspace.id, (workspace) => {
      const browserPane = workspace.browserPane;
      if (browserPane == null) {
        return workspace;
      }
      const nextTabs = [...browserPane.tabs, newTab];
      return {
        ...workspace,
        browserUrl: newTab.url,
        browserPane: {
          ...browserPane,
          tabs: nextTabs,
          activeTabId: newTabId,
        },
      };
    }));

    return newTabId;
  },

  removeBrowserTab: (tabId, workspaceId) => {
    const state = get();
    const scopedWorkspace = resolveWorkspaceByScope(state, workspaceId);
    if (scopedWorkspace == null || scopedWorkspace.browserPane == null) {
      return { removed: false, nextActiveTabId: null };
    }

    const browserPane = scopedWorkspace.browserPane;
    const tabIndex = browserPane.tabs.findIndex((tab) => tab.id === tabId);
    if (tabIndex === -1) {
      return { removed: false, nextActiveTabId: browserPane.activeTabId };
    }
    if (browserPane.tabs.length <= 1) {
      // Cannot close the last tab.
      return { removed: false, nextActiveTabId: browserPane.activeTabId };
    }

    const nextTabs = browserPane.tabs.filter((tab) => tab.id !== tabId);

    let nextActiveTabId = browserPane.activeTabId;
    if (browserPane.activeTabId === tabId) {
      // Prefer next tab; fall back to previous.
      const fallback = browserPane.tabs[tabIndex + 1] ?? browserPane.tabs[tabIndex - 1] ?? null;
      nextActiveTabId = fallback?.id ?? null;
    }

    set((current) => patchWorkspaceById(current, scopedWorkspace.id, (workspace) => {
      const pane = workspace.browserPane;
      if (pane == null) {
        return workspace;
      }
      const newActiveTab = nextActiveTabId
        ? nextTabs.find((tab) => tab.id === nextActiveTabId) ?? null
        : null;
      const nextBrowserUrl = newActiveTab ? newActiveTab.url : workspace.browserUrl;
      return {
        ...workspace,
        browserUrl: nextBrowserUrl,
        browserPane: {
          ...pane,
          tabs: nextTabs,
          activeTabId: nextActiveTabId,
        },
      };
    }));

    return { removed: true, nextActiveTabId };
  },

  setActiveBrowserTab: (tabId, workspaceId) => {
    const state = get();
    const scopedWorkspace = resolveWorkspaceByScope(state, workspaceId);
    if (scopedWorkspace == null || scopedWorkspace.browserPane == null) {
      return false;
    }
    const target = scopedWorkspace.browserPane.tabs.find((tab) => tab.id === tabId);
    if (target == null) {
      return false;
    }

    set((current) => patchWorkspaceById(current, scopedWorkspace.id, (workspace) => {
      const pane = workspace.browserPane;
      if (pane == null) {
        return workspace;
      }
      const activeTab = pane.tabs.find((tab) => tab.id === tabId);
      if (activeTab == null) {
        return workspace;
      }
      return {
        ...workspace,
        browserUrl: activeTab.url,
        browserPane: { ...pane, activeTabId: tabId },
      };
    }));

    return true;
  },

  updateBrowserTab: (tabId, partial, workspaceId) => {
    const state = get();
    const scopedWorkspace = resolveWorkspaceByScope(state, workspaceId);
    if (scopedWorkspace == null || scopedWorkspace.browserPane == null) {
      return false;
    }
    const exists = scopedWorkspace.browserPane.tabs.some((tab) => tab.id === tabId);
    if (!exists) {
      return false;
    }

    set((current) => patchWorkspaceById(current, scopedWorkspace.id, (workspace) => {
      const pane = workspace.browserPane;
      if (pane == null) {
        return workspace;
      }
      const nextTabs = pane.tabs.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }
        const next: BrowserTab = { ...tab };
        if (typeof partial.url === 'string') next.url = partial.url;
        if (typeof partial.title === 'string') next.title = partial.title;
        if (typeof partial.canGoBack === 'boolean') next.canGoBack = partial.canGoBack;
        if (typeof partial.canGoForward === 'boolean') next.canGoForward = partial.canGoForward;
        return next;
      });
      const isActive = pane.activeTabId === tabId;
      const nextActiveTab = nextTabs.find((tab) => tab.id === tabId);
      return {
        ...workspace,
        browserUrl: isActive && nextActiveTab ? nextActiveTab.url : workspace.browserUrl,
        browserPane: { ...pane, tabs: nextTabs },
      };
    }));

    return true;
  },

  clearTerminals: () => set((state) => {
    const nextState = {
      terminals: [],
      panes: [],
      activeTerminalId: null,
      layoutRoot: null,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        terminals: [],
        panes: [],
        activeTerminalId: null,
        layoutRoot: null,
      })),
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after clearTerminals:', warnings);
      }
    }

    return nextState;
  }),

  setExplorerVisible: (visible, workspaceId) => set((state) => {
    const scopedWorkspaceId = resolveWorkspaceIdByScope(state, workspaceId);
    if (scopedWorkspaceId == null) {
      return state;
    }

    return patchWorkspaceById(state, scopedWorkspaceId, (workspace) => ({
      ...workspace,
      explorerVisible: visible,
    }));
  }),

  setExplorerSidebarWidth: (width, workspaceId) => set((state) => {
    const scopedWorkspaceId = resolveWorkspaceIdByScope(state, workspaceId);
    if (scopedWorkspaceId == null) {
      return state;
    }

    return patchWorkspaceById(state, scopedWorkspaceId, (workspace) => ({
      ...workspace,
      explorerSidebarWidth: width,
    }));
  }),

  toggleExplorerPath: (path, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const explorerExpandedPaths = workspace.explorerExpandedPaths.includes(path)
      ? workspace.explorerExpandedPaths.filter((entry) => entry !== path)
      : [...workspace.explorerExpandedPaths, path];

    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      explorerExpandedPaths,
    }));
  }),

  setExplorerExpandedPaths: (paths, workspaceId) => set((state) => {
    const scopedWorkspaceId = resolveWorkspaceIdByScope(state, workspaceId);
    if (scopedWorkspaceId == null) {
      return state;
    }

    return patchWorkspaceById(state, scopedWorkspaceId, (workspace) => ({
      ...workspace,
      explorerExpandedPaths: paths,
    }));
  }),

  clearExplorerDirectoryState: (paths, workspaceId) => set((state) => {
    if (paths.length === 0) {
      return state;
    }

    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const pathSet = new Set(paths);
    const explorerEntriesByPath = { ...workspace.explorerEntriesByPath };
    const explorerErrorsByPath = { ...workspace.explorerErrorsByPath };
    for (const path of pathSet) {
      delete explorerEntriesByPath[path];
      delete explorerErrorsByPath[path];
    }

    const explorerLoadingPaths = workspace.explorerLoadingPaths.filter((path) => !pathSet.has(path));

    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      explorerEntriesByPath,
      explorerErrorsByPath,
      explorerLoadingPaths,
    }));
  }),

  setExplorerSelectedPath: (path, workspaceId) => set((state) => {
    const scopedWorkspaceId = resolveWorkspaceIdByScope(state, workspaceId);
    if (scopedWorkspaceId == null) {
      return state;
    }

    return patchWorkspaceById(state, scopedWorkspaceId, (workspace) => ({
      ...workspace,
      explorerSelectedPath: path,
    }));
  }),

  setExplorerDirectoryEntries: (directoryPath, entries, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const explorerEntriesByPath = {
      ...workspace.explorerEntriesByPath,
      [directoryPath]: entries,
    };
    const explorerErrorsByPath = {
      ...workspace.explorerErrorsByPath,
      [directoryPath]: null,
    };

    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      explorerEntriesByPath,
      explorerErrorsByPath,
    }));
  }),

  setExplorerDirectoryLoading: (directoryPath, loading, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const explorerLoadingPaths = loading
      ? workspace.explorerLoadingPaths.includes(directoryPath)
        ? workspace.explorerLoadingPaths
        : [...workspace.explorerLoadingPaths, directoryPath]
      : workspace.explorerLoadingPaths.filter((entry) => entry !== directoryPath);

    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      explorerLoadingPaths,
    }));
  }),

  setExplorerDirectoryError: (directoryPath, error, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const explorerErrorsByPath = {
      ...workspace.explorerErrorsByPath,
      [directoryPath]: error,
    };

    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      explorerErrorsByPath,
    }));
  }),

  resetExplorerState: () => set((state) => ({
    ...createDefaultExplorerState(),
    ...syncActiveWorkspace(state, (workspace) => ({
      ...workspace,
      ...createDefaultExplorerState(),
    })),
  })),

  setShowHiddenFiles: (show, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null || workspace.showHiddenFiles === show) {
      return state;
    }

    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      showHiddenFiles: show,
    }));
  }),

  setGitChanges: (changes) => set((state) => {
    if (areGitStatusListsEqual(state.gitChanges, changes)) {
      return state;
    }

    return {
      gitChanges: changes,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        gitChanges: changes,
      })),
    };
  }),

  setGitBranchInfo: (branch, isRepo, isDetached) => set((state) => {
    if (
      state.gitCurrentBranch === branch &&
      state.gitIsRepo === isRepo &&
      state.gitIsDetached === isDetached
    ) {
      return state;
    }

    return {
      gitCurrentBranch: branch,
      gitIsRepo: isRepo,
      gitIsDetached: isDetached,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        gitCurrentBranch: branch,
        gitIsRepo: isRepo,
        gitIsDetached: isDetached,
      })),
    };
  }),

  setPanes: (panes) => set((state) => ({
    panes,
    layoutRoot: buildWorkspaceLayout({
      panes,
      browserVisible: state.browserVisible,
      browserPane: state.browserPane,
      editorVisible: state.editorVisible,
      editorPane: state.editorPane,
      layoutRoot: state.layoutRoot,
    }),
    ...syncActiveWorkspace(state, (workspace) => ({
      ...workspace,
      panes,
      layoutRoot: buildWorkspaceLayout({
        panes,
        browserVisible: state.browserVisible,
        browserPane: state.browserPane,
        editorVisible: state.editorVisible,
        editorPane: state.editorPane,
        layoutRoot: state.layoutRoot,
      }),
    })),
  })),

  addPane: (terminalId, position) => set((state) => {
    const nextPane = createPane(terminalId, position);
    const nextPanes = [...state.panes, nextPane];
    const nextLayoutRoot = insertPaneIntoLayout(state.layoutRoot, nextPane.id, {
      panes: state.panes,
      browserPane: state.browserPane,
      browserVisible: state.browserVisible,
      editorPane: state.editorPane,
      editorVisible: state.editorVisible,
      activeTerminalId: state.activeTerminalId,
    });
    return {
      panes: nextPanes,
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        panes: nextPanes,
        layoutRoot: nextLayoutRoot,
      })),
    };
  }),

  removePane: (paneId) => set((state) => {
    const nextPanes = state.panes.filter((pane) => pane.id !== paneId);
    const nextLayoutRoot = removePaneFromLayout(state.layoutRoot, paneId);
    return {
      panes: nextPanes,
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        panes: nextPanes,
        layoutRoot: nextLayoutRoot,
      })),
    };
  }),

  updatePanePosition: (paneId, position) => set((state) => {
    const viewport = state.gridViewport;
    const nextPosition = normalizePosition(position, viewport.cols, viewport.rows);
    const nextPanes = (state.panes ?? []).map((pane) =>
      pane.id === paneId ? { ...pane, position: nextPosition } : pane
    );
    return {
      panes: nextPanes,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        panes: nextPanes,
      })),
    };
  }),

  updateAllPanePositions: (positions) => set((state) => {
    const viewport = state.gridViewport;
    const posMap = new Map(positions.map(p => [p.id, p.position]));
    const nextPanes = (state.panes ?? []).map((pane) => {
      const pos = posMap.get(pane.id);
      return pos ? { ...pane, position: normalizePosition(pos, viewport.cols, viewport.rows) } : pane;
    });
    return {
      panes: nextPanes,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        panes: nextPanes,
      })),
    };
  }),

  updateBrowserPosition: (position) => set((state) => {
    const viewport = state.gridViewport;
    const normalizedPosition = normalizePosition(position, viewport.cols, viewport.rows);
    const nextBrowserPane = state.browserPane
      ? {
          ...state.browserPane,
          position: normalizedPosition,
        }
      : createDefaultBrowserPane(generateId('browser'), normalizedPosition, state.browserUrl);
    return {
      browserPane: nextBrowserPane,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        browserPane: nextBrowserPane,
      })),
    };
  }),

  setGridViewport: (viewport) => set((state) => {
    const nextViewport = {
      cols: Math.max(1, Math.min(GRID_COLS, Math.floor(viewport.cols) || GRID_COLS)),
      rows: Math.max(1, Math.min(20, Math.floor(viewport.rows) || GRID_ROWS)),
    };

    if (
      nextViewport.cols === state.gridViewport.cols &&
      nextViewport.rows === state.gridViewport.rows
    ) {
      return state;
    }

    return {
      gridViewport: nextViewport,
    };
  }),

  resetLayout: () => set((state) => {
    const nextLayout = buildWorkspaceLayout({
      panes: state.panes,
      browserVisible: state.browserVisible,
      browserPane: state.browserPane,
      editorVisible: state.editorVisible,
      editorPane: state.editorPane,
      layoutRoot: null,
    });

    const nextState = {
      layoutRoot: nextLayout,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        layoutRoot: nextLayout,
      })),
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after resetLayout:', warnings);
      }
    }

    return nextState;
  }),

  fitAllPanes: () => set((state) => {
    const nextLayout = buildWorkspaceLayout({
      panes: state.panes,
      browserVisible: state.browserVisible,
      browserPane: state.browserPane,
      editorVisible: state.editorVisible,
      editorPane: state.editorPane,
      layoutRoot: null,
    });

    const nextState = {
      layoutRoot: nextLayout,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        layoutRoot: nextLayout,
      })),
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after fitAllPanes:', warnings);
      }
    }

    return nextState;
  }),


  swapPanes: (a, b, workspaceId) => set((state) => {
    if (a === b) return state;
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const nextLayoutRoot = swapPaneIdsInLayout(workspace.layoutRoot, a, b);


    const nextState = {
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
        ...currentWorkspace,
        layoutRoot: nextLayoutRoot,
      })),
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after swapPanes:', warnings);
      }
    }

    return nextState;
  }),

  dockPaneToEdge: (paneId, edge, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const nextLayoutRoot = dockPaneToEdgeInLayout(workspace.layoutRoot, paneId, edge);
    if (nextLayoutRoot === workspace.layoutRoot) {
      return state;
    }


    const nextState = {
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
        ...currentWorkspace,
        layoutRoot: nextLayoutRoot,
      })),
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after dockPaneToEdge:', warnings);
      }
    }

    return nextState;
  }),

  insertPaneAtEdgeGap: (paneId, edge, gapIndex, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const nextLayoutRoot = insertPaneAtEdgeGapInLayout(workspace.layoutRoot, paneId, edge, gapIndex);
    if (nextLayoutRoot === workspace.layoutRoot) {
      return state;
    }

    const nextState = {
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
        ...currentWorkspace,
        layoutRoot: nextLayoutRoot,
      })),
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after insertPaneAtEdgeGap:', warnings);
      }
    }

    return nextState;
  }),

  insertPaneAtEdgeSegment: (paneId, edge, targetPaneId, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const nextLayoutRoot = insertPaneAtEdgeSegmentInLayout(workspace.layoutRoot, paneId, edge, targetPaneId);
    if (nextLayoutRoot === workspace.layoutRoot) {
      return state;
    }

    const nextState = {
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
        ...currentWorkspace,
        layoutRoot: nextLayoutRoot,
      })),
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after insertPaneAtEdgeSegment:', warnings);
      }
    }

    return nextState;
  }),

  setSplitRatio: (nodeId, ratio, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const nextLayoutRoot = setSplitRatioInLayout(workspace.layoutRoot, nodeId, ratio);


    const nextState = {
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
        ...currentWorkspace,
        layoutRoot: nextLayoutRoot,
      })),
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after setSplitRatio:', warnings);
      }
    }
    return nextState;
  }),

  openFileInEditor: async (filePath, workspaceId) => {
    const state = useWorkspaceStore.getState();
    const scopedWorkspace = resolveWorkspaceByScope(state, workspaceId);
    if (scopedWorkspace == null) {
      return;
    }

    const scopedWorkspaceId = scopedWorkspace.id;
    const existingTab = scopedWorkspace.editorTabs.find((tab) => tab.filePath === filePath);
    if (existingTab) {
      useWorkspaceStore.setState((currentState) => ({
        ...patchWorkspaceById(currentState, scopedWorkspaceId, (workspace) => ({
          ...workspace,
          activeEditorTabId: existingTab.id,
        })),
      }));
      return;
    }

    // Deduplicate concurrent opens for the same file
    if (isEditorOperationPending(state, filePath)) {
      return;
    }

    useWorkspaceStore.setState({ pendingEditorOperations: setEditorOperationPending(state, filePath, 'open') });

    try {
      const readResult = await window.electronAPI.editorReadFile({
        workspacePath: scopedWorkspace.workspacePath,
        filePath,
      });

      if (!readResult.success) {
        console.warn('Failed to read file for editor:', readResult.errorCode);
        return;
      }

      const fileName = filePath.split('/').pop() ?? filePath;
      const newTab: EditorTab = {
        id: generateId('editor-tab'),
        filePath,
        fileName,
        isDirty: false,
        content: readResult.content ?? '',
        originalContent: readResult.content ?? '',
      };

      useWorkspaceStore.setState((currentState) => {
        const latestWorkspace = resolveWorkspaceByScope(currentState, scopedWorkspaceId);
        if (latestWorkspace == null) {
          return {};
        }

        const latestExistingTab = latestWorkspace.editorTabs.find((tab) => tab.filePath === filePath);
        if (latestExistingTab) {
          return {
            ...patchWorkspaceById(currentState, scopedWorkspaceId, (workspace) => ({
              ...workspace,
              activeEditorTabId: latestExistingTab.id,
            })),
          };
        }

        const nextEditorPane = latestWorkspace.editorPane ?? {
          id: generateId('editor'),
        };
        const editorLeafExists = collectLeafPaneIds(latestWorkspace.layoutRoot).includes(nextEditorPane.id);
        const shouldInsertEditorPane = !latestWorkspace.editorVisible || !editorLeafExists;
        const nextLayoutRoot = shouldInsertEditorPane
          ? insertPaneIntoLayout(latestWorkspace.layoutRoot, nextEditorPane.id, {
              panes: latestWorkspace.panes,
              browserPane: latestWorkspace.browserPane,
              browserVisible: latestWorkspace.browserVisible,
              editorPane: nextEditorPane,
              editorVisible: true,
              activeTerminalId: latestWorkspace.activeTerminalId,
            })
          : latestWorkspace.layoutRoot;

        const nextEditorTabs = [...latestWorkspace.editorTabs, newTab];
        const nextLayoutRevision = nextLayoutRoot === latestWorkspace.layoutRoot
          ? currentState.layoutRevision
          : currentState.layoutRevision + 1;

        return {
          layoutRevision: nextLayoutRevision,
          ...patchWorkspaceById(currentState, scopedWorkspaceId, (workspace) => ({
            ...workspace,
            editorPane: nextEditorPane,
            editorVisible: true,
            editorTabs: nextEditorTabs,
            activeEditorTabId: newTab.id,
            layoutRoot: nextLayoutRoot,
          })),
        };
      });

    } finally {
      useWorkspaceStore.setState((currentState) => ({
        pendingEditorOperations: clearEditorOperationPending(currentState, filePath),
      }));
    }
  },

  closeEditorTab: (tabId, workspaceId) => {
    const stateBefore = useWorkspaceStore.getState();
    const scopedWorkspace = resolveWorkspaceByScope(stateBefore, workspaceId);
    if (scopedWorkspace == null) {
      return;
    }

    set((state) => {
    const workspace = resolveWorkspaceByScope(state, scopedWorkspace.id);
    if (workspace == null) return state;

    const { editorTabs, activeEditorTabId } = workspace;
    const tabIndex = editorTabs.findIndex((t) => t.id === tabId);
    if (tabIndex === -1) return state;

    const nextTabs = editorTabs.filter((t) => t.id !== tabId);
    let nextActiveId: string | null = null;
    if (activeEditorTabId === tabId) {
      if (nextTabs.length === 0) {
        nextActiveId = null;
      } else if (tabIndex > 0) {
        nextActiveId = nextTabs[tabIndex - 1].id;
      } else {
        nextActiveId = nextTabs[0].id;
      }
    } else {
      nextActiveId = activeEditorTabId;
    }

    const nextEditorVisible = nextTabs.length > 0 ? workspace.editorVisible : false;
    const nextEditorPane = nextTabs.length > 0 ? workspace.editorPane : null;
    const nextLayoutRoot = nextTabs.length === 0 && workspace.editorPane
      ? removePaneFromLayout(workspace.layoutRoot, workspace.editorPane.id)
      : workspace.layoutRoot;
    const nextLayoutRevision = nextLayoutRoot === workspace.layoutRoot
      ? state.layoutRevision
      : state.layoutRevision + 1;

    const nextState = {
      layoutRevision: nextLayoutRevision,
      ...patchWorkspaceById(state, scopedWorkspace.id, (currentWorkspace) => ({
        ...currentWorkspace,
        editorTabs: nextTabs,
        activeEditorTabId: nextActiveId,
        editorVisible: nextEditorVisible,
        editorPane: nextEditorPane,
        layoutRoot: nextLayoutRoot,
      })),
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after closeEditorTab:', warnings);
      }
    }

    return nextState;
  });
  },

  setActiveEditorTab: (tabId, workspaceId) => set((state) => {
    const scopedWorkspaceId = resolveWorkspaceIdByScope(state, workspaceId);
    if (scopedWorkspaceId == null) {
      return state;
    }

    const nextState = {
      ...patchWorkspaceById(state, scopedWorkspaceId, (workspace) => ({
        ...workspace,
        activeEditorTabId: tabId,
      })),
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after setActiveEditorTab:', warnings);
      }
    }

    return nextState;
  }),

  updateEditorContent: (tabId, content, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const nextTabs = workspace.editorTabs.map((tab) =>
      tab.id === tabId
        ? { ...tab, content, isDirty: content !== tab.originalContent }
        : tab
    );

    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      editorTabs: nextTabs,
    }));
  }),

  saveEditorFile: async (tabId, workspaceId) => {
    const stateBeforeSave = useWorkspaceStore.getState();
    const scopedWorkspace = resolveWorkspaceByScope(stateBeforeSave, workspaceId);
    const tab = scopedWorkspace?.editorTabs.find((t) => t.id === tabId);
    if (!tab || scopedWorkspace == null) return false;

    // Deduplicate concurrent saves for the same file
    if (isEditorOperationPending(stateBeforeSave, tab.filePath)) {
      return true;
    }

    const contentToSave = preserveOriginalLineEndings(tab.content, tab.originalContent);
    useWorkspaceStore.setState({ pendingEditorOperations: setEditorOperationPending(stateBeforeSave, tab.filePath, 'save') });

    try {
      const result = await window.electronAPI.editorWriteFile({
        workspacePath: scopedWorkspace.workspacePath,
        filePath: tab.filePath,
        content: contentToSave,
      });

      if (!result.success) {
        console.warn('Failed to write file:', result.errorCode);
        return false;
      }

      useWorkspaceStore.setState((latestState) => {
        const latestWorkspace = resolveWorkspaceByScope(latestState, scopedWorkspace.id);
        const latestTab = latestWorkspace?.editorTabs.find((t) => t.id === tabId);
        if (!latestWorkspace || !latestTab || latestTab.content !== contentToSave) {
          return {};
        }

        const nextTabs = latestWorkspace.editorTabs.map((currentTab) =>
          currentTab.id === tabId
            ? {
                ...currentTab,
                originalContent: contentToSave,
                isDirty: false,
                hasExternalChange: false,
                isDeleted: false,
              }
            : currentTab
        );

        return {
          ...patchWorkspaceById(latestState, scopedWorkspace.id, (workspace) => ({
            ...workspace,
            editorTabs: nextTabs,
          })),
        };
      });
      return true;
    } finally {
      useWorkspaceStore.setState((currentState) => ({
        pendingEditorOperations: clearEditorOperationPending(currentState, tab.filePath),
      }));
    }
  },

  saveAllEditorFiles: async () => {
    const state = useWorkspaceStore.getState();
    const dirtyTabs = state.editorTabs.filter((t) => t.isDirty);
    for (const tab of dirtyTabs) {
      await useWorkspaceStore.getState().saveEditorFile(tab.id);
    }
  },

  toggleEditorPane: () => set((state) => {
    const nextEditorVisible = !state.editorVisible;
    let nextEditorPane = state.editorPane;

    if (nextEditorVisible && nextEditorPane === null) {
      nextEditorPane = {
        id: generateId('editor'),
      };
    }

    let nextLayoutRoot = state.layoutRoot;
    if (nextEditorVisible && nextEditorPane) {
      const editorId = nextEditorPane.id;
      if (!state.editorVisible) {
        nextLayoutRoot = insertPaneIntoLayout(state.layoutRoot, editorId, {
          panes: state.panes,
          browserPane: state.browserPane,
          browserVisible: state.browserVisible,
          editorPane: nextEditorPane,
          editorVisible: true,
          activeTerminalId: state.activeTerminalId,
        });
      }
    } else if (!nextEditorVisible && state.editorPane) {
      nextLayoutRoot = removePaneFromLayout(state.layoutRoot, state.editorPane.id);
    }

    const nextState = {
      editorVisible: nextEditorVisible,
      editorPane: nextEditorPane,
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        editorVisible: nextEditorVisible,
        editorPane: nextEditorPane,
        layoutRoot: nextLayoutRoot,
      })),
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after toggleEditorPane:', warnings);
      }
    }
    return nextState;
  }),
  closeEditorPane: (workspaceId) => {
    return set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace?.editorPane) {
      const nextLayoutRoot = removePaneFromLayout(workspace.layoutRoot, workspace.editorPane.id);
      const nextState = {
        layoutRevision: state.layoutRevision + 1,
        ...patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
          ...currentWorkspace,
          editorVisible: false,
          editorPane: null,
          editorTabs: [],
          activeEditorTabId: null,
          layoutRoot: nextLayoutRoot,
        })),
      };
      if (import.meta.env.DEV) {
        const warnings = validateWorkspaceConsistency(nextState);
        if (warnings.length > 0) {
          console.warn('[Dev Only] Workspace consistency violation after closeEditorPane:', warnings);
        }
      }
      return nextState;
    }
    return state;
    });
  },

  resetEditorState: () => {
    const nextState = set((state) => ({
      ...createDefaultEditorState(),
      pendingEditorOperations: {},
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        ...createDefaultEditorState(),
      })),
    }));
    if (import.meta.env.DEV && nextState) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after resetEditorState:', warnings);
      }
    }
    return nextState;
  },

  renameEditorTabPath: (oldPath, newPath, workspaceId) => {
    if (oldPath === newPath) return;

    const stateBefore = useWorkspaceStore.getState();
    const scopedWorkspace = resolveWorkspaceByScope(stateBefore, workspaceId);
    if (scopedWorkspace == null) {
      return;
    }

    set((state) => {
      const newFileName = newPath.split('/').pop() ?? newPath;
      const workspace = resolveWorkspaceByScope(state, scopedWorkspace.id);
      if (workspace == null) {
        return state;
      }

      const nextTabs = workspace.editorTabs.map((tab) =>
        tab.filePath === oldPath
          ? { ...tab, filePath: newPath, fileName: newFileName }
          : tab
      );

      return patchWorkspaceById(state, scopedWorkspace.id, (currentWorkspace) => ({
        ...currentWorkspace,
        editorTabs: nextTabs,
      }));
    });
  },

  reloadEditorTab: async (tabId, workspaceId) => {
    const state = useWorkspaceStore.getState();
    const scopedWorkspace = resolveWorkspaceByScope(state, workspaceId);
    const tab = scopedWorkspace?.editorTabs.find((t) => t.id === tabId);
    if (!tab || scopedWorkspace == null) return;

    // Skip reload if a save is in flight for this file — save takes priority
    if (isEditorOperationPending(state, tab.filePath)) {
      return;
    }

    useWorkspaceStore.setState({ pendingEditorOperations: setEditorOperationPending(state, tab.filePath, 'reload') });

    try {
      const result = await window.electronAPI.editorReadFile({
        workspacePath: scopedWorkspace.workspacePath,
        filePath: tab.filePath,
      });

      if (!result.success) {
        useWorkspaceStore.setState((currentState) => {
          const workspace = resolveWorkspaceByScope(currentState, scopedWorkspace.id);
          if (workspace == null) {
            return {};
          }

          const nextTabs = workspace.editorTabs.map((t) =>
            t.id === tabId ? { ...t, isDeleted: true, hasExternalChange: false } : t
          );
          return patchWorkspaceById(currentState, scopedWorkspace.id, (currentWorkspace) => ({
            ...currentWorkspace,
            editorTabs: nextTabs,
          }));
        });
        return;
      }

      useWorkspaceStore.setState((currentState) => {
        const workspace = resolveWorkspaceByScope(currentState, scopedWorkspace.id);
        if (workspace == null) {
          return {};
        }

        const nextTabs = workspace.editorTabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                content: result.content ?? '',
                originalContent: result.content ?? '',
                isDirty: false,
                hasExternalChange: false,
                isDeleted: false,
              }
            : t
        );
        return patchWorkspaceById(currentState, scopedWorkspace.id, (currentWorkspace) => ({
          ...currentWorkspace,
          editorTabs: nextTabs,
        }));
      });
    } finally {
      useWorkspaceStore.setState((currentState) => ({
        pendingEditorOperations: clearEditorOperationPending(currentState, tab.filePath),
      }));
    }
  },

  markEditorTabExternallyChanged: (tabId, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const nextTabs = workspace.editorTabs.map((t) =>
      t.id === tabId ? { ...t, hasExternalChange: true } : t
    );
    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      editorTabs: nextTabs,
    }));
  }),

  markEditorTabDeleted: (tabId, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const nextTabs = workspace.editorTabs.map((t) =>
      t.id === tabId ? { ...t, isDeleted: true, hasExternalChange: false } : t
    );
    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      editorTabs: nextTabs,
    }));
  }),

  clearEditorTabExternalFlag: (tabId, workspaceId) => set((state) => {
    const workspace = resolveWorkspaceByScope(state, workspaceId);
    if (workspace == null) {
      return state;
    }

    const nextTabs = workspace.editorTabs.map((t) =>
      t.id === tabId ? { ...t, hasExternalChange: false, isDeleted: false } : t
    );
    return patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      editorTabs: nextTabs,
    }));
  }),
}));
