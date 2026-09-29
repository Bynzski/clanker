// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RemoteWorktreeCreate from '../../../src/renderer/components/RemoteWorktreeCreate';
import { installElectronApiMock } from '../../setup/electron';
import type { GitWorktreeCreateResult } from '../../../src/shared/types/git';

describe('remote worktree creation form', () => {
  let api: ReturnType<typeof installElectronApiMock>;
  const open = vi.fn();
  const busy = vi.fn();
  const props = { workspaceId: 'ssh-repo', workspacePath: '/srv/repo', launchReady: true, onBusyChange: busy, onOpenPath: open };
  beforeEach(() => { vi.clearAllMocks(); api = installElectronApiMock(); });
  const fill = () => fireEvent.change(screen.getByLabelText('Worktree branch'), { target: { value: 'task' } });
  it('creates through the registered identity and opens the returned remote path', async () => {
    api.gitCreateWorktree.mockResolvedValue({ success: true, worktree: { path: '/srv/repo-worktrees/task', branch: 'task', isMain: false, isLocked: false, isPrunable: false } });
    render(<RemoteWorktreeCreate {...props} />); fill();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Create and open worktree' })));
    expect(api.gitCreateWorktree).toHaveBeenCalledWith('/srv/repo', 'HEAD', 'task', 'ssh-repo');
    expect(open).toHaveBeenCalledWith('/srv/repo-worktrees/task');
    expect(busy.mock.calls).toEqual([[true], [false]]);
  });
  it('shows failures without opening a fallback path', async () => {
    api.gitCreateWorktree.mockResolvedValue({ success: false, error: 'Destination already exists' });
    render(<RemoteWorktreeCreate {...props} />); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create and open worktree' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Destination already exists');
    expect(open).not.toHaveBeenCalled();
  });
  it('does not open a late result after the source closes and prevents duplicate submissions', async () => {
    let resolve!: (value: GitWorktreeCreateResult) => void;
    api.gitCreateWorktree.mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = render(<RemoteWorktreeCreate {...props} />); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create and open worktree' }));
    expect(screen.getByRole('button', { name: 'Creating remote worktree…' })).toBeDisabled();
    expect(api.gitCreateWorktree).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => resolve({ success: true, worktree: { path: '/late', branch: 'task', isMain: false, isLocked: false, isPrunable: false } }));
    expect(open).not.toHaveBeenCalled();
    expect(busy).toHaveBeenLastCalledWith(false);
  });
  it('waits for harness discovery', () => {
    render(<RemoteWorktreeCreate {...props} launchReady={false} />); fill();
    expect(screen.getByRole('button', { name: 'Create and open worktree' })).toBeDisabled();
  });
});
