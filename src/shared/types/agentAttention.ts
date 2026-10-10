import type { AttentionSignal } from './attentionSignal';
/** Authoritative agent attention state. `AgentAttentionBroker` in main is the only lifecycle
 * authority: it correlates provider evidence into these semantic facts and publishes them as
 * revisioned snapshots. The renderer caches snapshots and projects presentation from them; it
 * never replays transitions. Facts are independent (runtime, pending request, completion
 * provenance, latest outcome) and carry no UI concepts such as colours or "seen" state. */

/** `unverified`: nothing proven yet (fresh registration, or after a session boundary).
 * `idle`: root bound, no foreground turn. `starting`: Clanker submitted a prompt and the
 * provider has not yet named its turn. `running`: an identified foreground turn is live.
 * `failed`: the latest foreground turn ended on a proven provider failure. */
export type AgentRuntimeStatus = 'unverified' | 'idle' | 'starting' | 'running' | 'failed';

/** `null` kind: the wait is proven but the provider cannot prove input vs approval. */
export type AgentPendingRequestKind = 'input' | 'approval';

/** Which class of evidence established a fact. Structured provider evidence always outranks
 * a fallback detector (see `attentionAuthority.ts`). */
export type AgentAttentionEvidence = 'structured' | 'fallback';

/** Where the agent reports it is working now. Presentation only: it never re-binds the terminal's
 * launch context or changes what the terminal may reach. */
export interface AgentLocation {
  /** Canonical POSIX path (a host path for SSH terminals). */
  path: string;
  /** The registered checkout context of the terminal's workspace containing `path`, resolved by
   * main when the location was reported; null when it is in none. */
  checkoutContextId: string | null;
}

export interface AgentAttentionSnapshot {
  terminalId: string;
  /** Main-owned acquisition/health facts; absent on legacy snapshots. */
  signal?: AttentionSignal;
  /** Monotonic per terminal, across registration replacement. Advances only when an authoritative lifecycle or signal-health fact changes. */
  revision: number;
  /** Bound native root session. */
  sessionId: string | null;
  runtime: {
    status: AgentRuntimeStatus;
    /** Native turn, or a provider-owned epoch; `null` while `starting` or without a foreground turn. */
    turnId: string | null;
    startedAt: number | null;
  };
  /** A durable wait on the user. Present until its matching resolution or its turn's boundary. */
  pendingRequest: {
    id: string | null;
    turnId: string | null;
    kind: AgentPendingRequestKind | null;
    evidence: AgentAttentionEvidence;
    /** Snapshot revision at which the request appeared; a UI acknowledgement watermark target. */
    revision: number;
    createdAt: number;
  } | null;
  /** Latest *proven foreground completion*. Historical: never cleared by new work. */
  lastCompletion: {
    turnId: string | null;
    revision: number;
    completedAt: number;
  } | null;
  /** Latest foreground outcome of any kind. A completion is only a current Done while it is
   * also the latest outcome, so an older completion cannot resurface after a newer turn was
   * interrupted, failed, or the session ended. */
  lastOutcome: {
    kind: 'completed' | 'interrupted' | 'failed' | 'session_ended';
    turnId: string | null;
    revision: number;
    at: number;
  } | null;
  /** Latest location the root agent reported; null until it reports one. Survives a native session
   * boundary (the agent is still where it was) and is gone with the agent on exit. */
  location: AgentLocation | null;
}

/** Pushed on every authoritative change. `snapshot: null` is a revisioned tombstone: the agent
 * was retired (harness exit or terminal release) and nothing older may resurrect it. */
export interface AgentAttentionChange {
  terminalId: string;
  revision: number;
  snapshot: AgentAttentionSnapshot | null;
}
