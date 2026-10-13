import { mainCheckoutContextId } from '../../shared/checkoutContext';
import { useWorkspaceStore } from '../store/workspaceStore';
import { currentCheckoutSelection, type CheckoutSelection } from './checkoutSelection';

/** Compatibility adapter for existing Git IPC: undefined is registered main, null unavailable. */
function vcsCheckoutId(selected: CheckoutSelection): string | null | undefined {
  return selected.availability === 'unavailable' ? null : selected.contextId === mainCheckoutContextId(selected.workspaceId) ? undefined : selected.contextId ?? undefined;
}
export function currentVcsCheckoutId(workspaceId?: string): string | null | undefined {
  if (!workspaceId) return undefined;
  const workspace = useWorkspaceStore.getState().getWorkspaceById(workspaceId);
  if (!workspace) return null;
  return vcsCheckoutId(currentCheckoutSelection(workspace));
}
