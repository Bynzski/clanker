// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GitWorktreesSection } from '../../../src/renderer/components/git/GitWorktreesSection';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createTerminalFixture, createWorkspaceFixture } from '../../setup/fixtures';
import { mainCheckoutContextId } from '../../../src/shared/checkoutContext';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import type { GitWorktree } from '../../../src/shared/types/git';

const ROOT = '/projects/app';
const listed = (path: string, branch: string | null, extra: Partial<GitWorktree> = {}): GitWorktree =>
  ({ path, branch, isMain: false, isLocked: false, isPrunable: false, ...extra });
const MAIN_ENTRY = listed(ROOT, 'main', { isMain: true });
const MANAGED = listed('/projects/app-worktrees/managed', 'issue-90');
const BUSY = listed('/projects/app-worktrees/busy', 'in-flight');
const UNMANAGED = listed('/projects/app-worktrees/old-task', 'old-task');

const context = (suffix: string, entry: GitWorktree, path = entry.path): CheckoutContext => ({
  id: `ws::ckt-${suffix}`, workspaceId: 'ws', environmentId: 'local', path, kind: 'worktree', branch: entry.branch,
});
const MANAGED_CTX = context('managed', MANAGED);
const BUSY_CTX = context('busy', BUSY);

function openWorkspace(overrides: Parameters<typeof createWorkspaceFixture>[0] = {}) {
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, activeWorkspaceLifecycle: null, terminals: [], panes: [], activeTerminalId: null });
  const { id: _id, lifecycle: _l, ...input } = createWorkspaceFixture({
    workspacePath: ROOT, gitIsRepo: true,
    checkoutContexts: [
      { id: mainCheckoutContextId('ws'), workspaceId: 'ws', environmentId: 'local', path: ROOT, kind: 'main' },
      MANAGED_CTX, BUSY_CTX,
    ],
    terminals: [createTerminalFixture({ id: 't-busy', displayName: 'Delilah', harnessId: 'codex', checkoutContextId: BUSY_CTX.id })],
    panes: [], activeTerminalId: 't-busy',
    ...overrides,
  });
  void _id; void _l;
  useWorkspaceStore.getState().addWorkspace({ ...input, id: 'ws' });
}
const workspace = () => useWorkspaceStore.getState().getWorkspaceById('ws')!;

describe('GitWorktreesSection', () => {
  const user = userEvent.setup();
  let api: ReturnType<typeof installElectronApiMock>;
  let callOrder: string[];
  let remaining: GitWorktree[];

  beforeEach(() => {
    callOrder = [];
    remaining = [MAIN_ENTRY, MANAGED, BUSY, UNMANAGED];
    api = installElectronApiMock({
      gitListWorktrees: vi.fn().mockImplementation(async () => ({ success: true, worktrees: remaining })),
      releaseCheckoutContext: vi.fn().mockImplementation(async () => { callOrder.push('release'); return { success: true }; }),
      gitInspectWorktree: vi.fn().mockImplementation(async (_repo: string, path: string) => {
        callOrder.push('inspect');
        return { success: true, hasChanges: false, worktree: remaining.find((entry) => entry.path === path) };
      }),
      gitRemoveCheckout: vi.fn().mockImplementation(async (_workspaceId: string, path: string) => {
        callOrder.push('remove');
        remaining = remaining.filter((entry) => entry.path !== path);
        return { success: true, reconciliation: { success: true, contexts: [BUSY_CTX], dropped: [MANAGED_CTX.id] } };
      }),
    });
    openWorkspace();
  });
  afterEach(() => cleanup());

  const show = (props: Partial<{ workspaceId: string | undefined; refreshKey: number }> = {}) =>
    render(<GitWorktreesSection workspacePath={ROOT} workspaceId={'workspaceId' in props ? props.workspaceId : 'ws'} refreshKey={props.refreshKey ?? 0} />);
  const rowOf = async (branch: string) => (await screen.findByText(branch)).closest('.git-worktree-item') as HTMLElement;
  const removeButton = async (branch: string) => within(await rowOf(branch)).queryByRole('button', { name: `Remove checkout for branch ${branch}` });
  const confirmRemoval = async () => {
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Remove worktree' }));
  };

  describe('listing', () => {
    it('lists the linked worktrees, never the main checkout, with a count', async () => {
      const { container } = show();
      await rowOf('old-task');

      expect(container.querySelector('.git-menu-count')?.textContent).toBe('3');
      expect(screen.queryByText('main')).toBeNull();
      expect(api.gitListWorktrees).toHaveBeenCalledWith(ROOT, 'ws');
      expect(container.querySelectorAll('.git-worktree-item')).toHaveLength(3);
      expect((await rowOf('old-task')).title).toContain(UNMANAGED.path);
    });

    it('offers nothing that creates a worktree', async () => {
      show();
      await rowOf('old-task');
      expect(screen.queryByRole('button', { name: /create|new worktree|new isolated|add worktree|open as workspace|^open$/i })).toBeNull();
      expect(screen.queryByText(/create|new worktree/i)).toBeNull();
    });

    it('renders nothing when there are no linked worktrees, or no workspace to classify them against', async () => {
      remaining = [MAIN_ENTRY];
      const { container, rerender } = show();
      await waitFor(() => expect(api.gitListWorktrees).toHaveBeenCalled());
      expect(container.querySelector('.git-menu-section')).toBeNull();

      remaining = [MAIN_ENTRY, UNMANAGED];
      rerender(<GitWorktreesSection workspacePath={ROOT} workspaceId={undefined} refreshKey={0} />);
      expect(container.querySelector('.git-menu-section')).toBeNull();
    });

    it('shows a listing failure instead of hiding it', async () => {
      api.gitListWorktrees.mockResolvedValue({ success: false, worktrees: [], error: 'git is unavailable' });
      show();
      expect(await screen.findByText('git is unavailable')).toBeTruthy();
    });

    it('reloads when the menu refreshes, without any loop of its own', async () => {
      const { rerender } = show({ refreshKey: 0 });
      await rowOf('old-task');
      const calls = api.gitListWorktrees.mock.calls.length;

      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(api.gitListWorktrees.mock.calls.length).toBe(calls);

      remaining = [MAIN_ENTRY, UNMANAGED];
      rerender(<GitWorktreesSection workspacePath={ROOT} workspaceId="ws" refreshKey={1} />);
      await waitFor(() => expect(screen.queryByText('issue-90')).toBeNull());
    });
  });

  describe('keeping managed checkouts in line with Git', () => {
    it('asks main to reconcile the workspace\'s checkouts each time the list loads, and applies the answer', async () => {
      api.reconcileCheckoutContexts.mockResolvedValue({ success: true, contexts: [BUSY_CTX], dropped: [MANAGED_CTX.id] });
      const { rerender } = show({ refreshKey: 0 });
      await rowOf('old-task');
      await waitFor(() => expect(api.reconcileCheckoutContexts).toHaveBeenCalledWith('ws'));
      await waitFor(() => expect(workspace().checkoutContexts?.map((entry) => entry.id)).toEqual([mainCheckoutContextId('ws'), BUSY_CTX.id]));

      rerender(<GitWorktreesSection workspacePath={ROOT} workspaceId="ws" refreshKey={1} />);
      await waitFor(() => expect(api.reconcileCheckoutContexts).toHaveBeenCalledTimes(2));
    });
  });

  describe('managed or unmanaged', () => {
    it('tags a checkout with no attached context as unmanaged', async () => {
      show();
      expect(within(await rowOf('old-task')).getByText('Available')).toBeTruthy();
    });

    it('recognizes an attached context by path identity, not raw string equality', async () => {
      openWorkspace({ checkoutContexts: [
        { id: mainCheckoutContextId('ws'), workspaceId: 'ws', environmentId: 'local', path: ROOT, kind: 'main' },
        context('managed', MANAGED, `${MANAGED.path}/`),
      ] , terminals: [] });
      show();
      expect(within(await rowOf('issue-90')).getByText('Available')).toBeTruthy();
    });

    it('does not count another workspace\'s or the main context as managing a checkout', async () => {
      openWorkspace({ checkoutContexts: [
        { id: mainCheckoutContextId('ws'), workspaceId: 'ws', environmentId: 'local', path: MANAGED.path, kind: 'main' },
      ], terminals: [] });
      show();
      expect(within(await rowOf('issue-90')).getByText('Available')).toBeTruthy();
    });

    it('tags a checkout an agent is using as In use and offers no removal', async () => {
      show();
      const row = await rowOf('in-flight');
      expect(within(row).getByText('In use')).toBeTruthy();
      expect(within(row).queryByRole('button')).toBeNull();
    });

    it('offers no removal for the workspace\'s own checkout, or one that is locked or missing', async () => {
      remaining = [MAIN_ENTRY, listed(ROOT, 'legacy-self'), listed('/projects/app-worktrees/locked', 'locked-one', { isLocked: true }), listed('/projects/app-worktrees/gone', 'gone-one', { isPrunable: true })];
      show();
      expect(within(await rowOf('legacy-self')).getByText('This workspace')).toBeTruthy();
      expect(await removeButton('legacy-self')).toBeNull();
      expect(within(await rowOf('locked-one')).getByText('Locked')).toBeTruthy();
      expect(await removeButton('locked-one')).toBeNull();
      expect(within(await rowOf('gone-one')).getByText('Missing')).toBeTruthy();
      expect(await removeButton('gone-one')).toBeNull();
    });
  });

  describe('one confirmed removal operation', () => {
    it.each(['old-task', 'issue-90'])('uses the same main-owned operation for %s', async (branch) => {
      show();
      await user.click((await removeButton(branch))!);
      expect(api.gitRemoveCheckout).not.toHaveBeenCalled();
      await confirmRemoval();
      await waitFor(() => expect(screen.queryByText(branch)).toBeNull());
      const entry = branch === 'old-task' ? UNMANAGED : MANAGED;
      expect(api.gitRemoveCheckout).toHaveBeenCalledWith('ws', entry.path, branch);
      expect(api.releaseCheckoutContext).not.toHaveBeenCalled();
      expect(api.gitInspectWorktree).not.toHaveBeenCalled();
      expect(api.gitRemoveWorktree).not.toHaveBeenCalled();
      expect(api.gitDeleteBranch).not.toHaveBeenCalled();
      expect(api.gitForceDeleteBranch).not.toHaveBeenCalled();
    });
    it('retains the attached row and association after dirty preflight refusal', async () => {
      api.gitRemoveCheckout.mockResolvedValue({ success: false, outcome: 'unchanged', error: 'Worktree has uncommitted, untracked, or ignored files' });
      show();
      await user.click((await removeButton('issue-90'))!);
      await confirmRemoval();
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('ignored files');
      expect(alert.textContent).not.toMatch(/left on disk|no longer attached/);
      expect(workspace().checkoutContexts?.some((entry) => entry.id === MANAGED_CTX.id)).toBe(true);
      expect(await rowOf('issue-90')).toBeTruthy();
    });
    it('does nothing on Cancel', async () => {
      show();
      await user.click((await removeButton('old-task'))!);
      await user.click(await screen.findByRole('button', { name: 'Cancel' }));
      expect(api.gitRemoveCheckout).not.toHaveBeenCalled();
    });
    it('reports actual partial outcomes without inventing directory existence', async () => {
      api.gitRemoveCheckout.mockResolvedValue({ success: false, outcome: 'recovery-required', error: 'Checkout is in Trash, but Git cleanup failed' });
      show();
      await user.click((await removeButton('issue-90'))!);
      await confirmRemoval();
      expect((await screen.findByRole('alert')).textContent).toContain('Checkout is in Trash');
      expect(screen.getByRole('alert').textContent).not.toContain('left on disk');
    });
  });
  describe('SSH', () => {
    it('passes only Git identity, never desktop occupancy claims', async () => {
      const remote = '/srv/app';
      remaining = [listed(remote, 'main', { isMain: true }), UNMANAGED];
      openWorkspace({ workspacePath: remote, environmentId: 'vps', terminals: [], checkoutContexts: [] });
      render(<GitWorktreesSection workspacePath={remote} workspaceId="ws" refreshKey={0} />);
      await user.click((await removeButton('old-task'))!);
      await confirmRemoval();
      expect(api.gitRemoveCheckout).toHaveBeenCalledWith('ws', UNMANAGED.path, 'old-task');
      expect(api.gitInspectWorktree).not.toHaveBeenCalled();
    });
  });
});
