// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import App from '../../../src/renderer/App';
import { useUsageStore } from '../../../src/renderer/store/usageStore';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useWorkspaceNavigationStore } from '../../../src/renderer/store/workspaceNavigationStore';
import { useAssistantNavStore } from '../../../src/renderer/store/assistantNavStore';
import { installElectronApiMock } from '../../setup/electron';
import { OPEN_WORKSPACES_STORAGE_KEY, readOpenWorkspaceState } from '../../../src/renderer/lib/openWorkspaceStorage';
import { closeWorkspaceWithCleanup } from '../../../src/renderer/lib/workspaceClose';

vi.mock('../../../src/renderer/components/TerminalPane', () => ({
  default: () => <div data-testid="terminal-surface" />, markTerminalDisposed: vi.fn(),
}));
const state = () => useWorkspaceStore.getState();
const location = (path: string) => ({ environmentId: 'local', path });
async function openFolder(path: string) {
  vi.mocked(window.electronAPI.openDirectoryDialog).mockResolvedValue(path);
  fireEvent.click(screen.getAllByRole('button', { name: 'Open Workspace' })[0]);
  const dialog = await screen.findByRole('dialog', { name: 'Open Workspace' });
  fireEvent.click(screen.getByRole('button', { name: 'Choose Folder…' }));
  await screen.findByDisplayValue(path);
  fireEvent.click(dialog.querySelector('.open-workspace-form > button:last-child')!);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Open Workspace' })).toBeNull());
}
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
  useAssistantNavStore.getState().clearAllAssistants();
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, activeWorkspaceLifecycle: null });
  useWorkspaceNavigationStore.setState({ mode: 'sidebar', resolved: true, sidebarWidth: 280 });
  installElectronApiMock({
    registerOpenWorkspace: vi.fn(async (id: string, path: string, environmentId = 'local') => ({ success: true, location: { path, environmentId },
      checkoutContext: { id: `${id}::main`, workspaceId: id, environmentId, path, kind: 'main' } })),
    gitListWorktrees: vi.fn().mockResolvedValue({ success: true, worktrees: [] }),
    spawnTerminal: vi.fn(async (_path: string, harness?: string, _model?: string, _command?: string, _recipe?: boolean, workspaceId?: string) => ({
      id: 'terminal-new', pid: 1001, harnessId: harness, checkoutContextId: `${workspaceId}::main`,
    })),
  });
});

describe('normal application shell and workspace identity opening', () => {
  it('owns Usage event subscriptions through Strict Mode, independently of widgets, and disposes on teardown', async () => {
    const accounts = new Set<Parameters<Window['electronAPI']['onHarnessAccountsChanged']>[0]>();
    const environments = new Set<Parameters<Window['electronAPI']['onSshEnvironmentInvalidated']>[0]>();
    const api = installElectronApiMock({
      onHarnessAccountsChanged: vi.fn((callback) => { accounts.add(callback); return () => { accounts.delete(callback); }; }),
      onSshEnvironmentInvalidated: vi.fn((callback) => { environments.add(callback); return () => { environments.delete(callback); }; }),
    }, false);
    const app = render(<StrictMode><App /></StrictMode>);
    await screen.findByText('No workspace open');
    expect(accounts.size).toBe(1); expect(environments.size).toBe(1);
    expect(screen.queryByRole('dialog', { name: 'Usage' })).toBeNull();
    act(() => {
      for (const callback of accounts) callback({ type: 'selected', environmentId: 'local', harness: 'codex', accountId: 'a' });
      for (const callback of environments) callback({ environmentId: 'ssh-1', environmentGeneration: 12 });
    });
    expect(useUsageStore.getState().selectedAccounts.local.codex).toBe('a');
    expect(useUsageStore.getState().environmentGenerations['ssh-1']).toBe(12);
    const setups = api.onHarnessAccountsChanged.mock.calls.length;
    app.unmount();
    expect(accounts.size).toBe(0); expect(environments.size).toBe(0);
    const remount = render(<App />);
    expect(accounts.size).toBe(1); expect(environments.size).toBe(1);
    expect(api.onHarnessAccountsChanged).toHaveBeenCalledTimes(setups + 1);
    remount.unmount();
  });
  it.each(['sidebar', 'tabs'] as const)('%s navigation renders immediately with zero workspaces and no launcher', async (mode) => {
    useWorkspaceNavigationStore.setState({ mode });
    render(<App />);
    expect(document.querySelector('.titlebar')).toBeInTheDocument();
    expect(document.querySelector('.header')).toBeInTheDocument();
    expect(document.querySelector('.status-bar')).toBeInTheDocument();
    expect(await screen.findByText('No workspace open')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Open Workspace' }).length).toBeGreaterThan(0);
    expect(document.querySelector('.workspace-gate')).toBeNull();
    expect(window.electronAPI.spawnTerminal).not.toHaveBeenCalled();
    if (mode === 'sidebar') expect(screen.getByTestId('workspace-sidebar')).toBeInTheDocument();
  });
  it('opens an empty shell, then launches the first terminal explicitly from Header', async () => {
    render(<App />);
    await screen.findByText('No workspace open');
    await openFolder('/repo');
    expect(state().workspaces[0]).toMatchObject({ terminals: [], panes: [], activeTerminalId: null, layoutRoot: null });
    expect(await screen.findByText('No terminals open')).toBeInTheDocument();
    expect(window.electronAPI.spawnTerminal).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Terminal' }));
    await waitFor(() => expect(state().workspaces[0].terminals).toHaveLength(1));
    expect(window.electronAPI.spawnTerminal).toHaveBeenCalledWith('/repo', undefined, undefined, undefined, undefined, state().activeWorkspaceId, 'local');
    expect(state().workspaces[0].terminals[0].checkoutContextId).toBe(`${state().activeWorkspaceId}::main`);
  });
  it('releases the Open Workspace overlay from its original owner after opening a different shell', async () => {
    render(<App />); await screen.findByText('No workspace open');
    await openFolder('/a'); const a = state().activeWorkspaceId!;
    await openFolder('/b');
    expect(state().workspaces.find((workspace) => workspace.id === a)?.browserOverlayCount).toBe(0);
    expect(state().workspaces.every((workspace) => !workspace.browserOverlayCount)).toBe(true);
  });
  it('uses main canonical identity and selects post-canonical duplicates', async () => {
    vi.mocked(window.electronAPI.registerOpenWorkspace).mockImplementation(async (id: string) => ({ success: true, location: location('/canonical'),
      checkoutContext: { id: `${id}::main`, workspaceId: id, environmentId: 'local', path: '/canonical', kind: 'main' } }));
    render(<App />); await screen.findByText('No workspace open');
    await openFolder('/alias-one'); const id = state().activeWorkspaceId;
    await openFolder('/alias-two');
    expect(state().activeWorkspaceId).toBe(id);
    expect(state().workspaces).toHaveLength(1);
    expect(readOpenWorkspaceState().workspaces).toEqual([location('/canonical')]);
    expect(window.electronAPI.unregisterOpenWorkspace).toHaveBeenCalledOnce();
  });
  it('restores order and active identity after a real App remount without resurrecting presentation', async () => {
    const first = render(<App />); await screen.findByText('No workspace open');
    await openFolder('/a'); const a = state().activeWorkspaceId!;
    await openFolder('/b'); const b = state().activeWorkspaceId!;
    await openFolder('/c'); const c = state().activeWorkspaceId!;
    act(() => { state().moveWorkspace(c, a); state().selectWorkspace(b); state().toggleNotesPane(); state().setBrowserVisible(true, b); });
    expect(readOpenWorkspaceState()).toEqual({ version: 1, workspaces: [location('/c'), location('/a'), location('/b')], activeWorkspace: location('/b') });
    first.unmount();
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
    vi.mocked(window.electronAPI.spawnTerminal).mockClear();
    vi.mocked(window.electronAPI.browserCreateTab).mockClear();
    render(<App />);
    await waitFor(() => expect(state().workspaces).toHaveLength(3));
    expect(state().workspaces.map((w) => w.workspacePath)).toEqual(['/c', '/a', '/b']);
    expect(state().workspacePath).toBe('/b');
    expect(state().activeWorkspaceId).not.toBe(b);
    for (const workspace of state().workspaces) expect(workspace).toMatchObject({ terminals: [], panes: [], layoutRoot: null,
      activeTerminalId: null, browserVisible: false, browserPane: null, editorVisible: false, editorTabs: [], notesVisible: false, explorerVisible: false });
    expect(window.electronAPI.spawnTerminal).not.toHaveBeenCalled();
    expect(window.electronAPI.browserCreateTab).not.toHaveBeenCalled();
    expect(window.electronAPI.invokeSession).not.toHaveBeenCalled();
  });
  it('closing commits removal to storage and it stays gone on restart', async () => {
    const app = render(<App />); await screen.findByText('No workspace open');
    await openFolder('/a'); const a = state().activeWorkspaceId!;
    await openFolder('/b');
    await act(async () => { await closeWorkspaceWithCleanup(a); });
    expect(readOpenWorkspaceState().workspaces).toEqual([location('/b')]);
    app.unmount(); useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
    render(<App />); await waitFor(() => expect(state().workspaces).toHaveLength(1));
    expect(state().workspaces[0].workspacePath).toBe('/b');
  });
  it('restores valid identities while reporting registration failures through notifications', async () => {
    window.localStorage.setItem(OPEN_WORKSPACES_STORAGE_KEY, JSON.stringify({ version: 1, workspaces: [location('/missing'), location('/valid')], activeWorkspace: location('/missing') }));
    vi.mocked(window.electronAPI.registerOpenWorkspace).mockImplementation(async (_id: string, path: string) => path === '/missing'
      ? { success: false, error: 'Directory missing' } : { success: true, location: location(path) });
    render(<App />);
    expect(document.querySelector('.titlebar')).toBeInTheDocument();
    await waitFor(() => expect(state().workspaces).toHaveLength(1));
    expect(state().workspacePath).toBe('/valid');
    expect(await screen.findByText(/1 workspace could not be reopened/)).toBeInTheDocument();
    expect(readOpenWorkspaceState().workspaces).toEqual([location('/valid')]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
