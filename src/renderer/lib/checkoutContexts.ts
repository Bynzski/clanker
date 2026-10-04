import type { CheckoutContext, ReconcileCheckoutContextsResult } from '../../shared/types/checkoutContext';
import { createMainCheckoutContext, mainCheckoutContextId } from '../../shared/checkoutContext';
import { isSameWorkspaceIdentity } from '../../shared/workspaceIdentity';
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

const isAbsolutePosixOrDrivePath = (value: string): boolean => /^(\/|[A-Za-z]:\/)/.test(value);

/**
 * Returns the workspace's contexts with `incoming` added or replaced, or null when `incoming`
 * is not an acceptable authoritative worktree context for this workspace. Applying the same
 * context again returns the existing array unchanged.
 *
 * This is descriptive renderer state: main's WorkspaceRegistry decides which roots exist, and
 * this refuses anything main would not have produced (a context of another workspace or
 * environment, a second main context, a relative path, or a second id for an existing root).
 */
export function upsertCheckoutContextList(
  workspace: Pick<WorkspaceTab, 'id' | 'environmentId' | 'checkoutContexts'>,
  incoming: CheckoutContext,
): CheckoutContext[] | null {
  const environmentId = workspace.environmentId || 'local';
  if (!incoming || typeof incoming !== 'object'
    || incoming.workspaceId !== workspace.id
    || incoming.environmentId !== environmentId
    || incoming.kind !== 'worktree'
    || typeof incoming.id !== 'string' || !incoming.id.startsWith(`${workspace.id}::`)
    || incoming.id === mainCheckoutContextId(workspace.id)
    || typeof incoming.path !== 'string' || !isAbsolutePosixOrDrivePath(incoming.path)) {
    return null;
  }

  const existing = workspace.checkoutContexts ?? [];
  const sameRoot = existing.find((context) => context.id !== incoming.id
    && isSameWorkspaceIdentity({ environmentId, path: context.path }, { environmentId, path: incoming.path }));
  if (sameRoot) return null;

  const current = existing.find((context) => context.id === incoming.id);
  if (!current) return [...existing, { ...incoming }];
  // A context id names one root for its whole life; only descriptive fields may change.
  if (current.path !== incoming.path) return null;
  const unchanged = current.branch === incoming.branch && current.mainCheckoutPath === incoming.mainCheckoutPath;
  return unchanged ? (workspace.checkoutContexts ?? existing) : existing.map((context) => (context.id === incoming.id ? { ...incoming } : context));
}

/**
 * The contexts without `checkoutContextId`, or null when that id is not a removable worktree
 * context of this workspace (unknown, or the main context). Descriptive only: main has already
 * released the context before the renderer forgets it.
 */
export function removeCheckoutContextFromList(
  workspace: Pick<WorkspaceTab, 'id' | 'checkoutContexts'>,
  checkoutContextId: string,
): CheckoutContext[] | null {
  const existing = workspace.checkoutContexts ?? [];
  const target = existing.find((context) => context.id === checkoutContextId);
  if (!target || target.workspaceId !== workspace.id || target.kind !== 'worktree'
    || checkoutContextId === mainCheckoutContextId(workspace.id)) {
    return null;
  }
  return existing.filter((context) => context.id !== checkoutContextId);
}

/**
 * The contexts after applying main's reconciliation with Git (see `reconcileCheckoutContexts` in
 * main): dropped worktree contexts are forgotten and known ones take main's branch and missing
 * flag. Never adds a context, changes a root, or touches the main context; anything else main sent
 * is ignored. Returns the existing array when nothing changed.
 */
export function reconcileCheckoutContextList(
  workspace: Pick<WorkspaceTab, 'id' | 'checkoutContexts'>,
  result: ReconcileCheckoutContextsResult,
): CheckoutContext[] | undefined {
  const existing = workspace.checkoutContexts;
  if (!result.success || !existing) return existing;
  const mainId = mainCheckoutContextId(workspace.id);
  const dropped = new Set((result.dropped ?? []).filter((id) => id !== mainId));
  const described = new Map((result.contexts ?? []).map((context) => [context.id, context]));
  let changed = false;
  const next: CheckoutContext[] = [];
  for (const context of existing) {
    const isOwnWorktree = context.kind === 'worktree' && context.id !== mainId && context.workspaceId === workspace.id;
    if (isOwnWorktree && dropped.has(context.id)) { changed = true; continue; }
    const update = isOwnWorktree ? described.get(context.id) : undefined;
    if (update && update.workspaceId === workspace.id && update.path === context.path) {
      const branch = update.branch ?? null;
      const missing = update.missing === true;
      if ((context.branch ?? null) !== branch || (context.missing === true) !== missing) {
        changed = true;
        next.push({ ...context, branch, missing });
        continue;
      }
    }
    next.push(context);
  }
  return changed ? next : existing;
}
