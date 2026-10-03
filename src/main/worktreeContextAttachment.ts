import * as fs from 'node:fs';
import type { GitWorktreeCreateResult, GitWorktreeListResult } from '../shared/types/git';
import { LOCAL_ENVIRONMENT_ID } from '../shared/types/environments';
import { toPosixPath } from '../shared/pathNormalize';
import { isSameWorkspaceIdentity } from '../shared/workspaceIdentity';
import type { RegisteredWorkspace, WorkspaceRegistry } from './workspaceRegistry';

/**
 * Attaches a worktree that Git has just created to the workspace that asked for it, as a
 * `worktree` checkout context. This is the only route by which a renderer request leads to a
 * new execution root, and every authoritative field comes from main:
 *
 * - the path is the one Git created and the owning environment then canonicalizes;
 * - Git's own worktree listing must contain it as a linked worktree before it is registered;
 * - branch and `mainCheckoutPath` are read from that listing (`mainCheckoutPath` is descriptive
 *   metadata only and never authorizes access).
 *
 * If attaching fails the checkout is deliberately left in place. The result says so explicitly
 * (`created`) instead of pretending nothing happened or deleting anything.
 */
export async function attachCreatedWorktree(params: {
  registry: WorkspaceRegistry;
  workspace: RegisteredWorkspace;
  created: GitWorktreeCreateResult;
  listWorktrees: () => Promise<GitWorktreeListResult>;
}): Promise<GitWorktreeCreateResult> {
  const { registry, workspace, created, listWorktrees } = params;
  const worktree = created.worktree;
  if (!created.success || !worktree) return created;

  const environmentId = workspace.location.environmentId;
  const createdPath = toPosixPath(worktree.path);
  const partial = (reason: string): GitWorktreeCreateResult => ({
    success: false,
    created: true,
    worktree: { ...worktree, path: createdPath },
    error: `The worktree${worktree.branch ? ` for branch "${worktree.branch}"` : ''} was created at ${createdPath} `
      + `but could not be attached to this workspace: ${reason}. The checkout and branch were kept; `
      + 'refresh the worktree list to find it.',
  });

  try {
    const listing = await listWorktrees();
    if (!listing.success) return partial(listing.error || 'Git could not list the repository worktrees');

    const comparable = (entryPath: string): string => {
      if (environmentId !== LOCAL_ENVIRONMENT_ID) return entryPath;
      try { return toPosixPath(fs.realpathSync.native(entryPath)); } catch { return entryPath; }
    };
    const target = { environmentId, path: comparable(createdPath) };
    const listed = listing.worktrees.find((entry) => !entry.isMain
      && isSameWorkspaceIdentity({ environmentId, path: comparable(entry.path) }, target));
    if (!listed) return partial('Git does not list it as a linked worktree of this repository');

    const main = listing.worktrees.find((entry) => entry.isMain);
    const registration = await registry.registerCheckoutContext({
      workspaceId: workspace.workspaceId,
      path: createdPath,
      kind: 'worktree',
      branch: listed.branch ?? worktree.branch,
      mainCheckoutPath: main?.path,
    });
    if (!registration.success || !registration.checkoutContext) {
      return partial(registration.error || 'the checkout could not be registered');
    }
    return { ...created, worktree: { ...worktree, path: createdPath }, checkoutContext: registration.checkoutContext };
  } catch (error) {
    return partial(error instanceof Error ? error.message : 'the checkout could not be registered');
  }
}
