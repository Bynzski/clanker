import { findHarnessProvider } from '../harnesses/registry';
import type { CheckoutRehomeMode, HarnessCheckoutRehomeCapability } from '../harnesses/types';

/**
 * Whether a harness conversation can be moved to another checkout by resuming it there, judged from
 * the provider's own proven capabilities (never from its name, and never from MCP support alone):
 *
 * - `sessions.resume` is a native local operation (the replacement is that CLI's real resume);
 * - `sessions.resumesWithoutOriginalDirectory === true`: the CLI was shown to continue a conversation
 *   from a directory other than the one it started in (see docs/harness-integration.md "Removed-worktree
 *   resume"). Anything unproven keeps its conversation where it started;
 * - the provider declares an explicit `checkoutRehome` strategy. `resumesWithoutOriginalDirectory` only
 *   says a conversation can be resumed once its directory is gone; it does not say a *running* one can be
 *   moved, and the two strategies (hot replacement, after the turn) are very different;
 * - local attention exists: the live conversation's native session id is learned from native lifecycle
 *   events (the attention broker), never from the model, so a harness without them cannot be identified.
 *
 * The bridge itself is required too: only a launch that has it can ask.
 */
export function supportsCheckoutRehoming(harness: string): boolean {
  const provider = findHarnessProvider(harness);
  const resume = provider?.sessions?.resume;
  return Boolean(
    provider?.agentBridge
    && provider.checkoutRehome
    && provider.attention?.local
    && provider.sessions?.resumesWithoutOriginalDirectory === true
    && resume
    && (!resume.transports || resume.transports.includes('local')),
  );
}

/**
 * Whether *this launch* gets the checkout lifecycle tools: the harness can be re-homed and the user
 * enabled agent attention for it (without attention the live conversation cannot be identified, so
 * the tools would only ever fail and are not offered).
 */
export function grantsCheckoutRehoming(harness: string, options: { attentionEnabled: boolean }): boolean {
  return options.attentionEnabled && supportsCheckoutRehoming(harness);
}

/** The provider's explicit strategy for moving a live conversation, or undefined when it has none. */
export function checkoutRehomeOf(harness: string): HarnessCheckoutRehomeCapability | undefined {
  return supportsCheckoutRehoming(harness) ? findHarnessProvider(harness)?.checkoutRehome : undefined;
}

export function checkoutRehomeModeOf(harness: string): CheckoutRehomeMode | undefined {
  return checkoutRehomeOf(harness)?.mode;
}
