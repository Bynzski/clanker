import type { CheckoutContext } from '../../shared/types/checkoutContext';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { WorkspaceTab } from '../store/workspaceTypes';
import { isWorktreeRemovalWorkspaceCurrent } from './worktreeRemovalScope';
import { getCheckoutContext } from './checkoutContexts';

/**
 * The user-facing explanation of a failed removal. Existing error texts are not always sentences.
 *
 * After a release the message states the authoritative state, not what one screen happens to show:
 * the checkout is still on disk but is no longer attached to the workspace as a checkout context. Where
 * Git still lists it (the Git menu reloads it as an unmanaged worktree) is a separate matter.
 */
export function formatCheckoutRemovalFailure(input: { branch: string; path: string; error: string; released: boolean }): string {
  const trimmed = input.error.trim();
  const reason = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  return input.released
    ? `Could not remove the checkout for branch "${input.branch}": ${reason} It was left on disk at ${input.path} and is no longer attached to this workspace. The branch was not deleted.`
    : `Could not remove the checkout for branch "${input.branch}": ${reason} It was left on disk. The branch was not deleted.`;
}

export type WorktreeCheckoutRemovalStage = 'validate' | 'release' | 'inspect' | 'remove';

export type WorktreeCheckoutRemovalResult =
  | { success: true; warning?: string; recoveryPath?: string }
  | {
    success: false;
    stage: WorktreeCheckoutRemovalStage;
    error: string;
    /** True once main has released the context. It is never re-registered by a later failure. */
    released: boolean;
  };

/**
 * Finishes a worktree-backed checkout: release its context, then run the existing inspection and
 * removal. Nothing here decides safety. Main refuses the release while any Clanker terminal uses
 * the checkout, and inspection/removal keep every existing protection (dirty, untracked and
 * ignored files, branch identity, open paths, SSH reservations, journaling and recovery); having
 * just released the context bypasses none of them.
 *
 * Failure semantics:
 * - release refused: nothing changed (renderer state included) and removal is not attempted;
 * - release succeeded but inspection/removal failed: the context stays released, the checkout
 *   stays on disk untouched, and the error is the existing one. It is not re-registered; adopting
 *   an existing checkout again is a separate Git-aware action.
 *
 * Never kills terminals, deletes a branch, or forces anything.
 */
export async function removeWorktreeCheckout(
  workspace: Pick<WorkspaceTab, 'id' | 'environmentId' | 'workspacePath'>,
  checkoutContext: CheckoutContext,
): Promise<WorktreeCheckoutRemovalResult> {
  const fail = (stage: WorktreeCheckoutRemovalStage, error: string, released: boolean): WorktreeCheckoutRemovalResult =>
    ({ success: false, stage, error, released });
  const messageOf = (cause: unknown, fallback: string) => (cause instanceof Error && cause.message ? cause.message : fallback);

  const environmentId = workspace.environmentId || 'local';
  const live = useWorkspaceStore.getState().getWorkspaceById(workspace.id);
  const liveContext = live ? getCheckoutContext(live, checkoutContext.id) : null;
  if (checkoutContext.workspaceId !== workspace.id || checkoutContext.kind !== 'worktree'
    || checkoutContext.environmentId !== environmentId
    || !live || !isWorktreeRemovalWorkspaceCurrent(workspace)
    || !liveContext || liveContext.path !== checkoutContext.path) {
    return fail('validate', 'This is not a worktree checkout of this workspace', false);
  }

  try {
    const released = await window.electronAPI.releaseCheckoutContext(workspace.id, checkoutContext.id);
    if (!released.success) return fail('release', released.error || 'The checkout is still in use', false);
  } catch (cause) {
    return fail('release', messageOf(cause, 'Could not release the checkout'), false);
  }
  if (!isWorktreeRemovalWorkspaceCurrent(workspace)) return fail('release', 'Workspace identity changed during removal; checkout kept', true);
  // Only now that main has released it does the renderer stop treating the root as active.
  useWorkspaceStore.getState().removeCheckoutContext(workspace.id, checkoutContext.id);

  // Local safeguards also take the open workspace roots; SSH derives them in main.
  const openPaths = environmentId === 'local'
    ? useWorkspaceStore.getState().workspaces.filter((entry) => (entry.environmentId || 'local') === 'local').map((entry) => entry.workspacePath)
    : [];

  let stage: 'inspect' | 'remove' = 'inspect';
  try {
    const inspection = await window.electronAPI.gitInspectWorktree(workspace.workspacePath, checkoutContext.path, openPaths, workspace.id);
    if (!isWorktreeRemovalWorkspaceCurrent(workspace)) return fail('inspect', 'Workspace identity changed during inspection; checkout kept', true);
    if (!inspection.success || !inspection.worktree || typeof inspection.hasChanges !== 'boolean') {
      return fail('inspect', inspection.error || 'Could not inspect worktree', true);
    }
    if (inspection.hasChanges) {
      return fail('inspect', 'Worktree has uncommitted, untracked, or ignored files. Save or remove them first.', true);
    }
    stage = 'remove';
    const removal = await window.electronAPI.gitRemoveWorktree(
      workspace.workspacePath, inspection.worktree.path, inspection.worktree.branch, openPaths, workspace.id,
    );
    if (!removal.success) return fail('remove', removal.error || 'Could not remove worktree', true);
    return { success: true, warning: removal.warning, recoveryPath: removal.recoveryPath };
  } catch (cause) {
    return fail(stage, messageOf(cause, stage === 'inspect' ? 'Could not inspect worktree' : 'Could not remove worktree'), true);
  }
}
