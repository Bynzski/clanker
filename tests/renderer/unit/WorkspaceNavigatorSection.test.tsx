// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceNavigatorSection from '../../../src/renderer/components/WorkspaceNavigatorSection';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import * as closeModule from '../../../src/renderer/lib/workspaceClose';
import { installElectronApiMock } from '../../setup/electron';
import { createTerminalFixture, createWorkspaceFixture } from '../../setup/fixtures';

function seed() {
  const alpha = createWorkspaceFixture({
    id: 'alpha', name: 'alpha', workspacePath: '/p/alpha', lifecycle: 'active',
    terminals: [
      createTerminalFixture({ id: 't1', displayName: 'Samson', harnessId: 'codex', attentionEnabled: true }),
      createTerminalFixture({ id: 't2', displayName: 'Delilah', harnessId: 'claude', attentionEnabled: true }),
    ],
    panes: [], // terminals deliberately have no panes
    activeTerminalId: 't1',
  });
  const beta = createWorkspaceFixture({
    id: 'beta', name: 'beta', workspacePath: '/p/beta', lifecycle: 'parked',
    environmentId: 'vps', environmentLabel: 'my-vps',
    terminals: [createTerminalFixture({ id: 't3', displayName: 'Jerry', harnessId: null })],
    panes: [{ id: 'p3', terminalId: 't3' }],
  });
  const gamma = createWorkspaceFixture({
    id: 'gamma', name: 'gamma', workspacePath: '/p/gamma-worktrees/gamma-feat', lifecycle: 'parked',
    isLinkedWorktree: true, projectName: 'gamma', gitCurrentBranch: 'feat/x', terminals: [],
  });
  useWorkspaceStore.setState({ workspaces: [alpha, beta, gamma], activeWorkspaceId: 'alpha' });
}

describe('WorkspaceNavigatorSection', () => {
  beforeEach(() => {
    installElectronApiMock();
    useAgentAttentionStore.setState({ byTerminalId: {} });
    seed();
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('renders each workspace once with local, SSH and worktree presentation', () => {
    render(<WorkspaceNavigatorSection />);
    expect(screen.getAllByRole('button', { name: /^(Collapse|Expand) / })).toHaveLength(3);
    expect(screen.getByText('SSH · my-vps')).toBeTruthy();
    expect(screen.getByLabelText('Worktree on feat/x')).toBeTruthy();
    expect(screen.getByText('alpha').closest('button')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('beta').closest('button')).not.toHaveAttribute('aria-current');
  });

  it('derives agent rows from workspace.terminals even when no pane exists', () => {
    render(<WorkspaceNavigatorSection />);
    const list = screen.getByRole('list', { name: 'alpha agents' });
    expect(within(list).getAllByRole('button').map((b) => b.querySelector('.ws-agent-name')?.textContent))
      .toEqual(['Samson', 'Delilah']);
    expect(within(list).getByText('Codex')).toBeTruthy();
    expect(within(list).getByText('Claude')).toBeTruthy();
    expect(useWorkspaceStore.getState().workspaces[0].panes).toHaveLength(0);
  });

  it('expands and collapses without touching workspace residency or terminals', () => {
    const before = useWorkspaceStore.getState().workspaces.map((w) => [w.runtimeState, w.terminals]);
    render(<WorkspaceNavigatorSection />);
    const toggle = screen.getByRole('button', { name: 'Expand beta' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Collapse beta' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Jerry')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse alpha' }));
    expect(screen.queryByText('Samson')).toBeNull();
    expect(useWorkspaceStore.getState().workspaces.map((w) => [w.runtimeState, w.terminals])).toEqual(before);
  });

  it('activates a workspace and selects an agent via selectWorkspace', () => {
    const selectWorkspace = vi.fn();
    useWorkspaceStore.setState({ selectWorkspace });
    render(<WorkspaceNavigatorSection />);
    fireEvent.click(screen.getByText('beta'));
    expect(selectWorkspace).toHaveBeenCalledWith('beta');
    fireEvent.click(screen.getByText('Delilah'));
    expect(selectWorkspace).toHaveBeenCalledWith('alpha', 't2');
  });

  it('shows per-agent attention and an aggregate badge without reordering', () => {
    render(<WorkspaceNavigatorSection />);
    const names = () => screen.getAllByRole('img').map((el) => el.getAttribute('aria-label'));
    expect(names()).toEqual(['Samson: Unknown', 'Delilah: Unknown']);
    act(() => {
      useAgentAttentionStore.setState({
        byTerminalId: {
          t2: { lifecycle: 'needs_input', unseen: true, updatedAt: 2 },
          t1: { lifecycle: 'running', unseen: false, updatedAt: 1 },
        },
      });
    });
    expect(names()).toEqual(['Samson: Running', 'Delilah: Needs input']);
    expect(screen.getByLabelText('1 agents need input, 0 turns complete')).toBeTruthy();
    expect(useWorkspaceStore.getState().workspaces.map((w) => w.id)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('offers a jump action only when an agent needs attention', () => {
    const selectWorkspace = vi.fn();
    useWorkspaceStore.setState({ selectWorkspace });
    render(<WorkspaceNavigatorSection />);
    expect(screen.queryByLabelText('Jump to next agent needing attention')).toBeNull();
    act(() => {
      useAgentAttentionStore.setState({ byTerminalId: { t3: { lifecycle: 'needs_input', unseen: true, updatedAt: 1 } } });
    });
    fireEvent.click(screen.getByLabelText('Jump to next agent needing attention'));
    expect(selectWorkspace).toHaveBeenCalledWith('beta', 't3');
  });

  it('renames with the shared naming semantics', () => {
    render(<WorkspaceNavigatorSection />);
    fireEvent.click(screen.getAllByLabelText('Rename workspace')[1]);
    const input = screen.getByLabelText('Workspace name');
    expect(input).toHaveValue('beta');
    fireEvent.change(input, { target: { value: ' renamed ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useWorkspaceStore.getState().workspaces[1].name).toBe('renamed');
  });

  it('closes through closeWorkspaceWithCleanup', () => {
    const close = vi.spyOn(closeModule, 'closeWorkspaceWithCleanup').mockResolvedValue(undefined);
    render(<WorkspaceNavigatorSection />);
    fireEvent.click(screen.getAllByLabelText('Close workspace')[2]);
    expect(close).toHaveBeenCalledWith('gamma');
  });

  it('reorders by drag and by Alt+Shift+Arrow using moveWorkspace', () => {
    const moveWorkspace = vi.fn();
    useWorkspaceStore.setState({ moveWorkspace });
    render(<WorkspaceNavigatorSection />);
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.ws-nav-row'));
    const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(rows[2], { dataTransfer: transfer });
    fireEvent.dragOver(rows[0], { dataTransfer: transfer });
    expect(rows[0]).toHaveClass('drop-before');
    fireEvent.drop(rows[0], { dataTransfer: transfer });
    expect(moveWorkspace).toHaveBeenCalledWith('gamma', 'alpha');

    moveWorkspace.mockClear();
    const select = screen.getByText('beta').closest('button')!;
    fireEvent.keyDown(select, { key: 'ArrowDown', altKey: true, shiftKey: true });
    expect(moveWorkspace).toHaveBeenCalledWith('beta', 'gamma');
    fireEvent.keyDown(select, { key: 'ArrowUp', altKey: true, shiftKey: true });
    expect(moveWorkspace).toHaveBeenCalledWith('beta', 'alpha');
  });

  it('uses the existing Open Workspace callback', () => {
    const onOpen = vi.fn();
    render(<WorkspaceNavigatorSection onOpenWorkspace={onOpen} />);
    fireEvent.click(screen.getByLabelText('Open Workspace'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
