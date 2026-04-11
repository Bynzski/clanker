import { describe, it, expect } from 'vitest';
import {
  generateId,
  generatePaneId,
  createPane,
  createWorkspaceId,
  createDefaultExplorerState,
  createDefaultEditorState,
  areGitStatusListsEqual,
  sanitizeWorkspace,
  getWorkspaceNameFromPath,
  getActiveWorkspaceSnapshot,
  syncActiveWorkspace,
  patchWorkspaceById,
} from '../../../src/renderer/store/workspaceStore';
import type { WorkspaceTab } from '../../../src/renderer/store/workspaceTypes';
import type { GitStatus } from '../../../src/renderer/components/git/types';
import { createWorkspaceFixture } from '../../setup/fixtures';

// ---------------------------------------------------------------------------
// Minimal mock workspace for syncActiveWorkspace / patchWorkspaceById tests
// ---------------------------------------------------------------------------

function makeWorkspace(overrides: Partial<WorkspaceTab> = {}): WorkspaceTab {
  return createWorkspaceFixture(overrides);
}

/** Build a minimal WorkspaceState-like object for sync/patch tests. */
function makeState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const ws = makeWorkspace();
  return {
    name: ws.name,
    workspacePath: ws.workspacePath,
    harness: ws.harness,
    model: ws.model,
    terminals: ws.terminals,
    panes: ws.panes,
    browserVisible: ws.browserVisible,
    browserUrl: ws.browserUrl,
    activeTerminalId: ws.activeTerminalId,
    browserPane: ws.browserPane,
    layoutRoot: ws.layoutRoot,
    explorerVisible: ws.explorerVisible,
    explorerSidebarWidth: ws.explorerSidebarWidth,
    explorerExpandedPaths: ws.explorerExpandedPaths,
    explorerSelectedPath: ws.explorerSelectedPath,
    explorerEntriesByPath: ws.explorerEntriesByPath,
    explorerLoadingPaths: ws.explorerLoadingPaths,
    explorerErrorsByPath: ws.explorerErrorsByPath,
    showHiddenFiles: ws.showHiddenFiles,
    gitChanges: ws.gitChanges,
    editorVisible: ws.editorVisible,
    editorPane: ws.editorPane,
    editorTabs: ws.editorTabs,
    activeEditorTabId: ws.activeEditorTabId,
    workspaces: [ws],
    activeWorkspaceId: ws.id,
    ...overrides,
  };
}

// ===========================================================================
// generateId
// ===========================================================================
describe('generateId', () => {
  it('uses crypto.randomUUID when available', () => {
    const id = generateId('test');
    expect(id).toMatch(/^test-/);
    expect(id.length).toBeGreaterThan('test-'.length);
  });

  it('falls back to Math.random when crypto.randomUUID is unavailable', () => {
    const original = crypto.randomUUID;
    delete (crypto as unknown as Record<string, unknown>).randomUUID;

    const id = generateId('fallback');
    expect(id).toMatch(/^fallback-/);

    // Restore
    (crypto as unknown as Record<string, unknown>).randomUUID = original;
  });

  it('uses different prefixes', () => {
    const a = generateId('a');
    const b = generateId('b');
    expect(a).toMatch(/^a-/);
    expect(b).toMatch(/^b-/);
    expect(a).not.toBe(b);
  });
});

// ===========================================================================
// generatePaneId
// ===========================================================================
describe('generatePaneId', () => {
  it('returns id with pane- prefix', () => {
    const id = generatePaneId();
    expect(id).toMatch(/^pane-/);
  });

  it('returns unique ids', () => {
    const a = generatePaneId();
    const b = generatePaneId();
    expect(a).not.toBe(b);
  });
});

// ===========================================================================
// createPane
// ===========================================================================
describe('createPane', () => {
  it('creates pane with terminal id and no position', () => {
    const pane = createPane('t1');
    expect(pane.id).toMatch(/^pane-/);
    expect(pane.terminalId).toBe('t1');
    expect(pane.position).toBeUndefined();
  });

  it('creates pane with null terminal id', () => {
    const pane = createPane(null);
    expect(pane.terminalId).toBeNull();
  });

  it('creates pane with position when provided', () => {
    const pos = { x: 1, y: 2, w: 3, h: 4 };
    const pane = createPane('t1', pos);
    expect(pane.position).toEqual(pos);
  });

  it('generates unique ids', () => {
    const a = createPane('t1');
    const b = createPane('t1');
    expect(a.id).not.toBe(b.id);
  });
});

// ===========================================================================
// createWorkspaceId
// ===========================================================================
describe('createWorkspaceId', () => {
  it('returns id with workspace- prefix', () => {
    const id = createWorkspaceId();
    expect(id).toMatch(/^workspace-/);
  });

  it('returns unique ids', () => {
    expect(createWorkspaceId()).not.toBe(createWorkspaceId());
  });
});

// ===========================================================================
// createDefaultExplorerState
// ===========================================================================
describe('createDefaultExplorerState', () => {
  it('returns correct default values', () => {
    const state = createDefaultExplorerState();
    expect(state.explorerVisible).toBe(false);
    expect(state.explorerSidebarWidth).toBe(280);
    expect(state.explorerExpandedPaths).toEqual([]);
    expect(state.explorerSelectedPath).toBeNull();
    expect(state.explorerEntriesByPath).toEqual({});
    expect(state.explorerLoadingPaths).toEqual([]);
    expect(state.explorerErrorsByPath).toEqual({});
    expect(state.showHiddenFiles).toBe(true);
    expect(state.gitChanges).toEqual([]);
  });

  it('returns fresh objects each call (no shared references)', () => {
    const a = createDefaultExplorerState();
    const b = createDefaultExplorerState();
    expect(a.explorerExpandedPaths).not.toBe(b.explorerExpandedPaths);
    expect(a.explorerEntriesByPath).not.toBe(b.explorerEntriesByPath);
    expect(a.explorerLoadingPaths).not.toBe(b.explorerLoadingPaths);
    expect(a.explorerErrorsByPath).not.toBe(b.explorerErrorsByPath);
    expect(a.gitChanges).not.toBe(b.gitChanges);
  });
});

// ===========================================================================
// createDefaultEditorState
// ===========================================================================
describe('createDefaultEditorState', () => {
  it('returns correct default values', () => {
    const state = createDefaultEditorState();
    expect(state.editorVisible).toBe(false);
    expect(state.editorPane).toBeNull();
    expect(state.editorTabs).toEqual([]);
    expect(state.activeEditorTabId).toBeNull();
  });

  it('returns fresh arrays each call', () => {
    const a = createDefaultEditorState();
    const b = createDefaultEditorState();
    expect(a.editorTabs).not.toBe(b.editorTabs);
  });
});

// ===========================================================================
// areGitStatusListsEqual
// ===========================================================================
describe('areGitStatusListsEqual', () => {
  const makeEntry = (path: string, status: GitStatus['status'], staged: boolean): GitStatus => ({
    path,
    status,
    staged,
  });

  it('returns true for same reference', () => {
    const list = [makeEntry('a.ts', 'modified', false)];
    expect(areGitStatusListsEqual(list, list)).toBe(true);
  });

  it('returns true for both empty arrays', () => {
    expect(areGitStatusListsEqual([], [])).toBe(true);
  });

  it('returns true for equal lists', () => {
    const a = [makeEntry('a.ts', 'modified', false), makeEntry('b.ts', 'added', true)];
    const b = [makeEntry('a.ts', 'modified', false), makeEntry('b.ts', 'added', true)];
    expect(areGitStatusListsEqual(a, b)).toBe(true);
  });

  it('returns false for different lengths', () => {
    const a = [makeEntry('a.ts', 'modified', false)];
    const b = [makeEntry('a.ts', 'modified', false), makeEntry('b.ts', 'added', true)];
    expect(areGitStatusListsEqual(a, b)).toBe(false);
  });

  it('returns false when path differs', () => {
    const a = [makeEntry('a.ts', 'modified', false)];
    const b = [makeEntry('b.ts', 'modified', false)];
    expect(areGitStatusListsEqual(a, b)).toBe(false);
  });

  it('returns false when status differs', () => {
    const a = [makeEntry('a.ts', 'modified', false)];
    const b = [makeEntry('a.ts', 'added', false)];
    expect(areGitStatusListsEqual(a, b)).toBe(false);
  });

  it('returns false when staged differs', () => {
    const a = [makeEntry('a.ts', 'modified', false)];
    const b = [makeEntry('a.ts', 'modified', true)];
    expect(areGitStatusListsEqual(a, b)).toBe(false);
  });

  it('returns false when second list has undefined entry at index', () => {
    const a = [makeEntry('a.ts', 'modified', false)];
    const b: GitStatus[] = [];
    expect(areGitStatusListsEqual(a, b)).toBe(false);
  });
});

// ===========================================================================
// sanitizeWorkspace
// ===========================================================================
describe('sanitizeWorkspace', () => {
  it('clones arrays so mutations do not affect original', () => {
    const ws = makeWorkspace();
    const sanitized = sanitizeWorkspace(ws);

    expect(sanitized.terminals).not.toBe(ws.terminals);
    expect(sanitized.panes).not.toBe(ws.panes);
    expect(sanitized.explorerExpandedPaths).not.toBe(ws.explorerExpandedPaths);
    expect(sanitized.explorerLoadingPaths).not.toBe(ws.explorerLoadingPaths);
    expect(sanitized.editorTabs).not.toBe(ws.editorTabs);
    expect(sanitized.gitChanges).not.toBe(ws.gitChanges);
  });

  it('clones record objects', () => {
    const ws = makeWorkspace();
    const sanitized = sanitizeWorkspace(ws);
    expect(sanitized.explorerEntriesByPath).not.toBe(ws.explorerEntriesByPath);
    expect(sanitized.explorerErrorsByPath).not.toBe(ws.explorerErrorsByPath);
  });

  it('defaults showHiddenFiles to true when undefined', () => {
    const ws = makeWorkspace();
    delete (ws as unknown as Record<string, unknown>).showHiddenFiles;
    const sanitized = sanitizeWorkspace(ws as WorkspaceTab);
    expect(sanitized.showHiddenFiles).toBe(true);
  });

  it('defaults gitChanges to empty array when undefined', () => {
    const ws = makeWorkspace();
    delete (ws as unknown as Record<string, unknown>).gitChanges;
    const sanitized = sanitizeWorkspace(ws as WorkspaceTab);
    expect(sanitized.gitChanges).toEqual([]);
  });

  it('sets browserPane.locked to false when undefined', () => {
    const ws = makeWorkspace({
      browserPane: { id: 'bp-1', position: { x: 0, y: 0, w: 6, h: 6 }, locked: undefined as unknown as boolean },
    });
    const sanitized = sanitizeWorkspace(ws);
    expect(sanitized.browserPane!.locked).toBe(false);
  });

  it('sets editorPane.locked to false when undefined', () => {
    const ws = makeWorkspace({
      editorPane: { id: 'ep-1', locked: undefined as unknown as boolean },
    });
    const sanitized = sanitizeWorkspace(ws);
    expect(sanitized.editorPane!.locked).toBe(false);
  });

  it('sets browserPane to null when null', () => {
    const ws = makeWorkspace({ browserPane: null });
    const sanitized = sanitizeWorkspace(ws);
    expect(sanitized.browserPane).toBeNull();
  });

  it('sets editorPane to null when null', () => {
    const ws = makeWorkspace({ editorPane: null });
    const sanitized = sanitizeWorkspace(ws);
    expect(sanitized.editorPane).toBeNull();
  });

  it('rebuilds layoutRoot via buildWorkspaceLayout', () => {
    const ws = makeWorkspace();
    const sanitized = sanitizeWorkspace(ws);
    // buildWorkspaceLayout should produce a non-null layout when there are panes
    expect(sanitized.layoutRoot).not.toBeNull();
  });

  it('preserves scalar fields', () => {
    const ws = makeWorkspace({ name: 'test-ws', workspacePath: '/test', harness: 'claude', model: 'gpt-4' });
    const sanitized = sanitizeWorkspace(ws);
    expect(sanitized.name).toBe('test-ws');
    expect(sanitized.workspacePath).toBe('/test');
    expect(sanitized.harness).toBe('claude');
    expect(sanitized.model).toBe('gpt-4');
  });
});

// ===========================================================================
// getWorkspaceNameFromPath
// ===========================================================================
describe('getWorkspaceNameFromPath', () => {
  it('extracts last directory segment', () => {
    expect(getWorkspaceNameFromPath('/home/user/my-project')).toBe('my-project');
  });

  it('handles trailing slashes', () => {
    expect(getWorkspaceNameFromPath('/home/user/my-project/')).toBe('my-project');
  });

  it('handles multiple trailing slashes', () => {
    expect(getWorkspaceNameFromPath('/home/user/my-project///')).toBe('my-project');
  });

  it('returns "Workspace" for root path "/"', () => {
    expect(getWorkspaceNameFromPath('/')).toBe('Workspace');
  });

  it('returns "Workspace" for empty string', () => {
    expect(getWorkspaceNameFromPath('')).toBe('Workspace');
  });

  it('returns "Workspace" for string of only slashes', () => {
    expect(getWorkspaceNameFromPath('///')).toBe('Workspace');
  });

  it('handles deep nested paths', () => {
    expect(getWorkspaceNameFromPath('/a/b/c/d/e')).toBe('e');
  });

  it('handles single segment', () => {
    expect(getWorkspaceNameFromPath('my-project')).toBe('my-project');
  });
});

// ===========================================================================
// getActiveWorkspaceSnapshot
// ===========================================================================
describe('getActiveWorkspaceSnapshot', () => {
  it('returns snapshot matching workspace fields', () => {
    const ws = makeWorkspace({ name: 'snap-test', workspacePath: '/snap' });
    const snap = getActiveWorkspaceSnapshot(ws);
    expect(snap.name).toBe('snap-test');
    expect(snap.workspacePath).toBe('/snap');
    expect(snap.harness).toBe(ws.harness);
    expect(snap.model).toBe(ws.model);
    expect(snap.terminals).toBe(ws.terminals);
    expect(snap.panes).toBe(ws.panes);
    expect(snap.browserVisible).toBe(ws.browserVisible);
    expect(snap.browserUrl).toBe(ws.browserUrl);
    expect(snap.activeTerminalId).toBe(ws.activeTerminalId);
    expect(snap.browserPane).toBe(ws.browserPane);
    expect(snap.layoutRoot).toBe(ws.layoutRoot);
    expect(snap.editorVisible).toBe(ws.editorVisible);
    expect(snap.editorPane).toBe(ws.editorPane);
    expect(snap.editorTabs).toBe(ws.editorTabs);
    expect(snap.activeEditorTabId).toBe(ws.activeEditorTabId);
  });

  it('defaults showHiddenFiles to true when undefined', () => {
    const ws = makeWorkspace();
    delete (ws as unknown as Record<string, unknown>).showHiddenFiles;
    const snap = getActiveWorkspaceSnapshot(ws as WorkspaceTab);
    expect(snap.showHiddenFiles).toBe(true);
  });

  it('defaults gitChanges to empty array when undefined', () => {
    const ws = makeWorkspace();
    delete (ws as unknown as Record<string, unknown>).gitChanges;
    const snap = getActiveWorkspaceSnapshot(ws as WorkspaceTab);
    expect(snap.gitChanges).toEqual([]);
  });
});

// ===========================================================================
// syncActiveWorkspace
// ===========================================================================
describe('syncActiveWorkspace', () => {
  it('returns only workspaces when activeWorkspaceId is null', () => {
    const ws = makeWorkspace();
    const state = makeState({ workspaces: [ws], activeWorkspaceId: null });
    const result = syncActiveWorkspace(
      state as never,
      (w: WorkspaceTab) => ({ ...w, name: 'changed' }),
    );
    expect(Object.keys(result)).toEqual(['workspaces']);
    expect((result as Record<string, unknown>).workspaces).toHaveLength(1);
  });

  it('updates active workspace and returns snapshot', () => {
    const ws = makeWorkspace({ name: 'original' });
    const state = makeState({ workspaces: [ws], activeWorkspaceId: ws.id });
    const result = syncActiveWorkspace(
      state as never,
      (w: WorkspaceTab) => ({ ...w, name: 'updated' }),
    );
    const r = result as Record<string, unknown>;
    expect(r.name).toBe('updated');
    expect(r.workspaces).toHaveLength(1);
    expect((r.workspaces as WorkspaceTab[])[0].name).toBe('updated');
  });

  it('does not modify non-active workspaces', () => {
    const ws1 = makeWorkspace({ id: 'ws-1', name: 'first' });
    const ws2 = makeWorkspace({ id: 'ws-2', name: 'second' });
    const state = makeState({ workspaces: [ws1, ws2], activeWorkspaceId: 'ws-1' });
    const result = syncActiveWorkspace(
      state as never,
      (w: WorkspaceTab) => ({ ...w, name: 'changed' }),
    );
    const workspaces = (result as Record<string, unknown>).workspaces as WorkspaceTab[];
    expect(workspaces.find(w => w.id === 'ws-1')!.name).toBe('changed');
    expect(workspaces.find(w => w.id === 'ws-2')!.name).toBe('second');
  });

  it('returns only workspaces when activeWorkspaceId does not match any workspace', () => {
    const ws = makeWorkspace({ id: 'ws-1' });
    const state = makeState({ workspaces: [ws], activeWorkspaceId: 'non-existent' });
    const result = syncActiveWorkspace(
      state as never,
      (w: WorkspaceTab) => ({ ...w, name: 'changed' }),
    );
    expect(Object.keys(result)).toEqual(['workspaces']);
  });
});

// ===========================================================================
// patchWorkspaceById
// ===========================================================================
describe('patchWorkspaceById', () => {
  it('patches the matching workspace', () => {
    const ws = makeWorkspace({ id: 'ws-1', name: 'original' });
    const state = makeState({ workspaces: [ws], activeWorkspaceId: 'ws-1' });
    const result = patchWorkspaceById(
      state as never,
      'ws-1',
      (w: WorkspaceTab) => ({ ...w, name: 'patched' }),
    );
    const r = result as Record<string, unknown>;
    expect(r.name).toBe('patched');
    expect((r.workspaces as WorkspaceTab[])[0].name).toBe('patched');
  });

  it('patches inactive workspace without updating snapshot', () => {
    const ws1 = makeWorkspace({ id: 'ws-1', name: 'first', workspacePath: '/first' });
    const ws2 = makeWorkspace({ id: 'ws-2', name: 'second', workspacePath: '/second' });
    const state = makeState({ workspaces: [ws1, ws2], activeWorkspaceId: 'ws-1', name: 'first' });
    const result = patchWorkspaceById(
      state as never,
      'ws-2',
      (w: WorkspaceTab) => ({ ...w, name: 'patched-second' }),
    );
    const r = result as Record<string, unknown>;
    // Only workspaces key returned (no snapshot fields)
    expect(Object.keys(r)).toEqual(['workspaces']);
    // The workspaces array should be patched
    const workspaces = r.workspaces as WorkspaceTab[];
    expect(workspaces.find(w => w.id === 'ws-2')!.name).toBe('patched-second');
    expect(workspaces.find(w => w.id === 'ws-1')!.name).toBe('first');
  });

  it('returns only workspaces when id does not match any workspace', () => {
    const ws = makeWorkspace({ id: 'ws-1' });
    const state = makeState({ workspaces: [ws], activeWorkspaceId: 'ws-1' });
    const result = patchWorkspaceById(
      state as never,
      'non-existent',
      (w: WorkspaceTab) => ({ ...w, name: 'changed' }),
    );
    expect(Object.keys(result)).toEqual(['workspaces']);
  });

  it('preserves workspace order', () => {
    const ws1 = makeWorkspace({ id: 'ws-1', name: 'first' });
    const ws2 = makeWorkspace({ id: 'ws-2', name: 'second' });
    const ws3 = makeWorkspace({ id: 'ws-3', name: 'third' });
    const state = makeState({ workspaces: [ws1, ws2, ws3], activeWorkspaceId: 'ws-1' });
    const result = patchWorkspaceById(
      state as never,
      'ws-2',
      (w: WorkspaceTab) => ({ ...w, name: 'patched' }),
    );
    const workspaces = (result as Record<string, unknown>).workspaces as WorkspaceTab[];
    expect(workspaces.map(w => w.id)).toEqual(['ws-1', 'ws-2', 'ws-3']);
    expect(workspaces[1].name).toBe('patched');
  });
});
