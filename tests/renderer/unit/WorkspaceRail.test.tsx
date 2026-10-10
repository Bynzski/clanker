// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceRail, { getWorkspaceMonogram } from '../../../src/renderer/components/WorkspaceRail';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { EMPTY_ATTENTION, snapshot, storeState } from '../../_helpers/attentionSnapshots';
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
    useAgentAttentionStore.setState(EMPTY_ATTENTION);
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

  it('uses hydrated broker capability over a legacy terminal preference and explains unavailable sources', () => {
    const live = snapshot('t1', 'running', 8);
    live.signal = { requested: true, attachment: 'prepared', health: 'observed' };
    const unavailable = snapshot('t2', 'idle', 9);
    unavailable.signal = { requested: true, attachment: 'unavailable', health: 'unverified', reason: 'configuration-conflict' };
    useWorkspaceStore.setState((state) => ({ workspaces: state.workspaces.map((workspace) => ({ ...workspace,
      terminals: workspace.terminals.map((terminal) => ({ ...terminal, attentionEnabled: false })),
    })) }));
    useAgentAttentionStore.getState().hydrate([live, unavailable], () => false);
    render(<WorkspaceRail onExpand={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Samson · Codex · Running' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delilah · Claude · Native attention unavailable' }).getAttribute('title')).toContain('configuration-conflict');
    act(() => useAgentAttentionStore.getState().applyChange({ terminalId: 't1', revision: 10, snapshot: { ...live, revision: 10, signal: { requested: false, attachment: 'disabled', health: 'unverified' } } }, false));
    expect(screen.queryByRole('button', { name: 'Samson · Codex · Running' })).not.toBeInTheDocument();
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

  describe('reordering', () => {
    const transfer = () => ({ setData: vi.fn(), effectAllowed: '', dropEffect: '' });

    it('drags a workspace entry onto another via moveWorkspace, with a drop indicator', () => {
      const moveWorkspace = vi.fn();
      useWorkspaceStore.setState({ moveWorkspace });
      const { container } = render(<WorkspaceRail onExpand={() => undefined} onOpenWorkspace={() => undefined} />);
      const alpha = container.querySelector<HTMLElement>('[data-rail-workspace-id="alpha"]')!;
      const beta = container.querySelector<HTMLElement>('[data-rail-workspace-id="beta"]')!;
      expect(alpha).toHaveAttribute('draggable', 'true');
      expect(container.querySelector('.ws-rail-add')).not.toBeNull();
      expect(container.querySelector('.ws-rail-add')).not.toHaveAttribute('draggable', 'true');

      const dataTransfer = transfer();
      fireEvent.dragStart(beta, { dataTransfer });
      fireEvent.dragOver(alpha, { dataTransfer });
      expect(alpha).toHaveClass('drop-before');
      fireEvent.drop(alpha, { dataTransfer });
      expect(moveWorkspace).toHaveBeenCalledWith('beta', 'alpha');
      expect(alpha).not.toHaveClass('drop-before');
    });

    it('does not select a workspace or agent when a drag ends over its button', () => {
      const select = vi.fn();
      useWorkspaceStore.setState({ selectWorkspace: select, moveWorkspace: vi.fn() });
      const { container } = render(<WorkspaceRail onExpand={() => undefined} />);
      const beta = container.querySelector<HTMLElement>('[data-rail-workspace-id="beta"]')!;
      const dataTransfer = transfer();
      fireEvent.dragStart(beta, { dataTransfer });
      fireEvent.click(screen.getByRole('button', { name: /demo-repo/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Delilah · Claude' }));
      expect(select).not.toHaveBeenCalled();
    });

    it('reorders with Alt+Shift+Arrow on a workspace mark', () => {
      const moveWorkspace = vi.fn();
      useWorkspaceStore.setState({ moveWorkspace });
      render(<WorkspaceRail onExpand={() => undefined} />);
      const alphaMark = screen.getByRole('button', { name: 'alpha' });
      expect(alphaMark).toHaveAttribute('aria-keyshortcuts', 'Alt+Shift+ArrowUp Alt+Shift+ArrowDown');
      fireEvent.keyDown(alphaMark, { key: 'ArrowDown', altKey: true, shiftKey: true });
      expect(moveWorkspace).toHaveBeenCalledWith('alpha', 'beta');
      moveWorkspace.mockClear();
      fireEvent.keyDown(alphaMark, { key: 'ArrowUp', altKey: true, shiftKey: true });
      expect(moveWorkspace).not.toHaveBeenCalled();
    });
  });

  it('shows agent lifecycle and a workspace badge for unseen attention', () => {
    useAgentAttentionStore.setState(storeState([snapshot('t1', 'running', 1), snapshot('t2', 'needs_input', 2)]));
    const { container } = render(<WorkspaceRail onExpand={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Delilah · Claude · Needs input' })).toBeTruthy();
    expect(container.querySelector('.ws-rail-agent-state.state-running')).toBeTruthy();
    expect(container.querySelector('.ws-rail-agent-state.state-needs_input.unseen')).toBeTruthy();
    expect(container.querySelector('[data-rail-workspace-id="alpha"] .ws-rail-mark-badge.needs-input')).toBeTruthy();
    expect(container.querySelector('[data-rail-workspace-id="beta"] .ws-rail-mark-badge')).toBeNull();
  });

  it('shows no dot for idle agents or for a finished turn that has been seen', () => {
    useAgentAttentionStore.setState(storeState(
      [snapshot('t1', 'completed', 1), snapshot('t2', 'unverified', 2)], { t1: { completion: 1, request: 0 } },
    ));
    const { container } = render(<WorkspaceRail onExpand={() => undefined} />);
    expect(container.querySelector('.ws-rail-agent-state')).toBeNull();
    expect(screen.getByRole('button', { name: 'Samson · Codex' })).toBeTruthy();
    act(() => useAgentAttentionStore.setState(storeState([snapshot('t1', 'completed', 3)])));
    expect(container.querySelector('.ws-rail-agent-state.state-turn_complete.unseen')).toBeTruthy();
  });

  it('offers expand, open-workspace and next-attention actions', () => {
    useAgentAttentionStore.setState(storeState([snapshot('t3', 'needs_input', 1)]));
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
    expect(useAgentAttentionStore.getState().seenByTerminalId.t3).toEqual({ completion: 0, request: 1 });
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

  it('renders minimized indicator on rail agent and restores on click', () => {
    const ws = useWorkspaceStore.getState().workspaces[0];
    const pane = { id: 'p1', terminalId: 't1' };
    useWorkspaceStore.setState({
      workspaces: [
        {
          ...ws,
          panes: [pane],
          minimizedPanes: [{ paneId: 'p1', pageId: 'alpha::page-1', placement: null }],
        },
        ...useWorkspaceStore.getState().workspaces.slice(1),
      ],
    });
    render(<WorkspaceRail onExpand={() => undefined} />);
    const button = screen.getByRole('button', { name: /Samson.*minimized/ });
    expect(button).toHaveClass('minimized');
    expect(button.querySelector('.ws-rail-agent-minimized')).not.toBeNull();
    expect(button.getAttribute('aria-label')).toContain('· minimized (click to restore)');
    fireEvent.click(button);
    expect(useWorkspaceStore.getState().workspaces[0].minimizedPanes).toEqual([]);
  });
});
