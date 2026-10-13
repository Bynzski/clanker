import { HOOK_DIAGNOSTICS, type HookDiagnostic, type NativeAttentionCapability, type AttentionSignal, type AttentionSignalDiagnostics } from '../shared/types/attentionSignal';
import { ATTENTION_ACK_PREFIX, type AttentionVerdict } from '../shared/attentionProtocol';
import { createHash, randomBytes } from 'node:crypto';
import * as net from 'node:net';
import { attentionTelemetry } from './attentionTelemetry';
import type {
  AgentAttentionChange, AgentAttentionEvidence, AgentAttentionSnapshot, AgentLocation, AgentPendingRequestKind, AgentRuntimeStatus,
} from '../shared/types/agentAttention';
import { unresolvedAgentLocation, type AgentLocationResolver } from './agentLocation';
import {
  arbitrateFallback, type FallbackEvidence, type FallbackSuppression, type SourceQuality, type StructuredAuthority,
} from './attentionAuthority';

/** Wire events. `session_continued` is an identity transition; `agent_exited` retires the registration.
 * `location_changed` only moves the agent's reported location; any root event may also carry `cwd`. */
type WireEvent =
  | 'turn_provisional' | 'turn_activity' | 'turn_started' | 'input_requested' | 'input_resolved' | 'turn_completed' | 'turn_interrupted'
  | 'observer_diagnostic' | 'turn_failed' | 'session_started' | 'session_ended' | 'session_continued' | 'session_replaced' | 'agent_exited' | 'location_changed';
const EVENTS = new Set<WireEvent>([
  'turn_provisional', 'turn_activity', 'turn_started', 'input_requested', 'input_resolved', 'turn_completed', 'turn_interrupted', 'turn_failed',
  'session_started', 'session_ended', 'session_continued', 'session_replaced', 'agent_exited', 'location_changed', 'observer_diagnostic',
]);
const MAX_RETIRED_TURNS = 32;
const MAX_MESSAGE_BYTES = 2048;
const MAX_REMEMBERED_REVISIONS = 1024;
const EVENT_FIELDS = new Set([
  'version', 'token', 'harness', 'event', 'sessionId', 'turnId', 'scope', 'inputId', 'requestKind', 'nativeEvent', 'continuesSessionId',
  'cwd', 'diagnostic', 'previousSessionId',
]);
const NATIVE_EVENT = /^[A-Za-z0-9_.:-]{1,64}$/;
const DIAGNOSTIC_ID_LENGTH = 64;
/** Always-on bounded trace: enough to classify a field report without a debug build. */
const MAX_TRACE_ENTRIES = 64;
const MAX_TRACED_TERMINALS = 64;
/** Generous so a busy main loop processes a delivered event instead of dropping it unread. */
const SOCKET_IDLE_TIMEOUT_MS = 10_000;

/** Provider-asserted subject of an event. Anything other than an explicit root fails closed. */
type Scope = 'root' | 'child';

export type AttentionDecision = 'accepted' | 'ignored-child' | 'ignored-stale' | 'rejected-mismatch' | 'rejected-ambiguous';

/** Safe metadata only: never prompts, responses, tool payloads, or credentials. */
export interface AttentionDiagnostic {
  harness: string;
  terminalId: string;
  nativeEvent?: string;
  sessionId?: string;
  turnId?: string;
  semantic: WireEvent | FallbackEvidence;
  decision: AttentionDecision | 'fallback-accepted' | `fallback-suppressed:${FallbackSuppression}`;
  /** Registration revision after the decision; unchanged when the event changed nothing. */
  revision?: number;
  verdict?: AttentionVerdict;
  status?: AgentRuntimeStatus;
}

export interface AttentionRegistrationOptions {
  capability?: NativeAttentionCapability;
  /** Main-validated native session a non-fork resume continues. Never renderer-supplied. */
  rootSessionId?: string;
  /** How completely the provider's structured lifecycle covers a turn. Defaults to `full`,
   * which keeps every lower-confidence source suppressed. */
  authority?: StructuredAuthority;
  quality?: SourceQuality;
  /** See `HarnessAttentionCapability.sessionModel`. Defaults to `shared`. */
  sessionModel?: 'process' | 'shared';
}

/** One bounded, content-free trace entry. Session and turn identities are short hashes. */
export interface AttentionTraceEntry {
  at: number;
  semantic: string;
  nativeEvent?: string;
  verdict?: string;
  revision: number;
  status: AgentRuntimeStatus | 'retired';
  session?: string;
  turn?: string;
}

export type AttentionEffectiveState = 'unverified' | 'idle' | 'working' | 'needs_input' | 'provisional' | 'failed';

/** Developer-facing answer to "why does this agent show this state?". Safe metadata only. */
export interface AttentionExplanation {
  terminalId: string;
  harness: string;
  transport: 'local' | 'remote';
  effective: AttentionEffectiveState;
  source: { quality: SourceQuality; authority: StructuredAuthority; effectiveEvidence: AgentAttentionEvidence };
  snapshot: AgentAttentionSnapshot;
  lastAccepted?: { semantic: string; nativeEvent?: string; revision: number };
  lastRejected?: { semantic: string; nativeEvent?: string; decision: string };
  lastFallback?: { evidence: FallbackEvidence; decision: string };
  /** Why the most recent weaker evidence did not change state, if it did not. */
  suppressedFallbackReason?: FallbackSuppression;
  signal?: AttentionSignal;
  delivery?: AttentionSignalDiagnostics;
}

interface PendingRequest {
  resolutionUnknown?: true;
  turnId?: string;
  inputId?: string;
  kind: AgentPendingRequestKind | null;
  evidence: AgentAttentionEvidence;
  revision: number;
  createdAt: number;
}

interface Registration {
  signal?: AttentionSignal;
  received: number;
  verdicts: Partial<Record<AttentionVerdict, number>>;
  hooks: Partial<Record<HookDiagnostic, number>>;
  lastVerdict?: AttentionVerdict;
  lastNativeEvent?: string;
  terminalId: string;
  harness: string;
  transport: 'local' | 'remote';
  authority: StructuredAuthority;
  quality: SourceQuality;
  sessionModel: 'process' | 'shared';
  /** The root was seeded from a validated resume and has not reported yet. Until it does, no other
   * session may replace it (an auxiliary thread starting first must not take the terminal). */
  seedUnconfirmed?: boolean;
  revision: number;
  /** Revision at which the current candidate stop was observed (status `provisional`). */
  provisionalRevision?: number;
  rootSessionId?: string;
  /** Foreground turn identity: native, or a provider-owned epoch for harnesses without one. */
  activeTurnId?: string;
  /** Completed or superseded turns; a late event from one can never touch a newer turn. */
  retiredTurns: string[];
  status: AgentRuntimeStatus;
  startedAt: number | null;
  /** Every proven outstanding wait, oldest first. A wait clears only by its own resolution or
   * its turn's boundary, so one resolving request can never hide another that is still open. */
  pending: PendingRequest[];
  lastCompletion: AgentAttentionSnapshot['lastCompletion'];
  lastOutcome: AgentAttentionSnapshot['lastOutcome'];
  location: AgentLocation | null;
  locationEvidence?: { sessionId: string; lastReportedAt: number };
  locationInvalidated?: boolean;
  /** Native delivery batches lifecycle, location and signal health into one publication. */
  deferPublication?: boolean;
  lastAccepted?: AttentionExplanation['lastAccepted'];
  lastRejected?: AttentionExplanation['lastRejected'];
  lastFallback?: AttentionExplanation['lastFallback'];
  suppressedFallbackReason?: FallbackSuppression;
}

interface ParsedEvent {
  diagnostic?: HookDiagnostic;
  event: WireEvent;
  continuesSessionId?: string;
  previousSessionId?: string;
  sessionId?: string;
  turnId?: string;
  scope?: Scope;
  inputId?: string;
  requestKind?: AgentPendingRequestKind;
  nativeEvent?: string;
  location?: AgentLocation;
}

export interface AgentAttentionBrokerOptions {
  /** Canonicalizes a reported directory and resolves its checkout context. Defaults to a canonical
   * path in no context. A report it rejects rejects the whole event. */
  resolveLocation?: AgentLocationResolver;
}

const pendingEvidence = (registration: Registration): AgentAttentionEvidence | null =>
  registration.pending.some((request) => request.evidence === 'structured') ? 'structured'
    : registration.pending.length > 0 ? 'fallback' : null;

function defaultDiagnostics(diagnostic: AttentionDiagnostic): void {
  if (process.env.CLANKER_DEBUG_ATTENTION === '1') {
    const { harness, terminalId, nativeEvent, semantic, decision, verdict, revision, status } = diagnostic;
    console.debug('[clanker-grid] attention', JSON.stringify({ harness, terminalId, nativeEvent, semantic, decision, verdict, revision, status }));
  }
}

const isActive = (registration: Registration): boolean => registration.status === 'starting' || registration.status === 'running';
const traceId = (value: string | undefined): string | undefined => value
  ? createHash('sha256').update(value).digest('hex').slice(0, 8) : undefined;

/** Lifecycle authority for agent attention. A terminal token proves which terminal
 * emitted an event; root-session and turn correlation decide whether it may
 * change foreground state. Provider semantics live in the providers, not here.
 *
 * The broker publishes complete, revisioned snapshots. The revision advances only when an
 * authoritative fact changes: lifecycle duplicates do not move it; concrete changes to signal health do. */
export class AgentAttentionBroker {
  private readonly registrations = new Map<string, Registration>();
  private readonly tokensByTerminal = new Map<string, string>();
  /** Diagnostic-only retired credentials: full digests, no authority, bounded to 64 / one minute. */
  private readonly retiredCredentials = new Map<string, { terminalId: string; harness: string; transport: 'local' | 'remote'; at: number; revision: number }>();
  /** Highest revision ever issued per terminal, so a replaced registration never goes backwards. */
  private readonly revisionFloors = new Map<string, number>();
  /** Per-terminal trace, retained after release so a retirement can still be explained. */
  private readonly traces = new Map<string, AttentionTraceEntry[]>();
  /** Envelopes that could not be attributed to any terminal (bad token, malformed). */
  private unattributed = 0;
  private server: net.Server | null = null;
  private startPromise: Promise<number> | null = null;
  private readonly resolveLocation: AgentLocationResolver;

  constructor(
    private readonly onChange: (change: AgentAttentionChange) => void,
    private readonly onDiagnostic: (diagnostic: AttentionDiagnostic) => void = defaultDiagnostics,
    private readonly now: () => number = Date.now,
    options: AgentAttentionBrokerOptions = {},
  ) {
    this.resolveLocation = options.resolveLocation ?? unresolvedAgentLocation;
  }

  async start(): Promise<number> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise<number>((resolve, reject) => {
      const server = net.createServer({ allowHalfOpen: true }, (socket) => {
        socket.setTimeout(SOCKET_IDLE_TIMEOUT_MS, () => socket.destroy());
        let body = '';
        socket.on('data', (chunk: Buffer) => {
          if (Buffer.byteLength(body) + chunk.length > MAX_MESSAGE_BYTES) {
            socket.destroy();
            return;
          }
          body += chunk.toString('utf8');
        });
        socket.on('end', () => {
          socket.end(ATTENTION_ACK_PREFIX + this.receive(body) + '\n');
        });
        socket.on('error', () => undefined);
      });
      server.maxConnections = 64;
      server.once('error', (error) => {
        this.startPromise = null;
        reject(error);
      });
      server.listen(0, '127.0.0.1', () => {
        this.server = server;
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Could not bind agent attention listener'));
          return;
        }
        resolve(address.port);
      });
    });
    return this.startPromise;
  }

  async register(terminalId: string, harness: string, options: AttentionRegistrationOptions = {}): Promise<Record<string, string>> {
    const port = await this.start();
    const token = this.add(terminalId, harness, 'local', options);
    return {
      CLANKER_ATTENTION_PORT: String(port),
      CLANKER_ATTENTION_TOKEN: token,
      CLANKER_ATTENTION_HARNESS: harness,
    };
  }

  /** SSH credentials are fresh and cannot authenticate to the desktop listener. */
  registerRemote(terminalId: string, harness: string, options: AttentionRegistrationOptions = {}): string {
    return this.add(terminalId, harness, 'remote', options);
  }

  private add(terminalId: string, harness: string, transport: 'local' | 'remote', options: AttentionRegistrationOptions): string {
    this.release(terminalId);
    const token = randomBytes(32).toString('hex');
    this.registrations.set(token, {
      ...(options.capability ? { signal: { ...options.capability, health: 'unverified' as const } } : {}),
      received: 0, verdicts: {}, hooks: {},
      terminalId, harness, transport, retiredTurns: [], status: 'unverified', startedAt: null, pending: [],
      authority: options.authority ?? 'full', quality: options.quality ?? 'hook', sessionModel: options.sessionModel ?? 'shared',
      lastCompletion: null, lastOutcome: null, location: null,
      revision: this.issueRevision(terminalId),
      ...(options.rootSessionId ? { rootSessionId: options.rootSessionId, seedUnconfirmed: true } : {}),
    });
    this.tokensByTerminal.set(terminalId, token);
    this.record(this.registrations.get(token)!, { semantic: 'registered' });
    return token;
  }

  receiveRemote(terminalId: string, raw: string): AttentionVerdict {
    return this.receiveEvent(raw, terminalId);
  }

  /** Unconditional final release: PTY exit/kill, failed launch, or retirement. A live agent is
   * retired with a revisioned tombstone so no older snapshot can resurrect it. */
  release(terminalId: string): void {
    const token = this.tokensByTerminal.get(terminalId);
    const registration = token ? this.registrations.get(token) : undefined;
    if (token) this.registrations.delete(token);
    this.tokensByTerminal.delete(terminalId);
    if (!registration) return;
    if (isActive(registration)) this.record(registration, { semantic: 'release-without-settlement' });
    registration.revision = this.issueRevision(terminalId);
    const digest = createHash('sha256').update(token!).digest('hex');
    for (const [key, retired] of this.retiredCredentials) if (this.now() - retired.at >= 60_000) this.retiredCredentials.delete(key);
    this.retiredCredentials.set(digest, { terminalId, harness: registration.harness, transport: registration.transport, at: this.now(), revision: registration.revision });
    if (this.retiredCredentials.size > 64) this.retiredCredentials.delete(this.retiredCredentials.keys().next().value!);
    this.traceEntry(terminalId, { at: Date.now(), semantic: 'released', revision: registration.revision, status: 'retired' });
    this.onChange({ terminalId, revision: registration.revision, snapshot: null });
  }

  /** Bounded trace of what this terminal's attention received and decided, newest last. */
  trace(terminalId: string): AttentionTraceEntry[] {
    return (this.traces.get(terminalId) ?? []).map((item) => ({ ...item }));
  }

  private record(registration: Registration, entry: Pick<AttentionTraceEntry, 'semantic' | 'nativeEvent' | 'verdict' | 'session' | 'turn'>): void {
    this.traceEntry(registration.terminalId, { at: Date.now(), revision: registration.revision, status: registration.status, ...entry });
  }

  private traceEntry(terminalId: string, entry: AttentionTraceEntry): void {
    const clean = Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined)) as unknown as AttentionTraceEntry;
    const list = this.traces.get(terminalId) ?? [];
    this.traces.delete(terminalId);
    this.traces.set(terminalId, [...list, clean].slice(-MAX_TRACE_ENTRIES));
    attentionTelemetry()?.record(terminalId, clean);
    if (this.traces.size > MAX_TRACED_TERMINALS) {
      const oldest = this.traces.keys().next().value;
      if (oldest !== undefined) this.traces.delete(oldest);
    }
  }

  /** Envelopes no terminal could be blamed for (invalid or unauthenticated). */
  unattributedCount(): number {
    return this.unattributed;
  }

  close(): void {
    this.registrations.clear();
    this.tokensByTerminal.clear();
    this.retiredCredentials.clear();
    this.traces.clear();
    this.server?.close();
    this.server = null;
    this.startPromise = null;
  }

  private current(terminalId: string): Registration | undefined {
    const token = this.tokensByTerminal.get(terminalId);
    return token ? this.registrations.get(token) : undefined;
  }

  private issueRevision(terminalId: string): number {
    const next = (this.revisionFloors.get(terminalId) ?? 0) + 1;
    this.revisionFloors.delete(terminalId);
    this.revisionFloors.set(terminalId, next);
    if (this.revisionFloors.size > MAX_REMEMBERED_REVISIONS) {
      const oldest = this.revisionFloors.keys().next().value;
      if (oldest !== undefined && !this.tokensByTerminal.has(oldest)) this.revisionFloors.delete(oldest);
    }
    return next;
  }

  /** Copy-safe public view; never exposes registration internals. */
  snapshot(terminalId: string): AgentAttentionSnapshot | null {
    const registration = this.current(terminalId);
    return registration ? this.toSnapshot(registration) : null;
  }

  /** Main-only authenticated evidence. A session boundary makes it historical, not proof of vacancy.
   * No timeout proves an idle harness has left its directory; final agent/PTY release removes it. */
  locationObservation(terminalId: string): {
    location: AgentLocation; sessionId: string; lastReportedAt: number; state: 'current' | 'last-reported' | 'unavailable';
  } | null {
    const registration = this.current(terminalId);
    if (!registration?.location || !registration.locationEvidence) return null;
    return {
      location: { ...registration.location }, ...registration.locationEvidence,
      state: registration.locationInvalidated ? 'unavailable' : registration.rootSessionId === registration.locationEvidence.sessionId ? 'current' : 'last-reported',
    };
  }

  /** Every live registration. Retired agents are absent, so hydration cannot recreate them. */
  snapshots(): AgentAttentionSnapshot[] {
    return [...this.registrations.values()].map((registration) => this.toSnapshot(registration));
  }

  private toSnapshot(r: Registration): AgentAttentionSnapshot {
    const request = r.pending.find(entry => !entry.resolutionUnknown) ?? r.pending[0];
    return {
      terminalId: r.terminalId,
      ...(r.signal ? { signal: { ...r.signal } } : {}),
      revision: r.revision,
      sessionId: r.rootSessionId ?? null,
      runtime: {
        status: r.status, turnId: r.activeTurnId ?? null, startedAt: r.startedAt,
        ...(r.status === 'provisional' && r.provisionalRevision !== undefined ? { stopRevision: r.provisionalRevision } : {}),
      },
      // Prefer the oldest actionable wait; otherwise retain the oldest unresolved history.
      pendingRequest: request ? {
        ...(request.resolutionUnknown ? { resolutionUnknown: true } : {}),
        id: request.inputId ?? null, turnId: request.turnId ?? null, kind: request.kind,
        evidence: request.evidence, revision: request.revision, createdAt: request.createdAt,
      } : null,
      lastCompletion: r.lastCompletion ? { ...r.lastCompletion } : null,
      lastOutcome: r.lastOutcome ? { ...r.lastOutcome } : null,
      location: r.location ? { ...r.location } : null,
      locationProvenance: r.location && r.locationEvidence ? {
        state: r.locationInvalidated ? 'unavailable' : r.rootSessionId === r.locationEvidence.sessionId ? 'current' : 'last-reported',
        sessionId: r.locationEvidence.sessionId,
      } : null,
    };
  }

  /** Why an agent is in its current state: effective state, source authority, the latest
   * accepted and rejected evidence, and any suppressed fallback. */
  explain(terminalId: string): AttentionExplanation | null {
    const r = this.current(terminalId);
    if (!r) return null;
    const effective: AttentionEffectiveState = r.status === 'provisional' ? 'provisional' : r.pending.some(request => !request.resolutionUnknown) ? 'needs_input'
      : isActive(r) ? 'working' : r.status === 'failed' ? 'failed' : r.status === 'idle' ? 'idle' : 'unverified';
    return {
      terminalId: r.terminalId, harness: r.harness, transport: r.transport, effective,
      source: { quality: r.quality, authority: r.authority, effectiveEvidence: pendingEvidence(r) ?? 'structured' },
      snapshot: this.toSnapshot(r),
      ...(r.signal ? { signal: { ...r.signal } } : {}),
      delivery: this.signalDiagnostics(terminalId)!,
      ...(r.lastAccepted ? { lastAccepted: { ...r.lastAccepted } } : {}),
      ...(r.lastRejected ? { lastRejected: { ...r.lastRejected } } : {}),
      ...(r.lastFallback ? { lastFallback: { ...r.lastFallback } } : {}),
      ...(r.suppressedFallbackReason ? { suppressedFallbackReason: r.suppressedFallbackReason } : {}),
    };
  }

  /** Acquisition updates use the same registration/revision stream as lifecycle facts. */
  setCapability(terminalId: string, capability: NativeAttentionCapability): void {
    const r = this.current(terminalId);
    if (!r) return;
    this.commit(r, () => { r.signal = { ...capability, health: 'unverified' }; });
  }

  signalDiagnostics(terminalId: string): AttentionSignalDiagnostics | null {
    const r = this.current(terminalId);
    if (!r) return null;
    return {
      terminalId, harness: r.harness, transport: r.transport, signal: r.signal ? { ...r.signal } : null,
      revision: r.revision, status: r.status, received: r.received,
      verdicts: { ...r.verdicts }, hooks: { ...r.hooks },
      ...(r.lastVerdict ? { lastVerdict: r.lastVerdict } : {}),
      ...(r.lastNativeEvent ? { lastNativeEvent: r.lastNativeEvent } : {}),
    };
  }

  /** Apply one authoritative semantic mutation: advance the revision, run the change with that
   * revision, and publish the resulting snapshot. */
  private commit(registration: Registration, mutate: (revision: number) => void): void {
    registration.revision = this.issueRevision(registration.terminalId);
    mutate(registration.revision);
    if (!registration.deferPublication) {
      this.onChange({ terminalId: registration.terminalId, revision: registration.revision, snapshot: this.toSnapshot(registration) });
    }
  }

  /** Public for focused validation tests; the transport uses the same boundary. */
  isReady(terminalId: string): boolean {
    return this.handoffState(terminalId) === 'ready';
  }

  handoffState(terminalId: string): 'unverified' | 'ready' | 'running' | 'needs_input' | 'provisional' | 'unavailable' {
    const registration = this.current(terminalId);
    if (!registration) return 'unavailable';
    // After ambiguous identity evidence the cached root may not be the visible conversation.
    // Never let its old completion authorize a write; accepted turn evidence restores health.
    if (registration.signal?.reason === 'identity-rejected') return 'unavailable';
    if (registration.status === 'provisional') return 'provisional';
    if (isActive(registration)) return registration.pending.some(request => !request.resolutionUnknown) ? 'needs_input' : 'running';
    return registration.status === 'idle' && registration.lastOutcome?.kind === 'completed' ? 'ready' : 'unverified';
  }

  /** Finished presentation is not input readiness: another Stop hook may continue this turn.
   * Preserve the existing explicit user choice for an unverified, non-active agent. */
  canHandoff(terminalId: string): boolean {
    const state = this.handoffState(terminalId);
    return state === 'unverified' || state === 'ready';
  }

  /** Clanker itself submitted a prompt: a new foreground turn starts without a native event. */
  markSubmitted(terminalId: string): void {
    const registration = this.current(terminalId);
    const state = this.handoffState(terminalId);
    if (!registration || state !== 'ready') return;
    // The native start event must establish the turn identity before anything can settle it.
    this.commit(registration, () => {
      // Only established readiness may retire the previous turn.
      if (registration.activeTurnId) this.retire(registration, registration.activeTurnId);
      registration.pending = [];
      registration.status = 'starting';
      registration.activeTurnId = undefined;
      registration.startedAt = this.now();
    });
    this.record(registration, { semantic: 'submitted' });
  }

  /** The provider can no longer deliver lifecycle events for this terminal (for example its hooks
   * run in a directory that is gone), so an open turn or wait could never be settled. Retires them
   * without a completion and returns the agent to unverified; the registration, its bound root and
   * location stay, and a later native turn start recovers normally. Returns whether anything changed. */
  markLifecycleLost(terminalId: string): boolean {
    const registration = this.current(terminalId);
    if (!registration || (!isActive(registration) && registration.status !== 'provisional' && registration.pending.length === 0)) return false;
    this.commit(registration, () => {
      if (registration.activeTurnId) this.retire(registration, registration.activeTurnId);
      registration.activeTurnId = undefined;
      registration.pending = [];
      registration.status = 'unverified';
      registration.startedAt = null;
      registration.locationInvalidated = true;
      if (registration.signal) registration.signal = { ...registration.signal, health: 'lost', reason: 'directory-removed' };
    });
    this.record(registration, { semantic: 'lifecycle-lost' });
    return true;
  }

  /** Lower-confidence, provider-specific live-screen evidence. Arbitrated centrally: it can
   * never override structured evidence, create a turn, or create a completion. Nothing in
   * production produces this yet (see `attentionAuthority.ts`). */
  receiveFallback(terminalId: string, evidence: FallbackEvidence): void {
    const registration = this.current(terminalId);
    if (!registration) return;
    const verdict = arbitrateFallback(evidence, {
      authority: registration.authority, status: registration.status, pendingEvidence: pendingEvidence(registration),
    });
    let decision: NonNullable<AttentionExplanation['lastFallback']>['decision'];
    if (verdict.action === 'ignore') {
      registration.suppressedFallbackReason = verdict.reason;
      decision = `fallback-suppressed:${verdict.reason}`;
    } else {
      registration.suppressedFallbackReason = undefined;
      decision = 'fallback-accepted';
      this.commit(registration, (revision) => {
        registration.pending = verdict.action === 'raise_request'
          ? [{ turnId: registration.activeTurnId, kind: null, evidence: 'fallback', revision, createdAt: this.now() }]
          : registration.pending.filter((request) => request.evidence !== 'fallback');
      });
    }
    registration.lastFallback = { evidence, decision };
    this.onDiagnostic({
      harness: registration.harness, terminalId, semantic: evidence,
      decision: decision as AttentionDiagnostic['decision'], revision: registration.revision, status: registration.status,
    });
  }

  receive(raw: string): AttentionVerdict {
    return this.receiveEvent(raw);
  }

  private parse(raw: string, remoteTerminalId?: string): { registration: Registration; parsed: ParsedEvent } | { registration: Registration; rejection: AttentionVerdict } | AttentionVerdict {
    if (Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) return 'rejected-invalid';
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return 'rejected-invalid'; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'rejected-invalid';
    const data = value as Record<string, unknown>;
    if (data.version !== 1 || typeof data.token !== 'string') return 'rejected-invalid';
    const registration = this.registrations.get(data.token);
    if (!registration || data.harness !== registration.harness) {
      if (!registration && /^[a-f0-9]{64}$/.test(data.token)) {
        const retired = this.retiredCredentials.get(createHash('sha256').update(data.token).digest('hex'));
        if (retired && this.now() - retired.at < 60_000 && data.harness === retired.harness
          && (remoteTerminalId === undefined ? retired.transport === 'local' : retired.transport === 'remote' && retired.terminalId === remoteTerminalId)) {
          this.traceEntry(retired.terminalId, { at: this.now(), semantic: 'late-retired-delivery', verdict: 'rejected-auth', revision: retired.revision, status: 'retired' });
        }
      }
      return 'rejected-auth';
    }
    if (remoteTerminalId === undefined ? registration.transport !== 'local'
      : registration.transport !== 'remote' || registration.terminalId !== remoteTerminalId) return 'rejected-transport';
    if (Object.keys(data).some((key) => !EVENT_FIELDS.has(key))) return { registration, rejection: 'rejected-invalid' };
    if (typeof data.event !== 'string' || !EVENTS.has(data.event as WireEvent)) return { registration, rejection: 'rejected-invalid' };
    for (const key of ['sessionId', 'turnId', 'inputId', 'continuesSessionId', 'previousSessionId'] as const) {
      if (data[key] !== undefined && (typeof data[key] !== 'string' || data[key].length === 0 || data[key].length > 128)) return { registration, rejection: 'rejected-invalid' };
    }
    if (data.scope !== undefined && data.scope !== 'root' && data.scope !== 'child') return { registration, rejection: 'rejected-invalid' };
    if (data.diagnostic !== undefined && !HOOK_DIAGNOSTICS.includes(data.diagnostic as HookDiagnostic)) return { registration, rejection: 'rejected-invalid' };
    if (data.event === 'observer_diagnostic' && data.diagnostic === undefined) return { registration, rejection: 'rejected-invalid' };
    if (data.requestKind !== undefined && data.requestKind !== 'input' && data.requestKind !== 'approval') return { registration, rejection: 'rejected-invalid' };
    if (data.nativeEvent !== undefined && (typeof data.nativeEvent !== 'string' || !NATIVE_EVENT.test(data.nativeEvent))) return { registration, rejection: 'rejected-invalid' };
    let location: AgentLocation | null = null;
    if (data.cwd !== undefined) {
      if (typeof data.cwd !== 'string') return { registration, rejection: 'rejected-invalid' };
      location = this.resolveLocation(registration.terminalId, registration.transport, data.cwd);
      if (!location) return { registration, rejection: 'rejected-invalid' };
    }
    return { registration, parsed: {
      event: data.event as WireEvent,
      ...(data.diagnostic ? { diagnostic: data.diagnostic as HookDiagnostic } : {}),
      ...(typeof data.sessionId === 'string' ? { sessionId: data.sessionId } : {}),
      ...(typeof data.turnId === 'string' ? { turnId: data.turnId } : {}),
      ...(data.scope ? { scope: data.scope } : {}),
      ...(typeof data.inputId === 'string' ? { inputId: data.inputId } : {}),
      ...(data.requestKind ? { requestKind: data.requestKind } : {}),
      ...(typeof data.previousSessionId === 'string' ? { previousSessionId: data.previousSessionId } : {}),
      ...(typeof data.continuesSessionId === 'string' ? { continuesSessionId: data.continuesSessionId } : {}),
      ...(typeof data.nativeEvent === 'string' ? { nativeEvent: data.nativeEvent } : {}),
      ...(location ? { location } : {}),
    } };
  }

  private receiveEvent(raw: string, remoteTerminalId?: string): AttentionVerdict {
    const accepted = this.parse(raw, remoteTerminalId);
    if (typeof accepted === 'string') {
      this.unattributed = Math.min(Number.MAX_SAFE_INTEGER, this.unattributed + 1);
      attentionTelemetry()?.transportRejection(accepted);
      if (process.env.CLANKER_DEBUG_ATTENTION === '1') console.debug('[clanker-grid] attention-delivery', accepted);
      return accepted;
    }
    // Only a bounded, authenticated envelope on the correct transport can be attributed to a terminal.
    if ('rejection' in accepted) {
      const { registration, rejection } = accepted;
      registration.received = Math.min(Number.MAX_SAFE_INTEGER, registration.received + 1);
      registration.lastVerdict = rejection;
      registration.verdicts[rejection] = Math.min(Number.MAX_SAFE_INTEGER, (registration.verdicts[rejection] ?? 0) + 1);
      if (registration.signal?.attachment === 'prepared' && registration.signal.reason !== 'envelope-invalid') {
        this.commit(registration, () => { registration.signal = { ...registration.signal!, health: 'degraded', reason: 'envelope-invalid' }; });
      }
      if (process.env.CLANKER_DEBUG_ATTENTION === '1') console.debug('[clanker-grid] attention-delivery', JSON.stringify({ terminalId: registration.terminalId, verdict: rejection, revision: registration.revision }));
      this.record(registration, { semantic: 'invalid-envelope', verdict: rejection });
      return rejection;
    }
    const { registration, parsed } = accepted;
    registration.received = Math.min(Number.MAX_SAFE_INTEGER, registration.received + 1);
    registration.lastNativeEvent = parsed.nativeEvent;
    if (parsed.diagnostic) registration.hooks[parsed.diagnostic] = Math.min(Number.MAX_SAFE_INTEGER, (registration.hooks[parsed.diagnostic] ?? 0) + 1);
    // Validate lifecycle/session/turn ordering first. Publish only after accepted location and
    // signal facts are attached, so subscribers never see a new session with its old location.
    const beforeSignal = JSON.stringify(registration.signal);
    const revision = registration.revision;
    let decision: AttentionDecision;
    registration.deferPublication = true;
    try {
      decision = parsed.event === 'observer_diagnostic' ? 'accepted' : this.apply(registration, parsed);
    } finally {
      registration.deferPublication = false;
    }
    const moved = decision === 'accepted' && parsed.event !== 'observer_diagnostic'
      && this.stageLocation(registration, parsed);
    if (registration.signal?.attachment === 'prepared') {
      const error = parsed.diagnostic && parsed.diagnostic !== 'no-event' ? parsed.diagnostic
        : decision === 'rejected-mismatch' || decision === 'rejected-ambiguous' ? 'identity-rejected' : undefined;
      if (error) registration.signal = { ...registration.signal, health: 'degraded', reason: error };
      else if (decision === 'accepted' && parsed.event !== 'observer_diagnostic' &&
          (registration.signal.health === 'unverified' || ['turn_provisional', 'turn_activity', 'turn_started', 'turn_completed', 'turn_interrupted', 'turn_failed', 'session_ended', 'session_replaced'].includes(parsed.event))) {
        registration.signal = { requested: registration.signal.requested, attachment: 'prepared', health: 'observed' };
      }
    }
    if (this.current(registration.terminalId) === registration) {
      if (registration.revision !== revision) {
        this.onChange({ terminalId: registration.terminalId, revision: registration.revision, snapshot: this.toSnapshot(registration) });
      } else if (moved || JSON.stringify(registration.signal) !== beforeSignal) {
        this.commit(registration, () => undefined);
      }
    }
    const record = { semantic: parsed.event, ...(parsed.nativeEvent ? { nativeEvent: parsed.nativeEvent } : {}) };
    if (decision === 'accepted') registration.lastAccepted = { ...record, revision: registration.revision };
    else registration.lastRejected = { ...record, decision };
    const verdict: AttentionVerdict = decision === 'accepted'
      ? (registration.revision !== revision || this.current(registration.terminalId) !== registration ? 'accepted-changed' : 'accepted-idempotent')
      : decision;
    registration.lastVerdict = verdict;
    registration.verdicts[verdict] = Math.min(Number.MAX_SAFE_INTEGER, (registration.verdicts[verdict] ?? 0) + 1);
    this.record(registration, {
      semantic: parsed.event, verdict, ...(parsed.nativeEvent ? { nativeEvent: parsed.nativeEvent } : {}),
      session: traceId(parsed.sessionId), turn: traceId(parsed.turnId),
    });
    this.onDiagnostic({
      harness: registration.harness, terminalId: registration.terminalId,
      ...(parsed.nativeEvent ? { nativeEvent: parsed.nativeEvent } : {}),
      ...(parsed.sessionId ? { sessionId: parsed.sessionId.slice(0, DIAGNOSTIC_ID_LENGTH) } : {}),
      ...(parsed.turnId ? { turnId: parsed.turnId.slice(0, DIAGNOSTIC_ID_LENGTH) } : {}),
      semantic: parsed.event, decision, verdict, revision: registration.revision, status: registration.status,
    });
    return verdict;
  }

  /** Records only accepted native root evidence, after any proven session transition. A boundary
   * may retain a last report; it cannot turn that history into a current-session observation. */
  private stageLocation(registration: Registration, event: ParsedEvent): boolean {
    const next = event.location;
    if (!next || event.event === 'agent_exited' || event.scope !== 'root' || !event.sessionId) return false;
    if (registration.rootSessionId && registration.rootSessionId !== event.sessionId) return false;
    const previousSession = registration.locationEvidence?.sessionId;
    const wasInvalidated = registration.locationInvalidated;
    registration.locationInvalidated = false;
    registration.locationEvidence = { sessionId: event.sessionId, lastReportedAt: this.now() };
    const current = registration.location;
    if (current && current.path === next.path && current.checkoutContextId === next.checkoutContextId
      && previousSession === event.sessionId && !wasInvalidated) return false;
    registration.location = { ...next };
    return true;
  }

  /** Identity and lifecycle authority are separate checks, in that order. */
  private apply(registration: Registration, event: ParsedEvent): AttentionDecision {
    if (event.event === 'agent_exited') {
      // The harness is gone: retire the credentials so the fallback shell is an ordinary shell.
      this.release(registration.terminalId);
      return 'accepted';
    }
    if (event.scope === 'child') return 'ignored-child';
    if (event.scope !== 'root') return 'rejected-ambiguous';
    if (!event.sessionId) return 'rejected-ambiguous';
    if (registration.rootSessionId === event.sessionId) registration.seedUnconfirmed = undefined;
    if (event.event === 'session_replaced') {
      // Provider-proven explicit replacement (Codex SessionStart source=clear), never an
      // unrelated root start. Name exactly the old root before replacing any authority.
      if (!registration.rootSessionId || !event.previousSessionId) return 'rejected-ambiguous';
      if (event.previousSessionId !== registration.rootSessionId || event.sessionId === registration.rootSessionId) return 'rejected-mismatch';
      this.commit(registration, revision => {
        registration.rootSessionId = event.sessionId;
        registration.seedUnconfirmed = undefined;
        registration.activeTurnId = undefined;
        registration.retiredTurns = [];
        registration.pending = [];
        registration.status = 'unverified';
        registration.startedAt = null;
        registration.lastOutcome = { kind: 'session_ended', turnId: null, revision, at: this.now() };
      });
      return 'accepted';
    }
    if (event.event === 'session_continued') {
      // The provider proved the same foreground conversation moved to a new session ID
      // (for example context compression). It must name exactly the bound root it continues.
      if (!registration.rootSessionId || !event.continuesSessionId) return 'rejected-ambiguous';
      if (event.continuesSessionId !== registration.rootSessionId) return 'rejected-mismatch';
      if (event.sessionId !== registration.rootSessionId) {
        this.commit(registration, () => { registration.rootSessionId = event.sessionId; });
      }
      return 'accepted';
    }

    // Process-scoped providers prove that the old session runtime was replaced, even if its end
    // was lost. Shared providers do not: an idle root, token possession, or a root start says nothing
    // about which conversation the user selected. They need an explicit boundary/replacement above.
    if (registration.rootSessionId && registration.rootSessionId !== event.sessionId
      && (event.event === 'session_started' || event.event === 'turn_started') && this.maySupersede(registration)) {
      if (event.event === 'turn_started' && !event.turnId) return 'rejected-ambiguous';
      this.supersede(registration, event.sessionId);
    }
    if (registration.rootSessionId && registration.rootSessionId !== event.sessionId) return 'rejected-mismatch';

    // A provider's native root session start can restore identity after a boundary, including a
    // resume that has not submitted a prompt yet. It proves no turn or completion. Duplicates
    // leave an active turn alone; the mismatch check above prevents replacing an existing root.
    if (event.event === 'session_started') {
      if (!registration.rootSessionId) {
        this.commit(registration, () => { registration.rootSessionId = event.sessionId; });
      }
      return 'accepted';
    }

    // Location only: acceptance neither binds a root nor touches a turn.
    if (event.event === 'location_changed') return event.location ? 'accepted' : 'rejected-ambiguous';

    if (event.event === 'session_ended') {
      // A native boundary clears the binding; the registration and credentials stay alive.
      const clean = registration.rootSessionId === undefined && registration.status === 'unverified' && registration.pending.length === 0
        && (registration.lastOutcome === null || registration.lastOutcome.kind === 'session_ended');
      if (clean) return 'accepted';
      const hadState = registration.rootSessionId !== undefined || registration.status !== 'unverified'
        || registration.pending.length > 0 || registration.lastOutcome !== null;
      this.commit(registration, (revision) => {
        registration.rootSessionId = undefined;
        registration.seedUnconfirmed = undefined;
        registration.activeTurnId = undefined;
        registration.retiredTurns = [];
        registration.pending = [];
        registration.status = 'unverified';
        registration.startedAt = null;
        // A boundary supersedes an older completion without erasing it: it is no longer a current Done.
        if (hadState) registration.lastOutcome = { kind: 'session_ended', turnId: null, revision, at: this.now() };
      });
      return 'accepted';
    }
    // Turn identity (native, or a provider-owned epoch) is mandatory: an event that cannot
    // be tied to one foreground turn must not change foreground state.
    const turnId = event.turnId;
    if (!turnId) return 'rejected-ambiguous';
    if (registration.retiredTurns.includes(turnId)) return 'ignored-stale';
    const open = isActive(registration) || registration.status === 'provisional';

    if (event.event === 'turn_started') {
      const binds = registration.rootSessionId === undefined;
      if (open && registration.activeTurnId === turnId) {
        if (binds || registration.status === 'provisional') this.commit(registration, () => {
          registration.rootSessionId = event.sessionId;
          registration.status = 'running';
        });
        return 'accepted';
      }
      if (open && !registration.activeTurnId) {
        // Clanker submitted this prompt; the native start now names its turn.
        this.commit(registration, () => {
          registration.rootSessionId ??= event.sessionId;
          registration.activeTurnId = turnId;
          registration.status = 'running';
        });
        return 'accepted';
      }
      this.commit(registration, () => {
        registration.rootSessionId ??= event.sessionId;
        if (registration.activeTurnId) this.retire(registration, registration.activeTurnId);
        registration.activeTurnId = turnId;
        registration.pending = [];
        registration.status = 'running';
        registration.startedAt = this.now();
      });
      return 'accepted';
    }

    // Everything else needs a bound root and the live, identified foreground turn: a
    // completion or input event can never establish authority or settle another turn.
    if (!registration.rootSessionId) return 'rejected-ambiguous';
    if (!open || registration.activeTurnId !== turnId) return 'ignored-stale';

    switch (event.event) {
      case 'turn_activity':
        // Activity can only resume this already-bound foreground turn. It cannot establish
        // identity, open a new turn, settle it, or resolve historical human requests.
        if (registration.status === 'provisional') this.commit(registration, () => {
          registration.status = 'running';
        });
        return 'accepted';
      case 'turn_provisional':
        // Keep correlation and historical waits for a later native outcome. This is neither
        // active execution nor success, and cannot authorize a handoff or checkout move.
        if (registration.status !== 'provisional') this.commit(registration, (revision) => {
          registration.status = 'provisional';
          registration.provisionalRevision = revision;
          registration.pending = registration.pending.map(request => ({ ...request, resolutionUnknown: true }));
        });
        return 'accepted';
      case 'input_requested': {
        // The same correlated request (same proven id, or two id-less waits) is a duplicate.
        // A distinct id is another outstanding wait. A fallback wait is weaker evidence and yields.
        if (registration.pending.some((request) => request.evidence === 'structured' && request.inputId === event.inputId && !request.resolutionUnknown) && registration.status !== 'provisional') return 'accepted';
        this.commit(registration, (revision) => {
          registration.status = 'running';
          registration.pending = [...registration.pending.filter((request) => request.evidence === 'structured' && request.inputId !== event.inputId), {
            turnId, inputId: event.inputId, kind: event.requestKind ?? null, evidence: 'structured', revision, createdAt: this.now(),
          }];
        });
        return 'accepted';
      }
      case 'input_resolved': {
        // Resolve exactly the matching wait; an id-less resolution matches only an id-less wait.
        const matches = registration.pending.filter((request) => request.evidence === 'structured' && request.inputId === event.inputId);
        // Structured evidence also retires a weaker fallback wait when it resolves nothing else.
        const fallback = registration.pending.filter((request) => request.evidence === 'fallback');
        if (matches.length === 0 && fallback.length === 0) return 'ignored-stale';
        this.commit(registration, () => {
          registration.pending = registration.pending.filter((request) => !matches.includes(request)
            && !(matches.length === 0 && request.evidence === 'fallback'));
        });
        return 'accepted';
      }
      case 'turn_interrupted':
        // Retire the turn and any wait without a completion: no Ready alert for a cancelled turn.
        this.settle(registration, turnId, 'idle', 'interrupted');
        return 'accepted';
      case 'turn_completed':
        this.settle(registration, turnId, 'idle', 'completed');
        return 'accepted';
      case 'turn_failed':
        // Explicit provider failure evidence: Failed, never a completion.
        this.settle(registration, turnId, 'failed', 'failed');
        return 'accepted';
      default:
        return 'rejected-ambiguous';
    }
  }

  private maySupersede(registration: Registration): boolean {
    return !registration.seedUnconfirmed && registration.sessionModel === 'process';
  }

  /** The old root is over: retire its turns and waits, record a session boundary, and bind the new
   * root. Published at once so boundary consumers (checkout moves) see it as its own fact. */
  private supersede(registration: Registration, sessionId: string): void {
    const previous = registration.rootSessionId;
    this.commit(registration, (revision) => {
      registration.rootSessionId = sessionId;
      registration.activeTurnId = undefined;
      registration.retiredTurns = [];
      registration.pending = [];
      registration.status = 'unverified';
      registration.startedAt = null;
      registration.lastOutcome = { kind: 'session_ended', turnId: null, revision, at: this.now() };
    });
    this.record(registration, { semantic: 'session-superseded', session: traceId(previous) });
    if (this.current(registration.terminalId) === registration) {
      this.onChange({ terminalId: registration.terminalId, revision: registration.revision, snapshot: this.toSnapshot(registration) });
    }
  }

  private settle(
    registration: Registration, turnId: string, status: 'idle' | 'failed', kind: 'completed' | 'interrupted' | 'failed',
  ): void {
    this.commit(registration, (revision) => {
      const at = this.now();
      this.retire(registration, turnId);
      registration.activeTurnId = undefined;
      registration.pending = [];
      registration.status = status;
      registration.startedAt = null;
      registration.lastOutcome = { kind, turnId, revision, at };
      // Only a proven foreground completion ever touches the completion record.
      if (kind === 'completed') registration.lastCompletion = { turnId, revision, completedAt: at };
    });
  }

  private retire(registration: Registration, turnId: string): void {
    registration.retiredTurns = [...registration.retiredTurns, turnId].slice(-MAX_RETIRED_TURNS);
  }
}
