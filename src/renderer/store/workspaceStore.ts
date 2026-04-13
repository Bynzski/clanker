import { create } from 'zustand';
import {
  buildWorkspaceLayout,
  collectLeafPaneIds,
  dockPaneToEdgeInLayout,
  findFirstLeafPaneId,
  GRID_COLS,
  GRID_ROWS,
  hasUnlockedLeaf,
  insertPaneIntoLayout,
  normalizeLayoutRoot,
  normalizePosition,
  removePaneFromLayout,
  setSplitRatioInLayout,
  swapPaneIdsInLayout,
} from './workspaceLayout';
import type {
  BrowserPaneState,
  EditorTab,
  LayoutNode,
  Pane,
  Terminal,
  WorkspaceTab,
} from './workspaceTypes';
import type { WorkspaceState } from './workspaceStoreTypes';
import {
  areGitStatusListsEqual,
  assignWorkspaceLifecycles,
  clearEditorOperationPending,
  createDefaultEditorState,
  createDefaultExplorerState,
  createPane,
  createWorkspaceId,
  generateId,
  getActiveWorkspaceSnapshot,
  getWorkspaceNameFromPath,
  isEditorOperationPending,
  patchWorkspaceById,
  sanitizeWorkspace,
  setEditorOperationPending,
  syncActiveWorkspace,
  validateWorkspaceConsistency,
} from './workspaceStoreHelpers';

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

  selectWorkspace: (id) => set((state) => {
    const workspace = state.workspaces.find((entry) => entry.id === id);
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

    if (!paneExists && nextLayoutRoot === state.layoutRoot) {
      console.warn('All panes are locked. Cannot add a new terminal pane.');
    }

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
      ? state.browserPane ?? {
          id: generateId('browser'),
          locked: false,
          position: { x: 0, y: 0, w: 6, h: 6 },
        }
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
            if (state.layoutRoot != null && !hasUnlockedLeaf(state.layoutRoot, state)) {
              console.warn('All panes are locked. Cannot add the browser pane.');
              return state;
            }
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
      browserPane: nextBrowserPane ? { ...nextBrowserPane, locked: nextBrowserPane.locked ?? false } : nextBrowserPane,
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        browserVisible: nextBrowserVisible,
        browserPane: nextBrowserPane ? { ...nextBrowserPane, locked: nextBrowserPane.locked ?? false } : nextBrowserPane,
        layoutRoot: nextLayoutRoot,
      })),
    };
  }),

  pushBrowserOverlay: () => set((state) => ({
    browserOverlayCount: state.browserOverlayCount + 1,
  })),

  popBrowserOverlay: () => set((state) => ({
    browserOverlayCount: Math.max(0, state.browserOverlayCount - 1),
  })),

  setBrowserUrl: (url) => set((state) => ({
    browserUrl: url,
    ...syncActiveWorkspace(state, (workspace) => ({
      ...workspace,
      browserUrl: url,
    })),
  })),

  updateWorkspaceBrowserUrl: (workspaceId, url) => set((state) => (
    patchWorkspaceById(state, workspaceId, (workspace) => ({
      ...workspace,
      browserUrl: url,
    }))
  )),

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

  setExplorerVisible: (visible) => set((state) => ({
    explorerVisible: visible,
    ...syncActiveWorkspace(state, (workspace) => ({
      ...workspace,
      explorerVisible: visible,
    })),
  })),

  setExplorerSidebarWidth: (width) => set((state) => ({
    explorerSidebarWidth: width,
    ...syncActiveWorkspace(state, (workspace) => ({
      ...workspace,
      explorerSidebarWidth: width,
    })),
  })),

  toggleExplorerPath: (path) => set((state) => {
    const explorerExpandedPaths = state.explorerExpandedPaths.includes(path)
      ? state.explorerExpandedPaths.filter((entry) => entry !== path)
      : [...state.explorerExpandedPaths, path];

    return {
      explorerExpandedPaths,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        explorerExpandedPaths,
      })),
    };
  }),

  setExplorerExpandedPaths: (paths) => set((state) => ({
    explorerExpandedPaths: paths,
    ...syncActiveWorkspace(state, (workspace) => ({
      ...workspace,
      explorerExpandedPaths: paths,
    })),
  })),

  clearExplorerDirectoryState: (paths) => set((state) => {
    if (paths.length === 0) {
      return state;
    }

    const pathSet = new Set(paths);
    const explorerEntriesByPath = { ...state.explorerEntriesByPath };
    const explorerErrorsByPath = { ...state.explorerErrorsByPath };
    for (const path of pathSet) {
      delete explorerEntriesByPath[path];
      delete explorerErrorsByPath[path];
    }

    const explorerLoadingPaths = state.explorerLoadingPaths.filter((path) => !pathSet.has(path));

    return {
      explorerEntriesByPath,
      explorerErrorsByPath,
      explorerLoadingPaths,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        explorerEntriesByPath,
        explorerErrorsByPath,
        explorerLoadingPaths,
      })),
    };
  }),

  setExplorerSelectedPath: (path) => set((state) => ({
    explorerSelectedPath: path,
    ...syncActiveWorkspace(state, (workspace) => ({
      ...workspace,
      explorerSelectedPath: path,
    })),
  })),

  setExplorerDirectoryEntries: (directoryPath, entries) => set((state) => {
    const explorerEntriesByPath = {
      ...state.explorerEntriesByPath,
      [directoryPath]: entries,
    };
    const explorerErrorsByPath = {
      ...state.explorerErrorsByPath,
      [directoryPath]: null,
    };

    return {
      explorerEntriesByPath,
      explorerErrorsByPath,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        explorerEntriesByPath,
        explorerErrorsByPath,
      })),
    };
  }),

  setExplorerDirectoryLoading: (directoryPath, loading) => set((state) => {
    const explorerLoadingPaths = loading
      ? state.explorerLoadingPaths.includes(directoryPath)
        ? state.explorerLoadingPaths
        : [...state.explorerLoadingPaths, directoryPath]
      : state.explorerLoadingPaths.filter((entry) => entry !== directoryPath);

    return {
      explorerLoadingPaths,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        explorerLoadingPaths,
      })),
    };
  }),

  setExplorerDirectoryError: (directoryPath, error) => set((state) => {
    const explorerErrorsByPath = {
      ...state.explorerErrorsByPath,
      [directoryPath]: error,
    };

    return {
      explorerErrorsByPath,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        explorerErrorsByPath,
      })),
    };
  }),

  resetExplorerState: () => set((state) => ({
    ...createDefaultExplorerState(),
    ...syncActiveWorkspace(state, (workspace) => ({
      ...workspace,
      ...createDefaultExplorerState(),
    })),
  })),

  setShowHiddenFiles: (show) => set((state) => {
    if (state.showHiddenFiles === show) {
      return state;
    }

    return {
      showHiddenFiles: show,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        showHiddenFiles: show,
      })),
    };
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
    const nextBrowserPane = state.browserPane
      ? {
          ...state.browserPane,
          locked: state.browserPane.locked ?? false,
          position: normalizePosition(position, viewport.cols, viewport.rows),
        }
      : {
          id: generateId('browser'),
          locked: false,
          position: normalizePosition(position, viewport.cols, viewport.rows),
        };
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


  bringPaneIntoView: (paneId) => set((state) => {
    const firstPaneId = findFirstLeafPaneId(state.layoutRoot);
    if (firstPaneId == null || firstPaneId === paneId) {
      return state;
    }

    const nextLayoutRoot = swapPaneIdsInLayout(state.layoutRoot, firstPaneId, paneId);

    const nextState = {
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        layoutRoot: nextLayoutRoot,
      })),
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after bringPaneIntoView:', warnings);
      }
    }

    return nextState;
  }),

  bringBrowserIntoView: () => set((state) => {
    if (!state.browserPane || !state.browserVisible) {
      return state;
    }

    const firstPaneId = findFirstLeafPaneId(state.layoutRoot);
    if (firstPaneId == null || firstPaneId === state.browserPane.id) {
      return state;
    }

    const nextLayoutRoot = swapPaneIdsInLayout(state.layoutRoot, firstPaneId, state.browserPane.id);

    const nextState = {
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        layoutRoot: nextLayoutRoot,
      })),
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after bringBrowserIntoView:', warnings);
      }
    }

    return nextState;
  }),

  togglePaneLock: (paneId) => set((state) => {
    const nextPanes = (state.panes ?? []).map((pane) => (
      pane.id === paneId
        ? { ...pane, locked: !(pane.locked ?? false) }
        : pane
    ));

    return {
      panes: nextPanes,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        panes: nextPanes,
      })),
    };
  }),

  toggleBrowserLock: () => set((state) => {
    if (!state.browserPane) {
      return state;
    }

    const nextBrowserPane = {
      ...state.browserPane,
      locked: !state.browserPane.locked,
    };

    return {
      browserPane: nextBrowserPane,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        browserPane: nextBrowserPane,
      })),
    };
  }),

  swapPanes: (a, b) => set((state) => {
    if (a === b) return state;
    const nextLayoutRoot = swapPaneIdsInLayout(state.layoutRoot, a, b);


    const nextState = {
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
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

  dockPaneToEdge: (paneId, edge) => set((state) => {
    const nextLayoutRoot = dockPaneToEdgeInLayout(state.layoutRoot, paneId, edge);
    if (nextLayoutRoot === state.layoutRoot) {
      return state;
    }


    const nextState = {
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
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

  setSplitRatio: (nodeId, ratio) => set((state) => {
    const nextLayoutRoot = setSplitRatioInLayout(state.layoutRoot, nodeId, ratio);


    const nextState = {
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
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

  canAddPane: (): boolean => {
    const state = get();
    return hasUnlockedLeaf(state.layoutRoot, state) || state.layoutRoot == null;
  },

  openFileInEditor: async (filePath) => {
    const state = useWorkspaceStore.getState();
    const existingTab = state.editorTabs.find((tab) => tab.filePath === filePath);
    if (existingTab) {
      useWorkspaceStore.setState((currentState) => ({
        activeEditorTabId: existingTab.id,
        ...syncActiveWorkspace(currentState, (workspace) => ({
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
        workspacePath: state.workspacePath,
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
        const latestExistingTab = currentState.editorTabs.find((tab) => tab.filePath === filePath);
        if (latestExistingTab) {
          return {
            activeEditorTabId: latestExistingTab.id,
            ...syncActiveWorkspace(currentState, (workspace) => ({
              ...workspace,
              activeEditorTabId: latestExistingTab.id,
            })),
          };
        }

        const nextEditorPane = currentState.editorPane ?? {
          id: generateId('editor'),
          locked: false,
        };
        const editorLeafExists = collectLeafPaneIds(currentState.layoutRoot).includes(nextEditorPane.id);
        const shouldInsertEditorPane = !currentState.editorVisible || !editorLeafExists;
        const nextLayoutRoot = shouldInsertEditorPane
          ? insertPaneIntoLayout(currentState.layoutRoot, nextEditorPane.id, {
              panes: currentState.panes,
              browserPane: currentState.browserPane,
              browserVisible: currentState.browserVisible,
              editorPane: nextEditorPane,
              editorVisible: true,
              activeTerminalId: currentState.activeTerminalId,
            })
          : currentState.layoutRoot;

        const nextEditorTabs = [...currentState.editorTabs, newTab];
        const nextLayoutRevision = nextLayoutRoot === currentState.layoutRoot
          ? currentState.layoutRevision
          : currentState.layoutRevision + 1;

        return {
          editorPane: nextEditorPane,
          editorVisible: true,
          editorTabs: nextEditorTabs,
          activeEditorTabId: newTab.id,
          layoutRoot: nextLayoutRoot,
          layoutRevision: nextLayoutRevision,
          ...syncActiveWorkspace(currentState, (workspace) => ({
            ...workspace,
            editorPane: nextEditorPane,
            editorVisible: true,
            editorTabs: nextEditorTabs,
            activeEditorTabId: newTab.id,
            layoutRoot: nextLayoutRoot,
          })),
        };
      });

      // The tab was new (existingTab was null), so start watching
      if (!existingTab) {
        void window.electronAPI.editorWatchFile({ workspacePath: useWorkspaceStore.getState().workspacePath, filePath });
      }
    } finally {
      useWorkspaceStore.setState((currentState) => ({
        pendingEditorOperations: clearEditorOperationPending(currentState, filePath),
      }));
    }
  },

  closeEditorTab: (tabId) => {
    const stateBefore = useWorkspaceStore.getState();
    const closedTab = stateBefore.editorTabs.find((t) => t.id === tabId);

    set((state) => {
    const { editorTabs, activeEditorTabId } = state;
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

    const nextEditorVisible = nextTabs.length > 0 ? state.editorVisible : false;
    const nextEditorPane = nextTabs.length > 0 ? state.editorPane : null;
    const nextLayoutRoot = nextTabs.length === 0 && state.editorPane
      ? removePaneFromLayout(state.layoutRoot, state.editorPane.id)
      : state.layoutRoot;
    const nextLayoutRevision = nextLayoutRoot === state.layoutRoot
      ? state.layoutRevision
      : state.layoutRevision + 1;

    const nextState = {
      editorTabs: nextTabs,
      activeEditorTabId: nextActiveId,
      editorVisible: nextEditorVisible,
      editorPane: nextEditorPane,
      layoutRoot: nextLayoutRoot,
      layoutRevision: nextLayoutRevision,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
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

    // Unwatch file if no other open tab references it
    if (closedTab) {
      const latestState = useWorkspaceStore.getState();
      const otherTab = latestState.editorTabs.find((t) => t.filePath === closedTab.filePath);
      if (!otherTab) {
        void window.electronAPI.editorUnwatchFile({ workspacePath: latestState.workspacePath, filePath: closedTab.filePath });
      }
    }
  },

  setActiveEditorTab: (tabId) => set((state) => {
    const nextState = {
      activeEditorTabId: tabId,
      ...syncActiveWorkspace(state, (workspace) => ({
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

  updateEditorContent: (tabId, content) => set((state) => {
    const nextTabs = state.editorTabs.map((tab) =>
      tab.id === tabId
        ? { ...tab, content, isDirty: content !== tab.originalContent }
        : tab
    );

    return {
      editorTabs: nextTabs,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        editorTabs: nextTabs,
      })),
    };
  }),

  saveEditorFile: async (tabId) => {
    const stateBeforeSave = useWorkspaceStore.getState();
    const tab = stateBeforeSave.editorTabs.find((t) => t.id === tabId);
    if (!tab) return false;

    // Deduplicate concurrent saves for the same file
    if (isEditorOperationPending(stateBeforeSave, tab.filePath)) {
      return true;
    }

    const contentToSave = tab.content;
    const wasDeleted = tab.isDeleted;

    useWorkspaceStore.setState({ pendingEditorOperations: setEditorOperationPending(stateBeforeSave, tab.filePath, 'save') });

    try {
      const result = await window.electronAPI.editorWriteFile({
        workspacePath: stateBeforeSave.workspacePath,
        filePath: tab.filePath,
        content: contentToSave,
      });

      if (!result.success) {
        console.warn('Failed to write file:', result.errorCode);
        return false;
      }

      useWorkspaceStore.setState((latestState) => {
        const latestTab = latestState.editorTabs.find((t) => t.id === tabId);
        if (!latestTab || latestTab.content !== contentToSave) {
          return {};
        }

        const nextTabs = latestState.editorTabs.map((currentTab) =>
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
          editorTabs: nextTabs,
          ...syncActiveWorkspace(latestState, (workspace) => ({
            ...workspace,
            editorTabs: nextTabs,
          })),
        };
      });

      if (wasDeleted && typeof window !== 'undefined' && window.electronAPI) {
        // If the file was previously deleted, the main-process fs.watch may have closed.
        // Re-register the watch so external change detection resumes immediately.
        void window.electronAPI.editorWatchFile({ workspacePath: stateBeforeSave.workspacePath, filePath: tab.filePath });
      }

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
        locked: false,
      };
    }

    let nextLayoutRoot = state.layoutRoot;
    if (nextEditorVisible && nextEditorPane) {
      const editorId = nextEditorPane.id;
      if (!state.editorVisible) {
        if (state.layoutRoot != null && !hasUnlockedLeaf(state.layoutRoot, state)) {
          console.warn('All panes are locked. Cannot add the editor pane.');
          return state;
        }
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
  closeEditorPane: () => {
    const currentState = useWorkspaceStore.getState();
    for (const tab of currentState.editorTabs) {
      void window.electronAPI.editorUnwatchFile({ workspacePath: currentState.workspacePath, filePath: tab.filePath });
    }
    return set((state) => {
    if (state.editorPane) {
      const nextLayoutRoot = removePaneFromLayout(state.layoutRoot, state.editorPane.id);
      const nextState = {
        editorVisible: false,
        editorPane: null,
        editorTabs: [],
        activeEditorTabId: null,
        layoutRoot: nextLayoutRoot,
        layoutRevision: state.layoutRevision + 1,
        ...syncActiveWorkspace(state, (workspace) => ({
          ...workspace,
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

  toggleEditorLock: () => set((state) => {
    if (!state.editorPane) {
      return state;
    }

    const nextEditorPane = {
      ...state.editorPane,
      locked: !state.editorPane.locked,
    };

    return {
      editorPane: nextEditorPane,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        editorPane: nextEditorPane,
      })),
    };
  }),

  bringEditorIntoView: () => set((state) => {
    if (!state.editorPane || !state.editorVisible) {
      return state;
    }

    const firstPaneId = findFirstLeafPaneId(state.layoutRoot);
    if (firstPaneId == null || firstPaneId === state.editorPane.id) {
      return state;
    }

    const nextLayoutRoot = swapPaneIdsInLayout(state.layoutRoot, firstPaneId, state.editorPane.id);

    const nextState = {
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        layoutRoot: nextLayoutRoot,
      })),
    };
    if (import.meta.env.DEV) {
      const warnings = validateWorkspaceConsistency(nextState);
      if (warnings.length > 0) {
        console.warn('[Dev Only] Workspace consistency violation after bringEditorIntoView:', warnings);
      }
    }

    return nextState;
  }),
  resetEditorState: () => {
    const currentState = useWorkspaceStore.getState();
    for (const tab of currentState.editorTabs) {
      void window.electronAPI.editorUnwatchFile({ workspacePath: currentState.workspacePath, filePath: tab.filePath });
    }
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

  renameEditorTabPath: (oldPath, newPath) => {
    if (oldPath === newPath) return;

    const stateBefore = useWorkspaceStore.getState();
    const oldCountBefore = stateBefore.editorTabs.filter((t) => t.filePath === oldPath).length;
    const newCountBefore = stateBefore.editorTabs.filter((t) => t.filePath === newPath).length;

    set((state) => {
      const newFileName = newPath.split('/').pop() ?? newPath;
      const nextTabs = state.editorTabs.map((tab) =>
        tab.filePath === oldPath
          ? { ...tab, filePath: newPath, fileName: newFileName }
          : tab
      );

      return {
        editorTabs: nextTabs,
        ...syncActiveWorkspace(state, (workspace) => ({
          ...workspace,
          editorTabs: nextTabs,
        })),
      };
    });

    const stateAfter = useWorkspaceStore.getState();
    const oldCountAfter = stateAfter.editorTabs.filter((t) => t.filePath === oldPath).length;
    const newCountAfter = stateAfter.editorTabs.filter((t) => t.filePath === newPath).length;

    if (oldCountBefore > 0 && oldCountAfter === 0) {
      if (typeof window !== 'undefined' && window.electronAPI) {
        void window.electronAPI.editorUnwatchFile({ workspacePath: stateAfter.workspacePath, filePath: oldPath });
      }
    }
    if (newCountBefore === 0 && newCountAfter > 0) {
      if (typeof window !== 'undefined' && window.electronAPI) {
        void window.electronAPI.editorWatchFile({ workspacePath: stateAfter.workspacePath, filePath: newPath });
      }
    }
  },

  reloadEditorTab: async (tabId) => {
    const state = useWorkspaceStore.getState();
    const tab = state.editorTabs.find((t) => t.id === tabId);
    if (!tab) return;

    // Skip reload if a save is in flight for this file — save takes priority
    if (isEditorOperationPending(state, tab.filePath)) {
      return;
    }

    useWorkspaceStore.setState({ pendingEditorOperations: setEditorOperationPending(state, tab.filePath, 'reload') });

    try {
      const result = await window.electronAPI.editorReadFile({
        workspacePath: state.workspacePath,
        filePath: tab.filePath,
      });

      if (!result.success) {
        useWorkspaceStore.setState((currentState) => {
          const nextTabs = currentState.editorTabs.map((t) =>
            t.id === tabId ? { ...t, isDeleted: true, hasExternalChange: false } : t
          );
          return {
            editorTabs: nextTabs,
            ...syncActiveWorkspace(currentState, (workspace) => ({
              ...workspace,
              editorTabs: nextTabs,
            })),
          };
        });
        return;
      }

      useWorkspaceStore.setState((currentState) => {
        const nextTabs = currentState.editorTabs.map((t) =>
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
        return {
          editorTabs: nextTabs,
          ...syncActiveWorkspace(currentState, (workspace) => ({
            ...workspace,
            editorTabs: nextTabs,
          })),
        };
      });
    } finally {
      useWorkspaceStore.setState((currentState) => ({
        pendingEditorOperations: clearEditorOperationPending(currentState, tab.filePath),
      }));
    }
  },

  markEditorTabExternallyChanged: (tabId) => set((state) => {
    const nextTabs = state.editorTabs.map((t) =>
      t.id === tabId ? { ...t, hasExternalChange: true } : t
    );
    return {
      editorTabs: nextTabs,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        editorTabs: nextTabs,
      })),
    };
  }),

  markEditorTabDeleted: (tabId) => set((state) => {
    const nextTabs = state.editorTabs.map((t) =>
      t.id === tabId ? { ...t, isDeleted: true, hasExternalChange: false } : t
    );
    return {
      editorTabs: nextTabs,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        editorTabs: nextTabs,
      })),
    };
  }),

  clearEditorTabExternalFlag: (tabId) => set((state) => {
    const nextTabs = state.editorTabs.map((t) =>
      t.id === tabId ? { ...t, hasExternalChange: false, isDeleted: false } : t
    );
    return {
      editorTabs: nextTabs,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        editorTabs: nextTabs,
      })),
    };
  }),
}));
