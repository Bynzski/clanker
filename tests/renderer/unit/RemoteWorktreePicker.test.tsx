// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import RemoteWorktreePicker from '../../../src/renderer/components/RemoteWorktreePicker';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';
import type { GitWorktreeListResult } from '../../../src/shared/types/git';

describe('remote worktree picker', () => {
  const repository = createWorkspaceFixture({ id: 'repo', environmentId: 'ssh-host', workspacePath: '/srv/repo' });
  const entries = [
    { path: '/srv/repo', branch: 'main', isMain: true, isLocked: false, isPrunable: false },
    { path: '/srv/task', branch: 'task', isMain: false, isLocked: true, isPrunable: false },
    { path: '/srv/missing', branch: null, isMain: false, isLocked: false, isPrunable: true },
  ];
  let api: ReturnType<typeof installElectronApiMock>;
  const open = vi.fn();
  beforeEach(() => { vi.clearAllMocks(); api = installElectronApiMock({ gitListWorktrees: vi.fn().mockResolvedValue({ success: true, worktrees: entries }) }); });
  const show = () => render(<RemoteWorktreePicker repositories={[repository]} preferredWorkspaceId={repository.id} onOpenPath={open} launchReady />);

  it('uses the registered repository, opens locked checkouts, and disables missing ones', async () => {
    show();
    const path = await screen.findByText('/srv/task · Locked');
    expect(api.gitListWorktrees).toHaveBeenCalledWith('/srv/repo', repository.id);
    fireEvent.click(within(path.closest('.gate-worktree-row') as HTMLElement).getByRole('button', { name: 'Open' }));
    expect(open).toHaveBeenCalledWith('/srv/task');
    const missing = screen.getByText('/srv/missing · Missing');
    expect(within(missing.closest('.gate-worktree-row') as HTMLElement).getByRole('button', { name: 'Open' })).toBeDisabled();
    expect(screen.getByText('Create and open worktree')).toBeDisabled();
    expect(screen.queryByText('Remove…')).toBeNull();
  });

  it('ignores late results after switching repositories with the same path', async () => {
    let resolve!: (value: GitWorktreeListResult) => void;
    api.gitListWorktrees.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const other = createWorkspaceFixture({ ...repository, id: 'other' });
    render(<RemoteWorktreePicker repositories={[repository, other]} preferredWorkspaceId={repository.id} onOpenPath={open} launchReady />);
    fireEvent.change(screen.getByLabelText('Open SSH repository'), { target: { value: other.id } });
    await screen.findByText('/srv/task · Locked');
    await act(async () => resolve({ success: true, worktrees: [{ ...entries[1], path: '/stale' }] }));
    expect(screen.queryByText('/stale')).toBeNull();
    expect(api.gitListWorktrees).toHaveBeenLastCalledWith('/srv/repo', other.id);
  });

  it('surfaces discovery errors and permits retry', async () => {
    api.gitListWorktrees.mockResolvedValueOnce({ success: false, worktrees: [], error: 'SSH disconnected' });
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('SSH disconnected');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh worktrees' }));
    await screen.findByText('/srv/task · Locked');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('discards results when the source repository closes', async () => {
    let resolve!: (value: GitWorktreeListResult) => void;
    api.gitListWorktrees.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const view = show();
    view.rerender(<RemoteWorktreePicker repositories={[]} preferredWorkspaceId={null} onOpenPath={open} launchReady />);
    await act(async () => resolve({ success: true, worktrees: entries }));
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
  });

  it('waits for harness discovery before enabling Open', async () => {
    render(<RemoteWorktreePicker repositories={[repository]} preferredWorkspaceId={repository.id} onOpenPath={open} launchReady={false} />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(3));
    expect(screen.getAllByRole('button', { name: 'Open' }).every((button) => button.hasAttribute('disabled'))).toBe(true);
  });
});
