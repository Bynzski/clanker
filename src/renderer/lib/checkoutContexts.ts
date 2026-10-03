import type { CheckoutContext } from '../../shared/types/checkoutContext';
import { createMainCheckoutContext, mainCheckoutContextId } from '../../shared/checkoutContext';
import type { Terminal, WorkspaceTab } from '../store/workspaceTypes';

type CheckoutContextSource = Pick<
  WorkspaceTab,
  'id' | 'workspacePath' | 'environmentId' | 'checkoutContexts' | 'isLinkedWorktree' | 'gitCurrentBranch'
>;

/**
 * Returns the workspace's checkout contexts, always including its main one.
 *
 * Transitional backfill: workspaces created before checkout contexts (or by code that does not
 * supply them) get a context derived from their registered root. A legacy linked-worktree
 * workspace is its own root, so its context is `worktree` kind; it is still presented as a
 * workspace. The authoritative copy, with the validated root, lives in main's WorkspaceRegistry.
 */
export function backfillCheckoutContexts(workspace: CheckoutContextSource): CheckoutContext[] {
  const existing = workspace.checkoutContexts ?? [];
  const mainId = mainCheckoutContextId(workspace.id);
  if (existing.some((context) => context.id === mainId)) return [...existing];

  const main = createMainCheckoutContext({
    workspaceId: workspace.id,
    environmentId: workspace.environmentId,
    path: workspace.workspacePath,
  });
  const root: CheckoutContext = workspace.isLinkedWorktree
    ? { ...main, kind: 'worktree', ...(workspace.gitCurrentBranch ? { branch: workspace.gitCurrentBranch } : {}) }
    : main;
  return [root, ...existing];
}

/** Terminals default to the workspace's main checkout; a recorded context is never overwritten. */
export function bindTerminalToCheckoutContext(terminal: Terminal, workspaceId: string): Terminal {
  return terminal.checkoutContextId
    ? terminal
    : { ...terminal, checkoutContextId: mainCheckoutContextId(workspaceId) };
}

export function getCheckoutContext(
  workspace: Pick<WorkspaceTab, 'checkoutContexts'>,
  contextId: string | undefined,
): CheckoutContext | null {
  if (!contextId) return null;
  return workspace.checkoutContexts?.find((context) => context.id === contextId) ?? null;
}
