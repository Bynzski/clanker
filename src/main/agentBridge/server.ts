import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { AgentBridgeCredentials, AgentBridgeGrant } from './credentials';
import type { AgentBridgeToolResult } from './capabilities';
import type { ToolJsonSchema } from './input';

export const AGENT_BRIDGE_PATH = '/mcp';
export const AGENT_BRIDGE_LOOPBACK_HOST = '127.0.0.1';

/** Hard bounds. Anything past them is refused rather than truncated. */
export const AGENT_BRIDGE_LIMITS = Object.freeze({
  maxBodyBytes: 64 * 1024,
  maxBatch: 16,
  maxConcurrentRequests: 32,
  maxHeaderBytes: 8 * 1024,
  /** Receiving a request (headers and body). Tool execution has its own bound below. */
  requestTimeoutMs: 15_000,
  maxToolResultBytes: 64 * 1024,
  /** Upper bound on one tool call (the HTTP timeouts above only bound receiving the request). */
  toolTimeoutMs: 10_000,
});

export interface AgentBridgeToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolJsonSchema;
}

/**
 * What the transport needs from the capability layer. The transport authenticates and bounds
 * requests; the host decides what an authenticated grant may see and do.
 */
export interface AgentBridgeToolHost {
  listTools(grant: AgentBridgeGrant): AgentBridgeToolDescriptor[];
  callTool(grant: AgentBridgeGrant, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<AgentBridgeToolResult>;
  /** Guidance for this caller, derived from what it was granted. */
  instructionsFor?(grant: AgentBridgeGrant): string | undefined;
}

export interface AgentBridgeServerOptions {
  credentials: AgentBridgeCredentials;
  host: AgentBridgeToolHost;
  version: () => string;
}

const BEARER = /^Bearer ([^\s]+)$/;

function reply(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) { res.end(); return; }
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : { 'Content-Length': '0' }),
    ...headers,
  });
  res.end(payload);
}

const rpcError = (code: number, message: string) => ({ jsonrpc: '2.0', error: { code, message }, id: null });

class BodyTooLargeError extends Error {}

/** Reads at most `limit` bytes; the connection is dropped as soon as the limit is crossed. */
function readBounded(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) { reject(new BodyTooLargeError()); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) { reject(new BodyTooLargeError()); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('aborted')));
  });
}

/**
 * Clanker's MCP endpoint: loopback only, stateless Streamable HTTP, one bearer credential per
 * launched terminal. Identity comes from the credential on every request; nothing a client sends in
 * a body or header can select or widen it. Not a daemon: it starts on first use and stops with
 * Clanker.
 */
export class AgentBridgeServer {
  private http: HttpServer | null = null;
  private starting: Promise<string> | null = null;
  private inflight = 0;
  private closed = false;

  constructor(private readonly options: AgentBridgeServerOptions) {}

  /** Starts the listener once. Resolves with the endpoint URL. */
  start(): Promise<string> {
    if (this.closed) return Promise.reject(new Error('Agent bridge is shut down'));
    this.starting ??= this.listen().catch((error) => { this.starting = null; throw error; });
    return this.starting;
  }

  get url(): string | null {
    const address = this.http?.address();
    return address && typeof address === 'object' ? `http://${AGENT_BRIDGE_LOOPBACK_HOST}:${address.port}${AGENT_BRIDGE_PATH}` : null;
  }

  /** Stops accepting connections and drops open ones. Idempotent. */
  async close(): Promise<void> {
    this.closed = true;
    const http = this.http;
    this.http = null;
    this.starting = null;
    if (!http) return;
    await new Promise<void>((resolve) => {
      http.close(() => resolve());
      http.closeAllConnections();
    });
  }

  private listen(): Promise<string> {
    return new Promise((resolve, reject) => {
      const http = createServer({ maxHeaderSize: AGENT_BRIDGE_LIMITS.maxHeaderBytes }, (req, res) => {
        void this.handle(req, res).catch(() => reply(res, 500, rpcError(-32603, 'Internal error')));
      });
      http.requestTimeout = AGENT_BRIDGE_LIMITS.requestTimeoutMs;
      http.headersTimeout = AGENT_BRIDGE_LIMITS.requestTimeoutMs;
      http.keepAliveTimeout = 5_000;
      http.once('error', reject);
      // Loopback literal, ephemeral port: never a wildcard or LAN interface.
      http.listen({ host: AGENT_BRIDGE_LOOPBACK_HOST, port: 0 }, () => {
        const address = http.address() as AddressInfo;
        if (address.address !== AGENT_BRIDGE_LOOPBACK_HOST) {
          http.close();
          reject(new Error('Agent bridge failed to bind loopback'));
          return;
        }
        http.off('error', reject);
        http.on('error', (error) => console.warn('[clanker-grid] agent bridge listener error:', error.message));
        if (this.closed) { http.close(); reject(new Error('Agent bridge is shut down')); return; }
        this.http = http;
        resolve(`http://${AGENT_BRIDGE_LOOPBACK_HOST}:${address.port}${AGENT_BRIDGE_PATH}`);
      });
    });
  }

  private hostAllowed(req: IncomingMessage): boolean {
    const address = this.http?.address();
    if (!address || typeof address !== 'object') return false;
    // DNS-rebinding guard: only the literal loopback authority this listener owns.
    return req.headers.host === `${AGENT_BRIDGE_LOOPBACK_HOST}:${address.port}`
      || req.headers.host === `localhost:${address.port}`;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.inflight >= AGENT_BRIDGE_LIMITS.maxConcurrentRequests) {
      reply(res, 503, rpcError(-32000, 'Busy'), { 'Retry-After': '1' });
      return;
    }
    this.inflight += 1;
    try {
      await this.dispatch(req, res);
    } finally {
      this.inflight -= 1;
    }
  }

  private async dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.hostAllowed(req)) { reply(res, 403, rpcError(-32000, 'Forbidden')); return; }
    // Agent clients are not browsers; a browser-originated request is never legitimate here.
    if (req.headers.origin !== undefined) { reply(res, 403, rpcError(-32000, 'Forbidden')); return; }
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== AGENT_BRIDGE_PATH) { reply(res, 404, rpcError(-32000, 'Not found')); return; }

    // Authenticate before reading any body.
    const presented = BEARER.exec(req.headers.authorization ?? '');
    const grant = presented ? this.options.credentials.resolve(presented[1]) : null;
    if (!grant) {
      reply(res, 401, rpcError(-32001, 'Unauthorized'), { 'WWW-Authenticate': 'Bearer' });
      return;
    }
    // Stateless: no standalone SSE stream and no session to terminate.
    if (req.method !== 'POST') { reply(res, 405, rpcError(-32000, 'Method not allowed'), { Allow: 'POST' }); return; }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
      reply(res, 415, rpcError(-32000, 'Content-Type must be application/json'));
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse((await readBounded(req, AGENT_BRIDGE_LIMITS.maxBodyBytes)).toString('utf8'));
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        reply(res, 413, rpcError(-32000, 'Payload too large'), { Connection: 'close' });
        req.destroy();
        return;
      }
      if (error instanceof SyntaxError) { reply(res, 400, rpcError(-32700, 'Parse error')); return; }
      reply(res, 400, rpcError(-32000, 'Bad request'));
      return;
    }
    if (parsed === null || typeof parsed !== 'object'
      || (Array.isArray(parsed) && (parsed.length === 0 || parsed.length > AGENT_BRIDGE_LIMITS.maxBatch))) {
      reply(res, 400, rpcError(-32600, 'Invalid request'));
      return;
    }

    // One short-lived protocol server per request: the grant is closed over, never looked up from
    // anything the client controls.
    const server = this.createProtocolServer(grant);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, parsed);
  }

  private createProtocolServer(grant: AgentBridgeGrant): McpServer {
    const { host, version } = this.options;
    const instructions = host.instructionsFor?.(grant);
    const server = new McpServer(
      { name: 'clanker', version: version() },
      { capabilities: { tools: {} }, ...(instructions ? { instructions } : {}) },
    );
    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: host.listTools(grant).map((tool) => ({ name: tool.name, description: tool.description, inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties }, ...(tool.inputSchema.required ? { required: [...tool.inputSchema.required] } : {}) } })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const args = request.params.arguments;
      const result = await host.callTool(grant, request.params.name, args && typeof args === 'object' && !Array.isArray(args) ? args : {}, extra.signal);
      const text = JSON.stringify(result.data) ?? 'null';
      if (Buffer.byteLength(text) > AGENT_BRIDGE_LIMITS.maxToolResultBytes) {
        return { isError: true, content: [{ type: 'text' as const, text: 'Result too large' }] };
      }
      return { ...(result.isError ? { isError: true } : {}), content: [{ type: 'text' as const, text }] };
    });
    return server;
  }
}
