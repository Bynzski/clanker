import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ObservedWorktreeNotice from '../../../src/renderer/components/ObservedWorktreeNotice';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { useAssistantNavStore } from '../../../src/renderer/store/assistantNavStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture, createTerminalFixture } from '../../setup/fixtures';
import { snapshot, storeState } from '../../_helpers/attentionSnapshots';
import type { ObservedWorktreeResult } from '../../../src/shared/types/observedWorktree';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';

const main: CheckoutContext = { id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: '/repo', kind: 'main' };
const attached: CheckoutContext = { ...main, id: 'ws::new', path: '/repo-agent', branch: 'feature', kind: 'worktree' };
const candidate: ObservedWorktreeResult = { success: true, candidate: { path: attached.path, branch: 'feature', locked: false } };
const report = (revision = 3, path = attached.path, contextId: string | null = null) => snapshot('agent', 'running', revision,
  { location: { path, checkoutContextId: contextId }, locationProvenance: { state: 'current', sessionId: 'S' } });
const getWorkspace = () => useWorkspaceStore.getState().getWorkspaceById('ws')!;
const advance = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(400); }); };
const deferred = () => { let resolve!: (value: ObservedWorktreeResult) => void; const promise = new Promise<ObservedWorktreeResult>(r => { resolve = r; }); return { promise, resolve }; };

beforeEach(() => {
  vi.useFakeTimers(); installElectronApiMock();
  useAssistantNavStore.setState({ activeAssistantId: null });
  const workspace = createWorkspaceFixture({ id: 'ws', workspacePath: main.path, checkoutContexts: [main],
    activeTerminalId: 'agent', terminals: [createTerminalFixture({ id: 'agent', checkoutContextId: main.id }), createTerminalFixture({ id: 'other', checkoutContextId: main.id })] });
  useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: 'ws' });
  useAgentAttentionStore.setState(storeState([report()]));
  vi.mocked(window.electronAPI.inspectObservedWorktree).mockResolvedValue(candidate);
  vi.mocked(window.electronAPI.attachObservedWorktree).mockResolvedValue({ success: true, checkoutContext: attached });
});
afterEach(() => { vi.useRealTimers(); });

describe('confirmed observed-worktree recovery', () => {
  it('discovers without granting a root and only attaches/browses after confirmation', async () => {
    const original = useAgentAttentionStore.getState().byTerminalId.agent;
    render(<ObservedWorktreeNotice workspaceId="ws" />); await advance();
    expect(window.electronAPI.inspectObservedWorktree).toHaveBeenCalledWith('agent', 3);
    expect(getWorkspace().checkoutContexts).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Attach and browse…' }));
    expect(window.electronAPI.attachObservedWorktree).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('does not move or restart the agent');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Attach and browse$/ })); });
    expect(getWorkspace().checkoutContexts).toHaveLength(2);
    expect(getWorkspace().fileSurfaceContextId).toBe(attached.id);
    expect(getWorkspace().terminals[0].checkoutContextId).toBe(main.id);
    expect(useAgentAttentionStore.getState().byTerminalId.agent).toEqual(original);
    expect(screen.getByText(/Browsing attached checkout/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Follow agent' }));
    expect(getWorkspace().fileSurfaceContextId).toBeUndefined();
  });
  it('does not probe on ordinary lifecycle revisions or when the report is exactly a registered root', async () => {
    render(<ObservedWorktreeNotice workspaceId="ws" />); await advance();
    act(() => useAgentAttentionStore.setState(storeState([report(4)]))); await advance();
    expect(window.electronAPI.inspectObservedWorktree).toHaveBeenCalledTimes(1);
    act(() => useAgentAttentionStore.setState(storeState([report(5, main.path, main.id)]))); await advance();
    expect(window.electronAPI.inspectObservedWorktree).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Attach and browse…' })).not.toBeInTheDocument();
  });
  it('probes a nested worktree report even when it still names the main context', async () => {
    useAgentAttentionStore.setState(storeState([report(3, '/repo/.claude/worktrees/native', main.id)]));
    render(<ObservedWorktreeNotice workspaceId="ws" />); await advance();
    expect(window.electronAPI.inspectObservedWorktree).toHaveBeenCalledTimes(1);
  });
  it('does not dispatch a queued lookup after an Assistant takes the destination', async () => {
    render(<ObservedWorktreeNotice workspaceId="ws" />);
    act(() => useAssistantNavStore.setState({ activeAssistantId: 'assistant' }));
    await advance();
    expect(window.electronAPI.inspectObservedWorktree).not.toHaveBeenCalled();
  });
  it('never steals an existing file/editor pin', async () => {
    useWorkspaceStore.getState().pinFileCheckout('ws', main.id);
    render(<ObservedWorktreeNotice workspaceId="ws" />); await advance();
    expect(window.electronAPI.inspectObservedWorktree).not.toHaveBeenCalled();
    expect(getWorkspace().fileSurfaceContextId).toBe(main.id);
  });
  it('offers no attachment for a locked worktree and never unlocks it', async () => {
    vi.mocked(window.electronAPI.inspectObservedWorktree).mockResolvedValue({ success: true, candidate: { ...candidate.candidate!, locked: true, lockReason: 'live Claude session' } });
    render(<ObservedWorktreeNotice workspaceId="ws" />); await advance();
    expect(screen.getByText(/will not unlock it automatically/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Attach and browse…' })).not.toBeInTheDocument();
  });
  it('rejects a late discovery across batched A→B→A terminal focus', async () => {
    const pending = deferred(); vi.mocked(window.electronAPI.inspectObservedWorktree).mockReturnValueOnce(pending.promise).mockResolvedValue({ success: true });
    render(<ObservedWorktreeNotice workspaceId="ws" />); await advance();
    act(() => {
      useWorkspaceStore.setState(state => ({ workspaces: state.workspaces.map(ws => ({ ...ws, activeTerminalId: 'other' })) }));
      useWorkspaceStore.setState(state => ({ workspaces: state.workspaces.map(ws => ({ ...ws, activeTerminalId: 'agent' })) }));
    });
    await act(async () => { pending.resolve(candidate); }); await advance();
    expect(screen.queryByRole('button', { name: 'Attach and browse…' })).not.toBeInTheDocument();
    expect(getWorkspace().checkoutContexts).toHaveLength(1);
  });
  it.each(['focus', 'assistant', 'workspace', 'editor'])('never applies a late attachment after %s changes', async kind => {
    const pending = deferred(); vi.mocked(window.electronAPI.attachObservedWorktree).mockReturnValue(pending.promise);
    render(<ObservedWorktreeNotice workspaceId="ws" />); await advance();
    fireEvent.click(screen.getByRole('button', { name: 'Attach and browse…' }));
    fireEvent.click(screen.getByRole('button', { name: /^Attach and browse$/ }));
    act(() => {
      if (kind === 'focus') useWorkspaceStore.setState(state => ({ workspaces: state.workspaces.map(ws => ({ ...ws, activeTerminalId: 'other' })) }));
      if (kind === 'assistant') useAssistantNavStore.setState({ activeAssistantId: 'assistant' });
      if (kind === 'workspace') useWorkspaceStore.setState({ activeWorkspaceId: 'other' });
      if (kind === 'editor') useWorkspaceStore.getState().pinFileCheckout('ws', main.id);
    });
    await act(async () => { pending.resolve({ success: true, checkoutContext: attached }); });
    expect(getWorkspace().fileSurfaceContextId).toBe(kind === 'editor' ? main.id : undefined);
    expect(getWorkspace().checkoutContexts).toHaveLength(1);
  });
  it('shows errors with an explicit retry, never falling back to main or launching anything', async () => {
    vi.mocked(window.electronAPI.inspectObservedWorktree).mockResolvedValueOnce({ success: false, error: 'SSH unavailable' }).mockResolvedValue(candidate);
    render(<ObservedWorktreeNotice workspaceId="ws" />); await advance();
    expect(screen.getByText('SSH unavailable')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry discovery' })); await advance();
    expect(screen.getByRole('button', { name: 'Attach and browse…' })).toBeVisible();
    expect(getWorkspace().fileSurfaceContextId).toBeUndefined();
    expect(window.electronAPI.spawnTerminal).not.toHaveBeenCalled();
  });
});
