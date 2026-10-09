import type { CiSummary, PullRequestContext, ReviewSummary, VcsProblem, VcsProblemCode } from './types';

const messages: Record<VcsProblemCode, string> = {
  'auth-required': 'Provider authentication is required or secure credentials are unavailable.',
  forbidden: 'Provider access is denied; check repository permissions.',
  'rate-limited': 'Provider rate limit reached.',
  'network-error': 'Provider network is unavailable.',
  unsupported: 'Provider context is unsupported for this checkout or instance.',
  cancelled: 'Provider request cancelled.', timeout: 'Provider request deadline exhausted.',
  'malformed-response': 'Provider returned invalid data.', 'response-too-large': 'Provider response exceeds the size limit.',
  incomplete: 'Provider pagination exceeded its bounded limit.', 'not-found': 'Provider resource is unavailable or not accessible.',
  stale: 'Checkout or provider HEAD changed during discovery.', unknown: 'Provider information is unavailable.',
};
export function providerDefaultBranch(value: unknown): string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value) ? value : '';
}
export function problem(code: VcsProblemCode, retryAfterMs?: number): VcsProblem {
  return { code, message: messages[code], ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
}
export function unavailablePr(error: VcsProblem): PullRequestContext {
  return { outcome: error.code, problem: error };
}
export type CheckState = 'success' | 'failure' | 'pending' | 'neutral' | 'unknown';
/** This summarizes observed checks, not provider branch-protection/mergeability rules. */
export function aggregateChecks(states: CheckState[], sha?: string, error?: VcsProblem): CiSummary {
  const state = states.includes('failure') ? 'failure'
    : error || states.includes('unknown') ? 'unknown'
      : states.includes('pending') ? 'pending'
        : states.includes('success') ? 'success'
          : states.length ? 'unknown' : 'none';
  return { state, sha, ...(error ? { problem: error } : {}) };
}
export interface EffectiveReview { id: number; reviewer: string; state: string }
/** Comments/drafts do not erase a submitted decision; dismissal explicitly does. */
export function aggregateReviews(reviews: EffectiveReview[]): ReviewSummary {
  const effective = new Map<string, string>();
  for (const review of [...reviews].sort((a, b) => a.id - b.id)) {
    if (review.state === 'DISMISSED') effective.delete(review.reviewer);
    else if (['APPROVED', 'CHANGES_REQUESTED'].includes(review.state)) effective.set(review.reviewer, review.state);
    // COMMENTED and draft PENDING records establish no review requirement.
    // Outstanding requests are checked separately against native PR metadata.
  }
  const states = [...effective.values()];
  return { state: states.includes('CHANGES_REQUESTED') ? 'changes_requested'
    : states.includes('APPROVED') ? 'approved' : 'none' };
}
