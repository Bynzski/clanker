import type {
  BrowserPaneState,
  EditorPaneState,
  LayoutLeaf,
  LayoutNode,
  LayoutSplit,
  Pane,
  PanePosition,
  WorkspaceTab,
} from './workspaceTypes';

export const GRID_COLS = 12;
export const GRID_ROWS = 8;
const MIN_PANE_W = 3;
const MIN_PANE_H = 3;

export type DockEdge = 'left' | 'right' | 'top' | 'bottom';

export interface EdgeTerminal {
  paneId: string;
  offset: number;
  span: number;
}

export interface EdgeGap {
  index: number;
  start: number;
  end: number;
  afterPaneId?: string;
  beforePaneId?: string;
}

interface LayoutVisibilityState {
  panes: Pane[];
  browserPane: BrowserPaneState | null;
  browserVisible: boolean;
  editorPane: EditorPaneState | null;
  editorVisible: boolean;
}

interface LayoutInsertState extends LayoutVisibilityState {
  activeTerminalId: string | null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function normalizePosition(position: PanePosition, cols: number, rows: number): PanePosition {
  const w = clamp(position.w, MIN_PANE_W, cols);
  const h = clamp(position.h, MIN_PANE_H, rows);
  const x = clamp(position.x, 0, Math.max(0, cols - w));
  const y = clamp(position.y, 0, Math.max(0, rows - h));
  return { x, y, w, h };
}

const generateId = (prefix: string) => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
};

function createLayoutLeaf(paneId: string): LayoutLeaf {
  return {
    type: 'leaf',
    nodeId: generateId('leaf'),
    paneId,
  };
}

function createLayoutSplit(
  first: LayoutNode,
  second: LayoutNode,
  orientation: 'horizontal' | 'vertical',
  ratio: number = 0.5
): LayoutSplit {
  return {
    type: 'split',
    nodeId: generateId('split'),
    orientation,
    ratio: clamp(ratio, 0.1, 0.9),
    first,
    second,
  };
}

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

export function collectLeafPaneIds(node: LayoutNode | null): string[] {
  if (node == null) {
    return [];
  }

  if (node.type === 'leaf') {
    return [node.paneId];
  }

  return [...collectLeafPaneIds(node.first), ...collectLeafPaneIds(node.second)];
}

function findPaneLock(state: LayoutVisibilityState, paneId: string) {
  if (state.browserVisible && state.browserPane?.id === paneId) {
    return state.browserPane.locked;
  }

  if (state.editorVisible && state.editorPane?.id === paneId) {
    return state.editorPane.locked;
  }

  return state.panes.find((pane) => pane.id === paneId)?.locked ?? false;
}

export function hasUnlockedLeaf(
  node: LayoutNode | null,
  state: LayoutVisibilityState
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

export function getEdgeTerminals(
  node: LayoutNode | null,
  edge: DockEdge
): EdgeTerminal[] {
  const edgeSplitOrientation: 'horizontal' | 'vertical' =
    edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical';
  const edgeChild: 'first' | 'second' =
    edge === 'left' || edge === 'top' ? 'first' : 'second';

  function walk(n: LayoutNode | null, offset: number, span: number): EdgeTerminal[] {
    if (n == null) {
      return [];
    }

    if (n.type === 'leaf') {
      return [{ paneId: n.paneId, offset, span }];
    }

    if (n.orientation === edgeSplitOrientation) {
      return walk(n[edgeChild], offset, span);
    }

    const firstSpan = span * n.ratio;
    const secondSpan = span * (1 - n.ratio);
    return [
      ...walk(n.first, offset, firstSpan),
      ...walk(n.second, offset + firstSpan, secondSpan),
    ];
  }

  return walk(node, 0, 1);
}

export function getEdgeGaps(
  edgeTerminals: EdgeTerminal[],
  maxSegments: number
): EdgeGap[] {
  if (maxSegments <= 0) {
    return [];
  }

  if (edgeTerminals.length === 0) {
    return [{ index: 0, start: 0, end: 1 }];
  }

  const total = edgeTerminals.length + 1;
  const gaps: EdgeGap[] = [];
  for (let k = 0; k < total; k++) {
    const before = edgeTerminals[k - 1];
    const after = edgeTerminals[k];
    const start = before ? before.offset + before.span : 0;
    const end = after ? after.offset : 1;
    gaps.push({
      index: k,
      start,
      end,
      afterPaneId: before?.paneId,
      beforePaneId: after?.paneId,
    });
  }

  return gaps.slice(0, maxSegments);
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

export function removePaneFromLayout(
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

export function swapPaneIdsInLayout(
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

export function dockPaneToEdgeInLayout(
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

export function setSplitRatioInLayout(
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

export function findFirstLeafPaneId(node: LayoutNode | null): string | null {
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
  state: LayoutVisibilityState
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
  state: LayoutInsertState
): string | null {
  if (state.activeTerminalId !== null) {
    const activePane = state.panes.find((pane) => pane.terminalId === state.activeTerminalId);
    if (activePane && !findPaneLock(state, activePane.id)) {
      const leafIds = collectLeafPaneIds(layoutRoot);
      if (leafIds.includes(activePane.id)) {
        return activePane.id;
      }
    }
  }

  return findLargestUnlockedLeaf(layoutRoot, state);
}

export function insertPaneIntoLayout(
  layoutRoot: LayoutNode | null,
  newPaneId: string,
  state: LayoutInsertState
): LayoutNode | null {
  if (layoutRoot == null) {
    return createLayoutLeaf(newPaneId);
  }

  const targetPaneId = findTargetPaneForInsert(layoutRoot, state);
  if (targetPaneId === null) {
    return layoutRoot;
  }

  return splitLeafByPaneId(layoutRoot, targetPaneId, newPaneId);
}

export function normalizeLayoutRoot(
  layoutRoot: LayoutNode | null,
  state: LayoutVisibilityState
): LayoutNode | null {
  if (layoutRoot == null) {
    const paneIds = state.panes.map((pane) => pane.id);
    if (state.browserVisible && state.browserPane) {
      paneIds.push(state.browserPane.id);
    }
    if (state.editorVisible && state.editorPane) {
      paneIds.push(state.editorPane.id);
    }
    return buildBalancedLayoutFromPaneIds(paneIds);
  }

  const visibleIds = new Set(state.panes.map((pane) => pane.id));
  if (state.browserVisible && state.browserPane) {
    visibleIds.add(state.browserPane.id);
  }
  if (state.editorVisible && state.editorPane) {
    visibleIds.add(state.editorPane.id);
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

export function buildWorkspaceLayout(
  workspace: Pick<WorkspaceTab, 'panes' | 'browserVisible' | 'browserPane' | 'editorVisible' | 'editorPane' | 'layoutRoot'>
): LayoutNode | null {
  const root = normalizeLayoutRoot(workspace.layoutRoot, workspace);
  if (root != null) {
    return root;
  }

  const paneIds = workspace.panes.map((pane) => pane.id);
  if (workspace.browserVisible && workspace.browserPane) {
    paneIds.push(workspace.browserPane.id);
  }
  if (workspace.editorVisible && workspace.editorPane) {
    paneIds.push(workspace.editorPane.id);
  }
  return buildBalancedLayoutFromPaneIds(paneIds);
}
