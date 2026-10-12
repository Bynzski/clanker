import type { GitWorktree, GitWorktreeListResult, GitWorktreeRemoveResult } from '../shared/types/git';
import type { ReconcileCheckoutContextsResult } from '../shared/types/checkoutContext';
import { mainCheckoutContextId } from '../shared/checkoutContext';
import { countTerminalsUsingContext, type TerminalUsage } from './checkoutContextRelease';
import { findListedWorktree } from './worktreeContextAttachment';
import type { RegisteredWorkspace, WorkspaceRegistry } from './workspaceRegistry';

/** Main-only exception for unused associations, never a waiver of actual occupancy. */
export interface WorktreeRemovalAuthority {
  contextIds: ReadonlySet<string>;
  validate(): void;
}

/** One Git-centered removal transaction. Registration is retained until the outcome is known. */
export async function removeListedWorktree(params: {
  registry: WorkspaceRegistry;
  workspace: RegisteredWorkspace;
  path: unknown;
  expectedBranch: unknown;
  usages: () => Iterable<TerminalUsage>;
  list: () => Promise<GitWorktreeListResult>;
  remove: (entry: GitWorktree, authority: WorktreeRemovalAuthority) => Promise<GitWorktreeRemoveResult>;
  reconcile: (workspace: RegisteredWorkspace) => Promise<ReconcileCheckoutContextsResult>;
}): Promise<GitWorktreeRemoveResult> {
  const { registry, workspace, expectedBranch } = params;
  const fail = (error: string): GitWorktreeRemoveResult => ({ success: false, outcome: 'unchanged', error });
  let dispatched = false;
  if (typeof params.path !== 'string' || !params.path.trim()
    || (expectedBranch !== null && typeof expectedBranch !== 'string')) return fail('Invalid worktree removal request');
  try {
    const listing = await params.list();
    if (!listing.success) return fail(listing.error || 'Could not list worktrees');
    const environmentId = workspace.location.environmentId;
    const entry = findListedWorktree(listing, environmentId, params.path);
    if (!entry || entry.isMain) return fail('Git does not list that path as a linked worktree; refresh worktrees');
    if (entry.isLocked || entry.isPrunable) return fail('Worktree is missing or locked; use Unlock or Prune missing worktrees');
    if (entry.branch !== expectedBranch) return fail('Worktree branch changed; inspect it again');
    const sameHost = (id: string) => id === environmentId || (id !== 'local' && environmentId !== 'local'
      && registry.getWorktreeResourceId(id) === registry.getWorktreeResourceId(environmentId));
    const contexts = registry.getAllCheckoutContexts().filter((context) => sameHost(context.environmentId)
      && findListedWorktree({ success: true, worktrees: [entry] }, environmentId, context.path));
    if (contexts.some((context) => context.id === mainCheckoutContextId(context.workspaceId))) {
      return fail('Close the workspace opened in this checkout before removing it');
    }
    const affectedWorkspaces = new Map([[workspace.workspaceId, workspace]]);
    for (const context of contexts) {
      const owner = registry.getWorkspace(context.workspaceId);
      if (!owner) return fail('Checkout workspace is no longer registered; refresh worktrees');
      affectedWorkspaces.set(owner.workspaceId, owner);
    }
    const authority: WorktreeRemovalAuthority = {
      contextIds: new Set(contexts.map((context) => context.id)),
      validate: () => {
        if (registry.getWorkspace(workspace.workspaceId) !== workspace
          || contexts.some((context) => registry.getCheckoutContext(context.id) !== context)) {
          throw new Error('Workspace or checkout registration changed; inspect it again');
        }
        // The synthetic descriptor checks path occupancy even for an unattached Git entry.
        const target = { id: '', workspaceId: workspace.workspaceId, environmentId, path: entry.path, kind: 'worktree' as const };
        const usages = [...params.usages()].map((usage, index): [string, TerminalUsage] => [String(index), usage]);
        if ([target, ...contexts].some((context) => countTerminalsUsingContext(registry, context, usages) > 0)) {
          throw new Error('A terminal, agent or dev server is using this checkout; stop it before removal');
        }
      },
    };
    authority.validate();
    dispatched = true;
    const result = await params.remove(entry, authority);
    // Preflight failure leaves the original association intact. Unknown host outcomes stay reserved.
    if (result.success || result.outcome === 'recovery-required' || (result.outcome === 'unknown' && environmentId === 'local')) {
      const reconciliations: NonNullable<GitWorktreeRemoveResult['reconciliations']> = [];
      for (const affected of affectedWorkspaces.values()) {
        let reconciliation: ReconcileCheckoutContextsResult;
        try {
          reconciliation = registry.getWorkspace(affected.workspaceId) === affected
            ? await params.reconcile(affected)
            : { success: false, error: 'Workspace changed before checkout reconciliation' };
        } catch (error) {
          reconciliation = { success: false, error: error instanceof Error ? error.message : 'Could not reconcile checkout registrations' };
        }
        reconciliations.push({ workspaceId: affected.workspaceId, result: reconciliation });
      }
      const warning = reconciliations.some((update) => !update.result.success)
        ? [result.warning, 'Some checkout registrations could not be reconciled. Refresh worktrees in the affected workspaces.'].filter(Boolean).join('\n')
        : result.warning;
      return { ...result, warning, reconciliations,
        reconciliation: reconciliations.find((update) => update.workspaceId === workspace.workspaceId)!.result };
    }
    return result;
  } catch (error) {
    return { ...fail(error instanceof Error ? error.message : 'Could not remove worktree'), outcome: dispatched ? 'unknown' : 'unchanged' };
  }
}
