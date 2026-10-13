import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useAssistantNavStore } from '../../../src/renderer/store/assistantNavStore';
import { getActiveWorkspaceSnapshot, prepareWorkspaceActivation, sanitizeWorkspace, validateWorkspaceConsistency } from '../../../src/renderer/store/workspaceStoreHelpers';
import { activePage } from '../../../src/renderer/store/workspacePages';
import { collectLeafPaneIds } from '../../../src/renderer/store/workspaceLayout';
import type { BrowserPaneState, LayoutNode, WorkspaceTab } from '../../../src/renderer/store/workspaceTypes';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';

const store = () => useWorkspaceStore.getState();
const workspace = (id = 'A') => store().getWorkspaceById(id)!;
const referenceFields = ['terminals', 'panes', 'editorTabs', 'explorerExpandedPaths', 'explorerEntriesByPath',
  'explorerLoadingPaths', 'explorerErrorsByPath', 'browserPane', 'pages', 'layoutRoot', 'layoutUndoStack',
  'checkoutContexts', 'runtimeState', 'gitChanges', 'minimizedPanes', 'pendingTerminalIds', 'editorPane', 'notesPane'] as const;
const leaf = (paneId: string): LayoutNode => ({ type: 'leaf', nodeId: `${paneId}-node`, paneId });
function freezeDeep(value: object): void {
  if (Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) if (child && typeof child === 'object') freezeDeep(child);
}
function stable(before: WorkspaceTab, after: WorkspaceTab) {
  for (const key of referenceFields) expect(after[key], key).toBe(before[key]);
}
function coherent() {
  const state = store(); const selected = workspace(state.activeWorkspaceId!);
  expect(state.workspaces.filter(w => w.lifecycle === 'active').map(w => w.id)).toEqual([state.activeWorkspaceId]);
  for (const [key, value] of Object.entries(getActiveWorkspaceSnapshot(selected))) expect(state[key as keyof typeof state], key).toBe(value);
  expect(validateWorkspaceConsistency(state)).toEqual([]);
  expect(prepareWorkspaceActivation(selected)).toBe(selected);
}
function open(id = 'A', environmentId = 'local', root = `/repo/${id}`) {
  const main = { id: `${id}::main`, workspaceId: id, environmentId, path: root, kind: 'main' as const };
  const isolated = { ...main, id: `${id}::task`, path: `${root}-worktrees/task`, kind: 'worktree' as const, branch: 'task' };
  const browser: BrowserPaneState = { id: `${id}-browser`, position: { x: 0, y: 0, w: 6, h: 4 }, activeTabId: `${id}-tab-2`, tabs: [1, 2].map(index => ({ id: `${id}-tab-${index}`, url: `https://example.invalid/${index}`, title: `Tab ${index}`, canGoBack: true, canGoForward: false })) };
  store().addWorkspace(createWorkspaceFixture({ id, environmentId, workspacePath: root, checkoutContexts: [main, isolated],
    terminals: [{ id: `${id}-main`, pid: 1, workingDir: root, checkoutContextId: main.id }, { id: `${id}-task`, pid: 2, workingDir: isolated.path, checkoutContextId: isolated.id }],
    panes: [{ id: `${id}-p1`, terminalId: `${id}-main` }, { id: `${id}-p2`, terminalId: `${id}-task` }], activeTerminalId: `${id}-main`,
    browserVisible: true, browserPane: browser, browserUrl: browser.tabs[1].url,
    editorVisible: true, editorPane: { id: `${id}-editor` }, activeEditorTabId: `${id}-edit`,
    editorTabs: [{ id: `${id}-edit`, filePath: `${isolated.path}/dirty.ts`, fileName: 'dirty.ts', content: 'unsaved', originalContent: 'baseline', isDirty: true, checkoutContextId: isolated.id, checkoutRoot: isolated.path }],
    explorerVisible: true, explorerExpandedPaths: [root, `${root}/src`], explorerSelectedPath: `${root}/src`,
    explorerEntriesByPath: { [root]: [{ name: 'src', path: `${root}/src`, isDirectory: true, size: 0, modified: 1 }] },
    explorerErrorsByPath: { [`${root}/src`]: 'last-known error' }, explorerLoadingPaths: [`${root}/src`],
    pendingTerminalIds: [`${id}-task`], fileSurfaceContextId: isolated.id,
  }));
  return workspace(id);
}
beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useAssistantNavStore.setState({ activeAssistantId: null }); installElectronApiMock();
});

describe('ingestion-normalized live activation', () => {
  it('repeated A→B→A preserves nested references, dirty buffers/baselines, checkout IDs and global viewport', () => {
    open(); open('B');
    const a = workspace(); const b = workspace('B'); const viewport = store().gridViewport;
    freezeDeep(a); freezeDeep(b); // Selection must not mutate either workspace or its shared nested state.
    for (const id of ['A', 'B', 'A', 'B', 'A']) {
      store().selectWorkspace(id); stable(id === 'A' ? a : b, workspace(id)); coherent();
      expect(store().gridViewport).toBe(viewport);
    }
    expect(workspace().editorTabs[0]).toBe(a.editorTabs[0]);
    expect(workspace().editorTabs[0]).toMatchObject({ content: 'unsaved', originalContent: 'baseline', isDirty: true });
    expect(workspace().fileSurfaceContextId).toBe('A::task');
    expect(window.electronAPI.spawnTerminal).not.toHaveBeenCalled(); expect(window.electronAPI.killTerminal).not.toHaveBeenCalled();
  });

  it('keeps an already-active workspace object while retaining publication and Assistant departure semantics', () => {
    const a = open(); const listener = vi.fn(); const unsubscribe = useWorkspaceStore.subscribe(listener);
    useAssistantNavStore.setState({ activeAssistantId: 'assistant' });
    store().selectWorkspace('A');
    expect(workspace()).toBe(a); stable(a, workspace()); coherent();
    expect(listener).toHaveBeenCalledTimes(1); expect(useAssistantNavStore.getState().activeAssistantId).toBeNull();
    unsubscribe();
  });

  it('preserves a cold checkout surface with more than three projects without changing residency or runtime policy', () => {
    for (const id of ['A', 'B', 'C', 'D', 'E']) open(id);
    store().setWorkspaceResidency('A', 'cold'); const a = workspace();
    store().selectWorkspace('A'); stable(a, workspace()); coherent();
    expect(workspace().runtimeState.residencyState).toBe('cold'); // Host, not activation, owns warming.
    expect(workspace().terminals[1].checkoutContextId).toBe('A::task');
  });

  it('reveals a terminal on another page, including minimized/maximized state, without replacing resources', () => {
    open(); const first = workspace().activePageId!;
    store().addWorkspacePage('A'); const second = workspace().activePageId!;
    store().addTerminal({ id: 'other-page', pid: 3, workingDir: '/repo/A', checkoutContextId: 'A::task' }, 'A');
    const pane = workspace().panes.find(p => p.terminalId === 'other-page')!;
    store().minimizeWorkspacePane('A', pane.id); store().selectWorkspacePage('A', first);
    const before = workspace();
    open('B'); store().selectWorkspace('A', 'other-page');
    expect(workspace().activePageId).toBe(second); expect(store().activeTerminalId).toBe('other-page');
    expect(collectLeafPaneIds(workspace().layoutRoot)).toContain(pane.id);
    expect(workspace().minimizedPanes).toEqual([]); expect(activePage(workspace())?.maximizedPaneId).toBeUndefined();
    expect(workspace().fileSurfaceContextId).toBeUndefined();
    for (const key of ['terminals', 'editorTabs', 'checkoutContexts', 'explorerEntriesByPath'] as const) expect(workspace()[key]).toBe(before[key]);
    // Explicit reveal runs membership synchronization; pending IDs may be filtered, never lost/rebound.
    expect(workspace().pendingTerminalIds).toEqual(before.pendingTerminalIds);
    expect(workspace().pages).not.toBe(before.pages); coherent();
    store().toggleMaximizedPane('A', pane.id); store().selectWorkspace('A', 'other-page');
    expect(activePage(workspace())?.maximizedPaneId).toBeUndefined(); coherent();
  });

  it.each(['missing', 'B-main', '', null, 123])('ignores invalid/missing/foreign terminal %j while selecting only the requested workspace', terminalId => {
    open(); open('B'); const a = workspace();
    store().selectWorkspace('A', terminalId as string); stable(a, workspace()); coherent();
    expect(store().activeWorkspaceId).toBe('A'); expect(store().activeTerminalId).toBe('A-main');
    expect(workspace().fileSurfaceContextId).toBe('A::task');
    const state = store(); store().selectWorkspace('unknown', 'B-main'); expect(store()).toBe(state);
  });

  it('keeps multiple pages, independent Browser tab identities, layouts, undo and page associations across switches', () => {
    open(); const first = workspace().activePageId!;
    store().addWorkspacePage('A'); const second = workspace().activePageId!;
    store().setBrowserVisible(true, 'A');
    const secondBrowser = workspace().browserPane!;
    const secondRoot = workspace().layoutRoot!;
    store().selectWorkspacePage('A', first); const a = workspace();
    expect(a.pages![0].browser?.pane?.id).not.toBe(secondBrowser.id);
    open('B'); store().selectWorkspace('A'); stable(a, workspace()); coherent();
    expect(workspace().pages![1].layoutRoot).toBe(secondRoot);
    expect(workspace().pages![1].browser?.pane).toBe(secondBrowser);
    store().selectWorkspacePage('A', second); const projected = workspace();
    store().selectWorkspace('B'); store().selectWorkspace('A'); stable(projected, workspace()); coherent();
    expect(workspace().browserPane).toBe(secondBrowser);
    expect(workspace().browserPane!.tabs).toBe(secondBrowser.tabs);
  });

  it('keeps local and SSH roots distinct and never changes recorded checkout/launch identities', () => {
    open(); open('SSH', 'ssh:fixture', '/repo/A'); const ssh = workspace('SSH');
    expect(store().workspaces).toHaveLength(2);
    expect(ssh.workspacePath).toBe(workspace().workspacePath);
    for (const id of ['A', 'SSH', 'A', 'SSH']) { store().selectWorkspace(id); coherent(); }
    stable(ssh, workspace('SSH'));
    expect(workspace('SSH').environmentId).toBe('ssh:fixture');
    expect(workspace('SSH').checkoutContexts!.every(ctx => ctx.environmentId === 'ssh:fixture')).toBe(true);
    expect(workspace('SSH').terminals[1].checkoutContextId).toBe('SSH::task');
  });

  it('updates parked data at mutation boundaries, then projects the latest references on activation', () => {
    open(); open('B'); const before = workspace(); const globalTabs = store().editorTabs;
    const renders = vi.fn();
    const hook = renderHook(() => { renders(); return useWorkspaceStore(state => state.workspaces.find(w => w.id === 'A')?.editorTabs); });
    act(() => store().updateEditorContent('A-edit', 'new dirty content', 'A'));
    act(() => store().setExplorerExpandedPaths(['/repo/A/new'], 'A'));
    const latest = workspace();
    expect(latest.editorTabs).not.toBe(before.editorTabs); expect(latest.editorTabs[0]).not.toBe(before.editorTabs[0]);
    expect(latest.explorerExpandedPaths).not.toBe(before.explorerExpandedPaths);
    expect(store().editorTabs).toBe(globalTabs);
    expect(hook.result.current).toBe(latest.editorTabs); expect(renders).toHaveBeenCalledTimes(2);
    act(() => store().selectWorkspace('A')); stable(latest, workspace()); coherent();
    expect(renders).toHaveBeenCalledTimes(2); // Activation is not an editor-data mutation.
    expect(workspace().editorTabs[0]).toMatchObject({ content: 'new dirty content', originalContent: 'baseline', isDirty: true });
    hook.unmount();
  });

  it('stays coherent under rapid page/terminal mutations, reservations and repeated switching', () => {
    open(); open('B');
    for (let index = 0; index < 4; index++) {
      store().selectWorkspace('A'); store().addWorkspacePage('A'); const reservedPage = workspace().activePageId!;
      const reservation = store().addPane(null, undefined, 'A', reservedPage)!;
      const parkedPage = workspace().pages![0].id;
      store().selectWorkspacePage('A', parkedPage);
      store().selectWorkspace('B');
      store().addTerminal({ id: `pending-${index}`, pid: 10 + index, workingDir: '/repo/A', checkoutContextId: 'A::task' }, 'A', reservation, reservedPage);
      const latest = workspace();
      expect(latest.activePageId).toBe(parkedPage); // A late launch cannot steal the user's page.
      store().selectWorkspace('A'); stable(latest, workspace()); coherent();
      store().selectWorkspace('A', `pending-${index}`); expect(store().activeTerminalId).toBe(`pending-${index}`);
      expect(workspace().activePageId).toBe(reservedPage); coherent();
      expect(workspace().pendingTerminalIds).toContain(`pending-${index}`);
    }
  });
});

describe('normalization remains at ingestion and compatibility repair', () => {
  it.each(['add', 'hydrate'])('normalizes legacy incomplete data once at %s, then preserves repaired identity', boundary => {
    const legacy = { id: 'old', workspacePath: '/old', name: 'Old', harness: '', model: '',
      terminals: [{ id: 'legacy', pid: 1, workingDir: '/old' }], panes: [{ id: 'p', terminalId: 'legacy' }],
      browserVisible: true, browserUrl: 'https://example.invalid', browserPane: { id: 'browser', tabs: [], activeTabId: 'missing' },
    } as unknown as WorkspaceTab;
    if (boundary === 'add') store().addWorkspace(legacy); else store().hydrateWorkspaceShells([legacy], 'old');
    const repaired = workspace('old');
    expect(repaired.environmentId).toBe('local'); expect(repaired.pages).toHaveLength(1);
    expect(repaired.terminals[0].checkoutContextId).toBe('old::main');
    expect(repaired.checkoutContexts![0]).toMatchObject({ id: 'old::main', path: '/old', environmentId: 'local' });
    expect(repaired.browserPane!.tabs).toHaveLength(1); expect(repaired.browserPane!.activeTabId).toBe(repaired.browserPane!.tabs[0].id);
    expect(repaired.explorerExpandedPaths).toEqual([]); expect(repaired.editorTabs).toEqual([]);
    store().selectWorkspace('old'); stable(repaired, workspace('old')); coherent();
  });

  it('repairs legacy direct setState snapshots once, without rebinding a recorded isolated checkout', () => {
    const legacy = createWorkspaceFixture({ id: 'old', terminals: [{ id: 'agent', pid: 1, workingDir: '/isolated', checkoutContextId: 'old::isolated' }],
      panes: [{ id: 'p', terminalId: 'agent' }], activeTerminalId: 'agent' });
    useWorkspaceStore.setState({ workspaces: [legacy], activeWorkspaceId: null });
    store().selectWorkspace('old'); const repaired = workspace('old');
    expect(repaired.pages).toHaveLength(1); expect(repaired.terminals[0].checkoutContextId).toBe('old::isolated');
    expect(repaired.checkoutContexts![0].id).toBe('old::main');
    store().selectWorkspace('old'); stable(repaired, workspace('old')); coherent();
  });

  it('repairs an inconsistent direct embedding projection rather than trusting page presence alone', () => {
    const initialized = sanitizeWorkspace(createWorkspaceFixture({ id: 'old', panes: [{ id: 'p', terminalId: null }] }));
    const broken = { ...initialized, layoutRoot: leaf('p'), layoutRevision: 42 };
    expect(validateWorkspaceConsistency({ ...getActiveWorkspaceSnapshot(broken), workspaces: [broken], activeWorkspaceId: 'old' }))
      .toContain('P8 violated: active page resource projection differs');
    expect(prepareWorkspaceActivation(broken)).not.toBe(broken);
    useWorkspaceStore.setState({ workspaces: [broken], activeWorkspaceId: null });
    store().selectWorkspace('old'); coherent();
    const repaired = workspace('old'); store().selectWorkspace('old'); stable(repaired, workspace('old'));
  });
});
