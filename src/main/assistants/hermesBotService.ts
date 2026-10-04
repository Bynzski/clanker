import { StringDecoder } from 'node:string_decoder';
import {
  DEFAULT_ASSISTANT_SETTINGS,
  type AssistantOpenResult,
  type AssistantSnapshot,
  type AssistantSettings,
  type AssistantSurfaceState,
  type HermesAssistantServiceState,
  type HermesBot,
} from '../../shared/types/assistants';
import { readPersistedAssistantSettings, validateAssistantSettings } from './assistantSettings';
import {
  HERMES_DEFAULT_PORT,
  HERMES_LOOPBACK_HOST,
  generateServiceToken,
  probeExternalBackend,
  spawnHermesServe,
  waitForServeReady,
  type FetchLike,
  type ServeChild,
  type SpawnServe,
} from './hermesBackend';
import { HermesRpcClient, RpcError, defaultWebSocketFactory, frameByteLength, type WebSocketFactory, type WebSocketLike } from './hermesTransport';

export interface HermesBotServiceDeps {
  readSettings(): unknown;
  writeSettings(settings: AssistantSettings): void;
  onChanged(snapshot: AssistantSnapshot): void;
  onPtyData(botId: string, data: string): void;
  isShuttingDown(): boolean;
  fetch?: FetchLike;
  createWebSocket?: WebSocketFactory;
  spawnServe?: SpawnServe;
  generateToken?: () => string;
  now?: () => number;
  startTimeoutMs?: number;
  stopGraceMs?: number;
  /** A connected backend must survive this long before a later crash counts as a new failure episode. */
  stableAfterMs?: number;
}

const MAX_BOTS = 64;
const MAX_PTY_FRAME_BYTES = 1024 * 1024;
const REPLAY_LIMIT = 512 * 1024;
/** Hermes closes the attached PTY socket with this code when the TUI child exits. */
const PTY_CLOSE_CHILD_EXITED = 4410;
const PROFILE_SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SESSION_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const BOT_ID = /^hermes:[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** The one canonical title: (profile, "Bot Chat") is that profile's permanent chat identity in Hermes. */
export const CANONICAL_CHAT_TITLE = 'Bot Chat';
const CANONICAL_LIST_LIMIT = 200;

export function isValidBotId(value: unknown): value is string { return typeof value === 'string' && BOT_ID.test(value); }

/** `hadCanonical`: the last roster listing positively reported a canonical chat (an empty lookup is then unconfirmed, never a reason to mint). */
interface RosterEntry { public: HermesBot; slug: string; sessionId?: string; hadCanonical: boolean }

interface PtySession {
  botId: string;
  attach: string;
  socket: WebSocketLike | null;
  state: AssistantSurfaceState;
  replay: string;
  decoder: StringDecoder;
  size: { cols: number; rows: number } | null;
  generation: number;
}

type Endpoint = { port: number; token: string; ownership: 'external' | 'clanker' };

/**
 * Main-owned Hermes Bot integration. Owns settings, backend discovery/adoption, the optional
 * Clanker-owned `hermes serve` child, the authenticated control connection, the Bot roster and the
 * service-hosted chat PTYs. The renderer only ever sees display-safe snapshots; the backend token
 * never leaves this class.
 */
export class HermesBotService {
  private readonly fetcher: FetchLike;
  private readonly createWebSocket: WebSocketFactory;
  private readonly spawnServe: SpawnServe;
  private readonly now: () => number;
  private settings: AssistantSettings = { ...DEFAULT_ASSISTANT_SETTINGS };
  private state: HermesAssistantServiceState = 'disabled';
  private ownership: 'external' | 'clanker' | null = null;
  private error: string | undefined;
  private roster: RosterEntry[] = [];
  private endpoint: Endpoint | undefined;
  private rpc: HermesRpcClient | undefined;
  private child: ServeChild | undefined;
  private childExited: Promise<void> | undefined;
  private childReady = false;
  private stopping = false;
  private generation = 0;
  private refreshOp: Promise<AssistantSnapshot> | undefined;
  private connectedAt = 0;
  private episodeRestarts = 0;
  private readonly sessions = new Map<string, PtySession>();
  private readonly opening = new Map<string, Promise<AssistantOpenResult>>();

  constructor(private readonly deps: HermesBotServiceDeps) {
    this.fetcher = deps.fetch ?? ((url, init) => fetch(url, init) as ReturnType<FetchLike>);
    this.createWebSocket = deps.createWebSocket ?? defaultWebSocketFactory;
    this.spawnServe = deps.spawnServe ?? spawnHermesServe;
    this.now = deps.now ?? Date.now;
    this.settings = this.loadSettings();
  }

  private loadSettings(): AssistantSettings {
    try { return readPersistedAssistantSettings(this.deps.readSettings()); } catch { return { ...DEFAULT_ASSISTANT_SETTINGS }; }
  }

  // ── snapshot ────────────────────────────────────────────────────────────────

  get(): AssistantSnapshot {
    return {
      settings: { ...this.settings },
      service: { state: this.state, ownership: this.ownership, ...(this.error ? { error: this.error } : {}) },
      bots: this.roster.map((entry) => ({ ...entry.public })),
      surfaces: [...this.sessions.values()].map((session) => ({ botId: session.botId, state: session.state })),
    };
  }

  private publish(): AssistantSnapshot {
    const snapshot = this.get();
    this.deps.onChanged(snapshot);
    return snapshot;
  }

  private setState(state: HermesAssistantServiceState, error?: string): void {
    this.state = state;
    this.error = error;
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────

  /** App startup: nothing happens (no probe, no spawn) unless Assistants were already enabled. */
  start(): void {
    if (this.settings.enabled) void this.refresh().catch(() => undefined);
  }

  configure(value: unknown): AssistantSnapshot {
    const next = validateAssistantSettings(value);
    const previous = this.settings;
    this.settings = next;
    this.deps.writeSettings({ ...next });
    if (previous.enabled && !next.enabled) {
      void this.disable();
      return this.get();
    }
    if (!previous.enabled && next.enabled) {
      this.episodeRestarts = 0;
      void this.refresh().catch(() => undefined);
      this.setState('probing');
    } else if (next.enabled && !previous.autoStart && next.autoStart && this.state === 'offline') {
      void this.refresh().catch(() => undefined);
    }
    return this.publish();
  }

  /** Disable: invalidate in-flight work, close surfaces and the control connection, stop only our own child. */
  private async disable(): Promise<void> {
    this.generation++;
    this.refreshOp = undefined;
    this.closeAllSessions();
    this.dropRpc();
    this.endpoint = undefined;
    this.roster = [];
    this.setState('disabled');
    this.ownership = null;
    this.publish();
    await this.stopOwnedChild();
    this.ownership = null;
  }

  /** Window teardown: surfaces end, the backend (including an owned child) keeps running. */
  reset(): void {
    this.closeAllSessions();
  }

  /** App quit: sockets close and only the exact owned child is stopped. */
  async shutdown(): Promise<void> {
    this.generation++;
    this.refreshOp = undefined;
    this.closeAllSessions();
    this.dropRpc();
    await this.stopOwnedChild();
  }

  // ── refresh (coalesced within one generation) ───────────────────────────────

  refresh(): Promise<AssistantSnapshot> {
    if (!this.settings.enabled) return Promise.reject(new Error('Assistants integration is disabled'));
    if (this.refreshOp) return this.refreshOp;
    const generation = this.generation;
    const operation = this.run(generation);
    this.refreshOp = operation;
    const clear = () => { if (this.refreshOp === operation) this.refreshOp = undefined; };
    operation.then(clear, clear);
    return operation;
  }

  private current(generation: number): boolean {
    return generation === this.generation && this.settings.enabled && !this.deps.isShuttingDown() && !this.stopping;
  }

  private async run(generation: number): Promise<AssistantSnapshot> {
    this.setState(this.endpoint ? this.state : 'probing');
    if (this.state === 'probing') this.publish();
    try {
      // 1. Reuse a healthy control connection for a plain roster refresh.
      if (this.rpc && !this.rpc.isClosed && this.endpoint) {
        try { await this.loadRoster(generation, this.rpc); return this.finishConnected(generation); }
        catch { this.dropRpc(); }
      }
      // 2. (Re)discover: adopt a compatible running backend, else optionally start our own.
      let endpoint = this.child && this.child.exitCode === null && this.endpoint?.ownership === 'clanker' ? this.endpoint : undefined;
      if (!endpoint) {
        const probe = await probeExternalBackend(this.fetcher, HERMES_DEFAULT_PORT);
        if (!this.current(generation)) return this.get();
        if (probe.kind === 'usable') {
          endpoint = { port: probe.port, token: probe.token, ownership: 'external' };
        } else if (probe.kind === 'unusable') {
          return this.finish(generation, 'detected-unusable', probe.reason);
        } else if (this.settings.autoStart) {
          this.setState('starting');
          this.publish();
          endpoint = await this.startOwned(generation);
          if (!endpoint) return this.get();
        } else {
          return this.finish(generation, 'offline');
        }
      }
      this.endpoint = endpoint;
      this.ownership = endpoint.ownership;
      // 3. Authenticated control connection and roster.
      const rpc = await this.connectRpc(generation, endpoint);
      if (!rpc) return this.get();
      await this.loadRoster(generation, rpc);
      return this.finishConnected(generation);
    } catch (error) {
      if (!this.current(generation)) return this.get();
      this.dropRpc();
      return this.finish(generation, this.endpoint?.ownership === 'clanker' && !this.childAlive() ? 'error' : 'offline', safeMessage(error));
    }
  }

  private finish(generation: number, state: HermesAssistantServiceState, error?: string): AssistantSnapshot {
    if (!this.current(generation)) return this.get();
    if (state !== 'connected') { this.roster = []; this.markSessionsDisconnected(); if (state !== 'offline' || !this.childAlive()) this.endpoint = undefined; }
    if (!this.childAlive() && this.endpoint?.ownership !== 'clanker') this.ownership = state === 'detected-unusable' ? 'external' : null;
    this.setState(state, error);
    return this.publish();
  }

  private finishConnected(generation: number): AssistantSnapshot {
    if (!this.current(generation)) return this.get();
    if (this.state !== 'connected') this.connectedAt = this.now();
    this.setState('connected');
    return this.publish();
  }

  // ── Clanker-owned child ─────────────────────────────────────────────────────

  private childAlive(): boolean { return !!this.child && this.child.exitCode === null; }

  private async startOwned(generation: number): Promise<Endpoint | undefined> {
    const token = (this.deps.generateToken ?? generateServiceToken)();
    let child: ServeChild;
    try { child = this.spawnServe(token); }
    catch { this.finish(generation, 'error', 'Hermes could not be started. Is the hermes command installed?'); return undefined; }
    this.child = child;
    this.childReady = false;
    this.stopping = false;
    this.childExited = new Promise<void>((resolve) => {
      child.on('exit', (() => {
        resolve();
        if (this.child === child) this.onOwnedExit(child);
      }) as never);
      child.on('error', (() => resolve()) as never);
    });
    try {
      const port = await waitForServeReady(child, this.deps.startTimeoutMs ?? 30_000);
      this.childReady = true;
      if (!this.current(generation)) { void this.killChild(child); return undefined; }
      return { port, token, ownership: 'clanker' };
    } catch (error) {
      void this.killChild(child);
      if (this.child === child) this.child = undefined;
      this.finish(generation, 'error', safeMessage(error));
      return undefined;
    }
  }

  /** Unexpected exit of the owned child. At most one automatic restart per failure episode. */
  private onOwnedExit(child: ServeChild): void {
    if (this.child !== child) return;
    this.child = undefined;
    // A startup failure is reported by startOwned; only a backend that was serving counts as a crash.
    if (!this.childReady) return;
    if (this.stopping || this.deps.isShuttingDown() || !this.settings.enabled) return;
    this.dropRpc();
    this.markSessionsDisconnected();
    const wasEstablished = this.state === 'connected';
    this.endpoint = undefined;
    if (wasEstablished && this.now() - this.connectedAt > (this.deps.stableAfterMs ?? 60_000)) this.episodeRestarts = 0;
    if (this.settings.autoStart && this.episodeRestarts < 1) {
      this.episodeRestarts++;
      this.generation++;
      this.refreshOp = undefined;
      void this.refresh().catch(() => undefined);
      return;
    }
    this.roster = [];
    this.setState('error', 'Hermes service stopped unexpectedly');
    this.publish();
  }

  private async killChild(child: ServeChild): Promise<void> {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
    const grace = this.deps.stopGraceMs ?? 3000;
    await Promise.race([this.childExited ?? Promise.resolve(), new Promise<void>((resolve) => setTimeout(resolve, grace).unref?.())]);
    if (child.exitCode === null) { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
  }

  /** Stops exactly the child Clanker spawned. An adopted/external backend is never touched. */
  private async stopOwnedChild(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    this.child = undefined;
    try { await this.killChild(child); } finally { this.stopping = false; }
  }

  // ── control connection and roster ───────────────────────────────────────────

  private dropRpc(): void {
    const rpc = this.rpc;
    this.rpc = undefined;
    rpc?.close();
  }

  private async connectRpc(generation: number, endpoint: Endpoint): Promise<HermesRpcClient | undefined> {
    const url = `ws://${HERMES_LOOPBACK_HOST}:${endpoint.port}/api/ws?token=${encodeURIComponent(endpoint.token)}`;
    const rpc = new HermesRpcClient(this.createWebSocket(url), () => this.onRpcClosed(rpc));
    this.rpc = rpc;
    await rpc.ready;
    if (!this.current(generation)) { rpc.close(); return undefined; }
    return rpc;
  }

  private onRpcClosed(rpc: HermesRpcClient): void {
    if (this.rpc !== rpc) return;
    this.rpc = undefined;
    if (!this.settings.enabled || this.deps.isShuttingDown() || this.stopping || this.state === 'disabled') return;
    this.markSessionsDisconnected();
    if (this.childAlive() && this.endpoint?.ownership === 'clanker') return; // the child exit handler owns recovery
    this.roster = [];
    this.endpoint = undefined;
    this.setState('offline', 'Hermes service connection was lost');
    this.publish();
  }

  private async loadRoster(generation: number, rpc: HermesRpcClient): Promise<void> {
    const result = await rpc.call('profiles.list', {});
    if (!this.current(generation)) return;
    this.roster = parseBotRoster(result);
  }

  // ── Assistant surfaces (service-hosted chat PTYs) ───────────────────────────

  private entry(botId: string): RosterEntry | undefined { return this.roster.find((entry) => entry.public.id === botId); }

  /** Open (or reveal) the Assistant's canonical Bot Chat. Concurrent opens of one Bot share one resolution. */
  openSurface(botId: unknown): Promise<AssistantOpenResult> {
    if (!isValidBotId(botId)) return Promise.reject(new Error('Invalid assistant'));
    const existing = this.sessions.get(botId);
    if (existing && (existing.state === 'open' || existing.state === 'connecting') && existing.socket) return Promise.resolve({ state: existing.state, replay: existing.replay });
    const inflight = this.opening.get(botId);
    if (inflight) return inflight;
    const operation = this.openResolved(botId).finally(() => { if (this.opening.get(botId) === operation) this.opening.delete(botId); });
    this.opening.set(botId, operation);
    return operation;
  }

  private async openResolved(botId: string): Promise<AssistantOpenResult> {
    const entry = this.entry(botId);
    const rpc = this.rpc;
    const endpoint = this.endpoint;
    const previous = this.sessions.get(botId);
    if (!entry || !endpoint || !rpc || rpc.isClosed || this.state !== 'connected') {
      if (previous) { previous.state = 'disconnected'; this.publish(); return { state: 'disconnected', replay: previous.replay }; }
      throw new Error('Hermes service is not connected');
    }
    const generation = this.generation;
    const session = previous ?? this.newSession(botId);
    session.state = 'connecting';
    this.sessions.set(botId, session);
    this.publish();
    let sessionId: string;
    try {
      sessionId = await this.resolveCanonicalChat(entry, rpc);
    } catch {
      // Fail closed: nothing was created on a lookup failure, and no scratch conversation is substituted.
      if (this.sessions.get(botId) === session && this.current(generation)) { session.state = 'unavailable'; this.publish(); }
      return { state: 'unavailable', replay: session.replay };
    }
    if (!this.current(generation) || this.sessions.get(botId) !== session || !this.endpoint) return { state: session.state, replay: session.replay };
    entry.sessionId = sessionId;
    entry.hadCanonical = true;
    entry.public.canonicalSessionId = sessionId;
    this.attach(session, entry, this.endpoint);
    this.publish();
    return { state: session.state, replay: session.replay };
  }

  /**
   * The Bot's ONE permanent chat, per Hermes' own contract: the profile's session titled exactly
   * "Bot Chat". Exact lookup first; a failed lookup, or an empty one when the roster had positively
   * reported a chat, fails closed. Only a confirmed absence creates, with no model turn: the lazy session
   * is materialized with `session.title`, and a lost title race adopts the winner. The profile's own
   * `terminal.cwd` applies — Clanker never passes a workspace cwd.
   */
  private async resolveCanonicalChat(entry: RosterEntry, rpc: HermesRpcClient): Promise<string> {
    const lookup = async (): Promise<string | null> => {
      const result = await rpc.call('session.list', { profile: entry.slug, title: CANONICAL_CHAT_TITLE, limit: CANONICAL_LIST_LIMIT, include_hidden: true });
      const rows = result && typeof result === 'object' ? (result as { sessions?: unknown }).sessions : undefined;
      if (!Array.isArray(rows)) throw new Error('Unexpected session list');
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const record = row as Record<string, unknown>;
        const rootTitle = typeof record.root_title === 'string' ? record.root_title.trim() : '';
        const title = typeof record.title === 'string' ? record.title.trim() : '';
        if (!(rootTitle === CANONICAL_CHAT_TITLE || (!rootTitle && title === CANONICAL_CHAT_TITLE))) continue;
        const id = typeof record.resolved_id === 'string' && SESSION_ID.test(record.resolved_id) ? record.resolved_id
          : typeof record.id === 'string' && SESSION_ID.test(record.id) ? record.id : null;
        if (id) return id;
      }
      return null;
    };
    const existing = await lookup();
    if (existing) return existing;
    if (entry.hadCanonical) throw new Error('Bot Chat registry could not be confirmed');
    const created = await rpc.call('session.create', {
      profile: entry.slug, title: CANONICAL_CHAT_TITLE, hidden: true, follow_profile_config: true,
    }, 30_000) as { session_id?: unknown; stored_session_id?: unknown } | undefined;
    const runtime = typeof created?.session_id === 'string' ? created.session_id : '';
    const stored = typeof created?.stored_session_id === 'string' && SESSION_ID.test(created.stored_session_id) ? created.stored_session_id : '';
    if (!runtime || !stored) throw new Error('Unexpected session create result');
    try {
      await rpc.call('session.title', { session_id: runtime, title: CANONICAL_CHAT_TITLE });
      return stored;
    } catch (error) {
      if (error instanceof RpcError && /already in use/i.test(error.detail)) {
        const winner = await lookup();
        if (winner) return winner;
      }
      throw error;
    }
  }

  private newSession(botId: string): PtySession {
    const slug = botId.slice('hermes:'.length);
    return {
      // Stable per Bot (not per run): Hermes keys its keep-alive PTY on this, so a reconnect or restart
      // re-attaches the same chat process instead of stacking a second TUI beside the lingering one.
      botId, attach: `clanker-assistant-${slug}`, socket: null, state: 'connecting',
      replay: '', decoder: new StringDecoder('utf8'), size: null, generation: 0,
    };
  }

  private attach(session: PtySession, entry: RosterEntry, endpoint: Endpoint): void {
    session.state = 'connecting';
    session.generation++;
    const generation = session.generation;
    const params = new URLSearchParams({ token: endpoint.token, profile: entry.slug, resume: entry.sessionId!, attach: session.attach });
    const socket = this.createWebSocket(`ws://${HERMES_LOOPBACK_HOST}:${endpoint.port}/api/pty?${params.toString()}`);
    socket.binaryType = 'arraybuffer';
    session.socket = socket;
    const live = () => session.socket === socket && session.generation === generation;
    socket.addEventListener('open', (() => {
      if (!live()) return;
      session.state = 'open';
      if (session.size) this.sendResize(session);
      this.publish();
    }) as never);
    socket.addEventListener('message', ((event: { data: unknown }) => {
      if (!live()) return;
      const size = frameByteLength(event.data);
      if (size === null || size > MAX_PTY_FRAME_BYTES) { this.endSocket(session, socket, 'disconnected'); return; }
      const text = typeof event.data === 'string' ? event.data
        : session.decoder.write(Buffer.from(event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : new Uint8Array((event.data as ArrayBufferView).buffer, (event.data as ArrayBufferView).byteOffset, (event.data as ArrayBufferView).byteLength)));
      if (!text) return;
      session.replay = (session.replay + text).slice(-REPLAY_LIMIT);
      this.deps.onPtyData(session.botId, text);
    }) as never);
    socket.addEventListener('close', ((event: { code?: number }) => {
      if (!live()) return;
      session.socket = null;
      session.state = event.code === PTY_CLOSE_CHILD_EXITED ? 'ended' : 'disconnected';
      this.publish();
    }) as never);
    socket.addEventListener('error', (() => { if (live()) this.endSocket(session, socket, 'disconnected'); }) as never);
  }

  private endSocket(session: PtySession, socket: WebSocketLike, state: AssistantSurfaceState): void {
    if (session.socket !== socket) return;
    session.socket = null;
    session.state = state;
    try { socket.close(); } catch { /* already closed */ }
    this.publish();
  }

  writePty(botId: unknown, data: unknown): void {
    if (!isValidBotId(botId) || typeof data !== 'string' || data.length === 0 || Buffer.byteLength(data) > 64 * 1024) return;
    const session = this.sessions.get(botId);
    if (session?.socket && session.state === 'open') session.socket.send(data);
  }

  resizePty(botId: unknown, cols: unknown, rows: unknown): void {
    if (!isValidBotId(botId) || !Number.isInteger(cols) || !Number.isInteger(rows)) return;
    const c = cols as number; const r = rows as number;
    if (c < 1 || c > 1000 || r < 1 || r > 1000) return;
    const session = this.sessions.get(botId);
    if (!session) return;
    session.size = { cols: c, rows: r };
    if (session.socket && session.state === 'open') this.sendResize(session);
  }

  /** Hermes' own resize framing: the escape `ESC [ RESIZE:<cols>;<rows> ]` is consumed by /api/pty, never written to the TUI. */
  private sendResize(session: PtySession): void {
    if (!session.socket || !session.size) return;
    session.socket.send(`\x1b[RESIZE:${session.size.cols};${session.size.rows}]`);
  }

  closeSurface(botId: unknown): void {
    if (!isValidBotId(botId)) return;
    const session = this.sessions.get(botId);
    if (!session) return;
    this.sessions.delete(botId);
    session.generation++;
    try { session.socket?.close(); } catch { /* already closed */ }
    session.socket = null;
    this.publish();
  }

  private markSessionsDisconnected(): void {
    for (const session of this.sessions.values()) {
      if (session.state === 'unavailable') continue;
      session.generation++;
      try { session.socket?.close(); } catch { /* already closed */ }
      session.socket = null;
      session.state = 'disconnected';
    }
  }

  private closeAllSessions(): void {
    for (const session of this.sessions.values()) {
      session.generation++;
      try { session.socket?.close(); } catch { /* already closed */ }
      session.socket = null;
    }
    this.sessions.clear();
  }
}

/**
 * `profiles.list` is the roster authority: every valid local Hermes profile EXCEPT the raw `default`
 * (already represented by the ordinary Hermes harness). `ui_meta["hermes-bots"]` is optional presentation
 * metadata (title, description, and Desktop's own `hidden` preference), never eligibility. Routing always
 * uses the raw slug; display is Bot title, then profile display name, then the prettified slug.
 */
export function parseBotRoster(result: unknown): RosterEntry[] {
  const profiles = result && typeof result === 'object' ? (result as { profiles?: unknown }).profiles : undefined;
  if (!Array.isArray(profiles)) throw new Error('Hermes returned an unexpected profile list');
  const bots: RosterEntry[] = [];
  const seen = new Set<string>();
  for (const raw of profiles) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const slug = typeof row.name === 'string' ? row.name : '';
    if (!PROFILE_SLUG.test(slug) || slug === 'default' || row.is_default === true || seen.has(slug)) continue;
    const uiMeta = row.ui_meta && typeof row.ui_meta === 'object' ? row.ui_meta as Record<string, unknown> : null;
    const botMeta = uiMeta?.['hermes-bots'];
    const meta = botMeta && typeof botMeta === 'object' && !Array.isArray(botMeta) ? botMeta as Record<string, unknown> : {};
    if (meta.hidden === true) continue;
    seen.add(slug);
    const title = typeof meta.title === 'string' ? meta.title.trim() : '';
    const profileDisplay = typeof row.display_name === 'string' ? row.display_name.trim() : '';
    const description = typeof meta.description === 'string' && meta.description.trim() ? meta.description.trim()
      : typeof row.description === 'string' && row.description.trim() ? row.description.trim() : undefined;
    const canonical = row.canonical_session && typeof row.canonical_session === 'object' ? row.canonical_session as Record<string, unknown> : null;
    const resolved = canonical && typeof canonical.resolved_id === 'string' && SESSION_ID.test(canonical.resolved_id) ? canonical.resolved_id
      : canonical && typeof canonical.id === 'string' && SESSION_ID.test(canonical.id) ? canonical.id : undefined;
    bots.push({
      slug, sessionId: resolved, hadCanonical: !!resolved,
      public: {
        id: `hermes:${slug}`, profileName: slug,
        displayName: (title || profileDisplay || prettifySlug(slug)).slice(0, 80),
        ...(description ? { description: description.slice(0, 200) } : {}),
        ...(resolved ? { canonicalSessionId: resolved } : {}),
      },
    });
    if (bots.length >= MAX_BOTS) break;
  }
  return bots;
}

function prettifySlug(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').trim().replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/** Only fixed, display-safe strings reach the renderer; raw errors can embed URLs or paths. */
function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/did not become ready|exited before|port is already|too much output|invalid port|could not be started|not installed/i.test(message)) return message.replace(/[^\x20-\x7e]/g, '').slice(0, 160);
  return 'Hermes service is not reachable';
}
