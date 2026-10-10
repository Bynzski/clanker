import type { NativeAttentionCapability } from './attentionSignal';
/**
 * Main -> renderer description of an agent checkout transition (issue #102).
 *
 * Main is the only authority: it performs the transition and then *reports* what is now true. The
 * renderer applies these events to its descriptive state and never initiates, confirms or alters
 * one. Every identity here was derived by main (registry, terminal table, Git), never taken from a
 * model or from renderer input.
 *
 * Events for one transition are sent in the order they became true:
 *   `checkout-attached` -> `terminal-replaced` -> `checkout-released` -> `notice`.
 * `terminal-replaced` always precedes the old terminal's exit, so the pane adopts the replacement
 * instead of showing a dead terminal.
 */
import type { CheckoutContext } from './checkoutContext';

export interface ReplacementTerminal {
  id: string;
  pid: number;
  /** Where it was launched (POSIX). */
  workingDir: string;
  checkoutContextId: string;
  environmentId: string;
  harnessId: string;
  attentionEnabled: boolean;
  attention?: NativeAttentionCapability;
}

export type AgentCheckoutTransitionEvent =
  /** A worktree context main registered for the workspace (also sent when the launch into it later failed, so the inactive checkout stays visible). */
  | { kind: 'checkout-attached'; workspaceId: string; checkoutContext: CheckoutContext }
  /** The pane of `previousTerminalId` is now served by `terminal`, same conversation, another checkout. */
  | { kind: 'terminal-replaced'; workspaceId: string; previousTerminalId: string; terminal: ReplacementTerminal }
  /** Same live terminal and turn, only its main-proven checkout binding changed. */
  | { kind: 'terminal-checkout-changed'; workspaceId: string; terminalId: string; checkoutContextId: string; workingDir: string }
  /** Main released (unregistered) this worktree context. */
  | { kind: 'checkout-released'; workspaceId: string; checkoutContextId: string }
  /** Outcome the user should see (the agent that asked can no longer be told). */
  | { kind: 'notice'; workspaceId: string; tone: 'info' | 'warning'; message: string };
