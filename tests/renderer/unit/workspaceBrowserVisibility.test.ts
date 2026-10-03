import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { collectLeafPaneIds } from '../../../src/renderer/store/workspaceLayout';
import type { LayoutNode, LayoutSplit, Terminal } from '../../../src/renderer/store/workspaceTypes';
import { createWorkspaceFixture } from '../../setup/fixtures';

function getStore() {
  return useWorkspaceStore.getState();
}

function addWorkspace(name: string) {
  const { id: _id, ...rest } = createWorkspaceFixture({ name, workspacePath: `/projects/${name}` });
  void _id;
  getStore().addWorkspace(rest);
  return getStore().activeWorkspaceId!;
}

function ws(id: string) {
  return getStore().workspaces.find((w) => w.id === id)!;
}

function term(id: string): Terminal {
  return { id, pid: 1, workingDir: '/workspace' };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
  });
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, layoutRoot: null, panes: [], terminals: [], browserPane: null, browserVisible: false, layoutRevision: 0, layoutUndoStack: [] });
});

describe('setBrowserVisible', () => {
  it('shows the browser at the outer right at ~30% width and bumps revision', () => {
    const id = addWorkspace('a');
    getStore().addTerminal(term('t1'));
    const before = ws(id).layoutRevision ?? 0;
    getStore().setBrowserVisible(true, id);
    const w = ws(id);
    expect(w.browserVisible).toBe(true);
    const root = w.layoutRoot as LayoutSplit;
    expect(root.orientation).toBe('horizontal');
    expect(root.ratio).toBe(0.7);
    expect((root.second as { paneId: string }).paneId).toBe(w.browserPane!.id);
    expect(w.layoutRevision).toBe(before + 1);
    expect(getStore().layoutRevision).toBe(w.layoutRevision);
  });

  it('makes the browser the sole leaf for an empty layout', () => {
    const id = addWorkspace('a');
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, layoutRoot: null, panes: [] } : w)),
      layoutRoot: null,
      panes: [],
    }));
    getStore().setBrowserVisible(true, id);
    expect(ws(id).layoutRoot).toMatchObject({ type: 'leaf', paneId: ws(id).browserPane!.id });
  });

  it('hides without destroying browser state, capturing a hint and no undo entry', () => {
    const id = addWorkspace('a');
    getStore().addTerminal(term('t1'));
    getStore().setBrowserVisible(true, id);
    const pane = ws(id).browserPane!;
    const undoBefore = ws(id).layoutUndoStack?.length ?? 0;
    getStore().setBrowserVisible(false, id);
    const w = ws(id);
    expect(w.browserVisible).toBe(false);
    expect(collectLeafPaneIds(w.layoutRoot)).not.toContain(pane.id);
    expect(w.browserPane).toEqual(pane);
    expect(w.browserPlacementHint).toMatchObject({ orientation: 'horizontal', paneSide: 'second', ratio: 0.7 });
    expect(w.layoutUndoStack?.length ?? 0).toBe(undoBefore);
  });

  it('restores local placement and ratio on re-show', () => {
    const id = addWorkspace('a');
    getStore().addTerminal(term('t1'));
    getStore().setBrowserVisible(true, id);
    const root = ws(id).layoutRoot as LayoutSplit;
    getStore().setSplitRatio(root.nodeId, 0.63);
    const pane = ws(id).browserPane!;
    getStore().setBrowserVisible(false, id);
    getStore().setBrowserVisible(true, id);
    const w = ws(id);
    expect(w.browserPane).toEqual(pane);
    const restored = w.layoutRoot as LayoutSplit;
    expect(restored.ratio).toBe(0.63);
    expect((restored.second as { paneId: string }).paneId).toBe(pane.id);
    expect(w.browserPlacementHint).toBeNull();
  });

  it('keeps unrelated changes made while hidden', () => {
    const id = addWorkspace('a');
    getStore().addTerminal(term('t1'));
    getStore().setBrowserVisible(true, id);
    getStore().setBrowserVisible(false, id);
    const paneCountHidden = collectLeafPaneIds(ws(id).layoutRoot).length;
    getStore().addTerminal(term('t2'));
    getStore().setBrowserVisible(true, id);
    const w = ws(id);
    const ids = collectLeafPaneIds(w.layoutRoot);
    expect(ids).toHaveLength(paneCountHidden + 2);
    expect(ids).toContain(w.browserPane!.id);
    expect(ids.filter((p) => p === w.browserPane!.id)).toHaveLength(1);
  });

  it('falls back to outer-right when the anchor disappeared', () => {
    const id = addWorkspace('a');
    getStore().addTerminal(term('t1'));
    getStore().setBrowserVisible(true, id);
    getStore().setBrowserVisible(false, id);
    const hint = ws(id).browserPlacementHint!;
    // Rebuild layout so anchor node no longer exists.
    const replacement: LayoutNode = { type: 'leaf', nodeId: 'brand-new', paneId: ws(id).panes[0].id };
    expect(replacement.nodeId).not.toBe(hint.anchorNodeId);
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, layoutRoot: replacement } : w)),
      layoutRoot: replacement,
    }));
    getStore().setBrowserVisible(true, id);
    const root = ws(id).layoutRoot as LayoutSplit;
    expect(root.ratio).toBe(0.7);
    expect((root.first as { nodeId: string }).nodeId).toBe('brand-new');
    expect((root.second as { paneId: string }).paneId).toBe(ws(id).browserPane!.id);
  });

  it('is scoped by workspace and does not leak hints', () => {
    const a = addWorkspace('a');
    const b = addWorkspace('b');
    getStore().setBrowserVisible(true, a);
    getStore().setBrowserVisible(true, b);
    getStore().addTerminal(term('t1'), a);
    getStore().setBrowserVisible(false, a);
    expect(ws(a).browserVisible).toBe(false);
    expect(ws(b).browserVisible).toBe(true);
    expect(ws(b).browserPlacementHint ?? null).toBeNull();
    expect(collectLeafPaneIds(ws(b).layoutRoot)).toContain(ws(b).browserPane!.id);
    expect(getStore().activeWorkspaceId).toBe(b);
    expect(getStore().browserVisible).toBe(true);
  });

  it('toggleBrowser delegates to the canonical action', () => {
    const id = addWorkspace('a');
    getStore().toggleBrowser();
    expect(ws(id).browserVisible).toBe(true);
    getStore().toggleBrowser();
    expect(ws(id).browserVisible).toBe(false);
    expect(ws(id).browserPane).not.toBeNull();
  });
});
