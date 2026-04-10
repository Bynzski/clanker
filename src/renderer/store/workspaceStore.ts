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
  EditorPaneState,
  EditorTab,
  GridViewport,
  LayoutNode,
  Pane,
  PanePosition,
  Terminal,
  WorkspaceTab,
} from './workspaceTypes';
import type { GitStatus } from '../components/git/types';
import type { FileExplorerEntry } from '../../shared/types/fileExplorer';

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

interface WorkspaceState {
  name: string;
  workspacePath: string;
  harness: string;
  model: string;
  terminals: Terminal[];
  panes: Pane[];
  browserVisible: boolean;
  browserOverlayCount: number;
  browserUrl: string;
  activeTerminalId: string | null;
  browserPane: BrowserPaneState | null;
  layoutRoot: LayoutNode | null;
  explorerVisible: boolean;
  explorerSidebarWidth: number;
  explorerExpandedPaths: string[];
  explorerSelectedPath: string | null;
  explorerEntriesByPath: Record<string, FileExplorerEntry[] | undefined>;
  explorerLoadingPaths: string[];
  explorerErrorsByPath: Record<string, string | null | undefined>;
  showHiddenFiles: boolean;
  gitChanges: GitStatus[];
  workspaces: WorkspaceTab[];
  activeWorkspaceId: string | null;
  gridViewport: GridViewport;
  layoutRevision: number;

  editorVisible: boolean;
  editorPane: EditorPaneState | null;
  editorTabs: EditorTab[];
  activeEditorTabId: string | null;

  addWorkspace: (workspace: Omit<WorkspaceTab, 'id'>) => void;
  selectWorkspace: (id: string) => void;
  closeWorkspace: (id: string) => void;
  updateWorkspaceName: (id: string, name: string) => void;

  setWorkspacePath: (path: string) => void;
  setHarness: (harness: string) => void;
  setModel: (model: string) => void;
  addTerminal: (terminal: Terminal) => void;
  removeTerminal: (id: string) => void;
  setActiveTerminal: (id: string) => void;
  toggleBrowser: () => void;
  pushBrowserOverlay: () => void;
  popBrowserOverlay: () => void;
  setBrowserUrl: (url: string) => void;
  updateWorkspaceBrowserUrl: (workspaceId: string, url: string) => void;
  clearTerminals: () => void;
  setExplorerVisible: (visible: boolean) => void;
  setExplorerSidebarWidth: (width: number) => void;
  toggleExplorerPath: (path: string) => void;
  setExplorerExpandedPaths: (paths: string[]) => void;
  clearExplorerDirectoryState: (paths: string[]) => void;
  setExplorerSelectedPath: (path: string | null) => void;
  setExplorerDirectoryEntries: (directoryPath: string, entries: FileExplorerEntry[]) => void;
  setExplorerDirectoryLoading: (directoryPath: string, loading: boolean) => void;
  setExplorerDirectoryError: (directoryPath: string, error: string | null) => void;
  resetExplorerState: () => void;
  setShowHiddenFiles: (show: boolean) => void;
  setGitChanges: (changes: GitStatus[]) => void;

  setPanes: (panes: Pane[]) => void;
  addPane: (terminalId: string | null, position?: PanePosition) => void;
  removePane: (paneId: string) => void;
  updatePanePosition: (paneId: string, position: PanePosition) => void;
  updateAllPanePositions: (positions: Array<{ id: string; position: PanePosition }>) => void;
  updateBrowserPosition: (position: PanePosition) => void;
  setGridViewport: (viewport: GridViewport) => void;
  resetLayout: () => void;
  fitAllPanes: () => void;
  bringPaneIntoView: (paneId: string) => void;
  bringBrowserIntoView: () => void;
  togglePaneLock: (paneId: string) => void;
  toggleBrowserLock: () => void;
  swapPanes: (a: string, b: string) => void;
  dockPaneToEdge: (paneId: string, edge: 'left' | 'right' | 'top' | 'bottom') => void;
  setSplitRatio: (nodeId: string, ratio: number) => void;
  canAddPane: () => boolean;

  openFileInEditor: (filePath: string) => Promise<void>;
  closeEditorTab: (tabId: string) => void;
  setActiveEditorTab: (tabId: string) => void;
  updateEditorContent: (tabId: string, content: string) => void;
  saveEditorFile: (tabId: string) => Promise<boolean>;
  saveAllEditorFiles: () => Promise<void>;
  toggleEditorPane: () => void;
  closeEditorPane: () => void;
  toggleEditorLock: () => void;
  bringEditorIntoView: () => void;
  resetEditorState: () => void;
  renameEditorTabPath: (oldPath: string, newPath: string) => void;
}

type ActiveWorkspaceSnapshot = Pick<
  WorkspaceState,
  | 'name'
  | 'workspacePath'
  | 'harness'
  | 'model'
  | 'terminals'
  | 'panes'
  | 'browserVisible'
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
>;

const generateId = (prefix: string) => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
};

const generatePaneId = () => generateId('pane');

const createPane = (terminalId: string | null, position?: PanePosition): Pane => ({
  id: generatePaneId(),
  terminalId,
  position,
});

const createWorkspaceId = () => generateId('workspace');

const createDefaultExplorerState = () => ({
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

const createDefaultEditorState = () => ({
  editorVisible: false,
  editorPane: null as EditorPaneState | null,
  editorTabs: [] as EditorTab[],
  activeEditorTabId: null as string | null,
});

function areGitStatusListsEqual(a: GitStatus[], b: GitStatus[]): boolean {
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

const sanitizeWorkspace = (workspace: WorkspaceTab): WorkspaceTab => ({
  ...workspace,
  terminals: [...workspace.terminals],
  panes: [...workspace.panes],
  explorerExpandedPaths: [...workspace.explorerExpandedPaths],
  explorerEntriesByPath: { ...workspace.explorerEntriesByPath },
  explorerLoadingPaths: [...workspace.explorerLoadingPaths],
  explorerErrorsByPath: { ...workspace.explorerErrorsByPath },
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
});

function getWorkspaceNameFromPath(workspacePath: string): string {
  const trimmed = workspacePath.replace(/\/+$/, '');
  if (!trimmed) return 'Workspace';
  const baseName = trimmed.split('/').pop();
  return baseName && baseName.length > 0 ? baseName : 'Workspace';
}

function getActiveWorkspaceSnapshot(
  workspace: Pick<
    WorkspaceTab,
    | 'name'
    | 'workspacePath'
    | 'harness'
    | 'model'
    | 'terminals'
    | 'panes'
    | 'browserVisible'
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

function syncActiveWorkspace(
  state: WorkspaceState,
  updateWorkspace: (workspace: WorkspaceTab) => WorkspaceTab
): Partial<WorkspaceState> {
  const nextWorkspaces = state.workspaces.map((workspace) =>
    workspace.id === state.activeWorkspaceId ? updateWorkspace(workspace) : workspace
  );

  const activeWorkspace = state.activeWorkspaceId == null
    ? null
    : nextWorkspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ?? null;

  if (activeWorkspace == null) {
    return { workspaces: nextWorkspaces };
  }

  return {
    ...getActiveWorkspaceSnapshot(activeWorkspace),
    workspaces: nextWorkspaces,
  };
}

function patchWorkspaceById(
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

  if (state.activeWorkspaceId === workspaceId) {
    return {
      ...getActiveWorkspaceSnapshot(updatedWorkspace),
      workspaces: nextWorkspaces,
    };
  }

  return { workspaces: nextWorkspaces };
}

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
};

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ...defaultWorkspaceState,
  workspaces: [],
  activeWorkspaceId: null,

  addWorkspace: (workspace) => set((state) => {
    const id = createWorkspaceId();
    const defaultName = workspace.name || getWorkspaceNameFromPath(workspace.workspacePath);
    const nextWorkspace: WorkspaceTab = sanitizeWorkspace({
      ...createDefaultExplorerState(),
      id,
      ...workspace,
      name: defaultName,
    });

    return {
      ...getActiveWorkspaceSnapshot(nextWorkspace),
      workspaces: [...state.workspaces, nextWorkspace],
      activeWorkspaceId: id,
      layoutRevision: state.layoutRevision,
    };
  }),

  selectWorkspace: (id) => set((state) => {
    const workspace = state.workspaces.find((entry) => entry.id === id);
    if (workspace == null) {
      return state;
    }

    const next = sanitizeWorkspace(workspace);
    return {
      ...getActiveWorkspaceSnapshot(next),
      gridViewport: state.gridViewport,
      layoutRevision: state.layoutRevision,
      activeWorkspaceId: id,
    };
  }),

  closeWorkspace: (id) => set((state) => {
    const remaining = state.workspaces.filter((workspace) => workspace.id !== id);

    if (remaining.length === 0) {
      return {
        ...defaultWorkspaceState,
        workspaces: [],
        activeWorkspaceId: null,
      };
    }

    if (state.activeWorkspaceId === id) {
      const nextActive = remaining[Math.max(0, remaining.length - 1)];
      return {
        ...getActiveWorkspaceSnapshot(nextActive),
        gridViewport: state.gridViewport,
        layoutRevision: state.layoutRevision,
        workspaces: remaining,
        activeWorkspaceId: nextActive.id,
      };
    }

    return {
      workspaces: remaining,
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

    return {
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

    return {
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
  }),

  setActiveTerminal: (id) => set((state) => ({
    activeTerminalId: id,
    ...syncActiveWorkspace(state, (workspace) => ({
      ...workspace,
      activeTerminalId: id,
    })),
  })),

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
          const currentIds = collectLeafPaneIds(state.layoutRoot);
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

  clearTerminals: () => set((state) => ({
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
  })),

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
    const nextPanes = state.panes.map((pane) =>
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
    const nextPanes = state.panes.map((pane) => {
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

    return {
      layoutRoot: nextLayout,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        layoutRoot: nextLayout,
      })),
    };
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

    return {
      layoutRoot: nextLayout,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        layoutRoot: nextLayout,
      })),
    };
  }),

  bringPaneIntoView: (paneId) => set((state) => {
    const firstPaneId = findFirstLeafPaneId(state.layoutRoot);
    if (firstPaneId == null || firstPaneId === paneId) {
      return state;
    }

    const nextLayoutRoot = swapPaneIdsInLayout(state.layoutRoot, firstPaneId, paneId);

    return {
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        layoutRoot: nextLayoutRoot,
      })),
    };
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

    return {
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        layoutRoot: nextLayoutRoot,
      })),
    };
  }),

  togglePaneLock: (paneId) => set((state) => {
    const nextPanes = state.panes.map((pane) => (
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

    return {
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        layoutRoot: nextLayoutRoot,
      })),
    };
  }),

  dockPaneToEdge: (paneId, edge) => set((state) => {
    const nextLayoutRoot = dockPaneToEdgeInLayout(state.layoutRoot, paneId, edge);
    if (nextLayoutRoot === state.layoutRoot) {
      return state;
    }

    return {
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        layoutRoot: nextLayoutRoot,
      })),
    };
  }),

  setSplitRatio: (nodeId, ratio) => set((state) => {
    const nextLayoutRoot = setSplitRatioInLayout(state.layoutRoot, nodeId, ratio);
    return {
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        layoutRoot: nextLayoutRoot,
      })),
    };
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
  },

  closeEditorTab: (tabId) => set((state) => {
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

    return {
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
  }),

  setActiveEditorTab: (tabId) => set((state) => ({
    activeEditorTabId: tabId,
    ...syncActiveWorkspace(state, (workspace) => ({
      ...workspace,
      activeEditorTabId: tabId,
    })),
  })),

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

    const contentToSave = tab.content;

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
          ? { ...currentTab, originalContent: contentToSave, isDirty: false }
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

    return true;
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

    return {
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
  }),

  closeEditorPane: () => set((state) => {
    if (state.editorPane) {
      const nextLayoutRoot = removePaneFromLayout(state.layoutRoot, state.editorPane.id);
      return {
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
    }
    return state;
  }),

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

    return {
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      ...syncActiveWorkspace(state, (workspace) => ({
        ...workspace,
        layoutRoot: nextLayoutRoot,
      })),
    };
  }),

  resetEditorState: () => set((state) => ({
    ...createDefaultEditorState(),
    ...syncActiveWorkspace(state, (workspace) => ({
      ...workspace,
      ...createDefaultEditorState(),
    })),
  })),

  renameEditorTabPath: (oldPath, newPath) => set((state) => {
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
  }),
}));
