import { randomBytes } from 'node:crypto';
import * as net from 'node:net';
import type {
  AgentAttentionChange, AgentAttentionEvidence, AgentAttentionSnapshot, AgentPendingRequestKind, AgentRuntimeStatus,
} from '../shared/types/agentAttention';
import {
  arbitrateFallback, type FallbackEvidence, type FallbackSuppression, type SourceQuality, type StructuredAuthority,
} from './attentionAuthority';

/** Wire events. `session_continued` is an identity transition; `agent_exited` retires the registration. */
type WireEvent =
  | 'turn_started' | 'input_requested' | 'input_resolved' | 'turn_completed' | 'turn_interrupted'
  | 'turn_failed' | 'session_ended' | 'session_continued' | 'agent_exited';
const EVENTS = new Set<WireEvent>([
  'turn_started', 'input_requested', 'input_resolved', 'turn_completed', 'turn_interrupted', 'turn_failed',
  'session_ended', 'session_continued', 'agent_exited',
]);
const MAX_RETIRED_TURNS = 32;
const MAX_MESSAGE_BYTES = 2048;
const MAX_REMEMBERED_REVISIONS = 1024;
const EVENT_FIELDS = new Set([
  'version', 'token', 'harness', 'event', 'sessionId', 'turnId', 'scope', 'inputId', 'requestKind', 'nativeEvent', 'continuesSessionId',
]);
const NATIVE_EVENT = /^[A-Za-z0-9_.:-]{1,64}$/;
const DIAGNOSTIC_ID_LENGTH = 64;

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
  status?: AgentRuntimeStatus;
}

export interface AttentionRegistrationOptions {
  /** Main-validated native session a non-fork resume continues. Never renderer-supplied. */
  rootSessionId?: string;
  /** How completely the provider's structured lifecycle covers a turn. Defaults to `full`,
   * which keeps every lower-confidence source suppressed. */
  authority?: StructuredAuthority;
  quality?: SourceQuality;
}

export type AttentionEffectiveState = 'unverified' | 'idle' | 'working' | 'needs_input' | 'failed';

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
}

interface PendingRequest {
  turnId?: string;
  inputId?: string;
  kind: AgentPendingRequestKind | null;
  evidence: AgentAttentionEvidence;
  revision: number;
  createdAt: number;
}

interface Registration {
  terminalId: string;
  harness: string;
  transport: 'local' | 'remote';
  authority: StructuredAuthority;
  quality: SourceQuality;
  revision: number;
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
  lastAccepted?: AttentionExplanation['lastAccepted'];
  lastRejected?: AttentionExplanation['lastRejected'];
  lastFallback?: AttentionExplanation['lastFallback'];
  suppressedFallbackReason?: FallbackSuppression;
}

interface ParsedEvent {
  event: WireEvent;
  continuesSessionId?: string;
  sessionId?: string;
  turnId?: string;
  scope?: Scope;
  inputId?: string;
  requestKind?: AgentPendingRequestKind;
  nativeEvent?: string;
}

const pendingEvidence = (registration: Registration): AgentAttentionEvidence | null =>
  registration.pending.some((request) => request.evidence === 'structured') ? 'structured'
    : registration.pending.length > 0 ? 'fallback' : null;

function defaultDiagnostics(diagnostic: AttentionDiagnostic): void {
  if (process.env.CLANKER_DEBUG_ATTENTION === '1') console.debug('[clanker-grid] attention', JSON.stringify(diagnostic));
}

const isActive = (registration: Registration): boolean => registration.status === 'starting' || registration.status === 'running';

/** Lifecycle authority for agent attention. A terminal token proves which terminal
 * emitted an event; root-session and turn correlation decide whether it may
 * change foreground state. Provider semantics live in the providers, not here.
 *
 * The broker publishes complete, revisioned snapshots. The revision advances only when an
 * authoritative fact changes: stale, rejected, child and duplicate events never move it. */
export class AgentAttentionBroker {
  private readonly registrations = new Map<string, Registration>();
  private readonly tokensByTerminal = new Map<string, string>();
  /** Highest revision ever issued per terminal, so a replaced registration never goes backwards. */
  private readonly revisionFloors = new Map<string, number>();
  private server: net.Server | null = null;
  private startPromise: Promise<number> | null = null;

  constructor(
    private readonly onChange: (change: AgentAttentionChange) => void,
    private readonly onDiagnostic: (diagnostic: AttentionDiagnostic) => void = defaultDiagnostics,
    private readonly now: () => number = Date.now,
  ) {}

  async start(): Promise<number> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise<number>((resolve, reject) => {
      const server = net.createServer({ allowHalfOpen: true }, (socket) => {
        socket.setTimeout(1000, () => socket.destroy());
        let body = '';
        socket.on('data', (chunk: Buffer) => {
          if (Buffer.byteLength(body) + chunk.length > MAX_MESSAGE_BYTES) {
            socket.destroy();
            return;
          }
          body += chunk.toString('utf8');
        });
        socket.on('end', () => {
          this.receive(body);
          socket.end('ok');
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
      terminalId, harness, transport, retiredTurns: [], status: 'unverified', startedAt: null, pending: [],
      authority: options.authority ?? 'full', quality: options.quality ?? 'hook',
      lastCompletion: null, lastOutcome: null,
      revision: this.issueRevision(terminalId),
      ...(options.rootSessionId ? { rootSessionId: options.rootSessionId } : {}),
    });
    this.tokensByTerminal.set(terminalId, token);
    return token;
  }

  receiveRemote(terminalId: string, raw: string): void {
    this.receiveEvent(raw, terminalId);
  }

  /** Unconditional final release: PTY exit/kill, failed launch, or retirement. A live agent is
   * retired with a revisioned tombstone so no older snapshot can resurrect it. */
  release(terminalId: string): void {
    const token = this.tokensByTerminal.get(terminalId);
    const registration = token ? this.registrations.get(token) : undefined;
    if (token) this.registrations.delete(token);
    this.tokensByTerminal.delete(terminalId);
    if (!registration) return;
    this.onChange({ terminalId, revision: this.issueRevision(terminalId), snapshot: null });
  }

  close(): void {
    this.registrations.clear();
    this.tokensByTerminal.clear();
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

  /** Every live registration. Retired agents are absent, so hydration cannot recreate them. */
  snapshots(): AgentAttentionSnapshot[] {
    return [...this.registrations.values()].map((registration) => this.toSnapshot(registration));
  }

  private toSnapshot(r: Registration): AgentAttentionSnapshot {
    return {
      terminalId: r.terminalId,
      revision: r.revision,
      sessionId: r.rootSessionId ?? null,
      runtime: { status: r.status, turnId: r.activeTurnId ?? null, startedAt: r.startedAt },
      // Compact public view: the oldest outstanding wait stands for the set.
      pendingRequest: r.pending[0] ? {
        id: r.pending[0].inputId ?? null, turnId: r.pending[0].turnId ?? null, kind: r.pending[0].kind,
        evidence: r.pending[0].evidence, revision: r.pending[0].revision, createdAt: r.pending[0].createdAt,
      } : null,
      lastCompletion: r.lastCompletion ? { ...r.lastCompletion } : null,
      lastOutcome: r.lastOutcome ? { ...r.lastOutcome } : null,
    };
  }

  /** Why an agent is in its current state: effective state, source authority, the latest
   * accepted and rejected evidence, and any suppressed fallback. */
  explain(terminalId: string): AttentionExplanation | null {
    const r = this.current(terminalId);
    if (!r) return null;
    const effective: AttentionEffectiveState = r.pending.length > 0 ? 'needs_input'
      : isActive(r) ? 'working' : r.status === 'failed' ? 'failed' : r.status === 'idle' ? 'idle' : 'unverified';
    return {
      terminalId: r.terminalId, harness: r.harness, transport: r.transport, effective,
      source: { quality: r.quality, authority: r.authority, effectiveEvidence: pendingEvidence(r) ?? 'structured' },
      snapshot: this.toSnapshot(r),
      ...(r.lastAccepted ? { lastAccepted: { ...r.lastAccepted } } : {}),
      ...(r.lastRejected ? { lastRejected: { ...r.lastRejected } } : {}),
      ...(r.lastFallback ? { lastFallback: { ...r.lastFallback } } : {}),
      ...(r.suppressedFallbackReason ? { suppressedFallbackReason: r.suppressedFallbackReason } : {}),
    };
  }

  /** Apply one authoritative semantic mutation: advance the revision, run the change with that
   * revision, and publish the resulting snapshot. */
  private commit(registration: Registration, mutate: (revision: number) => void): void {
    registration.revision = this.issueRevision(registration.terminalId);
    mutate(registration.revision);
    this.onChange({ terminalId: registration.terminalId, revision: registration.revision, snapshot: this.toSnapshot(registration) });
  }

  /** Public for focused validation tests; the transport uses the same boundary. */
  isReady(terminalId: string): boolean {
    return this.handoffState(terminalId) === 'ready';
  }

  handoffState(terminalId: string): 'unverified' | 'ready' | 'running' | 'needs_input' | 'unavailable' {
    const registration = this.current(terminalId);
    if (!registration) return 'unavailable';
    if (isActive(registration)) return registration.pending.length > 0 ? 'needs_input' : 'running';
    return registration.status === 'idle' && registration.lastOutcome?.kind === 'completed' ? 'ready' : 'unverified';
  }

  canHandoff(terminalId: string): boolean {
    const state = this.handoffState(terminalId);
    return state === 'unverified' || state === 'ready';
  }

  /** Clanker itself submitted a prompt: a new foreground turn starts without a native event. */
  markSubmitted(terminalId: string): void {
    const registration = this.current(terminalId);
    if (!registration || this.handoffState(terminalId) !== 'ready') return;
    // The native start event must establish the turn identity before anything can settle it.
    this.commit(registration, () => {
      registration.status = 'starting';
      registration.activeTurnId = undefined;
      registration.startedAt = this.now();
    });
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

  receive(raw: string): void {
    this.receiveEvent(raw);
  }

  private parse(raw: string, remoteTerminalId?: string): { registration: Registration; parsed: ParsedEvent } | null {
    if (Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) return null;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return null; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const data = value as Record<string, unknown>;
    if (Object.keys(data).some((key) => !EVENT_FIELDS.has(key))) return null;
    if (data.version !== 1 || typeof data.token !== 'string') return null;
    const registration = this.registrations.get(data.token);
    if (!registration || data.harness !== registration.harness) return null;
    if (remoteTerminalId === undefined ? registration.transport !== 'local'
      : registration.transport !== 'remote' || registration.terminalId !== remoteTerminalId) return null;
    if (typeof data.event !== 'string' || !EVENTS.has(data.event as WireEvent)) return null;
    for (const key of ['sessionId', 'turnId', 'inputId', 'continuesSessionId'] as const) {
      if (data[key] !== undefined && (typeof data[key] !== 'string' || data[key].length === 0 || data[key].length > 128)) return null;
    }
    if (data.scope !== undefined && data.scope !== 'root' && data.scope !== 'child') return null;
    if (data.requestKind !== undefined && data.requestKind !== 'input' && data.requestKind !== 'approval') return null;
    if (data.nativeEvent !== undefined && (typeof data.nativeEvent !== 'string' || !NATIVE_EVENT.test(data.nativeEvent))) return null;
    return { registration, parsed: {
      event: data.event as WireEvent,
      ...(typeof data.sessionId === 'string' ? { sessionId: data.sessionId } : {}),
      ...(typeof data.turnId === 'string' ? { turnId: data.turnId } : {}),
      ...(data.scope ? { scope: data.scope } : {}),
      ...(typeof data.inputId === 'string' ? { inputId: data.inputId } : {}),
      ...(data.requestKind ? { requestKind: data.requestKind } : {}),
      ...(typeof data.continuesSessionId === 'string' ? { continuesSessionId: data.continuesSessionId } : {}),
      ...(typeof data.nativeEvent === 'string' ? { nativeEvent: data.nativeEvent } : {}),
    } };
  }

  private receiveEvent(raw: string, remoteTerminalId?: string): void {
    const accepted = this.parse(raw, remoteTerminalId);
    if (!accepted) return;
    const { registration, parsed } = accepted;
    const decision = this.apply(registration, parsed);
    const record = { semantic: parsed.event, ...(parsed.nativeEvent ? { nativeEvent: parsed.nativeEvent } : {}) };
    if (decision === 'accepted') registration.lastAccepted = { ...record, revision: registration.revision };
    else registration.lastRejected = { ...record, decision };
    this.onDiagnostic({
      harness: registration.harness, terminalId: registration.terminalId,
      ...(parsed.nativeEvent ? { nativeEvent: parsed.nativeEvent } : {}),
      ...(parsed.sessionId ? { sessionId: parsed.sessionId.slice(0, DIAGNOSTIC_ID_LENGTH) } : {}),
      ...(parsed.turnId ? { turnId: parsed.turnId.slice(0, DIAGNOSTIC_ID_LENGTH) } : {}),
      semantic: parsed.event, decision, revision: registration.revision, status: registration.status,
    });
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

    if (registration.rootSessionId && registration.rootSessionId !== event.sessionId) return 'rejected-mismatch';

    if (event.event === 'session_ended') {
      // A native boundary clears the binding; the registration and credentials stay alive.
      const clean = registration.rootSessionId === undefined && registration.status === 'unverified' && registration.pending.length === 0
        && (registration.lastOutcome === null || registration.lastOutcome.kind === 'session_ended');
      if (clean) return 'accepted';
      const hadState = registration.rootSessionId !== undefined || registration.status !== 'unverified'
        || registration.pending.length > 0 || registration.lastOutcome !== null;
      this.commit(registration, (revision) => {
        registration.rootSessionId = undefined;
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
    const active = isActive(registration);

    if (event.event === 'turn_started') {
      const binds = registration.rootSessionId === undefined;
      if (active && registration.activeTurnId === turnId) {
        if (binds) this.commit(registration, () => { registration.rootSessionId = event.sessionId; });
        return 'accepted';
      }
      if (active && !registration.activeTurnId) {
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
    if (!active || registration.activeTurnId !== turnId) return 'ignored-stale';

    switch (event.event) {
      case 'input_requested': {
        // The same correlated request (same proven id, or two id-less waits) is a duplicate.
        // A distinct id is another outstanding wait. A fallback wait is weaker evidence and yields.
        if (registration.pending.some((request) => request.evidence === 'structured' && request.inputId === event.inputId)) return 'accepted';
        this.commit(registration, (revision) => {
          registration.pending = [...registration.pending.filter((request) => request.evidence === 'structured'), {
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
