import type { CheckoutContext } from '../../shared/types/checkoutContext';
import { mainCheckoutContextId } from '../../shared/checkoutContext';
import type { Terminal, WorkspaceTab } from '../store/workspaceTypes';
import { isSameWorkspaceIdentity } from '../../shared/workspaceIdentity';
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

/**
 * The isolated worktree the workspace's selected agent runs in, or null when the selected agent (or
 * none) is on the workspace's own checkout. Presentation only: it reads the registered
 * terminal -> context mapping and never inspects the process, its directory, or the repository.
 */
export function getSelectedAgentWorktreeContext(
  workspace: Pick<WorkspaceTab, 'id' | 'checkoutContexts' | 'terminals' | 'activeTerminalId'>,
): CheckoutContext | null {
  const terminal = workspace.terminals.find((entry) => entry.id === workspace.activeTerminalId);
  return terminal ? getAgentWorktreeContext(workspace, terminal) : null;
}

/**
 * The attached isolated-worktree context whose root is this listed worktree, if any. Compared by
 * environment and canonical path identity (not raw strings), so slash style, trailing separators and
 * Windows case do not hide a match. A worktree with no attached context is unmanaged: created
 * outside Clanker, by an old flow, or whose context was released.
 */
export function findManagedWorktreeContext(
  workspace: Pick<WorkspaceTab, 'id' | 'environmentId' | 'checkoutContexts'>,
  worktreePath: string,
): CheckoutContext | null {
  const environmentId = workspace.environmentId || 'local';
  return (workspace.checkoutContexts ?? []).find((context) =>
    isIsolatedWorktreeContext(workspace, context)
    && isSameWorkspaceIdentity({ environmentId, path: context.path }, { environmentId, path: worktreePath })) ?? null;
}

/** Whether any agent of the workspace currently references the context. */
export function isCheckoutContextInUse(
  workspace: Pick<WorkspaceTab, 'terminals'>,
  context: Pick<CheckoutContext, 'id'>,
): boolean {
  return workspace.terminals.some((terminal) => terminal.checkoutContextId === context.id);
}
