import type { CheckoutContext } from '../../shared/types/checkoutContext';
import type { AgentLocation } from '../../shared/types/agentAttention';
import { mainCheckoutContextId } from '../../shared/checkoutContext';
import type { Terminal, WorkspaceTab } from '../store/workspaceTypes';
import { isSameWorkspaceIdentity } from '../../shared/workspaceIdentity';
import { getCheckoutContext } from './checkoutContexts';
import { useAgentAttentionStore } from '../store/agentAttentionStore';
import { useWorkspaceServiceStore } from '../store/workspaceServiceStore';
import { isLiveWorkspaceService } from '../../shared/types/workspaceServices';
import { pathInFileCheckout } from './fileCheckout';

/**
 * A worktree context is a validated root attached to a workspace besides its own root.
 * A legacy linked-worktree workspace annotates its root context as `worktree` too, but that
 * root is the workspace itself: it is presented by the workspace row and is never offered for
 * removal here.
 */
export function isWorktreeContext(
  workspace: Pick<WorkspaceTab, 'id'>,
  context: CheckoutContext | null | undefined,
): context is CheckoutContext {
  return Boolean(context && context.kind === 'worktree' && context.id !== mainCheckoutContextId(workspace.id));
}

/**
 * The worktree an agent is working in, or null for an agent on the workspace's own
 * checkout or outside every registered one. Once the agent's harness has reported a location, that
 * decides (main resolved it to a context); until then, the context the terminal was launched into.
 * Presentation only: the terminal's launch binding is never changed by where it is shown.
 */
export function getAgentWorktreeContext(
  workspace: Pick<WorkspaceTab, 'id' | 'checkoutContexts'>,
  terminal: Pick<Terminal, 'checkoutContextId'>,
  location?: AgentLocation | null,
): CheckoutContext | null {
  const contextId = location ? location.checkoutContextId ?? undefined : terminal.checkoutContextId;
  const context = getCheckoutContext(workspace, contextId);
  return isWorktreeContext(workspace, context) ? context : null;
}

/** Short label for a worktree checkout: its branch, or HEAD when detached/unknown. */
export function worktreeBranchLabel(context: Pick<CheckoutContext, 'branch'>): string {
  return context.branch || 'HEAD';
}

/** The branch as shown for an agent's checkout: marked when Git no longer has the checkout. */
export function worktreeDisplayLabel(context: Pick<CheckoutContext, 'branch' | 'missing'>): string {
  return context.missing ? `${worktreeBranchLabel(context)} · removed` : worktreeBranchLabel(context);
}

/**
 * The worktree the workspace's selected agent is working in (see `getAgentWorktreeContext`),
 * or null when the selected agent (or none) is on the workspace's own checkout. Presentation only:
 * it reads registered contexts and the agent's reported location, never the process or repository.
 */
export function getSelectedAgentWorktreeContext(
  workspace: Pick<WorkspaceTab, 'id' | 'checkoutContexts' | 'terminals' | 'activeTerminalId'>,
  selectedLocation?: AgentLocation | null,
): CheckoutContext | null {
  const terminal = workspace.terminals.find((entry) => entry.id === workspace.activeTerminalId);
  return terminal ? getAgentWorktreeContext(workspace, terminal, selectedLocation) : null;
}

/**
 * The registered worktree context whose root is this listed worktree, if any. Compared by
 * environment and canonical path identity (not raw strings), so slash style, trailing separators and
 * Windows case do not hide a match. A worktree with no attached context is unmanaged: created
 * outside Clanker, by an old flow, or whose context was released.
 */
export function findRegisteredWorktreeContext(
  workspace: Pick<WorkspaceTab, 'id' | 'environmentId' | 'checkoutContexts'>,
  worktreePath: string,
): CheckoutContext | null {
  const environmentId = workspace.environmentId || 'local';
  return (workspace.checkoutContexts ?? []).find((context) =>
    isWorktreeContext(workspace, context)
    && isSameWorkspaceIdentity({ environmentId, path: context.path }, { environmentId, path: worktreePath })) ?? null;
}

export function useCheckoutOccupancy(): void {
  useAgentAttentionStore((state) => state.byTerminalId);
  useWorkspaceServiceStore((state) => state.services);
}

/** Whether any live launch, authenticated observation (current or historical) or service references the root. */
export function isCheckoutContextInUse(
  workspace: Pick<WorkspaceTab, 'terminals'> & Partial<Pick<WorkspaceTab, 'id'>>,
  context: Pick<CheckoutContext, 'id'> & Partial<Pick<CheckoutContext, 'path'>>,
): boolean {
  const snapshots = useAgentAttentionStore.getState().byTerminalId;
  return workspace.terminals.some((terminal) => {
    if (terminal.checkoutContextId === context.id) return true;
    const location = snapshots[terminal.id]?.location;
    return !!location && (location.checkoutContextId === context.id
      || (!!context.path && pathInFileCheckout(context.path, location.path)));
  }) || useWorkspaceServiceStore.getState().services.some((service) => service.workspaceId === workspace.id
    && service.checkoutContextId === context.id && isLiveWorkspaceService(service));
}
