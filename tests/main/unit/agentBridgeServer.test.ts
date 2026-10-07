import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import { AgentBridgeService, type AgentBridgeTerminalRecord } from '../../../src/main/agentBridge/service';
import { AGENT_BRIDGE_LIMITS } from '../../../src/main/agentBridge/server';
import { defineCapability, type AgentBridgeCapability } from '../../../src/main/agentBridge/capabilities';
import type { AgentBridgeIdentity } from '../../../src/main/agentBridge/credentials';
import { commitCheckoutRelocation } from '../../../src/main/checkoutRelocationCommit';

const MAIN: CheckoutContext = { id: 'w1::main', workspaceId: 'w1', environmentId: 'local', path: '/home/dev/project', kind: 'main', branch: 'main' };
const TREE: CheckoutContext = { id: 'w1::wt', workspaceId: 'w1', environmentId: 'local', path: '/home/dev/project-worktrees/task', kind: 'worktree', branch: 'task' };
const OTHER: CheckoutContext = { id: 'w2::main', workspaceId: 'w2', environmentId: 'local', path: '/home/dev/other', kind: 'main', branch: 'dev' };
const workspaces = new Map([
  ['w1', { workspaceId: 'w1', location: { environmentId: 'local', path: '/home/dev/project' } }],
  ['w2', { workspaceId: 'w2', location: { environmentId: 'local', path: '/home/dev/other' } }],
]);
const contexts = new Map([MAIN, TREE, OTHER].map((context) => [context.id, context]));

let terminals: Map<string, AgentBridgeTerminalRecord>;
let service: AgentBridgeService;

const identityFor = (terminalId: string, context: CheckoutContext, harnessId = 'claude'): AgentBridgeIdentity => ({
  terminalId, workspaceId: context.workspaceId, environmentId: 'local', checkoutContextId: context.id, harnessId,
});

/** The slice of a JSON-RPC reply these tests read; missing members are simply undefined at runtime. */
interface JsonRpcReply {
  result: { isError?: boolean; content: Array<{ text: string }>; tools: Array<{ name: string; annotations?: Record<string, boolean> }>; serverInfo: unknown; capabilities: Record<string, unknown> };
  error?: unknown;
}
interface Reply { status: number; headers: http.IncomingHttpHeaders; body: string; json: JsonRpcReply }
function request(url: string, options: { method?: string; token?: string | null; body?: string | Buffer; headers?: Record<string, string> } = {}): Promise<Reply> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      ...(options.token === null ? {} : options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    };
    const req = http.request({ host: target.hostname, port: target.port, path: target.pathname, method: options.method ?? 'POST', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let json = {} as JsonRpcReply;
        try { json = JSON.parse(body) as JsonRpcReply; } catch { /* not json */ }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json });
      });
    });
    req.on('error', reject);
    req.end(options.body);
  });
}
const rpc = (url: string, token: string | null, method: string, params?: unknown, id = 1) =>
  request(url, { token, body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }) });
const callContext = (url: string, token: string, args: unknown = {}) => rpc(url, token, 'tools/call', { name: 'clanker_context', arguments: args });
const contextData = (reply: Reply) => JSON.parse(reply.json.result.content[0].text);

beforeEach(() => {
  terminals = new Map([
    ['t1', { workspaceId: 'w1', checkoutContextId: MAIN.id, harnessId: 'claude', cwd: '/home/dev/project/src' }],
    ['t2', { workspaceId: 'w1', checkoutContextId: TREE.id, harnessId: 'codex', cwd: '/home/dev/project-worktrees/task' }],
    ['t3', { workspaceId: 'w2', checkoutContextId: OTHER.id, harnessId: 'claude', cwd: '/home/dev/other' }],
  ]);
  service = new AgentBridgeService({
    getRegistry: () => ({
      getWorkspace: (id: string) => workspaces.get(id) ?? null,
      getCheckoutContext: (id: string) => contexts.get(id) ?? null,
    }) as never,
    getTerminals: () => terminals,
    version: () => '9.9.9',
  });
});
afterEach(async () => { await service.shutdown(); });

describe('main-owned live checkout authority commit', () => {
  const commit = (identity: AgentBridgeIdentity, targetId: string) => commitCheckoutRelocation({
    registry: { getCheckoutContext: (id: string) => contexts.get(id) ?? null } as never,
    terminals, bridge: service,
  }, identity, targetId);
  it('atomically rebinds the same bearer to the new checkout, refusing a captured old grant', async () => {
    const lease = await service.lease(identityFor('t1', MAIN));
    const before = service.credentials.resolve(lease.token)!;
    expect(commit(identityFor('t1', MAIN), TREE.id)).toBe(true);
    expect(terminals.get('t1')!.checkoutContextId).toBe(TREE.id);
    expect(contextData(await callContext(lease.url, lease.token)).checkout).toMatchObject({ kind: 'worktree', branch: 'task' });
    expect((await service.callTool(before, 'clanker_context', {})).isError).toBe(true);
    expect(commit(identityFor('t1', MAIN), MAIN.id)).toBe(false);
    expect(commit(identityFor('t1', TREE), MAIN.id)).toBe(true);
    expect((await service.callTool(before, 'clanker_context', {})).isError).toBe(true); // ABA cannot revive the captured grant
    lease.release();
    expect(service.credentials.resolve(lease.token)).toBeNull();
  });

  it.each(['another workspace', 'another harness', 'missing target', 'revoked credential'])(
    'changes neither grant nor terminal for %s', async (kind) => {
      const lease = await service.lease(identityFor('t1', MAIN));
      const terminal = { ...terminals.get('t1')! };
      const expected = identityFor('t1', MAIN);
      const target = kind === 'another workspace' ? OTHER.id : kind === 'missing target' ? 'missing' : TREE.id;
      if (kind === 'another harness') Object.assign(expected, { harnessId: 'codex' });
      if (kind === 'revoked credential') lease.release();
      expect(commit(expected, target)).toBe(false);
      expect(terminals.get('t1')).toEqual(terminal);
      if (kind !== 'revoked credential') expect(service.credentials.resolve(lease.token)!.identity).toEqual(identityFor('t1', MAIN));
    },
  );

  it('an arbitrary reported/native cwd change never rebinds a bridge grant', async () => {
    const lease = await service.lease(identityFor('t1', MAIN));
    terminals.get('t1')!.cwd = TREE.path;
    expect(service.credentials.resolve(lease.token)!.identity.checkoutContextId).toBe(MAIN.id);
    expect(contextData(await callContext(lease.url, lease.token)).checkout).toMatchObject({ kind: 'main', branch: 'main' });
  });
});

describe('transport', () => {
  it('binds the loopback interface only, on an ephemeral port, at /mcp', async () => {
    const lease = await service.lease(identityFor('t1', MAIN));
    const url = new URL(lease.url);
    expect(url.protocol).toBe('http:');
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.pathname).toBe('/mcp');
    expect(Number(url.port)).toBeGreaterThan(0);

    const bound = (service as unknown as { server: { http: http.Server } }).server.http.address() as AddressInfo;
    expect(bound.address).toBe('127.0.0.1');
    expect(bound.family).toBe('IPv4');
  });

  it('starts once, lazily, and shares one listener across launches', async () => {
    const first = await service.lease(identityFor('t1', MAIN));
    const second = await service.lease(identityFor('t2', TREE, 'codex'));
    expect(second.url).toBe(first.url);
  });

  it('stops listening on shutdown and refuses new leases', async () => {
    const lease = await service.lease(identityFor('t1', MAIN));
    await service.shutdown();
    await expect(request(lease.url, { token: lease.token, body: '{}' })).rejects.toThrow();
    await expect(service.lease(identityFor('t1', MAIN))).rejects.toThrow('shut down');
  });

  it('is local-only in V1: an SSH identity gets no credential', async () => {
    await expect(service.lease({ ...identityFor('t1', MAIN), environmentId: 'vps' })).rejects.toThrow('local-only');
    expect(service.credentials.size).toBe(0);
  });

  it('speaks MCP: initialize negotiates and advertises tools only', async () => {
    const lease = await service.lease(identityFor('t1', MAIN));
    const reply = await rpc(lease.url, lease.token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(reply.status).toBe(200);
    expect(reply.json.result.serverInfo).toEqual({ name: 'clanker', version: '9.9.9' });
    expect(Object.keys(reply.json.result.capabilities)).toEqual(['tools']);
  });
});

describe('authentication', () => {
  it('rejects a request with no credential before reading the body, and never runs a tool', async () => {
    const run = vi.fn(() => ({ data: {} }));
    await service.shutdown();
    service = new AgentBridgeService({
      getRegistry: () => ({ getWorkspace: (id: string) => workspaces.get(id) ?? null, getCheckoutContext: (id: string) => contexts.get(id) ?? null }) as never,
      getTerminals: () => terminals, version: () => '1',
      capabilities: [defineCapability({ name: 'spy', description: 'd', input: {}, run })],
    });
    const lease = await service.lease(identityFor('t1', MAIN));

    const reply = await rpc(lease.url, null, 'tools/call', { name: 'spy', arguments: {} });
    expect(reply.status).toBe(401);
    expect(reply.headers['www-authenticate']).toBe('Bearer');
    expect(run).not.toHaveBeenCalled();
    expect((await rpc(lease.url, lease.token, 'tools/call', { name: 'spy', arguments: {} })).status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a wrong but well-formed token', 'clanker_mcp_v1_' + 'a'.repeat(43)],
    ['a malformed token', 'not-a-token'],
    ['an attention-style token', 'a'.repeat(64)],
  ])('rejects %s', async (_label, token) => {
    const lease = await service.lease(identityFor('t1', MAIN));
    expect((await callContext(lease.url, token)).status).toBe(401);
  });

  it.each([['Basic dXNlcjpwYXNz'], ['bearer lowercase'], ['Bearer'], ['Bearer a b']])('rejects Authorization %j', async (authorization) => {
    const lease = await service.lease(identityFor('t1', MAIN));
    const reply = await request(lease.url, { token: null, headers: { Authorization: authorization }, body: '{}' });
    expect(reply.status).toBe(401);
  });

  it('a credential in the URL or body is not a credential', async () => {
    const lease = await service.lease(identityFor('t1', MAIN));
    const reply = await request(`${lease.url}?token=${lease.token}`, { token: null, body: JSON.stringify({ token: lease.token }) });
    expect(reply.status).toBe(401);
  });

  it('a revoked credential fails immediately', async () => {
    const lease = await service.lease(identityFor('t1', MAIN));
    expect((await callContext(lease.url, lease.token)).status).toBe(200);
    lease.release();
    expect((await callContext(lease.url, lease.token)).status).toBe(401);
  });

  it('terminal release revokes bridge authority', async () => {
    const lease = await service.lease(identityFor('t1', MAIN));
    service.revokeTerminal('t1');
    expect((await callContext(lease.url, lease.token)).status).toBe(401);
  });

  it('never echoes the presented credential back', async () => {
    const lease = await service.lease(identityFor('t1', MAIN));
    const reply = await callContext(lease.url, lease.token);
    expect(reply.body).not.toContain(lease.token);
    const rejected = await callContext(lease.url, 'clanker_mcp_v1_' + 'b'.repeat(43));
    expect(rejected.body).not.toContain('b'.repeat(43));
  });
});

describe('identity is bound server-side', () => {
  it('resolves each credential to its own launch, never another terminal, workspace or checkout', async () => {
    const one = await service.lease(identityFor('t1', MAIN));
    const two = await service.lease(identityFor('t2', TREE, 'codex'));
    const three = await service.lease(identityFor('t3', OTHER));

    expect(contextData(await callContext(one.url, one.token))).toMatchObject({
      workspace: { name: 'project' }, checkout: { kind: 'main', isolated: false, branch: 'main' }, agent: { harness: 'claude', launchDirectory: 'src' },
    });
    expect(contextData(await callContext(two.url, two.token))).toMatchObject({
      workspace: { name: 'project' }, checkout: { kind: 'worktree', isolated: true, branch: 'task' }, agent: { harness: 'codex', launchDirectory: '.' },
    });
    expect(contextData(await callContext(three.url, three.token))).toMatchObject({ workspace: { name: 'other' }, checkout: { branch: 'dev' } });
  });

  it.each([
    ['terminalId', { terminalId: 't3' }],
    ['workspaceId', { workspaceId: 'w2' }],
    ['checkoutContextId', { checkoutContextId: 'w1::wt' }],
    ['harnessId', { harnessId: 'codex' }],
    ['environmentId', { environmentId: 'vps' }],
  ])('tool arguments cannot select %s', async (_label, args) => {
    const lease = await service.lease(identityFor('t1', MAIN));
    const reply = await callContext(lease.url, lease.token, args);
    expect(reply.json.result.isError).toBe(true);
    expect(reply.json.result.content[0].text).toBe('{"error":"Unexpected arguments"}');
  });

  it('one checkout cannot escape into another: a launch bound to the main checkout never reports the worktree', async () => {
    const lease = await service.lease(identityFor('t1', MAIN));
    const data = contextData(await callContext(lease.url, lease.token));
    expect(data.checkout.kind).toBe('main');
    expect(JSON.stringify(data)).not.toContain('task');
  });

  it('fails closed when the live terminal no longer matches the bound identity', async () => {
    const lease = await service.lease(identityFor('t1', MAIN));
    terminals.set('t1', { ...terminals.get('t1')!, checkoutContextId: TREE.id });
    expect((await callContext(lease.url, lease.token)).json.result.isError).toBe(true);

    terminals.set('t1', { ...terminals.get('t1')!, checkoutContextId: MAIN.id, workspaceId: 'w2' });
    expect((await callContext(lease.url, lease.token)).json.result.isError).toBe(true);

    terminals.set('t1', { ...terminals.get('t1')!, workspaceId: 'w1', harnessId: 'pi' });
    expect((await callContext(lease.url, lease.token)).json.result.isError).toBe(true);
  });

  it('fails closed once the terminal, workspace or checkout context is gone, even before revocation runs', async () => {
    const lease = await service.lease(identityFor('t2', TREE, 'codex'));
    expect((await callContext(lease.url, lease.token)).json.result.isError).toBeUndefined();

    contexts.delete(TREE.id);
    expect((await callContext(lease.url, lease.token)).json.result.isError).toBe(true);
    contexts.set(TREE.id, TREE);
    expect((await callContext(lease.url, lease.token)).json.result.isError).toBeUndefined();

    workspaces.delete('w1');
    expect((await callContext(lease.url, lease.token)).json.result.isError).toBe(true);
    workspaces.set('w1', { workspaceId: 'w1', location: { environmentId: 'local', path: '/home/dev/project' } });

    terminals.delete('t2');
    expect((await callContext(lease.url, lease.token)).json.result.isError).toBe(true);
    expect((await rpc(lease.url, lease.token, 'tools/list')).json.result.tools).toEqual([]);
  });

  it('refuses a context that belongs to a different workspace than the credential', async () => {
    // A credential claiming workspace w1 but pointing at another workspace's context must not resolve.
    const lease = await service.lease({ ...identityFor('t1', MAIN), checkoutContextId: OTHER.id });
    terminals.set('t1', { ...terminals.get('t1')!, checkoutContextId: OTHER.id });
    expect((await callContext(lease.url, lease.token)).json.result.isError).toBe(true);
  });

  it('returns display-safe facts only: no credential, ids, or absolute paths', async () => {
    const lease = await service.lease(identityFor('t2', TREE, 'codex'));
    const text = (await callContext(lease.url, lease.token)).json.result.content[0].text as string;
    for (const forbidden of [lease.token, 't2', 'w1', '::', '/home/dev', 'project-worktrees']) expect(text).not.toContain(forbidden);
  });
});

describe('capability scoping', () => {
  const makeCapability = (name: string): AgentBridgeCapability => defineCapability({
    name, description: name, input: {}, run: () => ({ data: { ran: name } }),
  });

  it('lists and runs only the capabilities granted to the credential', async () => {
    await service.shutdown();
    service = new AgentBridgeService({
      getRegistry: () => ({ getWorkspace: (id: string) => workspaces.get(id) ?? null, getCheckoutContext: (id: string) => contexts.get(id) ?? null }) as never,
      getTerminals: () => terminals, version: () => '1',
      capabilities: [makeCapability('alpha'), makeCapability('beta')],
    });
    const { url } = await service.lease(identityFor('t1', MAIN));
    // Narrow the grant to one capability, as a future per-harness policy would at issue time.
    const narrowedToken = service.credentials.issue(identityFor('t1', MAIN), ['alpha']).token;

    const tools = await rpc(url, narrowedToken, 'tools/list');
    expect(tools.json.result.tools.map((tool: { name: string }) => tool.name)).toEqual(['alpha']);
    expect((await rpc(url, narrowedToken, 'tools/call', { name: 'beta', arguments: {} })).json.result.isError).toBe(true);
    expect((await rpc(url, narrowedToken, 'tools/call', { name: 'alpha', arguments: {} })).json.result.content[0].text).toBe('{"ran":"alpha"}');
  });

  it('an unknown tool and a tool that throws both fail without leaking detail', async () => {
    await service.shutdown();
    service = new AgentBridgeService({
      getRegistry: () => ({ getWorkspace: (id: string) => workspaces.get(id) ?? null, getCheckoutContext: (id: string) => contexts.get(id) ?? null }) as never,
      getTerminals: () => terminals, version: () => '1',
      capabilities: [defineCapability({ name: 'boom', description: 'boom', input: {}, run: () => { throw new Error('secret internal /etc/shadow'); } })],
    });
    const lease = await service.lease(identityFor('t1', MAIN));
    const unknown = await rpc(lease.url, lease.token, 'tools/call', { name: 'nope', arguments: {} });
    expect(unknown.json.result.isError).toBe(true);
    const failing = await rpc(lease.url, lease.token, 'tools/call', { name: 'boom', arguments: {} });
    expect(failing.json.result.isError).toBe(true);
    expect(failing.body).not.toContain('shadow');
  });

  it('the shipped tool set is exactly one read-only context tool, with no lifecycle tools', async () => {
    const lease = await service.lease(identityFor('t1', MAIN));
    const names = (await rpc(lease.url, lease.token, 'tools/list')).json.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(['clanker_context']);
    expect(names.join(' ')).not.toMatch(/working|done|input|cwd|worktree|branch_delete/i);
  });

  it('a result that exceeds the bound is refused, not truncated', async () => {
    await service.shutdown();
    service = new AgentBridgeService({
      getRegistry: () => ({ getWorkspace: (id: string) => workspaces.get(id) ?? null, getCheckoutContext: (id: string) => contexts.get(id) ?? null }) as never,
      getTerminals: () => terminals, version: () => '1',
      capabilities: [defineCapability({ name: 'huge', description: 'huge', input: {}, run: () => ({ data: 'x'.repeat(AGENT_BRIDGE_LIMITS.maxToolResultBytes + 1) }) })],
    });
    const lease = await service.lease(identityFor('t1', MAIN));
    const reply = await rpc(lease.url, lease.token, 'tools/call', { name: 'huge', arguments: {} });
    expect(reply.json.result.isError).toBe(true);
    expect(reply.body.length).toBeLessThan(500);
  });
});

describe('bounded tool execution', () => {
  const slowService = (toolTimeoutMs: number, onRun: (signal: AbortSignal) => Promise<{ data: unknown }>) => {
    return new AgentBridgeService({
      getRegistry: () => ({ getWorkspace: (id: string) => workspaces.get(id) ?? null, getCheckoutContext: (id: string) => contexts.get(id) ?? null }) as never,
      getTerminals: () => terminals, version: () => '1', toolTimeoutMs,
      capabilities: [defineCapability({ name: 'slow', description: 'slow', input: {}, run: (_input, { signal }) => onRun(signal) })],
    });
  };

  it('cuts a hung tool off at the bound, aborts its signal, and frees the request', async () => {
    await service.shutdown();
    let signal!: AbortSignal;
    service = slowService(40, (given) => { signal = given; return new Promise(() => undefined); });
    const lease = await service.lease(identityFor('t1', MAIN));

    const started = Date.now();
    const reply = await rpc(lease.url, lease.token, 'tools/call', { name: 'slow', arguments: {} });
    expect(Date.now() - started).toBeLessThan(AGENT_BRIDGE_LIMITS.toolTimeoutMs);
    expect(reply.json.result.isError).toBe(true);
    expect(reply.json.result.content[0].text).toBe('{"error":"Tool timed out"}');
    expect(signal.aborted).toBe(true);
    // The slot is free again.
    expect((await rpc(lease.url, lease.token, 'tools/list')).status).toBe(200);
  });

  it('aborts the tool when the client goes away', async () => {
    await service.shutdown();
    let signal!: AbortSignal;
    service = slowService(5_000, (given) => { signal = given; return new Promise(() => undefined); });
    const grant = service.credentials.resolve((await service.lease(identityFor('t1', MAIN))).token)!;
    const client = new AbortController();

    const pending = service.callTool(grant, 'slow', {}, client.signal);
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect(signal.aborted).toBe(false);
    client.abort();
    expect(signal.aborted).toBe(true);
    void pending;
  });

  it('a tool that finishes in time is unaffected, and its timer does not linger', async () => {
    await service.shutdown();
    service = slowService(5_000, async () => ({ data: { fast: true } }));
    const lease = await service.lease(identityFor('t1', MAIN));
    const reply = await rpc(lease.url, lease.token, 'tools/call', { name: 'slow', arguments: {} });
    expect(reply.json.result.content[0].text).toBe('{"fast":true}');
  });

  it('documents a finite execution bound distinct from the HTTP receive timeout', () => {
    expect(AGENT_BRIDGE_LIMITS.toolTimeoutMs).toBeGreaterThan(0);
    expect(AGENT_BRIDGE_LIMITS.toolTimeoutMs).toBeLessThanOrEqual(AGENT_BRIDGE_LIMITS.requestTimeoutMs);
  });
});

describe('malformed and hostile requests fail closed', () => {
  let lease: { url: string; token: string };
  beforeEach(async () => { lease = await service.lease(identityFor('t1', MAIN)); });

  it('rejects an oversized body with 413 and keeps serving', async () => {
    const reply = await request(lease.url, { token: lease.token, body: Buffer.alloc(AGENT_BRIDGE_LIMITS.maxBodyBytes + 1, 97) }).catch((error: NodeJS.ErrnoException) => error);
    // The server may drop the connection once the limit is crossed; either outcome is a refusal.
    if (reply instanceof Error) expect(['ECONNRESET', 'EPIPE']).toContain(reply.code);
    else expect(reply.status).toBe(413);
    expect((await callContext(lease.url, lease.token)).status).toBe(200);
  });

  it('rejects an oversized declared Content-Length without reading the body', async () => {
    const reply = await request(lease.url, { token: lease.token, headers: { 'Content-Length': String(AGENT_BRIDGE_LIMITS.maxBodyBytes + 1) }, body: '{}' }).catch((error: NodeJS.ErrnoException) => error);
    if (!(reply instanceof Error)) expect(reply.status).toBe(413);
  });

  it.each([['malformed JSON', '{nope', 400], ['an empty body', '', 400], ['a JSON scalar', '42', 400], ['null', 'null', 400], ['an empty batch', '[]', 400]])('%s -> %i', async (_label, body, status) => {
    expect((await request(lease.url, { token: lease.token, body })).status).toBe(status);
  });

  it('rejects a batch larger than the bound', async () => {
    const batch = Array.from({ length: AGENT_BRIDGE_LIMITS.maxBatch + 1 }, (_, id) => ({ jsonrpc: '2.0', id, method: 'ping' }));
    expect((await request(lease.url, { token: lease.token, body: JSON.stringify(batch) })).status).toBe(400);
  });

  it('rejects a non-JSON content type', async () => {
    expect((await request(lease.url, { token: lease.token, headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415);
  });

  it('is POST only, with no standalone stream or session to terminate', async () => {
    for (const method of ['GET', 'DELETE', 'PUT']) expect((await request(lease.url, { method, token: lease.token })).status).toBe(405);
  });

  it('serves only /mcp', async () => {
    expect((await request(lease.url.replace('/mcp', '/other'), { token: lease.token, body: '{}' })).status).toBe(404);
    expect((await request(lease.url.replace('/mcp', '/.well-known/oauth-protected-resource'), { method: 'GET', token: null })).status).toBe(404);
  });

  it('rejects a foreign Host header (DNS rebinding) and any browser Origin, even with a valid credential', async () => {
    expect((await request(lease.url, { token: lease.token, headers: { Host: 'evil.example:80' }, body: '{}' })).status).toBe(403);
    expect((await request(lease.url, { token: lease.token, headers: { Origin: 'https://evil.example' }, body: '{}' })).status).toBe(403);
  });

  it('unknown methods are protocol errors, not crashes', async () => {
    const reply = await rpc(lease.url, lease.token, 'resources/list');
    expect(reply.status).toBeLessThan(500);
    expect(reply.json.error).toBeTruthy();
  });
});

it('transmits the context permission hints in tools/list', async () => {
  const lease = await service.lease(identityFor('t1', MAIN));
  const tools = (await rpc(lease.url, lease.token, 'tools/list')).json.result.tools;
  expect(tools.find((tool) => tool.name === 'clanker_context')?.annotations).toEqual({
    readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
  });
});
