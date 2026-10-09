/**
 * Renderer-facing account contract. Display-safe projections only: no filesystem paths,
 * provider tokens, auth URLs or provider-native account identifiers ever appear here.
 */
export type HarnessAccountId = string;

/** The synthetic native account. It maps to the provider's own home and is never stored or removable. */
export const DEFAULT_HARNESS_ACCOUNT_ID: HarnessAccountId = 'default';

export type HarnessAccountStatus = 'connected' | 'needs-auth' | 'unknown';

export interface SafeHarnessAccount {
  /** Opaque Clanker identity ('default' or a main-issued managed ID). */
  id: HarnessAccountId;
  harness: string;
  kind: 'default' | 'managed';
  /** User-chosen friendly label; not unique. */
  label?: string;
  /** Provider-reported, display-only. */
  email?: string;
  plan?: string;
  status: HarnessAccountStatus;
  selected: boolean;
}

export interface HarnessAccountList {
  environmentId: string;
  harness: string;
  /** False when managed accounts cannot be created for this harness/environment. */
  managedSupported: boolean;
  /** Safe explanation shown when `managedSupported` is false for an account-capable harness. */
  unsupportedReason?: string;
  accounts: SafeHarnessAccount[];
}

export type AccountAuthState =
  | { status: 'starting' }
  | { status: 'waiting-for-browser' }
  | { status: 'connected'; account: SafeHarnessAccount }
  | { status: 'failed'; message: string }
  | { status: 'cancelled' };

export interface HarnessAccountAuthStart {
  flowId: string;
  state: AccountAuthState;
}

export interface HarnessAccountAuthEvent {
  flowId: string;
  environmentId: string;
  harness: string;
  state: AccountAuthState;
}

export const HARNESS_ACCOUNT_LABEL_MAX = 40;

export interface HarnessAccountChange {
  type: 'added' | 'removed' | 'reconnected' | 'selected';
  accountId: HarnessAccountId;
  harness: string;
  environmentId?: string;
}
