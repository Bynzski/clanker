import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { agentBridge, piBridgeSource } from '../../../src/main/harnesses/pi/agentBridge';
import { AgentBridgeService, agentBridgeLaunchStep, AGENT_BRIDGE_TOKEN_ENV } from '../../../src/main/agentBridge/service';
import { prepareLaunchAttachments } from '../../../src/main/launchAttachments';

const url = 'http://127.0.0.1:12345/mcp';
const source = () => piBridgeSource('clanker-grid', url, AGENT_BRIDGE_TOKEN_ENV);
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const scratch = () => { const dir = mkdtempSync(join(tmpdir(), 'pi-mcp-test-')); dirs.push(dir); return dir; };
function runtime(overrides = {}) {
  const handlers = new Map<string, () => void>();
  const pi = {
    registerMcpServer: vi.fn(),
    getCommands: () => [{ name: 'mcp', sourceInfo: { path: 'builtin:mcp' } }],
    on: (name: string, handler: () => void) => handlers.set(name, handler),
    ...overrides,
  };
  runInNewContext(source().replace('export default function', 'function attach') + '\nattach(pi);', { pi });
  return { pi, start: () => handlers.get('session_start')?.() };
}

describe('Pi launch-only MCP', () => {
  it.each([{ args: [] }, { args: ['--session', '/sessions/one.jsonl'] }, { args: ['--fork', '/sessions/one.jsonl'] }])('preserves fresh/resume/fork argv %j and references only the environment variable', ({ args }) => {
    const attachment = agentBridge.prepare({ url, serverName: 'clanker-grid', tokenEnvVar: AGENT_BRIDGE_TOKEN_ENV, args, env: {}, platform: 'linux', scratchDir: scratch })!;
    expect(attachment.args?.slice(0, args.length)).toEqual(args);
    expect(attachment.args?.slice(-2, -1)).toEqual(['--extension']);
    expect(readFileSync(attachment.args![attachment.args!.length - 1], 'utf8')).toBe(source());
    expect(attachment.env).toBeUndefined();
    expect(source()).toContain('Bearer ${CLANKER_MCP_TOKEN}');
    expect(source()).not.toMatch(/setActiveTools|setEnv|mcp\.json|checkout_rehome/);
  });
  it.each(['--no-mcp', '--no-extensions'])('declines %s without allocating files', (flag) => {
    const allocate = vi.fn(scratch);
    expect(agentBridge.prepare({ url, serverName: 'clanker-grid', tokenEnvVar: AGENT_BRIDGE_TOKEN_ENV, args: [flag], env: {}, platform: 'linux', scratchDir: allocate })).toBeNull();
    expect(allocate).not.toHaveBeenCalled();
  });
  it('waits for all extensions to load, then registers once with direct exposure', () => {
    const { pi, start } = runtime();
    expect(pi.registerMcpServer).not.toHaveBeenCalled();
    start(); start();
    expect(pi.registerMcpServer).toHaveBeenCalledExactlyOnceWith('clanker-grid', {
      url, headers: { Authorization: 'Bearer ${CLANKER_MCP_TOKEN}' }, exposure: 'direct',
    });
  });
  it.each([undefined, () => [] , () => [{ name: 'mcp', sourceInfo: { path: '/user/pi-mcp-adapter.ts' } }]])('unsupported command API, disabled/replaced built-in stays unavailable', (getCommands) => {
    const { pi, start } = runtime({ getCommands }); start();
    expect(pi.registerMcpServer).not.toHaveBeenCalled();
  });
  it('older registration API is a no-op', () => {
    expect(() => runtime({ registerMcpServer: undefined }).start()).not.toThrow();
  });
  it('a conflicting registration cannot break the session or replace the other server', () => {
    const registerMcpServer = vi.fn(() => { throw new Error('normalized name conflict'); });
    const { start } = runtime({ registerMcpServer });
    expect(start).not.toThrow();
    expect(registerMcpServer).toHaveBeenCalledTimes(1);
  });
  it('revokes the credential and deletes only launch scratch files on disposal or preparation rollback', async () => {
    const ctx = { id: 'w::main', workspaceId: 'w', environmentId: 'local', path: '/project', kind: 'main' as const };
    const workspace = { workspaceId: 'w', location: { environmentId: 'local', path: ctx.path } };
    const service = new AgentBridgeService({
      getRegistry: () => ({ getWorkspace: () => workspace, getCheckoutContext: () => ctx }) as never,
      getTerminals: () => new Map([['t', { workspaceId: 'w', checkoutContextId: ctx.id, harnessId: 'pi', cwd: ctx.path }]]),
      version: () => 'test',
    });
    const step = () => agentBridgeLaunchStep({ service, harness: 'pi', identity: { terminalId: 't', workspaceId: 'w', environmentId: 'local', checkoutContextId: ctx.id, harnessId: 'pi' } });
    try {
      const prepared = await prepareLaunchAttachments({ args: [], env: {} }, [step()]);
      const file = prepared.args[prepared.args.length - 1];
      const token = prepared.env[AGENT_BRIDGE_TOKEN_ENV];
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, 'utf8')).not.toContain(token);
      expect(prepared.args.join(' ')).not.toContain(token);
      expect(service.credentials.resolve(token)).not.toBeNull();
      await prepared.dispose(); await prepared.dispose();
      expect(service.credentials.resolve(token)).toBeNull();
      expect(existsSync(file)).toBe(false);
      await expect(prepareLaunchAttachments({ args: [], env: {} }, [step(), { name: 'spawn-failure', prepare() { throw new Error('failed'); } }])).rejects.toThrow('failed');
      expect(service.credentials.size).toBe(0);
    } finally { await service.shutdown(); }
  });
});
