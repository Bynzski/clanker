import type { CheckoutContext } from './checkoutContext';

/** Discovery is descriptive. Only a confirmed, revalidated attachment grants a checkout root. */
export interface ObservedWorktreeCandidate {
  path: string;
  branch: string | null;
  locked: boolean;
  lockReason?: string;
}
export interface ObservedWorktreeResult {
  success: boolean;
  candidate?: ObservedWorktreeCandidate;
  checkoutContext?: CheckoutContext;
  error?: string;
}
