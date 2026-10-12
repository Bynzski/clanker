import { create } from 'zustand';
import type { GitWorktreeListResult } from '../../shared/types/git';
import type { WorkspaceTab } from '../store/workspaceTypes';
import { useWorkspaceStore } from '../store/workspaceStore';
import { isWorktreeRemovalWorkspaceCurrent } from './worktreeRemovalScope';

/** Descriptive Git inventory only. No execution roots are synthesized or adopted here. */
export const useWorktreeInventory = create<{ byWorkspace: Record<string, GitWorktreeListResult> }>(() => ({ byWorkspace: {} }));
const pending = new Map<string, Promise<GitWorktreeListResult>>();

/** Reuses an authoritative listing already fetched by the Git menu. */
export function publishWorktreeInventory(workspace: WorkspaceTab, result: GitWorktreeListResult): void {
  if (!isWorktreeRemovalWorkspaceCurrent(workspace)) return;
  pending.delete(workspace.id);
  useWorktreeInventory.setState((state) => ({ byWorkspace: { ...state.byWorkspace, [workspace.id]: result.success
    ? result : { ...result, worktrees: state.byWorkspace[workspace.id]?.worktrees ?? [] } } }));
}

export function refreshWorktreeInventory(workspaceId: string): Promise<GitWorktreeListResult> {
  const current = pending.get(workspaceId);
  if (current) return current;
  const workspace = useWorkspaceStore.getState().getWorkspaceById(workspaceId);
  if (!workspace) return Promise.resolve({ success: false, worktrees: [], error: 'Workspace is closed' });
  const request = Promise.resolve().then(() => window.electronAPI.gitListWorktrees(workspace.workspacePath, workspaceId))
    .catch((error: unknown): GitWorktreeListResult => ({ success: false, worktrees: [], error: error instanceof Error ? error.message : 'Could not list worktrees' }))
    .then((result) => {
      if (pending.get(workspaceId) === request && isWorktreeRemovalWorkspaceCurrent(workspace)) {
        useWorktreeInventory.setState((state) => ({ byWorkspace: { ...state.byWorkspace, [workspaceId]: result.success
          ? result : { ...result, worktrees: state.byWorkspace[workspaceId]?.worktrees ?? [] } } }));
      }
      return result;
    }).finally(() => { if (pending.get(workspaceId) === request) pending.delete(workspaceId); });
  pending.set(workspaceId, request);
  return request;
}

// Closing/replacing a workspace invalidates an outstanding response, including close/reopen ABA.
useWorkspaceStore.subscribe((state, previous) => {
  for (const old of previous.workspaces) {
    const live = state.workspaces.find((workspace) => workspace.id === old.id);
    if (live && live.workspacePath === old.workspacePath && live.environmentId === old.environmentId) continue;
    pending.delete(old.id);
    useWorktreeInventory.setState((inventory) => {
      const next = { ...inventory.byWorkspace };
      delete next[old.id];
      return { byWorkspace: next };
    });
  }
});
