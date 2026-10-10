import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GitButton from '../../../src/renderer/components/GitButton';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import type { GitStatusResult } from '../../../src/shared/types/git';

let api: ReturnType<typeof installElectronApiMock>;
let status: GitStatusResult;
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
    expect(api.gitRefresh).toHaveBeenCalledTimes(4); expect(api.gitStartPolling).toHaveBeenCalledTimes(1);
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
    await user.click(screen.getByRole('button', { name: 'Commit Staged' }));
    const commit = await screen.findByRole('dialog', { name: 'Create Commit' });
    expect(leaseCount()).toBe(2);
    await user.type(within(commit).getByRole('textbox', { name: 'Commit Message' }), 'reviewed staged work');
    await user.click(within(commit).getByRole('button', { name: 'Commit Staged' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Create Commit' })).toBeNull());
    expect(api.gitStage).not.toHaveBeenCalled(); expect(api.gitCommit).toHaveBeenCalledWith('/repo', 'reviewed staged work', 'ws');
    expect(screen.getByRole('heading', { name: 'Unstaged changes (2)' })).toBeVisible();
    expect(Math.min(...counts)).toBe(1); off();
    // The initiating button remains the focus target, even when its label changes.
    expect(screen.getByRole('button', { name: 'Stage All & Commit' })).toHaveFocus();
  });

  it('stage-all convenience is explicit, respects staging failure and commits only after successful staging', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Commit Staged' }));
    const commit = screen.getByRole('dialog', { name: 'Create Commit' });
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
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Changes' })).toHaveFocus());
  });

  it('keeps failed commits recoverable and allows refresh recovery after a status failure', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Commit Staged' }));
    const commit = screen.getByRole('dialog', { name: 'Create Commit' });
    api.gitCommit.mockResolvedValueOnce({ success: false, error: 'Hook rejected commit' });
    await user.type(within(commit).getByRole('textbox'), 'retry work');
    await user.click(within(commit).getByRole('button', { name: 'Commit Staged' }));
    expect(within(commit).getByText('Hook rejected commit')).toBeVisible();
    expect(within(commit).getByRole('textbox')).toHaveValue('retry work');
    await user.keyboard('{Escape}');
    api.gitRefresh.mockRejectedValueOnce(new Error('Connection unavailable'));
    await user.click(screen.getByRole('button', { name: 'Refresh changes' }));
    expect(screen.getByText('Connection unavailable')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Refresh changes' }));
    expect(screen.queryByText('Connection unavailable')).toBeNull();
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
