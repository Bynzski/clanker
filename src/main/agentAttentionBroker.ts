import { randomBytes } from 'node:crypto';
import * as net from 'node:net';
import type { AgentAttentionEvent, AgentAttentionUpdate } from '../shared/types/agentAttention';

const EVENTS = new Set<AgentAttentionEvent>([
  'turn_started', 'input_requested', 'input_resolved', 'turn_completed', 'session_ended',
]);
const MAX_MESSAGE_BYTES = 2048;
const EVENT_FIELDS = new Set(['version', 'token', 'harness', 'event', 'sessionId', 'turnId']);

interface Registration {
  terminalId: string;
  harness: string;
}

/** A loopback-only, advisory channel for hook notifications. It never accepts commands. */
export class AgentAttentionBroker {
  private readonly registrations = new Map<string, Registration>();
  private server: net.Server | null = null;
  private startPromise: Promise<number> | null = null;

  constructor(private readonly onUpdate: (update: AgentAttentionUpdate) => void) {}

  async start(): Promise<number> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise<number>((resolve, reject) => {
      const server = net.createServer((socket) => {
        socket.setTimeout(1000, () => socket.destroy());
        let body = '';
        socket.on('data', (chunk: Buffer) => {
          if (Buffer.byteLength(body) + chunk.length > MAX_MESSAGE_BYTES) {
            socket.destroy();
            return;
          }
          body += chunk.toString('utf8');
        });
        socket.on('end', () => this.receive(body));
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

  async register(terminalId: string, harness: string): Promise<Record<string, string>> {
    const port = await this.start();
    const token = randomBytes(32).toString('hex');
    this.registrations.set(token, { terminalId, harness });
    return {
      CLANKER_ATTENTION_PORT: String(port),
      CLANKER_ATTENTION_TOKEN: token,
      CLANKER_ATTENTION_HARNESS: harness,
    };
  }

  release(terminalId: string): void {
    for (const [token, registration] of this.registrations) {
      if (registration.terminalId === terminalId) this.registrations.delete(token);
    }
  }

  close(): void {
    this.registrations.clear();
    this.server?.close();
    this.server = null;
    this.startPromise = null;
  }

  /** Public for focused validation tests; the transport uses the same boundary. */
  receive(raw: string): void {
    if (Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) return;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const data = value as Record<string, unknown>;
    if (Object.keys(data).some((key) => !EVENT_FIELDS.has(key))) return;
    if (data.version !== 1 || typeof data.token !== 'string') return;
    const registration = this.registrations.get(data.token);
    if (!registration || data.harness !== registration.harness) return;
    if (typeof data.event !== 'string' || !EVENTS.has(data.event as AgentAttentionEvent)) return;
    if (data.sessionId !== undefined && (typeof data.sessionId !== 'string' || data.sessionId.length > 128)) return;
    if (data.turnId !== undefined && (typeof data.turnId !== 'string' || data.turnId.length > 128)) return;
    this.onUpdate({
      terminalId: registration.terminalId,
      event: data.event as AgentAttentionEvent,
      ...(typeof data.sessionId === 'string' ? { sessionId: data.sessionId } : {}),
      ...(typeof data.turnId === 'string' ? { turnId: data.turnId } : {}),
    });
  }
}
