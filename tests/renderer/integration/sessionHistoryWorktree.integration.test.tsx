// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChatHistoryDropdown from '../../../src/renderer/components/ChatHistoryDropdown';
import StatusBar from '../../../src/renderer/components/StatusBar';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { getAgentWorktreeContext } from '../../../src/renderer/lib/worktreeAgents';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import type { HarnessSession, SessionInvokeResult } from '../../../src/shared/types/session';

const ROOT = '/projects/app';
const WORKTREE = '/projects/app-worktrees/feature-foo-abc';
const MAIN: CheckoutContext = { id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: ROOT, kind: 'main' };
const WORKTREE_CONTEXT: CheckoutContext = { id: 'ws::wt', workspaceId: 'ws', environmentId: 'local', path: WORKTREE, kind: 'worktree', branch: 'feature/foo', mainCheckoutPath: ROOT };

const liveSession: HarnessSession = {
  id: 'live-1', harness: 'claude', title: 'Live isolated agent', cwd: `${WORKTREE}/src`, timestamp: 5,
  checkout: { branch: 'feature/foo', path: WORKTREE, exists: true },
};
const removedSession: HarnessSession = {
  id: 'removed-1', harness: 'claude', title: 'Removed isolated agent', cwd: `${WORKTREE}/src`, timestamp: 4,
  checkout: { branch: 'feature/foo', path: WORKTREE, exists: false },
};
const ordinarySession: HarnessSession = { id: 'plain-1', harness: 'claude', title: 'Ordinary conversation', cwd: `${ROOT}/src`, timestamp: 3 };

const state = () => useWorkspaceStore.getState().getWorkspaceById('ws')!;

function renderHistory(sessions: HarnessSession[], onClose = vi.fn()) {
  render(<><ChatHistoryDropdown sessions={sessions} isLoading={false} workspacePath={ROOT} workspaceId="ws" onClose={onClose} /><StatusBar /></>);
  fireEvent.click(screen.getByRole('button', { name: /Claude.*\d/i }));
  return onClose;
}

beforeEach(() => {
  useWorkspaceStore.setState({
    workspaces: [createWorkspaceFixture({
      id: 'ws', workspacePath: ROOT, terminals: [], panes: [], activeTerminalId: null, gitIsRepo: true, gitCurrentBranch: 'main', checkoutContexts: [MAIN],
    })],
    activeWorkspaceId: 'ws', terminals: [], panes: [], activeTerminalId: null,
  });
});

describe('resuming isolated-agent conversations from chat history', () => {
  it('labels worktree conversations by branch and leaves ordinary ones unlabelled', () => {
    installElectronApiMock();
    renderHistory([liveSession, removedSession, ordinarySession]);
    expect(screen.getByRole('button', { name: /Live isolated agent/ })).toHaveTextContent('feature/foo');
    expect(screen.getByRole('button', { name: /Removed isolated agent/ })).toHaveTextContent('feature/foo · removed');
    expect(screen.getByRole('button', { name: /Ordinary conversation/ })).not.toHaveTextContent('feature/foo');
  });

  it('records the checkout main returned, binds the terminal to it and shows the branch on the agent', async () => {
    installElectronApiMock();
    const result: SessionInvokeResult = { id: 'term-wt', pid: 7, workingDir: `${WORKTREE}/src`, checkoutContextId: WORKTREE_CONTEXT.id, checkoutContext: WORKTREE_CONTEXT };
    vi.mocked(window.electronAPI.invokeSession).mockResolvedValue(result);
    const onClose = renderHistory([liveSession]);
    fireEvent.click(screen.getByRole('button', { name: /Live isolated agent/ }));

    await waitFor(() => expect(state().terminals).toHaveLength(1));
    expect(window.electronAPI.invokeSession).toHaveBeenCalledWith('ws', liveSession);
    // The checkout main attached is recorded on the owning workspace (descriptive, never a root the renderer chose).
    expect(state().checkoutContexts).toEqual([MAIN, WORKTREE_CONTEXT]);
    const terminal = state().terminals[0];
    expect(terminal).toMatchObject({ id: 'term-wt', checkoutContextId: 'ws::wt', workingDir: `${WORKTREE}/src`, workspaceId: 'ws' });
    // The agent resolves to that checkout and the UI shows its branch.
    expect(getAgentWorktreeContext(state(), terminal)).toMatchObject({ id: 'ws::wt', branch: 'feature/foo' });
    expect(state().activeTerminalId).toBe('term-wt');
    await waitFor(() => expect(document.querySelector('.status-branch')).toHaveTextContent('feature/foo'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the removed-checkout notice, keeps it visible, and never binds the terminal to the removed checkout', async () => {
    installElectronApiMock();
    const notice = 'The worktree this conversation ran in (feature/foo) was removed, so it resumed in the main checkout.';
    vi.mocked(window.electronAPI.invokeSession).mockResolvedValue({ id: 'term-main', pid: 8, workingDir: ROOT, checkoutContextId: MAIN.id, resumeNotice: notice });
    const onClose = renderHistory([removedSession]);
    fireEvent.click(screen.getByRole('button', { name: /Removed isolated agent/ }));

    expect(await screen.findByRole('status')).toHaveTextContent(notice);
    expect(onClose).not.toHaveBeenCalled();
    expect(state().terminals[0]).toMatchObject({ id: 'term-main', checkoutContextId: 'ws::main', workingDir: ROOT });
    expect(state().checkoutContexts).toEqual([MAIN]);
    expect(getAgentWorktreeContext(state(), state().terminals[0])).toBeNull();
    // The agent is on the main checkout, so the status bar shows the workspace's own branch.
    expect(document.querySelector('.status-branch')).toHaveTextContent('main');
  });

  it('asks before recreating a removed worktree and only confirms through an explicit second invocation', async () => {
    installElectronApiMock();
    const invoke = vi.mocked(window.electronAPI.invokeSession);
    invoke.mockResolvedValueOnce({ recreateOffer: { branch: 'feature/foo', path: WORKTREE } });
    renderHistory([removedSession]);
    fireEvent.click(screen.getByRole('button', { name: /Removed isolated agent/ }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('feature/foo');
    expect(state().terminals).toEqual([]);
    expect(invoke).toHaveBeenCalledTimes(1);

    // Cancel: nothing was created or launched.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);

    invoke.mockResolvedValueOnce({ recreateOffer: { branch: 'feature/foo', path: WORKTREE } });
    fireEvent.click(screen.getByRole('button', { name: /Removed isolated agent/ }));
    invoke.mockResolvedValueOnce({
      id: 'term-re', pid: 9, workingDir: `${WORKTREE}/src`, checkoutContextId: WORKTREE_CONTEXT.id, checkoutContext: WORKTREE_CONTEXT,
      resumeNotice: 'Recreated the worktree for feature/foo and resumed there.',
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Recreate and resume' }));
    await waitFor(() => expect(state().terminals).toHaveLength(1));
    expect(invoke).toHaveBeenLastCalledWith('ws', removedSession, false, { recreateCheckout: true });
    expect(state().terminals[0].checkoutContextId).toBe('ws::wt');
    expect(state().checkoutContexts).toContainEqual(WORKTREE_CONTEXT);
    expect(await screen.findByRole('status')).toHaveTextContent('Recreated the worktree for feature/foo');
  });

  it('surfaces a precise refusal when a harness cannot resume without its directory', async () => {
    installElectronApiMock();
    vi.mocked(window.electronAPI.invokeSession).mockRejectedValue(new Error('This conversation ran in the worktree feature/gone, but that worktree was removed and its branch "feature/gone" no longer exists, so it cannot be recreated. Pi can only resume in the directory it started in, so it was not resumed in another checkout.'));
    renderHistory([removedSession]);
    fireEvent.click(screen.getByRole('button', { name: /Removed isolated agent/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pi can only resume in the directory it started in');
    expect(state().terminals).toEqual([]);
  });
});
