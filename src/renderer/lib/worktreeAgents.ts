import type { CheckoutContext } from '../../shared/types/checkoutContext';
import { mainCheckoutContextId } from '../../shared/checkoutContext';
import type { Terminal, WorkspaceTab } from '../store/workspaceTypes';
import { getCheckoutContext } from './checkoutContexts';

/**
 * An isolated worktree is a worktree context attached to a workspace besides its own root.
 * A legacy linked-worktree workspace annotates its root context as `worktree` too, but that
 * root is the workspace itself: it is presented by the workspace row and is never offered for
 * removal here.
 */
export function isIsolatedWorktreeContext(
  workspace: Pick<WorkspaceTab, 'id'>,
  context: CheckoutContext | null | undefined,
): context is CheckoutContext {
  return Boolean(context && context.kind === 'worktree' && context.id !== mainCheckoutContextId(workspace.id));
}

/** The isolated worktree an agent runs in, or null for an agent on the workspace's own checkout. */
export function getAgentWorktreeContext(
  workspace: Pick<WorkspaceTab, 'id' | 'checkoutContexts'>,
  terminal: Pick<Terminal, 'checkoutContextId'>,
): CheckoutContext | null {
  const context = getCheckoutContext(workspace, terminal.checkoutContextId);
  return isIsolatedWorktreeContext(workspace, context) ? context : null;
}

/** Isolated worktree contexts no terminal of the workspace references: inactive, removable checkouts. */
export function getUnusedWorktreeContexts(workspace: Pick<WorkspaceTab, 'id' | 'checkoutContexts' | 'terminals'>): CheckoutContext[] {
  const used = new Set(workspace.terminals.map((terminal) => terminal.checkoutContextId));
  return (workspace.checkoutContexts ?? []).filter((context) => isIsolatedWorktreeContext(workspace, context) && !used.has(context.id));
}

/** Short label for a worktree checkout: its branch, or HEAD when detached/unknown. */
export function worktreeBranchLabel(context: Pick<CheckoutContext, 'branch'>): string {
  return context.branch || 'HEAD';
}
