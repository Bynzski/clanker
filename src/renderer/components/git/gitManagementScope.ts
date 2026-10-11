import { currentCheckoutSelection, checkoutSelectionKey, checkoutUnavailableMessage, checkoutSelectionNotice } from '../../lib/checkoutSelection';
import { mainCheckoutContextId } from '../../../shared/checkoutContext';
import { useWorkspaceStore } from '../../store/workspaceStore';

export interface GitManagementScope {
  workspaceId?: string;
  checkoutContextId?: string;
  environmentId: string;
  path: string;
  blocked: string | null;
  checkoutLabel: string;
  key: string;
}

/** Authoritative execution scope identifying workspace, selected checkout context, environment and path. */
export function gitManagementScope(workspacePath: string, workspaceId?: string): GitManagementScope {
  const state = useWorkspaceStore.getState();
  const workspace = workspaceId ? state.getWorkspaceById(workspaceId) : undefined;
  const selection = workspace ? currentCheckoutSelection(workspace) : null;
  const checkout = selection?.availability === 'available' ? selection.context : undefined;
  const checkoutId = checkout?.id === mainCheckoutContextId(workspaceId ?? '') ? undefined : checkout?.id;
  const environmentId = workspace?.environmentId ?? 'local';
  const path = checkout?.path ?? workspace?.workspacePath ?? workspacePath;
  const checkoutContextId = checkoutId ? checkout?.id : undefined;
  const blocked = selection?.availability === 'unavailable'
    ? `The selected checkout is unavailable. ${checkoutUnavailableMessage(selection.reason)}`
    : workspaceId && (!workspace || state.activeWorkspaceId !== workspaceId)
    ? 'Select this workspace before managing its repository.'
    : null;
  return {
    workspaceId,
    checkoutContextId,
    path,
    environmentId,
    blocked,
    // Branch metadata is descriptive and may lag Git; it is not checkout identity.
    checkoutLabel: (selection && checkoutSelectionNotice(selection)) || (checkout && checkout.path !== workspace?.workspacePath ? 'Isolated checkout'
      : workspace?.checkoutContexts?.some((entry) => entry.path === workspace.workspacePath && entry.kind === 'worktree') ? 'Workspace worktree' : 'Workspace checkout'),
    key: JSON.stringify([workspaceId, workspacePath, selection ? checkoutSelectionKey(selection) : null, environmentId, checkoutContextId, checkout?.path, blocked]),
  };
}
