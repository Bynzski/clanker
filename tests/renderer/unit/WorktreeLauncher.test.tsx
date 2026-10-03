// @vitest-environment jsdom
//
// WorktreeLauncher is no longer reachable from the startup launcher. It is kept as a self-contained
// component (existing-checkout management), so its behavior is pinned directly here; these cases
// used to be exercised through the launcher's Worktree view.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import WorktreeLauncher from '../../../src/renderer/components/WorktreeLauncher';
import { installElectronApiMock } from '../../setup/electron';

const checkout = (overrides: Partial<{ path: string; branch: string | null; isPrunable: boolean }> = {}) => ({
  path: '/repo-worktrees/task', branch: 'task', isMain: false, isLocked: false, isPrunable: false, ...overrides,
});

describe('WorktreeLauncher', () => {
  const onOpenPath = vi.fn();
  let api: ReturnType<typeof installElectronApiMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    api = installElectronApiMock({
      gitGetBranchState: vi.fn().mockResolvedValue({ success: true, isRepo: true, currentBranch: 'main', isDetached: false, branches: [{ name: 'main', isCurrent: true }] }),
      gitListWorktrees: vi.fn().mockResolvedValue({ success: true, worktrees: [] }),
    });
  });

  const show = (props: Partial<{ launchReady: boolean; openPaths: string[] }> = {}) =>
    render(<WorktreeLauncher repoPath="/repo/" openPaths={props.openPaths ?? []} launchReady={props.launchReady ?? true} onOpenPath={onOpenPath} />);

  it('creates a task worktree, without a workspace id, before opening its checkout', async () => {
    api.gitCreateWorktree.mockResolvedValue({ success: true, worktree: checkout() });
    show();
    fireEvent.click(screen.getByText('Load repository'));
    await screen.findByText('Task branch');
    fireEvent.change(screen.getByLabelText('Task branch'), { target: { value: 'task' } });
    fireEvent.click(screen.getByText('Create and open worktree'));

    // The legacy flow passes no workspace id and no attach option, so it can never attach a context.
    await waitFor(() => expect(api.gitCreateWorktree).toHaveBeenCalledExactlyOnceWith('/repo/', 'main', 'task'));
    expect(onOpenPath).toHaveBeenCalledWith('/repo-worktrees/task');
  });

  it('opens an existing worktree and requires inspection before removal', async () => {
    const worktree = checkout({ path: '/repo-worktrees/task-5f66ef4178e31b5f4a9b' });
    api.gitListWorktrees.mockResolvedValue({ success: true, worktrees: [worktree] });
    api.gitInspectWorktree.mockResolvedValue({ success: true, worktree, hasChanges: false });
    api.gitRemoveWorktree.mockResolvedValue({ success: true });
    show();
    fireEvent.click(screen.getByText('Load repository'));

    const identity = await screen.findByTitle(worktree.path);
    expect(identity).toHaveTextContent('repo');
    expect(identity).toHaveTextContent('task');
    expect(identity).not.toHaveTextContent('5f66ef4178e31b5f4a9b');
    fireEvent.click(screen.getByText('Open'));
    expect(onOpenPath).toHaveBeenCalledWith(worktree.path);
    fireEvent.click(screen.getByText('Remove…'));
    await screen.findByText(/Remove checkout at/);
    expect(api.gitRemoveWorktree).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Remove this worktree'));
    await waitFor(() => expect(api.gitRemoveWorktree).toHaveBeenCalledWith('/repo/', worktree.path, 'task', []));
  });

  it('does not open a prunable worktree whose checkout is missing', async () => {
    const worktree = checkout({ path: '/repo-worktrees/missing', branch: 'missing', isPrunable: true });
    api.gitListWorktrees.mockResolvedValue({ success: true, worktrees: [worktree] });
    show();
    fireEvent.click(screen.getByText('Load repository'));

    expect(await screen.findByTitle(worktree.path)).toHaveTextContent('missing');
    const open = screen.getByRole('button', { name: 'Open' });
    expect(open).toBeDisabled();
    fireEvent.click(open);
    expect(onOpenPath).not.toHaveBeenCalled();
  });

  it('with no launch plan still allows removal but blocks creating and opening', async () => {
    const worktree = checkout();
    api.gitListWorktrees.mockResolvedValue({ success: true, worktrees: [worktree] });
    api.gitInspectWorktree.mockResolvedValue({ success: true, worktree, hasChanges: false });
    api.gitRemoveWorktree.mockResolvedValue({ success: true });
    show({ launchReady: false });
    fireEvent.click(screen.getByRole('button', { name: 'Load repository' }));
    await screen.findByLabelText('Task branch');
    fireEvent.change(screen.getByLabelText('Task branch'), { target: { value: 'new-task' } });
    const create = screen.getByRole('button', { name: 'Create and open worktree' });
    const open = screen.getByRole('button', { name: 'Open' });

    expect(create).toBeDisabled();
    expect(open).toBeDisabled();
    fireEvent.click(create);
    fireEvent.click(open);
    expect(api.gitCreateWorktree).not.toHaveBeenCalled();
    expect(onOpenPath).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove…' }));
    await screen.findByRole('dialog', { name: 'Confirm worktree removal' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove this worktree' }));
    await waitFor(() => expect(api.gitRemoveWorktree).toHaveBeenCalledWith('/repo/', worktree.path, 'task', []));
  });

  it('refuses a directory that is not a Git repository', async () => {
    api.gitGetBranchState.mockResolvedValue({ success: true, isRepo: false, currentBranch: '', isDetached: false, branches: [] });
    show();
    fireEvent.click(screen.getByText('Load repository'));
    expect(await screen.findByText(/Choose a Git repository/)).toBeTruthy();
    expect(screen.queryByLabelText('Task branch')).toBeNull();
  });
});
