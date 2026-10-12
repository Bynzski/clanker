import { isSameWorkspaceIdentity } from '../../shared/workspaceIdentity';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { WorkspaceTab } from '../store/workspaceTypes';
import { mainCheckoutContextId } from '../../shared/checkoutContext';

/** A sequential removal must not dispatch its next IPC into a replacement workspace/environment. */
export function isWorktreeRemovalWorkspaceCurrent(workspace: Pick<WorkspaceTab, 'id' | 'workspacePath' | 'environmentId'> & Partial<Pick<WorkspaceTab, 'checkoutContexts'>>): boolean {
  const live = useWorkspaceStore.getState().getWorkspaceById(workspace.id);
  const originalMain = workspace.checkoutContexts?.find((context) => context.id === mainCheckoutContextId(workspace.id));
  if (originalMain && live?.checkoutContexts?.find((context) => context.id === originalMain.id) !== originalMain) return false;
  return Boolean(live && isSameWorkspaceIdentity(
    { environmentId: workspace.environmentId || 'local', path: workspace.workspacePath },
    { environmentId: live.environmentId || 'local', path: live.workspacePath },
  ));
}
