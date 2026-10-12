import type { GitWorktreeRemoveResult } from '../../shared/types/git';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { WorkspaceTab } from '../store/workspaceTypes';
import { isWorktreeRemovalWorkspaceCurrent } from './worktreeRemovalScope';

/** Backend evidence describes partial outcomes; failure alone says nothing about files on disk. */
export function formatCheckoutRemovalFailure(input: { branch: string; path: string; error: string }): string {
  const trimmed = input.error.trim();
  const reason = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  return `Could not remove the checkout for branch "${input.branch}": ${reason} The branch was not deleted. Refresh worktrees to inspect the current state.`;
}

/** One confirmed request for every Git-listed checkout, independent of its creation source. */
export async function removeWorktreeCheckout(
  workspace: Pick<WorkspaceTab, 'id' | 'environmentId' | 'workspacePath'>,
  worktree: { path: string; branch?: string | null; isMain?: boolean },
): Promise<GitWorktreeRemoveResult> {
  if (!isWorktreeRemovalWorkspaceCurrent(workspace) || worktree.isMain || worktree.path === workspace.workspacePath) {
    return { success: false, outcome: 'unchanged', error: 'Choose a linked worktree of an open workspace' };
  }
  const workspaces = new Map(useWorkspaceStore.getState().workspaces.map((entry) => [entry.id, entry]));
  try {
    const result = await window.electronAPI.gitRemoveCheckout(workspace.id, worktree.path, worktree.branch ?? null);
    for (const update of result.reconciliations ?? (result.reconciliation ? [{ workspaceId: workspace.id, result: result.reconciliation }] : [])) {
      const original = workspaces.get(update.workspaceId);
      if (original && isWorktreeRemovalWorkspaceCurrent(original)) {
        useWorkspaceStore.getState().applyCheckoutContextReconciliation(update.workspaceId, update.result);
      }
    }
    return result;
  } catch (cause) {
    return { success: false, outcome: 'unknown', error: cause instanceof Error ? cause.message : 'Could not verify worktree removal' };
  }
}
