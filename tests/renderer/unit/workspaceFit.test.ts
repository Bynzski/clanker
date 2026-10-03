import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { collectLeafPaneIds, fitLayoutRatios } from '../../../src/renderer/store/workspaceLayout';
import type { LayoutLeaf, LayoutNode, LayoutSplit, Terminal } from '../../../src/renderer/store/workspaceTypes';
import { createWorkspaceFixture } from '../../setup/fixtures';

const getStore = () => useWorkspaceStore.getState();
const ws = (id: string) => getStore().workspaces.find((w) => w.id === id)!;
const term = (id: string): Terminal => ({ id, pid: 1, workingDir: '/workspace' });
const leaf = (nodeId: string, paneId: string): LayoutLeaf => ({ type: 'leaf', nodeId, paneId });
const split = (nodeId: string, orientation: 'horizontal' | 'vertical', ratio: number, first: LayoutNode, second: LayoutNode): LayoutSplit =>
  ({ type: 'split', nodeId, orientation, ratio, first, second });

function nodeIds(node: LayoutNode | null): string[] {
  if (node == null) return [];
  return node.type === 'leaf' ? [node.nodeId] : [node.nodeId, ...nodeIds(node.first), ...nodeIds(node.second)];
}

function setLayout(id: string, layoutRoot: LayoutNode | null) {
  useWorkspaceStore.setState((s) => ({
    workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, layoutRoot } : w)),
    layoutRoot,
  }));
}

/** Workspace with three terminals (pane ids p1..p3 in order) and an initialised browser pane. */
function setup() {
  const { id: _id, ...rest } = createWorkspaceFixture({ name: 'a', workspacePath: '/projects/a' });
  void _id;
  getStore().addWorkspace({ ...rest, panes: [], terminals: [], layoutRoot: null });
  const id = getStore().activeWorkspaceId!;
  for (const t of ['t1', 't2', 't3']) getStore().addTerminal(term(t));
  getStore().setBrowserVisible(true, id);
  const [p1, p2, p3] = ws(id).panes.map((p) => p.id);
  return { id, p1, p2, p3, browser: ws(id).browserPane!.id };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, clear: () => undefined });
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, layoutRoot: null, panes: [], terminals: [], browserPane: null, browserVisible: false, layoutRevision: 0, layoutUndoStack: [] });
});

describe('fitLayoutRatios', () => {
  it('weights each split by descendant leaf count and keeps ids/orientation', () => {
    const tree = split('s1', 'horizontal', 0.95, leaf('l1', 'a'), split('s2', 'vertical', 0.05, leaf('l2', 'b'), split('s3', 'horizontal', 0.5, leaf('l3', 'c'), leaf('l4', 'd'))));
    const fitted = fitLayoutRatios(tree) as LayoutSplit;
    expect(fitted.ratio).toBeCloseTo(0.25); // 1 pane vs 3
    const s2 = fitted.second as LayoutSplit;
    expect(s2.ratio).toBeCloseTo(1 / 3); // 1 pane vs 2
    expect((s2.second as LayoutSplit).ratio).toBe(0.5);
    expect(nodeIds(fitted)).toEqual(nodeIds(tree));
    expect(fitted.orientation).toBe('horizontal');
    expect(s2.orientation).toBe('vertical');
  });

  it('clamps extreme leaf-count skews to the 0.1-0.9 limits', () => {
    let right: LayoutNode = leaf('r0', 'r0');
    for (let i = 1; i < 14; i++) right = split(`s${i}`, 'vertical', 0.5, leaf(`r${i}`, `r${i}`), right);
    const fitted = fitLayoutRatios(split('root', 'horizontal', 0.5, leaf('l', 'l'), right)) as LayoutSplit;
    expect(fitted.ratio).toBe(0.1);
  });

  it('keeps node identity when nothing changes', () => {
    const tree = split('s1', 'horizontal', 0.5, leaf('l1', 'a'), leaf('l2', 'b'));
    expect(fitLayoutRatios(tree)).toBe(tree);
    expect(fitLayoutRatios(null)).toBeNull();
  });
});

describe('fitAllPanes', () => {
  it('preserves topology, node ids, orientation and leaf order while fixing a pathological ratio', () => {
    const { id, p1, p2, p3 } = setup();
    getStore().setBrowserVisible(false, id);
    const original = split('root', 'horizontal', 0.95, leaf('n1', p1), split('inner', 'vertical', 0.04, leaf('n2', p2), leaf('n3', p3)));
    setLayout(id, original);
    getStore().fitAllPanes();
    const root = ws(id).layoutRoot as LayoutSplit;
    expect(collectLeafPaneIds(root)).toEqual([p1, p2, p3]);
    expect(nodeIds(root)).toEqual(['root', 'n1', 'inner', 'n2', 'n3']);
    expect(root.orientation).toBe('horizontal');
    expect((root.second as LayoutSplit).orientation).toBe('vertical');
    expect(root.ratio).toBeCloseTo(1 / 3); // 1 pane vs 2, not a flat 50/50
    expect((root.second as LayoutSplit).ratio).toBe(0.5);
  });

  it('records exactly one undo entry, and none when the layout is already fitted', () => {
    const { id, p1, p2 } = setup();
    getStore().setBrowserVisible(false, id);
    setLayout(id, split('root', 'horizontal', 0.9, leaf('n1', p1), leaf('n2', p2)));
    // Drop the third pane so the tree matches the visible panes exactly.
    useWorkspaceStore.setState((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, panes: w.panes.slice(0, 2) } : w)) }));
    const undoBefore = ws(id).layoutUndoStack?.length ?? 0;
    const revisionBefore = ws(id).layoutRevision ?? 0;
    getStore().fitAllPanes();
    expect(ws(id).layoutUndoStack).toHaveLength(undoBefore + 1);
    expect(ws(id).layoutRevision).toBe(revisionBefore + 1);
    getStore().fitAllPanes();
    expect(ws(id).layoutUndoStack).toHaveLength(undoBefore + 1);
    expect(ws(id).layoutRevision).toBe(revisionBefore + 1);
    getStore().undoLayout();
    expect((ws(id).layoutRoot as LayoutSplit).ratio).toBe(0.9);
  });

  it('repairs a stale layout against the visible panes without touching pane identities', () => {
    const { id, p1, p2, p3 } = setup();
    getStore().setBrowserVisible(false, id);
    const panesBefore = ws(id).panes;
    const browserBefore = ws(id).browserPane;
    // References a pane that no longer exists and omits p3.
    setLayout(id, split('root', 'horizontal', 0.5, leaf('n1', p1), split('inner', 'vertical', 0.5, leaf('ghost', 'gone'), leaf('n2', p2))));
    getStore().fitAllPanes();
    const ids = collectLeafPaneIds(ws(id).layoutRoot);
    expect([...ids].sort()).toEqual([p1, p2, p3].sort());
    expect(ids).not.toContain('gone');
    expect(nodeIds(ws(id).layoutRoot)).toContain('n1');
    expect(ws(id).panes).toBe(panesBefore);
    expect(ws(id).browserPane).toBe(browserBefore);
  });

  it('rebuilds from scratch only when there is no layout tree', () => {
    const { id, p1, p2, p3 } = setup();
    getStore().setBrowserVisible(false, id);
    setLayout(id, null);
    getStore().fitAllPanes();
    expect([...collectLeafPaneIds(ws(id).layoutRoot)].sort()).toEqual([p1, p2, p3].sort());
  });

  it('does not move a visible browser pane', () => {
    const { id, p1, p2, p3, browser } = setup();
    setLayout(id, split('root', 'horizontal', 0.9, leaf('n1', p1), split('inner', 'vertical', 0.1, leaf('n2', p2), split('right', 'horizontal', 0.5, leaf('n3', p3), leaf('nb', browser)))));
    getStore().fitAllPanes();
    const root = ws(id).layoutRoot as LayoutSplit;
    expect(collectLeafPaneIds(root)).toEqual([p1, p2, p3, browser]);
    expect(nodeIds(root)).toEqual(['root', 'n1', 'inner', 'n2', 'right', 'n3', 'nb']);
    expect(ws(id).browserPane!.id).toBe(browser);
  });

  it('keeps the browser restore hint valid: hide → Fit → reopen lands beside the same anchor', () => {
    const { id, p1, p2, p3, browser } = setup();
    setLayout(id, split('root', 'horizontal', 0.9, leaf('n1', p1), split('inner', 'vertical', 0.1, leaf('n2', p2), split('right', 'horizontal', 0.5, leaf('n3', p3), leaf('nb', browser)))));
    getStore().setBrowserVisible(false, id);
    expect(ws(id).browserPlacementHint).toMatchObject({ anchorNodeId: 'n3', paneSide: 'second', orientation: 'horizontal' });
    getStore().fitAllPanes();
    expect(ws(id).browserPlacementHint?.anchorNodeId).toBe('n3');
    getStore().setBrowserVisible(true, id);
    const root = ws(id).layoutRoot as LayoutSplit;
    // Not the outer-right default: the browser sits next to p3 inside the nested split.
    expect(collectLeafPaneIds(root)).toEqual([p1, p2, p3, browser]);
    const inner = root.second as LayoutSplit;
    const pair = (inner.second as LayoutSplit);
    expect(collectLeafPaneIds(pair)).toEqual([p3, browser]);
    expect(root.first).toMatchObject({ paneId: p1 });
  });
});
