import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GateLaunchActions } from '../../../src/renderer/components/gate/GateLaunchActions';

describe('GateLaunchActions', () => {
  it('offers one primary Launch action and nothing about worktrees', async () => {
    const user = userEvent.setup();
    const onLaunch = vi.fn();
    render(<GateLaunchActions launchDisabled={false} onLaunch={onLaunch} />);
    const launch = screen.getByRole('button', { name: 'Launch Workspace' });

    expect(launch).toHaveAttribute('data-variant', 'primary');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByText('Worktree')).toBeNull();
    await user.click(launch);
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])('keeps the disabled rule (launchDisabled %s)', async (launchDisabled) => {
    const user = userEvent.setup();
    const onLaunch = vi.fn();
    render(<GateLaunchActions launchDisabled={launchDisabled} onLaunch={onLaunch} />);
    const launch = screen.getByRole('button', { name: 'Launch Workspace' });

    expect((launch as HTMLButtonElement).disabled).toBe(launchDisabled);
    await user.click(launch);
    expect(onLaunch).toHaveBeenCalledTimes(launchDisabled ? 0 : 1);
  });

  it('shows progress and blocks relaunch while a workspace is opening', async () => {
    const onLaunch = vi.fn();
    render(<GateLaunchActions launchDisabled={false} opening onLaunch={onLaunch} />);
    const launch = screen.getByRole('button', { name: 'Opening workspace…' });

    expect(launch).toBeDisabled();
    expect(launch).toHaveAttribute('aria-busy', 'true');
    await userEvent.setup().click(launch);
    expect(onLaunch).not.toHaveBeenCalled();
  });
});
