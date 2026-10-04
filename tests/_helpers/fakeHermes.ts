import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { vi } from 'vitest';
import type { ServeChild } from '../../src/main/assistants/hermesBackend';
import type { WebSocketLike } from '../../src/main/assistants/hermesTransport';

export const TOKEN = 'tok_ABCDEFGHIJKLMNOPQRSTUV_0123456789-xyz';

type Listener = (event: never) => void;
export class FakeSocket implements WebSocketLike {
  binaryType = 'blob';
  sent: string[] = [];
  closed = false;
  private listeners = new Map<string, Listener[]>();
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: Listener): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  emit(type: string, event: object = {}): void { for (const l of this.listeners.get(type) ?? []) (l as (e: object) => void)(event); }
  send(data: string | Uint8Array): void { this.sent.push(typeof data === 'string' ? data : Buffer.from(data).toString()); }
  close(code?: number): void { if (this.closed) return; this.closed = true; this.emit('close', { code: code ?? 1000 }); }
}

export function fakeChild(): ServeChild & EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn>; exitCode: number | null; crash: (code?: number) => void } {
  const child = new EventEmitter() as never as ReturnType<typeof fakeChild>;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.kill = vi.fn(() => { if (child.exitCode === null) { child.exitCode = 0; setImmediate(() => child.emit('exit', 0)); } return true; });
  child.crash = (code = 1) => { child.exitCode = code; child.emit('exit', code); };
  return child;
}

export interface BotFixture { name: string; ui_meta?: object; display_name?: string; description?: string; canonical_session?: { id: string; resolved_id?: string } | null; is_default?: boolean }

export const defaultProfiles = (): BotFixture[] => [
  { name: 'default', is_default: true, canonical_session: { id: 'sess-default' } },
  { name: 'fred', description: 'Fred is a general-purpose assistant.', canonical_session: null },
  { name: 'reviewer', ui_meta: { 'hermes-bots': { title: 'Code Reviewer', description: 'Reviews changes' } }, display_name: 'rev', canonical_session: { id: 'sess-rev-root', resolved_id: 'sess-rev-tip' } },
  { name: 'ops-agent', display_name: 'Ops Agent', canonical_session: { id: 'sess-ops' } },
  { name: 'hidden-one', ui_meta: { 'hermes-bots': { hidden: true } }, canonical_session: { id: 'sess-hidden' } },
  { name: 'bad name!', canonical_session: null },
  { name: '', canonical_session: null },
];

/** A scripted Hermes backend: status/bootstrap over fetch, /api/ws JSON-RPC and /api/pty sockets. */
export class FakeHermes {
  running = true;
  authRequired = false;
  bootstrap: string | null = `<script>window.__HERMES_SESSION_TOKEN__="${TOKEN}";window.__HERMES_AUTH_REQUIRED__=false;</script>`;
  profiles: BotFixture[] = defaultProfiles();
  sockets: FakeSocket[] = [];
  fetched: string[] = [];
  holdRoster: Promise<void> | null = null;
  rpcCalls: string[] = [];
  /** Every RPC with its params, in order. */
  calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  /** Per-profile canonical "Bot Chat" stored id, as the registry would answer an exact lookup. */
  canonical: Record<string, string> = Object.fromEntries(defaultProfiles().flatMap((profile) => profile.canonical_session ? [[profile.name, profile.canonical_session.resolved_id ?? profile.canonical_session.id]] : []));
  listFails = false;
  listEmpty = false;
  /** When set, session.title answers "already in use" and the registry then holds this winner. */
  titleRace: string | null = null;
  titleFails = false;
  private created = 0;

  private handle(method: string, params: Record<string, unknown>): { result?: unknown; error?: { code: number; message: string } } {
    if (method === 'profiles.list') return { result: { profiles: this.profiles, bot_mode_protocol: true } };
    if (method === 'session.list') {
      if (this.listFails) return { error: { code: 5006, message: 'database is locked' } };
      const id = this.canonical[String(params.profile)];
      if (this.listEmpty || !id) return { result: { sessions: [] } };
      return { result: { sessions: [{ id, resolved_id: id, title: 'Bot Chat', root_title: 'Bot Chat' }] } };
    }
    if (method === 'session.create') {
      this.created++;
      return { result: { session_id: `rt-${this.created}`, stored_session_id: `stored-${this.created}` } };
    }
    if (method === 'session.title') {
      if (this.titleFails) return { error: { code: 5007, message: 'boom' } };
      const profile = [...this.calls].reverse().find((call) => call.method === 'session.create')?.params.profile;
      if (this.titleRace) { this.canonical[String(profile)] = this.titleRace; return { error: { code: 4022, message: 'title "Bot Chat" is already in use' } }; }
      this.canonical[String(profile)] = `stored-${this.created}`;
      return { result: { pending: false, title: params.title } };
    }
    return { error: { code: -32601, message: 'unknown method' } };
  }

  fetch = vi.fn(async (url: string) => {
    this.fetched.push(url);
    if (!this.running) throw new Error('ECONNREFUSED');
    const path = new URL(url).pathname;
    if (path === '/api/status') {
      return { ok: true, status: 200, json: async () => ({ version: '0.21.5', config_version: 49, install_id: 'x', auth_required: this.authRequired }), text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => this.bootstrap ?? '' };
  });

  createWebSocket = vi.fn((url: string) => {
    const socket = new FakeSocket(url);
    this.sockets.push(socket);
    const path = new URL(url).pathname;
    setTimeout(() => {
      if (!this.running) { socket.emit('error'); socket.close(1006); return; }
      if (path === '/api/ws') socket.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: {} } }) });
      else socket.emit('open');
    }, 0);
    if (path === '/api/ws') {
      const send = socket.send.bind(socket);
      socket.send = (data) => {
        send(data);
        const frame = JSON.parse(String(data));
        this.rpcCalls.push(frame.method);
        this.calls.push({ method: frame.method, params: frame.params ?? {} });
        const reply = () => {
          const outcome = this.handle(frame.method, frame.params ?? {});
          socket.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', id: frame.id, ...outcome }) });
        };
        if (frame.method === 'profiles.list' && this.holdRoster) void this.holdRoster.then(reply); else queueMicrotask(reply);
      };
    }
    return socket;
  });

  ptySockets(): FakeSocket[] { return this.sockets.filter((s) => new URL(s.url).pathname === '/api/pty'); }
  wsSockets(): FakeSocket[] { return this.sockets.filter((s) => new URL(s.url).pathname === '/api/ws'); }
}
