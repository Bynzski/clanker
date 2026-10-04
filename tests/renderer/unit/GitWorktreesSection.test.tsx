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
      gitRemoveWorktree: vi.fn().mockImplementation(async (_repo: string, path: string) => {
        callOrder.push('remove');
        remaining = remaining.filter((entry) => entry.path !== path);
        return { success: true };
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
      expect(within(await rowOf('old-task')).getByText('Unmanaged')).toBeTruthy();
    });

    it('recognizes an attached context by path identity, not raw string equality', async () => {
      openWorkspace({ checkoutContexts: [
        { id: mainCheckoutContextId('ws'), workspaceId: 'ws', environmentId: 'local', path: ROOT, kind: 'main' },
        context('managed', MANAGED, `${MANAGED.path}/`),
      ] , terminals: [] });
      show();
      expect(within(await rowOf('issue-90')).getByText('Managed')).toBeTruthy();
    });

    it('does not count another workspace\'s or the main context as managing a checkout', async () => {
      openWorkspace({ checkoutContexts: [
        { id: mainCheckoutContextId('ws'), workspaceId: 'ws', environmentId: 'local', path: MANAGED.path, kind: 'main' },
      ], terminals: [] });
      show();
      expect(within(await rowOf('issue-90')).getByText('Unmanaged')).toBeTruthy();
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

  describe('removing an unmanaged worktree', () => {
    it('confirms, then runs the existing inspect and remove calls, and refreshes the list', async () => {
      show();
      await user.click((await removeButton('old-task'))!);
      const dialog = await screen.findByRole('alertdialog');
      expect(dialog.textContent).toContain('Remove checkout for branch old-task?');
      expect(dialog.textContent).toContain('The branch remains.');
      expect(api.gitInspectWorktree).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Remove worktree' }));

      await waitFor(() => expect(screen.queryByText('old-task')).toBeNull());
      expect(callOrder).toEqual(['inspect', 'remove']);
      // The same protections' inputs: local open workspace paths, the inspected branch, the workspace id.
      expect(api.gitInspectWorktree).toHaveBeenCalledWith(ROOT, UNMANAGED.path, [ROOT], 'ws');
      expect(api.gitRemoveWorktree).toHaveBeenCalledWith(ROOT, UNMANAGED.path, 'old-task', [ROOT], 'ws');
      expect(api.releaseCheckoutContext).not.toHaveBeenCalled();
      expect(api.gitDeleteBranch).not.toHaveBeenCalled();
      expect(api.gitForceDeleteBranch).not.toHaveBeenCalled();
      expect(api.gitListWorktrees.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('does nothing on Cancel', async () => {
      show();
      await user.click((await removeButton('old-task'))!);
      await user.click(await screen.findByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(api.gitInspectWorktree).not.toHaveBeenCalled();
    });

    it('refuses a checkout with uncommitted, untracked or ignored files, and keeps the row and the error', async () => {
      api.gitInspectWorktree.mockResolvedValue({ success: true, hasChanges: true, worktree: UNMANAGED });
      show();
      await user.click((await removeButton('old-task'))!);
      await confirmRemoval();

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('uncommitted, untracked, or ignored files');
      expect(alert.textContent).toContain('left on disk');
      expect(alert.textContent).toContain('branch was not deleted');
      // An unmanaged checkout was never attached, so it is not described as detached.
      expect(alert.textContent).not.toContain('no longer attached');
      expect(api.gitRemoveWorktree).not.toHaveBeenCalled();
      expect(await rowOf('old-task')).toBeTruthy();
    });

    it('keeps the row and shows the error when the branch changed before removal', async () => {
      api.gitRemoveWorktree.mockResolvedValue({ success: false, error: 'Worktree branch changed; inspect it again' });
      show();
      await user.click((await removeButton('old-task'))!);
      await confirmRemoval();

      expect((await screen.findByRole('alert')).textContent).toContain('Worktree branch changed; inspect it again. It was left on disk');
      expect(await rowOf('old-task')).toBeTruthy();
    });

    it('shows main\'s refusal for a checkout that is open as a workspace, and keeps the workspace open', async () => {
      const asWorkspace = createWorkspaceFixture({ id: 'legacy-tab', workspacePath: UNMANAGED.path, isLinkedWorktree: true, terminals: [] });
      useWorkspaceStore.getState().addWorkspace(asWorkspace);
      useWorkspaceStore.getState().selectWorkspace('ws');
      api.gitInspectWorktree.mockResolvedValue({ success: false, error: 'Close this workspace tab before removing its worktree' });
      show();
      await user.click((await removeButton('old-task'))!);
      await confirmRemoval();

      expect((await screen.findByRole('alert')).textContent).toContain('Close this workspace tab before removing its worktree');
      // That open path is among the ones sent to the existing safeguard; nothing was closed or removed.
      expect(api.gitInspectWorktree).toHaveBeenCalledWith(ROOT, UNMANAGED.path, [ROOT, UNMANAGED.path], 'ws');
      expect(api.gitRemoveWorktree).not.toHaveBeenCalled();
      expect(useWorkspaceStore.getState().getWorkspaceById('legacy-tab')).not.toBeNull();
      expect(await rowOf('old-task')).toBeTruthy();
    });

    it('passes the removal warning through', async () => {
      api.gitRemoveWorktree.mockImplementation(async (_r: string, path: string) => {
        remaining = remaining.filter((entry) => entry.path !== path);
        return { success: true, warning: 'New files appeared during removal and were left in place' };
      });
      show();
      await user.click((await removeButton('old-task'))!);
      await confirmRemoval();
      expect((await screen.findByRole('status')).textContent).toContain('left in place');
    });
  });

  describe('removing a managed checkout', () => {
    it('never sends a managed checkout straight to Git removal: release comes first, through removeWorktreeCheckout', async () => {
      show();
      expect(within(await rowOf('issue-90')).getByText('Managed')).toBeTruthy();
      await user.click((await removeButton('issue-90'))!);
      await confirmRemoval();

      await waitFor(() => expect(screen.queryByText('issue-90')).toBeNull());
      expect(callOrder).toEqual(['release', 'inspect', 'remove']);
      expect(api.releaseCheckoutContext).toHaveBeenCalledExactlyOnceWith('ws', MANAGED_CTX.id);
      expect(workspace().checkoutContexts!.map((entry) => entry.id)).not.toContain(MANAGED_CTX.id);
      expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    });

    it('lets main refuse the release and keeps the context attached and the row visible', async () => {
      api.releaseCheckoutContext.mockResolvedValue({ success: false, error: '1 running terminal is still using this checkout; close it first' });
      show();
      await user.click((await removeButton('issue-90'))!);
      await confirmRemoval();

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('1 running terminal is still using this checkout');
      expect(alert.textContent).not.toContain('no longer attached');
      expect(api.gitInspectWorktree).not.toHaveBeenCalled();
      expect(api.gitRemoveWorktree).not.toHaveBeenCalled();
      expect(workspace().checkoutContexts!.map((entry) => entry.id)).toContain(MANAGED_CTX.id);
      expect(within(await rowOf('issue-90')).getByText('Managed')).toBeTruthy();
    });

    it('after a failure that followed the release, the checkout is still listed, now honestly as unmanaged', async () => {
      api.gitInspectWorktree.mockResolvedValue({ success: true, hasChanges: true, worktree: MANAGED });
      show();
      await user.click((await removeButton('issue-90'))!);
      await confirmRemoval();

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain(`left on disk at ${MANAGED.path}`);
      // It is still listed right below, so the message must not claim otherwise.
      expect(alert.textContent).toContain('is no longer attached to this workspace');
      expect(alert.textContent).not.toContain('no longer listed');
      await waitFor(() => expect(within(screen.getByText('issue-90').closest('.git-worktree-item') as HTMLElement).getByText('Unmanaged')).toBeTruthy());
      expect(api.gitRemoveWorktree).not.toHaveBeenCalled();
      expect(workspace().checkoutContexts!.map((entry) => entry.id)).not.toContain(MANAGED_CTX.id);
    });
  });

  describe('the direct-removal path refuses an attached checkout', () => {
    it('removeUnmanagedWorktree will not touch a path with an attached context', async () => {
      const { removeUnmanagedWorktree } = await import('../../../src/renderer/lib/unmanagedWorktreeRemoval');
      const result = await removeUnmanagedWorktree(workspace(), MANAGED);

      expect(result).toMatchObject({ success: false, stage: 'validate' });
      expect(api.gitInspectWorktree).not.toHaveBeenCalled();
      expect(api.gitRemoveWorktree).not.toHaveBeenCalled();
    });

    it('nor the main checkout, nor a workspace that is no longer open', async () => {
      const { removeUnmanagedWorktree } = await import('../../../src/renderer/lib/unmanagedWorktreeRemoval');
      expect(await removeUnmanagedWorktree(workspace(), MAIN_ENTRY)).toMatchObject({ success: false, stage: 'validate' });
      expect(await removeUnmanagedWorktree({ ...workspace(), id: 'closed' }, UNMANAGED)).toMatchObject({ success: false, stage: 'validate' });
      expect(api.gitRemoveWorktree).not.toHaveBeenCalled();
    });
  });

  describe('SSH', () => {
    const REMOTE_ROOT = '/srv/app';
    const REMOTE_OLD = listed('/srv/app-worktrees/old-task', 'old-task');

    beforeEach(() => {
      remaining = [listed(REMOTE_ROOT, 'main', { isMain: true }), REMOTE_OLD];
      openWorkspace({
        workspacePath: REMOTE_ROOT, environmentId: 'vps',
        checkoutContexts: [{ id: mainCheckoutContextId('ws'), workspaceId: 'ws', environmentId: 'vps', path: REMOTE_ROOT, kind: 'main' }],
        terminals: [],
      });
    });

    it('lists through the scoped call and removes with no desktop paths, leaving host protections to main', async () => {
      render(<GitWorktreesSection workspacePath={REMOTE_ROOT} workspaceId="ws" refreshKey={0} />);
      expect(within(await rowOf('old-task')).getByText('Unmanaged')).toBeTruthy();
      expect(api.gitListWorktrees).toHaveBeenCalledWith(REMOTE_ROOT, 'ws');
      await user.click((await removeButton('old-task'))!);
      await confirmRemoval();

      await waitFor(() => expect(screen.queryByText('old-task')).toBeNull());
      expect(api.gitInspectWorktree).toHaveBeenCalledWith(REMOTE_ROOT, REMOTE_OLD.path, [], 'ws');
      expect(api.gitRemoveWorktree).toHaveBeenCalledWith(REMOTE_ROOT, REMOTE_OLD.path, 'old-task', [], 'ws');
    });

    it('shows the host\'s refusal (active terminal, reservation, recovery) and keeps the row', async () => {
      api.gitInspectWorktree.mockResolvedValue({ success: false, error: 'Close workspace tabs and stop active terminals using this checkout before removal' });
      render(<GitWorktreesSection workspacePath={REMOTE_ROOT} workspaceId="ws" refreshKey={0} />);
      await user.click((await removeButton('old-task'))!);
      await confirmRemoval();

      expect((await screen.findByRole('alert')).textContent).toContain('stop active terminals');
      expect(api.gitRemoveWorktree).not.toHaveBeenCalled();
      expect(await rowOf('old-task')).toBeTruthy();
    });

    it('a successful remote removal refreshes the list and leaves no error behind', async () => {
      render(<GitWorktreesSection workspacePath={REMOTE_ROOT} workspaceId="ws" refreshKey={0} />);
      await user.click((await removeButton('old-task'))!);
      await confirmRemoval();
      await waitFor(() => expect(screen.queryByText('old-task')).toBeNull());
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
