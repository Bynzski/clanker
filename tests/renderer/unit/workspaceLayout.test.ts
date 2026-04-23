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
  getEdgeTerminals,
  getEdgeGaps,
} from '../../../src/renderer/store/workspaceLayout';
import type { EdgeTerminal } from '../../../src/renderer/store/workspaceLayout';
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
// normalizeLayoutRoot - additional edge cases
// ===========================================================================
describe('normalizeLayoutRoot - additional edge cases', () => {
  it('includes editor pane when visible', () => {
    const panes = [makePane('a')];
    const state = {
      panes,
      browserPane: null,
      browserVisible: false,
      editorPane: { id: 'ep', locked: false },
      editorVisible: true,
    };
    const result = normalizeLayoutRoot(null, state);
    const ids = collectLeafPaneIds(result!);
    expect(ids.sort()).toEqual(['a', 'ep']);
  });

  it('excludes editor pane when not visible', () => {
    const panes = [makePane('a')];
    const state = {
      panes,
      browserPane: null,
      browserVisible: false,
      editorPane: { id: 'ep', locked: false },
      editorVisible: false,
    };
    const result = normalizeLayoutRoot(null, state);
    const ids = collectLeafPaneIds(result!);
    expect(ids).toEqual(['a']);
  });

  it('includes both browser and editor panes when both visible', () => {
    const panes = [makePane('a')];
    const state = {
      panes,
      browserPane: makeBrowser('bp'),
      browserVisible: true,
      editorPane: { id: 'ep', locked: false },
      editorVisible: true,
    };
    const result = normalizeLayoutRoot(null, state);
    const ids = collectLeafPaneIds(result!);
    expect(ids.sort()).toEqual(['a', 'bp', 'ep']);
  });

  it('prunes orphaned pane references from layout tree', () => {
    const tree = split(leaf('a'), split(leaf('b'), leaf('c')));
    const panes = [makePane('a')];
    const state = { panes, browserPane: null, browserVisible: false, editorPane: null, editorVisible: false };
    const result = normalizeLayoutRoot(tree, state);
    const ids = collectLeafPaneIds(result!);
    expect(ids).toEqual(['a']);
  });

  it('collapses split when one child is pruned', () => {
    const tree = split(leaf('a'), split(leaf('b'), leaf('c')));
    const panes = [makePane('a'), makePane('c')];
    const state = { panes, browserPane: null, browserVisible: false, editorPane: null, editorVisible: false };
    const result = normalizeLayoutRoot(tree, state);
    const ids = collectLeafPaneIds(result!);
    expect(ids.sort()).toEqual(['a', 'c']);
  });

  it('returns null when all panes are pruned', () => {
    const tree = split(leaf('a'), leaf('b'));
    const panes: Pane[] = [];
    const state = { panes, browserPane: null, browserVisible: false, editorPane: null, editorVisible: false };
    const result = normalizeLayoutRoot(tree, state);
    expect(result).toBeNull();
  });
});

// ===========================================================================
// buildWorkspaceLayout - additional edge cases
// ===========================================================================
describe('buildWorkspaceLayout - additional edge cases', () => {
  it('includes browser pane in layout when visible', () => {
    const result = buildWorkspaceLayout({
      panes: [makePane('a')],
      browserVisible: true,
      browserPane: makeBrowser('bp'),
      editorVisible: false,
      editorPane: null,
      layoutRoot: null,
    });
    const ids = collectLeafPaneIds(result!);
    expect(ids.sort()).toEqual(['a', 'bp']);
  });

  it('includes editor pane in layout when visible', () => {
    const result = buildWorkspaceLayout({
      panes: [makePane('a')],
      browserVisible: false,
      browserPane: null,
      editorVisible: true,
      editorPane: { id: 'ep', locked: false },
      layoutRoot: null,
    });
    const ids = collectLeafPaneIds(result!);
    expect(ids.sort()).toEqual(['a', 'ep']);
  });

  it('includes both browser and editor when both visible', () => {
    const result = buildWorkspaceLayout({
      panes: [makePane('a')],
      browserVisible: true,
      browserPane: makeBrowser('bp'),
      editorVisible: true,
      editorPane: { id: 'ep', locked: false },
      layoutRoot: null,
    });
    const ids = collectLeafPaneIds(result!);
    expect(ids.sort()).toEqual(['a', 'bp', 'ep']);
  });

  it('normalizes existing layoutRoot before returning', () => {
    const tree = split(leaf('a'), split(leaf('b'), leaf('c')));
    const panes = [makePane('a'), makePane('c')];
    const result = buildWorkspaceLayout({
      panes,
      browserVisible: false,
      browserPane: null,
      editorVisible: false,
      editorPane: null,
      layoutRoot: tree,
    });
    const ids = collectLeafPaneIds(result!);
    expect(ids.sort()).toEqual(['a', 'c']);
  });

  it('returns null when layoutRoot normalizes to null and no panes exist', () => {
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
});

// ===========================================================================
// insertPaneIntoLayout - additional edge cases
// ===========================================================================
describe('insertPaneIntoLayout - additional edge cases', () => {
  it('uses activeTerminalId to find target pane for split', () => {
    const panes = [makePane('a'), makePane('b')];
    const state = {
      panes,
      browserPane: null,
      browserVisible: false,
      editorPane: null,
      editorVisible: false,
      activeTerminalId: 'term-b',
    };
    const tree = split(leaf('a'), leaf('b'));
    const result = insertPaneIntoLayout(tree, 'new', state);
    const ids = collectLeafPaneIds(result!);
    expect(ids).toContain('new');
    expect(ids).toContain('b');
    expect(ids.length).toBe(3);
  });

  it('ignores activeTerminalId if corresponding pane is locked', () => {
    const panes = [makePane('a', true), makePane('b', false)];
    const state = {
      panes,
      browserPane: null,
      browserVisible: false,
      editorPane: null,
      editorVisible: false,
      activeTerminalId: 'term-a',
    };
    const tree = split(leaf('a'), leaf('b'));
    const result = insertPaneIntoLayout(tree, 'new', state);
    const ids = collectLeafPaneIds(result!);
    expect(ids).toContain('new');
    expect(ids).toContain('b');
    expect(ids.length).toBe(3);
  });

  it('ignores activeTerminalId if pane is not in layout tree', () => {
    const panes = [makePane('a'), makePane('b'), makePane('c')];
    const state = {
      panes,
      browserPane: null,
      browserVisible: false,
      editorPane: null,
      editorVisible: false,
      activeTerminalId: 'term-c',
    };
    const tree = split(leaf('a'), leaf('b'));
    const result = insertPaneIntoLayout(tree, 'new', state);
    const ids = collectLeafPaneIds(result!);
    expect(ids).toContain('new');
    expect(ids.length).toBe(3);
  });

  it('respects browser pane lock status during insertion', () => {
    const panes = [makePane('a', true)];
    const state = {
      panes,
      browserPane: makeBrowser('bp', false),
      browserVisible: true,
      editorPane: null,
      editorVisible: false,
      activeTerminalId: null,
    };
    const tree = split(leaf('a'), leaf('bp'));
    const result = insertPaneIntoLayout(tree, 'new', state);
    const ids = collectLeafPaneIds(result!);
    expect(ids).toContain('new');
    expect(ids.length).toBe(3);
  });

  it('respects editor pane lock status during insertion', () => {
    const panes = [makePane('a', true)];
    const state = {
      panes,
      browserPane: null,
      browserVisible: false,
      editorPane: { id: 'ep', locked: false },
      editorVisible: true,
      activeTerminalId: null,
    };
    const tree = split(leaf('a'), leaf('ep'));
    const result = insertPaneIntoLayout(tree, 'new', state);
    const ids = collectLeafPaneIds(result!);
    expect(ids).toContain('new');
    expect(ids.length).toBe(3);
  });
});

// ===========================================================================
// hasUnlockedLeaf - additional edge cases
// ===========================================================================
describe('hasUnlockedLeaf - additional edge cases', () => {
  it('checks editor pane lock status when editor is visible', () => {
    const state = {
      panes: [makePane('a', true)],
      browserPane: null,
      browserVisible: false,
      editorPane: { id: 'ep', locked: false },
      editorVisible: true,
    };
    const tree = split(leaf('a'), leaf('ep'));
    expect(hasUnlockedLeaf(tree, state)).toBe(true);
  });

  it('returns false when editor pane is locked and all other panes are locked', () => {
    const state = {
      panes: [makePane('a', true)],
      browserPane: null,
      browserVisible: false,
      editorPane: { id: 'ep', locked: true },
      editorVisible: true,
    };
    const tree = split(leaf('a'), leaf('ep'));
    expect(hasUnlockedLeaf(tree, state)).toBe(false);
  });

  it('handles nested splits with mixed lock states', () => {
    const state = {
      panes: [makePane('a', true), makePane('b', false), makePane('c', true)],
      browserPane: null,
      browserVisible: false,
      editorPane: null,
      editorVisible: false,
    };
    const tree = split(leaf('a'), split(leaf('b'), leaf('c')));
    expect(hasUnlockedLeaf(tree, state)).toBe(true);
  });
});

// ===========================================================================
// dockPaneToEdgeInLayout - additional edge cases
// ===========================================================================
describe('dockPaneToEdgeInLayout - additional edge cases', () => {
  it('preserves tree structure when docking to left', () => {
    const tree = split(leaf('a'), leaf('b'));
    const result = dockPaneToEdgeInLayout(tree, 'a', 'left');
    const splitNode = result as LayoutSplit;
    expect(splitNode.orientation).toBe('horizontal');
    expect((splitNode.first as LayoutLeaf).paneId).toBe('a');
  });

  it('preserves tree structure when docking to right', () => {
    const tree = split(leaf('a'), leaf('b'));
    const result = dockPaneToEdgeInLayout(tree, 'b', 'right');
    const splitNode = result as LayoutSplit;
    expect(splitNode.orientation).toBe('horizontal');
    expect((splitNode.second as LayoutLeaf).paneId).toBe('b');
  });

  it('preserves tree structure when docking to top', () => {
    const tree = split(leaf('a'), leaf('b'));
    const result = dockPaneToEdgeInLayout(tree, 'a', 'top');
    const splitNode = result as LayoutSplit;
    expect(splitNode.orientation).toBe('vertical');
    expect((splitNode.first as LayoutLeaf).paneId).toBe('a');
  });

  it('preserves tree structure when docking to bottom', () => {
    const tree = split(leaf('a'), leaf('b'));
    const result = dockPaneToEdgeInLayout(tree, 'b', 'bottom');
    const splitNode = result as LayoutSplit;
    expect(splitNode.orientation).toBe('vertical');
    expect((splitNode.second as LayoutLeaf).paneId).toBe('b');
  });

  it('handles complex nested tree when docking', () => {
    const tree = split(split(leaf('a'), leaf('b')), split(leaf('c'), leaf('d')));
    const result = dockPaneToEdgeInLayout(tree, 'c', 'left');
    const ids = collectLeafPaneIds(result!);
    expect(ids[0]).toBe('c');
    expect(ids.length).toBe(4);
  });
});

// ===========================================================================
// swapPaneIdsInLayout - additional edge cases
// ===========================================================================
describe('swapPaneIdsInLayout - additional edge cases', () => {
  it('preserves nodeId in cloned leaf', () => {
    const node: LayoutLeaf = { type: 'leaf', nodeId: 'custom-id', paneId: 'a' };
    const result = swapPaneIdsInLayout(node, 'a', 'b');
    expect(result).toEqual({ type: 'leaf', nodeId: 'custom-id', paneId: 'b' });
  });

  it('deeply clones nested splits', () => {
    const tree = split(leaf('a'), split(leaf('b'), leaf('c')));
    const result = swapPaneIdsInLayout(tree, 'a', 'x');
    expect(result).not.toBe(tree);
    expect((result as LayoutSplit).first).not.toBe((tree as LayoutSplit).first);
  });

  it('swaps pane ids in deeply nested structure', () => {
    const tree = split(split(leaf('a'), leaf('b')), split(leaf('c'), leaf('d')));
    const result = swapPaneIdsInLayout(tree, 'a', 'z');
    const ids = collectLeafPaneIds(result!);
    expect(ids).toContain('z');
    expect(ids).not.toContain('a');
    expect(ids.length).toBe(4);
  });
});

// ===========================================================================
// removePaneFromLayout - additional edge cases
// ===========================================================================
describe('removePaneFromLayout - additional edge cases', () => {
  it('preserves nodeId in cloned leaf', () => {
    const node: LayoutLeaf = { type: 'leaf', nodeId: 'custom-id', paneId: 'a' };
    const result = removePaneFromLayout(node, 'b');
    expect(result).toEqual({ type: 'leaf', nodeId: 'custom-id', paneId: 'a' });
  });

  it('collapses multiple levels when removing panes', () => {
    const tree = split(split(leaf('a'), leaf('b')), split(leaf('c'), leaf('d')));
    const result = removePaneFromLayout(tree, 'b');
    const ids = collectLeafPaneIds(result!);
    expect(ids.sort()).toEqual(['a', 'c', 'd']);
  });

  it('returns null when removing last pane from complex tree', () => {
    const tree = split(leaf('a'), leaf('b'));
    const result1 = removePaneFromLayout(tree, 'a');
    const result2 = removePaneFromLayout(result1!, 'b');
    expect(result2).toBeNull();
  });

  it('preserves split orientation when collapsing', () => {
    const tree = split(leaf('a'), leaf('b'), 'vertical');
    const result = removePaneFromLayout(tree, 'a');
    expect(result).toEqual(leaf('b'));
  });
});

// ===========================================================================
// setSplitRatioInLayout - additional edge cases
// ===========================================================================
describe('setSplitRatioInLayout - additional edge cases', () => {
  it('preserves leaf nodes unchanged', () => {
    const leaf1: LayoutLeaf = { type: 'leaf', nodeId: 'l1', paneId: 'a' };
    const result = setSplitRatioInLayout(leaf1, 'l1', 0.7);
    expect(result).toEqual(leaf1);
  });

  it('deeply clones the tree when updating ratio', () => {
    const inner = split(leaf('a'), leaf('b'), 'horizontal', 0.5, 'inner');
    const outer = split(inner, leaf('c'), 'vertical', 0.5, 'outer');
    const result = setSplitRatioInLayout(outer, 'inner', 0.8);
    expect(result).not.toBe(outer);
    expect((result as LayoutSplit).first).not.toBe(inner);
  });

  it('preserves nodeIds in cloned splits', () => {
    const inner = split(leaf('a'), leaf('b'), 'horizontal', 0.5, 'inner');
    const outer = split(inner, leaf('c'), 'vertical', 0.5, 'outer');
    const result = setSplitRatioInLayout(outer, 'inner', 0.8) as LayoutSplit;
    expect(result.nodeId).toBe('outer');
    expect((result.first as LayoutSplit).nodeId).toBe('inner');
  });

  it('does not modify tree when nodeId not found', () => {
    const tree = split(leaf('a'), leaf('b'), 'horizontal', 0.5, 'target');
    const result = setSplitRatioInLayout(tree, 'nonexistent', 0.8);
    expect(result).toEqual(tree);
    expect(result).not.toBe(tree);
  });
});

// ===========================================================================
// findFirstLeafPaneId - additional edge cases
// ===========================================================================
describe('findFirstLeafPaneId - additional edge cases', () => {
  it('returns right branch when left is null', () => {
    const tree = {
      type: 'split' as const,
      nodeId: 's1',
      orientation: 'horizontal' as const,
      ratio: 0.5,
      first: null as unknown as LayoutNode,
      second: leaf('b'),
    };
    expect(findFirstLeafPaneId(tree)).toBe('b');
  });

  it('handles deeply nested left-heavy tree', () => {
    const tree = split(split(split(leaf('deep'), leaf('b')), leaf('c')), leaf('d'));
    expect(findFirstLeafPaneId(tree)).toBe('deep');
  });
});

// ===========================================================================
// collectLeafPaneIds - additional edge cases
// ===========================================================================
describe('collectLeafPaneIds - additional edge cases', () => {
  it('handles deeply nested tree', () => {
    const tree = split(split(leaf('a'), split(leaf('b'), leaf('c'))), split(leaf('d'), leaf('e')));
    const ids = collectLeafPaneIds(tree);
    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('handles single leaf', () => {
    expect(collectLeafPaneIds(leaf('single'))).toEqual(['single']);
  });
});

// ===========================================================================
// Layout tree invariant tests
// ===========================================================================
describe('Layout tree invariants', () => {
  it('maintains pane ID consistency after remove operation', () => {
    const panes = [makePane('a'), makePane('b'), makePane('c')];
    const tree = split(leaf('a'), split(leaf('b'), leaf('c')));
    const result = removePaneFromLayout(tree, 'b');
    const ids = collectLeafPaneIds(result!);
    ids.forEach(id => {
      expect(panes.some(p => p.id === id)).toBe(true);
    });
  });

  it('maintains pane ID consistency after swap operation', () => {
    const panes = [makePane('a'), makePane('b'), makePane('c')];
    const tree = split(leaf('a'), split(leaf('b'), leaf('c')));
    const result = swapPaneIdsInLayout(tree, 'a', 'b');
    const ids = collectLeafPaneIds(result!);
    ids.forEach(id => {
      expect(panes.some(p => p.id === id)).toBe(true);
    });
  });

  it('maintains pane ID consistency after dock operation', () => {
    const panes = [makePane('a'), makePane('b'), makePane('c')];
    const tree = split(leaf('a'), split(leaf('b'), leaf('c')));
    const result = dockPaneToEdgeInLayout(tree, 'c', 'left');
    const ids = collectLeafPaneIds(result!);
    ids.forEach(id => {
      expect(panes.some(p => p.id === id)).toBe(true);
    });
  });

  it('ensures all pane IDs in normalized layout exist in visible set', () => {
    const tree = split(leaf('a'), split(leaf('b'), leaf('c')));
    const panes = [makePane('a'), makePane('c')];
    const state = { panes, browserPane: null, browserVisible: false, editorPane: null, editorVisible: false };
    const result = normalizeLayoutRoot(tree, state);
    const ids = collectLeafPaneIds(result!);
    ids.forEach(id => {
      expect(panes.some(p => p.id === id)).toBe(true);
    });
  });

  it('ensures insertPaneIntoLayout only adds valid pane IDs', () => {
    const panes = [makePane('a'), makePane('b')];
    const state = { panes, browserPane: null, browserVisible: false, editorPane: null, editorVisible: false, activeTerminalId: null };
    const tree = split(leaf('a'), leaf('b'));
    const result = insertPaneIntoLayout(tree, 'new', state);
    const ids = collectLeafPaneIds(result!);
    expect(ids).toContain('new');
    expect(ids.length).toBe(3);
  });
});

// ===========================================================================
// getEdgeTerminals
// ===========================================================================
describe('getEdgeTerminals', () => {
  it('returns empty array for null layout', () => {
    expect(getEdgeTerminals(null, 'left')).toEqual([]);
    expect(getEdgeTerminals(null, 'right')).toEqual([]);
    expect(getEdgeTerminals(null, 'top')).toEqual([]);
    expect(getEdgeTerminals(null, 'bottom')).toEqual([]);
  });

  it('returns the single leaf spanning the full edge for all four edges', () => {
    const tree: LayoutNode = leaf('a');
    const expected = [{ paneId: 'a', offset: 0, span: 1 }];
    expect(getEdgeTerminals(tree, 'left')).toEqual(expected);
    expect(getEdgeTerminals(tree, 'right')).toEqual(expected);
    expect(getEdgeTerminals(tree, 'top')).toEqual(expected);
    expect(getEdgeTerminals(tree, 'bottom')).toEqual(expected);
  });

  it('follows first child of horizontal split for left edge', () => {
    const tree = split(leaf('a'), leaf('b'), 'horizontal', 0.5);
    expect(getEdgeTerminals(tree, 'left')).toEqual([
      { paneId: 'a', offset: 0, span: 1 },
    ]);
  });

  it('follows second child of horizontal split for right edge', () => {
    const tree = split(leaf('a'), leaf('b'), 'horizontal', 0.5);
    expect(getEdgeTerminals(tree, 'right')).toEqual([
      { paneId: 'b', offset: 0, span: 1 },
    ]);
  });

  it('follows first child of vertical split for top edge', () => {
    const tree = split(leaf('a'), leaf('b'), 'vertical', 0.5);
    expect(getEdgeTerminals(tree, 'top')).toEqual([
      { paneId: 'a', offset: 0, span: 1 },
    ]);
  });

  it('follows second child of vertical split for bottom edge', () => {
    const tree = split(leaf('a'), leaf('b'), 'vertical', 0.5);
    expect(getEdgeTerminals(tree, 'bottom')).toEqual([
      { paneId: 'b', offset: 0, span: 1 },
    ]);
  });

  it('splits span across both children at a vertical split for left edge', () => {
    const tree = split(leaf('a'), leaf('b'), 'vertical', 0.5);
    expect(getEdgeTerminals(tree, 'left')).toEqual([
      { paneId: 'a', offset: 0, span: 0.5 },
      { paneId: 'b', offset: 0.5, span: 0.5 },
    ]);
  });

  it('splits span across both children at a vertical split for right edge', () => {
    const tree = split(leaf('a'), leaf('b'), 'vertical', 0.3);
    expect(getEdgeTerminals(tree, 'right')).toEqual([
      { paneId: 'a', offset: 0, span: 0.3 },
      { paneId: 'b', offset: 0.3, span: 0.7 },
    ]);
  });

  it('splits span across both children at a horizontal split for top edge', () => {
    const tree = split(leaf('a'), leaf('b'), 'horizontal', 0.4);
    expect(getEdgeTerminals(tree, 'top')).toEqual([
      { paneId: 'a', offset: 0, span: 0.4 },
      { paneId: 'b', offset: 0.4, span: 0.6 },
    ]);
  });

  it('splits span across both children at a horizontal split for bottom edge', () => {
    const tree = split(leaf('a'), leaf('b'), 'horizontal', 0.25);
    expect(getEdgeTerminals(tree, 'bottom')).toEqual([
      { paneId: 'a', offset: 0, span: 0.25 },
      { paneId: 'b', offset: 0.25, span: 0.75 },
    ]);
  });

  it('handles deep nesting: left edge of vertical-over-horizontal tree', () => {
    // Root vertical split: top half is horizontal(A|B), bottom half is C
    const tree = split(
      split(leaf('a'), leaf('b'), 'horizontal', 0.5),
      leaf('c'),
      'vertical',
      0.5,
    );
    // Left edge: at root (vertical), recurse both halves.
    //   top half is horizontal — follow first: A at offset 0, span 0.5
    //   bottom half is leaf C at offset 0.5, span 0.5
    expect(getEdgeTerminals(tree, 'left')).toEqual([
      { paneId: 'a', offset: 0, span: 0.5 },
      { paneId: 'c', offset: 0.5, span: 0.5 },
    ]);
  });

  it('handles deep nesting: right edge picks second child at horizontal splits', () => {
    const tree = split(
      split(leaf('a'), leaf('b'), 'horizontal', 0.5),
      leaf('c'),
      'vertical',
      0.5,
    );
    expect(getEdgeTerminals(tree, 'right')).toEqual([
      { paneId: 'b', offset: 0, span: 0.5 },
      { paneId: 'c', offset: 0.5, span: 0.5 },
    ]);
  });

  it('handles deep nesting: top edge spans both horizontal children', () => {
    // Root horizontal: left is vertical(A/B), right is C
    const tree = split(
      split(leaf('a'), leaf('b'), 'vertical', 0.5),
      leaf('c'),
      'horizontal',
      0.5,
    );
    // Top edge: at root (horizontal), recurse both halves.
    //   left half is vertical — follow first: A at offset 0, span 0.5
    //   right half is leaf C at offset 0.5, span 0.5
    expect(getEdgeTerminals(tree, 'top')).toEqual([
      { paneId: 'a', offset: 0, span: 0.5 },
      { paneId: 'c', offset: 0.5, span: 0.5 },
    ]);
  });

  it('accumulates offset across multiple perpendicular splits', () => {
    // Left edge: vertical(A, vertical(B, C, 0.5), 0.4)
    // Outer ratio 0.4 → A spans 0.4, inner spans 0.6
    // Inner ratio 0.5 → B spans 0.3, C spans 0.3
    const tree = split(
      leaf('a'),
      split(leaf('b'), leaf('c'), 'vertical', 0.5),
      'vertical',
      0.4,
    );
    const terminals = getEdgeTerminals(tree, 'left');
    expect(terminals).toHaveLength(3);
    expect(terminals[0]).toEqual({ paneId: 'a', offset: 0, span: 0.4 });
    expect(terminals[1].paneId).toBe('b');
    expect(terminals[1].offset).toBeCloseTo(0.4);
    expect(terminals[1].span).toBeCloseTo(0.3);
    expect(terminals[2].paneId).toBe('c');
    expect(terminals[2].offset).toBeCloseTo(0.7);
    expect(terminals[2].span).toBeCloseTo(0.3);
  });
});

// ===========================================================================
// getEdgeGaps
// ===========================================================================
describe('getEdgeGaps', () => {
  it('returns a single full-span gap for empty terminals', () => {
    expect(getEdgeGaps([], 4)).toEqual([{ index: 0, start: 0, end: 1 }]);
  });

  it('returns 2 gaps (before + after) for a single terminal', () => {
    const terminals: EdgeTerminal[] = [{ paneId: 'a', offset: 0, span: 1 }];
    expect(getEdgeGaps(terminals, 4)).toEqual([
      { index: 0, start: 0, end: 0, afterPaneId: undefined, beforePaneId: 'a' },
      { index: 1, start: 1, end: 1, afterPaneId: 'a', beforePaneId: undefined },
    ]);
  });

  it('returns N+1 gaps for N terminals with correct before/after pane ids', () => {
    const terminals: EdgeTerminal[] = [
      { paneId: 'a', offset: 0, span: 1 / 3 },
      { paneId: 'b', offset: 1 / 3, span: 1 / 3 },
      { paneId: 'c', offset: 2 / 3, span: 1 / 3 },
    ];
    const gaps = getEdgeGaps(terminals, 4);
    expect(gaps).toHaveLength(4);
    expect(gaps[0]).toMatchObject({ index: 0, afterPaneId: undefined, beforePaneId: 'a' });
    expect(gaps[1]).toMatchObject({ index: 1, afterPaneId: 'a', beforePaneId: 'b' });
    expect(gaps[2]).toMatchObject({ index: 2, afterPaneId: 'b', beforePaneId: 'c' });
    expect(gaps[3]).toMatchObject({ index: 3, afterPaneId: 'c', beforePaneId: undefined });
  });

  it('caps the number of gaps at maxSegments', () => {
    const terminals: EdgeTerminal[] = [
      { paneId: 'a', offset: 0, span: 0.2 },
      { paneId: 'b', offset: 0.2, span: 0.2 },
      { paneId: 'c', offset: 0.4, span: 0.2 },
      { paneId: 'd', offset: 0.6, span: 0.2 },
      { paneId: 'e', offset: 0.8, span: 0.2 },
    ];
    const gaps = getEdgeGaps(terminals, 4);
    expect(gaps).toHaveLength(4);
    expect(gaps.map((g) => g.index)).toEqual([0, 1, 2, 3]);
  });

  it('returns an empty array when maxSegments is 0', () => {
    const terminals: EdgeTerminal[] = [{ paneId: 'a', offset: 0, span: 1 }];
    expect(getEdgeGaps(terminals, 0)).toEqual([]);
    expect(getEdgeGaps([], 0)).toEqual([]);
  });

  it('positions start/end at terminal boundaries for contiguous terminals', () => {
    const terminals: EdgeTerminal[] = [
      { paneId: 'a', offset: 0, span: 0.4 },
      { paneId: 'b', offset: 0.4, span: 0.6 },
    ];
    const gaps = getEdgeGaps(terminals, 4);
    expect(gaps[0]).toEqual({ index: 0, start: 0, end: 0, afterPaneId: undefined, beforePaneId: 'a' });
    expect(gaps[1]).toEqual({ index: 1, start: 0.4, end: 0.4, afterPaneId: 'a', beforePaneId: 'b' });
    expect(gaps[2]).toEqual({ index: 2, start: 1, end: 1, afterPaneId: 'b', beforePaneId: undefined });
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
