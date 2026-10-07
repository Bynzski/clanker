// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installElectronApiMock } from '../../setup/electron';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useAssistantNavStore } from '../../../src/renderer/store/assistantNavStore';
import { useNotificationStore } from '../../../src/renderer/store/notificationStore';
import { prepareWorkspaceShell, openWorkspace } from '../../../src/renderer/lib/openWorkspace';
import { OPEN_WORKSPACES_STORAGE_KEY, parseOpenWorkspaceState, persistOpenWorkspaces, readOpenWorkspaceState } from '../../../src/renderer/lib/openWorkspaceStorage';
import { startWorkspaceRestoration } from '../../../src/renderer/lib/workspaceStartup';
import { createWorkspaceFixture } from '../../setup/fixtures';

const local = (path: string) => ({ environmentId: 'local', path });
const remote = (path: string) => ({ environmentId: 'ssh-host', path });
const store = () => useWorkspaceStore.getState();
function save(workspaces = [local('/a')], activeWorkspace = workspaces[0]) {
  window.localStorage.setItem(OPEN_WORKSPACES_STORAGE_KEY, JSON.stringify({ version: 1, workspaces, activeWorkspace }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
async function restore() {
  const restoration = startWorkspaceRestoration();
  await restoration.done;
  restoration.dispose();
}
beforeEach(() => {
  vi.restoreAllMocks();
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    clear: () => values.clear(),
  } });
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, activeWorkspaceLifecycle: null });
  useAssistantNavStore.getState().clearAllAssistants();
  useNotificationStore.setState({ notifications: [] });
  installElectronApiMock({
    registerOpenWorkspace: vi.fn(async (_id: string, path: string, environmentId: string) => ({ success: true, location: { path, environmentId } })),
    unregisterOpenWorkspace: vi.fn().mockResolvedValue({ success: true }),
    gitListWorktrees: vi.fn().mockResolvedValue({ success: true, worktrees: [] }),
  });
});

describe('current open identity persistence', () => {
  it('reads empty and malformed storage safely', () => {
    expect(readOpenWorkspaceState()).toEqual({ version: 1, workspaces: [] });
    for (const raw of ['{', 'null', '[]', '{"version":2,"workspaces":[]}', '{"version":1,"workspaces":"wrong"}']) {
      window.localStorage.setItem(OPEN_WORKSPACES_STORAGE_KEY, raw);
      expect(readOpenWorkspaceState().workspaces).toEqual([]);
    }
  });
  it('preserves order and active identity, deduplicates path forms and separates environments', () => {
    expect(parseOpenWorkspaceState({ version: 1, workspaces: [local('/a/'), local('/a'), remote('/a'), local('/b')], activeWorkspace: local('/b/') }))
      .toEqual({ version: 1, workspaces: [local('/a'), remote('/a'), local('/b')], activeWorkspace: local('/b') });
  });
  it('drops invalid identities independently', () => {
    expect(parseOpenWorkspaceState({ version: 1, workspaces: [null, {}, local('relative'), remote('C:/repo'), local('/a\0'), { environmentId: '../bad', path: '/b' }, local('/good')] }).workspaces)
      .toEqual([local('/good')]);
  });
  it('stores only identity, never runtime ids or presentation', async () => {
    const shell = await prepareWorkspaceShell(local('/a'));
    persistOpenWorkspaces([shell], shell.id);
    expect(readOpenWorkspaceState()).toEqual({ version: 1, workspaces: [local('/a')], activeWorkspace: local('/a') });
    expect(window.localStorage.getItem(OPEN_WORKSPACES_STORAGE_KEY)).not.toContain(shell.id);
  });
  it('continuous persistence tracks open, reorder, selection and close without historical slots', async () => {
    const restoration = startWorkspaceRestoration(); await restoration.done;
    const a = await openWorkspace(local('/a')); const b = await openWorkspace(local('/b'));
    expect(readOpenWorkspaceState().activeWorkspace).toEqual(local('/b'));
    store().moveWorkspace(b.id, a.id);
    expect(readOpenWorkspaceState().workspaces).toEqual([local('/b'), local('/a')]);
    store().selectWorkspace(a.id);
    expect(readOpenWorkspaceState().activeWorkspace).toEqual(local('/a'));
    store().closeWorkspace(b.id);
    expect(readOpenWorkspaceState().workspaces).toEqual([local('/a')]);
    store().closeWorkspace(a.id);
    expect(readOpenWorkspaceState()).toEqual({ version: 1, workspaces: [] });
    restoration.dispose();
  });
  it('does not persist a failed open', async () => {
    const restoration = startWorkspaceRestoration(); await restoration.done;
    vi.mocked(window.electronAPI.registerOpenWorkspace).mockResolvedValue({ success: false, error: 'missing' });
    await expect(openWorkspace(local('/missing'))).rejects.toThrow('missing');
    expect(readOpenWorkspaceState().workspaces).toEqual([]);
    restoration.dispose();
  });
  it('storage read/write failures do not prevent opening', async () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readOpenWorkspaceState().workspaces).toEqual([]);
    await expect(openWorkspace(local('/a'))).resolves.toMatchObject({ workspacePath: '/a' });
    expect(() => persistOpenWorkspaces(store().workspaces, store().activeWorkspaceId)).not.toThrow();
  });
});

describe('canonical workspace opening', () => {
  it.each([local('/local'), remote('/remote')])('registers %j and returns an empty shell using scoped Git lookup', async (location) => {
    const shell = await openWorkspace(location);
    expect(window.electronAPI.registerOpenWorkspace).toHaveBeenCalledWith(shell.id, location.path, location.environmentId);
    expect(window.electronAPI.gitListWorktrees).toHaveBeenCalledWith(location.path, shell.id);
    expect(shell).toMatchObject({ terminals: [], panes: [], layoutRoot: null, activeTerminalId: null,
      browserVisible: false, browserPane: null, editorVisible: false, editorTabs: [], notesVisible: false, notesPane: null, explorerVisible: false });
    expect(window.electronAPI.spawnTerminal).not.toHaveBeenCalled();
    expect(window.electronAPI.invokeSession).not.toHaveBeenCalled();
    expect(window.electronAPI.browserCreateTab).not.toHaveBeenCalled();
  });
  it('selects an obvious duplicate without registering again', async () => {
    const shell = await openWorkspace(local('/a'));
    await openWorkspace(local('/a/'));
    expect(window.electronAPI.registerOpenWorkspace).toHaveBeenCalledOnce();
    expect(store().activeWorkspaceId).toBe(shell.id);
  });
  it('uses main canonical path and releases a post-canonical duplicate', async () => {
    const shell = await openWorkspace(local('/canonical'));
    vi.mocked(window.electronAPI.registerOpenWorkspace).mockResolvedValue({ success: true, location: local('/canonical') });
    const selected = await openWorkspace(local('/alias'));
    expect(selected.id).toBe(shell.id);
    expect(store().workspaces).toHaveLength(1);
    expect(window.electronAPI.unregisterOpenWorkspace).toHaveBeenCalledOnce();
  });
  it('retains linked worktree metadata without widening its root', async () => {
    vi.mocked(window.electronAPI.registerOpenWorkspace).mockImplementation(async (id: string) => ({ success: true, location: local('/repo-worktrees/topic'),
      checkoutContext: { id: `${id}::main`, workspaceId: id, environmentId: 'local', path: '/repo-worktrees/topic', kind: 'main' } }));
    vi.mocked(window.electronAPI.gitListWorktrees).mockResolvedValue({ success: true, worktrees: [
      { path: '/repo', isMain: true, branch: 'main' }, { path: '/repo-worktrees/topic', isMain: false, branch: 'topic' },
    ] });
    const shell = await openWorkspace(local('/alias'));
    expect(shell).toMatchObject({ workspacePath: '/repo-worktrees/topic', projectName: 'repo', isLinkedWorktree: true,
      checkoutContexts: [expect.objectContaining({ path: '/repo-worktrees/topic', kind: 'worktree', branch: 'topic', mainCheckoutPath: '/repo' })] });
  });
  it('unregisters when main returns the wrong environment, never falls back to local', async () => {
    vi.mocked(window.electronAPI.registerOpenWorkspace).mockResolvedValue({ success: true, location: local('/remote') });
    await expect(openWorkspace(remote('/remote'))).rejects.toThrow('unexpected environment');
    expect(window.electronAPI.unregisterOpenWorkspace).toHaveBeenCalledOnce();
    expect(store().workspaces).toEqual([]);
  });
  it('unregisters when returned checkout authority is inconsistent', async () => {
    vi.mocked(window.electronAPI.registerOpenWorkspace).mockResolvedValue({ success: true, location: local('/a'),
      checkoutContext: { id: 'other::main', workspaceId: 'other', environmentId: 'local', path: '/a', kind: 'main' } });
    await expect(openWorkspace(local('/a'))).rejects.toThrow('invalid checkout context');
    expect(window.electronAPI.unregisterOpenWorkspace).toHaveBeenCalledOnce();
  });
  it('refuses generated worktree containers and cleans up registration', async () => {
    vi.mocked(window.electronAPI.gitGetBranchState).mockResolvedValue({ success: true, isRepo: true });
    vi.mocked(window.electronAPI.gitListWorktrees).mockImplementation(async (path: string) => ({ success: true, worktrees: path === '/repo'
      ? [{ path: '/repo', isMain: true }, { path: '/repo-worktrees/topic', isMain: false }] : [] }));
    await expect(openWorkspace(local('/repo-worktrees'))).rejects.toThrow('holds worktrees');
    expect(window.electronAPI.unregisterOpenWorkspace).toHaveBeenCalledOnce();
  });
});

describe('startup shell hydration', () => {
  it('commits multiple mixed identities once, in order, with exactly one active lifecycle', async () => {
    save([local('/a'), remote('/b'), local('/c')], remote('/b'));
    const changes: string[][] = [];
    const unsubscribe = useWorkspaceStore.subscribe((state) => { changes.push(state.workspaces.map((w) => w.workspacePath)); });
    await restore(); unsubscribe();
    expect(changes).toEqual([['/a', '/b', '/c']]);
    expect(store().workspaces.map((w) => w.lifecycle)).toEqual(['parked', 'active', 'parked']);
    expect(store().workspacePath).toBe('/b');
    expect(window.electronAPI.spawnTerminal).not.toHaveBeenCalled();
    expect(window.electronAPI.invokeSession).not.toHaveBeenCalled();
    expect(window.electronAPI.browserCreateTab).not.toHaveBeenCalled();
    for (const shell of store().workspaces) expect(shell).toMatchObject({ terminals: [], panes: [], layoutRoot: null, activeTerminalId: null,
      browserVisible: false, browserPane: null, editorTabs: [], editorVisible: false, notesVisible: false, explorerVisible: false });
  });
  it('ignores every old layout / Notes visibility entry', async () => {
    save();
    window.localStorage.setItem('clanker-grid:notes-visible:v1:local%3A%3A%2Fa', '1');
    window.localStorage.setItem('clanker-grid:layout:v1:local%3A%3A%2Fa', JSON.stringify({ version: 1, terminalCount: 0, explorerVisible: true, root: { type: 'leaf', paneKey: 'browser' } }));
    await restore();
    expect(store().workspaces[0]).toMatchObject({ layoutRoot: null, panes: [], terminals: [], notesVisible: false, browserVisible: false, editorVisible: false, explorerVisible: false });
  });
  it.each([local('/missing'), remote('/missing')])('omits failed %j independently, warns and chooses first survivor', async (missing) => {
    save([missing, local('/survivor'), remote('/other')], missing);
    vi.mocked(window.electronAPI.registerOpenWorkspace).mockImplementation(async (_id: string, path: string, environmentId = 'local') =>
      path === '/missing' ? { success: false, error: 'Unavailable directory or environment' } : { success: true, location: { path, environmentId } });
    await restore();
    expect(store().workspaces.map((w) => w.workspacePath)).toEqual(['/survivor', '/other']);
    expect(store().workspacePath).toBe('/survivor');
    expect(readOpenWorkspaceState().workspaces).toEqual([local('/survivor'), remote('/other')]);
    expect(useNotificationStore.getState().notifications).toEqual([expect.objectContaining({ tone: 'warning', message: expect.stringContaining('1 workspace could not be reopened') })]);
  });
  it('reports malformed saved identities while restoring valid ones', async () => {
    window.localStorage.setItem(OPEN_WORKSPACES_STORAGE_KEY, JSON.stringify({ version: 1,
      workspaces: [null, { environmentId: 'local', path: 'relative' }, local('/valid')] }));
    await restore();
    expect(store().workspaces.map((workspace) => workspace.workspacePath)).toEqual(['/valid']);
    expect(window.electronAPI.registerOpenWorkspace).toHaveBeenCalledOnce();
    expect(readOpenWorkspaceState().workspaces).toEqual([local('/valid')]);
    expect(useNotificationStore.getState().notifications[0].message).toContain('2 workspaces could not be reopened');
  });
  it('deduplicates saved path forms before main registration', async () => {
    save([local('/a'), local('/a/'), local('/b')]);
    await restore();
    expect(window.electronAPI.registerOpenWorkspace).toHaveBeenCalledTimes(2);
    expect(store().workspaces).toHaveLength(2);
  });
  it('deduplicates canonical aliases and releases the extra registration', async () => {
    save([local('/alias-one'), local('/alias-two')]);
    vi.mocked(window.electronAPI.registerOpenWorkspace).mockResolvedValue({ success: true, location: local('/a') });
    await restore();
    expect(store().workspaces).toHaveLength(1);
    expect(window.electronAPI.unregisterOpenWorkspace).toHaveBeenCalledOnce();
  });
  it('keeps the saved active shell when main canonicalizes its old path', async () => {
    save([local('/first'), local('/alias')], local('/alias'));
    vi.mocked(window.electronAPI.registerOpenWorkspace).mockImplementation(async (_id: string, path: string) => ({ success: true, location: local(path === '/alias' ? '/canonical' : path) }));
    await restore();
    expect(store().workspacePath).toBe('/canonical');
    expect(readOpenWorkspaceState().activeWorkspace).toEqual(local('/canonical'));
  });
  it('maps a selected prepared duplicate to its surviving live runtime id atomically', () => {
    const live = createWorkspaceFixture({ id: 'live', workspacePath: '/a' });
    const background = createWorkspaceFixture({ id: 'background', workspacePath: '/b' });
    store().addWorkspace(live); store().addWorkspace(background);
    store().hydrateWorkspaceShells([createWorkspaceFixture({ id: 'prepared', workspacePath: '/a' })], 'prepared');
    expect(store().activeWorkspaceId).toBe('live');
    expect(store().workspaces).toHaveLength(2);
  });
  it('never truncates saved identities while a later registration is pending', async () => {
    save([local('/a'), local('/b'), local('/c')]);
    const pending = deferred<{ success: boolean; location: ReturnType<typeof local> }>();
    vi.mocked(window.electronAPI.registerOpenWorkspace).mockImplementation(async (_id: string, path: string) => path === '/b' ? pending.promise : { success: true, location: local(path) });
    const restoration = startWorkspaceRestoration();
    await vi.waitFor(() => expect(window.electronAPI.registerOpenWorkspace).toHaveBeenCalledTimes(2));
    expect(store().workspaces).toEqual([]);
    expect(readOpenWorkspaceState().workspaces).toEqual([local('/a'), local('/b'), local('/c')]);
    pending.resolve({ success: true, location: local('/b') });
    await restoration.done; restoration.dispose();
  });
  it('merges a manual open during restoration, preserves its active selection and cleans duplicates', async () => {
    save([local('/a'), local('/b')], local('/a'));
    const pending = deferred<{ success: boolean; location: ReturnType<typeof local> }>();
    vi.mocked(window.electronAPI.registerOpenWorkspace).mockImplementationOnce(() => pending.promise);
    const restoration = startWorkspaceRestoration();
    const manual = await openWorkspace(local('/a'));
    const manualB = await openWorkspace(local('/manual'));
    pending.resolve({ success: true, location: local('/a') });
    await restoration.done; restoration.dispose();
    expect(store().workspaces.map((w) => w.workspacePath)).toEqual(['/a', '/manual', '/b']);
    expect(store().activeWorkspaceId).toBe(manualB.id);
    expect(store().workspaces.find((w) => w.workspacePath === '/a')?.id).toBe(manual.id);
    expect(window.electronAPI.unregisterOpenWorkspace).toHaveBeenCalledOnce();
  });
  it('keeps an Assistant selected during background hydration', async () => {
    save([local('/a'), local('/b')]);
    useAssistantNavStore.setState({ activeAssistantId: 'hermes:bot', openedAssistantIds: ['hermes:bot'] });
    const clear = vi.spyOn(useAssistantNavStore.getState(), 'clearActive');
    await restore();
    expect(clear).not.toHaveBeenCalled();
    expect(useAssistantNavStore.getState().activeAssistantId).toBe('hermes:bot');
    expect(store().workspaces.filter((w) => w.lifecycle === 'active')).toHaveLength(1);
  });
  it('cleans prepared authority on unmount without rewriting the saved set', async () => {
    save([local('/a'), local('/b')]);
    const pending = deferred<{ success: boolean; location: ReturnType<typeof local> }>();
    vi.mocked(window.electronAPI.registerOpenWorkspace).mockImplementationOnce(() => pending.promise);
    const restoration = startWorkspaceRestoration(); restoration.dispose();
    pending.resolve({ success: true, location: local('/a') });
    await restoration.done;
    expect(store().workspaces).toEqual([]);
    expect(window.electronAPI.unregisterOpenWorkspace).toHaveBeenCalledOnce();
    expect(readOpenWorkspaceState().workspaces).toHaveLength(2);
  });
  it('does not resurrect a workspace opened then explicitly closed during startup', async () => {
    save();
    const pending = deferred<{ success: boolean; location: ReturnType<typeof local> }>();
    vi.mocked(window.electronAPI.registerOpenWorkspace).mockImplementationOnce(() => pending.promise);
    const restoration = startWorkspaceRestoration();
    const manual = await openWorkspace(local('/a')); store().closeWorkspace(manual.id);
    pending.resolve({ success: true, location: local('/a') });
    await restoration.done; restoration.dispose();
    expect(store().workspaces).toEqual([]);
    expect(readOpenWorkspaceState().workspaces).toEqual([]);
  });
  it('hydrates collection with one transition and leaves background residency to the host', () => {
    const a = createWorkspaceFixture({ id: 'a' }); const b = createWorkspaceFixture({ id: 'b', workspacePath: '/b' });
    const listener = vi.fn(); const off = useWorkspaceStore.subscribe(listener);
    store().hydrateWorkspaceShells([a, b], a.id); off();
    expect(listener).toHaveBeenCalledOnce();
    expect(store().workspaces.map((w) => w.lifecycle)).toEqual(['active', 'parked']);
    expect(store().workspaces.every((w) => w.runtimeState.residencyState === 'warm')).toBe(true);
  });
});
