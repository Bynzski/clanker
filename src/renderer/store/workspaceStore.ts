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
  locked?: boolean;
}

export interface BrowserPaneState {
  id: string;
  position: PanePosition;
  locked: boolean;
}

export interface GridViewport {
  cols: number;
  rows: number;
}

export type LayoutNode = LayoutLeaf | LayoutSplit;

export interface LayoutLeaf {
  type: 'leaf';
  nodeId: string;
  paneId: string;
}

export interface LayoutSplit {
  type: 'split';
  nodeId: string;
  orientation: 'horizontal' | 'vertical';
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
}

export interface WorkspaceTab {
  id: string;
  name: string;
  workspacePath: string;
  harness: string;
  model: string;
  terminals: Terminal[];
  panes: Pane[];
  browserVisible: boolean;
  browserOverlayCount?: number;
  browserUrl: string;
  activeTerminalId: string | null;
  browserPane: BrowserPaneState | null;
  layoutRoot: LayoutNode | null;
}

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

const GRID_COLS = 12;
const GRID_ROWS = 8;
const MIN_PANE_W = 3;
const MIN_PANE_H = 3;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizePosition(position: PanePosition, cols: number, rows: number): PanePosition {
  const w = clamp(position.w, MIN_PANE_W, cols);
  const h = clamp(position.h, MIN_PANE_H, rows);
  const x = clamp(position.x, 0, Math.max(0, cols - w));
  const y = clamp(position.y, 0, Math.max(0, rows - h));
  return { x, y, w, h };
}

function collides(a: PanePosition, b: PanePosition) {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

function findAvailablePosition(
  existingPositions: PanePosition[],
  cols: number,
  rows: number,
  preferredW: number,
  preferredH: number
): PanePosition | null {
  const w = clamp(preferredW, MIN_PANE_W, cols);
  const h = clamp(preferredH, MIN_PANE_H, rows);

  for (let y = 0; y <= rows - h; y++) {
    for (let x = 0; x <= cols - w; x++) {
      const candidate = { x, y, w, h };
      if (!existingPositions.some((position) => collides(candidate, position))) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Calculates position for a new pane in the grid
 * Ensures the new pane stays within visible bounds
 */
export function calculateNewPanePosition(
  existingPanes: Pane[],
  maxCols: number = 12,
  maxRows: number = 8
): PanePosition {
  const occupiedPositions = existingPanes
    .filter((pane) => pane.position)
    .map((pane) => pane.position as PanePosition);
  const count = existingPanes.length;
  const preferredW = clamp(Math.floor(maxCols / Math.min(count + 1, 3)) || 4, MIN_PANE_W, maxCols);
  const preferredH = clamp(Math.floor(maxRows / Math.min(Math.max(1, Math.ceil(count / 2)), 3)) || 4, MIN_PANE_H, maxRows);
  const position = findAvailablePosition(occupiedPositions, maxCols, maxRows, preferredW, preferredH);

  return position ?? normalizePosition({ x: 0, y: 0, w: preferredW, h: preferredH }, maxCols, maxRows);
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

const createLayoutLeaf = (paneId: string): LayoutLeaf => ({
  type: 'leaf',
  nodeId: generateId('leaf'),
  paneId,
});

const createLayoutSplit = (
  first: LayoutNode,
  second: LayoutNode,
  orientation: 'horizontal' | 'vertical',
  ratio: number = 0.5
): LayoutSplit => ({
  type: 'split',
  nodeId: generateId('split'),
  orientation,
  ratio: clamp(ratio, 0.1, 0.9),
  first,
  second,
});

function cloneLayoutNode(node: LayoutNode | null): LayoutNode | null {
  if (node == null) {
    return null;
  }

  if (node.type === 'leaf') {
    return { ...node };
  }

  return {
    ...node,
    first: cloneLayoutNode(node.first)!,
    second: cloneLayoutNode(node.second)!,
  };
}

function buildBalancedLayoutFromPaneIds(
  paneIds: string[],
  depth: number = 0
): LayoutNode | null {
  if (paneIds.length === 0) {
    return null;
  }

  if (paneIds.length === 1) {
    return createLayoutLeaf(paneIds[0]);
  }

  const splitIndex = Math.ceil(paneIds.length / 2);
  const first = buildBalancedLayoutFromPaneIds(paneIds.slice(0, splitIndex), depth + 1);
  const second = buildBalancedLayoutFromPaneIds(paneIds.slice(splitIndex), depth + 1);

  if (first == null) return second;
  if (second == null) return first;

  const orientation = depth % 2 === 0 ? 'horizontal' : 'vertical';
  return createLayoutSplit(first, second, orientation, 0.5);
}

function collectLeafPaneIds(node: LayoutNode | null): string[] {
  if (node == null) {
    return [];
  }

  if (node.type === 'leaf') {
    return [node.paneId];
  }

  return [...collectLeafPaneIds(node.first), ...collectLeafPaneIds(node.second)];
}

function findPaneLock(state: Pick<WorkspaceState, 'panes' | 'browserPane' | 'browserVisible'>, paneId: string) {
  if (state.browserVisible && state.browserPane?.id === paneId) {
    return state.browserPane.locked;
  }

  return state.panes.find((pane) => pane.id === paneId)?.locked ?? false;
}

function hasUnlockedLeaf(
  node: LayoutNode | null,
  state: Pick<WorkspaceState, 'panes' | 'browserPane' | 'browserVisible'>
): boolean {
  if (node == null) {
    return false;
  }

  if (node.type === 'leaf') {
    return !findPaneLock(state, node.paneId);
  }

  return hasUnlockedLeaf(node.first, state) || hasUnlockedLeaf(node.second, state);
}

function getLeafAreaMap(
  node: LayoutNode | null,
  area: number = 100
): Array<{ paneId: string; area: number }> {
  if (node == null) {
    return [];
  }

  if (node.type === 'leaf') {
    return [{ paneId: node.paneId, area }];
  }

  return [
    ...getLeafAreaMap(node.first, area * node.ratio),
    ...getLeafAreaMap(node.second, area * (1 - node.ratio)),
  ];
}

function splitLeafByPaneId(
  node: LayoutNode | null,
  targetPaneId: string,
  newPaneId: string,
  depth: number = 0
): LayoutNode | null {
  if (node == null) {
    return null;
  }

  if (node.type === 'leaf') {
    if (node.paneId !== targetPaneId) {
      return { ...node };
    }

    const orientation = depth % 2 === 0 ? 'horizontal' : 'vertical';
    return createLayoutSplit(
      { ...node },
      createLayoutLeaf(newPaneId),
      orientation,
      0.5
    );
  }

  const first = splitLeafByPaneId(node.first, targetPaneId, newPaneId, depth + 1);
  const second = splitLeafByPaneId(node.second, targetPaneId, newPaneId, depth + 1);

  if (first == null) return second;
  if (second == null) return first;

  return {
    ...node,
    first,
    second,
  };
}

function removePaneFromLayout(
  node: LayoutNode | null,
  paneId: string
): LayoutNode | null {
  if (node == null) {
    return null;
  }

  if (node.type === 'leaf') {
    return node.paneId === paneId ? null : { ...node };
  }

  const first = removePaneFromLayout(node.first, paneId);
  const second = removePaneFromLayout(node.second, paneId);

  if (first == null) return second;
  if (second == null) return first;

  return {
    ...node,
    first,
    second,
  };
}

function swapPaneIdsInLayout(
  node: LayoutNode | null,
  a: string,
  b: string
): LayoutNode | null {
  if (node == null || a === b) {
    return node == null ? null : cloneLayoutNode(node);
  }

  if (node.type === 'leaf') {
    if (node.paneId === a) {
      return { ...node, paneId: b };
    }
    if (node.paneId === b) {
      return { ...node, paneId: a };
    }
    return { ...node };
  }

  return {
    ...node,
    first: swapPaneIdsInLayout(node.first, a, b)!,
    second: swapPaneIdsInLayout(node.second, a, b)!,
  };
}

function dockPaneToEdgeInLayout(
  layoutRoot: LayoutNode | null,
  paneId: string,
  edge: 'left' | 'right' | 'top' | 'bottom'
): LayoutNode | null {
  if (layoutRoot == null) {
    return createLayoutLeaf(paneId);
  }

  const leaves = collectLeafPaneIds(layoutRoot);
  if (!leaves.includes(paneId)) {
    return layoutRoot;
  }

  const trimmedLayout = removePaneFromLayout(layoutRoot, paneId);
  if (trimmedLayout == null) {
    return createLayoutLeaf(paneId);
  }

  const dockedLeaf = createLayoutLeaf(paneId);
  if (edge === 'left') {
    return createLayoutSplit(dockedLeaf, trimmedLayout, 'horizontal', 0.5);
  }
  if (edge === 'right') {
    return createLayoutSplit(trimmedLayout, dockedLeaf, 'horizontal', 0.5);
  }
  if (edge === 'top') {
    return createLayoutSplit(dockedLeaf, trimmedLayout, 'vertical', 0.5);
  }
  return createLayoutSplit(trimmedLayout, dockedLeaf, 'vertical', 0.5);
}

function setSplitRatioInLayout(
  node: LayoutNode | null,
  nodeId: string,
  ratio: number
): LayoutNode | null {
  if (node == null) {
    return null;
  }

  if (node.type === 'split') {
    if (node.nodeId === nodeId) {
      return {
        ...node,
        ratio: clamp(ratio, 0.1, 0.9),
      };
    }

    return {
      ...node,
      first: setSplitRatioInLayout(node.first, nodeId, ratio)!,
      second: setSplitRatioInLayout(node.second, nodeId, ratio)!,
    };
  }

  return { ...node };
}

function findFirstLeafPaneId(node: LayoutNode | null): string | null {
  if (node == null) {
    return null;
  }

  if (node.type === 'leaf') {
    return node.paneId;
  }

  return findFirstLeafPaneId(node.first) ?? findFirstLeafPaneId(node.second);
}

function findLargestUnlockedLeaf(
  node: LayoutNode | null,
  state: Pick<WorkspaceState, 'panes' | 'browserPane' | 'browserVisible'>
): string | null {
  const leaves = getLeafAreaMap(node);
  let bestPaneId: string | null = null;
  let bestArea = -1;

  for (const leaf of leaves) {
    if (findPaneLock(state, leaf.paneId)) {
      continue;
    }

    if (leaf.area > bestArea) {
      bestArea = leaf.area;
      bestPaneId = leaf.paneId;
    }
  }

  return bestPaneId;
}

function findTargetPaneForInsert(
  layoutRoot: LayoutNode | null,
  state: Pick<WorkspaceState, 'panes' | 'browserPane' | 'browserVisible' | 'activeTerminalId'>
): string | null {
  // First, check if there's an active terminal and its pane is available
  if (state.activeTerminalId != null) {
    const activePane = state.panes.find((pane) => pane.terminalId === state.activeTerminalId);
    if (activePane != null && !findPaneLock(state, activePane.id)) {
      // Verify the pane still exists in the layout
      const leafIds = collectLeafPaneIds(layoutRoot);
      if (leafIds.includes(activePane.id)) {
        return activePane.id;
      }
    }
  }

  // Fall back to largest unlocked pane
  return findLargestUnlockedLeaf(layoutRoot, state);
}

function insertPaneIntoLayout(
  layoutRoot: LayoutNode | null,
  newPaneId: string,
  state: Pick<WorkspaceState, 'panes' | 'browserPane' | 'browserVisible' | 'activeTerminalId'>
): LayoutNode | null {
  if (layoutRoot == null) {
    return createLayoutLeaf(newPaneId);
  }

  const targetPaneId = findTargetPaneForInsert(layoutRoot, state);
  if (targetPaneId == null) {
    return layoutRoot;
  }

  return splitLeafByPaneId(layoutRoot, targetPaneId, newPaneId);
}

function normalizeLayoutRoot(
  layoutRoot: LayoutNode | null,
  state: Pick<WorkspaceState, 'panes' | 'browserPane' | 'browserVisible'>
): LayoutNode | null {
  if (layoutRoot == null) {
    const paneIds = state.panes.map((pane) => pane.id);
    if (state.browserVisible && state.browserPane) {
      paneIds.push(state.browserPane.id);
    }
    return buildBalancedLayoutFromPaneIds(paneIds);
  }

  const visibleIds = new Set(state.panes.map((pane) => pane.id));
  if (state.browserVisible && state.browserPane) {
    visibleIds.add(state.browserPane.id);
  }

  function prune(node: LayoutNode | null): LayoutNode | null {
    if (node == null) {
      return null;
    }

    if (node.type === 'leaf') {
      return visibleIds.has(node.paneId) ? { ...node } : null;
    }

    const first = prune(node.first);
    const second = prune(node.second);

    if (first == null) return second;
    if (second == null) return first;

    return {
      ...node,
      first,
      second,
    };
  }

  return prune(layoutRoot);
}

function buildWorkspaceLayout(
  workspace: Pick<WorkspaceTab, 'panes' | 'browserVisible' | 'browserPane' | 'layoutRoot'>
): LayoutNode | null {
  const root = normalizeLayoutRoot(workspace.layoutRoot, workspace);
  if (root != null) {
    return root;
  }

  const paneIds = workspace.panes.map((pane) => pane.id);
  if (workspace.browserVisible && workspace.browserPane) {
    paneIds.push(workspace.browserPane.id);
  }
  return buildBalancedLayoutFromPaneIds(paneIds);
}

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
      cols: clamp(Math.floor(viewport.cols) || GRID_COLS, 1, GRID_COLS),
      rows: clamp(Math.floor(viewport.rows) || GRID_ROWS, 1, 20),
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
    const nextLayout = buildBalancedLayoutFromPaneIds([
      ...state.panes.map((pane) => pane.id),
      ...(state.browserVisible && state.browserPane ? [state.browserPane.id] : []),
    ]);

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
    const nextLayout = buildBalancedLayoutFromPaneIds([
      ...state.panes.map((pane) => pane.id),
      ...(state.browserVisible && state.browserPane ? [state.browserPane.id] : []),
    ]);

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
