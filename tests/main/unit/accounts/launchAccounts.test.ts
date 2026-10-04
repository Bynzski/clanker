import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { HarnessSession } from '../../../../src/shared/types/session';
import { SESSION_DISCOVER, SESSION_INVOKE, SPAWN_TERMINAL } from '../../../../src/shared/ipcChannels';
import { toNativePath } from '../../../../src/shared/pathNormalize';
import { testHarnessWrapper } from '../../../_helpers/tempPaths';

const { mockHandle, mockSpawnPty, mockDiscover, mockBuildArgs } = vi.hoisted(() => ({
  mockHandle: vi.fn(), mockSpawnPty: vi.fn(), mockDiscover: vi.fn(), mockBuildArgs: vi.fn(),
}));
// These tests exercise unrelated resume behaviour against a fictional '/workspace'; the real
// filesystem-backed containment rule is covered by sessionIpcWorktrees.test.ts and the real-Git test.
vi.mock('../../../../src/main/localPathContainment', async () => {
  const path = await import('node:path');
  return { isInsideRoot: (root: string, target: string) => {
    const relative = path.relative(root, target);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  } };
});

vi.mock('electron', () => ({ ipcMain: { handle: mockHandle, on: vi.fn() }, BrowserWindow: vi.fn(), clipboard: { writeText: vi.fn() }, shell: { openExternal: vi.fn() } }));
vi.mock('../../../../src/main/ipc/ptySpawn', () => ({ spawnPtyProcess: mockSpawnPty, waitForTerminalCleanup: vi.fn() }));
vi.mock('../../../../src/main/platformShell', async (importOriginal) => ({ ...(await importOriginal<object>()), defaultShell: () => 'shell' }));
vi.mock('../../../../src/main/sessionHistory', async (importOriginal) => ({
  ...(await importOriginal<object>()), discoverSessions: mockDiscover, buildSessionLaunch: mockBuildArgs,
}));

import { registerTerminalIpc } from '../../../../src/main/ipc/terminalIpc';
import { registerSessionIpc } from '../../../../src/main/ipc/sessionIpc';
import { addAccount, createHarness, lastOf, type Harness } from './accountFixtures';
import { withCheckoutContexts } from '../../../_helpers/checkoutContexts';

const WORKSPACE = toNativePath('/workspace', process.platform);
const workspaceObject = { workspaceId: 'ws', location: { environmentId: 'local', path: '/workspace' } };
const stableRegistry = withCheckoutContexts({ getWorkspace: (id: string) => (id === 'ws' ? workspaceObject : null) });
type Handler = (event: unknown, ...args: unknown[]) => Promise<Record<string, unknown>>;
const handlers = new Map<string, Handler>();

let h: Harness;
const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of ['CODEX_HOME', 'CLAUDE_CONFIG_DIR']) { savedEnv[key] = process.env[key]; delete process.env[key]; }
  handlers.clear();
  mockHandle.mockReset().mockImplementation((channel: string, handler: Handler) => { handlers.set(channel, handler); });
  mockSpawnPty.mockReset().mockReturnValue({ id: 'term', pid: 1 });
  mockDiscover.mockReset().mockResolvedValue([]);
  mockBuildArgs.mockReset().mockReturnValue({ command: 'codex', args: ['resume', 'x'] });
  h = createHarness();
});
afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  fs.rmSync(h.root, { recursive: true, force: true });
});

const options = {
  codex: { name: 'Codex', command: 'codex', args: [] as string[], icon: 'c' },
  claude: { name: 'Claude', command: 'claude', args: [] as string[], icon: 'c' },
};
const store = { get: (key: string) => (key === 'harnessDefaults' ? { codex: { flags: '' }, claude: { flags: '' } } : false) };

function registerTerminal(withService = true) {
  registerTerminalIpc({
    getTerminals: () => new Map(), getMainWindow: () => ({ webContents: { send: vi.fn() } }) as never, getStore: () => store as never,
    getSafeWorkspacePath: (dir: string) => dir, getHarnessOptions: () => options,
    ensureHarnessWrapperScript: () => testHarnessWrapper(),
    ...(withService ? { getHarnessAccountService: () => h.service } : {}),
  });
}
const spawnEnv = () => lastOf(mockSpawnPty.mock.calls)[0].env as Record<string, string>;
const spawn = (harness: string) => handlers.get(SPAWN_TERMINAL)!(null, WORKSPACE, harness);

describe('fresh launches use the selected account (terminal)', () => {
  it.each([['codex', 'CODEX_HOME'], ['claude', 'CLAUDE_CONFIG_DIR']])('default-only %s launches without %s and creates no account state', async (harness, variable) => {
    registerTerminal();
    await spawn(harness);
    expect(spawnEnv()).not.toHaveProperty(variable);
    expect(fs.existsSync(path.join(h.root, 'harness-accounts'))).toBe(false);
    registerTerminal(false);
    await spawn(harness);
    expect(spawnEnv()).not.toHaveProperty(variable);
  });

  it('a user-set variable in the app environment is left exactly as before for the default account', async () => {
    process.env.CODEX_HOME = '/user/own/codex';
    registerTerminal();
    await spawn('codex');
    expect(spawnEnv().CODEX_HOME).toBe('/user/own/codex');
  });

  it('managed Codex receives only its trusted owned home (and nothing for Claude)', async () => {
    const account = await addAccount(h, 'codex', 'Work');
    h.service.select('local', 'codex', account.id);
    registerTerminal();
    await spawn('codex');
    expect(spawnEnv().CODEX_HOME).toBe(h.homes.resolve('codex', account.id));
    expect(spawnEnv()).not.toHaveProperty('CLAUDE_CONFIG_DIR');
    await spawn('claude');
    expect(spawnEnv()).not.toHaveProperty('CODEX_HOME');
    expect(spawnEnv()).not.toHaveProperty('CLAUDE_CONFIG_DIR');
  });

  it('managed Claude receives only its trusted config directory', async () => {
    const account = await addAccount(h, 'claude', 'Personal');
    h.service.select('local', 'claude', account.id);
    registerTerminal();
    await spawn('claude');
    expect(spawnEnv().CLAUDE_CONFIG_DIR).toBe(h.homes.resolve('claude', account.id));
    expect(spawnEnv()).not.toHaveProperty('CODEX_HOME');
  });

  it('changing the selection never touches an already-spawned terminal, only later launches', async () => {
    const one = await addAccount(h, 'codex', 'One');
    const two = await addAccount(h, 'codex', 'Two');
    registerTerminal();
    h.service.select('local', 'codex', one.id);
    await spawn('codex');
    const first = lastOf(mockSpawnPty.mock.calls)[0].env as Record<string, string>;
    const firstHome = first.CODEX_HOME;
    h.service.select('local', 'codex', two.id);
    expect(first.CODEX_HOME).toBe(firstHome);
    await spawn('codex');
    expect(spawnEnv().CODEX_HOME).toBe(h.homes.resolve('codex', two.id));
    expect(spawnEnv().CODEX_HOME).not.toBe(firstHome);
  });

  it('a disconnected selected account fails the launch explicitly instead of falling back', async () => {
    const account = await addAccount(h, 'codex', 'Work');
    h.service.select('local', 'codex', account.id);
    h.service.reportStatus(account.id, 'needs-auth');
    registerTerminal();
    mockSpawnPty.mockClear();
    await expect(spawn('codex')).rejects.toThrow('needs to be reconnected');
    expect(mockSpawnPty).not.toHaveBeenCalled();
  });

  it('plain shells and non-account harnesses are unaffected', async () => {
    const account = await addAccount(h, 'codex', 'Work');
    h.service.select('local', 'codex', account.id);
    registerTerminal();
    await handlers.get(SPAWN_TERMINAL)!(null, WORKSPACE);
    expect(spawnEnv()).not.toHaveProperty('CODEX_HOME');
  });
});

describe('resume and fork keep the account that owns the session', () => {
  const codexSession = (over: Partial<HarnessSession> = {}): HarnessSession =>
    ({ id: 'sess-1', harness: 'codex', title: 't', cwd: '/workspace', timestamp: 1, ...over });
  const owned = (accountId: string): HarnessSession => ({ ...codexSession(), cwd: WORKSPACE, accountId });

  function registerSession() {
    registerSessionIpc({
      getTerminals: () => new Map(), getMainWindow: () => ({ webContents: { send: vi.fn() } }) as never,
      getSafeWorkspacePath: (dir: string) => dir, getIsShuttingDown: () => false, getStore: () => store as never,
      getHarnessOptions: () => options,
      // Account/session ownership is the subject here, not host installation: the real planner runs, with a deterministic fake executable.
      harnessSpawnOverrides: { fileExists: () => true },
      getWorkspaceRegistry: () => stableRegistry as never,
      getHarnessAccountService: () => h.service,
    });
  }
  const invoke = (session: unknown, fork?: boolean) => handlers.get(SESSION_INVOKE)!({}, 'ws', session, fork);
  const spawnedEnv = () => lastOf(mockSpawnPty.mock.calls)[0].env as Record<string, string>;

  /** Managed accounts A and B, a session stored under A, and B currently selected. */
  async function twoAccounts() {
    const a = await addAccount(h, 'codex', 'Personal');
    const b = await addAccount(h, 'codex', 'Work');
    h.capabilities.codex.discoverSessions.mockImplementation(async (_ws: string, home: string) =>
      home === h.homes.resolve('codex', a.id) ? [{ id: 'sess-1', harness: 'codex', title: 'from A', cwd: WORKSPACE, timestamp: 5, modelId: 'gpt-a' }] : []);
    h.service.select('local', 'codex', b.id);
    registerSession();
    return { a, b };
  }

  it('resumes with the originating account even though another account is selected', async () => {
    const { a, b } = await twoAccounts();
    await invoke(owned(a.id));
    expect(spawnedEnv().CODEX_HOME).toBe(h.homes.resolve('codex', a.id));
    expect(spawnedEnv().CODEX_HOME).not.toBe(h.homes.resolve('codex', b.id));
    // The launched session is the authoritative rediscovered copy.
    expect(mockBuildArgs).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'sess-1', modelId: 'gpt-a', cwd: WORKSPACE }), false, '');
    await invoke(owned(a.id), true);
    expect(spawnedEnv().CODEX_HOME).toBe(h.homes.resolve('codex', a.id));
    expect(mockBuildArgs).toHaveBeenLastCalledWith(expect.anything(), true, '');
  });

  it('cannot move an account-A session to account B by rewriting renderer provenance', async () => {
    const { b } = await twoAccounts();
    mockSpawnPty.mockClear();
    await expect(invoke(owned(b.id))).rejects.toThrow('not found in its account');
    expect(mockSpawnPty).not.toHaveBeenCalled();
  });

  it('does not trust renderer-supplied cwd, model or file path for a managed session', async () => {
    const { a } = await twoAccounts();
    await invoke({ ...owned(a.id), modelId: 'attacker-model', filePath: '/etc/passwd', title: 'x' });
    const launched = lastOf(mockBuildArgs.mock.calls)[0] as HarnessSession;
    expect(launched.modelId).toBe('gpt-a');
    expect(launched.filePath).toBeUndefined();
  });

  it.each([['invented', `acct_${'9'.repeat(32)}`], ['path-like', '../../.codex'], ['non-string', 42], ['other harness', 'claude-id']])('rejects a %s account ID', async (_label, accountId) => {
    await twoAccounts();
    mockSpawnPty.mockClear();
    await expect(invoke({ ...owned('x'), accountId })).rejects.toThrow();
    expect(mockSpawnPty).not.toHaveBeenCalled();
  });

  it('a removed account\'s session never resumes under default, current or another account', async () => {
    const { a } = await twoAccounts();
    await h.service.remove('local', 'codex', a.id);
    mockSpawnPty.mockClear();
    await expect(invoke(owned(a.id))).rejects.toThrow('removed or is no longer available');
    expect(mockSpawnPty).not.toHaveBeenCalled();
  });

  it('a disconnected source account is a safe explicit error', async () => {
    const { a } = await twoAccounts();
    h.service.reportStatus(a.id, 'needs-auth');
    await expect(invoke(owned(a.id))).rejects.toThrow('needs to be reconnected');
  });

  it('a session without account provenance resumes under the native account, not the selected one', async () => {
    await twoAccounts();
    await invoke({ ...codexSession(), cwd: WORKSPACE });
    expect(spawnedEnv()).not.toHaveProperty('CODEX_HOME');
    await invoke({ ...codexSession(), cwd: WORKSPACE, accountId: 'default' });
    expect(spawnedEnv()).not.toHaveProperty('CODEX_HOME');
  });

  it('Claude managed sessions bind CLAUDE_CONFIG_DIR the same way', async () => {
    const claude = await addAccount(h, 'claude', 'C');
    h.capabilities.claude.discoverSessions.mockResolvedValue([{ id: 'c-1', harness: 'claude', title: 't', cwd: WORKSPACE, timestamp: 1 }]);
    registerSession();
    mockBuildArgs.mockReturnValue({ command: 'claude', args: ['--resume', 'c-1'] });
    await invoke({ id: 'c-1', harness: 'claude', title: 't', cwd: WORKSPACE, timestamp: 1, accountId: claude.id });
    expect(spawnedEnv().CLAUDE_CONFIG_DIR).toBe(h.homes.resolve('claude', claude.id));
    expect(spawnedEnv()).not.toHaveProperty('CODEX_HOME');
  });

  it('discovery merges managed sessions and passes the managed source (default-only passes none)', async () => {
    registerSession();
    const discover = handlers.get(SESSION_DISCOVER)!;
    await discover({}, 'ws');
    expect(mockDiscover).toHaveBeenLastCalledWith(WORKSPACE);
    const account = await addAccount(h, 'codex', 'W');
    await discover({}, 'ws');
    const [, discoverOptions] = lastOf(mockDiscover.mock.calls);
    expect(discoverOptions.managed.targets.map((t: { accountId: string }) => t.accountId)).toEqual([account.id]);
  });

  it('remote sessions ignore any account claim and never receive local managed paths', async () => {
    const { a } = await twoAccounts();
    const remote = { workspaceId: 'r', location: { environmentId: 'ssh-1', path: '/srv/p' }, environment: { capabilities: { sessionDiscovery: false } } };
    handlers.clear();
    registerSessionIpc({
      getTerminals: () => new Map(), getMainWindow: () => null, getSafeWorkspacePath: (d: string) => d, getIsShuttingDown: () => false,
      getStore: () => store as never, getHarnessOptions: () => options, getWorkspaceRegistry: () => withCheckoutContexts({ getWorkspace: () => remote }) as never,
      getHarnessAccountService: () => h.service,
    });
    mockSpawnPty.mockClear();
    await expect(handlers.get(SESSION_INVOKE)!({}, 'r', owned(a.id))).rejects.toThrow('Remote session invocation is not supported');
    expect(mockSpawnPty).not.toHaveBeenCalled();
  });
});
