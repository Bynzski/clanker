import { isSameWorkspaceIdentity } from '../../shared/workspaceIdentity';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { WorkspaceTab } from '../store/workspaceTypes';

/** A sequential removal must not dispatch its next IPC into a replacement workspace/environment. */
export function isWorktreeRemovalWorkspaceCurrent(workspace: Pick<WorkspaceTab, 'id' | 'workspacePath' | 'environmentId'>): boolean {
  const live = useWorkspaceStore.getState().getWorkspaceById(workspace.id);
  return Boolean(live && isSameWorkspaceIdentity(
    { environmentId: workspace.environmentId || 'local', path: workspace.workspacePath },
    { environmentId: live.environmentId || 'local', path: live.workspacePath },
  ));
}
