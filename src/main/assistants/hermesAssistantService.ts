import { StringDecoder } from 'node:string_decoder';
import { HermesOwnedChild, HERMES_CLEANUP_ERROR } from './hermesOwnedChild';
import { AssistantPresentationService, type PresentationBinding } from './assistantPresentation';
import type { AvatarDecoder } from './assistantAvatar';
import type { AssistantAvatar, AssistantPresentation, AssistantPresentationWriteResult } from '../../shared/types/assistantPresentation';
import { AssistantCronReader, type CronBinding, type CronTarget } from './assistantCron';
import { discoverHermesBackend, readHermesRendezvous } from './hermesDiscovery';
import type { AssistantDetails, AssistantRead, AssistantRoutine, AssistantRun } from '../../shared/types/assistantDetails';
import { displayText, record, parseActivity, parseHistory, parseProfile, readHermesRest, readSection } from './assistantDetails';
import {
  DEFAULT_ASSISTANT_SETTINGS,
  isValidAssistantId,
  type AssistantOpenResult,
  type AssistantSnapshot,
  type AssistantSettings,
  type AssistantSurfaceState,
  type HermesAssistantServiceState,
  type HermesAssistant,
} from '../../shared/types/assistants';
import { readPersistedAssistantSettings, validateAssistantSettings } from './assistantSettings';
import {
  HERMES_LOOPBACK_HOST,
  generateServiceToken,
  spawnHermesServe,
  waitForServeReady,
  type FetchLike,
  type ServeChild,
  type SpawnServe,
} from './hermesBackend';
import { HermesRpcClient, RpcError, defaultWebSocketFactory, frameByteLength, type WebSocketFactory, type WebSocketLike } from './hermesTransport';

export interface HermesAssistantServiceDeps {
  readSettings(): unknown;
  writeSettings(settings: AssistantSettings): void;
  onChanged(snapshot: AssistantSnapshot): void;
  onPtyData(assistantId: string, data: string): void;
  isShuttingDown(): boolean;
  /** Canonical local harness availability for `hermes`. Evaluated once per service lifetime (a restart picks up installs). */
  isHermesAvailable(): boolean;
  fetch?: FetchLike;
  readRendezvous?: typeof readHermesRendezvous;
  createWebSocket?: WebSocketFactory;
  spawnServe?: SpawnServe;
  generateToken?: () => string;
  now?: () => number;
  startTimeoutMs?: number;
  stopGraceMs?: number;
  /** Bounded wait for exact-child exit acknowledgement after SIGKILL. */
  stopKillMs?: number;
  /** A connected backend must survive this long before a later crash counts as a new failure episode. */
  stableAfterMs?: number;
  decodeAvatar?: AvatarDecoder;
}

const MAX_ASSISTANTS = 64;
const MAX_PTY_FRAME_BYTES = 1024 * 1024;
const REPLAY_LIMIT = 512 * 1024;
/** Hermes closes the attached PTY socket with this code when the TUI child exits. */
const PTY_CLOSE_CHILD_EXITED = 4410;
const PROFILE_SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SESSION_ID = /^[A-Za-z0-9._:-]{1,128}$/;
/** The one canonical title: (profile, "Bot Chat") is that profile's permanent chat identity in Hermes. */
export const CANONICAL_CHAT_TITLE = 'Bot Chat';
const CANONICAL_LIST_LIMIT = 200;

/** `hadCanonical`: the last roster listing positively reported a canonical chat (an empty lookup is then unconfirmed, never a reason to mint). */
interface RosterEntry { public: HermesAssistant; slug: string; home?: string; sessionId?: string; hadCanonical: boolean }

interface PtySession {
  assistantId: string;
  attach: string;
  socket: WebSocketLike | null;
  state: AssistantSurfaceState;
  replay: string;
  decoder: StringDecoder;
  size: { cols: number; rows: number } | null;
  generation: number;
}

type Endpoint = { port: number; token: string; host?: '127.0.0.1' | '[::1]'; ownership: 'external' | 'clanker' };

/**
 * Main-owned Hermes Assistant integration. Owns settings, backend discovery/adoption, the optional
 * Clanker-owned `hermes serve` child, the authenticated control connection, the Assistant roster and the
 * service-hosted chat PTYs. The renderer only ever sees display-safe snapshots; the backend token
 * never leaves this class.
 */
export class HermesAssistantService {
  private readonly fetcher: FetchLike;
  private readonly createWebSocket: WebSocketFactory;
  private readonly spawnServe: SpawnServe;
  private readonly now: () => number;
  private readonly available: boolean;
  private readonly presentation: AssistantPresentationService;
  private rosterReadEpoch = 0;
  private settings: AssistantSettings = { ...DEFAULT_ASSISTANT_SETTINGS };
  private state: HermesAssistantServiceState = 'disabled';
  private ownership: 'external' | 'clanker' | null = null;
  private error: string | undefined;
  private roster: RosterEntry[] = [];
  private endpoint: Endpoint | undefined;
  private rpc: HermesRpcClient | undefined;
  private owned: HermesOwnedChild | undefined;
  private shuttingDown = false;
  /** The latest in-flight owned-child stop. Discovery waits for it so a quick re-enable never races (or strands behind) an old stop. */
  private stopPromise: Promise<void> | undefined;
  private stopping = false;
  private generation = 0;
  private refreshOp: Promise<AssistantSnapshot> | undefined;
  private connectedAt = 0;
  private episodeRestarts = 0;
  private readonly sessions = new Map<string, PtySession>();
  private readonly opening = new Map<string, Promise<AssistantOpenResult>>();
  private readonly cron: AssistantCronReader;
  private detailRevision = 0;
  private cronCatalogIdentity = '';
  private readonly detailReads = new Map<string, Promise<AssistantDetails>>();
  private readonly detailControllers = new Set<AbortController>();

  constructor(private readonly deps: HermesAssistantServiceDeps) {
    this.fetcher = deps.fetch ?? ((url, init) => fetch(url, init) as ReturnType<FetchLike>);
    this.createWebSocket = deps.createWebSocket ?? defaultWebSocketFactory;
    this.spawnServe = deps.spawnServe ?? spawnHermesServe;
    this.now = deps.now ?? Date.now;
    this.settings = this.loadSettings();
    let available = false;
    try { available = deps.isHermesAvailable(); } catch { /* treated as not installed */ }
    this.available = available;
    this.presentation = new AssistantPresentationService((id) => this.presentationBinding(id), deps.decodeAvatar, this.now);
    this.cron = new AssistantCronReader((target) => this.cronBinding(target));
  }

  private loadSettings(): AssistantSettings {
    try { return readPersistedAssistantSettings(this.deps.readSettings()); } catch { return { ...DEFAULT_ASSISTANT_SETTINGS }; }
  }

  // ── snapshot ────────────────────────────────────────────────────────────────

  get(): AssistantSnapshot {
    return {
      available: this.available,
      presentationRevision: this.presentation.revision,
      settings: { ...this.settings, ...(this.settings.hiddenAssistantIds ? { hiddenAssistantIds: [...this.settings.hiddenAssistantIds] } : {}) },
      service: { state: this.state, ownership: this.ownership, ...(this.error ? { error: this.error } : {}),
        ...(this.owned?.cleanupIncomplete ? { cleanupIncomplete: true } : {}) },
      assistants: this.roster.filter((entry) => !entry.public.hiddenInHermes && !this.settings.hiddenAssistantIds?.includes(entry.public.id)).map((entry) => ({ ...entry.public })),
      profiles: this.roster.map((entry) => ({ ...entry.public })),
      surfaces: [...this.sessions.values()].map((session) => ({ assistantId: session.assistantId, state: session.state })),
    };
  }

  /** Shutdown stops only this exact owned child, never an adopted external service. */
  hasRunningOwnedService(): boolean { return !!this.owned; }

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
    // Dormant without the Hermes CLI: persisted preferences are kept but nothing is probed or spawned.
    if (this.available && this.settings.enabled) void this.refresh().catch(() => undefined);
  }

  configure(value: unknown): AssistantSnapshot {
    const next = validateAssistantSettings(value);
    const previous = this.settings;
    this.settings = next;
    this.deps.writeSettings({ ...next });
    if (!next.enabled && (previous.enabled || this.owned?.stopRequested)) {
      void this.disable().catch(() => undefined);
      return this.get();
    }
    if (!this.available) return this.publish();
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
    this.ownership = this.owned ? 'clanker' : null;
    this.publish();
    await this.stopOwned();
  }

  /** Window teardown: surfaces end, the backend (including an owned child) keeps running. */
  reset(): void {
    this.closeAllSessions();
  }

  /** App quit: sockets close and only the exact owned child is stopped. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.generation++;
    this.refreshOp = undefined;
    this.closeAllSessions();
    this.dropRpc();
    await this.stopOwned();
  }

  // ── refresh (coalesced within one generation) ───────────────────────────────

  refresh(): Promise<AssistantSnapshot> {
    // Retry remains available when disabled if an exact owned child still needs cleanup.
    if (!this.settings.enabled) return this.owned?.stopRequested
      ? this.stopOwned().then(() => this.get())
      : Promise.reject(new Error('Assistants integration is disabled'));
    if (this.shuttingDown) return Promise.reject(new Error('Assistants integration is shutting down'));
    if (!this.available) return Promise.resolve(this.get());
    if (this.refreshOp) return this.refreshOp;
    const generation = this.generation;
    const operation = this.run(generation);
    this.refreshOp = operation;
    const clear = () => { if (this.refreshOp === operation) this.refreshOp = undefined; };
    operation.then(clear, clear);
    return operation;
  }

  private current(generation: number): boolean {
    return generation === this.generation && this.settings.enabled && !this.shuttingDown && !this.deps.isShuttingDown() && !this.stopping;
  }

  private async run(generation: number): Promise<AssistantSnapshot> {
    // Serialize behind any owned-child stop still in flight: no second backend starts while the old one is
    // stopping, and once it settles this attempt is revalidated against the LATEST generation/settings
    // (a newer disable makes it a no-op; a newer enable is the attempt that proceeds).
    try {
      if (this.stopPromise || this.owned?.stopRequested) {
        await (this.stopPromise ?? this.stopOwned());
        if (!this.current(generation)) return this.get();
      }
      this.setState(this.endpoint ? this.state : 'probing');
      if (this.state === 'probing') this.publish();
      // 1. Reuse a healthy control connection for a plain roster refresh.
      if (this.rpc && !this.rpc.isClosed && this.endpoint) {
        try { await this.loadRoster(generation, this.rpc); return this.finishConnected(generation); }
        catch { this.dropRpc(); }
      }
      // 2. (Re)discover: adopt a compatible running backend, else optionally start our own.
      let endpoint = this.childAlive() && this.endpoint?.ownership === 'clanker' ? this.endpoint : undefined;
      if (!endpoint) {
        const probe = await discoverHermesBackend(this.fetcher, this.deps.readRendezvous);
        if (!this.current(generation)) return this.get();
        if (probe.kind === 'usable') {
          endpoint = { port: probe.port, token: probe.token, host: probe.host, ownership: 'external' };
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
      if (!this.current(generation) || this.owned?.cleanupIncomplete) return this.get();
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

  private childAlive(): boolean { return !!this.owned && !this.owned.hasExited; }

  private async startOwned(generation: number): Promise<Endpoint | undefined> {
    if (!this.current(generation)) return undefined;
    // Even an unexpectedly lost endpoint cannot authorize replacement of an owned child.
    if (this.owned) throw new Error(HERMES_CLEANUP_ERROR);
    const token = (this.deps.generateToken ?? generateServiceToken)();
    let child: ServeChild;
    try { child = this.spawnServe(token); }
    catch { this.finish(generation, 'error', 'Hermes could not be started. Is the hermes command installed?'); return undefined; }
    const owned = new HermesOwnedChild(child, () => this.onOwnedExit(child));
    this.owned = owned;
    this.ownership = 'clanker';
    let port: number;
    try {
      port = await waitForServeReady(child, this.deps.startTimeoutMs ?? 30_000);
    } catch (error) {
      // Keep owning the failed child until its bounded termination finishes: this refresh stays pending
      // (so a Retry coalesces onto it) and no replacement can spawn beside a still-live failed child.
      await this.stopOwned(owned);
      if (!this.current(generation)) return undefined;
      // A host owner can appear between discovery and spawn. New Hermes then attaches and exits
      // instead of emitting READY. Rediscover after our failed child is cleaned; never claim it.
      const probe = await discoverHermesBackend(this.fetcher, this.deps.readRendezvous);
      if (!this.current(generation)) return undefined;
      if (probe.kind === 'usable') return { port: probe.port, token: probe.token, host: probe.host, ownership: 'external' };
      this.finish(generation, probe.kind === 'unusable' ? 'detected-unusable' : 'error', probe.kind === 'unusable' ? probe.reason : safeMessage(error));
      return undefined;
    }
    owned.ready = true;
    if (!this.current(generation) || this.owned !== owned || owned.hasExited) {
      await this.stopOwned(owned);
      return undefined;
    }
    return { port, token, ownership: 'clanker' };
  }

  /** Unexpected exit of the owned child. At most one automatic restart per failure episode. */
  private onOwnedExit(child: ServeChild): void {
    const owned = this.owned;
    if (owned?.child !== child) return;
    // Startup failure/intentional stop is settled by its owning operation, never a crash restart.
    if (!owned.ready || owned.stopRequested) return;
    this.owned = undefined;
    if (this.stopping || this.shuttingDown || this.deps.isShuttingDown() || !this.settings.enabled) return;
    this.dropRpc();
    this.markSessionsDisconnected();
    const wasEstablished = this.state === 'connected';
    this.endpoint = undefined;
    this.ownership = null;
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

  /** One exact-child cleanup attempt; overlapping disable/shutdown/startup cleanup shares it. */
  private stopOwned(expected = this.owned): Promise<void> {
    // An old startup completion must never stop a newer generation's child.
    if (this.owned !== expected) return Promise.resolve();
    if (this.stopPromise) return this.stopPromise;
    const operation = this.stopOwnedChild();
    this.stopPromise = operation;
    const clear = () => { if (this.stopPromise === operation) this.stopPromise = undefined; };
    operation.then(clear, clear);
    return operation;
  }

  /** Retain the exact handle on failure. No discovery/adoption/replacement until cleanup verifies. */
  private async stopOwnedChild(): Promise<void> {
    const owned = this.owned;
    if (!owned) return;
    this.stopping = true;
    this.endpoint = undefined;
    try {
      await owned.stop(this.deps.stopGraceMs ?? 3000, this.deps.stopKillMs ?? 3000);
      if (this.owned === owned) {
        this.owned = undefined;
        this.ownership = null;
        this.setState(this.settings.enabled ? 'offline' : 'disabled');
        this.publish();
      }
    } catch {
      this.ownership = 'clanker';
      this.setState('error', HERMES_CLEANUP_ERROR);
      this.publish();
      throw new Error(HERMES_CLEANUP_ERROR);
    } finally { this.stopping = false; }
  }

  // ── control connection and roster ───────────────────────────────────────────

  private dropRpc(): void {
    const rpc = this.rpc;
    this.rpc = undefined;
    this.presentation.reset();
    this.invalidateDetails();
    rpc?.close();
  }

  private async connectRpc(generation: number, endpoint: Endpoint): Promise<HermesRpcClient | undefined> {
    const url = `ws://${endpoint.host ?? HERMES_LOOPBACK_HOST}:${endpoint.port}/api/ws?token=${encodeURIComponent(endpoint.token)}`;
    const rpc = new HermesRpcClient(this.createWebSocket(url), () => this.onRpcClosed(rpc));
    this.rpc = rpc;
    await rpc.ready;
    if (!this.current(generation)) { rpc.close(); return undefined; }
    return rpc;
  }

  private onRpcClosed(rpc: HermesRpcClient): void {
    if (this.rpc !== rpc) return;
    this.rpc = undefined;
    this.presentation.reset();
    this.invalidateDetails();
    if (!this.settings.enabled || this.deps.isShuttingDown() || this.stopping || this.state === 'disabled') return;
    this.markSessionsDisconnected();
    this.roster = [];
    // A still-live Clanker-owned child is kept (endpoint and ownership): Retry reconnects to it instead of
    // spawning another backend. Anything else is genuinely gone.
    if (!(this.childAlive() && this.endpoint?.ownership === 'clanker')) this.endpoint = undefined;
    this.setState('offline', 'Hermes service connection was lost');
    this.publish();
  }

  private async loadRoster(generation: number, rpc: HermesRpcClient, explicitRefresh = true): Promise<boolean> {
    const epoch = ++this.rosterReadEpoch;
    const result = await rpc.call('profiles.list', {});
    if (!this.current(generation) || this.rpc !== rpc || epoch !== this.rosterReadEpoch || !this.endpoint) return false;
    const token = this.endpoint.token;
    this.roster = parseAssistantRoster(result, true, [token]);
    const profiles = record(result).profiles;
    const ids = new Set(this.roster.map((entry) => entry.slug)); ids.add('default');
    const catalogIdentity = JSON.stringify(Array.isArray(profiles) ? profiles.flatMap((raw) => {
      const row = record(raw); return typeof row.name === 'string' && ids.has(row.name) ? [[row.name, row.path]] : [];
    }).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) : []);
    // A CAS preflight/postflight is not a user cron refresh. Keep valid reads if namespace identity agrees.
    if (explicitRefresh || catalogIdentity !== this.cronCatalogIdentity) this.invalidateDetails();
    this.cronCatalogIdentity = catalogIdentity;
    this.presentation.acceptRoster(result, this.roster.map((entry) => entry.public), token);
    if (this.state === 'connected') this.publish();
    return true;
  }

  private presentationBinding(id: unknown): PresentationBinding | undefined {
    if (!isValidAssistantId(id) || !this.settings.enabled || !this.available || this.state !== 'connected') return undefined;
    const entry = this.entry(id); const rpc = this.rpc; const generation = this.generation;
    if (!entry || !rpc || rpc.isClosed || !this.endpoint) return undefined;
    return { slug: entry.slug, rpc,
      live: () => this.current(generation) && this.state === 'connected' && this.rpc === rpc && !rpc.isClosed && this.entry(id)?.slug === entry.slug && this.entry(id)?.home === entry.home,
      reload: async () => {
        if (!await this.loadRoster(generation, rpc, false)) throw new Error('Roster read no longer current');
      } };
  }

  readPresentation(id: unknown): AssistantPresentation { return this.presentation.read(id); }
  updatePresentation(id: unknown, value: unknown): Promise<AssistantPresentationWriteResult> { return this.presentation.update(id, value); }
  readAvatar(id: unknown): Promise<AssistantAvatar> { return this.presentation.avatar(id); }

  private invalidateDetails(): void {
    this.detailRevision++;
    for (const controller of this.detailControllers) controller.abort();
    this.detailReads.clear();
    this.cron.invalidate();
  }

  private cronBinding(target: CronTarget): CronBinding | undefined {
    const rpc = this.rpc; const endpoint = this.endpoint; const generation = this.generation; const revision = this.detailRevision;
    if (!this.available || !this.current(generation) || this.state !== 'connected' || !rpc || rpc.isClosed || !endpoint) return undefined;
    const entry = target.kind === 'assistant' && isValidAssistantId(target.assistantId) ? this.entry(target.assistantId) : undefined;
    if (target.kind === 'assistant' && !entry) return undefined;
    return { profile: entry?.slug ?? 'default', token: endpoint.token,
      live: () => this.current(generation) && this.detailRevision === revision && this.state === 'connected' && this.rpc === rpc && !rpc.isClosed && this.endpoint === endpoint
        && (target.kind === 'default' || isValidAssistantId(target.assistantId) && this.entry(target.assistantId)?.slug === entry?.slug),
      read: (path, signal) => readHermesRest(this.fetcher, endpoint, path, signal) };
  }

  readDefaultRoutines(): Promise<AssistantRead<AssistantRoutine[]>> { return this.cron.routines({ kind: 'default' }); }
  readDefaultRoutineRuns(jobId: unknown): Promise<AssistantRead<AssistantRun[]>> { return this.cron.runs({ kind: 'default' }, jobId); }

  /** Lazy read-only details; independent section failures never affect the control connection or chat. */
  readDetails(assistantId: unknown): Promise<AssistantDetails> {
    return this.readAssistant(assistantId);
  }

  readRoutineRuns(assistantId: unknown, jobId: unknown): Promise<AssistantRead<AssistantRun[]>> {
    if (!isValidAssistantId(assistantId)) return Promise.resolve({ state: 'unavailable' });
    if (this.state !== 'connected') return Promise.resolve({ state: 'offline' });
    if (!this.entry(assistantId)) return Promise.resolve({ state: 'unavailable' });
    return this.cron.runs({ kind: 'assistant', assistantId }, jobId);
  }

  private readAssistant(assistantId: unknown): Promise<AssistantDetails> {
    const unavailable = (state: 'offline' | 'unavailable'): AssistantDetails =>
      ({ assistantId: isValidAssistantId(assistantId) ? assistantId : '', profile: { state }, history: { state }, routines: { state } });
    if (!isValidAssistantId(assistantId)) return Promise.resolve(unavailable('unavailable'));
    const entry = this.entry(assistantId); const rpc = this.rpc; const endpoint = this.endpoint;
    if (!entry || !rpc || rpc.isClosed || !endpoint || this.state !== 'connected') return Promise.resolve(unavailable(this.state === 'connected' ? 'unavailable' : 'offline'));
    const key = assistantId;
    const previous = this.detailReads.get(key); if (previous) return previous;
    if (this.detailReads.size >= 8) return Promise.resolve(unavailable('unavailable'));
    const generation = this.generation; const revision = this.detailRevision;
    const controller = new AbortController(); this.detailControllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 10_000);
    const live = () => this.current(generation) && this.detailRevision === revision && this.rpc === rpc && this.endpoint === endpoint && this.entry(assistantId)?.slug === entry.slug && !controller.signal.aborted;
    const redactions = [endpoint.token, entry.home ?? ''];
    const operation = (async () => {
      const [profile, history, routines] = await Promise.all([
        readSection(async () => parseProfile(await rpc.call('profiles.describe', { name: entry.slug }), entry.slug, redactions)),
        readSection(async () => parseHistory(await rpc.call('session.list', { profile: entry.slug, limit: 20, include_hidden: false }), redactions)),
        this.cron.routines({ kind: 'assistant', assistantId }),
      ]);
      const result: AssistantDetails = { assistantId, profile, history, routines };
      // Even a backend title/preview containing its own credential must not expose that token.
      const safeResult = JSON.parse(JSON.stringify(result, (_key, value: unknown) => typeof value === 'string' ? value.split(endpoint.token).join('[redacted]') : value)) as typeof result;
      return live() ? safeResult : unavailable('unavailable');
    })().finally(() => {
      clearTimeout(timer); this.detailControllers.delete(controller);
      if (this.detailReads.get(key) === operation) this.detailReads.delete(key);
    });
    this.detailReads.set(key, operation);
    return operation;
  }

  // ── Assistant surfaces (service-hosted chat PTYs) ───────────────────────────

  private entry(assistantId: string): RosterEntry | undefined { return this.roster.find((entry) => entry.public.id === assistantId); }

  /** Open (or reveal) the Assistant's canonical Bot Chat. Concurrent opens of one Assistant share one resolution. */
  /** True while this opaque id resolves to a roster Assistant (or one with an open surface). Gates Browser ownership. */
  hasAssistant(assistantId: string): boolean {
    return this.settings.enabled && this.available && isValidAssistantId(assistantId) && (!!this.entry(assistantId) || this.sessions.has(assistantId));
  }

  openSurface(assistantId: unknown): Promise<AssistantOpenResult> {
    if (!isValidAssistantId(assistantId)) return Promise.reject(new Error('Invalid assistant'));
    const existing = this.sessions.get(assistantId);
    if (existing && (existing.state === 'open' || existing.state === 'connecting') && existing.socket) return Promise.resolve({ state: existing.state, replay: existing.replay });
    const inflight = this.opening.get(assistantId);
    if (inflight) return inflight;
    const operation = this.openResolved(assistantId).finally(() => { if (this.opening.get(assistantId) === operation) this.opening.delete(assistantId); });
    this.opening.set(assistantId, operation);
    return operation;
  }

  private async openResolved(assistantId: string): Promise<AssistantOpenResult> {
    const entry = this.entry(assistantId);
    const rpc = this.rpc;
    const endpoint = this.endpoint;
    const previous = this.sessions.get(assistantId);
    if (!entry || !endpoint || !rpc || rpc.isClosed || this.state !== 'connected') {
      if (previous) { previous.state = 'disconnected'; this.publish(); return { state: 'disconnected', replay: previous.replay }; }
      throw new Error('Hermes service is not connected');
    }
    const generation = this.generation;
    const session = previous ?? this.newSession(assistantId);
    session.state = 'connecting';
    this.sessions.set(assistantId, session);
    this.publish();
    let sessionId: string;
    try {
      sessionId = await this.resolveCanonicalChat(entry, rpc);
    } catch {
      // Fail closed: nothing was created on a lookup failure, and no scratch conversation is substituted.
      if (this.sessions.get(assistantId) === session && this.current(generation)) { session.state = 'unavailable'; this.publish(); }
      return { state: 'unavailable', replay: session.replay };
    }
    if (!this.current(generation) || this.sessions.get(assistantId) !== session || !this.endpoint) return { state: session.state, replay: session.replay };
    entry.sessionId = sessionId;
    entry.hadCanonical = true;
    this.attach(session, entry, this.endpoint);
    this.publish();
    return { state: session.state, replay: session.replay };
  }

  /**
   * The Assistant's ONE permanent chat, per Hermes' own contract: the profile's session titled exactly
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

  private newSession(assistantId: string): PtySession {
    const slug = assistantId.slice('hermes:'.length);
    return {
      // Stable per Assistant (not per run): Hermes keys its keep-alive PTY on this, so a reconnect or restart
      // re-attaches the same chat process instead of stacking a second TUI beside the lingering one.
      assistantId, attach: `clanker-assistant-${slug}`, socket: null, state: 'connecting',
      replay: '', decoder: new StringDecoder('utf8'), size: null, generation: 0,
    };
  }

  private attach(session: PtySession, entry: RosterEntry, endpoint: Endpoint): void {
    session.state = 'connecting';
    session.generation++;
    const generation = session.generation;
    const params = new URLSearchParams({ token: endpoint.token, profile: entry.slug, resume: entry.sessionId!, attach: session.attach });
    const socket = this.createWebSocket(`ws://${endpoint.host ?? HERMES_LOOPBACK_HOST}:${endpoint.port}/api/pty?${params.toString()}`);
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
      this.deps.onPtyData(session.assistantId, text);
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

  writePty(assistantId: unknown, data: unknown): void {
    if (!isValidAssistantId(assistantId) || typeof data !== 'string' || data.length === 0 || Buffer.byteLength(data) > 64 * 1024) return;
    const session = this.sessions.get(assistantId);
    if (session?.socket && session.state === 'open') session.socket.send(data);
  }

  resizePty(assistantId: unknown, cols: unknown, rows: unknown): void {
    if (!isValidAssistantId(assistantId) || !Number.isInteger(cols) || !Number.isInteger(rows)) return;
    const c = cols as number; const r = rows as number;
    if (c < 1 || c > 1000 || r < 1 || r > 1000) return;
    const session = this.sessions.get(assistantId);
    if (!session) return;
    session.size = { cols: c, rows: r };
    if (session.socket && session.state === 'open') this.sendResize(session);
  }

  /** Hermes' own resize framing: the escape `ESC [ RESIZE:<cols>;<rows> ]` is consumed by /api/pty, never written to the TUI. */
  private sendResize(session: PtySession): void {
    if (!session.socket || !session.size) return;
    session.socket.send(`\x1b[RESIZE:${session.size.cols};${session.size.rows}]`);
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
 * uses the raw slug; display is Assistant title, then profile display name, then the prettified slug.
 */
export function parseAssistantRoster(result: unknown, includeHidden = false, redactions: readonly string[] = []): RosterEntry[] {
  const profiles = result && typeof result === 'object' ? (result as { profiles?: unknown }).profiles : undefined;
  if (!Array.isArray(profiles)) throw new Error('Hermes returned an unexpected profile list');
  const assistants: RosterEntry[] = [];
  const seen = new Set<string>();
  for (const raw of profiles) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const slug = typeof row.name === 'string' ? row.name : '';
    if (!PROFILE_SLUG.test(slug) || slug === 'default' || row.is_default === true || seen.has(slug)) continue;
    const uiMeta = row.ui_meta && typeof row.ui_meta === 'object' ? row.ui_meta as Record<string, unknown> : null;
    const botMeta = uiMeta?.['hermes-bots'];
    const meta = botMeta && typeof botMeta === 'object' && !Array.isArray(botMeta) ? botMeta as Record<string, unknown> : {};
    if (meta.hidden === true && !includeHidden) continue;
    seen.add(slug);
    const title = typeof meta.title === 'string' ? meta.title.trim() : '';
    const profileDisplay = typeof row.display_name === 'string' ? row.display_name.trim() : '';
    const description = typeof meta.description === 'string' && meta.description.trim() ? meta.description.trim()
      : typeof row.description === 'string' && row.description.trim() ? row.description.trim() : undefined;
    const privateValues = typeof row.path === 'string' ? [...redactions, row.path] : redactions;
    const safeDescription = displayText(description, 200, privateValues);
    const canonical = row.canonical_session && typeof row.canonical_session === 'object' ? row.canonical_session as Record<string, unknown> : null;
    const resolved = canonical && typeof canonical.resolved_id === 'string' && SESSION_ID.test(canonical.resolved_id) ? canonical.resolved_id
      : canonical && typeof canonical.id === 'string' && SESSION_ID.test(canonical.id) ? canonical.id : undefined;
    assistants.push({
      slug, home: typeof row.path === 'string' ? row.path : undefined, sessionId: resolved, hadCanonical: !!resolved,
      public: {
        id: `hermes:${slug}`,
        ...(meta.hidden === true ? { hiddenInHermes: true } : {}),
        ...(row.model !== undefined || row.provider !== undefined || row.skill_count !== undefined || row.last_session || row.worker_session ? { activity: parseActivity(row, privateValues) } : {}),
        displayName: displayText(title || profileDisplay || prettifySlug(slug), 80, privateValues) ?? 'Hermes Assistant',
        ...(safeDescription ? { description: safeDescription } : {}),
      },
    });
    if (assistants.length >= MAX_ASSISTANTS) break;
  }
  return assistants;
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
