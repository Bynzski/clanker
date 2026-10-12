import { defineCapability, type AgentBridgeCallContext, type AgentBridgeCapability, type AgentBridgeToolResult } from './capabilities';
import type { AgentBridgeCaller } from './capabilities';

/**
 * Compatibility conversation-relocation transactions. Routine Git worktree management
 * does not depend on these provider adapters. Inputs never select caller authority:
 * workspace, terminal, checkout, harness and paths come from authenticated main state.
 */
export interface AgentCheckoutLifecyclePort {
  /** Move the calling conversation into a new Clanker-owned isolated checkout. */
  create(caller: AgentBridgeCaller, input: { branch: string }, signal: AbortSignal): Promise<AgentBridgeToolResult>;
  /** Move the calling conversation back to the main checkout and clean up the isolated one. */
  complete(caller: AgentBridgeCaller, input: { deleteBranch?: boolean; discardIgnored?: boolean }, signal: AbortSignal): Promise<AgentBridgeToolResult>;
}

/**
 * Long enough for a worktree to be created and a conversation to be resumed and observed, short enough
 * to stay bounded (the bridge hard-caps every capability). A call that is cut off before its commit
 * point rolls back; one past it finishes its cleanup under the lifecycle service's ownership.
 */
export const CHECKOUT_LIFECYCLE_TIMEOUT_MS = 30_000;

/** Longest branch name accepted; Git's own validation (check-ref-format) decides the rest. */
export const MAX_BRANCH_LENGTH = 200;

export const CREATE_ISOLATED_CHECKOUT = 'clanker_create_isolated_checkout';
export const COMPLETE_ISOLATED_CHECKOUT = 'clanker_complete_isolated_checkout';

/** Optional relocation guidance, not Git authority or a security boundary. */
export const CREATE_DESCRIPTION = 'Compatibility operation: use only when the user explicitly requests moving this existing conversation into a new isolated checkout. '
  + 'For ordinary worktree creation or a new agent, use Git/provider-native tools or Clanker checkout selection instead. '
  + 'Clanker creates a worktree and resumes this conversation there using the provider-specific strategy; this is not same-turn live relocation. '
  + 'After calling, finish your reply without running more tools; the conversation continues on its next turn. Native conversation identification and attached attention hooks are required.';
export const COMPLETE_DESCRIPTION = 'Compatibility operation: use only when the user explicitly requests moving this conversation back to main AND removing its old checkout. '
  + 'Do not call merely because an agent or task is finished; worktrees remain until separately removed. '
  + 'This resumes the conversation before safe cleanup. deleteBranch optionally deletes only a fully merged branch, never force-deletes it. '
  + 'After calling, finish your reply without running more tools; the conversation continues on its next turn. Native conversation identification and attached attention hooks are required.';

export function liveCheckoutToolDescription(name: string, fallback: string): string {
  if (name === CREATE_ISOLATED_CHECKOUT) return 'Compatibility operation: use only for explicitly requested relocation of this conversation into a new isolated checkout. '
    + 'Clanker moves this same live root conversation through the provider native mechanism and confirms its checkout before returning. '
    + 'On success, continue this same turn in the returned checkout. On failure do not assume movement or remove any checkout.';
  if (name === COMPLETE_ISOLATED_CHECKOUT) return 'Compatibility operation: use only for explicitly requested relocation back to main AND removal of the old checkout, never merely because a task finished. '
    + 'Clanker confirms native movement before releasing or removing the isolated checkout. On success continue this same turn in main. '
    + 'deleteBranch only deletes a fully merged branch; discardIgnored preserves ignored-only contents in Trash/recovery. '
    + 'On failure or partial cleanup, do not remove checkouts yourself.';
  return fallback;
}

export function createCheckoutLifecycleCapabilities(port: AgentCheckoutLifecyclePort): AgentBridgeCapability[] {
  const run = (context: AgentBridgeCallContext) => ({ caller: context.caller, signal: context.signal });
  return [
    defineCapability({
      name: CREATE_ISOLATED_CHECKOUT,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      description: CREATE_DESCRIPTION,
      requires: 'checkout-rehoming',
      timeoutMs: CHECKOUT_LIFECYCLE_TIMEOUT_MS,
      input: {
        branch: { type: 'string', required: true, minLength: 1, maxLength: MAX_BRANCH_LENGTH, description: 'Name of the new branch to work on.' },
      },
      run: (input, context) => port.create(run(context).caller, input, run(context).signal),
    }),
    defineCapability({
      name: COMPLETE_ISOLATED_CHECKOUT,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      description: COMPLETE_DESCRIPTION,
      requires: 'checkout-rehoming',
      timeoutMs: CHECKOUT_LIFECYCLE_TIMEOUT_MS,
      input: {
        discardIgnored: { type: 'boolean', description: 'Allow removal only when all remaining changes are ignored files. Preserves them with the whole checkout in Trash/recovery; never discards tracked or ordinary untracked work.' },
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
