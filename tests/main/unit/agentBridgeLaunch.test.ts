/**
 * The bridge as a launch participant: the real terminal/session IPC handlers, the real coordinator,
 * the real credential registry and provider capabilities, with only the PTY and the workspace
 * registry doubled.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { SESSION_INVOKE, SPAWN_TERMINAL } from '../../../src/shared/ipcChannels';
import { successfulSessionDiscovery } from '../../_helpers/sessionDiscovery';
import type { HarnessSession } from '../../../src/shared/types/session';
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
  discoverSessionsDetailed: async (...args: unknown[]) => successfulSessionDiscovery(await mockDiscover(...args)),
}));

import { registerTerminalIpc } from '../../../src/main/ipc/terminalIpc';
import { registerSessionIpc } from '../../../src/main/ipc/sessionIpc';
import { AgentBridgeService, AGENT_BRIDGE_TOKEN_ENV, type AgentBridgeTerminalRecord } from '../../../src/main/agentBridge/service';
import { removeAttentionAdapterFiles } from '../../../src/main/agentAttentionAdapters';
import { findHarnessProvider } from '../../../src/main/harnesses/registry';
import { DEFAULT_AGENT_BRIDGE_CAPABILITIES } from '../../../src/main/agentBridge/capabilities';
import { createCheckoutLifecycleCapabilities } from '../../../src/main/agentBridge/lifecycleCapabilities';

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
  mockDiscover.mockReset().mockResolvedValue([{ id: 's1', harness: 'codex', title: 't', cwd: WORKSPACE, timestamp: 1 }]);
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

  it('Pi with --no-mcp launches normally even when the setting is on', async () => {
    registerTerminal();
    defaults.pi.flags = '--no-mcp';
    await spawn('pi');
    expect(lastSpawn().env).not.toHaveProperty(AGENT_BRIDGE_TOKEN_ENV);
    expect(argvText()).not.toContain('pi-clanker-mcp');
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

  it.each([false, true])('Pi resume/fork (%s) receives the same context-only attachment and exit cleanup', async (fork) => {
    registerSession();
    const selected: HarnessSession = { id: 's1', harness: 'pi', title: 't', cwd: WORKSPACE, timestamp: 1 };
    mockDiscover.mockResolvedValue([selected]);
    const validate = vi.spyOn(findHarnessProvider('pi')!.sessions!, 'validateLocal').mockResolvedValue(selected);
    const args = [fork ? '--fork' : '--session', '/sessions/s1.jsonl'];
    mockBuildArgs.mockReturnValue({ command: 'pi', args });
    const result = await handlers.get(SESSION_INVOKE)!({}, 'ws', selected, fork);
    validate.mockRestore();
    const { env, spawnArgs } = lastSpawn();
    const token = env[AGENT_BRIDGE_TOKEN_ENV];
    const grant = service.credentials.resolve(token)!;
    expect(grant.identity).toEqual({ terminalId: result.id, workspaceId: 'ws', environmentId: 'local', checkoutContextId: 'ws::main', harnessId: 'pi' });
    expect(service.listTools(grant).map((tool) => tool.name)).toEqual(['clanker_context']);
    expect(spawnArgs).toEqual(expect.arrayContaining(args));
    const argv = spawnArgs as string[];
    const file = argv[argv.indexOf('--extension') + 1];
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).not.toContain(token);
    await lastSpawn().onExit();
    expect(service.credentials.resolve(token)).toBeNull();
    expect(fs.existsSync(file)).toBe(false);
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

describe('resumeInCheckout (the re-home launch)', () => {
  const TREE_PATH = toNativePath('/workspace-worktrees/task', process.platform);
  const TREE = { id: 'ws::ckt-1', workspaceId: 'ws', environmentId: 'local', path: '/workspace-worktrees/task', kind: 'worktree' as const, branch: 'task' };
  const session: HarnessSession = { id: 's1', harness: 'codex', title: 't', cwd: WORKSPACE, timestamp: 1 };

  function setup(extraDefaults: Record<string, unknown> = {}) {
    // A bridge that offers the lifecycle tools (the port is irrelevant to which tools a launch is granted).
    const port = { create: async () => ({ data: {} }), complete: async () => ({ data: {} }) };
    service = new AgentBridgeService({
      getRegistry: () => registry as never, getTerminals: () => terminals, version: () => '1',
      capabilities: [...DEFAULT_AGENT_BRIDGE_CAPABILITIES, ...createCheckoutLifecycleCapabilities(port)],
    });
    const treeRegistry = withCheckoutContexts({ getWorkspace: (id: string) => (id === 'ws' ? workspaceObject : null), getWorkspaceByLocation: () => null }, [TREE]);
    registry = treeRegistry as never;
    defaults.codex = { agentBridgeEnabled: true, attentionEnabled: true, ...extraDefaults };
    defaults.opencode = { agentBridgeEnabled: true, attentionEnabled: true };
    const controller = registerSessionIpc({
      getTerminals: () => terminals as never, getMainWindow: () => ({ webContents: { send: vi.fn() } }) as never,
      getSafeWorkspacePath: (dir: string) => dir, getIsShuttingDown: () => false,
      getStore: () => ({ get: (key: string) => (key === 'harnessDefaults' ? defaults : false) }) as never,
      getHarnessOptions: () => options, harnessSpawnOverrides: { fileExists: () => true },
      getWorkspaceRegistry: () => treeRegistry as never, agentBridge: service, agentAttentionBroker: broker as never,
      // Git's listing, as in production, so a conversation that ran in the worktree is routed to it.
      listWorktrees: async () => ({ success: true, worktrees: [
        { path: WORKSPACE, branch: 'main', isMain: true, isLocked: false, isPrunable: false },
        { path: TREE_PATH, branch: 'task', isMain: false, isLocked: false, isPrunable: false },
      ] }),
    });
    return controller;
  }
  const grantOf = () => service.credentials.resolve(lastSpawn().env[AGENT_BRIDGE_TOKEN_ENV])!;
  const toolNames = () => service.listTools(grantOf()).map((tool) => tool.name);
  const lifecycleNames = ['clanker_create_isolated_checkout', 'clanker_complete_isolated_checkout'];

  it('launches the conversation in the checkout main chose, not the one its recorded directory implies', async () => {
    const controller = setup();
    const launched = await controller.resumeInCheckout('ws', session, { targetContext: TREE });

    expect(launched.checkoutContextId).toBe(TREE.id);
    expect(mockSpawnPty).toHaveBeenCalledWith(expect.objectContaining({ cwd: TREE_PATH, checkoutContextId: TREE.id, workspaceId: 'ws' }));
    // It is a resume of the same native conversation.
    expect(lastSpawn().spawnArgs as string[]).toEqual(expect.arrayContaining(['resume', 's1']));
  });

  it('issues a fresh bridge credential bound to the new terminal and the TARGET checkout', async () => {
    const controller = setup();
    // The conversation's old process has its own credential, bound to the main checkout.
    terminals.set('old', { workspaceId: 'ws', checkoutContextId: 'ws::main', harnessId: 'codex' });
    const old = await service.lease({ terminalId: 'old', workspaceId: 'ws', environmentId: 'local', checkoutContextId: 'ws::main', harnessId: 'codex' });

    const launched = await controller.resumeInCheckout('ws', session, { targetContext: TREE });
    const fresh = lastSpawn().env[AGENT_BRIDGE_TOKEN_ENV];

    expect(fresh).not.toBe(old.token);
    expect(service.credentials.resolve(fresh)?.identity).toEqual({
      terminalId: launched.id, workspaceId: 'ws', environmentId: 'local', checkoutContextId: TREE.id, harnessId: 'codex',
    });
    // The old credential keeps meaning exactly what it did (main) until its terminal is retired, then dies.
    expect(service.credentials.resolve(old.token)?.identity.checkoutContextId).toBe('ws::main');
    service.revokeTerminal('old');
    expect(service.credentials.resolve(old.token)).toBeNull();
    expect(service.credentials.resolve(fresh)).not.toBeNull();
  });

  it('grants the lifecycle tools only to a launch whose harness can be re-homed and that has attention', async () => {
    const controller = setup();
    await controller.resumeInCheckout('ws', session, { targetContext: TREE });
    expect(toolNames()).toEqual(['clanker_context', ...lifecycleNames]);
    // OpenCode declares after-turn re-homing with a native relocation, so it is granted the same tools.
    await controller.resumeInCheckout('ws', { ...session, harness: 'opencode', id: 's2' }, { targetContext: TREE });
    expect(toolNames()).toEqual(['clanker_context', ...lifecycleNames]);
  });

  it('without agent attention a re-homeable harness still gets only the context tool', async () => {
    const controller = setup({ attentionEnabled: false });
    await controller.resumeInCheckout('ws', session, { targetContext: TREE });
    expect(toolNames()).toEqual(['clanker_context']);
  });

  it('a fresh terminal launch gets the same grants', async () => {
    setup();
    registerTerminal({ agentAttentionBroker: broker as never });
    handlers.clear();
    mockHandle.mockClear();
    registerTerminal({ agentAttentionBroker: broker as never });
    await spawn('codex');
    expect(toolNames()).toEqual(['clanker_context', ...lifecycleNames]);
    await spawn('opencode');
    expect(toolNames()).toEqual(['clanker_context', ...lifecycleNames]);
  });

  it('passes the liveness hook, the exit hook and the startup buffer bound to the PTY, and still disposes attachments on exit', async () => {
    const controller = setup();
    const onOutput = vi.fn();
    const onExit = vi.fn();
    const startupBufferLimit = { bytes: 123456, chunks: 789 };
    const launched = await controller.resumeInCheckout('ws', session, { targetContext: TREE, onOutput, onExit, startupBufferLimit });

    const spawnOptions = lastSpawn() as unknown as { onOutput: (d: string) => void; onExit: () => Promise<void>; startupBufferLimit: unknown; id: string };
    expect(spawnOptions.id).toBe(launched.id);
    expect(spawnOptions.startupBufferLimit).toEqual(startupBufferLimit);
    spawnOptions.onOutput('x');
    expect(onOutput).toHaveBeenCalledWith('x');

    const token = lastSpawn().env[AGENT_BRIDGE_TOKEN_ENV];
    await spawnOptions.onExit();
    expect(service.credentials.resolve(token)).toBeNull(); // attachments were disposed first
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(broker.release).toHaveBeenCalledWith(launched.id);
  });

  it('a failed spawn revokes the credential and releases attention', async () => {
    const controller = setup();
    mockSpawnPty.mockImplementationOnce(() => { throw new Error('pty failed'); });
    await expect(controller.resumeInCheckout('ws', session, { targetContext: TREE })).rejects.toThrow('pty failed');
    expect(service.credentials.size).toBe(0);
    expect(broker.release).toHaveBeenCalled();
  });

  it('refuses a target context that is no longer the registered one, before any process exists', async () => {
    const controller = setup();
    await expect(controller.resumeInCheckout('ws', session, { targetContext: { ...TREE, id: 'ws::unregistered' } })).rejects.toThrow();
    expect(mockSpawnPty).not.toHaveBeenCalled();
    expect(service.credentials.size).toBe(0);
  });

  it('is local-only', async () => {
    const remote = { workspaceId: 'ws', location: { environmentId: 'vps', path: '/srv/p' }, environment: { capabilities: {} } };
    const controller = registerSessionIpc({
      getTerminals: () => terminals as never, getMainWindow: () => null, getSafeWorkspacePath: (dir: string) => dir, getIsShuttingDown: () => false,
      getStore: () => ({ get: () => defaults }) as never, getHarnessOptions: () => options,
      getWorkspaceRegistry: () => withCheckoutContexts({ getWorkspace: () => remote }) as never,
    });
    await expect(controller.resumeInCheckout('ws', session, { targetContext: TREE })).rejects.toThrow(/local workspaces only/);
    expect(mockSpawnPty).not.toHaveBeenCalled();
  });
});

describe('the ordinary SESSION_INVOKE is unchanged by the internal route', () => {
  it('still routes by the conversation\'s recorded directory and still accepts only renderer-shaped requests', async () => {
    const controller = registerSessionIpc({
      getTerminals: () => terminals as never, getMainWindow: () => ({ webContents: { send: vi.fn() } }) as never,
      getSafeWorkspacePath: (dir: string) => dir, getIsShuttingDown: () => false,
      getStore: () => ({ get: (key: string) => (key === 'harnessDefaults' ? defaults : false) }) as never,
      getHarnessOptions: () => options, harnessSpawnOverrides: { fileExists: () => true },
      getWorkspaceRegistry: () => registry as never, agentBridge: service,
    });
    const result = await handlers.get(SESSION_INVOKE)!({}, 'ws', { id: 's1', harness: 'codex', title: 't', cwd: WORKSPACE, timestamp: 1 }, false) as { checkoutContextId?: string };
    expect(result.checkoutContextId).toBe('ws::main');
    // The internal route is not reachable through IPC: the handler has no way to name a target context.
    expect(handlers.get(SESSION_INVOKE)!.length).toBeLessThanOrEqual(5);
    expect(controller.resumeInCheckout).toBeTypeOf('function');
  });
});

describe('lifecycle grants follow what native attention actually did for THIS launch', () => {
  const TREE_PATH = toNativePath('/workspace-worktrees/task', process.platform);
  const TREE = { id: 'ws::ckt-1', workspaceId: 'ws', environmentId: 'local', path: '/workspace-worktrees/task', kind: 'worktree' as const, branch: 'task' };
  const lifecycleNames = ['clanker_create_isolated_checkout', 'clanker_complete_isolated_checkout'];
  const port = { create: async () => ({ data: {} }), complete: async () => ({ data: {} }) };

  // What the user can put in front of each provider so that it declines native attention (user-owned config).
  const BLOCKERS: Array<{ harness: string; flags: string; resumeArgs: string[]; env?: Record<string, string> }> = [
    { harness: 'claude', flags: '--bare', resumeArgs: ['--resume', 's1', '--bare'] },
    { harness: 'codex', flags: '--profile mine', resumeArgs: ['resume', 's1', '--profile', 'mine'] },
    { harness: 'opencode', flags: '--pure', resumeArgs: ['--session', 's1', '--pure'] },
  ];

  function arrange() {
    service = new AgentBridgeService({
      getRegistry: () => registry as never, getTerminals: () => terminals, version: () => '1',
      capabilities: [...DEFAULT_AGENT_BRIDGE_CAPABILITIES, ...createCheckoutLifecycleCapabilities(port)],
    });
    registry = withCheckoutContexts({ getWorkspace: (id: string) => (id === 'ws' ? workspaceObject : null), getWorkspaceByLocation: () => null }, [TREE]) as never;
    const common = {
      getTerminals: () => terminals as never, getMainWindow: () => ({ webContents: { send: vi.fn() } }) as never,
      getStore: () => ({ get: (key: string) => (key === 'harnessDefaults' ? defaults : false) }) as never,
      getSafeWorkspacePath: (dir: string) => dir, getHarnessOptions: () => options, harnessSpawnOverrides: { fileExists: () => true },
      getWorkspaceRegistry: () => registry as never, agentBridge: service, agentAttentionBroker: broker as never,
    };
    registerTerminalIpc({ ...common, ensureHarnessWrapperScript: () => testHarnessWrapper() });
    return registerSessionIpc({
      ...common, getIsShuttingDown: () => false,
      listWorktrees: async () => ({ success: true, worktrees: [
        { path: WORKSPACE, branch: 'main', isMain: true, isLocked: false, isPrunable: false },
        { path: TREE_PATH, branch: 'task', isMain: false, isLocked: false, isPrunable: false },
      ] }),
    });
  }
  const last = () => mockSpawnPty.mock.calls[mockSpawnPty.mock.calls.length - 1][0] as { env: Record<string, string>; spawnArgs: string[] | string };
  const toolsOfLast = () => {
    const token = last().env[AGENT_BRIDGE_TOKEN_ENV];
    const grant = token ? service.credentials.resolve(token) : null;
    return grant ? service.listTools(grant).map((tool) => tool.name) : null;
  };
  const argvOfLast = () => { const { spawnArgs } = last(); return Array.isArray(spawnArgs) ? spawnArgs.join(' ') : spawnArgs; };

  describe.each(BLOCKERS)('$harness', ({ harness, flags, resumeArgs }) => {
    it('terminal launch: attention declined by user config -> the harness still launches, the bridge attaches, only clanker_context is granted', async () => {
      const controller = arrange();
      defaults[harness] = { agentBridgeEnabled: true, attentionEnabled: true, flags };
      await spawn(harness);
      expect(mockSpawnPty).toHaveBeenCalledTimes(1); // it launched
      expect(argvOfLast()).toContain(flags.split(' ')[0]); // with the user's own flag, untouched
      expect(last().env.CLANKER_ATTENTION_COMMAND).toBeDefined(); // the broker registration is separate and still exists
      expect(toolsOfLast()).toEqual(['clanker_context']);
      expect(controller).toBeDefined();
    });

    it('terminal launch: attention attached -> the lifecycle tools are granted as before', async () => {
      arrange();
      defaults[harness] = { agentBridgeEnabled: true, attentionEnabled: true };
      await spawn(harness);
      expect(toolsOfLast()).toEqual(['clanker_context', ...lifecycleNames]);
    });

    it('terminal launch: attention switched off in settings -> only clanker_context (unchanged)', async () => {
      arrange();
      defaults[harness] = { agentBridgeEnabled: true, attentionEnabled: false };
      await spawn(harness);
      expect(toolsOfLast()).toEqual(['clanker_context']);
    });

    it('re-home/resume launch: attention declined -> still launches with clanker_context only; attached -> lifecycle tools', async () => {
      const controller = arrange();
      defaults[harness] = { agentBridgeEnabled: true, attentionEnabled: true };
      const session = { id: 's1', harness, title: 't', cwd: WORKSPACE, timestamp: 1 } as HarnessSession;

      mockBuildArgs.mockReturnValue({ command: harness, args: resumeArgs });
      await controller.resumeInCheckout('ws', session, { targetContext: TREE });
      expect(toolsOfLast()).toEqual(['clanker_context']);

      const attached = harness === 'claude' ? ['--resume', 's1'] : harness === 'codex' ? ['resume', 's1'] : ['--session', 's1'];
      mockBuildArgs.mockReturnValue({ command: harness, args: attached });
      await controller.resumeInCheckout('ws', session, { targetContext: TREE });
      expect(toolsOfLast()).toEqual(['clanker_context', ...lifecycleNames]);
    });
  });

  it('a harness that can safely rehome but has no bridge transport gets no credential at all, so no lifecycle tools exist for it', async () => {
    arrange();
    const provider = findHarnessProvider('claude') as { agentBridge?: unknown };
    const saved = provider.agentBridge;
    defaults.claude = { agentBridgeEnabled: true, attentionEnabled: true };
    try {
      provider.agentBridge = undefined;
      await spawn('claude');
      expect(mockSpawnPty).toHaveBeenCalledTimes(1); // it still launches
      expect(last().env[AGENT_BRIDGE_TOKEN_ENV]).toBeUndefined();
      expect(toolsOfLast()).toBeNull();
    } finally { provider.agentBridge = saved; }
  });

  it('Pi gets context only, with no rehome or lifecycle tools', async () => {
    arrange();
    defaults.pi = { agentBridgeEnabled: true, attentionEnabled: true };
    await spawn('pi');
    expect(toolsOfLast()).toEqual(['clanker_context']);
  });

  it('OpenCode: a user-owned OPENCODE_CONFIG_DIR also declines attention, and the lifecycle tools are not granted', async () => {
    arrange();
    defaults.opencode = { agentBridgeEnabled: true, attentionEnabled: true };
    options.opencode = { ...options.opencode, env: { OPENCODE_CONFIG_DIR: '/home/me/.config/opencode-mine' } };
    try {
      await spawn('opencode');
      expect(mockSpawnPty).toHaveBeenCalledTimes(1);
      expect(toolsOfLast()).toEqual(['clanker_context']);
    } finally { delete options.opencode.env; }
  });
});
