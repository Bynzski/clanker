import * as fs from 'node:fs';
import type { GitWorktreeCreateResult, GitWorktreeListResult } from '../shared/types/git';
import type { AdoptWorktreeCheckoutContextResult } from '../shared/types/checkoutContext';
import { LOCAL_ENVIRONMENT_ID } from '../shared/types/environments';
import { toNativePath, toPosixPath } from '../shared/pathNormalize';
import { isSameWorkspaceIdentity } from '../shared/workspaceIdentity';
import type { RegisteredWorkspace, WorkspaceRegistry } from './workspaceRegistry';

/**
 * Git's listed worktree whose root is `worktreePath`, compared by environment path identity (local
 * paths symlink-resolved where they exist). Shared by every route that matches a checkout against
 * Git's own listing.
 */
export function findListedWorktree(
  listing: GitWorktreeListResult, environmentId: string, worktreePath: string,
): GitWorktreeListResult['worktrees'][number] | null {
  const comparable = (entryPath: string): string => {
    if (environmentId !== LOCAL_ENVIRONMENT_ID) return entryPath;
    try { return toPosixPath(fs.realpathSync.native(toNativePath(entryPath, process.platform))); } catch { return toPosixPath(entryPath); }
  };
  const target = { environmentId, path: comparable(worktreePath) };
  return listing.worktrees.find((entry) => isSameWorkspaceIdentity({ environmentId, path: comparable(entry.path) }, target)) ?? null;
}

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

/**
 * Explicitly adopts an existing linked worktree as a `worktree` checkout context. The caller names
 * only a path; it is accepted solely if Git's own listing for this workspace's repository contains
 * it as a usable linked worktree, and the registered root is Git's listed path (never the caller's
 * string), validated again by the workspace's environment. Fails closed for the main checkout, the
 * workspace's own root, missing (prunable) and locked entries, and anything Git does not list.
 * Idempotent: an already registered root returns its existing context.
 */
export async function adoptListedWorktree(params: {
  registry: WorkspaceRegistry;
  workspace: RegisteredWorkspace;
  worktreePath: unknown;
  listWorktrees: () => Promise<GitWorktreeListResult>;
}): Promise<AdoptWorktreeCheckoutContextResult> {
  const { registry, workspace, worktreePath, listWorktrees } = params;
  const fail = (error: string): AdoptWorktreeCheckoutContextResult => ({ success: false, error });
  if (typeof worktreePath !== 'string' || !worktreePath.trim()) return fail('Choose a worktree to use');

  const environmentId = workspace.location.environmentId;

  try {
    const listing = await listWorktrees();
    if (!listing.success) return fail(listing.error || 'Git could not list the repository worktrees');
    const listed = findListedWorktree(listing, environmentId, worktreePath);
    if (!listed) return fail('Git does not list that path as a worktree of this repository');
    if (listed.isMain) return fail('The main checkout cannot be used as an isolated worktree');
    if (findListedWorktree({ success: true, worktrees: [listed] }, environmentId, workspace.location.path)) {
      return fail('That checkout is already this workspace\'s own checkout');
    }
    if (listed.isPrunable) return fail('That worktree\'s directory is missing; prune it from the Git menu');
    if (listed.isLocked) return fail('That worktree is locked; unlock it from the Git menu first');

    const main = listing.worktrees.find((entry) => entry.isMain);
    const registration = await registry.registerCheckoutContext({
      workspaceId: workspace.workspaceId,
      path: toPosixPath(listed.path),
      kind: 'worktree',
      branch: listed.branch ?? undefined,
      mainCheckoutPath: main?.path,
    });
    if (!registration.success || !registration.checkoutContext) {
      return fail(registration.error || 'The checkout could not be registered');
    }
    return { success: true, checkoutContext: registration.checkoutContext };
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'The checkout could not be registered');
  }
}
