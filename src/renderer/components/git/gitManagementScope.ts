import { currentVcsCheckoutId } from '../../lib/vcsCheckout';
import { useWorkspaceStore } from '../../store/workspaceStore';

/** Presentation identity only. Git IPC still authorizes the registered workspace root. */
export function gitManagementScope(workspacePath: string, workspaceId?: string) {
  const state = useWorkspaceStore.getState();
  const workspace = workspaceId ? state.getWorkspaceById(workspaceId) : undefined;
  const checkoutId = currentVcsCheckoutId(workspaceId);
  const checkout = workspace?.checkoutContexts?.find((entry) => entry.id === checkoutId);
  const environmentId = workspace?.environmentId ?? 'local';
  const path = checkout?.path ?? workspace?.workspacePath ?? workspacePath;
  const blocked = checkoutId === null ? 'The selected checkout is unavailable. Select a registered checkout before managing Git.'
    : checkoutId ? 'Git operations currently authorize the workspace checkout only. This selected checkout is not substituted with its parent. Open it as a workspace to manage its Git tools.'
    : workspaceId && (!workspace || state.activeWorkspaceId !== workspaceId) ? 'Select this workspace before managing its repository.' : null;
  return { path, environmentId, blocked, checkoutLabel: checkout?.branch ?? (workspace?.checkoutContexts?.some((entry) => entry.path === workspace.workspacePath && entry.kind === 'worktree') ? 'Workspace worktree' : 'Workspace checkout'),
    key: JSON.stringify([workspaceId, workspacePath, workspace?.workspacePath, environmentId, checkoutId, checkout?.path, blocked]) };
}
