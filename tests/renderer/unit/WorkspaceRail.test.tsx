// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceRail, { getWorkspaceMonogram } from '../../../src/renderer/components/WorkspaceRail';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { useWorkspaceNavigationStore } from '../../../src/renderer/store/workspaceNavigationStore';
import { installElectronApiMock } from '../../setup/electron';
import { createTerminalFixture, createWorkspaceFixture } from '../../setup/fixtures';

const { selectWorkspace: realSelect } = useWorkspaceStore.getState();

function seed() {
  useWorkspaceStore.setState({ selectWorkspace: realSelect });
  const alpha = createWorkspaceFixture({
    id: 'alpha', name: 'alpha', workspacePath: '/p/alpha', lifecycle: 'active',
    terminals: [
      createTerminalFixture({ id: 't1', displayName: 'Samson', harnessId: 'codex', attentionEnabled: true }),
      createTerminalFixture({ id: 't2', displayName: 'Delilah', harnessId: 'claude', attentionEnabled: true }),
    ],
    panes: [],
    activeTerminalId: 't1',
  });
  const beta = createWorkspaceFixture({
    id: 'beta', name: 'demo-repo', workspacePath: '/p/demo-repo', lifecycle: 'parked',
    environmentId: 'vps', environmentLabel: 'my-vps',
    terminals: [createTerminalFixture({ id: 't3', displayName: 'Jerry', harnessId: null })],
    panes: [{ id: 'p3', terminalId: 't3' }],
    activeTerminalId: 't3',
  });
  useWorkspaceStore.setState({ workspaces: [alpha, beta], activeWorkspaceId: 'alpha', activeTerminalId: 't1' });
}

describe('WorkspaceRail', () => {
  beforeEach(() => {
    installElectronApiMock();
    useAgentAttentionStore.setState({ byTerminalId: {} });
    seed();
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('derives two-letter workspace marks', () => {
    expect(getWorkspaceMonogram('clanker')).toBe('CL');
    expect(getWorkspaceMonogram('demo-repo')).toBe('DR');
    expect(getWorkspaceMonogram('api_service v2')).toBe('AS');
    expect(getWorkspaceMonogram('')).toBe('?');
  });

  it('lists every workspace with its agents in order, marking the active workspace and agent', () => {
    render(<WorkspaceRail onExpand={() => undefined} />);
    const alpha = screen.getByRole('button', { name: 'alpha' });
    expect(alpha).toHaveAttribute('aria-current', 'true');
    expect(alpha.textContent).toBe('AL');
    expect(screen.getByRole('button', { name: /demo-repo/ })).not.toHaveAttribute('aria-current');

    const agents = within(screen.getByRole('group', { name: 'alpha agents' })).getAllByRole('button');
    expect(agents.map((button) => button.getAttribute('aria-label'))).toEqual(['Samson · Codex', 'Delilah · Claude']);
    expect(agents[0]).toHaveAttribute('aria-current', 'true');
    expect(agents[1]).not.toHaveAttribute('aria-current');
    // Agents of an inactive workspace are never marked current.
    expect(within(screen.getByRole('group', { name: 'demo-repo agents' })).getByRole('button'))
      .not.toHaveAttribute('aria-current');
  });

  it('selects a workspace or a specific agent without touching terminals', () => {
    const select = vi.spyOn(useWorkspaceStore.getState(), 'selectWorkspace');
    useWorkspaceStore.setState({ selectWorkspace: select });
    render(<WorkspaceRail onExpand={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /demo-repo/ }));
    expect(select).toHaveBeenLastCalledWith('beta');
    fireEvent.click(screen.getByRole('button', { name: 'Delilah · Claude' }));
    expect(select).toHaveBeenLastCalledWith('alpha', 't2');
    expect(useWorkspaceStore.getState().workspaces.map((workspace) => workspace.terminals.length)).toEqual([2, 1]);
  });

  it('shows agent lifecycle and a workspace badge for unseen attention', () => {
    useAgentAttentionStore.setState({
      byTerminalId: {
        t1: { lifecycle: 'running', unseen: false, updatedAt: 1 },
        t2: { lifecycle: 'needs_input', unseen: true, updatedAt: 2 },
      },
    });
    const { container } = render(<WorkspaceRail onExpand={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Delilah · Claude · Needs input' })).toBeTruthy();
    expect(container.querySelector('.ws-rail-agent-state.state-running')).toBeTruthy();
    expect(container.querySelector('.ws-rail-agent-state.state-needs_input.unseen')).toBeTruthy();
    expect(container.querySelector('[data-rail-workspace-id="alpha"] .ws-rail-mark-badge.needs-input')).toBeTruthy();
    expect(container.querySelector('[data-rail-workspace-id="beta"] .ws-rail-mark-badge')).toBeNull();
  });

  it('shows no dot for idle agents or for a finished turn that has been seen', () => {
    useAgentAttentionStore.setState({
      byTerminalId: {
        t1: { lifecycle: 'turn_complete', unseen: false, updatedAt: 1 },
        t2: { lifecycle: 'unknown', unseen: false, updatedAt: 2 },
      },
    });
    const { container } = render(<WorkspaceRail onExpand={() => undefined} />);
    expect(container.querySelector('.ws-rail-agent-state')).toBeNull();
    expect(screen.getByRole('button', { name: 'Samson · Codex' })).toBeTruthy();
    act(() => useAgentAttentionStore.setState({ byTerminalId: { t1: { lifecycle: 'turn_complete', unseen: true, updatedAt: 3 } } }));
    expect(container.querySelector('.ws-rail-agent-state.state-turn_complete.unseen')).toBeTruthy();
  });

  it('offers expand, open-workspace and next-attention actions', () => {
    useAgentAttentionStore.setState({ byTerminalId: { t3: { lifecycle: 'needs_input', unseen: true, updatedAt: 1 } } });
    const onExpand = vi.fn();
    const onOpenWorkspace = vi.fn();
    render(<WorkspaceRail onExpand={onExpand} onOpenWorkspace={onOpenWorkspace} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(onExpand).toHaveBeenCalledOnce();
    const open = screen.getByRole('button', { name: 'Open Workspace' });
    // It follows the open workspaces in the list rather than sitting in the bottom footer.
    expect(open.closest('.ws-rail-list')).not.toBeNull();
    expect(open.closest('li')?.previousElementSibling).toHaveAttribute('data-rail-workspace-id');
    fireEvent.click(open);
    expect(onOpenWorkspace).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Jump to next agent needing attention' }));
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('beta');
    expect(useAgentAttentionStore.getState().byTerminalId.t3.unseen).toBe(false);
  });

  it('opens the sidebar on FILES from the rail', () => {
    useWorkspaceNavigationStore.setState({ mode: 'sidebar', sidebarWidth: 44, lastExpandedWidth: 300 });
    try {
      render(<WorkspaceRail onExpand={() => undefined} />);
      fireEvent.click(screen.getByRole('button', { name: 'Show Files' }));
      expect(useWorkspaceNavigationStore.getState().sidebarWidth).toBe(300);
      expect(useWorkspaceStore.getState().workspaces[0].explorerVisible).toBe(true);
    } finally {
      useWorkspaceNavigationStore.setState({ mode: 'tabs', sidebarWidth: 280, lastExpandedWidth: 280 });
    }
  });
});
