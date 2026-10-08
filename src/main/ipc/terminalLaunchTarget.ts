import type { WorkspaceRegistry } from '../workspaceRegistry';

/** Resolve launch identity once; keep exact-object revalidation for the pre-PTY boundary. */
export function resolveTerminalLaunchTarget(
  registry: WorkspaceRegistry | undefined,
  workingDir: string,
  workspaceId?: string,
  environmentId?: string,
  checkoutContextId?: string,
) {
  let resolvedWorkspace = workspaceId ? registry?.getWorkspace(workspaceId) : null;
  if (workspaceId && registry && !resolvedWorkspace) {
    throw new Error('Workspace is not registered or not accessible');
  }
  if (!resolvedWorkspace && workingDir && !environmentId) {
    resolvedWorkspace = registry?.getWorkspaceByLocation('local', workingDir) ?? null;
  }
  if (environmentId && resolvedWorkspace && environmentId !== resolvedWorkspace.location.environmentId) {
    throw new Error('Workspace environment does not match registered workspace');
  }
  if (checkoutContextId !== undefined && (typeof checkoutContextId !== 'string' || !checkoutContextId.trim())) {
    throw new Error('Invalid checkout context');
  }
  // An implicit main context and an explicit worktree context have the same authority rules.
  // Only a legacy launch resolving neither workspace nor context remains unbound.
  const checkoutContext = resolvedWorkspace && registry
    ? registry.resolveCheckoutContext(resolvedWorkspace.workspaceId, checkoutContextId)
    : null;
  if ((resolvedWorkspace || checkoutContextId) && !checkoutContext) {
    throw new Error('Checkout context is not registered for this workspace');
  }
  const isResolvedTargetCurrent = (): boolean => {
    if (!resolvedWorkspace) return true;
    if (registry?.getWorkspace(resolvedWorkspace.workspaceId) !== resolvedWorkspace) return false;
    return !checkoutContext || registry.getCheckoutContext(checkoutContext.id) === checkoutContext;
  };
  return { resolvedWorkspace, checkoutContext, isResolvedTargetCurrent };
}
