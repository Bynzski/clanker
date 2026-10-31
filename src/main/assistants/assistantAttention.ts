import type { AssistantAttention } from '../../shared/types/assistants';
import { frameByteLength, type WebSocketFactory, type WebSocketLike } from './hermesTransport';

/** Read-only Hermes PTY sidecar. Never forwards prompts, tool arguments or native session IDs. */
export class AssistantAttentionObserver {
  private socket: WebSocketLike | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private staleTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private root: string | undefined;
  private state: AssistantAttention = 'unknown';
  private readonly requests = new Set<string>();
  private readyResolve: (() => void) | undefined;
  readonly ready: Promise<void>;

  constructor(private readonly url: string, private readonly storedId: string,
    private readonly createSocket: WebSocketFactory, private readonly changed: (state: AssistantAttention) => void) {
    this.ready = new Promise((resolve) => { this.readyResolve = resolve; });
    this.connect();
  }

  private set(state: AssistantAttention): void {
    if (state === this.state) return;
    this.state = state;
    this.changed(state);
    this.touch();
  }

  private touch(): void {
    clearTimeout(this.staleTimer);
    if (this.state === 'working' || this.state === 'needs-input') {
      this.staleTimer = setTimeout(() => { this.requests.clear(); this.set('unknown'); }, 120_000);
    }
  }

  private connect(): void {
    if (this.disposed) return;
    let socket: WebSocketLike;
    try { socket = this.createSocket(this.url); } catch { this.retry(); return; }
    this.socket = socket;
    const live = () => !this.disposed && this.socket === socket;
    const lost = () => {
      if (!live()) return;
      this.socket = undefined;
      try { socket.close(); } catch { /* already closed */ }
      this.retry();
    };
    this.timer = setTimeout(lost, 5000);
    socket.addEventListener('open', (() => {
      if (!live()) return;
      clearTimeout(this.timer);
      this.readyResolve?.(); this.readyResolve = undefined;
    }) as never);
    socket.addEventListener('message', ((event: { data: unknown }) => {
      if (!live()) return;
      const size = frameByteLength(event.data);
      if (size === null || size > 1024 * 1024 || typeof event.data !== 'string') { lost(); return; }
      this.consume(event.data);
    }) as never);
    socket.addEventListener('close', lost as never);
    socket.addEventListener('error', lost as never);
  }

  private retry(): void {
    clearTimeout(this.timer);
    this.requests.clear();
    this.set('unknown');
    this.readyResolve?.(); this.readyResolve = undefined;
    if (!this.disposed) this.timer = setTimeout(() => this.connect(), 5000);
  }

  private consume(data: string): void {
    let frame: Record<string, unknown>;
    try { frame = JSON.parse(data); } catch { return; }
    if (!frame || typeof frame !== 'object') return;
    // The PTY publisher mirrors resume/create responses too; these establish the root
    // before the first turn, without mistaking a child session for the Assistant.
    const result = frame.result as Record<string, unknown> | undefined;
    const info = result?.info as Record<string, unknown> | undefined;
    if (typeof result?.session_id === 'string' && info?.stored_session_id === this.storedId && !this.root) {
      this.root = result.session_id;
      if (typeof info.running === 'boolean') this.set(info.running ? 'working' : 'idle');
      return;
    }
    const params = frame.params as Record<string, unknown> | undefined;
    if (!params || typeof params !== 'object' || typeof params.session_id !== 'string') return;
    const payload = params.payload as Record<string, unknown> | undefined;
    if (frame.method === 'event' && params.type === 'session.info' && payload?.stored_session_id === this.storedId) {
      if (this.root && this.root !== params.session_id) return;
      this.root = params.session_id;
      if (typeof payload.running === 'boolean' && (payload.running || (this.state !== 'finished' && this.state !== 'error'))) this.set(this.requests.size ? 'needs-input' : payload.running ? 'working' : 'idle');
      return;
    }
    if (!this.root || params.session_id !== this.root) return;
    this.touch();
    if ((frame.method === 'approval' || frame.method === 'clarify') && typeof frame.id === 'string' && frame.id.length <= 256) {
      if (this.requests.size >= 64) { this.set('unknown'); return; }
      this.requests.add(frame.id); this.set('needs-input'); return;
    }
    if (frame.method !== 'event') return;
    switch (params.type) {
      // Successful replies are not mirrored by the sidecar. Root model output
      // is the next native indication that execution has resumed.
      case 'message.delta':
      case 'message.start': this.requests.clear(); this.set('working'); break;
      case 'request.cancel':
        if (typeof payload?.id === 'string' && this.requests.delete(payload.id) && !this.requests.size) this.set('working');
        break;
      case 'message.complete':
        this.requests.clear();
        this.set(payload?.status === 'complete' ? 'finished' : payload?.status === 'error' ? 'error' : payload?.status === 'interrupted' ? 'idle' : 'unknown');
        break;
      case 'session.reclaimed': this.requests.clear(); this.set('unknown'); break;
    }
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.staleTimer);
    clearTimeout(this.timer);
    this.readyResolve?.(); this.readyResolve = undefined;
    const socket = this.socket; this.socket = undefined;
    try { socket?.close(); } catch { /* already closed */ }
    this.set('unknown');
  }
}
