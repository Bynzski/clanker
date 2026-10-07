import type { GitWorktree } from '../shared/types/git';
import type { CheckoutContext } from '../shared/types/checkoutContext';
import { isSameWorkspaceIdentity } from '../shared/workspaceIdentity';
import type { WorkspaceRegistry } from './workspaceRegistry';
import { countTerminalsUsingContext, type TerminalUsage } from './checkoutContextRelease';

/** Repository-wide pruning must not discard metadata for a Clanker-owned working root. */
export function guardWorktreePrune(
  registry: WorkspaceRegistry, environmentId: string, entries: GitWorktree[], usages: Iterable<TerminalUsage>,
): string | null {
  const terminals = [...usages].map((usage, index): [string, TerminalUsage] => [String(index), usage]);
  const roots = registry.getAllWorkspaces().map((workspace): [string, TerminalUsage] => [workspace.workspaceId, {
    environmentId: workspace.location.environmentId,
    cwd: workspace.location.path,
    remoteWorkingDir: workspace.location.path,
  }]);
  for (const entry of entries) {
    const probe: CheckoutContext = {
      id: '', workspaceId: '', environmentId, path: entry.path, kind: 'worktree',
    };
    if (countTerminalsUsingContext(registry, probe, roots) > 0
      || countTerminalsUsingContext(registry, probe, terminals) > 0) {
      return `Cannot prune while a workspace, terminal or dev server uses ${entry.path}; close or stop it first`;
    }
    // A terminal's launch binding still counts even when its last reported directory is elsewhere.
    for (const context of registry.getAllCheckoutContexts()) {
      if (registry.getWorktreeResourceId(context.environmentId) !== registry.getWorktreeResourceId(environmentId)
        || !isSameWorkspaceIdentity({ environmentId, path: context.path }, { environmentId, path: entry.path })) continue;
      if (countTerminalsUsingContext(registry, context, terminals) > 0) {
        return `Cannot prune while a terminal or dev server uses ${entry.path}; close or stop it first`;
      }
    }
  }
  return null;
}
