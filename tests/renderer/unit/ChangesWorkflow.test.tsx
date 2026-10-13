import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GitButton from '../../../src/renderer/components/GitButton';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture, createTerminalFixture } from '../../setup/fixtures';
import { installGitMutationResponses } from '../../_helpers/gitMutationResponses';
import type { GitStatusResult } from '../../../src/shared/types/git';

let api: ReturnType<typeof installElectronApiMock>;
let status: GitStatusResult;
const postMutationStatus = vi.fn<() => Promise<GitStatusResult>>();
beforeEach(() => {
  status = { success: true, isRepo: true, workspaceId: 'ws', workspacePath: '/repo', environmentId: 'local',
    currentBranch: 'main', isDetached: false, upstream: null, ahead: 0, behind: 0,
    changes: [{ path: 'partial.ts', status: 'modified', staged: true }, { path: 'partial.ts', status: 'modified', staged: false },
      { path: 'new.ts', status: 'untracked', staged: false }] };
  api = installElectronApiMock({
    onGitStatusUpdate: vi.fn((callback) => { callback(status); return vi.fn(); }),
    gitGetBranchState: vi.fn().mockResolvedValue({ success: true, isRepo: true, currentBranch: 'main', branches: [] }),
    gitGetHistory: vi.fn().mockResolvedValue([]), gitGetStashes: vi.fn().mockResolvedValue([]),
    gitGetOperationState: vi.fn().mockResolvedValue({ success: true, inProgress: false, mode: 'none', conflicts: [] }),
    gitGetRemotes: vi.fn().mockResolvedValue({ success: true, remotes: [], provider: 'unknown' }),
    gitRefresh: vi.fn(async () => status),
    gitGetFileDiff: vi.fn().mockResolvedValue({ success: true, oldContent: 'HEAD content', newContent: 'agent modification',
      oldPath: 'partial.ts', newPath: 'partial.ts', isBinary: false, hasDiff: true }),
    gitStage: vi.fn(async (_root, paths) => {
      status = { ...status, changes: status.changes.filter((entry) => entry.staged || paths && !paths.includes(entry.path)).concat(
        status.changes.filter((entry) => !entry.staged && (!paths || paths.includes(entry.path)) && !status.changes.some((other) => other.staged && other.path === entry.path)).map((entry) => ({ ...entry, staged: true }))) };
      return { success: true };
    }),
    gitUnstage: vi.fn(async (_root, paths) => {
      status = { ...status, changes: status.changes.filter((entry) => !entry.staged || paths && !paths.includes(entry.path)).concat(
        status.changes.filter((entry) => entry.staged && (!paths || paths.includes(entry.path)) && !status.changes.some((other) => !other.staged && other.path === entry.path)).map((entry) => ({ ...entry, staged: false }))) };
      return { success: true };
    }),
    gitCommit: vi.fn(async () => { status = { ...status, changes: status.changes.filter((entry) => !entry.staged) }; return { success: true }; }),
  });
  postMutationStatus.mockReset().mockImplementation(async () => status);
  installGitMutationResponses(postMutationStatus);
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws', workspaces: [createWorkspaceFixture({ id: 'ws', workspacePath: '/repo', environmentId: 'local', browserVisible: true, browserOverlayCount: 0, terminals: [] })] });
});
async function open() {
  const user = userEvent.setup();
  render(<GitButton workspacePath="/repo" workspaceId="ws" />);
  await user.click(screen.getByRole('button', { name: 'Source Control' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh changes' })).toBeEnabled());
  return user;
}
const leaseCount = () => useWorkspaceStore.getState().getWorkspaceById('ws')?.browserOverlayCount;

describe('Changes-first workflow', () => {
  it('lands on Changes with identity and unique count, preserves both partially staged entries and does not mutate on review', async () => {
    const user = await open();
    expect(screen.getByRole('button', { name: 'Changes' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText(/2 changed files/)).toHaveTextContent('/repo');
    expect(within(screen.getByRole('region', { name: 'Staged changes' })).getByText('partial.ts')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Unstaged changes' })).getByText('partial.ts')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'View working diff for partial.ts' }));
    expect(api.gitGetFileDiff).toHaveBeenCalledWith('/repo', 'partial.ts', 'working', 'ws');
    const viewer = await screen.findByRole('dialog', { name: 'partial.ts' });
    expect(viewer).toHaveTextContent('HEAD content'); expect(viewer).toHaveTextContent('agent modification');
    expect(screen.queryByRole('dialog', { name: 'Create Commit' })).toBeNull();
    expect(api.gitStage).not.toHaveBeenCalled(); expect(api.gitCommit).not.toHaveBeenCalled();
    expect(leaseCount()).toBe(2);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'partial.ts' })).toBeNull();
    expect(leaseCount()).toBe(1);
    expect(screen.getByRole('button', { name: 'View working diff for partial.ts' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'View staged diff for partial.ts' }));
    expect(api.gitGetFileDiff).toHaveBeenLastCalledWith('/repo', 'partial.ts', 'staged', 'ws');
    await user.keyboard('{Escape}'); await user.keyboard('{Escape}');
    expect(leaseCount()).toBe(0); expect(screen.getByRole('button', { name: 'Source Control' })).toHaveFocus();
  });

  it('stages and unstages paths and all files through the owner and refreshes canonical state', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Stage partial.ts' }));
    expect(api.gitStage).toHaveBeenCalledWith('/repo', ['partial.ts'], 'ws');
    expect(screen.queryByRole('button', { name: 'View working diff for partial.ts' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Unstage partial.ts' }));
    expect(api.gitUnstage).toHaveBeenCalledWith('/repo', ['partial.ts'], 'ws');
    expect(screen.queryByRole('button', { name: 'View staged diff for partial.ts' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Stage All' }));
    expect(api.gitStage).toHaveBeenLastCalledWith('/repo', undefined, 'ws');
    expect(screen.getByRole('heading', { name: 'Staged changes (2)' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Unstage All' }));
    expect(api.gitUnstage).toHaveBeenLastCalledWith('/repo', undefined, 'ws');
    expect(screen.getByRole('heading', { name: 'Unstaged changes (2)' })).toBeVisible();
    expect(postMutationStatus).toHaveBeenCalledTimes(4); expect(api.gitRefresh).not.toHaveBeenCalled(); expect(api.gitStartPolling).toHaveBeenCalledTimes(1);
  });

  it('blocks duplicate mutations and navigation, reports failure without optimistic success, and retries', async () => {
    let finish!: (value: unknown) => void;
    api.gitStage.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Stage new.ts' }));
    expect(screen.getByRole('button', { name: 'Stage All' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'History' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Stage new.ts' }));
    expect(api.gitStage).toHaveBeenCalledTimes(1);
    await act(async () => finish({ success: false, error: 'Index locked' }));
    expect(await screen.findByText('Index locked')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Stage new.ts' })).toBeEnabled();
    expect(api.gitRefresh).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Stage new.ts' }));
    expect(screen.getByRole('button', { name: 'Unstage new.ts' })).toBeEnabled();
  });

  it('commits only staged files, keeps unstaged files and restores Changes and focus without dropping its Browser lease', async () => {
    const user = await open();
    const counts: number[] = []; const off = useWorkspaceStore.subscribe(() => counts.push(leaseCount() ?? 0));
    await user.type(screen.getByRole('textbox', { name: 'Commit Message' }), 'reviewed staged work');
    await user.click(screen.getByRole('button', { name: 'Commit Staged' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Commit Message' })).toHaveValue(''));
    expect(screen.queryByRole('dialog', { name: 'Create Commit' })).toBeNull();
    expect(leaseCount()).toBe(1);
    expect(api.gitStage).not.toHaveBeenCalled(); expect(api.gitCommit).toHaveBeenCalledWith('/repo', 'reviewed staged work', 'ws');
    expect(screen.getByRole('heading', { name: 'Unstaged changes (2)' })).toBeVisible();
    expect(counts.every((count) => count === 1)).toBe(true); off();
    expect(screen.getByRole('textbox', { name: 'Commit Message' })).toHaveFocus();
  });

  it('stage-all convenience is explicit, respects staging failure and commits only after successful staging', async () => {
    const user = await open();
    const commit = screen.getByRole('form', { name: 'Commit changes' });
    await user.type(within(commit).getByRole('textbox'), 'all work');
    api.gitStage.mockResolvedValueOnce({ success: false, error: 'Staging denied' });
    await user.click(within(commit).getByRole('button', { name: 'Stage All & Commit' }));
    expect(within(commit).getByText('Staging denied')).toBeVisible();
    expect(api.gitCommit).not.toHaveBeenCalled();
    await user.click(within(commit).getByRole('button', { name: 'Stage All & Commit' }));
    await waitFor(() => expect(api.gitCommit).toHaveBeenCalledWith('/repo', 'all work', 'ws'));
    expect(api.gitStage).toHaveBeenLastCalledWith('/repo', undefined, 'ws');
    await waitFor(() => expect(screen.getByText('Working directory is clean')).toBeVisible());
    expect(screen.getByRole('button', { name: 'Stage All & Commit' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Commit Message' })).toHaveFocus());
  });

  it('keeps failed commits recoverable and allows refresh recovery after a status failure', async () => {
    const user = await open();
    const commit = screen.getByRole('form', { name: 'Commit changes' });
    api.gitCommit.mockResolvedValueOnce({ success: false, error: 'Hook rejected commit' });
    await user.type(within(commit).getByRole('textbox'), 'retry work');
    await user.click(within(commit).getByRole('button', { name: 'Commit Staged' }));
    expect(within(commit).getByText('Hook rejected commit')).toBeVisible();
    expect(within(commit).getByRole('textbox')).toHaveValue('retry work');
    api.gitRefresh.mockRejectedValueOnce(new Error('Connection unavailable'));
    await user.click(screen.getByRole('button', { name: 'Refresh changes' }));
    expect(screen.getByText('Connection unavailable')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Refresh changes' }));
    expect(screen.queryByText('Connection unavailable')).toBeNull();
  });

  it('retains one scope-local draft across History, Overview, Review Changes, staging and close/reopen', async () => {
    const user = await open();
    await user.type(screen.getByRole('textbox', { name: 'Commit Message' }), 'unfinished work');
    await user.click(screen.getByRole('button', { name: 'History' }));
    await user.click(screen.getByRole('button', { name: 'Overview' }));
    await user.click(screen.getByRole('button', { name: 'Review Changes' }));
    expect(screen.getAllByRole('textbox', { name: 'Commit Message' })).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Commit Message' })).toHaveValue('unfinished work');
    await user.click(screen.getByRole('button', { name: 'Stage new.ts' }));
    expect(screen.getByRole('textbox', { name: 'Commit Message' })).toHaveValue('unfinished work');
    await user.keyboard('{Escape}'); await user.click(screen.getByRole('button', { name: 'Source Control' }));
    expect(screen.getByRole('textbox', { name: 'Commit Message' })).toHaveValue('unfinished work');
    act(() => useWorkspaceStore.setState({ activeWorkspaceId: null }));
    act(() => useWorkspaceStore.setState({ activeWorkspaceId: 'ws' }));
    await user.click(screen.getByRole('button', { name: 'Source Control' }));
    expect(screen.getByRole('textbox', { name: 'Commit Message' })).toHaveValue('');
  });

  it('keeps inference alive across page navigation without stealing focus and protects drafts on edits/status changes', async () => {
    api.getAiCommitSettings.mockResolvedValue({ enabled: true, provider: 'codex', model: 'configured' });
    let finish!: (value: unknown) => void;
    api.generateCommitMessage.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const user = await open();
    await user.click(await screen.findByRole('button', { name: 'Generate' }));
    await user.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByRole('button', { name: 'History' })).toHaveFocus();
    await act(async () => finish({ success: true, message: 'feat: agent review' }));
    expect(screen.getByRole('button', { name: 'History' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Changes' }));
    expect(screen.getByRole('textbox')).toHaveValue('feat: agent review');
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    await user.type(screen.getByRole('textbox'), ' edited');
    await act(async () => finish({ success: true, message: 'old result' }));
    expect(screen.getByRole('textbox')).toHaveValue('feat: agent review edited');
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    await user.click(screen.getByRole('button', { name: 'Unstage partial.ts' }));
    await act(async () => finish({ success: true, message: 'old change snapshot' }));
    expect(screen.getByText('Changes updated during generation. Generate the message again.')).toBeVisible();
    expect(screen.getByRole('textbox')).toHaveValue('feat: agent review edited');
  });

  it('does not advertise known counts or allow submission after a status failure, and retains the draft for recovery', async () => {
    const user = await open(); await user.type(screen.getByRole('textbox'), 'keep me');
    api.gitRefresh.mockRejectedValue(new Error('Status unavailable'));
    await user.click(screen.getByRole('button', { name: 'Refresh changes' }));
    expect(await screen.findByText('Change counts unavailable')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Commit Staged' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stage All & Commit' })).toBeDisabled();
    api.gitRefresh.mockImplementation(async () => structuredClone(status));
    await user.click(screen.getByRole('button', { name: 'Refresh changes' }));
    expect(screen.getByRole('textbox')).toHaveValue('keep me');
    expect(screen.getByRole('button', { name: 'Commit Staged' })).toBeEnabled();
  });

  it('preserves unstage failures, status badges and explicit diff affordances', async () => {
    status.changes = [{ path: 'a.ts', status: 'added', staged: true }, { path: 'd.ts', status: 'deleted', staged: false },
      { path: 'r.ts', status: 'renamed', staged: true }, { path: 'new.ts', status: 'untracked', staged: false }];
    api.gitUnstage.mockResolvedValueOnce({ success: false, error: 'Unstage denied' });
    const user = await open();
    for (const badge of ['A', 'D', 'R', '??']) expect(screen.getByText(badge)).toBeVisible();
    expect(screen.getByRole('button', { name: 'View staged diff for a.ts' })).toHaveAttribute('title', 'View Diff · HEAD to index');
    expect(screen.getByRole('button', { name: 'Review working changes for d.ts' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Unstage a.ts' }));
    expect(screen.getByText('Unstage denied')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Unstage a.ts' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Unstage All' }));
    expect(screen.getByRole('heading', { name: 'Staged changes (0)' })).toBeVisible();
  });

  it('serializes the complete stage-all/commit sequence and guards dismissal/submission throughout native hooks', async () => {
    let finishStage!: (value: unknown) => void; let finishCommit!: (value: unknown) => void;
    api.gitStage.mockReturnValueOnce(new Promise((resolve) => { finishStage = resolve; }));
    api.gitCommit.mockReturnValueOnce(new Promise((resolve) => { finishCommit = resolve; }));
    const user = await open();
    await user.type(screen.getByRole('textbox'), 'explicit all');
    await user.click(screen.getByRole('button', { name: 'Stage All & Commit' }));
    expect(screen.getByText('Staging changes…')).toBeVisible();
    expect(screen.getByRole('button', { name: 'History' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close Source Control' })).toBeDisabled();
    await user.keyboard('{Escape}'); expect(screen.getByRole('dialog', { name: 'Source Control' })).toBeVisible();
    await act(async () => finishStage({ success: true }));
    expect(screen.getByText('Running git hooks…')).toBeVisible();
    expect(screen.getByRole('button', { name: 'View working diff for partial.ts' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stage All' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Commit Staged' }));
    expect(api.gitCommit).toHaveBeenCalledTimes(1);
    await act(async () => finishCommit({ success: false, error: 'Hooks rejected' }));
    expect(screen.getByText('Staging succeeded, but commit failed: Hooks rejected')).toBeVisible();
    expect(screen.getByRole('textbox')).toHaveValue('explicit all');
    expect(screen.getByRole('button', { name: 'History' })).toBeEnabled();
  });

  it('correctly distinguishes commit success with refresh failure, settles the draft and requires refresh', async () => {
    api.gitCommit.mockResolvedValueOnce({ success: true });
    postMutationStatus.mockRejectedValueOnce(new Error('Network glitch'));
    const user = await open();
    await user.type(screen.getByRole('textbox'), 'feat: committed changes');
    await user.click(screen.getByRole('button', { name: 'Commit Staged' }));

    // Commit succeeded: draft is settled/cleared, so it cannot accidentally be resubmitted
    expect(screen.getByRole('textbox')).toHaveValue('');
    // Refresh failed: status is marked unavailable, warning that commit succeeded but status failed
    expect(await screen.findByText(/Refresh changes to update repository status/)).toBeVisible();
    expect(screen.getByText('Change counts unavailable')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Commit Staged' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stage All & Commit' })).toBeDisabled();

    // User can recover by clicking Refresh changes
    api.gitRefresh.mockImplementationOnce(async () => ({ ...status, changes: [] }));
    await user.click(screen.getByRole('button', { name: 'Refresh changes' }));
    expect(await screen.findByText('0 staged · 0 unstaged entries')).toBeVisible();
    expect(screen.getByText('Working directory is clean')).toBeVisible();
  });

  it('operates directly on a selected isolated worktree with checkout-specific staging, diff, commit and polling', async () => {
    const mainCtx = { id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: '/repo', kind: 'main' as const };
    const worktreeCtx = { id: 'ws::ckt-feat', workspaceId: 'ws', environmentId: 'local', path: '/repo-worktrees/feat', kind: 'worktree' as const, branch: 'feat' };
    const worktreeStatus: GitStatusResult = {
      success: true, isRepo: true, workspaceId: 'ws', checkoutContextId: 'ws::ckt-feat',
      workspacePath: '/repo-worktrees/feat', environmentId: 'local', currentBranch: 'feat',
      isDetached: false, upstream: null, ahead: 0, behind: 0,
      changes: [{ path: 'feat.ts', status: 'modified', staged: false }],
    };
    useWorkspaceStore.setState({
      activeWorkspaceId: 'ws',
      workspaces: [createWorkspaceFixture({
        id: 'ws',
        workspacePath: '/repo',
        environmentId: 'local',
        activeTerminalId: 'term-agent',
        terminals: [createTerminalFixture({ id: 'term-agent', checkoutContextId: 'ws::ckt-feat' })],
        checkoutContexts: [mainCtx, worktreeCtx],
      })],
    });
    api.onGitStatusUpdate.mockImplementation((callback) => { callback(worktreeStatus); return vi.fn(); });
    api.gitRefresh.mockResolvedValue(worktreeStatus);
    postMutationStatus.mockResolvedValue(worktreeStatus);

    const user = userEvent.setup();
    render(<GitButton workspacePath="/repo" workspaceId="ws" />);
    await user.click(screen.getByRole('button', { name: 'Source Control' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh changes' })).toBeEnabled());

    expect(screen.getByText(/repo-worktrees\/feat/)).toBeVisible();
    expect(screen.getByText('feat.ts')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Stage feat.ts' }));
    expect(api.gitStage).toHaveBeenCalledWith('/repo-worktrees/feat', ['feat.ts'], 'ws', 'ws::ckt-feat');

    await user.click(screen.getByRole('button', { name: 'View working diff for feat.ts' }));
    expect(api.gitGetFileDiff).toHaveBeenCalledWith('/repo-worktrees/feat', 'feat.ts', 'working', 'ws', 'ws::ckt-feat');
  });

  it.each(['workspace', 'checkout', 'environment'])('never dispatches commit after stage-all completes in an old %s scope', async (change) => {
    let finish!: (value: unknown) => void;
    api.gitStage.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = await open(); await user.type(screen.getByRole('textbox'), 'scope bound');
    await user.click(screen.getByRole('button', { name: 'Stage All & Commit' }));
    act(() => useWorkspaceStore.setState((state) => change === 'workspace' ? { activeWorkspaceId: null } : { workspaces: state.workspaces.map((entry) => change === 'environment' ? { ...entry, environmentId: 'ssh-other' } : { ...entry, fileSurfaceContextId: 'unregistered' }) }));
    await act(async () => finish({ success: true }));
    expect(api.gitCommit).not.toHaveBeenCalled(); expect(api.gitRefresh).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(['workspace', 'checkout', 'environment'])('discards a pending native commit after a %s change without refreshing another repository', async (change) => {
    let finish!: (value: unknown) => void;
    api.gitCommit.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = await open(); await user.type(screen.getByRole('textbox'), 'staged only');
    await user.click(screen.getByRole('button', { name: 'Commit Staged' }));
    act(() => useWorkspaceStore.setState((state) => change === 'workspace' ? { activeWorkspaceId: null } : { workspaces: state.workspaces.map((entry) => change === 'environment' ? { ...entry, environmentId: 'ssh-other' } : { ...entry, fileSurfaceContextId: 'unregistered' }) }));
    await act(async () => finish({ success: true }));
    expect(api.gitCommit).toHaveBeenCalledTimes(1);
    expect(api.gitCommit).toHaveBeenCalledWith('/repo', 'staged only', 'ws');
    expect(api.gitStage).not.toHaveBeenCalled(); expect(api.gitRefresh).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(['workspace', 'checkout', 'environment'])('does not refresh or retarget a pending staging mutation after a %s change', async (change) => {
    let finish!: (value: unknown) => void;
    api.gitStage.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = await open(); await user.click(screen.getByRole('button', { name: 'Stage new.ts' }));
    act(() => useWorkspaceStore.setState((state) => change === 'workspace' ? { activeWorkspaceId: null } : { workspaces: state.workspaces.map((entry) => change === 'environment' ? { ...entry, environmentId: 'ssh-other' } : { ...entry, fileSurfaceContextId: 'unregistered' }) }));
    await act(async () => finish({ success: true }));
    expect(api.gitRefresh).not.toHaveBeenCalled(); expect(api.gitStage).toHaveBeenCalledTimes(1);
    expect(api.gitStage).toHaveBeenCalledWith('/repo', ['new.ts'], 'ws');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows loading and unavailable status without a false clean state and permits a status retry', async () => {
    const user = await open();
    let finish!: (value: unknown) => void;
    api.gitRefresh.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await user.click(screen.getByRole('button', { name: 'Refresh changes' }));
    expect(screen.getByText('Loading changes…')).toBeVisible();
    await act(async () => finish({ ...status, success: false, error: 'Status unavailable' }));
    expect(screen.getByText('Status unavailable')).toBeVisible();
    expect(screen.queryByText('Working directory is clean')).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh changes' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Refresh changes' }));
    expect(screen.getByRole('button', { name: 'Stage new.ts' })).toBeEnabled();
  });

  it.each(['binary', 'deleted', 'new'])('uses the existing %s file viewer semantics', async (kind) => {
    api.gitGetFileDiff.mockResolvedValue({ success: true, oldContent: kind === 'new' ? '' : 'original content',
      newContent: kind === 'deleted' ? '' : 'new content', oldPath: 'new.ts', newPath: 'new.ts', isBinary: kind === 'binary', hasDiff: true });
    const user = await open(); await user.click(screen.getByRole('button', { name: 'View working diff for new.ts' }));
    const viewer = await screen.findByRole('dialog', { name: 'new.ts' });
    expect(viewer).toHaveTextContent(kind === 'binary' ? 'Binary file — diff not shown' : kind === 'deleted' ? 'original content' : 'new content');
  });

  it.each(['workspace', 'checkout', 'environment'])('rejects pending file content and never retargets after a %s change', async (change) => {
    let finish!: (value: unknown) => void;
    api.gitGetFileDiff.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = await open(); await user.click(screen.getByRole('button', { name: 'View working diff for partial.ts' }));
    act(() => useWorkspaceStore.setState((state) => change === 'workspace' ? { activeWorkspaceId: null } : { workspaces: state.workspaces.map((entry) => change === 'environment' ? { ...entry, environmentId: 'ssh-other' } : { ...entry, fileSurfaceContextId: 'unregistered' }) }));
    await act(async () => finish({ success: true, oldContent: 'wrong checkout', newContent: 'late agent content', hasDiff: true }));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByText('late agent content')).toBeNull();
    expect(api.gitStage).not.toHaveBeenCalled(); expect(leaseCount()).toBe(0);
  });
});
