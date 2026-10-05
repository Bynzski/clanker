import { defineCapability, type AgentBridgeCallContext, type AgentBridgeCapability, type AgentBridgeToolResult } from './capabilities';
import type { AgentBridgeCaller } from './capabilities';

/**
 * The two high-level checkout transactions an agent may ask Clanker to perform. They are
 * transactions, not Git wrappers: there is deliberately no create-branch, create-worktree,
 * change-cwd, delete-worktree or delete-branch primitive, because each exposes an unsafe ordering and
 * allows a split between where the conversation runs and what Clanker thinks it owns.
 *
 * The model supplies operation data only (a branch name, a cleanup preference). The workspace,
 * terminal, checkout, harness and every path come from the authenticated caller and main's own state.
 */
export interface AgentCheckoutLifecyclePort {
  /** Move the calling conversation into a new Clanker-owned isolated checkout. */
  create(caller: AgentBridgeCaller, input: { branch: string }, signal: AbortSignal): Promise<AgentBridgeToolResult>;
  /** Move the calling conversation back to the main checkout and clean up the isolated one. */
  complete(caller: AgentBridgeCaller, input: { deleteBranch?: boolean }, signal: AbortSignal): Promise<AgentBridgeToolResult>;
}

/**
 * Long enough for a worktree to be created and a conversation to be resumed and observed, short enough
 * to stay bounded (the bridge hard-caps every capability). A call that is cut off before its commit
 * point rolls back; one past it finishes its cleanup under the lifecycle service's ownership.
 */
export const CHECKOUT_LIFECYCLE_TIMEOUT_MS = 30_000;

/** Longest branch name accepted; Git's own validation (check-ref-format) decides the rest. */
export const MAX_BRANCH_LENGTH = 200;

export function createCheckoutLifecycleCapabilities(port: AgentCheckoutLifecyclePort): AgentBridgeCapability[] {
  const run = (context: AgentBridgeCallContext) => ({ caller: context.caller, signal: context.signal });
  return [
    defineCapability({
      name: 'clanker_create_isolated_checkout',
      description: 'Create a new isolated Git worktree for this conversation on a new branch and move this same conversation into it, '
        + 'using Clanker. Clanker restarts the agent process in the new checkout, so this call ends your current turn: your next '
        + 'turn runs in the isolated checkout. Do not create worktrees yourself.',
      requires: 'checkout-rehoming',
      timeoutMs: CHECKOUT_LIFECYCLE_TIMEOUT_MS,
      input: {
        branch: { type: 'string', required: true, minLength: 1, maxLength: MAX_BRANCH_LENGTH, description: 'Name of the new branch to work on.' },
      },
      run: (input, context) => port.create(run(context).caller, input, run(context).signal),
    }),
    defineCapability({
      name: 'clanker_complete_isolated_checkout',
      description: 'Finish the isolated checkout this conversation is running in, using Clanker: move this same conversation back to '
        + 'the main checkout, then remove the isolated worktree. Call it after your work is merged. Clanker restarts the agent process '
        + 'in the main checkout, so this call ends your current turn. Do not remove the worktree or its branch yourself.',
      requires: 'checkout-rehoming',
      timeoutMs: CHECKOUT_LIFECYCLE_TIMEOUT_MS,
      input: {
        deleteBranch: { type: 'boolean', description: 'Also delete the isolated branch if Git considers it fully merged. It is never force-deleted.' },
      },
      run: (input, context) => port.complete(run(context).caller, input, run(context).signal),
    }),
  ];
}

/**
 * The capabilities are built before the services they call exist (the bridge is created at module
 * scope; the Git and session controllers only once the app is ready). Until a real port is bound the
 * tools answer with a bounded "unavailable" instead of failing in an undefined way.
 */
export function deferredLifecyclePort(): { port: AgentCheckoutLifecyclePort; bind(implementation: AgentCheckoutLifecyclePort): void } {
  let bound: AgentCheckoutLifecyclePort | undefined;
  const unavailable: AgentBridgeToolResult = { isError: true, data: { error: 'Checkout lifecycle is not available yet' } };
  return {
    port: {
      create: (caller, input, signal) => (bound ? bound.create(caller, input, signal) : Promise.resolve(unavailable)),
      complete: (caller, input, signal) => (bound ? bound.complete(caller, input, signal) : Promise.resolve(unavailable)),
    },
    bind(implementation) { bound = implementation; },
  };
}
