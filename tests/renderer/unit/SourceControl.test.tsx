import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GitButton from '../../../src/renderer/components/GitButton';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { installElectronApiMock } from '../../setup/electron';
import { createTerminalFixture, createWorkspaceFixture } from '../../setup/fixtures';
import { snapshot, storeState } from '../../_helpers/attentionSnapshots';
import type { GitStatusResult } from '../../../src/shared/types/git';

let api: ReturnType<typeof installElectronApiMock>;
let status: GitStatusResult;
let listeners: Array<(value: GitStatusResult) => void>;
beforeEach(() => {
  listeners = [];
  status = { success: true, isRepo: true, workspaceId: 'ws', workspacePath: '/repo', environmentId: 'local', currentBranch: 'main', isDetached: false, changes: [], upstream: 'origin/main', ahead: 3, behind: 2 };
  api = installElectronApiMock({
    onGitStatusUpdate: vi.fn((callback) => { listeners.push(callback); callback(status); return vi.fn(); }),
    gitGetBranchState: vi.fn(async () => ({ success: true, isRepo: status.isRepo, currentBranch: status.currentBranch, isDetached: status.isDetached, branches: [] })),
    gitGetOperationState: vi.fn().mockResolvedValue({ success: true, isRepo: true, inProgress: false, mode: 'none', conflicts: [], message: '' }),
    gitGetRemotes: vi.fn().mockResolvedValue({ success: true, provider: 'github', remotes: [{ name: 'origin', fetchUrl: 'https://github.com/a/b.git', pushUrl: 'https://github.com/a/b.git' }] }),
    gitGetStashes: vi.fn().mockResolvedValue([]), gitGetHistory: vi.fn().mockResolvedValue([]),
    gitGetDiff: vi.fn().mockResolvedValue({ success: true, output: '' }),
    gitRefresh: vi.fn(async () => status),
    vcsGetContext: vi.fn().mockResolvedValue({ success: false, error: 'Provider context unavailable', pullRequest: { outcome: 'error', exists: undefined }, deepLinks: [] }),
  });
  useAgentAttentionStore.setState({ byTerminalId: {} });
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws', workspaces: [createWorkspaceFixture({ id: 'ws', workspacePath: '/repo', environmentId: 'local', browserVisible: true, browserOverlayCount: 0, terminals: [], activeTerminalId: null })] });
});
async function open() {
  const user = userEvent.setup(); const view = render(<GitButton workspacePath="/repo" workspaceId="ws" />);
  await user.click(screen.getByRole('button', { name: 'Source Control' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Commit Changes' })).toBeEnabled());
  return { user, view, dialog: screen.getByRole('dialog', { name: 'Source Control' }) };
}
describe('Source Control foundation', () => {
  it('opens Overview with explicit identity, branch, upstream and counts; one lease and restored focus', async () => {
    const { user, dialog } = await open();
    expect(within(dialog).getAllByText(/\/repo/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText('Local')).toBeVisible(); expect(within(dialog).getByText('main')).toBeVisible();
    expect(within(dialog).getByText('origin/main')).toBeVisible(); expect(within(dialog).getByText('3 ahead · 2 behind')).toBeVisible();
    expect(useWorkspaceStore.getState().getWorkspaceById('ws')?.browserOverlayCount).toBe(1);
    await user.keyboard('{Escape}'); expect(screen.queryByRole('dialog')).toBeNull();
    expect(useWorkspaceStore.getState().getWorkspaceById('ws')?.browserOverlayCount).toBe(0);
    expect(screen.getByRole('button', { name: 'Source Control' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Source Control' })); expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  });
  it('does not invent PR or CI absence when provider discovery fails', async () => {
    const { dialog } = await open(); expect(within(dialog).getByText('Unknown / unavailable')).toBeVisible();
    expect(within(dialog).queryByText(/No pull request/)).toBeNull(); expect(within(dialog).queryByText('Create PR')).toBeNull();
    expect(within(dialog).getByText('Provider context unavailable')).toBeVisible();
  });
  it('does not turn permission failures into PR absence even when a response carries exists=false', async () => {
    api.vcsGetContext.mockResolvedValue({ success: false, error: 'Authorization required', provider: { provider: 'github', owner: 'a', repo: 'b' }, pullRequest: { exists: false }, deepLinks: [] });
    const { dialog } = await open(); await waitFor(() => expect(within(dialog).getByText('Unknown / unavailable')).toBeVisible());
    expect(within(dialog).queryByText(/No pull request/)).toBeNull();
  });
  it('shows confirmed PR and CI metadata without synthesizing provider actions', async () => {
    api.vcsGetContext.mockResolvedValue({ success: true, provider: { provider: 'github', owner: 'a', repo: 'b' }, pullRequest: { exists: true, outcome: 'found', number: 12, state: 'open', checksStatus: 'failed', url: 'https://github.com/a/b/pull/12' }, deepLinks: [] });
    const { dialog, user } = await open(); await waitFor(() => expect(within(dialog).getByText('#12 · open')).toBeVisible());
    expect(within(dialog).getByText('failed')).toBeVisible(); await user.click(within(dialog).getByRole('button', { name: 'View pull request' }));
    expect(api.openExternal).toHaveBeenCalledWith('https://github.com/a/b/pull/12');
  });
  it('closes when its workspace is no longer active, releasing suppression', async () => {
    await open(); act(() => { useWorkspaceStore.setState({ activeWorkspaceId: null }); });
    expect(screen.queryByRole('dialog')).toBeNull(); expect(useWorkspaceStore.getState().getWorkspaceById('ws')?.browserOverlayCount).toBe(0);
  });
  it('shows detached HEAD and hides branch sync actions', async () => {
    status = { ...status, currentBranch: null, isDetached: true }; const { dialog } = await open();
    expect(within(dialog).getByText('Detached HEAD')).toBeVisible(); expect(within(dialog).queryByRole('button', { name: 'Push' })).toBeNull();
  });
  it.each(['Fetch', 'Pull', 'Push'])('delegates %s to the original scoped hook', async (action) => {
    const { user } = await open(); await user.click(screen.getByRole('button', { name: action }));
    const method = action === 'Fetch' ? api.gitFetch : action === 'Pull' ? api.gitPull : api.gitPush;
    expect(method).toHaveBeenCalled(); expect(method.mock.calls[0][0]).toBe('/repo'); expect(method.mock.calls[0][method.mock.calls[0].length - 1]).toBe('ws');
  });
  it('publishes only with a remote and reports failures without retargeting', async () => {
    status = { ...status, upstream: null }; api.gitPush.mockResolvedValue({ success: false, error: 'Push denied' });
    const { user } = await open(); expect(screen.getByRole('button', { name: 'Pull' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Publish branch' })); expect(api.gitPush).toHaveBeenCalledWith('/repo', 'origin', 'main', false, true, 'ws');
    expect(await screen.findByText('Push denied')).toBeVisible();
  });
  it('keeps the Source Control lease through the real CommitDialog nested handoff', async () => {
    const { user } = await open(); const counts: number[] = []; const off = useWorkspaceStore.subscribe(() => counts.push(useWorkspaceStore.getState().getWorkspaceById('ws')?.browserOverlayCount ?? 0));
    await user.click(screen.getByRole('button', { name: 'Commit Changes' })); await screen.findByRole('dialog', { name: 'Create Commit' });
    expect(useWorkspaceStore.getState().getWorkspaceById('ws')?.browserOverlayCount).toBe(2);
    await user.keyboard('{Escape}'); expect(screen.getByRole('dialog', { name: 'Source Control' })).toBeVisible();
    expect(Math.min(...counts)).toBeGreaterThan(0); off();
  });
  it('offers the existing initial branch choices and initializes only explicitly', async () => {
    status = { ...status, isRepo: false, currentBranch: null }; const user = userEvent.setup(); render(<GitButton workspacePath="/repo" workspaceId="ws" />);
    await user.click(screen.getByRole('button', { name: 'Source Control' })); expect(api.gitInit).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('Initial Branch'), 'master'); api.gitInit.mockResolvedValue({ success: false, error: 'Init refused' });
    await user.click(screen.getByRole('button', { name: 'Initialize Repository' })); expect(api.gitInit).toHaveBeenCalledWith('/repo', 'master', 'ws'); expect(await screen.findByText('Init refused')).toBeVisible();
  });
  it('closes on environment changes and rejects old provider responses', async () => {
    let finish!: (value: unknown) => void; api.vcsGetContext.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { view } = await open(); act(() => { useWorkspaceStore.setState((state) => ({ workspaces: state.workspaces.map((entry) => ({ ...entry, environmentId: 'ssh-server' })) })); });
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => finish({ success: true, provider: { provider: 'github', owner: 'old', repo: 'old' }, deepLinks: [] }));
    expect(screen.queryByText(/old\/old/)).toBeNull(); view.unmount();
  });
  it('observes native agent-location changes rather than continuing with parent actions', async () => {
    const main = { id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: '/repo', kind: 'main' as const };
    const task = { ...main, id: 'task', kind: 'worktree' as const, path: '/repo-worktrees/task', branch: 'task' };
    useWorkspaceStore.setState((state) => ({ workspaces: state.workspaces.map((entry) => ({ ...entry, activeTerminalId: 'agent', checkoutContexts: [main, task], terminals: [createTerminalFixture({ id: 'agent', workingDir: '/repo', checkoutContextId: main.id })] })) }));
    useAgentAttentionStore.setState(storeState([snapshot('agent', 'completed', 1, { location: { path: main.path, checkoutContextId: main.id } })]));
    const { user } = await open(); act(() => { useAgentAttentionStore.setState(storeState([snapshot('agent', 'running', 2, { location: { path: task.path, checkoutContextId: task.id } })])); });
    expect(screen.queryByRole('dialog')).toBeNull(); await user.click(screen.getByRole('button', { name: 'Source Control' }));
    expect(screen.getByRole('alert')).toHaveTextContent('not substituted'); expect(api.gitFetch).not.toHaveBeenCalled();
  });
  it('closes on selected worktree changes and never substitutes its parent or starts parent polling', async () => {
    const { user } = await open(); const before = api.gitStartPolling.mock.calls.length;
    act(() => { useWorkspaceStore.setState((state) => ({ workspaces: state.workspaces.map((entry) => ({ ...entry, fileSurfaceContextId: 'task', checkoutContexts: [...(entry.checkoutContexts ?? []), { id: 'task', workspaceId: 'ws', environmentId: 'local', path: '/repo-worktrees/task', kind: 'worktree' as const, branch: 'task' }] })) })); });
    expect(screen.queryByRole('dialog')).toBeNull(); await waitFor(() => expect(screen.getByRole('button', { name: 'Source Control' })).toHaveFocus()); await user.click(screen.getByRole('button', { name: 'Source Control' }));
    expect(screen.getByRole('alert')).toHaveTextContent('not substituted'); expect(api.gitStartPolling).toHaveBeenCalledTimes(before);
    expect(screen.queryByRole('button', { name: 'Commit Changes' })).toBeNull(); expect(api.gitFetch).not.toHaveBeenCalled();
  });
});

describe('Permanent Branches and Worktrees', () => {
  beforeEach(() => {
    api.gitGetBranchState.mockImplementation(async () => ({ success: true, isRepo: true, currentBranch: status.currentBranch, isDetached: status.isDetached,
      branches: ['main', 'feature'].map((name) => ({ name, isCurrent: name === status.currentBranch && !status.isDetached })) }));
    api.gitListWorktrees.mockResolvedValue({ success: true, worktrees: [{ path: '/repo', branch: 'main', isMain: true, isLocked: false, isPrunable: false }, { path: '/repo-worktrees/feature', branch: 'feature', isMain: false, isLocked: false, isPrunable: false }] });
  });
  async function branchesPage() {
    const result = await open();
    await result.user.click(within(result.dialog).getByRole('button', { name: 'Branches' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Switch to branch feature' })).toBeEnabled()); return result;
  }
  it('navigates without mutations, duplicate polling or branch/worktree interfaces in the transitional page', async () => {
    const { user, dialog } = await branchesPage(); expect(screen.getByRole('button', { name: 'Delete branch main' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Worktrees' })); await screen.findByText('Main checkout');
    expect(screen.queryByRole('button', { name: 'Remove checkout for branch main' })).toBeNull(); expect(api.gitListWorktrees).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole('button', { name: 'History' })); expect(screen.queryByRole('button', { name: 'Delete branch feature' })).toBeNull();
    expect(screen.queryByText('Listed checkouts')).toBeNull(); expect(api.gitStartPolling).toHaveBeenCalledTimes(1);
    expect(api.gitCreateBranch).not.toHaveBeenCalled(); expect(api.gitRemoveWorktree).not.toHaveBeenCalled();
  });
  it('protects main and in-use checkouts and distinguishes managed from unmanaged on the permanent page', async () => {
    const managed = { id: 'managed', workspaceId: 'ws', environmentId: 'local', path: '/repo-worktrees/managed', kind: 'worktree' as const, branch: 'managed' };
    const used = { ...managed, id: 'used', path: '/repo-worktrees/used', branch: 'used' };
    useWorkspaceStore.setState((state) => ({ workspaces: state.workspaces.map((entry) => ({ ...entry, checkoutContexts: [managed, used], terminals: [createTerminalFixture({ id: 'other-agent', checkoutContextId: used.id })], activeTerminalId: null })) }));
    api.reconcileCheckoutContexts.mockResolvedValue({ success: true, contexts: [managed, used], dropped: [] });
    api.gitListWorktrees.mockResolvedValue({ success: true, worktrees: [{ path: '/repo', branch: 'main', isMain: true }, ...[managed, used].map((entry) => ({ path: entry.path, branch: entry.branch, isMain: false })), { path: '/repo-worktrees/external', branch: 'external', isMain: false }] });
    const { user } = await open(); await user.click(screen.getByRole('button', { name: 'Worktrees' }));
    expect(await screen.findByText('Managed', { exact: true })).toBeVisible(); expect(screen.getByText('Unmanaged', { exact: true })).toBeVisible(); expect(screen.getByText('In use', { exact: true })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Remove checkout for branch used' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Remove checkout for branch main' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove checkout for branch managed' })).toBeEnabled(); expect(api.reconcileCheckoutContexts).toHaveBeenCalledTimes(1);
  });
  it('discards worktree list results after navigation without extra reconciliation', async () => {
    let finish!: (value: unknown) => void; api.gitListWorktrees.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { user } = await open(); await user.click(screen.getByRole('button', { name: 'Worktrees' })); await screen.findByText('Loading worktrees…'); await user.click(screen.getByRole('button', { name: 'Branches' }));
    await act(async () => finish({ success: true, worktrees: [{ path: '/old', branch: 'late-worktree', isMain: false }] })); expect(screen.queryByText('late-worktree')).toBeNull(); expect(api.reconcileCheckoutContexts).not.toHaveBeenCalled(); expect(api.gitStartPolling).toHaveBeenCalledTimes(1);
  });
  it('refreshes worktrees exactly once after unlocking and keeps navigation locked during the request', async () => {
    let finish!: (value: unknown) => void; api.gitUnlockWorktree.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    api.gitListWorktrees.mockResolvedValue({ success: true, worktrees: [{ path: '/repo-worktrees/locked', branch: 'locked', isMain: false, isLocked: true, lockReason: 'Intentional' }] });
    const { user } = await open(); await user.click(screen.getByRole('button', { name: 'Worktrees' })); await user.click(await screen.findByRole('button', { name: 'Unlock checkout for branch locked' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Locks may be intentional'); await user.click(screen.getByRole('button', { name: 'Unlock worktree' })); expect(screen.getByRole('button', { name: 'Branches' })).toBeDisabled();
    await act(async () => finish({ success: true })); await waitFor(() => expect(api.gitListWorktrees).toHaveBeenCalledTimes(2));
    expect(api.gitRemoveWorktree).not.toHaveBeenCalled(); expect(api.gitGetBranchState.mock.calls.length).toBeGreaterThan(1);
  });
  it('creates through existing branch validation and keeps failed drafts', async () => {
    api.gitCreateBranch.mockResolvedValue({ success: false, error: 'Invalid branch name' }); const { user } = await branchesPage();
    await user.type(screen.getByLabelText('Create Branch'), 'bad name'); await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(api.gitCreateBranch).toHaveBeenCalledWith('/repo', 'bad name', 'main', 'ws'); expect(await screen.findByText('Invalid branch name')).toBeVisible(); expect(screen.getByLabelText('Create Branch')).toHaveValue('bad name');
  });
  it('creates successfully and refreshes authoritative branch state without switching optimistically', async () => {
    const { user } = await branchesPage(); const before = api.gitGetBranchState.mock.calls.length;
    await user.type(screen.getByLabelText('Create Branch'), 'new-task'); await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(api.gitGetBranchState.mock.calls.length).toBeGreaterThan(before)); expect(screen.getByLabelText('Create Branch')).toHaveValue(''); expect(screen.getByText(/Current checkout: main/)).toBeVisible();
  });
  it('switches only on native acknowledgement and refreshes the shared controller', async () => {
    let finish!: (value: unknown) => void; api.gitSwitchBranch.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { user } = await branchesPage(); await user.click(screen.getByRole('button', { name: 'Switch to branch feature' })); expect(screen.getByText(/Current checkout: main/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Worktrees' })).toBeDisabled();
    await act(async () => { status = { ...status, currentBranch: 'feature' }; listeners[0](status); finish({ success: true }); });
    await waitFor(() => expect(screen.getByText(/Current checkout: feature/)).toBeVisible()); expect(api.gitSwitchBranch).toHaveBeenCalledWith('/repo', 'feature', 'ws');
    expect(screen.getByRole('button', { name: 'Delete branch feature' })).toBeDisabled();
  });
  it('shows switch failure without fabricating the new branch', async () => {
    api.gitSwitchBranch.mockResolvedValue({ success: false, error: 'Branch is checked out in another worktree' }); const { user } = await branchesPage();
    await user.click(screen.getByRole('button', { name: 'Switch to branch feature' })); expect(await screen.findByText('Branch is checked out in another worktree')).toBeVisible(); expect(screen.getByText(/Current checkout: main/)).toBeVisible();
  });
  it('shows detached HEAD on Branches without marking a local branch current', async () => {
    status = { ...status, currentBranch: null, isDetached: true }; await branchesPage(); expect(screen.getByText(/Current checkout: Detached HEAD/)).toBeVisible(); expect(screen.queryByText('Current', { exact: true })).toBeNull();
  });
  it('cancels normal deletion and holds navigation and the Browser lease while the dialog is open', async () => {
    const { user } = await branchesPage(); await user.click(screen.getByRole('button', { name: 'Delete branch feature' })); await screen.findByRole('alertdialog');
    expect(useWorkspaceStore.getState().getWorkspaceById('ws')?.browserOverlayCount).toBe(2); expect(screen.getByRole('button', { name: 'Worktrees', hidden: true })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' })); expect(api.gitDeleteBranch).not.toHaveBeenCalled(); expect(api.gitForceDeleteBranch).not.toHaveBeenCalled(); expect(useWorkspaceStore.getState().getWorkspaceById('ws')?.browserOverlayCount).toBe(1);
  });
  it('deletes normally through the scoped API and refreshes', async () => {
    const { user } = await branchesPage(); await user.click(screen.getByRole('button', { name: 'Delete branch feature' })); await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete branch' }));
    expect(api.gitDeleteBranch).toHaveBeenCalledWith('/repo', 'feature', 'ws'); expect(api.gitForceDeleteBranch).not.toHaveBeenCalled(); await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });
  it('requires a distinct force-delete decision only for an unmerged-commits result', async () => {
    api.gitDeleteBranch.mockResolvedValue({ success: false, blockedByUnmergedCommits: true, error: 'Unmerged work' }); const { user } = await branchesPage();
    await user.click(screen.getByRole('button', { name: 'Delete branch feature' })); await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete branch' }));
    await screen.findByText('Unmerged work'); expect(api.gitForceDeleteBranch).not.toHaveBeenCalled(); await user.click(screen.getByRole('button', { name: 'Force Delete' })); expect(api.gitForceDeleteBranch).toHaveBeenCalledWith('/repo', 'feature', 'ws');
  });
  it('retains a failed force-delete error and never retries it silently', async () => {
    api.gitDeleteBranch.mockResolvedValue({ success: false, blockedByUnmergedCommits: true, error: 'Unmerged work' }); api.gitForceDeleteBranch.mockResolvedValue({ success: false, error: 'Branch became attached to a worktree' }); const { user } = await branchesPage();
    await user.click(screen.getByRole('button', { name: 'Delete branch feature' })); await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete branch' })); await user.click(await screen.findByRole('button', { name: 'Force Delete' }));
    expect(await screen.findByText('Branch became attached to a worktree')).toBeVisible(); expect(api.gitForceDeleteBranch).toHaveBeenCalledTimes(1);
  });
  it('refuses a branch that became current while its confirmation was open', async () => {
    const { user } = await branchesPage(); await user.click(screen.getByRole('button', { name: 'Delete branch feature' }));
    act(() => { status = { ...status, currentBranch: 'feature' }; listeners[0](status); });
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete branch' })); expect(api.gitDeleteBranch).not.toHaveBeenCalled(); expect(api.gitForceDeleteBranch).not.toHaveBeenCalled(); expect(await screen.findByText('The current branch cannot be deleted')).toBeVisible();
  });
  it('cancels force escalation without deleting anything further', async () => {
    api.gitDeleteBranch.mockResolvedValue({ success: false, blockedByUnmergedCommits: true, error: 'Unmerged work' }); const { user } = await branchesPage();
    await user.click(screen.getByRole('button', { name: 'Delete branch feature' })); await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete branch' })); await screen.findByRole('button', { name: 'Force Delete' });
    await user.click(screen.getByRole('button', { name: 'Cancel' })); expect(api.gitDeleteBranch).toHaveBeenCalledTimes(1); expect(api.gitForceDeleteBranch).not.toHaveBeenCalled();
  });
  it('retains worktree-protected deletion errors without offering force', async () => {
    api.gitDeleteBranch.mockResolvedValue({ success: false, error: 'Branch used by another worktree' }); const { user } = await branchesPage();
    await user.click(screen.getByRole('button', { name: 'Delete branch feature' })); await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete branch' }));
    expect(await screen.findByText('Branch used by another worktree')).toBeVisible(); expect(screen.queryByRole('button', { name: 'Force Delete' })).toBeNull(); expect(api.gitForceDeleteBranch).not.toHaveBeenCalled();
  });
  it('preserves branch provider PR links with the canonical scoped deep-link path', async () => {
    api.vcsGetContext.mockResolvedValue({ success: true, provider: { provider: 'github', owner: 'a', repo: 'b' }, pullRequest: { exists: false, outcome: 'none' }, deepLinks: [] });
    const { user } = await branchesPage(); await user.click(await screen.findByRole('button', { name: 'Create PR' })); expect(api.vcsOpenDeepLink).toHaveBeenCalledWith('/repo', 'create-pr', 'ws');
  });
  it.each(['workspace', 'checkout', 'environment'])('discards a pending branch result after a %s change', async (change) => {
    let finish!: (value: unknown) => void; api.gitSwitchBranch.mockReturnValue(new Promise((resolve) => { finish = resolve; })); const { user } = await branchesPage(); await user.click(screen.getByRole('button', { name: 'Switch to branch feature' }));
    const before = api.gitGetBranchState.mock.calls.length; act(() => { useWorkspaceStore.setState((state) => change === 'workspace' ? { activeWorkspaceId: null } : { workspaces: state.workspaces.map((entry) => change === 'environment' ? { ...entry, environmentId: 'ssh-other' } : { ...entry, fileSurfaceContextId: 'unregistered' }) }); });
    expect(screen.queryByRole('dialog')).toBeNull(); await act(async () => finish({ success: true })); expect(api.gitGetBranchState).toHaveBeenCalledTimes(before); expect(screen.queryByText(/Current checkout: feature/)).toBeNull();
  });
});

describe('Permanent Stashes, Remotes, and Merge (Phase 3C)', () => {
  const sampleStashes = [
    { ref: 'stash@{0}', hash: 'hash000', message: 'WIP on feature' },
    { ref: 'stash@{1}', hash: 'hash111', message: 'WIP on bugfix' },
  ];
  const sampleRemotes = [
    { name: 'origin', fetchUrl: 'https://github.com/a/b.git', pushUrl: 'git@github.com:a/b.git' },
  ];

  beforeEach(() => {
    api.gitGetBranchState.mockImplementation(async () => ({
      success: true,
      isRepo: true,
      currentBranch: status.currentBranch,
      isDetached: status.isDetached,
      branches: ['main', 'feature'].map((name) => ({ name, isCurrent: name === status.currentBranch && !status.isDetached })),
    }));
    api.gitGetStashes.mockResolvedValue(sampleStashes);
    api.gitGetRemotes.mockResolvedValue({ success: true, provider: 'github', remotes: sampleRemotes });
    api.gitStash = vi.fn().mockResolvedValue({ success: true });
    api.gitApplyStash = vi.fn().mockResolvedValue({ success: true });
    api.gitPopStash = vi.fn().mockResolvedValue({ success: true });
    api.gitDropStash = vi.fn().mockResolvedValue({ success: true });
    api.gitClearStashes = vi.fn().mockResolvedValue({ success: true });
    api.gitAddRemote = vi.fn().mockResolvedValue({ success: true });
    api.gitRenameRemote = vi.fn().mockResolvedValue({ success: true });
    api.gitRemoveRemote = vi.fn().mockResolvedValue({ success: true });
    api.gitMergeBranch = vi.fn().mockResolvedValue({ success: true });
    api.gitAbortOperation = vi.fn().mockResolvedValue({ success: true });
  });

  it('navigates to all permanent pages and eliminates transitional tools entirely', async () => {
    const { user, dialog } = await open();

    // Verify all navigation items exist in the expected groups
    expect(within(dialog).getByRole('button', { name: 'Overview' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Branches' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Worktrees' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'History' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Stashes' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Remotes' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Merge' })).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Existing Git Tools' })).toBeNull();

    // Navigate to History - permanent destination
    await user.click(within(dialog).getByRole('button', { name: 'History' }));
    expect(within(dialog).getByText(/Inspect repository commit history/)).toBeVisible();
    expect(within(dialog).getByText('Working Changes Summary')).toBeVisible();

    // Navigate to Stashes
    await user.click(within(dialog).getByRole('button', { name: 'Stashes' }));
    expect(within(dialog).getByText(/Apply restores changes without removing the stash/)).toBeVisible();
    expect(within(dialog).getByText('WIP on feature')).toBeVisible();

    // Navigate to Remotes
    await user.click(within(dialog).getByRole('button', { name: 'Remotes' }));
    expect(within(dialog).getByText(/Configured remote repositories/)).toBeVisible();
    expect(within(dialog).getByText('origin')).toBeVisible();

    // Navigate to Merge
    await user.click(within(dialog).getByRole('button', { name: 'Merge' }));
    expect(within(dialog).getByText(/Integrate changes from another branch/)).toBeVisible();
  });

  describe('Stashes page', () => {
    async function stashesPage() {
      const result = await open();
      await result.user.click(within(result.dialog).getByRole('button', { name: 'Stashes' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh stashes' })).toBeEnabled());
      return result;
    }

    it('creates a stash with optional message and untracked files', async () => {
      const { user } = await stashesPage();
      const input = screen.getByPlaceholderText('Optional stash message');
      await user.type(input, 'My experiment');
      await user.click(screen.getByRole('button', { name: 'Stash' }));
      expect(api.gitStash).toHaveBeenCalledWith('/repo', 'My experiment', true, 'ws');
    });

    it('applies stash without dropping and pops stash on clean result', async () => {
      const { user } = await stashesPage();

      // Apply stash
      await user.click(screen.getByRole('button', { name: 'Apply stash@{0}' }));
      expect(api.gitApplyStash).toHaveBeenCalledWith('/repo', 'stash@{0}', sampleStashes[0].hash, 'ws');
      expect(api.gitDropStash).not.toHaveBeenCalled();

      // Pop stash
      await user.click(screen.getByRole('button', { name: 'Pop stash@{0}' }));
      expect(api.gitPopStash).toHaveBeenCalledWith('/repo', 'stash@{0}', sampleStashes[0].hash, 'ws');
    });

    it('refuses to apply, pop, or drop a stash entry with empty or missing commit identity', async () => {
      api.gitGetStashes.mockResolvedValueOnce([
        { ref: 'stash@{0}', hash: '', message: 'corrupted' },
      ]);
      const { user } = await stashesPage();

      await user.click(screen.getByRole('button', { name: 'Apply stash@{0}' }));
      expect(api.gitApplyStash).not.toHaveBeenCalled();
      expect(await screen.findByText(/without verified commit identity/)).toBeVisible();

      await user.click(screen.getByRole('button', { name: 'Pop stash@{0}' }));
      expect(api.gitPopStash).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Drop stash@{0}' }));
      expect(api.gitDropStash).not.toHaveBeenCalled();
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    it('confirms and cancels single stash drop via AlertDialog with lease tracking', async () => {
      const { user } = await stashesPage();
      await user.click(screen.getByRole('button', { name: 'Drop stash@{0}' }));

      const alert = await screen.findByRole('alertdialog');
      expect(within(alert).getByText(/Drop stash@\{0\}\?/)).toBeVisible();
      expect(within(alert).getByText(/Permanently delete stash/)).toBeVisible();
      expect(useWorkspaceStore.getState().getWorkspaceById('ws')?.browserOverlayCount).toBe(2);

      // Cancel leaves stash intact
      await user.click(within(alert).getByRole('button', { name: 'Cancel' }));
      expect(api.gitDropStash).not.toHaveBeenCalled();
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(useWorkspaceStore.getState().getWorkspaceById('ws')?.browserOverlayCount).toBe(1);

      // Reopen and confirm
      await user.click(screen.getByRole('button', { name: 'Drop stash@{0}' }));
      const reopenAlert = await screen.findByRole('alertdialog');
      await user.click(within(reopenAlert).getByRole('button', { name: 'Drop stash' }));
      expect(api.gitDropStash).toHaveBeenCalledWith('/repo', 'stash@{0}', sampleStashes[0].hash, 'ws');
    });

    it('refuses to drop if positional stash reference shifted while confirmation was open', async () => {
      const { user } = await stashesPage();
      await user.click(screen.getByRole('button', { name: 'Drop stash@{0}' }));
      const alert = await screen.findByRole('alertdialog');

      // Before drop confirms, backend drop returns shift error
      api.gitDropStash.mockResolvedValueOnce({
        success: false,
        error: "Stash reference 'stash@{0}' changed. The operation was cancelled to avoid acting on the wrong stash.",
      });

      await user.click(within(alert).getByRole('button', { name: 'Drop stash' }));
      expect(api.gitDropStash).toHaveBeenCalledWith('/repo', 'stash@{0}', sampleStashes[0].hash, 'ws');
      expect(await screen.findByText(/Stash reference/)).toBeVisible();
    });

    it('confirms and clears all stashes via distinct AlertDialog', async () => {
      const { user } = await stashesPage();
      await user.click(screen.getByRole('button', { name: 'Clear All' }));

      const alert = await screen.findByRole('alertdialog');
      expect(within(alert).getByText('Clear all stashes?')).toBeVisible();
      expect(within(alert).getByText(/Permanently delete all 2 saved stashes/)).toBeVisible();

      // Cancel
      await user.click(within(alert).getByRole('button', { name: 'Cancel' }));
      expect(api.gitClearStashes).not.toHaveBeenCalled();

      // Reopen and confirm
      await user.click(screen.getByRole('button', { name: 'Clear All' }));
      const reopen = await screen.findByRole('alertdialog');
      await user.click(within(reopen).getByRole('button', { name: 'Clear all stashes' }));
      expect(api.gitClearStashes).toHaveBeenCalledWith(
        '/repo',
        [sampleStashes[0].hash, sampleStashes[1].hash],
        'ws'
      );
    });

    it('reports clear stashes failure if collection changed while confirmation was open', async () => {
      const { user } = await stashesPage();
      await user.click(screen.getByRole('button', { name: 'Clear All' }));
      const alert = await screen.findByRole('alertdialog');

      api.gitClearStashes.mockResolvedValueOnce({
        success: false,
        error: 'Stash collection changed since confirmation was opened. Re-confirm to clear all stashes.',
      });

      await user.click(within(alert).getByRole('button', { name: 'Clear all stashes' }));
      expect(await screen.findByText(/Stash collection changed/)).toBeVisible();
    });
  });

  describe('Remotes page', () => {
    async function remotesPage() {
      const result = await open();
      await result.user.click(within(result.dialog).getByRole('button', { name: 'Remotes' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh remotes' })).toBeEnabled());
      return result;
    }

    it('displays remote name, fetch URL and push URL', async () => {
      await remotesPage();
      expect(screen.getByText('origin')).toBeVisible();
      expect(screen.getByText(/Fetch: https:\/\/github\.com\/a\/b\.git · Push: git@github\.com:a\/b\.git/)).toBeVisible();
    });

    it('adds a remote through form validation without contacting servers', async () => {
      const { user } = await remotesPage();
      await user.click(screen.getByRole('button', { name: 'Add remote' }));

      const name = screen.getByLabelText('Name');
      const url = screen.getByLabelText('URL');
      fireEvent.change(name, { target: { value: 'upstream' } });
      fireEvent.change(url, { target: { value: 'https://github.com/upstream/repo.git' } });
      await user.click(screen.getByRole('button', { name: 'Add Remote' }));

      expect(api.gitAddRemote).toHaveBeenCalledWith('/repo', 'upstream', 'https://github.com/upstream/repo.git', 'ws');
    });

    it('renames a remote through validated inline form', async () => {
      const { user } = await remotesPage();
      await user.click(screen.getByRole('button', { name: 'Rename remote' }));

      const newNameInput = screen.getByLabelText('New Name');
      await user.clear(newNameInput);
      await user.type(newNameInput, 'origin-renamed');
      await user.click(screen.getByRole('button', { name: 'Rename Remote' }));

      expect(api.gitRenameRemote).toHaveBeenCalledWith('/repo', 'origin', 'origin-renamed', 'ws');
    });

    it('confirms remote removal via AlertDialog identifying the exact remote', async () => {
      const { user } = await remotesPage();
      await user.click(screen.getByRole('button', { name: 'Remove remote' }));

      const alert = await screen.findByRole('alertdialog');
      expect(within(alert).getByText("Remove remote 'origin'?", { selector: 'h3' })).toBeVisible();
      expect(within(alert).getByText(/Fetch URL: https:\/\/github\.com\/a\/b\.git/)).toBeVisible();
      expect(within(alert).getByText(/Push URL: git@github\.com:a\/b\.git/)).toBeVisible();
      expect(useWorkspaceStore.getState().getWorkspaceById('ws')?.browserOverlayCount).toBe(2);

      // Cancel leaves remote untouched
      await user.click(within(alert).getByRole('button', { name: 'Cancel' }));
      expect(api.gitRemoveRemote).not.toHaveBeenCalled();
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(useWorkspaceStore.getState().getWorkspaceById('ws')?.browserOverlayCount).toBe(1);

      // Reopen and confirm
      await user.click(screen.getByRole('button', { name: 'Remove remote' }));
      const reopen = await screen.findByRole('alertdialog');
      await user.click(within(reopen).getByRole('button', { name: 'Remove remote' }));
      expect(api.gitRemoveRemote).toHaveBeenCalledWith('/repo', 'origin', 'ws');
    });
  });

  describe('Merge page', () => {
    async function mergePage() {
      const result = await open();
      await result.user.click(within(result.dialog).getByRole('button', { name: 'Merge' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh merge state' })).toBeEnabled());
      return result;
    }

    it('shows clear merge direction and executes merge into current checkout', async () => {
      const { user } = await mergePage();
      expect(screen.getByText(/Current checkout: main/)).toBeVisible();
      expect(screen.getByText(/Merge branch/).textContent).toContain('Merge branch feature into main');

      await user.click(screen.getByRole('button', { name: 'Merge feature into main' }));
      expect(api.gitMergeBranch).toHaveBeenCalledWith('/repo', 'feature', 'ws');
    });

    it('disables merge when current checkout is detached HEAD with explanation', async () => {
      status = { ...status, currentBranch: null, isDetached: true };
      await mergePage();
      expect(screen.getByText(/Current checkout: Detached HEAD/)).toBeVisible();
      expect(screen.getByText(/detached HEAD state.*Merging into a detached HEAD is disabled/)).toBeVisible();
      expect(screen.getByRole('button', { name: 'Merge branch' })).toBeDisabled();
    });

    it('displays conflicted merge state and confirms abort with conflict details', async () => {
      api.gitGetOperationState.mockResolvedValue({
        success: true,
        isRepo: true,
        inProgress: true,
        mode: 'merge',
        conflicts: ['src/index.ts', 'package.json'],
        message: 'Merge has 2 conflicts',
      });

      const { user } = await mergePage();
      expect(await screen.findByText('Merge has 2 conflicts')).toBeVisible();
      expect(screen.getByText('src/index.ts')).toBeVisible();
      expect(screen.getByText('package.json')).toBeVisible();

      // Click Abort
      await user.click(screen.getByRole('button', { name: 'Abort Merge' }));
      const alert = await screen.findByRole('alertdialog');
      expect(within(alert).getByText('Abort merge?')).toBeVisible();
      expect(within(alert).getByText(/Unresolved conflicts in 2 files/)).toBeVisible();
      expect(within(alert).getByText('src/index.ts')).toBeVisible();
      expect(within(alert).getByText('package.json')).toBeVisible();

      // Cancel leaves merge in progress
      await user.click(within(alert).getByRole('button', { name: 'Cancel' }));
      expect(api.gitAbortOperation).not.toHaveBeenCalled();

      // Reopen and confirm
      await user.click(screen.getByRole('button', { name: 'Abort Merge' }));
      const reopen = await screen.findByRole('alertdialog');
      await user.click(within(reopen).getByRole('button', { name: 'Abort merge' }));
      expect(api.gitAbortOperation).toHaveBeenCalledWith('/repo', 'ws');
    });

    it('displays rebase in progress mode and aborts rebase cleanly', async () => {
      api.gitGetOperationState.mockResolvedValue({
        success: true,
        isRepo: true,
        inProgress: true,
        mode: 'rebase',
        conflicts: [],
        message: 'Rebase in progress',
      });

      const { user } = await mergePage();
      expect(await screen.findByText('Rebase in progress')).toBeVisible();

      await user.click(screen.getByRole('button', { name: 'Abort Rebase' }));
      const alert = await screen.findByRole('alertdialog');
      expect(within(alert).getByText('Abort rebase?')).toBeVisible();
      await user.click(within(alert).getByRole('button', { name: 'Abort rebase' }));
      expect(api.gitAbortOperation).toHaveBeenCalledWith('/repo', 'ws');
    });

    it('does not offer abort or merge when operation state discovery fails', async () => {
      api.gitGetOperationState.mockResolvedValue({
        success: false,
        isRepo: false,
        inProgress: false,
        mode: 'none',
        conflicts: [],
        message: 'Failed to inspect merge state',
      });

      const { dialog } = await mergePage();
      expect(await screen.findByText('Failed to inspect merge state')).toBeVisible();
      expect(screen.queryByRole('button', { name: /Abort/ })).toBeNull();
      expect(within(dialog).queryByRole('button', { name: 'Merge branch' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Refresh merge state' })).toBeEnabled();
    });

    it('fails closed and displays unknown state without executable controls when refresh throws', async () => {
      api.gitGetOperationState.mockRejectedValue(new Error('Git CLI crashed'));

      const { dialog } = await mergePage();
      await waitFor(() => expect(screen.getAllByText('Git CLI crashed').length).toBeGreaterThan(0));
      expect(screen.queryByRole('button', { name: /Abort/ })).toBeNull();
      expect(within(dialog).queryByRole('button', { name: 'Merge branch' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Refresh merge state' })).toBeEnabled();
    });

    it.each(['workspace', 'checkout', 'environment'])('discards a pending merge result after a %s change', async (change) => {
      let finish!: (value: unknown) => void;
      api.gitMergeBranch.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      const { user } = await mergePage();
      await user.click(screen.getByRole('button', { name: 'Merge feature into main' }));

      const before = api.gitGetBranchState.mock.calls.length;
      act(() => {
        useWorkspaceStore.setState((state) =>
          change === 'workspace'
            ? { activeWorkspaceId: null }
            : {
                workspaces: state.workspaces.map((entry) =>
                  change === 'environment'
                    ? { ...entry, environmentId: 'ssh-other' }
                    : { ...entry, fileSurfaceContextId: 'unregistered' }
                ),
              }
        );
      });

      expect(screen.queryByRole('dialog')).toBeNull();
      await act(async () => finish({ success: true }));
      expect(api.gitGetBranchState).toHaveBeenCalledTimes(before);
    });
  });

  describe('History page and Diff summaries (Phase 3D)', () => {
    const mockCommits = [
      { hash: 'c111111111111111111111111111111111111111', shortHash: 'c111111', author: 'Alice', date: '2026-03-01', subject: 'feat: add first feature' },
      { hash: 'c222222222222222222222222222222222222222', shortHash: 'c222222', author: 'Bob', date: '2026-03-02', subject: 'fix: resolve edge case' },
    ];

    async function historyPage(commits = mockCommits) {
      api.gitGetHistory.mockResolvedValue(commits);
      const result = await open();
      await result.user.click(within(result.dialog).getByRole('button', { name: 'History' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh history' })).toBeEnabled());
      return result;
    }

    it('renders commit list with short hash, author, date, subject, and truthful working summary title', async () => {
      const { dialog } = await historyPage();
      expect(within(dialog).getByText('c111111')).toBeVisible();
      expect(within(dialog).getByText('feat: add first feature')).toBeVisible();
      expect(within(dialog).getByText('Alice')).toBeVisible();
      expect(within(dialog).getByText('2026-03-01')).toBeVisible();

      // Truthful summary label
      expect(within(dialog).getByText('Working Changes Summary')).toBeVisible();
      expect(within(dialog).getByText(/Summary of uncommitted modifications in the working tree/)).toBeVisible();
    });

    it('switches to Staged Changes Summary with accurate label', async () => {
      api.gitGetDiff.mockResolvedValue({ success: true, output: ' 1 file changed, 2 insertions(+)', title: 'Staged Diff' });
      const { user, dialog } = await historyPage();

      await user.click(within(dialog).getByRole('button', { name: 'Staged' }));
      expect(api.gitGetDiff).toHaveBeenCalledWith('/repo', 'staged', undefined, 'ws');
      expect(await within(dialog).findByText('Staged Changes Summary')).toBeVisible();
      expect(within(dialog).getByText(/Summary of changes staged for the next commit/)).toBeVisible();
      expect(within(dialog).getByText('1 file changed, 2 insertions(+)')).toBeVisible();
    });

    it('switches to Commit Summary on commit selection with full SHA metadata bar', async () => {
      api.gitGetDiff.mockResolvedValue({ success: true, output: 'commit c222222 summary output', title: 'Commit c222222' });
      const { user, dialog } = await historyPage();

      await user.click(within(dialog).getByRole('button', { name: /fix: resolve edge case/ }));
      expect(api.gitGetDiff).toHaveBeenCalledWith('/repo', 'commit', mockCommits[1].hash, 'ws');
      expect(await within(dialog).findByText(/Commit Summary · c222222/)).toBeVisible();
      expect(within(dialog).getAllByText('Bob').length).toBeGreaterThan(0);
      expect(within(dialog).getByText(mockCommits[1].hash)).toBeVisible();
      expect(within(dialog).getByText('commit c222222 summary output')).toBeVisible();
    });

    it('handles bounded history depth and Load More within 50 entries', async () => {
      // Return 10 commits (matching initial limit)
      const tenCommits = Array.from({ length: 10 }, (_, i) => ({
        hash: `hash${i}${'0'.repeat(35)}`,
        shortHash: `h${i}00000`,
        author: `Author ${i}`,
        date: `2026-03-${10 + i}`,
        subject: `commit ${i}`,
      }));
      api.gitGetHistory.mockResolvedValue(tenCommits);
      const { user, dialog } = await open();
      await user.click(within(dialog).getByRole('button', { name: 'History' }));

      // Load more button is offered because count === historyLimit (10) and < 50
      const loadMoreBtn = await within(dialog).findByRole('button', { name: 'Load more commits' });
      expect(loadMoreBtn).toBeVisible();

      // Return 15 commits on next request
      const fifteenCommits = Array.from({ length: 15 }, (_, i) => ({
        hash: `hash${i}${'0'.repeat(35)}`,
        shortHash: `h${i}00000`,
        author: `Author ${i}`,
        date: `2026-03-${10 + i}`,
        subject: `commit ${i}`,
      }));
      api.gitGetHistory.mockResolvedValue(fifteenCommits);

      await user.click(loadMoreBtn);
      expect(api.gitGetHistory).toHaveBeenCalledWith('/repo', 25, 'ws');
      // Now length is 15 but requested was 25 -> history exhausted, no more load more
      await waitFor(() => expect(within(dialog).queryByRole('button', { name: 'Load more commits' })).toBeNull());
    });

    it('does not display Load more when history is exhausted on initial load', async () => {
      const { dialog } = await historyPage(mockCommits); // only 2 commits, less than initial limit 10
      expect(within(dialog).queryByRole('button', { name: 'Load more commits' })).toBeNull();
    });

    it('displays empty state when repository has no commits yet', async () => {
      const { dialog } = await historyPage([]);
      expect(within(dialog).getByText(/No commits found/)).toBeVisible();
    });

    it('preserves latest explicit selection over older pending refresh results', async () => {
      let resolveDiffRefresh!: (val: unknown) => void;
      api.gitGetDiff.mockImplementationOnce(() => new Promise((r) => { resolveDiffRefresh = r; }));

      const { user, dialog } = await historyPage();

      // User explicitly clicks commit 1 while refresh is in progress
      api.gitGetDiff.mockResolvedValueOnce({
        success: true,
        output: 'newer explicit selection output',
        title: 'Commit c111111',
      });

      await user.click(within(dialog).getByRole('button', { name: /feat: add first feature/ }));

      // Older refresh finishes afterward with stale working output
      await act(async () => {
        resolveDiffRefresh({
          success: true,
          output: 'stale working tree output',
          title: 'Working Tree Diff',
        });
      });

      // The newer explicit commit selection output must win
      expect(await within(dialog).findByText('newer explicit selection output')).toBeVisible();
      expect(within(dialog).queryByText('stale working tree output')).toBeNull();
    });

    it('displays diff error clearly without claiming no diff to display', async () => {
      api.gitGetDiff.mockResolvedValue({ success: false, error: 'Git diff failed: permission denied' });
      const { dialog } = await historyPage();

      await waitFor(() => expect(within(dialog).getAllByText('Git diff failed: permission denied').length).toBeGreaterThan(0));
      expect(within(dialog).queryByText('No diff to display')).toBeNull();
    });

    it.each(['workspace', 'checkout', 'environment'])('discards pending diff results after a %s change', async (change) => {
      let finishDiff!: (val: unknown) => void;
      api.gitGetDiff.mockReturnValue(new Promise((r) => { finishDiff = r; }));

      const { user } = await historyPage();
      await user.click(screen.getByRole('button', { name: 'Staged' }));

      act(() => {
        useWorkspaceStore.setState((state) =>
          change === 'workspace'
            ? { activeWorkspaceId: null }
            : {
                workspaces: state.workspaces.map((entry) =>
                  change === 'environment'
                    ? { ...entry, environmentId: 'ssh-other' }
                    : { ...entry, fileSurfaceContextId: 'unregistered' }
                ),
              }
        );
      });

      expect(screen.queryByRole('dialog')).toBeNull();
      await act(async () => finishDiff({ success: true, output: 'late output' }));
      expect(screen.queryByText('late output')).toBeNull();
    });
  });
});
