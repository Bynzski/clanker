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
  GridViewport,
  LayoutNode,
  Pane,
  PanePosition,
  Terminal,
  WorkspaceTab,
} from './workspaceTypes';

export type {
  BrowserPaneState,
  GridViewport,
  LayoutLeaf,
  LayoutNode,
  LayoutSplit,
  Pane,
  PanePosition,
  Terminal,
  WorkspaceTab,
} from './workspaceTypes';
export { calculateNewPanePosition } from './workspaceLayout';

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
  workspaces: WorkspaceTab[];
  activeWorkspaceId: string | null;
  gridViewport: GridViewport;
  layoutRevision: number;

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
  clearTerminals: () => void;

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

const sanitizeWorkspace = (workspace: WorkspaceTab): WorkspaceTab => ({
  ...workspace,
  terminals: [...workspace.terminals],
  panes: [...workspace.panes],
  browserPane: workspace.browserPane
    ? { ...workspace.browserPane, locked: workspace.browserPane.locked ?? false }
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
    const nextWorkspace: WorkspaceTab = sanitizeWorkspace({ id, ...workspace, name: defaultName });

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
        })
      : insertPaneIntoLayout(state.layoutRoot, nextPane.id, {
          panes: state.panes,
          browserPane: state.browserPane,
          browserVisible: state.browserVisible,
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

  setPanes: (panes) => set((state) => ({
    panes,
    layoutRoot: buildWorkspaceLayout({
      panes,
      browserVisible: state.browserVisible,
      browserPane: state.browserPane,
      layoutRoot: state.layoutRoot,
    }),
    ...syncActiveWorkspace(state, (workspace) => ({
      ...workspace,
      panes,
      layoutRoot: buildWorkspaceLayout({
        panes,
        browserVisible: state.browserVisible,
        browserPane: state.browserPane,
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
}));
