/**
 * The bridge as a launch participant: the real terminal/session IPC handlers, the real coordinator,
 * the real credential registry and provider capabilities, with only the PTY and the workspace
 * registry doubled.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { SESSION_INVOKE, SPAWN_TERMINAL } from '../../../src/shared/ipcChannels';
import { toNativePath } from '../../../src/shared/pathNormalize';
import { testHarnessWrapper } from '../../_helpers/tempPaths';
import { withCheckoutContexts } from '../../_helpers/checkoutContexts';

const { mockHandle, mockSpawnPty, mockDiscover, mockBuildArgs } = vi.hoisted(() => ({
  mockHandle: vi.fn(), mockSpawnPty: vi.fn(), mockDiscover: vi.fn(), mockBuildArgs: vi.fn(),
}));
vi.mock('../../../src/main/localPathContainment', async () => {
  const path = await import('node:path');
  return { isInsideRoot: (root: string, target: string) => {
    const relative = path.relative(root, target);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  } };
});
vi.mock('electron', () => ({ ipcMain: { handle: mockHandle, on: vi.fn() }, BrowserWindow: vi.fn(), clipboard: { writeText: vi.fn() }, shell: { openExternal: vi.fn() } }));
vi.mock('../../../src/main/ipc/ptySpawn', () => ({ spawnPtyProcess: mockSpawnPty, waitForTerminalCleanup: vi.fn() }));
vi.mock('../../../src/main/platformShell', async (importOriginal) => ({ ...(await importOriginal<object>()), defaultShell: () => 'shell' }));
vi.mock('../../../src/main/sessionHistory', async (importOriginal) => ({
  ...(await importOriginal<object>()), discoverSessions: mockDiscover, buildSessionLaunch: mockBuildArgs,
}));

import { registerTerminalIpc } from '../../../src/main/ipc/terminalIpc';
import { registerSessionIpc } from '../../../src/main/ipc/sessionIpc';
import { AgentBridgeService, AGENT_BRIDGE_TOKEN_ENV, type AgentBridgeTerminalRecord } from '../../../src/main/agentBridge/service';
import { removeAttentionAdapterFiles } from '../../../src/main/agentAttentionAdapters';
import { findHarnessProvider } from '../../../src/main/harnesses/registry';

const WORKSPACE = toNativePath('/workspace', process.platform);
type Handler = (event: unknown, ...args: unknown[]) => Promise<Record<string, unknown>>;
const handlers = new Map<string, Handler>();
const options: Record<string, { name: string; command: string; args: string[]; icon: string; env?: Record<string, string> }> = Object.fromEntries(
  ['claude', 'codex', 'opencode', 'pi'].map((id) => [id, { name: id, command: id, args: [] as string[], icon: 'x' }]));

let terminals: Map<string, AgentBridgeTerminalRecord & { id?: string }>;
let service: AgentBridgeService;
let defaults: Record<string, Record<string, unknown>>;
let workspaceObject: { workspaceId: string; location: { environmentId: string; path: string } };
let registry: ReturnType<typeof withCheckoutContexts>;
let broker: { register: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
let exits: Map<string, () => unknown>;
const savedToken = process.env[AGENT_BRIDGE_TOKEN_ENV];

beforeEach(() => {
  handlers.clear();
  terminals = new Map();
  exits = new Map();
  defaults = { claude: { agentBridgeEnabled: true }, codex: { agentBridgeEnabled: true }, opencode: { agentBridgeEnabled: true }, pi: { agentBridgeEnabled: true } };
  workspaceObject = { workspaceId: 'ws', location: { environmentId: 'local', path: '/workspace' } };
  registry = withCheckoutContexts({ getWorkspace: (id: string) => (id === 'ws' ? workspaceObject : null), getWorkspaceByLocation: () => null });
  service = new AgentBridgeService({ getRegistry: () => registry as never, getTerminals: () => terminals, version: () => '1' });
  broker = { register: vi.fn(async () => ({ CLANKER_ATTENTION_TOKEN: 'attention-secret' })), release: vi.fn() };
  mockHandle.mockReset().mockImplementation((channel: string, handler: Handler) => { handlers.set(channel, handler); });
  mockSpawnPty.mockReset().mockImplementation((opts: { id: string; workspaceId?: string; checkoutContextId?: string; harnessId?: string; cwd: string; onExit: () => unknown }) => {
    terminals.set(opts.id, { workspaceId: opts.workspaceId, checkoutContextId: opts.checkoutContextId, harnessId: opts.harnessId, cwd: opts.cwd });
    exits.set(opts.id, opts.onExit);
    return { id: opts.id, pid: 1 };
  });
  mockDiscover.mockReset().mockResolvedValue([]);
  mockBuildArgs.mockReset().mockReturnValue({ command: 'codex', args: ['resume', 's1'] });
  delete process.env[AGENT_BRIDGE_TOKEN_ENV];
});
afterEach(async () => {
  await service.shutdown();
  if (savedToken === undefined) delete process.env[AGENT_BRIDGE_TOKEN_ENV]; else process.env[AGENT_BRIDGE_TOKEN_ENV] = savedToken;
});
afterAll(() => removeAttentionAdapterFiles());

function registerTerminal(extra: Partial<Parameters<typeof registerTerminalIpc>[0]> = {}) {
  registerTerminalIpc({
    getTerminals: () => terminals as never, getMainWindow: () => ({ webContents: { send: vi.fn() } }) as never,
    getStore: () => ({ get: (key: string) => (key === 'harnessDefaults' ? defaults : false) }) as never,
    getSafeWorkspacePath: (dir: string) => dir, getHarnessOptions: () => options,
    ensureHarnessWrapperScript: () => testHarnessWrapper(),
    getWorkspaceRegistry: () => registry as never,
    harnessSpawnOverrides: { fileExists: () => true },
    agentBridge: service,
    ...extra,
  });
}
/** `workspaceId: null` is a launch that names no workspace (legacy, path only). */
const spawn = (harness?: string, workspaceId: string | null = 'ws') =>
  handlers.get(SPAWN_TERMINAL)!(null, WORKSPACE, harness, undefined, undefined, undefined, workspaceId ?? undefined, workspaceId ? 'local' : undefined);
const lastSpawn = () => mockSpawnPty.mock.calls[mockSpawnPty.mock.calls.length - 1][0] as { id: string; env: Record<string, string>; spawnArgs: string[] | string; onExit: () => unknown };
const argvText = () => { const { spawnArgs } = lastSpawn(); return Array.isArray(spawnArgs) ? spawnArgs.join(' ') : spawnArgs; };

describe('ordinary terminal launches', () => {
  it('attach the bridge to a supported harness, bound to main\'s own record of the launch', async () => {
    registerTerminal();
    const result = await spawn('claude');
    const token = lastSpawn().env[AGENT_BRIDGE_TOKEN_ENV];

    expect(token).toMatch(/^clanker_mcp_v1_/);
    expect(service.credentials.resolve(token)?.identity).toEqual({
      terminalId: result.id, workspaceId: 'ws', environmentId: 'local', checkoutContextId: 'ws::main', harnessId: 'claude',
    });
    expect(argvText()).toContain('--mcp-config');
    expect(argvText()).not.toContain(token);
  });

  it('exit revokes the credential and removes the provider config', async () => {
    registerTerminal();
    await spawn('claude');
    const token = lastSpawn().env[AGENT_BRIDGE_TOKEN_ENV];
    const spawnArgs = lastSpawn().spawnArgs as string[];
    const config = spawnArgs[spawnArgs.indexOf('--mcp-config') + 1];
    expect(fs.existsSync(config)).toBe(true);

    await lastSpawn().onExit();
    await lastSpawn().onExit();
    expect(service.credentials.resolve(token)).toBeNull();
    expect(fs.existsSync(config)).toBe(false);
  });

  it('a failed PTY spawn rolls back the credential, the provider config and attention', async () => {
    registerTerminal({ agentAttentionBroker: broker as never });
    defaults.claude.attentionEnabled = true;
    let config = '';
    mockSpawnPty.mockImplementationOnce((opts: { spawnArgs: string[] }) => {
      config = opts.spawnArgs[opts.spawnArgs.indexOf('--mcp-config') + 1];
      expect(fs.existsSync(config)).toBe(true);
      throw new Error('pty failed');
    });

    await expect(spawn('claude')).rejects.toThrow('pty failed');
    expect(service.credentials.size).toBe(0);
    expect(fs.existsSync(config)).toBe(false);
    expect(broker.release).toHaveBeenCalled();
  });

  it('a workspace closed mid-launch fails closed and revokes', async () => {
    registerTerminal();
    // Preparation awaits; by the time the PTY would exist the workspace was closed and reopened (a different registered object).
    let reopened = false;
    const reopenedObject = { ...workspaceObject };
    registry.getWorkspace = (id: string) => (id === 'ws' ? (reopened ? reopenedObject : workspaceObject) : null) as never;
    const lease = service.lease.bind(service);
    service.lease = async (identity) => { const result = await lease(identity); reopened = true; return result; };
    await expect(spawn('claude')).rejects.toThrow(/closed or is being removed/);
    expect(service.credentials.size).toBe(0);
    expect(mockSpawnPty).not.toHaveBeenCalled();
  });

  it('is off by default: no credential, no provider arguments, no listener', async () => {
    defaults = { claude: {} };
    registerTerminal();
    await spawn('claude');
    expect(lastSpawn().env).not.toHaveProperty(AGENT_BRIDGE_TOKEN_ENV);
    expect(argvText()).not.toContain('mcp');
    expect(service.credentials.size).toBe(0);
    expect((service as unknown as { server: { url: string | null } }).server.url).toBeNull();
  });

  it('a harness without the capability launches normally even when the setting is on', async () => {
    registerTerminal();
    await spawn('pi');
    expect(lastSpawn().env).not.toHaveProperty(AGENT_BRIDGE_TOKEN_ENV);
    expect(argvText()).not.toMatch(/mcp/i);
    expect(service.credentials.size).toBe(0);
  });

  it('without the service at all, launches are exactly as before', async () => {
    registerTerminal({ agentBridge: undefined });
    await spawn('claude');
    expect(lastSpawn().env).not.toHaveProperty(AGENT_BRIDGE_TOKEN_ENV);
    expect(argvText()).not.toContain('--mcp-config');
  });

  it('plain shells never receive a credential', async () => {
    registerTerminal();
    await spawn(undefined);
    expect(lastSpawn().env).not.toHaveProperty(AGENT_BRIDGE_TOKEN_ENV);
    expect(service.credentials.size).toBe(0);
  });

  it('launches outside any registered workspace stay unbound and get no bridge', async () => {
    registerTerminal();
    await spawn('claude', null);
    expect(lastSpawn().env).not.toHaveProperty(AGENT_BRIDGE_TOKEN_ENV);
    expect(service.credentials.size).toBe(0);
  });

  it('a stale credential inherited from the environment is never passed on', async () => {
    process.env[AGENT_BRIDGE_TOKEN_ENV] = 'clanker_mcp_v1_' + 'z'.repeat(43);
    process.env.CLANKER_MCP_OTHER = 'stale';
    try {
      defaults = { claude: {} };
      registerTerminal();
      await spawn('claude');
      expect(lastSpawn().env).not.toHaveProperty(AGENT_BRIDGE_TOKEN_ENV);
      expect(lastSpawn().env).not.toHaveProperty('CLANKER_MCP_OTHER');
    } finally { delete process.env.CLANKER_MCP_OTHER; }
  });

  it('a stale inherited credential is replaced, not reused, when the bridge is attached', async () => {
    const stale = 'clanker_mcp_v1_' + 'z'.repeat(43);
    process.env[AGENT_BRIDGE_TOKEN_ENV] = stale;
    registerTerminal();
    await spawn('claude');
    expect(lastSpawn().env[AGENT_BRIDGE_TOKEN_ENV]).not.toBe(stale);
  });

  it('two launches get independent credentials, each bound to its own terminal', async () => {
    registerTerminal();
    const one = await spawn('claude');
    const tokenOne = lastSpawn().env[AGENT_BRIDGE_TOKEN_ENV];
    const two = await spawn('codex');
    const tokenTwo = lastSpawn().env[AGENT_BRIDGE_TOKEN_ENV];

    expect(tokenOne).not.toBe(tokenTwo);
    expect(service.credentials.resolve(tokenOne)?.identity.terminalId).toBe(one.id);
    expect(service.credentials.resolve(tokenTwo)?.identity.terminalId).toBe(two.id);
    // Exit of one leaves the other.
    await exits.get(one.id as string)!();
    expect(service.credentials.resolve(tokenOne)).toBeNull();
    expect(service.credentials.resolve(tokenTwo)).not.toBeNull();
  });

  it('a user-supplied OPENCODE_CONFIG_CONTENT is left alone and the launch proceeds', async () => {
    const original = findHarnessProvider('opencode')!.agentBridge!;
    expect(original).toBeDefined();
    options.opencode.env = { OPENCODE_CONFIG_CONTENT: '{"theme":"mine"}' };
    try {
      registerTerminal();
      await spawn('opencode');
      expect(lastSpawn().env.OPENCODE_CONFIG_CONTENT).toBe('{"theme":"mine"}');
      expect(lastSpawn().env).not.toHaveProperty(AGENT_BRIDGE_TOKEN_ENV);
      expect(service.credentials.size).toBe(0);
    } finally { delete options.opencode.env; }
  });
});

describe('attention and the bridge are independent', () => {
  it('both attach, with distinct credentials; exit releases both', async () => {
    defaults.claude.attentionEnabled = true;
    registerTerminal({ agentAttentionBroker: broker as never });
    const result = await spawn('claude');
    const { env } = lastSpawn();

    expect(env.CLANKER_ATTENTION_TOKEN).toBe('attention-secret');
    expect(env.CLANKER_ATTENTION_COMMAND).toBeTruthy();
    expect(env[AGENT_BRIDGE_TOKEN_ENV]).not.toBe(env.CLANKER_ATTENTION_TOKEN);
    expect(service.credentials.resolve(env.CLANKER_ATTENTION_TOKEN)).toBeNull();
    expect(broker.register).toHaveBeenCalledWith(result.id, 'claude', expect.anything());

    await lastSpawn().onExit();
    expect(broker.release).toHaveBeenCalledWith(result.id);
    expect(service.credentials.resolve(env[AGENT_BRIDGE_TOKEN_ENV])).toBeNull();
  });

  it('a bridge that cannot attach never costs the launch its attention', async () => {
    defaults.claude.attentionEnabled = true;
    const provider = findHarnessProvider('claude')!;
    const spy = vi.spyOn(provider.agentBridge!, 'prepare').mockImplementation(() => { throw new Error('bridge broke'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      registerTerminal({ agentAttentionBroker: broker as never });
      await spawn('claude');
      expect(lastSpawn().env.CLANKER_ATTENTION_TOKEN).toBe('attention-secret');
      expect(lastSpawn().env).not.toHaveProperty(AGENT_BRIDGE_TOKEN_ENV);
      expect(broker.release).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); warn.mockRestore(); }
  });

  it('attention that cannot register never costs the launch its bridge', async () => {
    broker.register.mockRejectedValueOnce(new Error('broker down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      registerTerminal({ agentAttentionBroker: broker as never });
      await spawn('claude');
      expect(lastSpawn().env).not.toHaveProperty('CLANKER_ATTENTION_TOKEN');
      expect(lastSpawn().env[AGENT_BRIDGE_TOKEN_ENV]).toBeTruthy();
      expect(broker.release).toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });

  it('the bridge never changes what attention sees: lifecycle is not inferred from bridge traffic', async () => {
    registerTerminal({ agentAttentionBroker: broker as never });
    const result = await spawn('claude');
    const grant = service.credentials.resolve(lastSpawn().env[AGENT_BRIDGE_TOKEN_ENV])!;
    await service.callTool(grant, 'clanker_context', {});
    await service.listTools(grant);
    expect(Object.keys(broker).sort()).toEqual(['register', 'release']);
    expect(broker.register).toHaveBeenCalledTimes(1);
    expect(broker.release).not.toHaveBeenCalled();
    expect(result.id).toBeTruthy();
  });
});

describe('resumed sessions', () => {
  function registerSession(extra: Partial<Parameters<typeof registerSessionIpc>[0]> = {}) {
    registerSessionIpc({
      getTerminals: () => terminals as never, getMainWindow: () => ({ webContents: { send: vi.fn() } }) as never,
      getSafeWorkspacePath: (dir: string) => dir, getIsShuttingDown: () => false,
      getStore: () => ({ get: (key: string) => (key === 'harnessDefaults' ? defaults : false) }) as never,
      getHarnessOptions: () => options, harnessSpawnOverrides: { fileExists: () => true },
      getWorkspaceRegistry: () => registry as never, agentBridge: service,
      ...extra,
    });
  }
  const invoke = () => handlers.get(SESSION_INVOKE)!({}, 'ws', { id: 's1', harness: 'codex', title: 't', cwd: WORKSPACE, timestamp: 1 }, false);

  it('attaches the bridge to a resumed conversation, bound to the checkout it resumes in', async () => {
    registerSession();
    const result = await invoke();
    const { env, spawnArgs } = lastSpawn();
    const token = env[AGENT_BRIDGE_TOKEN_ENV];

    expect(service.credentials.resolve(token)?.identity).toEqual({
      terminalId: result.id, workspaceId: 'ws', environmentId: 'local', checkoutContextId: 'ws::main', harnessId: 'codex',
    });
    // Overrides are options of the top-level command, so they precede the subcommand.
    const argv = spawnArgs as string[];
    expect(argv.indexOf('-c')).toBeGreaterThanOrEqual(0);
    expect(argv.indexOf('-c')).toBeLessThan(argv.indexOf('resume'));
    expect(argv.join(' ')).not.toContain(token);

    await lastSpawn().onExit();
    expect(service.credentials.resolve(token)).toBeNull();
  });

  it('a failed spawn on resume revokes the credential', async () => {
    registerSession();
    mockSpawnPty.mockImplementationOnce(() => { throw new Error('pty failed'); });
    await expect(invoke()).rejects.toThrow('pty failed');
    expect(service.credentials.size).toBe(0);
  });

  it('resume is unchanged when the bridge is off', async () => {
    defaults.codex = {};
    registerSession();
    await invoke();
    expect(lastSpawn().env).not.toHaveProperty(AGENT_BRIDGE_TOKEN_ENV);
    expect(lastSpawn().spawnArgs as string[]).not.toContain('-c');
    expect(service.credentials.size).toBe(0);
  });
});
