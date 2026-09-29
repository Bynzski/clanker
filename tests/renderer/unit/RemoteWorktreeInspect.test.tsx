// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RemoteWorktreeInspect from '../../../src/renderer/components/RemoteWorktreeInspect';
import { installElectronApiMock } from '../../setup/electron';
import type { GitWorktreeInspectionResult } from '../../../src/shared/types/git';

describe('remote worktree inspection', () => {
  let api: ReturnType<typeof installElectronApiMock>;
  const props = { workspaceId: 'ssh-repo', workspacePath: '/srv/repo', worktreePath: '/srv/task', disabled: false };
  const worktree = { path: '/srv/task', branch: 'task', isMain: false, isLocked: false, isPrunable: false };
  beforeEach(() => { vi.clearAllMocks(); api = installElectronApiMock(); });
  it.each([false, true])('shows inspection results without offering deletion: hasChanges=%s', async (hasChanges) => {
    api.gitInspectWorktree.mockResolvedValue({ success: true, worktree, hasChanges });
    render(<RemoteWorktreeInspect {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect /srv/task' }));
    expect(await screen.findByRole('status')).toHaveTextContent(hasChanges ? 'uncommitted, untracked, or ignored' : 'Checkout is clean');
    expect(api.gitInspectWorktree).toHaveBeenCalledWith('/srv/repo', '/srv/task', [], 'ssh-repo');
    expect(api.gitRemoveWorktree).not.toHaveBeenCalled();
  });
  it('shows failures and permits retry', async () => {
    api.gitInspectWorktree.mockRejectedValueOnce(new Error('SSH disconnected')).mockResolvedValue({ success: true, worktree, hasChanges: false });
    render(<RemoteWorktreeInspect {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect /srv/task' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('SSH disconnected');
    fireEvent.click(screen.getByRole('button', { name: 'Inspect /srv/task' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Checkout is clean');
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('ignores late responses after the source changes and blocks overlapping requests', async () => {
    let resolve!: (result: GitWorktreeInspectionResult) => void;
    api.gitInspectWorktree.mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = render(<RemoteWorktreeInspect key="source" {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect /srv/task' }));
    expect(screen.getByRole('button', { name: 'Inspect /srv/task' })).toBeDisabled();
    view.rerender(<RemoteWorktreeInspect key="other" {...props} workspaceId="other" />);
    await act(async () => resolve({ success: true, worktree, hasChanges: false }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(api.gitInspectWorktree).toHaveBeenCalledTimes(1);
  });
});
