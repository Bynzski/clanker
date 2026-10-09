/** Bounded local observer ACK vocabulary. No identity or user content crosses back to hooks. */
export const ATTENTION_VERDICTS = [
  'accepted-changed', 'accepted-idempotent', 'ignored-child', 'ignored-stale',
  'rejected-mismatch', 'rejected-ambiguous', 'rejected-invalid', 'rejected-auth', 'rejected-transport',
] as const;
export type AttentionVerdict = typeof ATTENTION_VERDICTS[number];
export const ATTENTION_ACK_PREFIX = 'clanker-attention-v1:';
export const MAX_ATTENTION_ACK_BYTES = 96;
