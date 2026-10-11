import type { AgentAttentionSnapshot } from '../../shared/types/agentAttention';
import { mainCheckoutContextId } from '../../shared/checkoutContext';
import type { WorkspaceTab } from '../store/workspaceTypes';
import { useWorkspaceStore } from '../store/workspaceStore';
import { selectCheckout, currentCheckoutSelection, type CheckoutSelection } from './checkoutSelection';

/** Compatibility adapter for existing Git IPC: undefined is registered main, null unavailable. */
function vcsCheckoutId(selected: CheckoutSelection): string | null | undefined {
  return selected.availability === 'unavailable' ? null : selected.contextId === mainCheckoutContextId(selected.workspaceId) ? undefined : selected.contextId ?? undefined;
}
export function selectedVcsCheckoutId(workspace: WorkspaceTab, snapshot?: Pick<AgentAttentionSnapshot, 'location' | 'locationProvenance'> | null): string | null | undefined {
  return vcsCheckoutId(selectCheckout(workspace, snapshot));
}
export function currentVcsCheckoutId(workspaceId?: string): string | null | undefined {
  if (!workspaceId) return undefined;
  const workspace = useWorkspaceStore.getState().getWorkspaceById(workspaceId);
  if (!workspace) return null;
  return vcsCheckoutId(currentCheckoutSelection(workspace));
}
