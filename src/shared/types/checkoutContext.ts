/**
 * Checkout Context Types
 *
 * A checkout context is one validated working root inside an environment: the
 * directory a terminal launches in and that Git / filesystem operations are
 * confined to. A workspace owns one or more contexts; every workspace has a
 * `main` context for the root it was registered with.
 *
 * It describes root identity only. It is deliberately not workspace-shaped
 * (no layout, terminals, or UI state).
 */

import type { WorkspaceEnvironmentId } from './environments';

export type CheckoutContextKind = 'main' | 'worktree';

export interface CheckoutContext {
  /** Stable identity. The main context's id is derived from its workspace id. */
  id: string;
  /** Owning workspace/project registration. */
  workspaceId: string;
  environmentId: WorkspaceEnvironmentId;
  /**
   * Canonical root (POSIX separators; remote paths stay POSIX on the host).
   * Each context is validated independently; a context never widens another's root.
   */
  path: string;
  kind: CheckoutContextKind;
  /** Current branch where known; descriptive only. */
  branch?: string | null;
  /**
   * Root of the repository's main checkout when this is a linked worktree and it is known.
   * Descriptive metadata only: it is not a registered root and must never authorize filesystem,
   * Git, or terminal access. Reaching it requires its own environment-validated context.
   */
  mainCheckoutPath?: string;
}
