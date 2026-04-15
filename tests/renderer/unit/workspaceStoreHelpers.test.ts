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
  findActiveWorkspace,
  findWorkspaceById,
  getActiveWorkspaceSnapshot,
  isWorkspaceActiveById,
  isWorkspaceWarm,
  getWorkspaceResourcePolicy,
  withWorkspaceResidency,
  withWorkspaceResourcePolicy,
  sanitizeRuntimeState,
  DEFAULT_RUNTIME_STATE,
  DEFAULT_RESOURCE_POLICY,
  syncActiveWorkspace,
  patchWorkspaceById,
  assignWorkspaceLifecycles,
  isEditorOperationPending,
  setEditorOperationPending,
  clearEditorOperationPending,
} from '../../../src/renderer/store/workspaceStore';
import type { WorkspaceTab } from '../../../src/renderer/store/workspaceTypes';
import type { GitStatus } from '../../../src/renderer/components/git/types';
import type { BrowserPaneState, EditorPaneState, LayoutNode, Pane } from '../../../src/renderer/store/workspaceTypes';
import { createWorkspaceFixture } from '../../setup/fixtures';

/** Minimal type matching PendingEditorOperationsHolder for editor operation helper tests. */
type EditorPendingState = { pendingEditorOperations: Record<string, string> };

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
    expect(sanitized.lifecycle).toBe('active');
    expect(sanitized.name).toBe('test-ws');
    expect(sanitized.workspacePath).toBe('/test');
    expect(sanitized.harness).toBe('claude');
    expect(sanitized.model).toBe('gpt-4');
  });
});

describe('assignWorkspaceLifecycles', () => {
  it('marks only the selected workspace as active', () => {
    const ws1 = makeWorkspace({ id: 'ws-1', lifecycle: 'active' });
    const ws2 = makeWorkspace({ id: 'ws-2', lifecycle: 'active' });

    const result = assignWorkspaceLifecycles([ws1, ws2], 'ws-2');

    expect(result.find((workspace) => workspace.id === 'ws-1')?.lifecycle).toBe('parked');
    expect(result.find((workspace) => workspace.id === 'ws-2')?.lifecycle).toBe('active');
  });

  it('parks every workspace when activeWorkspaceId is null', () => {
    const ws1 = makeWorkspace({ id: 'ws-1', lifecycle: 'active' });
    const ws2 = makeWorkspace({ id: 'ws-2', lifecycle: 'active' });

    const result = assignWorkspaceLifecycles([ws1, ws2], null);

    expect(result.every((workspace) => workspace.lifecycle === 'parked')).toBe(true);
  });
});

describe('workspace selectors', () => {
  it('findWorkspaceById returns matching workspace', () => {
    const ws1 = makeWorkspace({ id: 'ws-1' });
    const ws2 = makeWorkspace({ id: 'ws-2' });

    expect(findWorkspaceById([ws1, ws2], 'ws-2')?.id).toBe('ws-2');
  });

  it('findWorkspaceById returns null for missing or null ids', () => {
    const ws = makeWorkspace({ id: 'ws-1' });

    expect(findWorkspaceById([ws], 'missing')).toBeNull();
    expect(findWorkspaceById([ws], null)).toBeNull();
  });

  it('findActiveWorkspace returns lifecycle-active workspace', () => {
    const ws1 = makeWorkspace({ id: 'ws-1', lifecycle: 'parked' });
    const ws2 = makeWorkspace({ id: 'ws-2', lifecycle: 'active' });

    expect(findActiveWorkspace([ws1, ws2])?.id).toBe('ws-2');
  });

  it('isWorkspaceActiveById reflects lifecycle state', () => {
    const ws1 = makeWorkspace({ id: 'ws-1', lifecycle: 'parked' });
    const ws2 = makeWorkspace({ id: 'ws-2', lifecycle: 'active' });

    expect(isWorkspaceActiveById([ws1, ws2], 'ws-1')).toBe(false);
    expect(isWorkspaceActiveById([ws1, ws2], 'ws-2')).toBe(true);
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
    const ws1 = makeWorkspace({ id: 'ws-1', name: 'first', workspacePath: '/first', lifecycle: 'active' });
    const ws2 = makeWorkspace({ id: 'ws-2', name: 'second', workspacePath: '/second', lifecycle: 'parked' });
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

// ===========================================================================
// validateWorkspaceConsistency
// ===========================================================================
import { validateWorkspaceConsistency } from '../../../src/renderer/store/workspaceStore';

// ---------------------------------------------------------------------------
// Helper to build minimal test states (distinct from existing makeState)
// ---------------------------------------------------------------------------
function makeMinimalState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    activeWorkspaceId: null,
    workspaces: [],
    activeTerminalId: null,
    terminals: [],
    layoutRoot: null,
    panes: [],
    browserVisible: false,
    browserPane: null,
    editorVisible: false,
    editorPane: null,
    editorTabs: [],
    activeEditorTabId: null,
    ...overrides,
  };
}


function makeLeaf(paneId: string): LayoutNode {
  return { type: 'leaf', nodeId: `node-${paneId}`, paneId };
}


describe('validateWorkspaceConsistency', () => {
  // [W1,W2] Workspace invariants
  describe('W1 (activeWorkspaceId <-> workspaces)', () => {
    it('passes when activeWorkspaceId is null and workspaces is empty', () => {
      const state = makeMinimalState({ activeWorkspaceId: null, workspaces: [] });
      expect(validateWorkspaceConsistency(state)).toEqual([]);
    });

    it('passes when activeWorkspaceId is set and workspaces is non-empty', () => {
      const ws = makeWorkspace();
      const state = makeMinimalState({ activeWorkspaceId: ws.id, workspaces: [ws] });
      expect(validateWorkspaceConsistency(state)).toEqual([]);
    });

    it('warns when activeWorkspaceId is null but workspaces is non-empty', () => {
      const ws = makeWorkspace();
      const state = makeMinimalState({ activeWorkspaceId: null, workspaces: [ws] });
      expect(validateWorkspaceConsistency(state)).toContain(
        'W1 violated: activeWorkspaceId is null but workspaces[] is non-empty',
      );
    });
  });

  describe('W2 (activeWorkspaceId reference)', () => {
    it('passes when activeWorkspaceId exists in workspaces', () => {
      const ws = makeWorkspace();
      const state = makeMinimalState({ activeWorkspaceId: ws.id, workspaces: [ws] });
      expect(validateWorkspaceConsistency(state)).toEqual([]);
    });

    it('warns when activeWorkspaceId is not found in workspaces', () => {
      const state = makeMinimalState({ activeWorkspaceId: 'non-existent', workspaces: [makeWorkspace()] });
      expect(validateWorkspaceConsistency(state)).toContain(
        'W2 violated: activeWorkspaceId "non-existent" not found in workspaces[]',
      );
    });
  });

  describe('W3/W4 (workspace lifecycle)', () => {
    it('passes when exactly one workspace is active and it matches activeWorkspaceId', () => {
      const ws1 = makeWorkspace({ id: 'ws-1', lifecycle: 'active' });
      const ws2 = makeWorkspace({ id: 'ws-2', lifecycle: 'parked' });
      const state = makeMinimalState({ activeWorkspaceId: 'ws-1', workspaces: [ws1, ws2] });
      expect(validateWorkspaceConsistency(state)).toEqual([]);
    });

    it('warns when no workspace lifecycle is active', () => {
      const ws1 = makeWorkspace({ id: 'ws-1', lifecycle: 'parked' });
      const ws2 = makeWorkspace({ id: 'ws-2', lifecycle: 'parked' });
      const state = makeMinimalState({ activeWorkspaceId: 'ws-1', workspaces: [ws1, ws2] });
      expect(validateWorkspaceConsistency(state)).toContain(
        'W3 violated: expected exactly one active workspace lifecycle entry, found 0',
      );
    });

    it('warns when more than one workspace lifecycle is active', () => {
      const ws1 = makeWorkspace({ id: 'ws-1', lifecycle: 'active' });
      const ws2 = makeWorkspace({ id: 'ws-2', lifecycle: 'active' });
      const state = makeMinimalState({ activeWorkspaceId: 'ws-1', workspaces: [ws1, ws2] });
      expect(validateWorkspaceConsistency(state)).toContain(
        'W3 violated: expected exactly one active workspace lifecycle entry, found 2',
      );
    });

    it('warns when activeWorkspaceId does not point to the active lifecycle entry', () => {
      const ws1 = makeWorkspace({ id: 'ws-1', lifecycle: 'parked' });
      const ws2 = makeWorkspace({ id: 'ws-2', lifecycle: 'active' });
      const state = makeMinimalState({ activeWorkspaceId: 'ws-1', workspaces: [ws1, ws2] });
      expect(validateWorkspaceConsistency(state)).toContain(
        'W4 violated: activeWorkspaceId "ws-1" does not reference a workspace with lifecycle "active"',
      );
    });
  });


  // [T1,T2] Terminal invariants
  describe('T1 (activeTerminalId <-> terminals)', () => {
    it('passes when activeTerminalId is null and terminals is empty', () => {
      const state = makeMinimalState({ activeTerminalId: null, terminals: [] });
      expect(validateWorkspaceConsistency(state)).toEqual([]);
    });

    it('passes when activeTerminalId is set and terminals is non-empty', () => {
      const term = makeWorkspace().terminals[0];
      const state = makeMinimalState({ activeTerminalId: term.id, terminals: [term] });
      expect(validateWorkspaceConsistency(state)).toEqual([]);
    });

    it('warns when activeTerminalId is null but terminals is non-empty', () => {
      const term = makeWorkspace().terminals[0];
      const state = makeMinimalState({ activeTerminalId: null, terminals: [term] });
      expect(validateWorkspaceConsistency(state)).toContain(
        'T1 violated: activeTerminalId is null but terminals[] is non-empty',
      );
    });
  });

  describe('T2 (activeTerminalId reference)', () => {
    it('passes when activeTerminalId exists in terminals', () => {
      const term = makeWorkspace().terminals[0];
      const state = makeMinimalState({ activeTerminalId: term.id, terminals: [term] });
      expect(validateWorkspaceConsistency(state)).toEqual([]);
    });

    it('warns when activeTerminalId is not found in terminals', () => {
      const state = makeMinimalState({ activeTerminalId: 'non-existent', terminals: [] });
      expect(validateWorkspaceConsistency(state)).toContain(
        'T2 violated: activeTerminalId "non-existent" not found in terminals[]',
      );
    });
  });

  // [L1,L2] Layout invariants
  describe('L1 (layoutRoot nullity)', () => {
    it('passes when layoutRoot is null and no panes/browser/editor', () => {
      const state = makeMinimalState({ layoutRoot: null, panes: [], browserVisible: false, editorVisible: false });
      expect(validateWorkspaceConsistency(state)).toEqual([]);
    });

    it('passes when layoutRoot is non-null and panes exist', () => {
      const pane: Pane = { id: 'pane-1', terminalId: null };
      const state = makeMinimalState({ layoutRoot: makeLeaf('pane-1'), panes: [pane], browserVisible: false, editorVisible: false });
      expect(validateWorkspaceConsistency(state)).toEqual([]);
    });

    it('warns when layoutRoot is null but panes[] is non-empty', () => {
      const pane: Pane = { id: 'pane-1', terminalId: null };
      const state = makeMinimalState({ layoutRoot: null, panes: [pane], browserVisible: false, editorVisible: false });
      expect(validateWorkspaceConsistency(state)).toContain(
        'L1 violated: layoutRoot is null but panes[] is non-empty',
      );
    });

    it('warns when layoutRoot is null but browser is visible', () => {
      const bp: BrowserPaneState = { id: 'browser-1', position: { x: 0, y: 0, w: 6, h: 6 }, locked: false };
      const state = makeMinimalState({ layoutRoot: null, panes: [], browserVisible: true, browserPane: bp });
      expect(validateWorkspaceConsistency(state)).toContain(
        'L1 violated: layoutRoot is null but browser is visible',
      );
    });

    it('warns when layoutRoot is null but editor is visible', () => {
      const ep: EditorPaneState = { id: 'editor-1', locked: false };
      const state = makeMinimalState({ layoutRoot: null, panes: [], browserVisible: false, editorVisible: true, editorPane: ep });
      expect(validateWorkspaceConsistency(state)).toContain(
        'L1 violated: layoutRoot is null but editor is visible',
      );
    });

    it('warns when layoutRoot is non-null but no panes exist and browser/editor are invisible', () => {
      const state = makeMinimalState({ layoutRoot: makeLeaf('orphan-pane'), panes: [], browserVisible: false, editorVisible: false });
      expect(validateWorkspaceConsistency(state)).toContain(
        'L1 violated: layoutRoot is non-null but no panes exist and browser/editor are invisible',
      );
    });
  });


  describe('L2 (layout pane ID integrity)', () => {
    it('passes when all layout pane IDs are valid', () => {
      const pane: Pane = { id: 'pane-1', terminalId: null };
      const state = makeMinimalState({ layoutRoot: makeLeaf('pane-1'), panes: [pane] });
      expect(validateWorkspaceConsistency(state)).toEqual([]);
    });

    it('passes when layout references browserPane', () => {
      const bp: BrowserPaneState = { id: 'browser-1', position: { x: 0, y: 0, w: 6, h: 6 }, locked: false };
      const state = makeMinimalState({ layoutRoot: makeLeaf('browser-1'), panes: [], browserPane: bp, browserVisible: true });

      expect(validateWorkspaceConsistency(state)).toEqual([]);
    });

    it('passes when layout references editorPane', () => {
      const ep: EditorPaneState = { id: 'editor-1', locked: false };
      const state = makeMinimalState({ layoutRoot: makeLeaf('editor-1'), panes: [], editorPane: ep, editorVisible: true });

      expect(validateWorkspaceConsistency(state)).toEqual([]);
    });

    it('warns when layout references pane not in panes[], browserPane, or editorPane', () => {
      const pane: Pane = { id: 'pane-1', terminalId: null };
      const state = makeMinimalState({ layoutRoot: makeLeaf('ghost-pane'), panes: [pane] });
      expect(validateWorkspaceConsistency(state)).toContain(
        'L2 violated: layout pane "ghost-pane" not found in panes[], browserPane, or editorPane',
      );
    });
  });


  // [E1,E2] Editor invariants
  describe('E1 (activeEditorTabId <-> editorTabs)', () => {
    it('passes when activeEditorTabId is null and editorTabs is empty', () => {
      const state = makeMinimalState({ activeEditorTabId: null, editorTabs: [] });
      expect(validateWorkspaceConsistency(state)).toEqual([]);
    });

    it('passes when activeEditorTabId is set and editorTabs is non-empty', () => {
      const tab = { id: 'tab-1', filePath: '/test.ts', fileName: 'test.ts', isDirty: false, content: '', originalContent: '' };
      const state = makeMinimalState({ activeEditorTabId: 'tab-1', editorTabs: [tab] });
      expect(validateWorkspaceConsistency(state)).toEqual([]);
    });

    it('warns when activeEditorTabId is null but editorTabs is non-empty', () => {
      const tab = { id: 'tab-1', filePath: '/test.ts', fileName: 'test.ts', isDirty: false, content: '', originalContent: '' };
      const state = makeMinimalState({ activeEditorTabId: null, editorTabs: [tab] });
      expect(validateWorkspaceConsistency(state)).toContain(
        'E1 violated: activeEditorTabId is null but editorTabs[] is non-empty',
      );
    });
  });

  describe('E2 (activeEditorTabId reference)', () => {
    it('passes when activeEditorTabId exists in editorTabs', () => {
      const tab = { id: 'tab-1', filePath: '/test.ts', fileName: 'test.ts', isDirty: false, content: '', originalContent: '' };
      const state = makeMinimalState({ activeEditorTabId: 'tab-1', editorTabs: [tab] });
      expect(validateWorkspaceConsistency(state)).toEqual([]);
    });

    it('warns when activeEditorTabId is not found in editorTabs', () => {
      const state = makeMinimalState({ activeEditorTabId: 'non-existent', editorTabs: [] });
      expect(validateWorkspaceConsistency(state)).toContain(
        'E2 violated: activeEditorTabId "non-existent" not found in editorTabs[]',
      );
    });
  });


  describe('multiple violations', () => {
    it('returns all violations when multiple invariants are broken', () => {
      const state = makeMinimalState({
        activeWorkspaceId: 'non-existent',
        activeTerminalId: 'non-existent',
        activeEditorTabId: 'non-existent',
      });
      const warnings = validateWorkspaceConsistency(state);
      expect(warnings).toContain('W2 violated: activeWorkspaceId "non-existent" not found in workspaces[]');
      expect(warnings).toContain('T2 violated: activeTerminalId "non-existent" not found in terminals[]');
      expect(warnings).toContain('E2 violated: activeEditorTabId "non-existent" not found in editorTabs[]');
    });
  });

  describe('partial snapshots', () => {
    it('does not warn when activeWorkspaceId is omitted (undefined)', () => {
      const ws = makeWorkspace();
      expect(validateWorkspaceConsistency({ workspaces: [ws] })).toEqual([]);
    });

    it('does not warn when layoutRoot is omitted (undefined)', () => {
      const pane: Pane = { id: 'pane-1', terminalId: null };
      expect(validateWorkspaceConsistency({ panes: [pane] })).toEqual([]);
    });
  });
});

describe('editor operation pending helpers', () => {
  function makeEditorState(overrides: Partial<EditorPendingState> = {}): EditorPendingState {
    return {
      pendingEditorOperations: {},
      ...overrides,
    };
  }

  describe('isEditorOperationPending', () => {
    it('returns false when no operations are pending', () => {
      const state = makeEditorState();
      expect(isEditorOperationPending(state, '/foo.ts')).toBe(false);
    });

    it('returns false for a different file path', () => {
      const state = makeEditorState({ pendingEditorOperations: { '/bar.ts': 'save' } });
      expect(isEditorOperationPending(state, '/foo.ts')).toBe(false);
    });

    it('returns true when the file has a pending operation', () => {
      const state = makeEditorState({ pendingEditorOperations: { '/foo.ts': 'open' } });
      expect(isEditorOperationPending(state, '/foo.ts')).toBe(true);
    });
  });

  describe('setEditorOperationPending', () => {
    it('adds an operation to empty map', () => {
      const state = makeEditorState();
      const result = setEditorOperationPending(state, '/foo.ts', 'save');
      expect(result).toEqual({ '/foo.ts': 'save' });
    });

    it('adds an operation alongside existing ones', () => {
      const state = makeEditorState({ pendingEditorOperations: { '/bar.ts': 'open' } });
      const result = setEditorOperationPending(state, '/foo.ts', 'save');
      expect(result).toEqual({ '/bar.ts': 'open', '/foo.ts': 'save' });
    });

    it('overwrites existing operation for the same file', () => {
      const state = makeEditorState({ pendingEditorOperations: { '/foo.ts': 'open' } });
      const result = setEditorOperationPending(state, '/foo.ts', 'save');
      expect(result).toEqual({ '/foo.ts': 'save' });
    });

    it('does not mutate the original map', () => {
      const original: Record<string, string> = {};
      const state = makeEditorState({ pendingEditorOperations: original });
      setEditorOperationPending(state, '/foo.ts', 'save');
      expect(original).toEqual({});
    });
  });

  describe('clearEditorOperationPending', () => {
    it('removes an existing operation', () => {
      const state = makeEditorState({ pendingEditorOperations: { '/foo.ts': 'save', '/bar.ts': 'open' } });
      const result = clearEditorOperationPending(state, '/foo.ts');
      expect(result).toEqual({ '/bar.ts': 'open' });
    });

    it('returns empty object when removing the last operation', () => {
      const state = makeEditorState({ pendingEditorOperations: { '/foo.ts': 'save' } });
      const result = clearEditorOperationPending(state, '/foo.ts');
      expect(result).toEqual({});
    });

    it('is no-op when the file has no pending operation', () => {
      const state = makeEditorState({ pendingEditorOperations: { '/bar.ts': 'open' } });
      const result = clearEditorOperationPending(state, '/foo.ts');
      expect(result).toEqual({ '/bar.ts': 'open' });
    });

    it('is no-op on empty map', () => {
      const state = makeEditorState();
      const result = clearEditorOperationPending(state, '/foo.ts');
      expect(result).toEqual({});
    });

    it('does not mutate the original map', () => {
      const original: Record<string, string> = { '/foo.ts': 'save' };
      const state = makeEditorState({ pendingEditorOperations: original });
      clearEditorOperationPending(state, '/foo.ts');
      expect(original).toEqual({ '/foo.ts': 'save' });
    });
  });
});

// ===========================================================================
// Workspace Runtime State helpers
// ===========================================================================

describe('DEFAULT_RUNTIME_STATE', () => {
  it('has warm residency state', () => {
    expect(DEFAULT_RUNTIME_STATE.residencyState).toBe('warm');
  });

  it('has default resource policy', () => {
    expect(DEFAULT_RUNTIME_STATE.resourcePolicy).toEqual({
      terminals: 'warm',
      browser: 'warm',
      explorer: 'cached',
      editor: 'warm',
    });
  });
});

describe('DEFAULT_RESOURCE_POLICY', () => {
  it('has warm terminal policy', () => {
    expect(DEFAULT_RESOURCE_POLICY.terminals).toBe('warm');
  });

  it('has warm browser policy', () => {
    expect(DEFAULT_RESOURCE_POLICY.browser).toBe('warm');
  });

  it('has cached explorer policy', () => {
    expect(DEFAULT_RESOURCE_POLICY.explorer).toBe('cached');
  });

  it('has warm editor policy', () => {
    expect(DEFAULT_RESOURCE_POLICY.editor).toBe('warm');
  });
});

describe('sanitizeRuntimeState', () => {
  it('returns defaults when runtimeState is absent', () => {
    const workspace = makeWorkspace();
    const result = sanitizeRuntimeState(workspace);
    expect(result.residencyState).toBe('warm');
    expect(result.resourcePolicy.terminals).toBe('warm');
    expect(result.resourcePolicy.browser).toBe('warm');
    expect(result.resourcePolicy.explorer).toBe('cached');
    expect(result.resourcePolicy.editor).toBe('warm');
  });

  it('preserves existing runtimeState with defaults for missing sub-fields', () => {
    const workspace = makeWorkspace({
      runtimeState: {
        residencyState: 'cold',
        resourcePolicy: {
          terminals: 'cold',
          browser: 'warm',
          explorer: 'watching',
          editor: 'warm',
        },
      },
    });
    const result = sanitizeRuntimeState(workspace);
    expect(result.residencyState).toBe('cold');
    expect(result.resourcePolicy.terminals).toBe('cold');
    expect(result.resourcePolicy.browser).toBe('warm');
  });

  it('fills in missing sub-fields of resourcePolicy', () => {
    // Cast to allow a partial runtimeState object (missing sub-fields of resourcePolicy)
    const workspace = makeWorkspace({
      runtimeState: {
        residencyState: 'cold',
        resourcePolicy: {
          // Only browser is specified — others should default
          browser: 'cold',
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });
    const result = sanitizeRuntimeState(workspace);
    expect(result.resourcePolicy.terminals).toBe('warm');
    expect(result.resourcePolicy.browser).toBe('cold');
    expect(result.resourcePolicy.explorer).toBe('cached');
    expect(result.resourcePolicy.editor).toBe('warm');
  });

  it('fills in missing residencyState while preserving resourcePolicy', () => {
    // Partial runtimeState to test backfill of missing residencyState.
    // We simulate a workspace with a partial runtimeState (missing residencyState)
    // by constructing the test case manually with as any for the runtimeState assignment.
    const workspace = makeWorkspace();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (workspace as any).runtimeState = {
      resourcePolicy: {
        terminals: 'cold',
        browser: 'cold',
        explorer: 'cached',
        editor: 'cold',
      },
    };
    const result = sanitizeRuntimeState(workspace);
    expect(result.residencyState).toBe('warm'); // default
    expect(result.resourcePolicy.terminals).toBe('cold'); // preserved
  });
});

describe('isWorkspaceWarm', () => {
  it('returns true for warm workspace', () => {
    const ws = makeWorkspace({
      runtimeState: { residencyState: 'warm', resourcePolicy: { terminals: 'warm', browser: 'warm', explorer: 'cached', editor: 'warm' } },
    });
    expect(isWorkspaceWarm(ws)).toBe(true);
  });

  it('returns false for cold workspace', () => {
    const ws = makeWorkspace({
      runtimeState: { residencyState: 'cold', resourcePolicy: { terminals: 'warm', browser: 'warm', explorer: 'cached', editor: 'warm' } },
    });
    expect(isWorkspaceWarm(ws)).toBe(false);
  });

  it('returns false for closing workspace', () => {
    const ws = makeWorkspace({
      runtimeState: { residencyState: 'closing', resourcePolicy: { terminals: 'warm', browser: 'warm', explorer: 'cached', editor: 'warm' } },
    });
    expect(isWorkspaceWarm(ws)).toBe(false);
  });

  it('returns false for errored workspace', () => {
    const ws = makeWorkspace({
      runtimeState: { residencyState: 'errored', resourcePolicy: { terminals: 'warm', browser: 'warm', explorer: 'cached', editor: 'warm' } },
    });
    expect(isWorkspaceWarm(ws)).toBe(false);
  });

  it('returns false when runtimeState is missing (legacy workspace)', () => {
    const ws = makeWorkspace();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (ws as any).runtimeState;
    expect(isWorkspaceWarm(ws as WorkspaceTab)).toBe(false);
  });
});

describe('getWorkspaceResourcePolicy', () => {
  it('returns the resource policy from the workspace', () => {
    const ws = makeWorkspace({
      runtimeState: { residencyState: 'warm', resourcePolicy: { terminals: 'cold', browser: 'warm', explorer: 'cached', editor: 'warm' } },
    });
    const policy = getWorkspaceResourcePolicy(ws);
    expect(policy.terminals).toBe('cold');
    expect(policy.browser).toBe('warm');
  });

  it('returns full defaults when workspace has no runtimeState', () => {
    const ws = makeWorkspace();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (ws as any).runtimeState;
    const policy = getWorkspaceResourcePolicy(ws as WorkspaceTab);
    expect(policy.terminals).toBe('warm');
    expect(policy.browser).toBe('warm');
    expect(policy.explorer).toBe('cached');
    expect(policy.editor).toBe('warm');
  });
});

describe('withWorkspaceResidency', () => {
  it('creates a new workspace with updated residencyState', () => {
    const ws = makeWorkspace();
    const result = withWorkspaceResidency(ws, 'cold');
    expect(result.runtimeState.residencyState).toBe('cold');
  });

  it('preserves other runtimeState fields', () => {
    const ws = makeWorkspace({
      runtimeState: {
        residencyState: 'warm',
        resourcePolicy: { terminals: 'cold', browser: 'warm', explorer: 'cached', editor: 'warm' },
      },
    });
    const result = withWorkspaceResidency(ws, 'cold');
    expect(result.runtimeState.residencyState).toBe('cold');
    expect(result.runtimeState.resourcePolicy.terminals).toBe('cold'); // preserved
    expect(result.runtimeState.resourcePolicy.browser).toBe('warm'); // preserved
  });

  it('does not mutate the original workspace', () => {
    const ws = makeWorkspace({
      runtimeState: { residencyState: 'warm', resourcePolicy: { terminals: 'warm', browser: 'warm', explorer: 'cached', editor: 'warm' } },
    });
    withWorkspaceResidency(ws, 'cold');
    expect(ws.runtimeState.residencyState).toBe('warm');
  });
});

describe('withWorkspaceResourcePolicy', () => {
  it('merges partial policy without clobbering other fields', () => {
    const ws = makeWorkspace({
      runtimeState: {
        residencyState: 'warm',
        resourcePolicy: { terminals: 'warm', browser: 'warm', explorer: 'cached', editor: 'warm' },
      },
    });
    const result = withWorkspaceResourcePolicy(ws, { browser: 'cold' });
    expect(result.runtimeState.resourcePolicy.browser).toBe('cold');
    expect(result.runtimeState.resourcePolicy.terminals).toBe('warm'); // unchanged
    expect(result.runtimeState.resourcePolicy.explorer).toBe('cached'); // unchanged
    expect(result.runtimeState.resourcePolicy.editor).toBe('warm'); // unchanged
  });

  it('updates multiple fields at once', () => {
    const ws = makeWorkspace();
    const result = withWorkspaceResourcePolicy(ws, { browser: 'cold', terminals: 'cold' });
    expect(result.runtimeState.resourcePolicy.browser).toBe('cold');
    expect(result.runtimeState.resourcePolicy.terminals).toBe('cold');
    expect(result.runtimeState.resourcePolicy.explorer).toBe('cached'); // unchanged
  });

  it('does not mutate the original workspace', () => {
    const ws = makeWorkspace({
      runtimeState: { residencyState: 'warm', resourcePolicy: { terminals: 'warm', browser: 'warm', explorer: 'cached', editor: 'warm' } },
    });
    withWorkspaceResourcePolicy(ws, { browser: 'cold' });
    expect(ws.runtimeState.resourcePolicy.browser).toBe('warm');
  });
});

describe('sanitizeWorkspace with runtimeState', () => {
  it('adds runtimeState to a workspace that has none', () => {
    const ws = makeWorkspace();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (ws as any).runtimeState;
    const result = sanitizeWorkspace(ws as WorkspaceTab);
    expect(result.runtimeState).toBeDefined();
    expect(result.runtimeState.residencyState).toBe('warm');
  });

  it('preserves existing runtimeState during sanitize', () => {
    const ws = makeWorkspace({
      runtimeState: {
        residencyState: 'cold',
        resourcePolicy: { terminals: 'cold', browser: 'warm', explorer: 'watching', editor: 'cold' },
      },
    });
    const result = sanitizeWorkspace(ws);
    expect(result.runtimeState.residencyState).toBe('cold');
    expect(result.runtimeState.resourcePolicy.terminals).toBe('cold');
    expect(result.runtimeState.resourcePolicy.explorer).toBe('watching');
  });

  it('sanitizeWorkspace does not mutate the original workspace', () => {
    const ws = makeWorkspace({
      runtimeState: { residencyState: 'warm', resourcePolicy: { terminals: 'warm', browser: 'warm', explorer: 'cached', editor: 'warm' } },
    });
    sanitizeWorkspace(ws);
    expect(ws.runtimeState.residencyState).toBe('warm');
  });
});
