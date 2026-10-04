/**
 * Minimal, injectable transport primitives for the Hermes backend: a WebSocket surface (the global
 * WebSocket in production, a fake in tests) and a small JSON-RPC client for the TUI gateway.
 * Nothing here logs payloads, tokens or URLs.
 */

export interface WebSocketLike {
  binaryType: string;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: never) => void): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export const defaultWebSocketFactory: WebSocketFactory = (url) => new WebSocket(url) as unknown as WebSocketLike;

export const MAX_RPC_FRAME_BYTES = 4 * 1024 * 1024;

interface MessageEventLike { data: unknown }

/** Byte length of a text/binary frame payload, or null when the type is unsupported (e.g. Blob). */
export function frameByteLength(data: unknown): number | null {
  if (typeof data === 'string') return Buffer.byteLength(data);
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return null;
}

export class RpcError extends Error {
  /** The server's own message, kept for classification (e.g. "already in use") and never shown to the renderer. */
  constructor(message: string, readonly code?: number, readonly detail = '') { super(message); }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** One authenticated JSON-RPC connection. Only methods Clanker needs are called through `call`. */
export class HermesRpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private closed = false;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  readonly ready: Promise<void>;
  private readyDone = false;

  constructor(private readonly socket: WebSocketLike, private readonly onClosed: () => void, readyTimeoutMs = 5000) {
    socket.binaryType = 'arraybuffer';
    this.ready = new Promise<void>((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.ready.catch(() => undefined);
    const readyTimer = setTimeout(() => this.fail(new Error('Hermes gateway did not become ready')), readyTimeoutMs);
    this.ready.finally(() => clearTimeout(readyTimer)).catch(() => undefined);
    socket.addEventListener('message', ((event: MessageEventLike) => this.onMessage(event.data)) as never);
    socket.addEventListener('close', (() => this.fail(new Error('Hermes gateway connection closed'))) as never);
    socket.addEventListener('error', (() => this.fail(new Error('Hermes gateway connection failed'))) as never);
  }

  private onMessage(data: unknown): void {
    const size = frameByteLength(data);
    if (size === null || size > MAX_RPC_FRAME_BYTES || typeof data !== 'string') { this.fail(new Error('Hermes gateway sent an unusable frame')); return; }
    let frame: { id?: unknown; method?: unknown; params?: { type?: unknown }; result?: unknown; error?: { message?: unknown; code?: unknown } };
    try { frame = JSON.parse(data); } catch { return; }
    if (!frame || typeof frame !== 'object') return;
    if (frame.method === 'event' && frame.params?.type === 'gateway.ready' && !this.readyDone) {
      this.readyDone = true;
      this.readyResolve();
      return;
    }
    if (typeof frame.id !== 'number') return;
    const entry = this.pending.get(frame.id);
    if (!entry) return;
    this.pending.delete(frame.id);
    clearTimeout(entry.timer);
    if (frame.error) entry.reject(new RpcError('Hermes request failed', typeof frame.error.code === 'number' ? frame.error.code : undefined, typeof frame.error.message === 'string' ? frame.error.message.slice(0, 300) : ''));
    else entry.resolve(frame.result);
  }

  call(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Hermes gateway connection closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Hermes request timed out')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params })); }
      catch { this.pending.delete(id); clearTimeout(timer); reject(new Error('Hermes gateway connection closed')); }
    });
  }

  private fail(error: Error): void {
    if (!this.readyDone) { this.readyDone = true; this.readyReject(error); }
    if (this.closed) return;
    this.closed = true;
    for (const [id, entry] of this.pending) { clearTimeout(entry.timer); entry.reject(error); this.pending.delete(id); }
    try { this.socket.close(); } catch { /* already closed */ }
    this.onClosed();
  }

  close(): void { this.fail(new Error('Hermes gateway connection closed')); }
  get isClosed(): boolean { return this.closed; }
}
