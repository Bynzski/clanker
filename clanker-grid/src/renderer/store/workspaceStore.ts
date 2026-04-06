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
  terminals: Terminal[];
  panes: Pane[];
  browserVisible: boolean;
  browserUrl: string;
  activeTerminalId: string | null;
  browserPane: BrowserPaneState | null;
  layoutRoot: LayoutNode | null;
}

interface WorkspaceState {
  name: string;
  workspacePath: string;
  harness: string;
  terminals: Terminal[];
  panes: Pane[];
  browserVisible: boolean;
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
  updateBrowserPosition: (position: PanePosition) => void;
  setGridViewport: (viewport: GridViewport) => void;
  resetLayout: () => void;
  fitAllPanes: () => void;
  bringPaneIntoView: (paneId: string) => void;
  bringBrowserIntoView: () => void;
  togglePaneLock: (paneId: string) => void;
  toggleBrowserLock: () => void;
  swapPanes: (a: string, b: string) => void;
  setSplitRatio: (nodeId: string, ratio: number) => void;
  canAddPane: () => boolean;
}

const GRID_COLS = 12;
const GRID_ROWS = 8;
const MIN_PANE_W = 3;
const MIN_PANE_H = 3;

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

function buildCompactPositions(count: number, cols: number, rows: number): PanePosition[] {
  if (count <= 0) return [];

  const safeCols = Math.max(1, cols);
  const safeRows = Math.max(1, rows);
  const itemsPerRow = Math.max(
    1,
    Math.min(safeCols, Math.ceil(Math.sqrt((count * safeCols) / safeRows)))
  );
  const rowsNeeded = Math.max(1, Math.ceil(count / itemsPerRow));
  const cellW = Math.max(1, Math.floor(safeCols / itemsPerRow));
  const cellH = Math.max(1, Math.floor(safeRows / rowsNeeded));

  const positions: PanePosition[] = [];
  for (let i = 0; i < count; i++) {
    positions.push({
      x: (i % itemsPerRow) * cellW,
      y: Math.floor(i / itemsPerRow) * cellH,
      w: cellW,
      h: cellH,
    });
  }

  return positions;
}

function normalizePaneEntry(
  pane: Pane,
  cols: number,
  rows: number
): Pane {
  if (!pane.position) {
    return pane;
  }

  return {
    ...pane,
    position: normalizePosition(pane.position, cols, rows),
  };
}

function sortPanesForLayout(panes: Pane[]) {
  return [...panes].sort((a, b) => {
    const aPos = a.position;
    const bPos = b.position;

    if (aPos && bPos) {
      if (aPos.y !== bPos.y) return aPos.y - bPos.y;
      if (aPos.x !== bPos.x) return aPos.x - bPos.x;
    }

    if (aPos) return -1;
    if (bPos) return 1;
    return a.id.localeCompare(b.id);
  });
}

function compactWorkspaceLayout(state: WorkspaceState): {
  panes: Pane[];
  browserPane: BrowserPaneState | null;
} {
  const viewport = state.gridViewport;
  const browserVisible = state.browserVisible && state.browserPane != null;
  const orderedPanes = sortPanesForLayout(state.panes);
  const totalItems = orderedPanes.length + (browserVisible ? 1 : 0);
  const positions = buildCompactPositions(totalItems, viewport.cols, viewport.rows);

  let index = 0;
  const nextPanes = orderedPanes.map((pane) => {
    const position = positions[index++] ?? pane.position;
    return {
      ...pane,
      position: position ? normalizePosition(position, viewport.cols, viewport.rows) : pane.position,
    };
  });

  const nextBrowserPane = browserVisible && state.browserPane
    ? {
        ...state.browserPane,
        position: normalizePosition(
          positions[index] ?? state.browserPane.position,
          viewport.cols,
          viewport.rows
        ),
      }
    : state.browserPane;

  return {
    panes: nextPanes,
    browserPane: nextBrowserPane,
  };
}

function findPanePositionById(state: WorkspaceState, paneId: string) {
  return state.panes.find((pane) => pane.id === paneId)?.position ?? null;
}

function getOccupiedPositions(state: WorkspaceState, excludePaneId?: string) {
  const positions = state.panes
    .filter((pane) => pane.id !== excludePaneId && pane.position)
    .map((pane) => pane.position as PanePosition);

  if (state.browserVisible && state.browserPane) {
    positions.push(state.browserPane.position);
  }

  return positions;
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

function countLeaves(node: LayoutNode | null): number {
  if (node == null) {
    return 0;
  }

  if (node.type === 'leaf') {
    return 1;
  }

  return countLeaves(node.first) + countLeaves(node.second);
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

const defaultWorkspaceState = {
  name: '',
  workspacePath: '',
  harness: 'codex',
  terminals: [] as Terminal[],
  panes: [] as Pane[],
  browserVisible: false,
  browserUrl: 'https://github.com',
  activeTerminalId: null as string | null,
  browserPane: null as BrowserPaneState | null,
  layoutRoot: null as LayoutNode | null,
  gridViewport: { cols: GRID_COLS, rows: GRID_ROWS },
  layoutRevision: 0,
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  ...defaultWorkspaceState,
  workspaces: [],
  activeWorkspaceId: null,

  addWorkspace: (workspace) => set((state) => {
    const id = createWorkspaceId();
    const defaultName = workspace.name || workspace.workspacePath.split('/').pop() || 'Workspace';
    const nextWorkspace: WorkspaceTab = sanitizeWorkspace({ id, ...workspace, name: defaultName });

    return {
      name: defaultName,
      workspacePath: workspace.workspacePath,
      harness: workspace.harness,
      terminals: nextWorkspace.terminals,
      panes: nextWorkspace.panes,
      browserVisible: workspace.browserVisible,
      browserUrl: workspace.browserUrl,
      activeTerminalId: nextWorkspace.activeTerminalId,
      browserPane: nextWorkspace.browserPane,
      layoutRoot: nextWorkspace.layoutRoot,
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
      name: next.name,
      workspacePath: next.workspacePath,
      harness: next.harness,
      terminals: next.terminals,
      panes: next.panes,
      browserVisible: next.browserVisible,
      browserUrl: next.browserUrl,
      activeTerminalId: next.activeTerminalId,
      browserPane: next.browserPane,
      layoutRoot: next.layoutRoot,
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
        name: nextActive.name,
        workspacePath: nextActive.workspacePath,
        harness: nextActive.harness,
        terminals: nextActive.terminals,
        panes: nextActive.panes,
        browserVisible: nextActive.browserVisible,
        browserUrl: nextActive.browserUrl,
        activeTerminalId: nextActive.activeTerminalId,
        browserPane: nextActive.browserPane,
        layoutRoot: nextActive.layoutRoot,
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
    name,
    workspaces: state.workspaces.map((workspace) =>
      workspace.id === id
        ? { ...workspace, name }
        : workspace
    ),
  })),

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
      workspaces: state.workspaces.map((workspace) => (
        workspace.id === state.activeWorkspaceId
          ? {
              ...workspace,
              terminals: nextTerminals,
              panes: nextPanes,
              activeTerminalId: nextActiveTerminalId,
              layoutRoot: nextLayoutRoot,
            }
          : workspace
      )),
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
      workspaces: state.workspaces.map((workspace) => (
        workspace.id === state.activeWorkspaceId
          ? {
              ...workspace,
              terminals: nextTerminals,
              panes: nextPanes,
              activeTerminalId: nextActiveTerminalId,
              layoutRoot: nextLayoutRoot,
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
      workspaces: state.workspaces.map((workspace) => (
        workspace.id === state.activeWorkspaceId
          ? {
              ...workspace,
              browserVisible: nextBrowserVisible,
              browserPane: nextBrowserPane ? { ...nextBrowserPane, locked: nextBrowserPane.locked ?? false } : nextBrowserPane,
              layoutRoot: nextLayoutRoot,
            }
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
    layoutRoot: null,
    workspaces: state.workspaces.map((workspace) => (
      workspace.id === state.activeWorkspaceId
        ? { ...workspace, terminals: [], panes: [], activeTerminalId: null, layoutRoot: null }
        : workspace
    )),
  })),

  setPanes: (panes) => set((state) => ({
    panes,
    layoutRoot: buildWorkspaceLayout({
      panes,
      browserVisible: state.browserVisible,
      browserPane: state.browserPane,
      layoutRoot: state.layoutRoot,
    }),
    workspaces: state.workspaces.map((workspace) => (
      workspace.id === state.activeWorkspaceId
        ? { ...workspace, panes, layoutRoot: buildWorkspaceLayout({
          panes,
          browserVisible: state.browserVisible,
          browserPane: state.browserPane,
          layoutRoot: state.layoutRoot,
        }) }
        : workspace
    )),
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
      workspaces: state.workspaces.map((workspace) => (
        workspace.id === state.activeWorkspaceId
          ? { ...workspace, panes: nextPanes, layoutRoot: nextLayoutRoot }
          : workspace
      )),
    };
  }),

  removePane: (paneId) => set((state) => {
    const nextPanes = state.panes.filter((pane) => pane.id !== paneId);
    const nextLayoutRoot = removePaneFromLayout(state.layoutRoot, paneId);
    return {
      panes: nextPanes,
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      workspaces: state.workspaces.map((workspace) => (
        workspace.id === state.activeWorkspaceId
          ? { ...workspace, panes: nextPanes, layoutRoot: nextLayoutRoot }
          : workspace
      )),
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
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === state.activeWorkspaceId
          ? { ...workspace, panes: nextPanes }
          : workspace
      ),
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
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === state.activeWorkspaceId
          ? { ...workspace, panes: nextPanes }
          : workspace
      ),
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
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === state.activeWorkspaceId
          ? { ...workspace, browserPane: nextBrowserPane }
          : workspace
      ),
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
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === state.activeWorkspaceId
          ? {
              ...workspace,
              layoutRoot: nextLayout,
            }
          : workspace
      ),
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
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === state.activeWorkspaceId
          ? {
              ...workspace,
              layoutRoot: nextLayout,
            }
          : workspace
      ),
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
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === state.activeWorkspaceId
          ? { ...workspace, layoutRoot: nextLayoutRoot }
          : workspace
      ),
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
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === state.activeWorkspaceId
          ? { ...workspace, layoutRoot: nextLayoutRoot }
          : workspace
      ),
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
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === state.activeWorkspaceId
          ? { ...workspace, panes: nextPanes }
          : workspace
      ),
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
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === state.activeWorkspaceId
          ? { ...workspace, browserPane: nextBrowserPane }
          : workspace
      ),
    };
  }),

  swapPanes: (a, b) => set((state) => {
    if (a === b) return state;
    const nextLayoutRoot = swapPaneIdsInLayout(state.layoutRoot, a, b);

    return {
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === state.activeWorkspaceId
          ? { ...workspace, layoutRoot: nextLayoutRoot }
          : workspace
      ),
    };
  }),

  setSplitRatio: (nodeId, ratio) => set((state) => {
    const nextLayoutRoot = setSplitRatioInLayout(state.layoutRoot, nodeId, ratio);
    return {
      layoutRoot: nextLayoutRoot,
      layoutRevision: state.layoutRevision + 1,
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === state.activeWorkspaceId
          ? { ...workspace, layoutRoot: nextLayoutRoot }
          : workspace
      ),
    };
  }),

  canAddPane: () => {
    const state = useWorkspaceStore.getState();
    return hasUnlockedLeaf(state.layoutRoot, state) || state.layoutRoot == null;
  },
}));
