import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GateLaunchActions } from '../../../src/renderer/components/gate/GateLaunchActions';

describe('GateLaunchActions', () => {
  it('preserves action names, tooltips and callbacks', async () => {
    const user = userEvent.setup();
    const onLaunch = vi.fn();
    const onWorktree = vi.fn();
    render(<GateLaunchActions launchDisabled={false} worktreeDisabled={false}
      worktreeTitle="Create or open a task worktree" onLaunch={onLaunch} onWorktree={onWorktree} />);
    const launch = screen.getByRole('button', { name: 'Launch Workspace' });
    const worktree = screen.getByRole('button', { name: 'Worktree options' });
    expect(launch).toHaveAttribute('data-variant', 'primary');
    expect(worktree).toHaveAttribute('data-variant', 'secondary');
    expect(worktree).toHaveTextContent('Worktree');
    expect(worktree).toHaveAttribute('title', 'Create or open a task worktree');
    await user.click(launch);
    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onWorktree).not.toHaveBeenCalled();
    await user.click(worktree);
    expect(onWorktree).toHaveBeenCalledTimes(1);
  });

  it.each([[true, false], [false, true], [true, true]])('keeps independent disabled rules (launch %s, worktree %s)', async (launchDisabled, worktreeDisabled) => {
    const user = userEvent.setup();
    const onLaunch = vi.fn();
    const onWorktree = vi.fn();
    render(<GateLaunchActions launchDisabled={launchDisabled} worktreeDisabled={worktreeDisabled}
      worktreeTitle="Choose a Git repository or linked checkout first" onLaunch={onLaunch} onWorktree={onWorktree} />);
    const launch = screen.getByRole('button', { name: 'Launch Workspace' });
    const worktree = screen.getByRole('button', { name: 'Worktree options' });
    expect((launch as HTMLButtonElement).disabled).toBe(launchDisabled);
    expect((worktree as HTMLButtonElement).disabled).toBe(worktreeDisabled);
    await user.click(launch);
    await user.click(worktree);
    expect(onLaunch).toHaveBeenCalledTimes(launchDisabled ? 0 : 1);
    expect(onWorktree).toHaveBeenCalledTimes(worktreeDisabled ? 0 : 1);
  });
});
