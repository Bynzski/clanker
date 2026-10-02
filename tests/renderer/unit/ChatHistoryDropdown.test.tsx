// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ChatHistoryDropdown from '../../../src/renderer/components/ChatHistoryDropdown';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import type { HarnessSession } from '../../../src/shared/types/session';
import { createWorkspaceFixture } from '../../setup/fixtures';

describe('ChatHistoryDropdown', () => {
  const sampleSession: HarnessSession = {
    id: 'codex-sess-1',
    harness: 'codex',
    title: 'Auth conversation',
    cwd: '/projects/repo',
    timestamp: 1200,
  };

  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaces: [createWorkspaceFixture({ id: 'local-ws', workspacePath: '/projects/repo', terminals: [], panes: [], activeTerminalId: null })],
      activeWorkspaceId: 'local-ws',
      terminals: [],
      panes: [],
    });
  });

  it('resumes a remote history entry in its owning workspace using the returned working directory', async () => {
    installElectronApiMock();
    vi.mocked(window.electronAPI.invokeSession).mockResolvedValue({ id: 'remote-term', pid: 12, workingDir: '/projects/repo/canonical' });
    useWorkspaceStore.setState({ activeWorkspaceId: 'remote-ws', workspaces: [createWorkspaceFixture({ id: 'remote-ws', environmentId: 'ssh-a', workspacePath: '/projects/repo', terminals: [], panes: [], activeTerminalId: null })] });
    render(<ChatHistoryDropdown sessions={[sampleSession]} isLoading={false} workspacePath="/projects/repo" workspaceId="remote-ws" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Codex.*1/i }));
    const session = screen.getByRole('button', { name: /Auth conversation/i });
    fireEvent.click(session);
    await waitFor(() => expect(useWorkspaceStore.getState().getWorkspaceById('remote-ws')?.terminals).toEqual([expect.objectContaining({ id: 'remote-term', workingDir: '/projects/repo/canonical', environmentId: 'ssh-a' })]));
    expect(window.electronAPI.invokeSession).toHaveBeenCalledWith('remote-ws', sampleSession);
  });

  it('attaches a late remote resume to its original workspace after switching to another', async () => {
    installElectronApiMock();
    let finish!: (value: { id: string; pid: number }) => void;
    vi.mocked(window.electronAPI.invokeSession).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    useWorkspaceStore.setState({ activeWorkspaceId: 'a', workspaces: [createWorkspaceFixture({ id: 'a', environmentId: 'ssh-a', workspacePath: '/projects/repo', terminals: [], panes: [], activeTerminalId: null }), createWorkspaceFixture({ id: 'b', environmentId: 'ssh-b', lifecycle: 'parked', terminals: [], panes: [], activeTerminalId: null })] });
    const onClose = vi.fn();
    render(<ChatHistoryDropdown sessions={[sampleSession]} isLoading={false} workspacePath="/projects/repo" workspaceId="a" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Codex.*1/i }));
    fireEvent.click(screen.getByRole('button', { name: /Auth conversation/i }));
    expect(screen.getByRole('button', { name: /Auth conversation/i })).toBeDisabled();
    act(() => { useWorkspaceStore.getState().selectWorkspace('b'); });
    await act(async () => finish({ id: 'late-term', pid: 4 }));
    expect(useWorkspaceStore.getState().getWorkspaceById('a')?.terminals).toEqual([expect.objectContaining({ id: 'late-term' })]);
    expect(useWorkspaceStore.getState().getWorkspaceById('b')?.terminals).toEqual([]);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('b');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('kills a late resumed terminal when its workspace was closed and shows launch failures', async () => {
    installElectronApiMock();
    let finish!: (value: { id: string; pid: number }) => void;
    vi.mocked(window.electronAPI.invokeSession).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    useWorkspaceStore.setState({ workspaces: [createWorkspaceFixture({ id: 'a', environmentId: 'ssh-a', workspacePath: '/projects/repo' })] });
    render(<ChatHistoryDropdown sessions={[sampleSession]} isLoading={false} workspacePath="/projects/repo" workspaceId="a" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Codex.*1/i }));
    fireEvent.click(screen.getByRole('button', { name: /Auth conversation/i }));
    act(() => { useWorkspaceStore.setState({ workspaces: [] }); });
    await act(async () => finish({ id: 'late-term', pid: 4 }));
    expect(window.electronAPI.killTerminal).toHaveBeenCalledWith('late-term');
    expect(useWorkspaceStore.getState().terminals).toEqual([]);
    expect(screen.getByRole('alert')).toHaveTextContent('workspace closed');
  });

  describe('local conversation resumption', () => {
    async function startResume(onClose: () => void) {
      render(<ChatHistoryDropdown sessions={[sampleSession]} isLoading={false} workspacePath="/projects/repo" workspaceId="local-ws" onClose={onClose} />);
      fireEvent.click(screen.getByRole('button', { name: /Codex.*1/i }));
      fireEvent.click(screen.getByRole('button', { name: /Auth conversation/i }));
    }

    it('attaches to the original workspace after switching without closing the dropdown', async () => {
      let finish!: (value: { id: string; pid: number }) => void;
      installElectronApiMock({
        invokeSession: vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; })),
      });
      useWorkspaceStore.setState((state) => ({ workspaces: [...state.workspaces, createWorkspaceFixture({ id: 'other', lifecycle: 'parked', terminals: [], panes: [], activeTerminalId: null })] }));
      const onClose = vi.fn();
      await startResume(onClose);
      act(() => { useWorkspaceStore.getState().selectWorkspace('other'); });
      await act(async () => finish({ id: 'local-resumed', pid: 4 }));
      expect(useWorkspaceStore.getState().getWorkspaceById('local-ws')?.terminals).toEqual([expect.objectContaining({ id: 'local-resumed', workspaceId: 'local-ws', environmentId: 'local' })]);
      expect(useWorkspaceStore.getState().getWorkspaceById('other')?.terminals).toEqual([]);
      expect(useWorkspaceStore.getState().terminals).toEqual([]);
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('other');
      expect(onClose).not.toHaveBeenCalled();
      expect(window.electronAPI.killTerminal).not.toHaveBeenCalled();
    });

    it('kills the returned terminal if the owning workspace closes', async () => {
      let finish!: (value: { id: string; pid: number }) => void;
      installElectronApiMock({
        invokeSession: vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; })),
      });
      const onClose = vi.fn();
      await startResume(onClose);
      act(() => { useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null }); });
      await act(async () => finish({ id: 'local-resumed', pid: 4 }));
      expect(window.electronAPI.killTerminal).toHaveBeenCalledWith('local-resumed');
      expect(useWorkspaceStore.getState().terminals).toEqual([]);
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText(/The workspace closed while resuming/)).toBeInTheDocument();
    });
  });

  it('never requests or renders Workspace Tasks', () => {
    installElectronApiMock();
    const taskChannels = vi.fn();
    (window.electronAPI as unknown as Record<string, unknown>).taskSessionList = taskChannels;
    render(
      <ChatHistoryDropdown
        sessions={[sampleSession]}
        isLoading={false}
        workspacePath="/projects/repo"
        workspaceId="local-ws"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Codex.*1/i })).toBeInTheDocument();
    expect(screen.queryByText('Workspace Tasks')).toBeNull();
    expect(taskChannels).not.toHaveBeenCalled();
  });

  it('surfaces discovery failures instead of implying that the remote history is empty', () => {
    installElectronApiMock();
    render(<ChatHistoryDropdown sessions={[]} isLoading={false} discoveryError="SSH authentication failed" workspacePath="/projects/repo" workspaceId="remote-ws" onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('SSH authentication failed');
    expect(screen.queryByText('No sessions for this workspace')).toBeNull();
  });

  it('resumes discovered sessions using the selected workspace ID', async () => {
    const invokeSession = vi.fn().mockResolvedValue({ id: 'term-1', pid: 5 });
    installElectronApiMock({ invokeSession });
    render(
      <ChatHistoryDropdown
        sessions={[sampleSession]}
        isLoading={false}
        workspacePath="/projects/repo"
        workspaceId="local-ws"
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Codex.*1/i }));
    fireEvent.click(screen.getByRole('button', { name: /Auth conversation/i }));
    await waitFor(() => expect(invokeSession).toHaveBeenCalledWith('local-ws', sampleSession));
  });
});
