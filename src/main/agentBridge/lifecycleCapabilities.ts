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

export const CREATE_ISOLATED_CHECKOUT = 'clanker_create_isolated_checkout';
export const COMPLETE_ISOLATED_CHECKOUT = 'clanker_complete_isolated_checkout';

/**
 * The text the model reads when it decides how to create or finish a worktree. It is discoverability, not
 * a security boundary (nothing here stops a shell command), and it exists because smoke tests showed both
 * Claude and Codex otherwise reach for their own worktree mechanisms: Claude's `EnterWorktree`, Codex's
 * `git worktree remove`. Some harnesses load tool schemas lazily, so the description itself carries the
 * rule rather than relying on the server instructions alone.
 */
export const CREATE_DESCRIPTION = 'Use this whenever you need to create or enter an isolated worktree or branch to work in while running in Clanker. '
  + 'Prefer this over `git worktree add`, Claude `EnterWorktree`, Codex `--worktree` or any other provider-native worktree creation, because '
  + 'Clanker must track the checkout and move this same conversation into it. Give it a new branch name; Clanker creates the worktree, '
  + 'then restarts this conversation inside it. After calling it, finish your reply without running more tools: the conversation continues '
  + 'in the isolated checkout on its next turn. Use normal Git and GitHub tools for everything else. Native conversation identification is required; for Codex, enable Clanker hooks in /hooks before requesting a move.';
export const COMPLETE_DESCRIPTION = 'Use this after the work in an isolated checkout is merged or finished, whenever you would otherwise remove or leave that worktree. '
  + 'Prefer this over `git worktree remove`, Claude `ExitWorktree`, `git branch -d/-D` or any manual worktree or branch cleanup, because '
  + 'Clanker must move this same conversation back to the main checkout before it removes the isolated one. Pass deleteBranch to also delete '
  + 'the branch when Git considers it fully merged (it is never force-deleted). After calling it, finish your reply without running more '
  + 'tools: the conversation continues in the main checkout on its next turn. Use normal Git and GitHub tools to commit, push, open and merge pull requests first. Native conversation identification is required; for Codex, enable Clanker hooks in /hooks before requesting a move.';

export function createCheckoutLifecycleCapabilities(port: AgentCheckoutLifecyclePort): AgentBridgeCapability[] {
  const run = (context: AgentBridgeCallContext) => ({ caller: context.caller, signal: context.signal });
  return [
    defineCapability({
      name: CREATE_ISOLATED_CHECKOUT,
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
      description: COMPLETE_DESCRIPTION,
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
