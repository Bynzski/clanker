import { create } from 'zustand';

export interface Terminal {
  id: string;
  pid: number;
  workingDir: string;
}

export interface Pane {
  id: string;
  terminalId: string | null;
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
  addPane: (terminalId: string | null) => void;
  removePane: (paneId: string) => void;
}

/**
 * Auto-calculates a grid layout for n panes.
 * Returns an array of panel sizes (percentages) for rows/columns.
 */
export function autoCalculateLayout(count: number): { rows: number; cols: number; heights: number[]; widths: number[] } {
  if (count <= 0) return { rows: 1, cols: 1, heights: [100], widths: [100] };

  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);

  const heights = Array(rows).fill(100 / rows);

  const widths: number[] = [];
  for (let row = 0; row < rows; row++) {
    const start = row * cols;
    const end = Math.min(start + cols, count);
    const itemsInRow = end - start;
    widths.push(100 / itemsInRow);
  }

  return { rows, cols, heights, widths };
}

const generateId = (prefix: string) => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
};

const generatePaneId = () => generateId('pane');

const createPane = (terminalId: string | null): Pane => ({
  id: generatePaneId(),
  terminalId,
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
    const nextPanes = paneExists ? state.panes : [...state.panes, createPane(terminal.id)];
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

  addPane: (terminalId) => set((state) => ({
    ...(() => {
      const nextPane = createPane(terminalId);
      return {
        panes: [...state.panes, nextPane],
        workspaces: state.workspaces.map((workspace) => (
          workspace.id === state.activeWorkspaceId
            ? { ...workspace, panes: [...workspace.panes, nextPane] }
            : workspace
        )),
      };
    })(),
  })),

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
}));
