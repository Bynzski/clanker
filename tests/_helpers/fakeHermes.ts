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
  { name: 'default', is_default: true, display_name: '', canonical_session: { id: 'sess-default' } },
  { name: 'fred', ui_meta: { 'hermes-bots': { title: 'Fred the Helper' } }, display_name: 'Frederick', canonical_session: { id: 'sess-fred-root', resolved_id: 'sess-fred-tip' } },
  { name: 'reviewer', ui_meta: { 'hermes-bots': {} }, display_name: 'Code Reviewer', canonical_session: { id: 'sess-rev' } },
  { name: 'nobot', ui_meta: { other: {} } },
  { name: 'ops', ui_meta: { 'hermes-bots': { hidden: true } }, canonical_session: { id: 'sess-ops' } },
  { name: 'fresh', ui_meta: { 'hermes-bots': { title: 'Fresh' } }, canonical_session: null },
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
        if (frame.method === 'profiles.list') {
          const reply = () => socket.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { profiles: this.profiles, bot_mode_protocol: true } }) });
          if (this.holdRoster) void this.holdRoster.then(reply); else queueMicrotask(reply);
        }
      };
    }
    return socket;
  });

  ptySockets(): FakeSocket[] { return this.sockets.filter((s) => new URL(s.url).pathname === '/api/pty'); }
  wsSockets(): FakeSocket[] { return this.sockets.filter((s) => new URL(s.url).pathname === '/api/ws'); }
}
