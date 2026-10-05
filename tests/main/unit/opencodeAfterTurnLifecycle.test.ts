/**
 * OpenCode re-homing, end to end: an `after-turn` move through OpenCode's native session relocation.
 *
 * What was measured with OpenCode 1.18.34 (see src/main/harnesses/opencode/rehome.ts) and is modelled here:
 * `opencode --session <id>` ignores the process directory and `--dir` and runs in the directory RECORDED in
 * the conversation; only the native move-session operation changes that record (same session id).
 *
 * Real here: the AgentAttentionBroker (fed plugin-style frames over loopback), the bridge and its
 * credentials, the lifecycle service, the SPAWN_TERMINAL / SESSION_INVOKE launches and retirement. Faked:
 * the PTY (which resumes in the recorded directory), the native mover (records its requests), Git, the renderer channel.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import type { AgentCheckoutTransitionEvent } from '../../../src/shared/types/checkoutTransition';
import { SPAWN_TERMINAL } from '../../../src/shared/ipcChannels';
import { removeAttentionAdapterFiles } from '../../../src/main/agentAttentionAdapters';
import { worktreeDirectoryName } from '../../../src/main/worktreePaths';
import { toPosixPath } from '../../../src/shared/pathNormalize';
import { testHarnessWrapper } from '../../_helpers/tempPaths';

const { mockHandle, mockSpawnPty, mockDiscover, mockBuildArgs } = vi.hoisted(() => ({
  mockHandle: vi.fn(), mockSpawnPty: vi.fn(), mockDiscover: vi.fn(), mockBuildArgs: vi.fn(),
}));
vi.mock('electron', () => ({ ipcMain: { handle: mockHandle, on: vi.fn() }, BrowserWindow: vi.fn(), clipboard: { writeText: vi.fn() }, shell: { openExternal: vi.fn() } }));
vi.mock('../../../src/main/ipc/ptySpawn', () => ({ spawnPtyProcess: mockSpawnPty, waitForTerminalCleanup: vi.fn() }));
vi.mock('../../../src/main/platformShell', async (importOriginal) => ({ ...(await importOriginal<object>()), defaultShell: () => 'shell' }));
vi.mock('../../../src/main/sessionHistory', async (importOriginal) => ({
  ...(await importOriginal<object>()), discoverSessions: mockDiscover, buildSessionLaunch: mockBuildArgs,
}));

import { registerTerminalIpc } from '../../../src/main/ipc/terminalIpc';
import { registerSessionIpc } from '../../../src/main/ipc/sessionIpc';
import { AgentAttentionBroker } from '../../../src/main/agentAttentionBroker';
import { AgentBridgeService, AGENT_BRIDGE_TOKEN_ENV } from '../../../src/main/agentBridge/service';
import { DEFAULT_AGENT_BRIDGE_CAPABILITIES } from '../../../src/main/agentBridge/capabilities';
import { createCheckoutLifecycleCapabilities, deferredLifecyclePort } from '../../../src/main/agentBridge/lifecycleCapabilities';
import { IsolatedCheckoutService } from '../../../src/main/isolatedCheckout/isolatedCheckoutService';
import { releaseCheckoutContext } from '../../../src/main/checkoutContextRelease';
import { retireTerminal, retireTerminalAndWait } from '../../../src/main/terminalRetirement';
import { openCodeMover } from '../../../src/main/harnesses/opencode/rehome';
import { UnverifiedProcessExitError } from '../../../src/main/harnesses/types';

const SESSION = '01a10b90-0961-7001-a289-382027d5a088';
let root: string;
let appPath: string;
const generated = (branch: string) => path.join(`${appPath}-worktrees`, worktreeDirectoryName(branch));
afterAll(() => removeAttentionAdapterFiles());

interface Spawned {
  id: string; cwd: string; env: Record<string, string>; spawnArgs: string[] | string; checkoutContextId?: string; workspaceId?: string; harnessId?: string;
  onExit: () => unknown; onOutput?: (data: string) => void;
}
type Fake = { exited: Promise<void>; workspaceId?: string; checkoutContextId?: string; harnessId?: string; cwd: string; pty: { kill: ReturnType<typeof vi.fn> }; releaseResources: ReturnType<typeof vi.fn> };

let terminals: Map<string, Fake>;
let contexts: CheckoutContext[];
let listed: Array<{ path: string; branch: string | null; isMain: boolean; isPrunable?: boolean }>;
let events: AgentCheckoutTransitionEvent[];
let log: string[];
let spawns: Spawned[];
let bridge: AgentBridgeService;
let broker: AgentAttentionBroker;
let lifecycle: IsolatedCheckoutService;
let dirty: boolean;
/** The directory recorded in the conversation, where OpenCode actually runs it. */
let effectiveCwd: Map<string, string>;
let spawnBehavior: (options: Spawned, attempt: number) => 'ok' | { fail: string };
let resumeAttempts: number;
/** When set, Git worktree creation waits for it (a creation that outlives the tool call's timeout). */
let createGate: Promise<void> | null;
/** How a killed process behaves: exits at once, only on SIGKILL, or only when the test lets it. */
let killMode: 'prompt' | 'manual' | 'ignores-sigterm';
const processExits = new Map<string, () => void>();
let relocations: Array<{ sessionId: string; directory: string; env: NodeJS.ProcessEnv }>;
let relocateBehavior: (request: { directory: string }) => void;
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<Record<string, unknown>>>();
const removedPaths: string[] = [];
const deletedBranches: string[] = [];

const MAIN = (): CheckoutContext => ({ id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: toPosixPath(appPath), kind: 'main' });
const live = () => [...terminals.keys()];
const lastSpawn = () => spawns[spawns.length - 1];
const tokenOf = (spawn: Spawned) => spawn.env[AGENT_BRIDGE_TOKEN_ENV];
const argv = (spawn: Spawned) => (Array.isArray(spawn.spawnArgs) ? spawn.spawnArgs : [spawn.spawnArgs]);

beforeEach(async () => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-after-turn-')));
  appPath = path.join(root, 'app');
  fs.mkdirSync(appPath, { recursive: true });
  terminals = new Map(); contexts = [MAIN()]; events = []; log = []; spawns = []; dirty = false; resumeAttempts = 0; killMode = 'prompt'; createGate = null; processExits.clear();
  effectiveCwd = new Map(); removedPaths.length = 0; deletedBranches.length = 0;
  listed = [{ path: appPath, branch: 'main', isMain: true }];
  spawnBehavior = () => 'ok';
  handlers.clear();
  mockHandle.mockReset().mockImplementation((channel: string, handler: never) => { handlers.set(channel, handler); });
  mockBuildArgs.mockReset().mockReturnValue({ command: 'opencode', args: ['--session', SESSION] });
  // History records the conversation where the thread last ran.
  mockDiscover.mockReset().mockImplementation(async () => [{ id: SESSION, harness: 'opencode', title: 't', cwd: toPosixPath(effectiveCwd.get(SESSION) ?? appPath), timestamp: 1 }]);
  mockSpawnPty.mockReset().mockImplementation((options: Spawned) => {
    spawns.push(options);
    const isResume = argv(options).includes('--session');
    if (isResume && spawns.length > 1) resumeAttempts += 1;
    // OpenCode runs a resumed conversation in the directory RECORDED in it, whatever the launch directory.
    const requested = (isResume && spawns.length > 1 ? effectiveCwd.get(SESSION) : undefined) ?? options.cwd;
    log.push(`spawn ${options.id} runsIn=${requested === appPath ? 'main' : requested === generated('feature') ? 'feature' : path.basename(requested)} launchDir=${options.cwd === appPath ? 'main' : path.basename(options.cwd)}`);
    const behavior = spawnBehavior(options, resumeAttempts);
    // The process' REAL exit is separate from the record leaving the table: kill() only REQUESTS it.
    let markExited!: () => void;
    const exited = new Promise<void>((resolve) => { markExited = resolve; });
    const exitNow = () => { log.push(`exit ${options.id}`); markExited(); };
    processExits.set(options.id, exitNow);
    const terminal: Fake = {
      exited,
      workspaceId: options.workspaceId, checkoutContextId: options.checkoutContextId, harnessId: options.harnessId, cwd: options.cwd,
      pty: { kill: vi.fn((signal?: string) => {
        log.push(signal ? `kill ${options.id} ${signal}` : `kill ${options.id}`);
        if (killMode === 'prompt' || (killMode === 'ignores-sigterm' && signal === 'SIGKILL')) setTimeout(exitNow, 1);
      }) },
      releaseResources: vi.fn(async () => { log.push(`dispose ${options.id}`); await options.onExit(); }),
    };
    terminals.set(options.id, terminal);
    if (behavior === 'ok') {
      effectiveCwd.set(SESSION, requested);
      queueMicrotask(() => options.onOutput?.('tui'));
    } else {
      queueMicrotask(() => {
        options.onOutput?.(behavior.fail);
        setTimeout(() => { terminals.delete(options.id); void options.onExit(); }, 1);
      });
    }
    return { id: options.id, pid: 10 + spawns.length };
  });
  relocations = []; relocateBehavior = () => undefined;
  openCodeMover.move = async (request) => {
    log.push(`relocate ${request.directory === appPath ? 'main' : request.directory === generated('feature') ? 'feature' : path.basename(request.directory)}`);
    relocations.push(request);
    relocateBehavior(request);
    effectiveCwd.set(SESSION, request.directory);
  };
  await build();
});
afterEach(async () => { await lifecycle.shutdown(); await bridge.shutdown(); broker.close(); fs.rmSync(root, { recursive: true, force: true }); });

async function build() {
  const workspace = { workspaceId: 'ws', location: { environmentId: 'local', path: toPosixPath(appPath) } };
  const registry = {
    getWorkspace: (id: string) => (id === 'ws' ? workspace : null),
    getWorkspaceByLocation: () => null,
    resolveCheckoutContext: (id: string, contextId?: string) => (id !== 'ws' ? null : contextId ? contexts.find((entry) => entry.id === contextId) ?? null : contexts[0]),
    getCheckoutContext: (id: string) => contexts.find((entry) => entry.id === id) ?? null,
    getCheckoutContextsForWorkspace: () => contexts,
    unregisterCheckoutContext: (id: string) => { const before = contexts.length; contexts = contexts.filter((entry) => entry.id !== id); return contexts.length < before; },
    getWorktreeResourceId: (id: string) => id,
  };
  const port = deferredLifecyclePort();
  bridge = new AgentBridgeService({
    getRegistry: () => registry as never, getTerminals: () => terminals as never, version: () => '1',
    capabilities: [...DEFAULT_AGENT_BRIDGE_CAPABILITIES, ...createCheckoutLifecycleCapabilities(port.port)],
  });
  // The REAL broker; every change it publishes also reaches the lifecycle service, as in main.ts.
  broker = new AgentAttentionBroker((change) => { lifecycle?.onAttentionChange(change); }, () => undefined);
  const defaults = { opencode: { agentBridgeEnabled: true, attentionEnabled: true, flags: '' } };
  const store = { get: (key: string) => (key === 'harnessDefaults' ? defaults : false) } as never;
  const options = { opencode: { name: 'opencode', command: 'opencode', args: [] as string[], icon: 'c' } };
  const common = {
    getTerminals: () => terminals as never, getMainWindow: () => ({ webContents: { send: vi.fn() } }) as never, getStore: () => store,
    getSafeWorkspacePath: (dir: string) => dir, getHarnessOptions: () => options, getWorkspaceRegistry: () => registry as never,
    harnessSpawnOverrides: { fileExists: () => true }, agentBridge: bridge, agentAttentionBroker: broker,
  };
  registerTerminalIpc({ ...common, ensureHarnessWrapperScript: () => testHarnessWrapper() });
  const sessions = registerSessionIpc({
    ...common, getIsShuttingDown: () => false,
    listWorktrees: async () => ({ success: true, worktrees: listed.map((entry) => ({ isLocked: false, isPrunable: false, ...entry })) }),
    listBranches: async () => ['main'],
  });
  const treeOf = (branch: string): CheckoutContext => ({ id: `ws::ckt-${branch}`, workspaceId: 'ws', environmentId: 'local', path: toPosixPath(generated(branch)), kind: 'worktree', branch });
  const git = {
    getBranchState: async () => ({ success: true, isRepo: true, currentBranch: 'main', isDetached: false, branches: [{ name: 'main', isCurrent: true }] }),
    createCheckoutWorktree: async (_ws: string, branch: string) => {
      if (createGate) await createGate;
      fs.mkdirSync(generated(branch), { recursive: true });
      const context = treeOf(branch);
      contexts.push(context);
      listed.push({ path: generated(branch), branch, isMain: false });
      log.push(`createWorktree ${branch}`);
      return { success: true, worktree: { path: context.path, branch, isMain: false, isLocked: false, isPrunable: false }, checkoutContext: context };
    },
    listWorktrees: async () => ({ success: true, worktrees: listed.map((entry) => ({ isLocked: false, isPrunable: false, ...entry })) }),
    checkWorktreeClean: async (_ws: string, worktreePath: string) => ({ success: true, hasChanges: dirty, worktree: { path: worktreePath, branch: 'x' } }),
    inspectWorktree: async (_ws: string, worktreePath: string) => {
      const entry = listed.find((candidate) => toPosixPath(candidate.path) === toPosixPath(worktreePath));
      return { success: true, hasChanges: false, worktree: { path: worktreePath, branch: entry?.branch ?? null, isMain: false, isLocked: false, isPrunable: false } };
    },
    removeWorktree: async (_ws: string, worktreePath: string) => {
      log.push('removeWorktree');
      removedPaths.push(worktreePath);
      fs.rmSync(worktreePath, { recursive: true, force: true });
      listed = listed.filter((entry) => toPosixPath(entry.path) !== toPosixPath(worktreePath));
      return { success: true };
    },
    forgetMissingWorktree: async () => ({ success: true }),
    deleteBranch: async (_ws: string, name: string) => { log.push(`deleteBranch ${name}`); deletedBranches.push(name); return { success: true }; },
    reconcileCheckoutContexts: async () => ({ success: true }),
  };
  lifecycle = new IsolatedCheckoutService({
    getRegistry: () => registry as never, getTerminals: () => terminals as never, attention: broker, git: git as never,
    getSessions: () => sessions,
    releaseCheckoutContext: (workspaceId, checkoutContextId) => releaseCheckoutContext({ registry: registry as never, terminals: terminals.values() as never, workspaceId, checkoutContextId }),
    retireTerminal: (id) => retireTerminal({ terminals: terminals as never, releaseAttention: (terminalId) => broker.release(terminalId) }, id),
    retireTerminalAndWait: (id) => retireTerminalAndWait({ terminals: terminals as never, releaseAttention: (terminalId) => broker.release(terminalId) }, id, { gracefulMs: 200, forcedMs: 200 }),
    notify: (event) => { events.push(event); log.push(`notify ${event.kind}`); },
    isShuttingDown: () => false,
    timing: { startDeadlineMs: 2_000, observationMs: 10, retryDelayMs: 1 },
  });
  port.bind(lifecycle);
  await broker.start();
}

/** What a harness hook does: one authenticated frame over loopback to the terminal's own broker endpoint. */
function frame(spawn: Spawned, event: string, fields: Record<string, unknown> = {}): Promise<void> {
  const env = spawn.env;
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(Number(env.CLANKER_ATTENTION_PORT), '127.0.0.1', () => {
      socket.end(JSON.stringify({ version: 1, token: env.CLANKER_ATTENTION_TOKEN, harness: 'opencode', event, scope: 'root', sessionId: SESSION, ...fields }));
    });
    socket.on('data', () => undefined);
    socket.on('close', () => resolve());
    socket.on('error', reject);
  });
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
async function turn(spawn: Spawned, turnId: string) { await frame(spawn, 'turn_started', { turnId }); await settle(); }
async function stop(spawn: Spawned, turnId: string, fields: Record<string, unknown> = {}) { await frame(spawn, 'turn_completed', { turnId, ...fields }); await settle(); }

async function launch() {
  const result = await handlers.get(SPAWN_TERMINAL)!(null, toPosixPath(appPath), 'opencode', undefined, undefined, undefined, 'ws', 'local') as { id: string };
  effectiveCwd.set(SESSION, appPath);
  return { id: result.id, spawn: lastSpawn() };
}
async function call(spawn: Spawned, name: string, args: Record<string, unknown> = {}) {
  const grant = bridge.credentials.resolve(tokenOf(spawn));
  if (!grant) return { revoked: true as const };
  const result = await bridge.callTool(grant, name, args);
  return { revoked: false as const, result, data: result.data as Record<string, unknown> };
}
const treeContext = () => contexts.find((context) => context.kind === 'worktree');
const kinds = () => events.map((event) => event.kind);


const where = (dir: string) => (dir === appPath ? 'main' : dir === generated('feature') ? 'feature' : path.basename(dir));
const spawnLine = (id: string) => log.findIndex((line) => line.startsWith(`spawn ${id}`));

async function scheduledCreate() {
  const first = await launch();
  await turn(first.spawn, 't1');
  await call(first.spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
  return first;
}

describe('create (OpenCode, after-turn with native relocation)', () => {
  it('is granted to an OpenCode launch and only schedules during the tool call: nothing is relocated, retired or resumed', async () => {
    const { id, spawn } = await launch();
    await turn(spawn, 't1');
    const result = await call(spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
    expect(result.data).toMatchObject({ status: 'scheduled' });
    expect(relocations).toEqual([]);
    expect(live()).toEqual([id]);
    expect(spawns).toHaveLength(1);
  });

  it('at the root turn end: source retired completely, THEN the record is relocated to the context path from main, THEN the same session id resumes there', async () => {
    const { id, spawn } = await scheduledCreate();
    await stop(spawn, 't1');
    const replacement = lastSpawn();
    expect(replacement.id).not.toBe(id);
    const dispose = log.indexOf(`dispose ${id}`);
    const relocate = log.findIndex((line) => line === 'relocate feature');
    expect(dispose).toBeGreaterThanOrEqual(0);
    expect(dispose).toBeLessThan(relocate);
    expect(relocate).toBeLessThan(spawnLine(replacement.id));
    expect(relocations).toEqual([{ sessionId: SESSION, directory: generated('feature'), env: expect.any(Object) }]);
    expect(argv(replacement)).toEqual(expect.arrayContaining(['--session', SESSION]));
    expect(log.find((line) => line.startsWith(`spawn ${replacement.id}`))).toContain('runsIn=feature');
    expect(effectiveCwd.get(SESSION)).toBe(generated('feature'));
    expect(live()).toEqual([replacement.id]);
    expect(kinds()).toEqual(['checkout-attached', 'notice', 'terminal-replaced', 'notice']);
  });

  it('credential rotation, actual context and attention: the replacement is bound to the TARGET, the source is revoked, one authoritative root', async () => {
    const { spawn } = await scheduledCreate();
    const sourceToken = tokenOf(spawn);
    await stop(spawn, 't1');
    const replacement = lastSpawn();
    expect(bridge.credentials.resolve(sourceToken)).toBeNull();
    expect(tokenOf(replacement)).not.toBe(sourceToken);
    expect(bridge.credentials.resolve(tokenOf(replacement))?.identity).toEqual({
      terminalId: replacement.id, workspaceId: 'ws', environmentId: 'local', checkoutContextId: treeContext()!.id, harnessId: 'opencode',
    });
    expect((await call(replacement, 'clanker_context')).data).toMatchObject({ checkout: { kind: 'worktree', isolated: true, branch: 'feature' } });
    expect(broker.snapshots().map((snapshot) => snapshot.terminalId)).toEqual([replacement.id]);
    await turn(replacement, 't2');
    expect(broker.snapshot(replacement.id)?.sessionId).toBe(SESSION); // same native session id: the same conversation
  });

  it('discovery after the move reports the new directory for the same session id', async () => {
    const { spawn } = await scheduledCreate();
    await stop(spawn, 't1');
    const found = await mockDiscover.getMockImplementation()!('ws') as Array<{ id: string; cwd: string }>;
    expect(found).toEqual([expect.objectContaining({ id: SESSION, cwd: toPosixPath(generated('feature')) })]);
  });

  it('a native refusal leaves the conversation where it was: no resume in the wrong directory, the original is restored, nothing is deleted', async () => {
    const { id, spawn } = await scheduledCreate();
    relocateBehavior = (request) => { if (request.directory === generated('feature')) throw new Error('Destination directory belongs to another project'); };
    await stop(spawn, 't1');
    const resumed = spawns.slice(1);
    expect(resumed).toHaveLength(1); // only the recovery
    expect(log.find((line) => line.startsWith(`spawn ${resumed[0].id}`))).toContain('runsIn=main');
    expect(relocations.map((request) => where(request.directory))).toEqual(['feature', 'main']);
    expect(effectiveCwd.get(SESSION)).toBe(appPath);
    expect(terminals.has(id)).toBe(false);
    expect(fs.existsSync(generated('feature'))).toBe(true);
    expect(removedPaths).toEqual([]);
    expect(deletedBranches).toEqual([]);
    expect((events.filter((event) => event.kind === 'notice').pop() as { tone: string })).toMatchObject({ tone: 'warning' });
  });

  it('when the resume in the target fails after relocation, the record is relocated back before the recovery resume', async () => {
    const { spawn } = await scheduledCreate();
    spawnBehavior = (options) => (options.checkoutContextId === treeContext()!.id ? { fail: 'boom' } : 'ok');
    await stop(spawn, 't1');
    expect(relocations.map((request) => where(request.directory))).toEqual(['feature', 'main']);
    const recovered = lastSpawn();
    expect(log.find((line) => line.startsWith(`spawn ${recovered.id}`))).toContain('runsIn=main');
    expect(effectiveCwd.get(SESSION)).toBe(appPath);
    expect(removedPaths).toEqual([]);
  });

  it('an Interrupt cancels the pending move before anything is relocated', async () => {
    const { spawn } = await scheduledCreate();
    await frame(spawn, 'turn_interrupted', { turnId: 't1' });
    await settle();
    expect(relocations).toEqual([]);
    await turn(spawn, 't2'); await stop(spawn, 't2');
    expect(relocations).toEqual([]);
    expect(spawns).toHaveLength(1);
  });

  it('a plain OpenCode launch relocates nothing and keeps its ordinary arguments', async () => {
    const { spawn } = await launch();
    await turn(spawn, 't1');
    await stop(spawn, 't1');
    expect(relocations).toEqual([]);
    expect(spawns).toHaveLength(1);
  });
});

describe('complete (OpenCode)', () => {
  async function inWorktree() {
    const first = await scheduledCreate();
    await stop(first.spawn, 't1');
    const spawn = lastSpawn();
    await turn(spawn, 't2');
    log.length = 0; relocations.length = 0;
    return { spawn, tree: treeContext()! };
  }

  it('relocates back to main and resumes there BEFORE the worktree is removed or the branch deleted', async () => {
    const { spawn, tree } = await inWorktree();
    expect((await call(spawn, 'clanker_complete_isolated_checkout', { deleteBranch: true })).data).toMatchObject({ status: 'scheduled' });
    expect(fs.existsSync(tree.path)).toBe(true);
    expect(relocations).toEqual([]);
    await stop(spawn, 't2');
    const replacement = lastSpawn();
    const order = [`dispose ${spawn.id}`, 'relocate main', log.find((line) => line.startsWith(`spawn ${replacement.id}`))!, 'removeWorktree', 'deleteBranch feature'];
    const positions = order.map((entry) => log.indexOf(entry));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(effectiveCwd.get(SESSION)).toBe(appPath);
    expect(fs.existsSync(tree.path)).toBe(false);
    expect((await call(replacement, 'clanker_context')).data).toMatchObject({ checkout: { kind: 'main', isolated: false } });
  });

  it('never removes anything when the relocation back is refused, and puts the conversation back in the checkout', async () => {
    const { spawn, tree } = await inWorktree();
    await call(spawn, 'clanker_complete_isolated_checkout', { deleteBranch: true });
    relocateBehavior = (request) => { if (request.directory === appPath) throw new Error('refused'); };
    await stop(spawn, 't2');
    expect(relocations.map((request) => where(request.directory))).toEqual(['main', 'feature']);
    expect(effectiveCwd.get(SESSION)).toBe(tree.path);
    expect(removedPaths).toEqual([]);
    expect(deletedBranches).toEqual([]);
    expect(log).not.toContain('removeWorktree');
    expect(contexts.some((context) => context.kind === 'worktree')).toBe(true);
  });
});

describe('the source must REALLY exit before the replacement exists (OpenCode)', () => {
  async function scheduledCreate() {
    const { id, spawn } = await launch();
    await turn(spawn, 't1');
    await call(spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
    return { id, spawn };
  }
  const spawnedAfterSource = (id: string) => spawns.filter((entry) => entry.id !== id).length;

  it('kill() only requests the exit: nothing is spawned until the process\' own exit event, then the replacement starts', async () => {
    killMode = 'manual';
    const { id, spawn } = await scheduledCreate();
    void stop(spawn, 't1'); // do not await: the move is parked on the exit
    await settle();

    expect(log).toContain(`kill ${id}`); // termination was requested...
    expect(terminals.has(id)).toBe(false); // ...and the record is gone from the table (which proves nothing)
    expect(spawnedAfterSource(id)).toBe(0); // so no replacement exists
    expect(log.some((line) => line.startsWith('spawn') && line.includes(id) === false)).toBe(false);
    expect(bridge.credentials.resolve(tokenOf(spawn))).toBeNull(); // authority was revoked up front

    processExits.get(id)!(); // the delayed REAL exit
    await settle();
    const replacement = lastSpawn();
    expect(replacement.id).not.toBe(id);
    const exitAt = log.indexOf(`exit ${id}`);
    expect(exitAt).toBeGreaterThanOrEqual(0);
    expect(exitAt).toBeLessThan(spawnLine(replacement.id));
    expect(live()).toEqual([replacement.id]);
  });

  it('a source that ignores the graceful kill is force-killed, and only its exit lets the replacement start', async () => {
    killMode = 'ignores-sigterm';
    const { id, spawn } = await scheduledCreate();
    await stop(spawn, 't1');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(log).toContain(`kill ${id} SIGKILL`);
    const replacement = lastSpawn();
    expect(replacement.id).not.toBe(id);
    expect(log.indexOf(`exit ${id}`)).toBeLessThan(spawnLine(replacement.id));
  });

  it('a source that never exits stops the move: nothing is resumed, relocated, removed or deleted, and the user is told', async () => {
    killMode = 'manual';
    const { id, spawn } = await scheduledCreate();
    await stop(spawn, 't1');
    await new Promise((resolve) => setTimeout(resolve, 700)); // graceful + forced waits
    expect(spawnedAfterSource(id)).toBe(0);
    expect(log.filter((line) => line.startsWith('spawn'))).toHaveLength(1);
    expect(relocations).toEqual([]);
    expect(removedPaths).toEqual([]);
    expect(deletedBranches).toEqual([]);
    expect(fs.existsSync(generated('feature'))).toBe(true);
    expect((events.filter((event) => event.kind === 'notice').pop() as { tone: string; message: string })).toMatchObject({ tone: 'warning', message: expect.stringMatching(/could not be confirmed stopped/) });
  });
});

describe('a cancelled or timed-out create never schedules a move (OpenCode)', () => {
  it('git creation finishes AFTER the request was aborted: the checkout is kept and listed, no move is pending, a later turn end moves nothing', async () => {
    const { id, spawn } = await launch();
    await turn(spawn, 't1');
    let release!: () => void;
    createGate = new Promise<void>((resolve) => { release = resolve; });
    const abort = new AbortController();
    const grant = bridge.credentials.resolve(tokenOf(spawn))!;
    const pendingCall = bridge.callTool(grant, 'clanker_create_isolated_checkout', { branch: 'feature' }, abort.signal);
    await settle();
    abort.abort(); // the MCP client gave up / the tool timed out while git was still working
    release(); // ...and Git then succeeds
    const result = await pendingCall;
    createGate = null;

    expect(result.isError).toBe(true);
    expect((result.data as { error: string }).error).toMatch(/was kept/);
    expect((result.data as { error: string }).error).not.toMatch(/nothing changed/i);
    // The checkout exists, is attached and visible...
    expect(fs.existsSync(generated('feature'))).toBe(true);
    expect(contexts.some((context) => context.kind === 'worktree')).toBe(true);
    expect(kinds()).toContain('checkout-attached');
    // ...the user was told accurately...
    const notice = events.filter((event) => event.kind === 'notice').pop() as { tone: string; message: string };
    expect(notice).toMatchObject({ tone: 'warning', message: expect.stringMatching(/kept.*not moved/) });
    // ...and no move survives: the next native turn end does nothing.
    await stop(spawn, 't1');
    await settle();
    expect(spawns).toHaveLength(1);
    expect(live()).toEqual([id]);
    expect(terminals.has(id)).toBe(true);
    expect(log.some((line) => line.startsWith('kill'))).toBe(false);
    expect(relocations).toEqual([]);
    expect(kinds()).not.toContain('terminal-replaced');
    expect(removedPaths).toEqual([]);
    expect(bridge.credentials.resolve(tokenOf(spawn))).not.toBeNull(); // the source conversation is untouched
  });

  it('an abort that arrives before git creation starts creates nothing at all', async () => {
    const { spawn } = await launch();
    await turn(spawn, 't1');
    const abort = new AbortController();
    abort.abort();
    const result = await bridge.callTool(bridge.credentials.resolve(tokenOf(spawn))!, 'clanker_create_isolated_checkout', { branch: 'feature' }, abort.signal);
    expect(result.isError).toBe(true);
    expect(fs.existsSync(generated('feature'))).toBe(false);
    await stop(spawn, 't1');
    expect(spawns).toHaveLength(1);
  });
});

describe('a relocation server that cannot be proven dead (OpenCode)', () => {
  it('CREATE: nothing is resumed, not even the recovery; nothing is removed or deleted; the user is told', async () => {
    const first = await launch();
    await turn(first.spawn, 't1');
    await call(first.spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
    relocateBehavior = () => { throw new UnverifiedProcessExitError('The OpenCode relocation server could not be confirmed stopped'); };
    await stop(first.spawn, 't1');
    await settle();

    expect(spawns).toHaveLength(1); // the source only: no target resume, no recovery resume
    expect(relocations).toHaveLength(1); // and no second relocation attempt either
    expect(removedPaths).toEqual([]);
    expect(deletedBranches).toEqual([]);
    expect(fs.existsSync(generated('feature'))).toBe(true);
    expect(live()).toEqual([]); // the source was retired; the history is intact for a manual resume
    expect((events.filter((event) => event.kind === 'notice').pop() as { tone: string; message: string })).toMatchObject({ tone: 'warning', message: expect.stringMatching(/could not be resumed automatically.*history is intact/s) });
  });

  it('COMPLETE: the worktree and branch are kept and nothing is resumed', async () => {
    const first = await launch();
    await turn(first.spawn, 't1');
    await call(first.spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
    await stop(first.spawn, 't1');
    const spawn = lastSpawn();
    await turn(spawn, 't2');
    await call(spawn, 'clanker_complete_isolated_checkout', { deleteBranch: true });
    const before = spawns.length;
    relocateBehavior = () => { throw new UnverifiedProcessExitError(); };
    await stop(spawn, 't2');
    await settle();

    expect(spawns).toHaveLength(before);
    expect(removedPaths).toEqual([]);
    expect(deletedBranches).toEqual([]);
    expect(fs.existsSync(generated('feature'))).toBe(true);
    expect(contexts.some((context) => context.kind === 'worktree')).toBe(true);
  });
});
