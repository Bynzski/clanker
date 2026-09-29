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

  it('releases the launcher overlay from the workspace that opened it', async () => {
    render(<App />);

    const initialPathInput = document.querySelector('.gate-input') as HTMLInputElement;
    fireEvent.change(initialPathInput, { target: { value: '/workspace/' } });
    fireEvent.click(screen.getByText('Launch Workspace'));

    await waitFor(() => {
      expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    });
    const firstWorkspaceId = useWorkspaceStore.getState().activeWorkspaceId!;

    fireEvent.click(screen.getByRole('button', { name: 'Open Workspace' }));
    expect(useWorkspaceStore.getState().getWorkspaceById(firstWorkspaceId)?.browserOverlayCount).toBe(1);

    const nextPathInput = document.querySelector('.gate-input') as HTMLInputElement;
    fireEvent.change(nextPathInput, { target: { value: '/second-workspace/' } });
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
    fireEvent.click(screen.getByRole('button', { name: 'SSH Remote' }));
    await waitFor(() => expect(document.querySelector('.ssh-env-select')).toBeTruthy());
    fireEvent.change(document.querySelector('input[placeholder^="/home/jay/Projects"]')!, {
      target: { value: '/home/jay/project' },
    });
    fireEvent.click(screen.getByText('Launch Workspace'));
    await waitFor(() => expect(useWorkspaceStore.getState().workspaces).toHaveLength(1));
    const workspace = useWorkspaceStore.getState().workspaces[0];
    expect(registerOpenWorkspace).toHaveBeenCalledWith(workspace.id, '/home/jay/project', 'dev-vps');
    expect(workspace.workspacePath).toBe('/srv/projects/project');
    expect(workspace.terminals[0].workingDir).toBe('/srv/projects/project');
    expect(spawnTerminal).toHaveBeenCalledWith('/srv/projects/project', expect.anything(), undefined,
      undefined, undefined, workspace.id, 'dev-vps');
  });

  it('keeps the launcher open when main rejects workspace registration', async () => {
    installElectronApiMock({ registerOpenWorkspace: vi.fn().mockResolvedValue({ success: false, error: 'Worktree is being removed' }) });
    render(<App />);
    const pathInput = document.querySelector('.gate-input') as HTMLInputElement;
    fireEvent.change(pathInput, { target: { value: '/workspace/' } });
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
