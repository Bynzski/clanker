import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GRID_COLS,
  GRID_ROWS,
  normalizePosition,
  collectLeafPaneIds,
  removePaneFromLayout,
  swapPaneIdsInLayout,
  dockPaneToEdgeInLayout,
  setSplitRatioInLayout,
  findFirstLeafPaneId,
  hasUnlockedLeaf,
  insertPaneIntoLayout,
  normalizeLayoutRoot,
  buildWorkspaceLayout,
} from '../../../src/renderer/store/workspaceLayout';
import type {
  LayoutNode,
  LayoutLeaf,
  LayoutSplit,
  Pane,
  BrowserPaneState,
} from '../../../src/renderer/store/workspaceTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Force deterministic IDs so assertions can use exact values. */
let idCounter = 0;
beforeEach(() => {
  idCounter = 0;
  vi.stubGlobal('crypto', {
    randomUUID: () => `uuid-${++idCounter}`,
  });
});

function leaf(paneId: string, nodeId?: string): LayoutLeaf {
  return { type: 'leaf', nodeId: nodeId ?? `leaf-${paneId}`, paneId };
}

function split(
  first: LayoutNode,
  second: LayoutNode,
  orientation: 'horizontal' | 'vertical' = 'horizontal',
  ratio: number = 0.5,
  nodeId?: string,
): LayoutSplit {
  return {
    type: 'split',
    nodeId: nodeId ?? `split-${Math.random().toString(36).slice(2, 6)}`,
    orientation,
    ratio,
    first,
    second,
  };
}

function makePane(id: string, locked = false): Pane {
  return { id, terminalId: `term-${id}`, locked };
}

function makeBrowser(id: string, locked = false): BrowserPaneState {
  return { id, position: { x: 0, y: 0, w: 6, h: 6 }, locked };
}

const emptyState = { panes: [] as Pane[], browserPane: null as BrowserPaneState | null, browserVisible: false, editorPane: null, editorVisible: false };

// ===========================================================================
// normalizePosition
// ===========================================================================
describe('normalizePosition', () => {
  it('returns position unchanged when within bounds', () => {
    const pos = { x: 2, y: 3, w: 4, h: 4 };
    expect(normalizePosition(pos, 12, 8)).toEqual(pos);
  });

  it('clamps width to GRID_COLS when too large', () => {
    const pos = normalizePosition({ x: 0, y: 0, w: 20, h: 4 }, 12, 8);
    expect(pos.w).toBe(12);
  });

  it('clamps height to rows when too large', () => {
    const pos = normalizePosition({ x: 0, y: 0, w: 4, h: 20 }, 12, 8);
    expect(pos.h).toBe(8);
  });

  it('enforces minimum width of 3', () => {
    const pos = normalizePosition({ x: 0, y: 0, w: 1, h: 4 }, 12, 8);
    expect(pos.w).toBe(3);
  });

  it('enforces minimum height of 3', () => {
    const pos = normalizePosition({ x: 0, y: 0, w: 4, h: 1 }, 12, 8);
    expect(pos.h).toBe(3);
  });

  it('shifts x so pane does not overflow right edge', () => {
    const pos = normalizePosition({ x: 10, y: 0, w: 4, h: 4 }, 12, 8);
    expect(pos.x).toBe(8); // 12 - 4
    expect(pos.w).toBe(4);
  });

  it('shifts y so pane does not overflow bottom edge', () => {
    const pos = normalizePosition({ x: 0, y: 7, w: 4, h: 4 }, 12, 8);
    expect(pos.y).toBe(4); // 8 - 4
    expect(pos.h).toBe(4);
  });

  it('clamps negative x to 0', () => {
    const pos = normalizePosition({ x: -3, y: 0, w: 4, h: 4 }, 12, 8);
    expect(pos.x).toBe(0);
  });

  it('clamps negative y to 0', () => {
    const pos = normalizePosition({ x: 0, y: -5, w: 4, h: 4 }, 12, 8);
    expect(pos.y).toBe(0);
  });
});

// ===========================================================================
// collectLeafPaneIds
// ===========================================================================
describe('collectLeafPaneIds', () => {
  it('returns empty array for null', () => {
    expect(collectLeafPaneIds(null)).toEqual([]);
  });

  it('returns single pane id for a leaf', () => {
    expect(collectLeafPaneIds(leaf('a'))).toEqual(['a']);
  });

  it('collects all pane ids from a split tree in order', () => {
    const tree = split(leaf('a'), split(leaf('b'), leaf('c'), 'vertical'));
    expect(collectLeafPaneIds(tree)).toEqual(['a', 'b', 'c']);
  });
});

// ===========================================================================
// removePaneFromLayout
// ===========================================================================
describe('removePaneFromLayout', () => {
  it('returns null for null input', () => {
    expect(removePaneFromLayout(null, 'a')).toBeNull();
  });

  it('returns null when removing the only leaf', () => {
    expect(removePaneFromLayout(leaf('a'), 'a')).toBeNull();
  });

  it('returns the leaf unchanged when pane id does not match', () => {
    const result = removePaneFromLayout(leaf('a'), 'b');
    expect(result).toEqual(leaf('a'));
  });

  it('collapses a split when one child is removed', () => {
    const tree = split(leaf('a'), leaf('b'));
    const result = removePaneFromLayout(tree, 'a');
    expect(result).toEqual(leaf('b'));
  });

  it('removes a deeply nested pane and collapses ancestors', () => {
    const tree = split(leaf('a'), split(leaf('b'), leaf('c'), 'vertical'));
    const result = removePaneFromLayout(tree, 'b');
    // The inner split collapses to just leaf('c')
    expect(result).toEqual(split(leaf('a'), leaf('c'), 'horizontal', 0.5, tree.nodeId));
  });
});

// ===========================================================================
// swapPaneIdsInLayout
// ===========================================================================
describe('swapPaneIdsInLayout', () => {
  it('returns null for null input', () => {
    expect(swapPaneIdsInLayout(null, 'a', 'b')).toBeNull();
  });

  it('returns clone when a === b', () => {
    const node = leaf('a');
    const result = swapPaneIdsInLayout(node, 'a', 'a');
    expect(result).toEqual(node);
  });

  it('swaps matching leaf pane id from a to b', () => {
    const result = swapPaneIdsInLayout(leaf('a'), 'a', 'b');
    expect((result as LayoutLeaf).paneId).toBe('b');
  });

  it('swaps two pane ids anywhere in the tree', () => {
    const tree = split(leaf('a'), leaf('b'));
    const result = swapPaneIdsInLayout(tree, 'a', 'b');
    expect(collectLeafPaneIds(result)).toEqual(['b', 'a']);
  });

  it('leaves unrelated leaves unchanged', () => {
    const tree = split(leaf('a'), leaf('b'));
    const result = swapPaneIdsInLayout(tree, 'c', 'd');
    expect(collectLeafPaneIds(result)).toEqual(['a', 'b']);
  });
});

// ===========================================================================
// dockPaneToEdgeInLayout
// ===========================================================================
describe('dockPaneToEdgeInLayout', () => {
  it('creates a new leaf when layoutRoot is null', () => {
    const result = dockPaneToEdgeInLayout(null, 'a', 'left');
    expect(result).not.toBeNull();
    expect(collectLeafPaneIds(result!)).toEqual(['a']);
  });

  it('returns layout unchanged when paneId is not in tree', () => {
    const tree = leaf('a');
    const result = dockPaneToEdgeInLayout(tree, 'b', 'left');
    expect(result).toBe(tree);
  });

  it('docks pane to left', () => {
    const tree = split(leaf('a'), leaf('b'));
    const result = dockPaneToEdgeInLayout(tree, 'b', 'left');
    const ids = collectLeafPaneIds(result!);
    expect(ids[0]).toBe('b');
  });

  it('docks pane to right', () => {
    const tree = split(leaf('a'), leaf('b'));
    const result = dockPaneToEdgeInLayout(tree, 'a', 'right');
    const ids = collectLeafPaneIds(result!);
    expect(ids[ids.length - 1]).toBe('a');
  });

  it('docks pane to top', () => {
    const tree = split(leaf('a'), leaf('b'));
    const result = dockPaneToEdgeInLayout(tree, 'b', 'top');
    const splitNode = result as LayoutSplit;
    expect(splitNode.orientation).toBe('vertical');
    expect((splitNode.first as LayoutLeaf).paneId).toBe('b');
  });

  it('docks pane to bottom', () => {
    const tree = split(leaf('a'), leaf('b'));
    const result = dockPaneToEdgeInLayout(tree, 'a', 'bottom');
    const splitNode = result as LayoutSplit;
    expect(splitNode.orientation).toBe('vertical');
    expect((splitNode.second as LayoutLeaf).paneId).toBe('a');
  });

  it('returns a single leaf when removing leaves only pane', () => {
    const tree = leaf('a');
    const result = dockPaneToEdgeInLayout(tree, 'a', 'left');
    expect(collectLeafPaneIds(result!)).toEqual(['a']);
  });
});

// ===========================================================================
// setSplitRatioInLayout
// ===========================================================================
describe('setSplitRatioInLayout', () => {
  it('returns null for null input', () => {
    expect(setSplitRatioInLayout(null, 'node-1', 0.3)).toBeNull();
  });

  it('returns leaf unchanged when given a leaf', () => {
    const l = leaf('a');
    expect(setSplitRatioInLayout(l, 'node-1', 0.3)).toEqual(l);
  });

  it('updates ratio on matching split node', () => {
    const s = split(leaf('a'), leaf('b'), 'horizontal', 0.5, 'target');
    const result = setSplitRatioInLayout(s, 'target', 0.7) as LayoutSplit;
    expect(result.ratio).toBe(0.7);
  });

  it('clamps ratio to 0.1 minimum', () => {
    const s = split(leaf('a'), leaf('b'), 'horizontal', 0.5, 'target');
    const result = setSplitRatioInLayout(s, 'target', 0.01) as LayoutSplit;
    expect(result.ratio).toBe(0.1);
  });

  it('clamps ratio to 0.9 maximum', () => {
    const s = split(leaf('a'), leaf('b'), 'horizontal', 0.5, 'target');
    const result = setSplitRatioInLayout(s, 'target', 0.99) as LayoutSplit;
    expect(result.ratio).toBe(0.9);
  });

  it('recursively updates nested split nodes', () => {
    const inner = split(leaf('a'), leaf('b'), 'horizontal', 0.5, 'inner');
    const outer = split(inner, leaf('c'), 'vertical', 0.5, 'outer');
    const result = setSplitRatioInLayout(outer, 'inner', 0.8) as LayoutSplit;
    expect(((result.first) as LayoutSplit).ratio).toBe(0.8);
  });
});

// ===========================================================================
// findFirstLeafPaneId
// ===========================================================================
describe('findFirstLeafPaneId', () => {
  it('returns null for null input', () => {
    expect(findFirstLeafPaneId(null)).toBeNull();
  });

  it('returns pane id of a single leaf', () => {
    expect(findFirstLeafPaneId(leaf('a'))).toBe('a');
  });

  it('returns the leftmost leaf pane id', () => {
    const tree = split(leaf('a'), split(leaf('b'), leaf('c')));
    expect(findFirstLeafPaneId(tree)).toBe('a');
  });

  it('follows the first branch deeply', () => {
    const tree = split(split(leaf('deep'), leaf('b')), leaf('c'));
    expect(findFirstLeafPaneId(tree)).toBe('deep');
  });
});

// ===========================================================================
// hasUnlockedLeaf
// ===========================================================================
describe('hasUnlockedLeaf', () => {
  it('returns false for null layout', () => {
    expect(hasUnlockedLeaf(null, emptyState)).toBe(false);
  });

  it('returns true for an unlocked pane', () => {
    const state = { panes: [makePane('a', false)], browserPane: null, browserVisible: false, editorPane: null, editorVisible: false };
    expect(hasUnlockedLeaf(leaf('a'), state)).toBe(true);
  });

  it('returns false for a locked pane', () => {
    const state = { panes: [makePane('a', true)], browserPane: null, browserVisible: false, editorPane: null, editorVisible: false };
    expect(hasUnlockedLeaf(leaf('a'), state)).toBe(false);
  });

  it('returns true when at least one leaf is unlocked in a split', () => {
    const state = { panes: [makePane('a', true), makePane('b', false)], browserPane: null, browserVisible: false, editorPane: null, editorVisible: false };
    expect(hasUnlockedLeaf(split(leaf('a'), leaf('b')), state)).toBe(true);
  });

  it('returns false when all leaves are locked', () => {
    const state = { panes: [makePane('a', true), makePane('b', true)], browserPane: null, browserVisible: false, editorPane: null, editorVisible: false };
    expect(hasUnlockedLeaf(split(leaf('a'), leaf('b')), state)).toBe(false);
  });

  it('checks browser pane lock status when browser is visible', () => {
    const state = {
      panes: [makePane('a', true)],
      browserPane: makeBrowser('bp', false),
      browserVisible: true,
      editorPane: null,
      editorVisible: false,
    };
    const tree = split(leaf('a'), leaf('bp'));
    expect(hasUnlockedLeaf(tree, state)).toBe(true);
  });
});

// ===========================================================================
// insertPaneIntoLayout
// ===========================================================================
describe('insertPaneIntoLayout', () => {
  it('creates a leaf when layoutRoot is null', () => {
    const result = insertPaneIntoLayout(null, 'new', { ...emptyState, activeTerminalId: null });
    expect(collectLeafPaneIds(result!)).toEqual(['new']);
  });

  it('inserts next to the active terminal pane', () => {
    const panes = [makePane('a'), makePane('b')];
    const state = { panes, browserPane: null, browserVisible: false, editorPane: null, editorVisible: false, activeTerminalId: 'term-a' };
    const tree = split(leaf('a'), leaf('b'));
    const result = insertPaneIntoLayout(tree, 'new', state);
    const ids = collectLeafPaneIds(result!);
    expect(ids).toContain('new');
    expect(ids).toContain('a');
    // 'a' was split, so 'new' should be near 'a'
    expect(ids.length).toBe(3);
  });

  it('falls back to largest unlocked leaf when active terminal has no matching pane', () => {
    const panes = [makePane('a'), makePane('b')];
    const state = { panes, browserPane: null, browserVisible: false, editorPane: null, editorVisible: false, activeTerminalId: null };
    const tree = split(leaf('a'), leaf('b'));
    const result = insertPaneIntoLayout(tree, 'new', state);
    expect(collectLeafPaneIds(result!).length).toBe(3);
  });

  it('returns layout unchanged when all panes are locked', () => {
    const panes = [makePane('a', true), makePane('b', true)];
    const state = { panes, browserPane: null, browserVisible: false, editorPane: null, editorVisible: false, activeTerminalId: null };
    const tree = split(leaf('a'), leaf('b'));
    const result = insertPaneIntoLayout(tree, 'new', state);
    // All leaves locked, so the layout should be unchanged
    expect(collectLeafPaneIds(result!)).toEqual(['a', 'b']);
  });
});

// ===========================================================================
// normalizeLayoutRoot
// ===========================================================================
describe('normalizeLayoutRoot', () => {
  it('builds balanced layout from pane ids when layoutRoot is null', () => {
    const panes = [makePane('a'), makePane('b')];
    const state = { panes, browserPane: null, browserVisible: false, editorPane: null, editorVisible: false };
    const result = normalizeLayoutRoot(null, state);
    const ids = collectLeafPaneIds(result!);
    expect(ids.sort()).toEqual(['a', 'b']);
  });

  it('prunes leaves not in the visible set', () => {
    const tree = split(leaf('a'), split(leaf('b'), leaf('c')));
    const panes = [makePane('a'), makePane('c')]; // 'b' removed
    const state = { panes, browserPane: null, browserVisible: false, editorPane: null, editorVisible: false };
    const result = normalizeLayoutRoot(tree, state);
    const ids = collectLeafPaneIds(result!);
    expect(ids.sort()).toEqual(['a', 'c']);
  });

  it('includes browser pane when visible', () => {
    const panes = [makePane('a')];
    const state = { panes, browserPane: makeBrowser('bp'), browserVisible: true, editorPane: null, editorVisible: false };
    const result = normalizeLayoutRoot(null, state);
    const ids = collectLeafPaneIds(result!);
    expect(ids.sort()).toEqual(['a', 'bp']);
  });

  it('excludes browser pane when not visible', () => {
    const panes = [makePane('a')];
    const state = { panes, browserPane: makeBrowser('bp'), browserVisible: false, editorPane: null, editorVisible: false };
    const result = normalizeLayoutRoot(null, state);
    const ids = collectLeafPaneIds(result!);
    expect(ids).toEqual(['a']);
  });
});

// ===========================================================================
// buildWorkspaceLayout
// ===========================================================================
describe('buildWorkspaceLayout', () => {
  it('returns null when there are no panes and no browser', () => {
    const result = buildWorkspaceLayout({
      panes: [],
      browserVisible: false,
      browserPane: null,
      editorVisible: false,
      editorPane: null,
      layoutRoot: null,
    });
    expect(result).toBeNull();
  });

  it('builds layout from panes when layoutRoot is null', () => {
    const result = buildWorkspaceLayout({
      panes: [makePane('a'), makePane('b')],
      browserVisible: false,
      browserPane: null,
      editorVisible: false,
      editorPane: null,
      layoutRoot: null,
    });
    expect(collectLeafPaneIds(result!).sort()).toEqual(['a', 'b']);
  });

  it('uses existing layoutRoot after normalization', () => {
    const tree = split(leaf('a'), leaf('b'));
    const result = buildWorkspaceLayout({
      panes: [makePane('a'), makePane('b')],
      browserVisible: false,
      browserPane: null,
      editorVisible: false,
      editorPane: null,
      layoutRoot: tree,
    });
    expect(collectLeafPaneIds(result!).sort()).toEqual(['a', 'b']);
  });
});

// ===========================================================================
// Constants
// ===========================================================================
describe('constants', () => {
  it('exports expected grid dimensions', () => {
    expect(GRID_COLS).toBe(12);
    expect(GRID_ROWS).toBe(8);
  });
});
