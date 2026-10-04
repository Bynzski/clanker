import type { HarnessId } from '../harnessIds';
import type { CheckoutContext } from './checkoutContext';

/**
 * The linked worktree a conversation ran in. Presentation provenance derived by main from Git and the
 * registered checkout contexts; never an authority for launching (main re-derives it on resume).
 */
export interface SessionCheckout {
  /** Branch Git reports for the worktree, or null when unknown (removed worktrees, detached HEAD). */
  branch: string | null;
  /** Canonical POSIX worktree root. */
  path: string;
  /** False once the checkout was removed or its directory is gone. */
  exists: boolean;
}

export interface HarnessSession {
  id: string;
  harness: HarnessId;
  title: string;
  cwd: string;
  timestamp: number;
  modelId?: string;
  provider?: string;
  /** File path used by Pi and OMP for precise session resume/fork. */
  filePath?: string;
  /**
   * Opaque Clanker account that owns this session's native storage. Absent for the native/default
   * account. Provenance only: main re-verifies it before any launch and never trusts it as authority.
   */
  accountId?: string;
  /** Set when the session ran in a linked worktree of the workspace's repository. */
  checkout?: SessionCheckout;
}

/**
 * A removed worktree's conversation that can only continue in its original directory. Main offers to
 * recreate that worktree from its branch; resuming never recreates anything without this being
 * confirmed by a second, explicit invocation.
 */
export interface RecreateCheckoutOffer {
  branch: string;
  path: string;
}

export interface SessionInvokeOptions {
  /** Confirms an earlier `recreateCheckout` offer. Main re-derives and re-verifies everything. */
  recreateCheckout?: boolean;
}

/** A launched resumed conversation. */
export interface SessionLaunchResult {
  id: string;
  pid: number;
  harnessId?: string;
  attentionEnabled?: boolean;
  workingDir?: string;
  /** The context main bound the terminal to; a worktree context is included so the workspace can record it. */
  checkoutContextId?: string;
  checkoutContext?: CheckoutContext;
  /** Set when the conversation could not resume where it started (e.g. its worktree was removed). */
  resumeNotice?: string;
}

/** Either a launch, or an offer (nothing was launched or created) to recreate a removed worktree. */
export type SessionInvokeResult = SessionLaunchResult | { recreateOffer: RecreateCheckoutOffer };
