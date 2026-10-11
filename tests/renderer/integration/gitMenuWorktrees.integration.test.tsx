// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GitButton from '../../../src/renderer/components/GitButton';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import type { GitWorktree } from '../../../src/shared/types/git';

const ROOT = '/projects/app';
const listed = (path: string, branch: string | null, extra: Partial<GitWorktree> = {}): GitWorktree =>
  ({ path, branch, isMain: false, isLocked: false, isPrunable: false, ...extra });
const MAIN_ENTRY = listed(ROOT, 'main', { isMain: true });
const OLD_TASK = listed('/projects/app-worktrees/old-task', 'old-task');

/** The real ownership chain: GitButton -> GitRepoMenu -> GitWorktreesSection -> ConfirmCloseDialog (portal). */
describe('Git menu worktree management (real GitButton ownership)', () => {
  const user = userEvent.setup();
  let api: ReturnType<typeof installElectronApiMock>;
  let remaining: GitWorktree[];
  let removeResult: { success: boolean; error?: string };

  beforeEach(() => {
    remaining = [MAIN_ENTRY, OLD_TASK];
    removeResult = { success: true };
    api = installElectronApiMock({
      gitGetBranchState: vi.fn().mockResolvedValue({ success: true, isRepo: true, currentBranch: 'main', isDetached: false, branches: [{ name: 'main', isCurrent: true }] }),
      gitGetOperationState: vi.fn().mockResolvedValue({ success: true, isRepo: true, inProgress: false, mode: 'none', conflicts: [], message: '' }),
      gitGetStashes: vi.fn().mockResolvedValue([]),
      gitGetHistory: vi.fn().mockResolvedValue([]),
      gitGetRemotes: vi.fn().mockResolvedValue({ success: true, remotes: [], provider: 'unknown' }),
      onGitStatusUpdate: vi.fn((cb: (s: unknown) => void) => {
        cb({ success: true, isRepo: true, workspaceId: 'ws', currentBranch: 'main', isDetached: false, changes: [], upstream: null, ahead: 0, behind: 0 });
        return () => undefined;
      }),
      gitListWorktrees: vi.fn().mockImplementation(async () => ({ success: true, worktrees: remaining })),
      gitInspectWorktree: vi.fn().mockImplementation(async (_r: string, path: string) => ({ success: true, hasChanges: false, worktree: remaining.find((e) => e.path === path) })),
      gitRemoveWorktree: vi.fn().mockImplementation(async (_r: string, path: string) => {
        if (removeResult.success) remaining = remaining.filter((e) => e.path !== path);
        return removeResult;
      }),
    });
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, activeWorkspaceLifecycle: null, terminals: [], panes: [], activeTerminalId: null });
    const { id: _id, lifecycle: _l, ...input } = createWorkspaceFixture({ workspacePath: ROOT, gitIsRepo: true, terminals: [], panes: [] });
    void _id; void _l;
    useWorkspaceStore.getState().addWorkspace({ ...input, id: 'ws' });
    useWorkspaceStore.setState({ activeWorkspaceId: 'ws' });
  });
  afterEach(() => cleanup());

  const openMenu = async (expectedBranch = 'old-task') => {
    render(<GitButton workspacePath={ROOT} workspaceId="ws" />);
    await user.click(await waitFor(() => {
      const button = document.querySelector('.git-btn');
      if (!button) throw new Error('no git button');
      return button as HTMLElement;
    }));
    await user.click(await screen.findByRole('button', { name: 'Worktrees' }));
    await screen.findByText(expectedBranch);
  };
  const clickRemove = async () => {
    await user.click(screen.getByRole('button', { name: 'Remove checkout for branch old-task' }));
    await screen.findByRole('alertdialog');
  };

  it('runs inspect and remove when the portal confirmation is confirmed, and the row leaves the list', async () => {
    await openMenu();
    await clickRemove();
    await user.click(screen.getByRole('button', { name: 'Remove worktree' }));

    await waitFor(() => expect(api.gitRemoveWorktree).toHaveBeenCalledTimes(1));
    expect(api.gitInspectWorktree).toHaveBeenCalledTimes(1);
    expect(api.gitRemoveWorktree.mock.calls[0][1]).toBe(OLD_TASK.path);
    await waitFor(() => expect(screen.queryByText('old-task')).toBeNull());
  });

  it('keeps a refused removal visible with its error', async () => {
    removeResult = { success: false, error: 'Worktree is locked by another process' };
    await openMenu();
    await clickRemove();
    await user.click(screen.getByRole('button', { name: 'Remove worktree' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Worktree is locked by another process');
    expect(screen.getByText('old-task')).toBeTruthy();
  });

  it('Cancel closes the confirmation, keeps the menu open and removes nothing', async () => {
    await openMenu();
    await clickRemove();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByText('old-task')).toBeTruthy();
    expect(api.gitRemoveWorktree).not.toHaveBeenCalled();
  });

  it('still closes the menu on an outside click when no confirmation is active', async () => {
    await openMenu();
    expect(screen.getByRole('dialog', { name: 'Source Control' })).toBeVisible();
    await user.click(document.querySelector('.clanker-dialog-overlay')!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Source Control' })).toBeNull());
  });

  it('keeps the menu open on Escape and outside clicks while the confirmation is open', async () => {
    await openMenu();
    await clickRemove();
    fireEvent.mouseDown(document.body);
    expect(screen.getByRole('dialog', { hidden: true })).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    // Escape dismisses the confirmation only; the menu stays for the user to continue.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Source Control' })).toBeVisible();
  });

  it('forgets only an authoritative unused stale context and does not resurrect it when reopened', async () => {
    const context = { id: 'ws::stale', workspaceId: 'ws', environmentId: 'local', path: '/projects/app-worktrees/stale', kind: 'worktree' as const, branch: 'stale', missing: true };
    useWorkspaceStore.getState().upsertCheckoutContext('ws', context);
    api.reconcileCheckoutContexts.mockResolvedValue({ success: true, contexts: [context], dropped: [] });
    await openMenu();
    await user.click(await screen.findByRole('button', { name: 'Forget stale checkout…' }));
    expect((await screen.findByRole('alertdialog')).textContent).toContain(context.path);
    api.reconcileCheckoutContexts.mockResolvedValue({ success: true, contexts: [], dropped: [context.id] });
    await user.click(screen.getByRole('button', { name: 'Forget checkout' }));
    await waitFor(() => expect(useWorkspaceStore.getState().getWorkspaceById('ws')!.checkoutContexts!.some((entry) => entry.id === context.id)).toBe(false));
    expect(screen.queryByRole('button', { name: 'Forget stale checkout…' })).toBeNull();
    expect(api.gitRemoveWorktree).not.toHaveBeenCalled();
    expect(api.gitPruneWorktrees).not.toHaveBeenCalled();
    expect(api.releaseCheckoutContext).not.toHaveBeenCalled();
    cleanup();
    await openMenu();
    expect(screen.queryByRole('button', { name: 'Forget stale checkout…' })).toBeNull();
  });

  it('keeps a stale checkout visible when main says it is still in use', async () => {
    const context = { id: 'ws::stale', workspaceId: 'ws', environmentId: 'local', path: '/projects/app-worktrees/stale', kind: 'worktree' as const, branch: 'stale', missing: true };
    useWorkspaceStore.getState().upsertCheckoutContext('ws', context);
    api.reconcileCheckoutContexts.mockResolvedValue({ success: true, contexts: [context], dropped: [] });
    await openMenu();
    await user.click(await screen.findByRole('button', { name: 'Forget stale checkout…' }));
    await user.click(await screen.findByRole('button', { name: 'Forget checkout' }));
    expect((await screen.findByRole('alert')).textContent).toContain('still registered');
    expect(useWorkspaceStore.getState().getWorkspaceById('ws')!.checkoutContexts!.some((entry) => entry.id === context.id)).toBe(true);
    expect(api.gitRemoveWorktree).not.toHaveBeenCalled();
  });

  describe('missing worktrees', () => {
    const GONE = listed('/projects/app-worktrees/player', 'player', { isPrunable: true });
    beforeEach(() => {
      remaining = [MAIN_ENTRY, OLD_TASK, GONE];
      api.gitPruneWorktrees.mockImplementation(async () => {
        remaining = remaining.filter((entry) => !entry.isPrunable);
        return { success: true, pruned: [GONE.path] };
      });
    });

    it('offers no row Remove for a Missing checkout, only a section-level prune', async () => {
      await openMenu();
      const row = (await screen.findByText('player')).closest('.git-worktree-item') as HTMLElement;
      expect(within(row).getByText('Missing')).toBeTruthy();
      expect(within(row).queryByRole('button')).toBeNull();
      expect(screen.getByRole('button', { name: 'Remove checkout for branch old-task' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Prune missing worktrees…' })).toBeTruthy();
    });

    it('prunes through scoped Git IPC after confirmation, reloads, and leaves removal APIs untouched', async () => {
      await openMenu();
      await user.click(screen.getByRole('button', { name: 'Prune missing worktrees…' }));
      const dialog = await screen.findByRole('alertdialog');
      expect(dialog.textContent).toContain('all missing-worktree records in this repository');
      expect(dialog.textContent).toContain('No branches or existing directories are deleted');
      await user.click(screen.getByRole('button', { name: 'Prune records' }));

      await waitFor(() => expect(api.gitPruneWorktrees).toHaveBeenCalledExactlyOnceWith(ROOT, 'ws'));
      await waitFor(() => expect(screen.queryByText('player')).toBeNull());
      expect(screen.getByText('old-task')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Prune missing worktrees…' })).toBeNull();
      expect(screen.getByRole('status').textContent).toContain('Pruned 1 stale worktree record');
      expect(api.gitInspectWorktree).not.toHaveBeenCalled();
      expect(api.gitRemoveWorktree).not.toHaveBeenCalled();
    });

    it('Cancel runs nothing, and a failed prune stays visible', async () => {
      await openMenu();
      await user.click(screen.getByRole('button', { name: 'Prune missing worktrees…' }));
      await screen.findByRole('alertdialog');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(api.gitPruneWorktrees).not.toHaveBeenCalled();

      api.gitPruneWorktrees.mockResolvedValueOnce({ success: false, pruned: [], error: 'A worktree removal is in progress' });
      await user.click(screen.getByRole('button', { name: 'Prune missing worktrees…' }));
      await user.click(await screen.findByRole('button', { name: 'Prune records' }));
      expect((await screen.findByRole('alert')).textContent).toContain('A worktree removal is in progress');
      expect(screen.getByText('player')).toBeTruthy();
    });

    it('shows no prune action when nothing is missing', async () => {
      remaining = [MAIN_ENTRY, OLD_TASK];
      await openMenu();
      expect(screen.queryByRole('button', { name: 'Prune missing worktrees…' })).toBeNull();
    });
  });

  describe('locked worktrees', () => {
    const LOCKED = listed('/projects/app-worktrees/external-task', 'external-task', { isLocked: true });
    beforeEach(() => {
      remaining = [MAIN_ENTRY, LOCKED];
      api.gitUnlockWorktree.mockImplementation(async (_repo: string, path: string) => {
        remaining = remaining.map((entry) => (entry.path === path ? { ...entry, isLocked: false } : entry));
        return { success: true };
      });
    });
    const row = async () => (await screen.findByText('external-task')).closest('.git-worktree-item') as HTMLElement;

    it('offers Unlock but no Remove while locked; unlocking reloads and then exposes Remove separately', async () => {
      await openMenu('external-task');
      expect(within(await row()).getByText('Locked')).toBeTruthy();
      expect(within(await row()).queryByRole('button', { name: /Remove checkout/ })).toBeNull();

      await user.click(within(await row()).getByRole('button', { name: 'Unlock checkout for branch external-task' }));
      expect(api.gitUnlockWorktree).not.toHaveBeenCalled();
      expect((await screen.findByRole('alertdialog')).textContent).toContain(LOCKED.path);
      await user.click(screen.getByRole('button', { name: 'Unlock worktree' }));
      await waitFor(() => expect(api.gitUnlockWorktree).toHaveBeenCalledExactlyOnceWith(ROOT, LOCKED.path, 'ws'));
      await waitFor(() => expect(screen.queryByText('Locked')).toBeNull());
      expect(within(await row()).getByText('Unmanaged')).toBeTruthy();
      expect(within(await row()).queryByRole('button', { name: /Unlock/ })).toBeNull();
      // Unlock removed nothing; removal is its own confirmed step.
      expect(api.gitInspectWorktree).not.toHaveBeenCalled();
      expect(api.gitRemoveWorktree).not.toHaveBeenCalled();
      expect(within(await row()).getByRole('button', { name: 'Remove checkout for branch external-task' })).toBeTruthy();
    });

    it('shows the lock reason and Cancel does not unlock', async () => {
      remaining = [MAIN_ENTRY, { ...LOCKED, lockReason: 'external drive' }];
      await openMenu('external-task');
      expect(within(await row()).getByText('Unlock before cleanup · external drive')).toBeTruthy();
      await user.click(within(await row()).getByRole('button', { name: /Unlock checkout/ }));
      expect((await screen.findByRole('alertdialog')).textContent).toContain('external drive');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(api.gitUnlockWorktree).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog', { name: 'Source Control' })).toBeVisible();
    });

    it('keeps a refused unlock visible with its error', async () => {
      api.gitUnlockWorktree.mockResolvedValueOnce({ success: false, error: 'This worktree is not locked' });
      await openMenu('external-task');
      await user.click(within(await row()).getByRole('button', { name: 'Unlock checkout for branch external-task' }));
      await user.click(await screen.findByRole('button', { name: 'Unlock worktree' }));
      expect((await screen.findByRole('alert')).textContent).toContain('This worktree is not locked');
    });

    it('does not hide the lock behind a generic Managed tag', async () => {
      const ctx = { id: 'ws::ckt-ext', workspaceId: 'ws', environmentId: 'local', path: LOCKED.path, kind: 'worktree' as const, branch: 'external-task' };
      useWorkspaceStore.getState().upsertCheckoutContext('ws', ctx);
      await openMenu('external-task');
      expect(within(await row()).getByText('Managed · Locked')).toBeTruthy();
      expect(within(await row()).getByRole('button', { name: /Unlock/ })).toBeTruthy();
      expect(within(await row()).queryByRole('button', { name: /Remove checkout/ })).toBeNull();
    });
  });
});
