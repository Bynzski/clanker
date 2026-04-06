import { create } from 'zustand';

export interface Terminal {
  id: string;
  pid: number;
  workingDir: string;
}

export interface PanePosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pane {
  id: string;
  terminalId: string | null;
  position?: PanePosition;
}

export interface WorkspaceTab {
  id: string;
  workspacePath: string;
  harness: string;
  terminals: Terminal[];
  panes: Pane[];
  browserVisible: boolean;
  browserUrl: string;
  activeTerminalId: string | null;
}

interface WorkspaceState extends WorkspaceTab {
  workspaces: WorkspaceTab[];
  activeWorkspaceId: string | null;

  addWorkspace: (workspace: Omit<WorkspaceTab, 'id'>) => void;
  selectWorkspace: (id: string) => void;
  closeWorkspace: (id: string) => void;

  setWorkspacePath: (path: string) => void;
  setHarness: (harness: string) => void;
  addTerminal: (terminal: Terminal) => void;
  removeTerminal: (id: string) => void;
  setActiveTerminal: (id: string) => void;
  toggleBrowser: () => void;
  setBrowserUrl: (url: string) => void;
  clearTerminals: () => void;

  setPanes: (panes: Pane[]) => void;
  addPane: (terminalId: string | null, position?: PanePosition) => void;
  removePane: (paneId: string) => void;
  updatePanePosition: (paneId: string, position: PanePosition) => void;
  updateAllPanePositions: (positions: Array<{ id: string; position: PanePosition }>) => void;
}

/**
 * Auto-calculates a grid layout for n panes.
 * Returns react-grid-layout compatible layout items.
 * Grid is 12 columns, rows are calculated based on count.
 */
export function autoCalculateLayout(count: number): {
  layout: Array<{ i: string; x: number; y: number; w: number; h: number; minW: number; minH: number }>;
  cols: number;
} {
  if (count <= 0) return { layout: [], cols: 12 };

  const cols = 12;
  const itemsPerRow = Math.min(count, 3);
  const rows = Math.ceil(count / itemsPerRow);
  const cellW = Math.floor(12 / itemsPerRow);
  const cellH = Math.floor(12 / rows);

  const layout = [];
  for (let i = 0; i < count; i++) {
    const col = (i % itemsPerRow) * cellW;
    const row = Math.floor(i / itemsPerRow) * cellH;
    layout.push({
      i: `pane-${i}`,
      x: col,
      y: row,
      w: cellW,
      h: cellH,
      minW: 2,
      minH: 2,
    });
  }

  return { layout, cols };
}

/**
 * Calculates position for a new pane in the grid
 * Ensures the new pane stays within visible bounds
 */
export function calculateNewPanePosition(
  existingPanes: Pane[],
  maxCols: number = 12,
  maxRows: number = 20
): PanePosition {
  const count = existingPanes.length;
  
  if (count === 0) {
    return { x: 0, y: 0, w: 12, h: 4 };
  }

  // Find the lowest row used
  let maxY = 0;
  for (const pane of existingPanes) {
    if (pane.position) {
      const bottomY = pane.position.y + pane.position.h;
      if (bottomY > maxY) maxY = bottomY;
    }
  }

  // Place new pane at the bottom of the grid
  return {
    x: 0,
    y: maxY,
    w: Math.min(12, Math.max(4, Math.floor(12 / Math.min(count + 1, 4)))),
    h: 4,
  };
}

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
});

const defaultWorkspaceState = {
  workspacePath: '',
  harness: 'codex',
  terminals: [] as Terminal[],
  panes: [] as Pane[],
  browserVisible: false,
  browserUrl: 'https://github.com',
  activeTerminalId: null as string | null,
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  ...defaultWorkspaceState,
  workspaces: [],
  activeWorkspaceId: null,

  addWorkspace: (workspace) => set((state) => {
    const id = createWorkspaceId();
    const nextWorkspace: WorkspaceTab = sanitizeWorkspace({ id, ...workspace });

    return {
      ...workspace,
      workspaces: [...state.workspaces, nextWorkspace],
      activeWorkspaceId: id,
    };
  }),

  selectWorkspace: (id) => set((state) => {
    const workspace = state.workspaces.find((entry) => entry.id === id);
    if (workspace == null) {
      return state;
    }

    const next = sanitizeWorkspace(workspace);
    return {
      workspacePath: next.workspacePath,
      harness: next.harness,
      terminals: next.terminals,
      panes: next.panes,
      browserVisible: next.browserVisible,
      browserUrl: next.browserUrl,
      activeTerminalId: next.activeTerminalId,
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
        workspacePath: nextActive.workspacePath,
        harness: nextActive.harness,
        terminals: nextActive.terminals,
        panes: nextActive.panes,
        browserVisible: nextActive.browserVisible,
        browserUrl: nextActive.browserUrl,
        activeTerminalId: nextActive.activeTerminalId,
        workspaces: remaining,
        activeWorkspaceId: nextActive.id,
      };
    }

    return {
      workspaces: remaining,
    };
  }),

  setWorkspacePath: (path) => set((state) => ({
    workspacePath: path,
    workspaces: state.workspaces.map((workspace) => (
      workspace.id === state.activeWorkspaceId
        ? { ...workspace, workspacePath: path }
        : workspace
    )),
  })),

  setHarness: (harness) => set((state) => ({
    harness,
    workspaces: state.workspaces.map((workspace) => (
      workspace.id === state.activeWorkspaceId
        ? { ...workspace, harness }
        : workspace
    )),
  })),

  addTerminal: (terminal) => set((state) => {
    const paneExists = state.panes.some((pane) => pane.terminalId === terminal.id);
    const nextTerminals = [...state.terminals, terminal];
    
    let nextPanes = state.panes;
    if (!paneExists) {
      const position = calculateNewPanePosition(state.panes);
      nextPanes = [...state.panes, createPane(terminal.id, position)];
    }
    
    const nextActiveTerminalId = terminal.id;

    return {
      terminals: nextTerminals,
      panes: nextPanes,
      activeTerminalId: nextActiveTerminalId,
      workspaces: state.workspaces.map((workspace) => (
        workspace.id === state.activeWorkspaceId
          ? {
              ...workspace,
              terminals: nextTerminals,
              panes: nextPanes,
              activeTerminalId: nextActiveTerminalId,
            }
          : workspace
      )),
    };
  }),

  removeTerminal: (id) => set((state) => {
    const nextTerminals = state.terminals.filter((terminal) => terminal.id !== id);
    const nextPanes = state.panes.filter((pane) => pane.terminalId !== id);
    const nextActiveTerminalId = state.activeTerminalId === id
      ? (nextTerminals.length > 0 ? nextTerminals[nextTerminals.length - 1].id : null)
      : state.activeTerminalId;

    return {
      terminals: nextTerminals,
      panes: nextPanes,
      activeTerminalId: nextActiveTerminalId,
      workspaces: state.workspaces.map((workspace) => (
        workspace.id === state.activeWorkspaceId
          ? {
              ...workspace,
              terminals: nextTerminals,
              panes: nextPanes,
              activeTerminalId: nextActiveTerminalId,
            }
          : workspace
      )),
    };
  }),

  setActiveTerminal: (id) => set((state) => ({
    activeTerminalId: id,
    workspaces: state.workspaces.map((workspace) => (
      workspace.id === state.activeWorkspaceId
        ? { ...workspace, activeTerminalId: id }
        : workspace
    )),
  })),

  toggleBrowser: () => set((state) => {
    const nextBrowserVisible = !state.browserVisible;
    return {
      browserVisible: nextBrowserVisible,
      workspaces: state.workspaces.map((workspace) => (
        workspace.id === state.activeWorkspaceId
          ? { ...workspace, browserVisible: nextBrowserVisible }
          : workspace
      )),
    };
  }),

  setBrowserUrl: (url) => set((state) => ({
    browserUrl: url,
    workspaces: state.workspaces.map((workspace) => (
      workspace.id === state.activeWorkspaceId
        ? { ...workspace, browserUrl: url }
        : workspace
    )),
  })),

  clearTerminals: () => set((state) => ({
    terminals: [],
    panes: [],
    activeTerminalId: null,
    workspaces: state.workspaces.map((workspace) => (
      workspace.id === state.activeWorkspaceId
        ? { ...workspace, terminals: [], panes: [], activeTerminalId: null }
        : workspace
    )),
  })),

  setPanes: (panes) => set((state) => ({
    panes,
    workspaces: state.workspaces.map((workspace) => (
      workspace.id === state.activeWorkspaceId
        ? { ...workspace, panes }
        : workspace
    )),
  })),

  addPane: (terminalId, position) => set((state) => {
    const nextPane = createPane(terminalId, position);
    return {
      panes: [...state.panes, nextPane],
      workspaces: state.workspaces.map((workspace) => (
        workspace.id === state.activeWorkspaceId
          ? { ...workspace, panes: [...workspace.panes, nextPane] }
          : workspace
      )),
    };
  }),

  removePane: (paneId) => set((state) => {
    const nextPanes = state.panes.filter((pane) => pane.id !== paneId);
    return {
      panes: nextPanes,
      workspaces: state.workspaces.map((workspace) => (
        workspace.id === state.activeWorkspaceId
          ? { ...workspace, panes: nextPanes }
          : workspace
      )),
    };
  }),

  updatePanePosition: (paneId, position) => set((state) => {
    const nextPanes = state.panes.map((pane) =>
      pane.id === paneId ? { ...pane, position } : pane
    );
    return {
      panes: nextPanes,
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === state.activeWorkspaceId
          ? { ...workspace, panes: nextPanes }
          : workspace
      ),
    };
  }),

  updateAllPanePositions: (positions) => set((state) => {
    const posMap = new Map(positions.map(p => [p.id, p.position]));
    const nextPanes = state.panes.map((pane) => {
      const pos = posMap.get(pane.id);
      return pos ? { ...pane, position: pos } : pane;
    });
    return {
      panes: nextPanes,
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === state.activeWorkspaceId
          ? { ...workspace, panes: nextPanes }
          : workspace
      ),
    };
  }),
}));