import { randomBytes } from 'node:crypto';
import * as net from 'node:net';
import type { AgentAttentionEvent, AgentAttentionUpdate } from '../shared/types/agentAttention';

/** Wire events. `session_continued` is an identity transition and never a renderer update. */
type WireEvent = AgentAttentionEvent | 'session_continued';
const EVENTS = new Set<WireEvent>([
  'turn_started', 'input_requested', 'input_resolved', 'turn_completed', 'turn_interrupted', 'session_ended', 'session_continued', 'agent_exited',
]);
const MAX_RETIRED_TURNS = 32;
const MAX_MESSAGE_BYTES = 2048;
const EVENT_FIELDS = new Set(['version', 'token', 'harness', 'event', 'sessionId', 'turnId', 'scope', 'inputId', 'nativeEvent', 'continuesSessionId']);
const NATIVE_EVENT = /^[A-Za-z0-9_.:-]{1,64}$/;
const DIAGNOSTIC_ID_LENGTH = 64;

/** `idle`: root bound, no foreground turn (for example after a user interrupt). */
type Lifecycle = 'unbound' | 'idle' | 'running' | 'needs_input' | 'ready';
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
  semantic: WireEvent;
  decision: AttentionDecision;
}

export interface AttentionRegistrationOptions {
  /** Main-validated native session a non-fork resume continues. Never renderer-supplied. */
  rootSessionId?: string;
}

interface Registration {
  terminalId: string;
  harness: string;
  transport: 'local' | 'remote';
  rootSessionId?: string;
  /** Foreground turn identity: native, or a provider-owned epoch for harnesses without one. */
  activeTurnId?: string;
  /** Completed or superseded turns; a late event from one can never touch a newer turn. */
  retiredTurns: string[];
  pendingInput?: { turnId?: string; inputId?: string };
  lifecycle: Lifecycle;
}

interface ParsedEvent {
  event: WireEvent;
  continuesSessionId?: string;
  sessionId?: string;
  turnId?: string;
  scope?: Scope;
  inputId?: string;
  nativeEvent?: string;
}

function defaultDiagnostics(diagnostic: AttentionDiagnostic): void {
  if (process.env.CLANKER_DEBUG_ATTENTION === '1') console.debug('[clanker-grid] attention', JSON.stringify(diagnostic));
}

/** Lifecycle authority for agent attention. A terminal token proves which terminal
 * emitted an event; root-session and turn correlation decide whether it may
 * change foreground state. Provider semantics live in the providers, not here. */
export class AgentAttentionBroker {
  private readonly registrations = new Map<string, Registration>();
  private readonly tokensByTerminal = new Map<string, string>();
  private server: net.Server | null = null;
  private startPromise: Promise<number> | null = null;

  constructor(
    private readonly onUpdate: (update: AgentAttentionUpdate) => void,
    private readonly onDiagnostic: (diagnostic: AttentionDiagnostic) => void = defaultDiagnostics,
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
      terminalId, harness, transport, retiredTurns: [], lifecycle: 'unbound',
      ...(options.rootSessionId ? { rootSessionId: options.rootSessionId } : {}),
    });
    this.tokensByTerminal.set(terminalId, token);
    return token;
  }

  receiveRemote(terminalId: string, raw: string): void {
    this.receiveEvent(raw, terminalId);
  }

  /** Unconditional final release: PTY exit/kill, failed launch, or retirement. */
  release(terminalId: string): void {
    const token = this.tokensByTerminal.get(terminalId);
    if (token) this.registrations.delete(token);
    this.tokensByTerminal.delete(terminalId);
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

  /** Public for focused validation tests; the transport uses the same boundary. */
  isReady(terminalId: string): boolean {
    return this.current(terminalId)?.lifecycle === 'ready';
  }

  handoffState(terminalId: string): 'unverified' | 'ready' | 'running' | 'needs_input' | 'unavailable' {
    const registration = this.current(terminalId);
    if (!registration) return 'unavailable';
    return registration.lifecycle === 'unbound' || registration.lifecycle === 'idle' ? 'unverified' : registration.lifecycle;
  }

  canHandoff(terminalId: string): boolean {
    const state = this.handoffState(terminalId);
    return state === 'unverified' || state === 'ready';
  }

  /** Clanker itself submitted a prompt: a new foreground turn starts without a native event. */
  markSubmitted(terminalId: string): void {
    const registration = this.current(terminalId);
    if (registration?.lifecycle !== 'ready') return;
    // The native start event must establish the turn identity before anything can settle it.
    registration.lifecycle = 'running';
    registration.activeTurnId = undefined;
    this.onUpdate({ terminalId, event: 'turn_started' });
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
    if (data.nativeEvent !== undefined && (typeof data.nativeEvent !== 'string' || !NATIVE_EVENT.test(data.nativeEvent))) return null;
    return { registration, parsed: {
      event: data.event as WireEvent,
      ...(typeof data.sessionId === 'string' ? { sessionId: data.sessionId } : {}),
      ...(typeof data.turnId === 'string' ? { turnId: data.turnId } : {}),
      ...(data.scope ? { scope: data.scope } : {}),
      ...(typeof data.inputId === 'string' ? { inputId: data.inputId } : {}),
      ...(typeof data.continuesSessionId === 'string' ? { continuesSessionId: data.continuesSessionId } : {}),
      ...(typeof data.nativeEvent === 'string' ? { nativeEvent: data.nativeEvent } : {}),
    } };
  }

  private receiveEvent(raw: string, remoteTerminalId?: string): void {
    const accepted = this.parse(raw, remoteTerminalId);
    if (!accepted) return;
    const { registration, parsed } = accepted;
    const decision = this.apply(registration, parsed);
    this.onDiagnostic({
      harness: registration.harness, terminalId: registration.terminalId,
      ...(parsed.nativeEvent ? { nativeEvent: parsed.nativeEvent } : {}),
      ...(parsed.sessionId ? { sessionId: parsed.sessionId.slice(0, DIAGNOSTIC_ID_LENGTH) } : {}),
      ...(parsed.turnId ? { turnId: parsed.turnId.slice(0, DIAGNOSTIC_ID_LENGTH) } : {}),
      semantic: parsed.event, decision,
    });
  }

  private emit(registration: Registration, event: AgentAttentionEvent): void {
    this.onUpdate({ terminalId: registration.terminalId, event });
  }

  /** Identity and lifecycle authority are separate checks, in that order. */
  private apply(registration: Registration, event: ParsedEvent): AttentionDecision {
    if (event.event === 'agent_exited') {
      // The harness is gone: retire the credentials so the fallback shell is an ordinary shell.
      this.emit(registration, 'agent_exited');
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
      registration.rootSessionId = event.sessionId;
      return 'accepted';
    }

    if (registration.rootSessionId && registration.rootSessionId !== event.sessionId) return 'rejected-mismatch';

    if (event.event === 'session_ended') {
      // A native boundary clears the binding; the registration and credentials stay alive.
      registration.rootSessionId = undefined;
      registration.activeTurnId = undefined;
      registration.retiredTurns = [];
      registration.pendingInput = undefined;
      registration.lifecycle = 'unbound';
      this.emit(registration, 'session_ended');
      return 'accepted';
    }
    // Turn identity (native, or a provider-owned epoch) is mandatory: an event that cannot
    // be tied to one foreground turn must not change foreground state.
    const turnId = event.turnId;
    if (!turnId) return 'rejected-ambiguous';
    if (registration.retiredTurns.includes(turnId)) return 'ignored-stale';
    const active = registration.lifecycle === 'running' || registration.lifecycle === 'needs_input';

    if (event.event === 'turn_started') {
      registration.rootSessionId ??= event.sessionId;
      if (active && registration.activeTurnId === turnId) return 'accepted';
      if (active && !registration.activeTurnId) {
        // Clanker submitted this prompt; the native start now names its turn.
        registration.activeTurnId = turnId;
        return 'accepted';
      }
      if (registration.activeTurnId) this.retire(registration, registration.activeTurnId);
      registration.activeTurnId = turnId;
      registration.pendingInput = undefined;
      registration.lifecycle = 'running';
      this.emit(registration, 'turn_started');
      return 'accepted';
    }

    // Everything else needs a bound root and the live, identified foreground turn: a
    // completion or input event can never establish authority or settle another turn.
    if (!registration.rootSessionId) return 'rejected-ambiguous';
    if (!active || registration.activeTurnId !== turnId) return 'ignored-stale';

    switch (event.event) {
      case 'input_requested':
        // The first outstanding wait stays authoritative; a duplicate request cannot replace it.
        if (registration.lifecycle !== 'needs_input') {
          registration.pendingInput = { turnId, inputId: event.inputId };
          registration.lifecycle = 'needs_input';
          this.emit(registration, 'input_requested');
        }
        return 'accepted';
      case 'input_resolved': {
        const pending = registration.pendingInput;
        if (!pending || (pending.inputId && event.inputId !== pending.inputId)) return 'ignored-stale';
        registration.pendingInput = undefined;
        registration.lifecycle = 'running';
        this.emit(registration, 'input_resolved');
        return 'accepted';
      }
      case 'turn_interrupted':
        // Retire the turn and any wait without a completion: no Ready alert for a cancelled turn.
        this.retire(registration, turnId);
        registration.activeTurnId = undefined;
        registration.pendingInput = undefined;
        registration.lifecycle = 'idle';
        this.emit(registration, 'turn_interrupted');
        return 'accepted';
      case 'turn_completed':
        this.retire(registration, turnId);
        registration.activeTurnId = undefined;
        registration.pendingInput = undefined;
        registration.lifecycle = 'ready';
        this.emit(registration, 'turn_completed');
        return 'accepted';
      default:
        return 'rejected-ambiguous';
    }
  }

  private retire(registration: Registration, turnId: string): void {
    registration.retiredTurns = [...registration.retiredTurns, turnId].slice(-MAX_RETIRED_TURNS);
  }
}
