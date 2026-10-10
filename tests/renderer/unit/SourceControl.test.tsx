import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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
    await user.click(within(dialog).getByRole('button', { name: 'Existing Git Tools' })); expect(screen.queryByRole('button', { name: 'Delete branch feature' })).toBeNull();
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
