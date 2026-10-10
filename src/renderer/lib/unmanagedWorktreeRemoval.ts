import type { GitWorktree } from '../../shared/types/git';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { WorkspaceTab } from '../store/workspaceTypes';
import { isWorktreeRemovalWorkspaceCurrent } from './worktreeRemovalScope';
import { findManagedWorktreeContext } from './worktreeAgents';

export type UnmanagedWorktreeRemovalResult =
  | { success: true; warning?: string; recoveryPath?: string }
  | { success: false; stage: 'validate' | 'inspect' | 'remove'; error: string };

/**
 * Removes a linked worktree that Clanker does not manage (created outside it, by the old launcher, or
 * whose context was released) through the existing inspection and removal calls, which keep every
 * protection: dirty, untracked and ignored files, branch identity, open workspace paths, live terminal
 * paths, and for SSH the host reservations, journaling and recovery. Nothing is forced and the branch
 * is never deleted.
 *
 * A worktree with an attached checkout context is refused here: its release has to come first, and
 * `removeWorktreeCheckout` is the only path that does that. This is the guard that keeps the two
 * lifecycles from being mixed.
 */
export async function removeUnmanagedWorktree(
  workspace: Pick<WorkspaceTab, 'id' | 'environmentId' | 'workspacePath'>,
  worktree: Pick<GitWorktree, 'path' | 'isMain'>,
): Promise<UnmanagedWorktreeRemovalResult> {
  const fail = (stage: 'validate' | 'inspect' | 'remove', error: string): UnmanagedWorktreeRemovalResult => ({ success: false, stage, error });
  const environmentId = workspace.environmentId || 'local';

  const live = useWorkspaceStore.getState().getWorkspaceById(workspace.id);
  if (!isWorktreeRemovalWorkspaceCurrent(workspace) || !live) return fail('validate', 'The workspace is no longer open');
  if (worktree.isMain) return fail('validate', 'The main checkout cannot be removed');
  if (findManagedWorktreeContext(live, worktree.path)) {
    return fail('validate', 'This checkout is attached to this workspace and is removed through its checkout row, not directly');
  }

  // Local safeguards also take the open workspace roots (a checkout open as its own workspace is
  // refused by them); SSH derives its activity in main.
  const openPaths = environmentId === 'local'
    ? useWorkspaceStore.getState().workspaces.filter((entry) => (entry.environmentId || 'local') === 'local').map((entry) => entry.workspacePath)
    : [];

  let stage: 'inspect' | 'remove' = 'inspect';
  try {
    const inspection = await window.electronAPI.gitInspectWorktree(workspace.workspacePath, worktree.path, openPaths, workspace.id);
    if (!isWorktreeRemovalWorkspaceCurrent(workspace)) return fail('inspect', 'Workspace identity changed during inspection; checkout kept');
    if (!inspection.success || !inspection.worktree || typeof inspection.hasChanges !== 'boolean') {
      return fail('inspect', inspection.error || 'Could not inspect worktree');
    }
    if (inspection.hasChanges) {
      return fail('inspect', 'Worktree has uncommitted, untracked, or ignored files. Save or remove them first.');
    }
    stage = 'remove';
    const removal = await window.electronAPI.gitRemoveWorktree(
      workspace.workspacePath, inspection.worktree.path, inspection.worktree.branch, openPaths, workspace.id,
    );
    if (!removal.success) return fail('remove', removal.error || 'Could not remove worktree');
    return { success: true, warning: removal.warning, recoveryPath: removal.recoveryPath };
  } catch (cause) {
    return fail(stage, cause instanceof Error && cause.message ? cause.message : `Could not ${stage} worktree`);
  }
}
