import type { AgentLocation } from '../../shared/types/agentAttention';
import { mainCheckoutContextId } from '../../shared/checkoutContext';
import type { WorkspaceTab } from '../store/workspaceTypes';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAgentAttentionStore } from '../store/agentAttentionStore';

/** Select registered identity only, never shell cwd text; no execution binding is changed. */
export function selectedVcsCheckoutId(workspace: WorkspaceTab, location?: AgentLocation | null): string | null | undefined {
  const terminal = workspace.terminals.find((entry) => entry.id === workspace.activeTerminalId);
  const id = workspace.fileSurfaceContextId ?? (location ? location.checkoutContextId : terminal?.checkoutContextId);
  if (location && !workspace.fileSurfaceContextId && !id) return null;
  if (!id && !workspace.checkoutContexts?.some((entry) => entry.id === mainCheckoutContextId(workspace.id) && entry.missing)) return undefined;
  if (id === mainCheckoutContextId(workspace.id) && !workspace.checkoutContexts?.length) return undefined;
  const context = workspace.checkoutContexts?.find((entry) => entry.id === (id ?? mainCheckoutContextId(workspace.id)) && entry.workspaceId === workspace.id
    && entry.environmentId === (workspace.environmentId ?? 'local') && !entry.missing);
  return context ? context.id === mainCheckoutContextId(workspace.id) ? undefined : context.id : null;
}
export function currentVcsCheckoutId(workspaceId?: string): string | null | undefined {
  if (!workspaceId) return undefined;
  const workspace = useWorkspaceStore.getState().workspaces.find((entry) => entry.id === workspaceId);
  if (!workspace) return null;
  const location = workspace.activeTerminalId ? useAgentAttentionStore.getState().byTerminalId[workspace.activeTerminalId]?.location : null;
  return selectedVcsCheckoutId(workspace, location);
}
