// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../../src/renderer/App';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';

function resetStore() {
  useWorkspaceStore.setState({
    name: '',
    workspacePath: '',
    harness: 'codex',
    model: '',
    terminals: [],
    panes: [],
    browserVisible: false,
    browserOverlayCount: 0,
    browserUrl: 'https://github.com',
    activeTerminalId: null,
    browserPane: null,
    layoutRoot: null,
    explorerVisible: false,
    explorerSidebarWidth: 280,
    explorerExpandedPaths: [],
    explorerSelectedPath: null,
    explorerEntriesByPath: {},
    explorerLoadingPaths: [],
    explorerErrorsByPath: {},
    showHiddenFiles: true,
    workspaces: [],
    activeWorkspaceId: null,
    gridViewport: { cols: 12, rows: 8 },
    layoutRevision: 0,
    editorVisible: false,
    editorPane: null,
    editorTabs: [],
    activeEditorTabId: null,
    gitChanges: [],
  });
}

async function chooseBasicTerminal() {
  const add = screen.getByRole('button', { name: 'Add plain terminal' });
  await waitFor(() => expect(add).toBeEnabled());
  fireEvent.click(add);
}

describe('App workspace open integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
    });
    installElectronApiMock({
      getLastWorkspace: vi.fn().mockResolvedValue('/workspace/'),
      getHarnessOptions: vi.fn().mockResolvedValue({ codex: true, '': true }),
      getHarnessModels: vi.fn().mockResolvedValue([]),
      spawnTerminal: vi.fn().mockResolvedValue({ id: 'terminal-1', pid: 1234 }),
      getTerminalBuffer: vi.fn().mockResolvedValue(''),
      fileListDirectory: vi.fn().mockResolvedValue({ success: true, entries: [] }),
    });
  });

  it('shows the main screen after selecting a workspace', async () => {
    render(<App />);

    expect(screen.getByText('Launch Workspace')).toBeInTheDocument();
    const pathInput = document.querySelector('.gate-input') as HTMLInputElement | null;
    expect(pathInput).toBeTruthy();

    await act(async () => {
      fireEvent.change(pathInput!, { target: { value: '/workspace/' } });
    });

    await act(async () => {
      await chooseBasicTerminal();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Launch Workspace' })).toBeEnabled());
      fireEvent.click(screen.getByText('Launch Workspace'));
    });

    await waitFor(() => {
      expect(document.querySelector('.titlebar')).toBeTruthy();
      expect(document.querySelector('.header')).toBeTruthy();
      expect(document.querySelector('.main-content')).toBeTruthy();
    });
    const workspace = useWorkspaceStore.getState().workspaces[0];
    expect(window.electronAPI.registerOpenWorkspace).toHaveBeenCalledWith(workspace.id, '/workspace/');
    expect(vi.mocked(window.electronAPI.registerOpenWorkspace).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(window.electronAPI.spawnTerminal).mock.invocationCallOrder[0]);
  });

  it.each(['fullscreen', 'modal'])('spawns mixed harness counts with displayed models at the canonical root from the %s launcher', async (shell) => {
    installElectronApiMock({
      getHarnessOptions: vi.fn().mockResolvedValue({ codex: true, pi: true }),
      getHarnessModels: vi.fn(async (harness) => [{ id: `${harness}-model`, label: `${harness} Model` }]),
      registerOpenWorkspace: vi.fn().mockResolvedValue({ success: true, location: { environmentId: 'local', path: '/canonical' } }),
      spawnTerminal: vi.fn().mockImplementation(async (_path, harness) => ({ id: crypto.randomUUID(), pid: 1234, harnessId: harness })),
    });
    render(<App />);
    await screen.findByRole('button', { name: 'codex model' });
    if (shell === 'modal') {
      await chooseBasicTerminal();
      fireEvent.change(screen.getByLabelText('Workspace directory'), { target: { value: '/first' } });
      fireEvent.click(screen.getByRole('button', { name: 'Launch Workspace' }));
      await screen.findByRole('button', { name: 'Open Workspace' });
      vi.mocked(window.electronAPI.spawnTerminal).mockClear();
      vi.mocked(window.electronAPI.registerOpenWorkspace).mockResolvedValue({ success: true, location: { environmentId: 'local', path: '/second-canonical' } });
      fireEvent.click(screen.getByRole('button', { name: 'Open Workspace' }));
      await screen.findByRole('button', { name: 'codex model' });
    }
    await screen.findByText('codex Model');
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: 'Add Codex terminal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Codex terminal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Pi terminal' }));
    fireEvent.change(screen.getByLabelText('Workspace directory'), { target: { value: '/alias' } });
    fireEvent.click(screen.getByRole('button', { name: 'Launch Workspace' }));
    await waitFor(() => expect(useWorkspaceStore.getState().workspaces).toHaveLength(shell === 'modal' ? 2 : 1));
    const root = shell === 'modal' ? '/second-canonical' : '/canonical';
    expect(vi.mocked(window.electronAPI.spawnTerminal).mock.calls).toEqual([
      [root, 'codex', 'codex-model'], [root, 'codex', 'codex-model'],
      [root, 'codex', 'codex-model'], [root, 'pi', 'pi-model'],
    ]);
    expect(useWorkspaceStore.getState().workspaces[shell === 'modal' ? 1 : 0].terminals.map((terminal) => terminal.harnessId)).toEqual(['codex', 'codex', 'codex', 'pi']);
  });

  it('releases the launcher overlay from the workspace that opened it', async () => {
    render(<App />);

    const initialPathInput = document.querySelector('.gate-input') as HTMLInputElement;
    fireEvent.change(initialPathInput, { target: { value: '/workspace/' } });
    await chooseBasicTerminal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Launch Workspace' })).toBeEnabled());
    fireEvent.click(screen.getByText('Launch Workspace'));

    await waitFor(() => {
      expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    });
    const firstWorkspaceId = useWorkspaceStore.getState().activeWorkspaceId!;

    fireEvent.click(screen.getByRole('button', { name: 'Open Workspace' }));
    expect(useWorkspaceStore.getState().getWorkspaceById(firstWorkspaceId)?.browserOverlayCount).toBe(1);

    const nextPathInput = document.querySelector('.gate-input') as HTMLInputElement;
    fireEvent.change(nextPathInput, { target: { value: '/second-workspace/' } });
    await chooseBasicTerminal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Launch Workspace' })).toBeEnabled());
    fireEvent.click(screen.getByText('Launch Workspace'));

    await waitFor(() => {
      expect(useWorkspaceStore.getState().workspaces).toHaveLength(2);
    });
    expect(useWorkspaceStore.getState().getWorkspaceById(firstWorkspaceId)?.browserOverlayCount).toBe(0);
    expect(useWorkspaceStore.getState().browserOverlayCount).toBe(0);
  });

  it('uses the canonical SSH registration path for workspace state and terminal spawning', async () => {
    const registerOpenWorkspace = vi.fn().mockResolvedValue({
      success: true, location: { environmentId: 'dev-vps', path: '/srv/projects/project' },
    });
    const spawnTerminal = vi.fn().mockResolvedValue({ id: 'remote-terminal', pid: 1234 });
    installElectronApiMock({
      sshEnvironmentList: vi.fn().mockResolvedValue([{ id: 'dev-vps', label: 'Dev VPS', target: 'dev-vps' }]),
      registerOpenWorkspace, spawnTerminal,
    });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose location: This PC' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Dev VPS, dev-vps' }));
    await screen.findByLabelText('Remote Directory Path');
    fireEvent.change(screen.getByLabelText('Remote Directory Path'), {
      target: { value: '/home/jay/project' },
    });
    // The target selector renders before asynchronous harness discovery is ready.
    await chooseBasicTerminal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Launch Workspace' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Launch Workspace' }));
    await waitFor(() => expect(useWorkspaceStore.getState().workspaces).toHaveLength(1));
    const workspace = useWorkspaceStore.getState().workspaces[0];
    expect(registerOpenWorkspace).toHaveBeenCalledWith(workspace.id, '/home/jay/project', 'dev-vps');
    expect(workspace.workspacePath).toBe('/srv/projects/project');
    expect(workspace.terminals[0].workingDir).toBe('/srv/projects/project');
    expect(spawnTerminal).toHaveBeenCalledWith('/srv/projects/project', expect.anything(), undefined,
      undefined, undefined, workspace.id, 'dev-vps');
  });

  it('preserves branch identity when an SSH checkout is registered at its canonical remote path', async () => {
    installElectronApiMock({
      sshEnvironmentList: vi.fn().mockResolvedValue([{ id: 'dev-vps', label: 'Dev VPS', target: 'dev-vps' }]),
      registerOpenWorkspace: vi.fn().mockResolvedValue({ success: true, location: { environmentId: 'dev-vps', path: '/srv/task' } }),
      gitListWorktrees: vi.fn().mockResolvedValue({ success: true, worktrees: [
        { path: '/srv/project', branch: 'main', isMain: true, isLocked: false, isPrunable: false },
        { path: '/srv/task', branch: 'task/ssh', isMain: false, isLocked: false, isPrunable: false },
      ] }),
    });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose location: This PC' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Dev VPS, dev-vps' }));
    await screen.findByLabelText('Remote Directory Path');
    await chooseBasicTerminal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Launch Workspace' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Remote Directory Path'), { target: { value: '/alias/task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Launch Workspace' }));
    await waitFor(() => expect(useWorkspaceStore.getState().workspaces[0]).toMatchObject({ environmentId: 'dev-vps', workspacePath: '/srv/task', isLinkedWorktree: true, gitCurrentBranch: 'task/ssh', projectName: 'project' }));
    const workspace = useWorkspaceStore.getState().workspaces[0];
    expect(window.electronAPI.gitListWorktrees).toHaveBeenCalledWith('/srv/task', workspace.id);
    expect(window.electronAPI.spawnTerminal).toHaveBeenCalledWith('/srv/task', expect.anything(), undefined, undefined, undefined, workspace.id, 'dev-vps');
  });

  it('keeps the launcher open when main rejects workspace registration', async () => {
    installElectronApiMock({ registerOpenWorkspace: vi.fn().mockResolvedValue({ success: false, error: 'Worktree is being removed' }) });
    render(<App />);
    const pathInput = document.querySelector('.gate-input') as HTMLInputElement;
    fireEvent.change(pathInput, { target: { value: '/workspace/' } });
    await chooseBasicTerminal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Launch Workspace' })).toBeEnabled());
    fireEvent.click(screen.getByText('Launch Workspace'));
    await screen.findByRole('alert');
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(0);
    expect(window.electronAPI.spawnTerminal).not.toHaveBeenCalled();
  });

  it('opens an existing worktree as a workspace with its branch identity', async () => {
    installElectronApiMock({
      gitListWorktrees: vi.fn().mockResolvedValue({
        success: true,
        worktrees: [
          { path: '/repo', branch: 'main', isMain: true, isLocked: false, isPrunable: false },
          { path: '/workspace', branch: 'task/example', isMain: false, isLocked: false, isPrunable: false },
        ],
      }),
    });
    render(<App />);
    const pathInput = document.querySelector('.gate-input') as HTMLInputElement;
    fireEvent.change(pathInput, { target: { value: '/workspace/' } });
    await chooseBasicTerminal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Launch Workspace' })).toBeEnabled());
    fireEvent.click(screen.getByText('Launch Workspace'));
    await waitFor(() => {
      expect(useWorkspaceStore.getState().workspaces[0]).toEqual(expect.objectContaining({
        isLinkedWorktree: true,
        gitCurrentBranch: 'task/example',
        projectName: 'repo',
      }));
    });
  });
});
