import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GitButton from '../../../src/renderer/components/GitButton';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture, createTerminalFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';
import type { GitStatusResult } from '../../../src/shared/types/git';

const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
const scroll = vi.fn();
let api: ReturnType<typeof installElectronApiMock>;
let status: GitStatusResult;
const main = { id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: '/repo', kind: 'main' as const };
const isolated = { id: 'ws::a', workspaceId: 'ws', environmentId: 'local', path: '/repo-worktrees/a', kind: 'worktree' as const, branch: 'old-a' };
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll }); scroll.mockClear();
  status = { success: true, isRepo: true, workspaceId: 'ws', checkoutContextId: isolated.id, workspacePath: isolated.path,
    environmentId: 'local', currentBranch: 'old-a', isDetached: false, changes: [], upstream: 'origin/old-a', ahead: 0, behind: 0 };
  api = installElectronApiMock({
    onGitStatusUpdate: vi.fn(callback => { callback(status); return vi.fn(); }),
    gitRefresh: vi.fn(async () => status),
    gitGetBranchState: vi.fn(async () => ({ success: true, isRepo: true, currentBranch: status.currentBranch,
      branches: [{ name: 'new-a', isCurrent: status.currentBranch === 'new-a', isRemote: false }] })),
    gitGetHistory: vi.fn().mockResolvedValue([]), gitGetStashes: vi.fn().mockResolvedValue([]),
    gitGetOperationState: vi.fn().mockResolvedValue({ success: true, inProgress: false, mode: 'none', conflicts: [] }),
    gitGetRemotes: vi.fn().mockResolvedValue({ success: true, remotes: [{ name: 'origin', fetchUrl: 'https://example.invalid/repo', pushUrl: 'https://example.invalid/repo' }], provider: 'unknown' }),
    reconcileCheckoutContexts: vi.fn(async () => ({ success: true, contexts: [main, { ...isolated, branch: status.currentBranch ?? undefined }], dropped: [] })),
  });
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws', workspaces: [createWorkspaceFixture({ id: 'ws', workspacePath: main.path,
    environmentId: 'local', checkoutContexts: [main, isolated], activeTerminalId: 'agent',
    terminals: [createTerminalFixture({ id: 'agent', checkoutContextId: isolated.id })], browserVisible: true, browserOverlayCount: 0 })] });
});
afterEach(() => { if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll); else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView'); });
async function open() {
  const user = userEvent.setup();
  render(<GitButton workspacePath={main.path} workspaceId="ws" />);
  await user.click(screen.getByRole('button', { name: 'Source Control' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh changes' })).toBeEnabled());
  return user;
}

describe('management polish without new execution paths', () => {
  it('jumps past 34 long filenames to the sole inline composer using keyboard navigation', async () => {
    status.changes = Array.from({ length: 34 }, (_, i) => ({ path: `src/${'long-directory/'.repeat(8)}file-${i}.ts`, status: 'modified', staged: false }));
    const user = await open();
    const jump = screen.getByRole('button', { name: 'Go to Commit' });
    const composer = screen.getByRole('textbox', { name: 'Commit Message' });
    expect(jump.compareDocumentPosition(screen.getAllByRole('button', { name: /^Review working/ })[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    jump.focus(); await user.keyboard('{Enter}');
    expect(composer).toHaveFocus();
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
    expect(scroll.mock.instances[scroll.mock.instances.length - 1]).toBe(composer);
    expect(screen.getAllByRole('form', { name: 'Commit changes' })).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: 'Create Commit' })).toBeNull();
    expect(api.gitStartPolling).toHaveBeenCalledTimes(1);
    expect(api.gitStage).not.toHaveBeenCalled(); expect(api.gitCommit).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Source Control' })).toHaveFocus();
    expect(useWorkspaceStore.getState().getWorkspaceById('ws')?.browserOverlayCount).toBe(0);
  });

  it.each(['create', 'switch'])('refreshes branch display and reconciles descriptive metadata after %s in an isolated checkout', async action => {
    const mutate = async () => { status = { ...status, currentBranch: 'new-a' }; return { success: true }; };
    api.gitCreateBranch.mockImplementation(mutate); api.gitSwitchBranch.mockImplementation(mutate);
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Branches' }));
    if (action === 'create') {
      await user.type(await screen.findByLabelText('Create Branch'), 'new-a');
      await user.click(screen.getByRole('button', { name: 'Create' }));
      expect(api.gitCreateBranch).toHaveBeenCalledWith(isolated.path, 'new-a', 'old-a', 'ws', isolated.id);
    } else {
      await user.click(await screen.findByRole('button', { name: 'Switch to branch new-a' }));
      expect(api.gitSwitchBranch).toHaveBeenCalledWith(isolated.path, 'new-a', 'ws', isolated.id);
    }
    expect(await screen.findByText('Current branch: new-a')).toBeVisible();
    await waitFor(() => expect(api.reconcileCheckoutContexts).toHaveBeenCalledWith('ws'));
    expect(useWorkspaceStore.getState().getWorkspaceById('ws')?.checkoutContexts?.find(c => c.id === isolated.id)).toMatchObject({ id: isolated.id, path: isolated.path, branch: 'new-a' });
    expect(screen.getByRole('dialog').querySelector('.source-control-location')).toHaveTextContent('Isolated checkout');
    expect(screen.queryByText(/not an agent's working directory/)).toBeNull();
    expect(api.gitStartPolling).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Overview' }));
    const overview = screen.getByRole('region', { name: 'Overview' });
    expect(within(overview).getByText('new-a', { exact: true })).toBeVisible();
    expect(within(overview).getByText('Isolated checkout')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Review Changes' }));
    expect(screen.getByText(/0 changed files/)).toHaveTextContent('new-a');
    expect(screen.getAllByRole('textbox', { name: 'Commit Message' })).toHaveLength(1);
  });

  it('reports successful Push with failed status refresh and recovers manually without re-pushing', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Overview' }));
    api.gitRefresh.mockResolvedValueOnce({ ...status, success: false, error: 'Status read failed' });
    await user.click(screen.getByRole('button', { name: 'Push' }));
    expect(await screen.findByText(/Push succeeded, but refreshing repository status failed/)).toHaveTextContent('Status may be stale');
    expect(screen.getByRole('button', { name: 'Push' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Push' })).toBeEnabled());
    expect(screen.queryByText(/Push succeeded, but refreshing repository status failed/)).toBeNull();
    expect(api.gitPush).toHaveBeenCalledTimes(1);
    expect(api.gitPush).toHaveBeenCalledWith(main.path, undefined, undefined, undefined, undefined, 'ws', isolated.id);
  });

  it('focuses a selected exact commit summary above the unbounded-in-layout list and retains working/staged selection', async () => {
    const commits = Array.from({ length: 10 }, (_, i) => ({ hash: `${i}`.padStart(40, 'a'), shortHash: `abcdef${i}`, author: 'Author', date: '2026-06-01', subject: `subject ${i}` }));
    api.gitGetHistory.mockResolvedValue(commits);
    const user = await open(); await user.click(screen.getByRole('button', { name: 'History' }));
    await user.click(await screen.findByRole('button', { name: /abcdef9: subject 9/ }));
    expect(api.gitGetDiff).toHaveBeenCalledWith(isolated.path, 'commit', commits[9].hash, 'ws', isolated.id);
    const summary = await screen.findByRole('heading', { name: 'Commit Summary · abcdef9' });
    expect(summary).toHaveFocus();
    expect(scroll).toHaveBeenCalledWith({ block: 'start' });
    expect(summary.compareDocumentPosition(screen.getByRole('heading', { name: /Commits/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(commits[9].hash)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Load more commits' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Working Tree' }));
    expect(api.gitGetDiff).toHaveBeenLastCalledWith(isolated.path, 'working', undefined, 'ws', isolated.id);
    await user.click(screen.getByRole('button', { name: 'Staged' }));
    expect(api.gitGetDiff).toHaveBeenLastCalledWith(isolated.path, 'staged', undefined, 'ws', isolated.id);
  });
});
