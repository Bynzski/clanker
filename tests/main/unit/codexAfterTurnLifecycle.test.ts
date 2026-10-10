/**
 * Codex re-homing, end to end: an `after-turn` move.
 *
 * What was measured with Codex 0.160.0 (see src/main/harnesses/codex/rehome.ts) and is modelled here:
 * a shared daemon owns the thread. A second `codex resume <id> --cd <other>` while the thread is still
 * owned (a TUI attached, or a turn still running) does not fail: it silently attaches to the live thread
 * in its OLD directory. After the turn completed and the TUI is gone, `--cd` is honored.
 *
 * Real here: the AgentAttentionBroker (fed hook-style frames over loopback), the bridge and its
 * credentials, the lifecycle service, the SPAWN_TERMINAL / SESSION_INVOKE launches, retirement and the
 * release rule. Faked: the PTY (including that daemon behavior), Git and the renderer channel.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import type { AgentCheckoutTransitionEvent } from '../../../src/shared/types/checkoutTransition';
import { SESSION_INVOKE, SPAWN_TERMINAL } from '../../../src/shared/ipcChannels';
import { removeAttentionAdapterFiles } from '../../../src/main/agentAttentionAdapters';
import { worktreeDirectoryName } from '../../../src/main/worktreePaths';
import { toPosixPath } from '../../../src/shared/pathNormalize';
import { testHarnessWrapper } from '../../_helpers/tempPaths';
import { successfulSessionDiscovery } from '../../_helpers/sessionDiscovery';

const { mockHandle, mockSpawnPty, mockDiscover, mockBuildArgs } = vi.hoisted(() => ({
  mockHandle: vi.fn(), mockSpawnPty: vi.fn(), mockDiscover: vi.fn(), mockBuildArgs: vi.fn(),
}));
vi.mock('electron', () => ({ ipcMain: { handle: mockHandle, on: vi.fn() }, BrowserWindow: vi.fn(), clipboard: { writeText: vi.fn() }, shell: { openExternal: vi.fn() } }));
vi.mock('../../../src/main/ipc/ptySpawn', () => ({ spawnPtyProcess: mockSpawnPty, waitForTerminalCleanup: vi.fn() }));
vi.mock('../../../src/main/platformShell', async (importOriginal) => ({ ...(await importOriginal<object>()), defaultShell: () => 'shell' }));
vi.mock('../../../src/main/sessionHistory', async (importOriginal) => ({
  ...(await importOriginal<object>()), discoverSessions: mockDiscover, buildSessionLaunch: mockBuildArgs,
  discoverSessionsDetailed: async (...args: unknown[]) => successfulSessionDiscovery(await mockDiscover(...args)),
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
let ignoredOnly: boolean;
/** The directory the thread ACTUALLY runs in, as the daemon would have it. */
let effectiveCwd: Map<string, string>;
let spawnBehavior: (options: Spawned, attempt: number) => 'ok' | { fail: string };
let resumeAttempts: number;
/** When set, Git worktree creation waits for it (a creation that outlives the tool call's timeout). */
let createGate: Promise<void> | null;
/** How a killed process behaves: exits at once, only on SIGKILL, or only when the test lets it. */
let killMode: 'prompt' | 'manual' | 'ignores-sigterm';
const processExits = new Map<string, () => void>();
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<Record<string, unknown>>>();
const removedPaths: string[] = [];
const deletedBranches: string[] = [];

const MAIN = (): CheckoutContext => ({ id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: toPosixPath(appPath), kind: 'main' });
const live = () => [...terminals.keys()];
const lastSpawn = () => spawns[spawns.length - 1];
const tokenOf = (spawn: Spawned) => spawn.env[AGENT_BRIDGE_TOKEN_ENV];
const argv = (spawn: Spawned) => (Array.isArray(spawn.spawnArgs) ? spawn.spawnArgs : [spawn.spawnArgs]);

beforeEach(async () => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-after-turn-')));
  appPath = path.join(root, 'app');
  fs.mkdirSync(appPath, { recursive: true });
  terminals = new Map(); contexts = [MAIN()]; events = []; log = []; spawns = []; dirty = false; ignoredOnly = false; resumeAttempts = 0; killMode = 'prompt'; createGate = null; processExits.clear();
  effectiveCwd = new Map(); removedPaths.length = 0; deletedBranches.length = 0;
  listed = [{ path: appPath, branch: 'main', isMain: true }];
  spawnBehavior = () => 'ok';
  handlers.clear();
  mockHandle.mockReset().mockImplementation((channel: string, handler: never) => { handlers.set(channel, handler); });
  mockBuildArgs.mockReset().mockReturnValue({ command: 'codex', args: ['resume', SESSION] });
  // History records the conversation where the thread last ran.
  mockDiscover.mockReset().mockImplementation(async () => [{ id: SESSION, harness: 'codex', title: 't', cwd: toPosixPath(effectiveCwd.get(SESSION) ?? appPath), timestamp: 1 }]);
  mockSpawnPty.mockReset().mockImplementation((options: Spawned) => {
    spawns.push(options);
    const isResume = argv(options).includes('resume');
    if (isResume && spawns.length > 1) resumeAttempts += 1;
    // The daemon: if another terminal still owns the thread, a resume attaches to it in ITS directory.
    const owner = [...terminals.values()].find((terminal) => effectiveCwd.get(SESSION) === terminal.cwd && terminal.cwd !== options.cwd && spawns.length > 1);
    const cdIndex = argv(options).indexOf('--cd');
    const requested = cdIndex >= 0 ? argv(options)[cdIndex + 1] : options.cwd;
    log.push(`spawn ${options.id} cd=${requested === appPath ? 'main' : path.basename(requested)} sourceStillLive=${owner ? 'yes' : 'no'}`);
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
      effectiveCwd.set(SESSION, owner ? owner.cwd : requested);
      queueMicrotask(() => options.onOutput?.('tui'));
    } else {
      queueMicrotask(() => {
        options.onOutput?.(behavior.fail);
        setTimeout(() => { terminals.delete(options.id); void options.onExit(); }, 1);
      });
    }
    return { id: options.id, pid: 10 + spawns.length };
  });
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
  const defaults = { codex: { agentBridgeEnabled: true, attentionEnabled: true, flags: '' } };
  const store = { get: (key: string) => (key === 'harnessDefaults' ? defaults : false) } as never;
  const options = { codex: { name: 'codex', command: 'codex', args: [] as string[], icon: 'c' } };
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
    checkWorktreeClean: async (_ws: string, worktreePath: string) => ({ success: true, hasChanges: dirty || ignoredOnly, changes: ignoredOnly ? { tracked: { count: dirty ? 1 : 0, paths: [] }, untracked: { count: 0, paths: [] }, ignored: { count: 1, paths: ['node_modules/'] } } : undefined, worktree: { path: worktreePath, branch: 'x' } }),
    inspectWorktree: async (_ws: string, worktreePath: string) => {
      const entry = listed.find((candidate) => toPosixPath(candidate.path) === toPosixPath(worktreePath));
      return { success: true, hasChanges: ignoredOnly, changes: ignoredOnly ? { tracked: { count: 0, paths: [] }, untracked: { count: 0, paths: [] }, ignored: { count: 1, paths: ['node_modules/'] } } : undefined, worktree: { path: worktreePath, branch: entry?.branch ?? null, isMain: false, isLocked: false, isPrunable: false } };
    },
    removeWorktree: async (_ws: string, worktreePath: string, _branch: string | null, _paths: string[], options?: { discardIgnored?: boolean }) => {
      if (ignoredOnly) expect(options?.discardIgnored).toBe(true);
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
    isAttentionEnabled: () => true,
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
      socket.end(JSON.stringify({ version: 1, token: env.CLANKER_ATTENTION_TOKEN, harness: 'codex', event, scope: 'root', sessionId: SESSION, ...fields }));
    });
    socket.on('data', () => undefined);
    socket.on('close', () => resolve());
    socket.on('error', reject);
  });
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
async function turn(spawn: Spawned, turnId: string) { await frame(spawn, 'turn_started', { turnId }); await settle(); }

/** Transitions the service has in flight (a test-only look at its own bookkeeping). */
const inFlight = () => [...(lifecycle as unknown as { active: Map<string, Promise<unknown>> }).active.values()];
/**
 * After a native turn end: give the broker time to publish it, then wait for the move it may have started to
 * run to its end. Waiting on the service's own work (not a fixed delay) keeps this independent of machine speed.
 */
async function finishMove(): Promise<void> {
  const until = Date.now() + 400;
  while (inFlight().length === 0 && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 10));
  while (inFlight().length > 0) await Promise.allSettled(inFlight());
}
async function stop(spawn: Spawned, turnId: string, fields: Record<string, unknown> = {}) { await frame(spawn, 'turn_completed', { turnId, ...fields }); await settle(); await finishMove(); }

async function launch() {
  const result = await handlers.get(SPAWN_TERMINAL)!(null, toPosixPath(appPath), 'codex', undefined, undefined, undefined, 'ws', 'local') as { id: string };
  effectiveCwd.set(SESSION, appPath);
  return { id: result.id, spawn: lastSpawn() };
}
async function call(spawn: Spawned, name: string, args: Record<string, unknown> = {}) {
  const grant = bridge.credentials.resolve(tokenOf(spawn));
  if (!grant) return { revoked: true as const };
  const result = await bridge.callTool(grant, name, args);
  return { revoked: false as const, result, data: result.data as Record<string, unknown> };
}
const spawnLine = (id: string) => log.findIndex((line) => line.startsWith(`spawn ${id}`));
const treeContext = () => contexts.find((context) => context.kind === 'worktree');
const kinds = () => events.map((event) => event.kind);

describe('create (after-turn)', () => {
  it('native session end cancels the old scheduled request so a subsequent turn can schedule again', async () => {
    const { id, spawn } = await launch();
    await turn(spawn, 't1');
    await call(spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
    await frame(spawn, 'session_ended'); await settle();
    expect(JSON.stringify(events)).toContain('session ended or changed');
    expect(live()).toEqual([id]);
    await turn(spawn, 't2');
    expect((await call(spawn, 'clanker_create_isolated_checkout', { branch: 'feature' })).data).toMatchObject({ status: 'scheduled' });
    expect(kinds()).not.toContain('terminal-replaced');
  });

  it('cancels a scheduled move on provisional settlement and keeps the source and checkout', async () => {
    const { id, spawn } = await launch();
    await turn(spawn, 't1');
    expect((await call(spawn, 'clanker_create_isolated_checkout', { branch: 'feature' })).data).toMatchObject({ status: 'scheduled' });
    await frame(spawn, 'turn_provisional', { turnId: 't1' });
    await settle();
    expect(live()).toEqual([id]);
    expect(spawns).toHaveLength(1);
    expect(treeContext()).toBeDefined();
    expect(JSON.stringify(events)).toContain('without proving completion');
    const retry = await call(spawn, 'clanker_create_isolated_checkout', { branch: 'another' });
    expect(JSON.stringify(retry)).toContain('without a verified final outcome');
    // Continued same-turn work cannot revive the cancelled checkout transition.
    await frame(spawn, 'turn_activity', { turnId: 't1' });
    await frame(spawn, 'turn_provisional', { turnId: 't1' });
    await settle();
    expect(live()).toEqual([id]);
    expect(spawns).toHaveLength(1);
    expect(kinds()).not.toContain('terminal-replaced');
  });

  it('does not retire a source that begins a newer turn while post-completion history discovery is pending', async () => {
    const { id, spawn } = await launch();
    await turn(spawn, 't1');
    await call(spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
    let began!: () => void;
    let finish!: () => void;
    const discovering = new Promise<void>((resolve) => { began = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    mockDiscover.mockImplementationOnce(async () => {
      began(); await gate;
      return [{ id: SESSION, harness: 'codex', title: 't', cwd: toPosixPath(appPath), timestamp: 1 }];
    });
    await frame(spawn, 'turn_completed', { turnId: 't1' });
    await discovering;
    await turn(spawn, 't2');
    finish();
    await finishMove();
    expect(live()).toEqual([id]);
    expect(terminals.get(id)!.pty.kill).not.toHaveBeenCalled();
    expect(spawns).toHaveLength(1);
    expect(broker.snapshot(id)!.runtime).toMatchObject({ status: 'running', turnId: 't2' });
    expect((events.filter((event) => event.kind === 'notice').pop() as { message: string }).message).toContain('changed during discovery');
    expect(removedPaths).toEqual([]);
  });

  it('returns "scheduled" while the source is still fully alive: nothing is retired or resumed during the tool call', async () => {
    const { id, spawn } = await launch();
    await turn(spawn, 't1');
    const result = await call(spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });

    expect(result.data).toMatchObject({ status: 'scheduled' });
    expect((result.data as { message: string }).message).toMatch(/Finish your reply/);
    expect(live()).toEqual([id]); // the source is untouched
    expect(spawns).toHaveLength(1); // no replacement yet
    expect(log).not.toContain(`kill ${id}`);
    expect(bridge.credentials.resolve(tokenOf(spawn))).not.toBeNull(); // the source credential still works
    expect(kinds()).toEqual(['checkout-attached', 'notice']); // the checkout is visible; the pane is not handed over
    expect(kinds()).not.toContain('terminal-replaced');
  });

  it('moves only when the root turn completes: source retired COMPLETELY first, then the same thread resumed with an explicit --cd', async () => {
    const { id, spawn } = await launch();
    await turn(spawn, 't1');
    await call(spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
    await stop(spawn, 't1');

    const replacement = lastSpawn();
    expect(replacement.id).not.toBe(id);
    // Order: the source is gone before the replacement process exists.
    expect(log.indexOf(`dispose ${id}`)).toBeGreaterThanOrEqual(0);
    expect(log.indexOf(`kill ${id}`)).toBeLessThan(log.findIndex((line) => line.startsWith(`spawn ${replacement.id}`)));
    expect(log.indexOf(`dispose ${id}`)).toBeLessThan(log.findIndex((line) => line.startsWith(`spawn ${replacement.id}`)));
    // The replacement never saw a live owner, and the thread really runs in the worktree.
    expect(log.find((line) => line.startsWith(`spawn ${replacement.id}`))).toContain('sourceStillLive=no');
    expect(effectiveCwd.get(SESSION)).toBe(generated('feature'));
    // The target is explicit and main-derived.
    const args = argv(replacement);
    expect(args[args.indexOf('--cd') + 1]).toBe(generated('feature'));
    expect(args).toEqual(expect.arrayContaining(['resume', SESSION]));
    expect(args.indexOf('-c')).toBeLessThan(args.indexOf('resume')); // bridge overrides stay before the subcommand
    expect(live()).toEqual([replacement.id]);
    expect(kinds()).toEqual(['checkout-attached', 'notice', 'terminal-replaced', 'notice']);
  });

  it('credential rotation: the source credential dies with its retirement, the replacement gets a fresh one bound to the TARGET', async () => {
    const { id, spawn } = await launch();
    const sourceToken = tokenOf(spawn);
    await turn(spawn, 't1');
    await call(spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
    expect(bridge.credentials.resolve(sourceToken)).not.toBeNull();
    await stop(spawn, 't1');

    const replacement = lastSpawn();
    expect(bridge.credentials.resolve(sourceToken)).toBeNull();
    expect((await call(spawn, 'clanker_context')).revoked).toBe(true);
    expect(tokenOf(replacement)).not.toBe(sourceToken);
    expect(bridge.credentials.resolve(tokenOf(replacement))?.identity).toEqual({
      terminalId: replacement.id, workspaceId: 'ws', environmentId: 'local', checkoutContextId: treeContext()!.id, harnessId: 'codex',
    });
    expect(replacement.id).not.toBe(id);
    expect((await call(replacement, 'clanker_context')).data).toMatchObject({ checkout: { kind: 'worktree', isolated: true, branch: 'feature' } });
  });

  it('attention: the source authority ends before the replacement exists, and no two roots are ever live for the conversation', async () => {
    const { id, spawn } = await launch();
    await turn(spawn, 't1');
    expect(broker.snapshot(id)?.sessionId).toBe(SESSION);
    await call(spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
    await stop(spawn, 't1');

    expect(broker.snapshot(id)).toBeNull(); // the source registration was released (tombstoned)
    const replacement = lastSpawn();
    const registered = broker.snapshots().map((snapshot) => snapshot.terminalId);
    expect(registered).toEqual([replacement.id]); // exactly one authoritative root
    // The replacement binds the same native session on its first turn: the same logical conversation.
    await turn(replacement, 't2');
    expect(broker.snapshot(replacement.id)?.sessionId).toBe(SESSION);
    expect(broker.snapshots()).toHaveLength(1);
  });

  it('actual launch directory, terminal table, credential, clanker_context and renderer event all agree', async () => {
    const { spawn } = await launch();
    await turn(spawn, 't1');
    await call(spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
    await stop(spawn, 't1');

    const replacement = lastSpawn();
    const tree = treeContext()!;
    const replaced = events.find((event) => event.kind === 'terminal-replaced') as Extract<AgentCheckoutTransitionEvent, { kind: 'terminal-replaced' }>;
    expect(effectiveCwd.get(SESSION)).toBe(generated('feature')); // 1. where the thread really runs
    expect(terminals.get(replacement.id)?.checkoutContextId).toBe(tree.id); // 2. main's table
    expect(bridge.credentials.resolve(tokenOf(replacement))?.identity.checkoutContextId).toBe(tree.id); // 3. the credential
    expect((await call(replacement, 'clanker_context')).data).toMatchObject({ checkout: { branch: 'feature' } }); // 4. what the agent sees
    expect(replaced.terminal).toMatchObject({ id: replacement.id, checkoutContextId: tree.id, workingDir: tree.path }); // 5. what the renderer is told
  });

  it('Git reconciliation replacing a context object with an identical one (it runs at every turn end) does not cancel the move', async () => {
    const { spawn } = await launch();
    await turn(spawn, 't1');
    await call(spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
    // What reconciliation does after a turn: same identity values, a NEW object.
    contexts = contexts.map((context) => ({ ...context }));
    await stop(spawn, 't1');
    expect(kinds()).toContain('terminal-replaced');
    expect(effectiveCwd.get(SESSION)).toBe(generated('feature'));
    expect(events.filter((event) => event.kind === 'notice').some((event) => /cancelled/.test((event as { message: string }).message))).toBe(false);
  });

  it('a real change of the checkout during the turn (a different path under the same id) does cancel it, before the source is retired', async () => {
    const { spawn } = await launch();
    await turn(spawn, 't1');
    await call(spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
    contexts = contexts.map((context) => (context.kind === 'worktree' ? { ...context, path: toPosixPath(path.join(root, 'elsewhere')) } : context));
    await stop(spawn, 't1');
    expect(spawns).toHaveLength(1);
    expect(terminals.has(spawn.id)).toBe(true);
    expect((events.filter((event) => event.kind === 'notice').pop() as { message: string }).message).toMatch(/checkout changed/);
  });

  it('a repeated request does not duplicate the scheduled move, and a different kind is refused', async () => {
    const { spawn } = await launch();
    await turn(spawn, 't1');
    await call(spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
    const again = await call(spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
    expect(again.data).toMatchObject({ status: 'already-scheduled' });
    expect(contexts.filter((context) => context.kind === 'worktree')).toHaveLength(1);
    expect(log.filter((line) => line.startsWith('createWorktree'))).toHaveLength(1);

    const other = await call(spawn, 'clanker_complete_isolated_checkout', {});
    expect(other.result?.isError).toBe(true);
    await stop(spawn, 't1');
    expect(spawns.filter((entry) => argv(entry).includes('--cd'))).toHaveLength(1); // one move, once
  });
});

describe('what may and may not trigger the scheduled move', () => {
  async function scheduled() {
    const { id, spawn } = await launch();
    await turn(spawn, 't1');
    await call(spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
    return { id, spawn };
  }
  const noMove = () => { expect(spawns).toHaveLength(1); expect(log.some((line) => line.startsWith('kill'))).toBe(false); };

  it('a CHILD (subagent) Stop never moves it', async () => {
    const { spawn } = await scheduled();
    await stop(spawn, 't1', { scope: 'child' });
    noMove();
    await stop(spawn, 't1'); // the root's own completion does
    expect(spawns).toHaveLength(2);
  });

  it('a Stop for a different native session never moves it', async () => {
    const { spawn } = await scheduled();
    await stop(spawn, 't9', { sessionId: 'some-other-session' });
    noMove();
  });

  it('a completion recorded BEFORE the request does not trigger it (only a later root completion does)', async () => {
    const { spawn } = await launch();
    await turn(spawn, 't0'); await stop(spawn, 't0'); // an earlier turn finished
    await turn(spawn, 't1');
    await call(spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
    expect(spawns).toHaveLength(1);
    await stop(spawn, 't1');
    expect(spawns).toHaveLength(2);
  });

  it('an earlier completion does not trigger on an unrelated change: an approval request after scheduling carries the OLD completion and must not move anything', async () => {
    const { spawn } = await launch();
    await turn(spawn, 't0'); await stop(spawn, 't0'); // a finished turn is on record
    await turn(spawn, 't1');
    await call(spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
    // The same turn now asks for approval, then gets it: snapshots change, but no NEW root turn completed.
    await frame(spawn, 'input_requested', { turnId: 't1', inputId: 'i1', requestKind: 'approval' }); await settle();
    await frame(spawn, 'input_resolved', { turnId: 't1', inputId: 'i1' }); await settle();
    expect(broker.snapshot(spawn.id)?.lastOutcome?.kind).toBe('completed'); // the stale completion is still the latest outcome
    noMove();
    await stop(spawn, 't1');
    expect(spawns).toHaveLength(2);
  });

  it('the service\'s own guard: a change for another native session never triggers, whatever it carries', async () => {
    const { id, spawn } = await scheduled();
    const snapshot = broker.snapshot(id)!;
    lifecycle.onAttentionChange({ terminalId: id, revision: snapshot.revision + 1, snapshot: {
      ...snapshot, sessionId: 'a-different-session', lastOutcome: { kind: 'completed', turnId: 'x', revision: snapshot.revision + 1, at: 0 },
    } });
    await settle();
    noMove();
    lifecycle.onAttentionChange({ terminalId: id, revision: snapshot.revision + 2, snapshot: { ...snapshot, sessionId: null, lastOutcome: { kind: 'completed', turnId: 'x', revision: snapshot.revision + 2, at: 0 } } });
    await settle();
    noMove();
    await stop(spawn, 't1'); // the real completion of the real session
    expect(spawns).toHaveLength(2);
  });

  it('an unrelated terminal\'s Stop never moves it', async () => {
    const { spawn } = await scheduled();
    // A second, unrelated Codex terminal in the same workspace completes a turn.
    const other = await handlers.get(SPAWN_TERMINAL)!(null, toPosixPath(appPath), 'codex', undefined, undefined, undefined, 'ws', 'local') as { id: string };
    const otherSpawn = spawns.find((entry) => entry.id === other.id)!;
    await frame(otherSpawn, 'turn_started', { sessionId: 'unrelated', turnId: 'x' }); await settle();
    await frame(otherSpawn, 'turn_completed', { sessionId: 'unrelated', turnId: 'x' }); await settle();
    expect(spawns.filter((entry) => argv(entry).includes('--cd'))).toHaveLength(0);
    expect(terminals.has(spawn.id)).toBe(true);
  });

  it('an Interrupt CANCELS the pending move: nothing moves, the user is told, and a later Stop does not resurrect it', async () => {
    const { spawn } = await scheduled();
    await frame(spawn, 'turn_interrupted', { turnId: 't1' }); await settle();
    noMove();
    expect(events.filter((event) => event.kind === 'notice').pop()).toMatchObject({ tone: 'warning' });
    expect((events.filter((event) => event.kind === 'notice').pop() as { message: string }).message).toMatch(/interrupted/);
    await turn(spawn, 't2'); await stop(spawn, 't2');
    noMove();
    // The checkout the create made was kept and stays visible.
    expect(fs.existsSync(generated('feature'))).toBe(true);
    expect(kinds()).toContain('checkout-attached');
  });

  it('a failed turn cancels it too', async () => {
    const { spawn } = await scheduled();
    await frame(spawn, 'turn_failed', { turnId: 't1' }); await settle();
    noMove();
    expect((events.filter((event) => event.kind === 'notice').pop() as { message: string }).message).toMatch(/failed/);
  });

  it('the session ending cancels it', async () => {
    const { spawn } = await scheduled();
    await frame(spawn, 'session_ended', {}); await settle();
    noMove();
  });

  it('the source terminal exiting unexpectedly drops it safely (nothing to move, nothing resumed)', async () => {
    const { id, spawn } = await scheduled();
    await retireTerminal({ terminals: terminals as never, releaseAttention: (terminalId) => broker.release(terminalId) }, id);
    await settle();
    expect(spawns).toHaveLength(1);
    expect(events.filter((event) => event.kind === 'notice').pop()).toMatchObject({ tone: 'warning' });
    // A late hook frame from the dead terminal changes nothing.
    await frame(spawn, 'turn_completed', { turnId: 't1' }).catch(() => undefined); await settle();
    expect(spawns).toHaveLength(1);
  });
});

describe('complete (after-turn)', () => {
  async function inWorktree() {
    const first = await launch();
    await turn(first.spawn, 't1');
    await call(first.spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
    await stop(first.spawn, 't1');
    const spawn = lastSpawn();
    await turn(spawn, 't2');
    log.length = 0;
    return { spawn, tree: treeContext()! };
  }

  it('schedules; at the root Stop retires the source, resumes the same thread in main, and only THEN removes the worktree and deletes the branch', async () => {
    const { spawn, tree } = await inWorktree();
    const done = await call(spawn, 'clanker_complete_isolated_checkout', { deleteBranch: true });
    expect(done.data).toMatchObject({ status: 'scheduled' });
    expect(fs.existsSync(tree.path)).toBe(true); // nothing removed during the tool call
    expect(log.filter((line) => /^(kill|dispose|spawn|removeWorktree|deleteBranch)/.test(line))).toEqual([]); // nor retired, nor resumed
    await stop(spawn, 't2');

    const replacement = lastSpawn();
    const order = [`dispose ${spawn.id}`, `kill ${spawn.id}`, log.find((line) => line.startsWith(`spawn ${replacement.id}`))!, 'notify terminal-replaced', 'removeWorktree', 'deleteBranch feature'];
    const positions = order.map((entry) => log.indexOf(entry));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(log.find((line) => line.startsWith(`spawn ${replacement.id}`))).toContain('cd=main');
    expect(argv(replacement)[argv(replacement).indexOf('--cd') + 1]).toBe(appPath);
    expect(effectiveCwd.get(SESSION)).toBe(appPath);
    expect(fs.existsSync(tree.path)).toBe(false);
    expect(contexts.map((context) => context.id)).toEqual(['ws::main']);
    expect((await call(replacement, 'clanker_context')).data).toMatchObject({ checkout: { kind: 'main', isolated: false } });
    expect(bridge.credentials.resolve(tokenOf(spawn))).toBeNull();
    expect(kinds().slice(-3)).toEqual(['terminal-replaced', 'checkout-released', 'notice']);
  });

  it('carries ignored-only opt-in through the scheduled move and cleanup', async () => {
    const { spawn, tree } = await inWorktree();
    ignoredOnly = true;
    expect((await call(spawn, 'clanker_complete_isolated_checkout', {})).data).toMatchObject({ reason: 'ignored-only' });
    expect((await call(spawn, 'clanker_complete_isolated_checkout', { deleteBranch: true, discardIgnored: true })).data).toMatchObject({ status: 'scheduled' });
    await stop(spawn, 't2');
    expect(effectiveCwd.get(SESSION)).toBe(appPath);
    expect(removedPaths).toContain(tree.path);
    expect(deletedBranches).toEqual(['feature']);
  });

  it('keeps a checkout safe while identity is lost and completes after an authoritative resume start restores it', async () => {
    const { spawn, tree } = await inWorktree();
    await frame(spawn, 'session_ended');
    expect(broker.snapshot(spawn.id)?.sessionId).toBeNull();
    for (let retry = 0; retry < 2; retry++) {
      const refused = await call(spawn, 'clanker_complete_isolated_checkout', { deleteBranch: true });
      expect(refused.result?.isError).toBe(true);
      expect(refused.data).toMatchObject({ error: expect.stringMatching(/binding.*cleared/) });
    }
    expect(live()).toEqual([spawn.id]);
    expect(fs.existsSync(tree.path)).toBe(true);
    expect(removedPaths).toEqual([]);
    expect(deletedBranches).toEqual([]);
    await frame(spawn, 'session_started', { nativeEvent: 'SessionStart', cwd: tree.path });
    expect(broker.snapshot(spawn.id)?.sessionId).toBe(SESSION);
    expect(broker.handoffState(spawn.id)).toBe('unverified');
    await turn(spawn, 'recovered');
    expect((await call(spawn, 'clanker_complete_isolated_checkout', { deleteBranch: true })).data).toMatchObject({ status: 'scheduled' });
    await stop(spawn, 'recovered');
    expect(live()).toEqual([lastSpawn().id]);
    expect(effectiveCwd.get(SESSION)).toBe(appPath);
    expect(removedPaths).toEqual([tree.path]);
    expect(deletedBranches).toEqual(['feature']);
  });

  it('a worktree that became dirty during the turn cancels the move before the source is retired', async () => {
    const { spawn, tree } = await inWorktree();
    await call(spawn, 'clanker_complete_isolated_checkout', { deleteBranch: true });
    dirty = true; // the agent edited something after calling the tool, in the same turn
    await stop(spawn, 't2');

    expect(spawns).toHaveLength(2); // nothing new was launched (create's replacement + the original)
    expect(terminals.has(spawn.id)).toBe(true);
    expect(log.some((line) => line.startsWith('kill'))).toBe(false);
    expect(fs.existsSync(tree.path)).toBe(true);
    expect(removedPaths).toEqual([]);
    expect((events.filter((event) => event.kind === 'notice').pop() as { message: string }).message).toMatch(/cancelled/);
  });
});

describe('writer ownership and recovery', () => {
  async function scheduledCreate() {
    const { id, spawn } = await launch();
    await turn(spawn, 't1');
    await call(spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
    return { id, spawn };
  }

  it('NEVER attempts the resume while the source still owns the thread (the daemon would silently attach in the old directory)', async () => {
    const { spawn } = await scheduledCreate();
    // While the tool call is merely accepted, no resume may have been attempted at all.
    expect(spawns).toHaveLength(1);
    await stop(spawn, 't1');
    for (const entry of spawns.slice(1)) {
      expect(log.find((line) => line.startsWith(`spawn ${entry.id}`))).toContain('sourceStillLive=no');
    }
    expect(effectiveCwd.get(SESSION)).toBe(generated('feature')); // had it attached to a live owner this would be main
  });

  it('retries ONLY the provider-recognized writer contention, a bounded number of times', async () => {
    const { spawn } = await scheduledCreate();
    spawnBehavior = (_options, attempt) => (attempt <= 2 ? { fail: 'Error: failed to acquire thread writer lock for 01a10b90' } : 'ok');
    await stop(spawn, 't1');

    expect(resumeAttempts).toBe(3);
    expect(kinds()).toContain('terminal-replaced');
    expect(effectiveCwd.get(SESSION)).toBe(generated('feature'));
    expect(live()).toHaveLength(1); // the failed attempts were retired
  });

  it('does not retry a failure it does not recognize', async () => {
    const { spawn } = await scheduledCreate();
    spawnBehavior = (options) => (argv(options).includes('feature') || argv(options).includes('--cd') && argv(options)[argv(options).indexOf('--cd') + 1] === generated('feature') ? { fail: 'Error: something else entirely' } : 'ok');
    await stop(spawn, 't1');
    // One failed attempt at the target (no retry), then the recovery resume in the original checkout.
    const targetAttempts = spawns.filter((entry) => argv(entry).includes('--cd') && argv(entry)[argv(entry).indexOf('--cd') + 1] === generated('feature'));
    expect(targetAttempts).toHaveLength(1);
  });

  it('bounds the retries: persistent contention gives up after the provider\'s attempts and recovers instead of looping', async () => {
    const { spawn } = await scheduledCreate();
    spawnBehavior = (options) => (argv(options)[argv(options).indexOf('--cd') + 1] === generated('feature') ? { fail: 'failed to acquire thread writer lock' } : 'ok');
    await stop(spawn, 't1');
    const targetAttempts = spawns.filter((entry) => argv(entry)[argv(entry).indexOf('--cd') + 1] === generated('feature'));
    expect(targetAttempts).toHaveLength(3);
  });

  it('CREATE recovery: when the target resume fails, the same thread is resumed back in the original checkout and nothing is deleted', async () => {
    const { id, spawn } = await scheduledCreate();
    spawnBehavior = (options) => (argv(options)[argv(options).indexOf('--cd') + 1] === generated('feature') ? { fail: 'No conversation found' } : 'ok');
    await stop(spawn, 't1');

    const recovered = lastSpawn();
    expect(argv(recovered)[argv(recovered).indexOf('--cd') + 1]).toBe(appPath);
    expect(effectiveCwd.get(SESSION)).toBe(appPath);
    expect(live()).toEqual([recovered.id]);
    expect(terminals.has(id)).toBe(false);
    expect(kinds()).toContain('terminal-replaced'); // the pane adopts the restored conversation
    expect((events.filter((event) => event.kind === 'notice').pop() as { message: string; tone: string })).toMatchObject({ tone: 'warning' });
    // The checkout the create made is kept, attached and visible; nothing was removed or released.
    expect(fs.existsSync(generated('feature'))).toBe(true);
    expect(contexts.some((context) => context.kind === 'worktree')).toBe(true);
    expect(removedPaths).toEqual([]);
    expect(deletedBranches).toEqual([]);
  });

  it('COMPLETE recovery: the same thread is resumed back in the isolated checkout, which is NOT removed', async () => {
    const first = await launch();
    await turn(first.spawn, 't1');
    await call(first.spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
    await stop(first.spawn, 't1');
    const spawn = lastSpawn();
    await turn(spawn, 't2');
    await call(spawn, 'clanker_complete_isolated_checkout', { deleteBranch: true });
    spawnBehavior = (options) => (argv(options)[argv(options).indexOf('--cd') + 1] === appPath ? { fail: 'No conversation found' } : 'ok');
    log.length = 0;
    await stop(spawn, 't2');

    const recovered = lastSpawn();
    expect(argv(recovered)[argv(recovered).indexOf('--cd') + 1]).toBe(generated('feature'));
    expect(effectiveCwd.get(SESSION)).toBe(generated('feature'));
    expect(fs.existsSync(generated('feature'))).toBe(true);
    expect(removedPaths).toEqual([]);
    expect(deletedBranches).toEqual([]);
    expect(contexts.some((context) => context.kind === 'worktree')).toBe(true);
    expect(log).not.toContain('removeWorktree');
  });

  it('when the target AND the recovery both fail: nothing is removed or deleted, success is never claimed, and the user is warned strongly', async () => {
    const first = await launch();
    await turn(first.spawn, 't1');
    await call(first.spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
    await stop(first.spawn, 't1');
    const spawn = lastSpawn();
    await turn(spawn, 't2');
    await call(spawn, 'clanker_complete_isolated_checkout', { deleteBranch: true });
    spawnBehavior = () => ({ fail: 'Error: cannot resume' });
    log.length = 0;
    events.length = 0;
    await stop(spawn, 't2');

    expect(removedPaths).toEqual([]);
    expect(deletedBranches).toEqual([]);
    expect(fs.existsSync(generated('feature'))).toBe(true);
    expect(contexts.some((context) => context.kind === 'worktree')).toBe(true); // the checkout stays registered and visible
    expect(kinds()).not.toContain('checkout-released');
    expect(kinds()).not.toContain('terminal-replaced');
    const notice = events.filter((event) => event.kind === 'notice').pop() as { message: string; tone: string };
    expect(notice.tone).toBe('warning');
    expect(notice.message).toMatch(/could not be resumed automatically/);
    expect(notice.message).toMatch(/Nothing was removed or deleted/);
    expect(notice.message).not.toMatch(/Completed|Moved this conversation/);
  });

  it('create with target AND recovery failing keeps the new worktree attached and visible', async () => {
    const { spawn } = await scheduledCreate();
    spawnBehavior = () => ({ fail: 'Error: cannot resume' });
    await stop(spawn, 't1');
    expect(fs.existsSync(generated('feature'))).toBe(true);
    expect(contexts.some((context) => context.kind === 'worktree')).toBe(true);
    expect(removedPaths).toEqual([]);
    expect(kinds()).toContain('checkout-attached');
    expect(kinds()).not.toContain('terminal-replaced');
  });
});

describe('the explicit target directory', () => {
  it('replaces any directory option the user put in their Codex flags: the target is Clanker\'s, from the checkout context', async () => {
    const { spawn } = await (async () => {
      const result = await launch();
      return result;
    })();
    await turn(spawn, 't1');
    // The user's default flags try to pin a directory.
    mockBuildArgs.mockReturnValue({ command: 'codex', args: ['resume', SESSION, '-C', '/somewhere/else', '--cd=/also/else', '-C/third'] });
    await call(spawn, 'clanker_create_isolated_checkout', { branch: 'feature' });
    await stop(spawn, 't1');

    const args = argv(lastSpawn());
    expect(args.filter((arg) => arg === '--cd')).toHaveLength(1);
    expect(args[args.indexOf('--cd') + 1]).toBe(generated('feature'));
    expect(args).not.toContain('-C');
    expect(args.join(' ')).not.toMatch(/somewhere\/else|also\/else|third/);
  });

  it('an ordinary history resume keeps exactly the arguments it always had (no --cd): only Clanker re-homing forces a target', async () => {
    await handlers.get(SESSION_INVOKE)!(null, 'ws', { id: SESSION, harness: 'codex', title: 't', cwd: toPosixPath(appPath), timestamp: 1 }, false);
    const args = argv(lastSpawn());
    expect(args).toEqual(expect.arrayContaining(['resume', SESSION]));
    expect(args).not.toContain('--cd');
    expect(args).not.toContain('-C');
  });
});

describe('the source must REALLY exit before the replacement exists (Codex)', () => {
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

    expect(removedPaths).toEqual([]);
    expect(deletedBranches).toEqual([]);
    expect(fs.existsSync(generated('feature'))).toBe(true);
    expect((events.filter((event) => event.kind === 'notice').pop() as { tone: string; message: string })).toMatchObject({ tone: 'warning', message: expect.stringMatching(/could not be confirmed stopped/) });
  });
});

describe('a cancelled or timed-out create never schedules a move (Codex)', () => {
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
