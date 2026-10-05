import type { CheckoutContext, ReleaseCheckoutContextResult } from '../shared/types/checkoutContext';
import { LOCAL_ENVIRONMENT_ID } from '../shared/types/environments';
import { toNativePath } from '../shared/pathNormalize';
import { isInsideRoot } from './localPathContainment';
import { isPathContained } from './remote/remotePaths';
import type { WorkspaceRegistry } from './workspaceRegistry';

/** The facts about a Clanker-owned terminal that decide whether a checkout is in use. */
export interface TerminalUsage {
  checkoutContextId?: string;
  environmentId?: string;
  /** Desktop directory of a local terminal (meaningless for SSH terminals). */
  cwd?: string;
  /** Host directory recorded when an SSH terminal was launched. */
  remoteWorkingDir?: string;
}

const isLocal = (environmentId: string | undefined): boolean =>
  !environmentId || environmentId === LOCAL_ENVIRONMENT_ID;

/**
 * Whether a live terminal is using the context's root. A terminal counts when it was launched
 * into the context, or when its directory is inside the root regardless of how it was launched
 * (a shell that was cd'ed there). A terminal whose directory cannot be verified is treated as
 * using it: fail closed.
 */
function isUsing(terminal: TerminalUsage, context: CheckoutContext, registry: WorkspaceRegistry): boolean {
  if (terminal.checkoutContextId === context.id) return true;
  if (isLocal(context.environmentId)) {
    if (!isLocal(terminal.environmentId)) return false;
    return !terminal.cwd || isInsideRoot(toNativePath(context.path, process.platform), terminal.cwd);
  }
  if (isLocal(terminal.environmentId)
    || registry.getWorktreeResourceId(terminal.environmentId!) !== registry.getWorktreeResourceId(context.environmentId)) {
    return false;
  }
  return !terminal.remoteWorkingDir || isPathContained(context.path, terminal.remoteWorkingDir);
}

/**
 * How many of `terminals` are using the context's root by the same rule release enforces. A terminal
 * can be excluded by id (the lifecycle transaction's own, which is about to be retired).
 */
export function countTerminalsUsingContext(
  registry: WorkspaceRegistry, context: CheckoutContext, terminals: Iterable<[string, TerminalUsage]>, exceptTerminalId?: string,
): number {
  let active = 0;
  for (const [id, terminal] of terminals) {
    if (id !== exceptTerminalId && isUsing(terminal, context, registry)) active++;
  }
  return active;
}

/**
 * Releases a worktree checkout context owned by a workspace so the checkout can go through
 * inspection and removal. It only unregisters the context: no worktree, branch or process is
 * touched, and nothing is re-registered if a later step fails.
 *
 * Deliberately synchronous. The terminal scan and the unregister happen in one turn, so no
 * launch can slip in between; a launch still resolving is refused by the late registration
 * check in SPAWN_TERMINAL once the context is gone. Safety is judged from main's terminal
 * table and registry, never from anything the renderer reports.
 */
export function releaseCheckoutContext(params: {
  registry: WorkspaceRegistry;
  terminals: Iterable<TerminalUsage>;
  workspaceId: unknown;
  checkoutContextId: unknown;
}): ReleaseCheckoutContextResult {
  const { registry, terminals, workspaceId, checkoutContextId } = params;
  if (typeof workspaceId !== 'string' || !workspaceId.trim()
    || typeof checkoutContextId !== 'string' || !checkoutContextId.trim()) {
    return { success: false, error: 'Invalid checkout context release request' };
  }
  if (!registry.getWorkspace(workspaceId)) {
    return { success: false, error: 'Workspace is not registered' };
  }
  // Resolve through the workspace so a context of another workspace is indistinguishable from an unknown one.
  const context = registry.resolveCheckoutContext(workspaceId, checkoutContextId);
  if (!context || registry.getCheckoutContext(checkoutContextId) !== context) {
    return { success: false, error: 'Checkout context is not registered for this workspace' };
  }
  if (context.kind !== 'worktree') {
    return { success: false, error: 'Only a worktree checkout context can be released' };
  }

  let active = 0;
  for (const terminal of terminals) {
    if (isUsing(terminal, context, registry)) active++;
  }
  if (active > 0) {
    return {
      success: false,
      activeTerminals: active,
      error: `${active} running terminal${active === 1 ? ' is' : 's are'} still using this checkout; close ${active === 1 ? 'it' : 'them'} first`,
    };
  }

  if (!registry.unregisterCheckoutContext(context.id)) {
    return { success: false, error: 'Checkout context could not be released' };
  }
  return { success: true };
}
