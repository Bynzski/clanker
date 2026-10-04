import type { GitWorktreeListResult } from '../shared/types/git';
import type { ReconcileCheckoutContextsResult, ReleaseCheckoutContextResult } from '../shared/types/checkoutContext';
import type { RegisteredWorkspace, WorkspaceRegistry } from './workspaceRegistry';
import { findListedWorktree } from './worktreeContextAttachment';

/**
 * Brings a workspace's worktree checkout contexts in line with Git's own worktree listing. An agent
 * or a plain shell can merge, remove or switch a worktree without Clanker; this is how the
 * registered contexts learn about it.
 *
 * - Listed and usable: the branch is refreshed and any missing mark cleared.
 * - Unlisted, or listed as prunable (its directory is gone): `release` is tried, which is the same
 *   check the explicit release uses (nothing launched into it, no live terminal inside it). If it
 *   succeeds the context is dropped; otherwise it is only marked missing, and a later run drops it
 *   once its last terminal is gone.
 *
 * Contexts are updated in place, so a launch revalidating a context's identity is unaffected. A
 * listing failure, or the workspace closing meanwhile, changes nothing. Nothing on disk, no branch
 * and no process is touched, and a terminal's launch binding is never rewritten.
 */
export async function reconcileCheckoutContexts(params: {
  registry: WorkspaceRegistry;
  workspace: RegisteredWorkspace;
  listWorktrees: () => Promise<GitWorktreeListResult>;
  release: (checkoutContextId: string) => ReleaseCheckoutContextResult;
}): Promise<ReconcileCheckoutContextsResult> {
  const { registry, workspace, listWorktrees, release } = params;
  const worktreeContexts = () => registry.getCheckoutContextsForWorkspace(workspace.workspaceId)
    .filter((context) => context.kind === 'worktree');
  const candidates = worktreeContexts();
  if (candidates.length === 0) return { success: true, contexts: [], dropped: [] };

  let listing: GitWorktreeListResult;
  try {
    listing = await listWorktrees();
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Git could not list the repository worktrees' };
  }
  if (!listing.success) return { success: false, error: listing.error || 'Git could not list the repository worktrees' };
  if (registry.getWorkspace(workspace.workspaceId) !== workspace) {
    return { success: false, error: 'Workspace was closed while its worktrees were listed' };
  }

  const environmentId = workspace.location.environmentId;
  const dropped: string[] = [];
  for (const context of candidates) {
    // Released or removed meanwhile by another route: nothing to reconcile.
    if (registry.getCheckoutContext(context.id) !== context) continue;
    const listed = findListedWorktree(listing, environmentId, context.path);
    if (listed && !listed.isMain && !listed.isPrunable) {
      registry.describeCheckoutContext(context.id, { branch: listed.branch ?? null, missing: false });
    } else if (release(context.id).success) {
      dropped.push(context.id);
    } else {
      registry.describeCheckoutContext(context.id, { missing: true });
    }
  }
  return { success: true, contexts: worktreeContexts().map((context) => ({ ...context })), dropped };
}
