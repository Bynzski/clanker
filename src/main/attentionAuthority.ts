import type { AgentAttentionEvidence, AgentRuntimeStatus } from '../shared/types/agentAttention';

/** How completely a provider's structured lifecycle covers the foreground turn.
 * `full`: start, request, resolution and settle are all provable; fallback evidence is never consulted.
 * `partial`: some boundary is unobservable (for example Claude has no interrupt hook, OMP
 * exposes no input waits, and Pi's prompt hooks do not cover every built-in dialog), so narrowly
 * scoped fallback evidence may fill specific gaps. */
export type StructuredAuthority = 'full' | 'partial';

/** Provenance of a provider's structured evidence, for diagnostics. */
export type SourceQuality = 'native' | 'hook';

/** Provider-specific evidence from the live bottom viewport. There is deliberately no
 * production producer yet: Clanker has no trustworthy main-process access to live screen
 * state, and generic PTY heuristics (silence, prompt regexes, scrollback) are forbidden.
 * The seam exists so the arbitration policy is centralized and tested before a detector lands. */
export type FallbackEvidence = 'visible_blocker' | 'visible_working' | 'visible_idle';

export type FallbackSuppression =
  | 'full-authority'
  | 'no-active-turn'
  | 'ambiguous-idle'
  | 'working-cannot-create-state'
  | 'structured-request-owns-wait'
  | 'request-already-pending';

export type FallbackVerdict =
  | { action: 'raise_request' }
  | { action: 'clear_request' }
  | { action: 'ignore'; reason: FallbackSuppression };

export interface FallbackContext {
  authority: StructuredAuthority;
  status: AgentRuntimeStatus;
  pendingEvidence: AgentAttentionEvidence | null;
}

/** The single place that decides whether lower-confidence evidence may influence state.
 * Invariants: fallback never outranks structured evidence, never creates a turn or a
 * completion, and an idle-looking screen is never proof of anything. */
export function arbitrateFallback(evidence: FallbackEvidence, context: FallbackContext): FallbackVerdict {
  if (context.authority === 'full') return { action: 'ignore', reason: 'full-authority' };
  if (evidence === 'visible_idle') return { action: 'ignore', reason: 'ambiguous-idle' };
  if (evidence === 'visible_blocker') {
    // A blocker is only meaningful inside a foreground turn the structured source proved.
    if (context.status !== 'running' && context.status !== 'starting') return { action: 'ignore', reason: 'no-active-turn' };
    return context.pendingEvidence ? { action: 'ignore', reason: 'request-already-pending' } : { action: 'raise_request' };
  }
  // visible_working may only retire a wait that fallback itself raised.
  if (context.pendingEvidence === 'fallback') return { action: 'clear_request' };
  return { action: 'ignore', reason: context.pendingEvidence === 'structured' ? 'structured-request-owns-wait' : 'working-cannot-create-state' };
}
