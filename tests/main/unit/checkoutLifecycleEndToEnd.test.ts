/**
 * Regression for the smoke-test split-brain, at the seam where it happened.
 *
 * Before: a conversation could end up with Clanker's authenticated checkout identity pointing at a
 * removed worktree while the agent really ran elsewhere and the status bar said something else.
 * Here the REAL pieces are wired together (the bridge and its credentials, the lifecycle service, the
 * SPAWN_TERMINAL / SESSION_INVOKE launch paths, retirement and the checkout release rule); only the PTY,
 * Git and the attention broker are doubled. After every transition four independent views must agree:
 *   1. main's terminal table            (which process runs in which checkout)
 *   2. the bridge credential            (which checkout the authenticated caller is bound to)
 *   3. `clanker_context` as the agent sees it
 *   4. what the renderer is told        (the events its store applies)
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
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
import { AgentBridgeService, AGENT_BRIDGE_TOKEN_ENV } from '../../../src/main/agentBridge/service';
import { DEFAULT_AGENT_BRIDGE_CAPABILITIES } from '../../../src/main/agentBridge/capabilities';
import { createCheckoutLifecycleCapabilities, deferredLifecyclePort } from '../../../src/main/agentBridge/lifecycleCapabilities';
import { IsolatedCheckoutService } from '../../../src/main/isolatedCheckout/isolatedCheckoutService';
import { releaseCheckoutContext } from '../../../src/main/checkoutContextRelease';
import { retireTerminal } from '../../../src/main/terminalRetirement';

let root: string;
let appPath: string;
const generated = (branch: string) => path.join(`${appPath}-worktrees`, worktreeDirectoryName(branch));
afterAll(() => removeAttentionAdapterFiles());

interface Spawned { id: string; cwd: string; env: Record<string, string>; checkoutContextId?: string; workspaceId?: string; harnessId?: string; onExit: () => unknown; onOutput?: (d: string) => void }

let terminals: Map<string, Record<string, unknown>>;
let contexts: CheckoutContext[];
let listedWorktrees: Array<{ path: string; branch: string | null; isMain: boolean }>;
let recordedCwd: string;
let events: AgentCheckoutTransitionEvent[];
let log: string[];
let spawns: Spawned[];
let bridge: AgentBridgeService;
let removed: string[];
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<Record<string, unknown>>>();

const MAIN = (): CheckoutContext => ({ id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: toPosixPath(appPath), kind: 'main' });
const grants = () => spawns[spawns.length - 1].env[AGENT_BRIDGE_TOKEN_ENV];

beforeEach(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-e2e-')));
  appPath = path.join(root, 'app');
  fs.mkdirSync(appPath, { recursive: true });
  terminals = new Map(); contexts = [MAIN()]; events = []; log = []; spawns = []; removed = [];
  listedWorktrees = [{ path: appPath, branch: 'main', isMain: true }];
  recordedCwd = appPath;
  handlers.clear();
  mockHandle.mockReset().mockImplementation((channel: string, handler: never) => { handlers.set(channel, handler); });
  mockBuildArgs.mockReset().mockReturnValue({ command: 'claude', args: ['resume', 'native-1'] });
  // History records the conversation where it last ran, like the harness does.
  mockDiscover.mockReset().mockImplementation(async () => [{ id: 'native-1', harness: 'claude', title: 't', cwd: toPosixPath(recordedCwd), timestamp: 1 }]);
  mockSpawnPty.mockReset().mockImplementation((options: Spawned) => {
    spawns.push(options);
    recordedCwd = options.cwd;
    const terminal: Record<string, unknown> = {
      workspaceId: options.workspaceId, checkoutContextId: options.checkoutContextId, harnessId: options.harnessId, cwd: options.cwd,
      pty: { kill: vi.fn(() => { log.push(`kill ${options.id}`); }) },
      releaseResources: vi.fn(async () => { log.push(`dispose ${options.id}`); await options.onExit(); }),
    };
    terminals.set(options.id, terminal);
    queueMicrotask(() => options.onOutput?.('tui'));
    return { id: options.id, pid: 10 + spawns.length };
  });
});
afterEach(async () => { await bridge?.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });

function build(bridgeOptions: { toolTimeoutMs?: number } = {}) {
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
    ...bridgeOptions,
  });
  // Attention: every registered terminal is a root of the same native conversation.
  const attended = new Set<string>();
  const broker = {
    register: vi.fn(async (terminalId: string) => { attended.add(terminalId); return { CLANKER_ATTENTION_TOKEN: `a-${terminalId}` }; }),
    release: vi.fn((terminalId: string) => { attended.delete(terminalId); }),
    snapshot: (terminalId: string) => (attended.has(terminalId) ? { sessionId: 'native-1', lastOutcome: null } : null),
  };
  const defaults = { claude: { agentBridgeEnabled: true, attentionEnabled: true } };
  const store = { get: (key: string) => (key === 'harnessDefaults' ? defaults : false) } as never;
  const options = { claude: { name: 'claude', command: 'claude', args: [] as string[], icon: 'c' } };
  const common = {
    getTerminals: () => terminals as never, getMainWindow: () => ({ webContents: { send: vi.fn() } }) as never, getStore: () => store,
    getSafeWorkspacePath: (dir: string) => dir, getHarnessOptions: () => options, getWorkspaceRegistry: () => registry as never,
    harnessSpawnOverrides: { fileExists: () => true }, agentBridge: bridge, agentAttentionBroker: broker as never,
  };
  registerTerminalIpc({ ...common, ensureHarnessWrapperScript: () => testHarnessWrapper() });
  const sessions = registerSessionIpc({
    ...common, getIsShuttingDown: () => false,
    listWorktrees: async () => ({ success: true, worktrees: listedWorktrees.map((entry) => ({ isLocked: false, isPrunable: false, ...entry })) }),
    listBranches: async () => ['main'],
  });

  const treeOf = (branch: string): CheckoutContext => ({ id: `ws::ckt-${branch}`, workspaceId: 'ws', environmentId: 'local', path: toPosixPath(generated(branch)), kind: 'worktree', branch });
  const git = {
    getBranchState: async () => ({ success: true, isRepo: true, currentBranch: 'main', isDetached: false, branches: [{ name: 'main', isCurrent: true }] }),
    createCheckoutWorktree: async (_ws: string, branch: string) => {
      fs.mkdirSync(generated(branch), { recursive: true });
      const context = treeOf(branch);
      contexts.push(context);
      listedWorktrees.push({ path: generated(branch), branch, isMain: false });
      return { success: true, worktree: { path: context.path, branch, isMain: false, isLocked: false, isPrunable: false }, checkoutContext: context };
    },
    listWorktrees: async () => ({ success: true, worktrees: listedWorktrees.map((entry) => ({ isLocked: false, isPrunable: false, ...entry })) }),
    checkWorktreeClean: async (_ws: string, worktreePath: string) => ({ success: true, hasChanges: false, worktree: { path: worktreePath, branch: 'x' } }),
    inspectWorktree: async (_ws: string, worktreePath: string) => {
      const entry = listedWorktrees.find((candidate) => toPosixPath(candidate.path) === toPosixPath(worktreePath));
      return { success: true, hasChanges: false, worktree: { path: worktreePath, branch: entry?.branch ?? null, isMain: false, isLocked: false, isPrunable: false } };
    },
    removeWorktree: async (_ws: string, worktreePath: string) => {
      // A removal is only legitimate when no live process is inside the directory any more.
      const stillInside = [...terminals.values()].some((terminal) => typeof terminal.cwd === 'string' && terminal.cwd.startsWith(worktreePath));
      if (stillInside) return { success: false, error: 'Close this workspace tab before removing its worktree' };
      log.push('removeWorktree');
      removed.push(worktreePath);
      fs.rmSync(worktreePath, { recursive: true, force: true });
      listedWorktrees = listedWorktrees.filter((entry) => toPosixPath(entry.path) !== toPosixPath(worktreePath));
      return { success: true };
    },
    forgetMissingWorktree: async () => ({ success: true }),
    deleteBranch: async (_ws: string, name: string) => { log.push(`deleteBranch ${name}`); return { success: true }; },
    reconcileCheckoutContexts: async () => ({ success: true }),
  };
  const lifecycle = new IsolatedCheckoutService({
    getRegistry: () => registry as never, getTerminals: () => terminals as never, attention: broker, git: git as never,
    getSessions: () => sessions,
    releaseCheckoutContext: (workspaceId, checkoutContextId) => releaseCheckoutContext({ registry: registry as never, terminals: terminals.values() as never, workspaceId, checkoutContextId }),
    retireTerminal: (id) => retireTerminal({ terminals: terminals as never, releaseAttention: (terminalId) => broker.release(terminalId) }, id),
    notify: (event) => { events.push(event); },
    isShuttingDown: () => false,
    timing: { startDeadlineMs: 2_000, observationMs: 10 },
  });
  port.bind(lifecycle);
  return { registry, lifecycle };
}

/** What the agent does: calls a tool with the credential its process was launched with. */
async function callAs(token: string, name: string, args: Record<string, unknown> = {}) {
  const grant = bridge.credentials.resolve(token);
  if (!grant) return { revoked: true as const };
  const result = await bridge.callTool(grant, name, args);
  return { revoked: false as const, result, data: result.data as Record<string, unknown> };
}

/** The four views, for the terminal that should now be the live one. */
function views(expected: { contextId: string }) {
  const live = [...terminals.entries()];
  const [terminalId, terminal] = live[0];
  const grant = bridge.credentials.resolve(spawns[spawns.length - 1].env[AGENT_BRIDGE_TOKEN_ENV]);
  const replaced = events.filter((event): event is Extract<AgentCheckoutTransitionEvent, { kind: 'terminal-replaced' }> => event.kind === 'terminal-replaced').pop();
  return {
    liveTerminals: live.length, terminalId, tableContext: terminal.checkoutContextId, credentialContext: grant?.identity.checkoutContextId,
    credentialTerminal: grant?.identity.terminalId, rendererContext: replaced?.terminal.checkoutContextId, rendererTerminal: replaced?.terminal.id,
    expected: expected.contextId,
  };
}

describe('create then complete, end to end', () => {
  it('after CREATE the terminal table, the credential, clanker_context and the renderer event all name the new worktree', async () => {
    build();
    const first = await handlers.get(SPAWN_TERMINAL)!(null, toPosixPath(appPath), 'claude', undefined, undefined, undefined, 'ws', 'local') as { id: string };
    const oldToken = grants();
    const before = await callAs(oldToken, 'clanker_context');
    expect((before.data as { checkout: { kind: string } }).checkout.kind).toBe('main');

    const moved = await callAs(oldToken, 'clanker_create_isolated_checkout', { branch: 'feature' });
    expect(moved.revoked).toBe(false);
    expect(moved.result?.isError).toBeUndefined();
    expect(moved.data).toMatchObject({ status: 'moved' });

    const tree = contexts.find((context) => context.kind === 'worktree')!;
    const seen = views({ contextId: tree.id });
    // Exactly one live terminal, and it is the replacement: no second authority, no dead pane.
    expect(seen.liveTerminals).toBe(1);
    expect(seen.terminalId).not.toBe(first.id);
    expect(terminals.has(first.id)).toBe(false);
    expect(seen.tableContext).toBe(tree.id);
    expect(seen.credentialContext).toBe(tree.id);
    expect(seen.credentialTerminal).toBe(seen.terminalId);
    expect(seen.rendererContext).toBe(tree.id);
    expect(seen.rendererTerminal).toBe(seen.terminalId);
    // The agent, calling with its NEW credential, sees the live worktree: not main, not missing.
    const after = await callAs(grants(), 'clanker_context');
    expect(after.data).toMatchObject({ checkout: { kind: 'worktree', isolated: true, branch: 'feature' } });
    expect(JSON.stringify(after.data)).not.toContain('missing');
    // The old credential no longer authorizes anything.
    expect((await callAs(oldToken, 'clanker_context')).revoked).toBe(true);
    // The conversation really runs in the worktree directory.
    expect(spawns[spawns.length - 1].cwd).toBe(generated('feature'));
  });

  it('after COMPLETE they all name main, the old checkout is gone, and the order was re-home -> retire -> remove', async () => {
    build();
    await handlers.get(SPAWN_TERMINAL)!(null, toPosixPath(appPath), 'claude', undefined, undefined, undefined, 'ws', 'local');
    await callAs(grants(), 'clanker_create_isolated_checkout', { branch: 'feature' });
    const treeToken = grants();
    const treeTerminal = spawns[spawns.length - 1].id;
    log.length = 0;

    const done = await callAs(treeToken, 'clanker_complete_isolated_checkout', { deleteBranch: true });
    expect(done.data).toMatchObject({ status: 'completed', cleanup: { checkoutReleased: true, worktreeRemoved: true, branchDeleted: true } });

    const seen = views({ contextId: 'ws::main' });
    expect(seen.liveTerminals).toBe(1);
    expect(seen.tableContext).toBe('ws::main');
    expect(seen.credentialContext).toBe('ws::main');
    expect(seen.credentialTerminal).toBe(seen.terminalId);
    expect(seen.rendererContext).toBe('ws::main');
    expect(contexts.map((context) => context.id)).toEqual(['ws::main']);
    expect(fs.existsSync(generated('feature'))).toBe(false);
    const after = await callAs(grants(), 'clanker_context');
    expect(after.data).toMatchObject({ checkout: { kind: 'main', isolated: false } });
    expect((await callAs(treeToken, 'clanker_context')).revoked).toBe(true);
    // Re-home first (the replacement spawned and was observed), the old process killed second, removal last.
    expect(spawns[spawns.length - 1].cwd).toBe(appPath);
    expect(log.indexOf(`kill ${treeTerminal}`)).toBeGreaterThanOrEqual(0);
    expect(log.indexOf(`kill ${treeTerminal}`)).toBeLessThan(log.indexOf('removeWorktree'));
    expect(log.indexOf('removeWorktree')).toBeLessThan(log.indexOf('deleteBranch feature'));
    // And the renderer was told in the order things became true.
    expect(events.map((event) => event.kind)).toEqual(['checkout-attached', 'terminal-replaced', 'notice', 'terminal-replaced', 'checkout-released', 'notice']);
  });

  it('the replacement of each stage gets lifecycle tools too, so the cycle can be repeated', async () => {
    build();
    await handlers.get(SPAWN_TERMINAL)!(null, toPosixPath(appPath), 'claude', undefined, undefined, undefined, 'ws', 'local');
    await callAs(grants(), 'clanker_create_isolated_checkout', { branch: 'one' });
    expect(bridge.listTools(bridge.credentials.resolve(grants())!).map((tool) => tool.name)).toContain('clanker_complete_isolated_checkout');
    await callAs(grants(), 'clanker_complete_isolated_checkout', {});
    expect(bridge.listTools(bridge.credentials.resolve(grants())!).map((tool) => tool.name)).toContain('clanker_create_isolated_checkout');
    await callAs(grants(), 'clanker_create_isolated_checkout', { branch: 'two' });
    expect(contexts.map((context) => context.branch ?? 'main')).toEqual(['main', 'two']);
    expect(terminals.size).toBe(1);
  });

  it('repeating a call after the move is safe: the conversation is told where it already is', async () => {
    build();
    await handlers.get(SPAWN_TERMINAL)!(null, toPosixPath(appPath), 'claude', undefined, undefined, undefined, 'ws', 'local');
    await callAs(grants(), 'clanker_create_isolated_checkout', { branch: 'feature' });
    // The resumed conversation sees its interrupted call and tries again with its new credential.
    expect((await callAs(grants(), 'clanker_create_isolated_checkout', { branch: 'feature' })).data).toMatchObject({ status: 'already-isolated' });
    await callAs(grants(), 'clanker_complete_isolated_checkout', {});
    expect((await callAs(grants(), 'clanker_complete_isolated_checkout', {})).data).toMatchObject({ status: 'already-complete' });
    expect(terminals.size).toBe(1);
    expect(contexts.map((context) => context.id)).toEqual(['ws::main']);
  });

  it('the smoke-test scenario: the worktree was deleted behind the agent\'s back, and completion still lands everything in main', async () => {
    build();
    await handlers.get(SPAWN_TERMINAL)!(null, toPosixPath(appPath), 'claude', undefined, undefined, undefined, 'ws', 'local');
    await callAs(grants(), 'clanker_create_isolated_checkout', { branch: 'feature' });
    // Someone removes the checkout (and Git's record turns prunable) while the agent is still running.
    fs.rmSync(generated('feature'), { recursive: true, force: true });
    listedWorktrees = listedWorktrees.map((entry) => (entry.isMain ? entry : { ...entry, isPrunable: true } as typeof entry));

    const done = await callAs(grants(), 'clanker_complete_isolated_checkout', { deleteBranch: true });
    expect(done.result?.isError).toBeUndefined();
    const seen = views({ contextId: 'ws::main' });
    expect(seen.tableContext).toBe('ws::main');
    expect(seen.credentialContext).toBe('ws::main');
    expect(seen.rendererContext).toBe('ws::main');
    expect(contexts.map((context) => context.id)).toEqual(['ws::main']);
    expect((await callAs(grants(), 'clanker_context')).data).toMatchObject({ checkout: { kind: 'main' } });
    expect(terminals.size).toBe(1);
  });

  it('a failed re-home leaves every view on the ORIGINAL checkout', async () => {
    build();
    await handlers.get(SPAWN_TERMINAL)!(null, toPosixPath(appPath), 'claude', undefined, undefined, undefined, 'ws', 'local');
    const originalToken = grants();
    const originalTerminal = spawns[0].id;
    // The next launch (the replacement) dies at once.
    mockSpawnPty.mockImplementationOnce((options: Spawned) => {
      spawns.push(options);
      terminals.set(options.id, { workspaceId: options.workspaceId, checkoutContextId: options.checkoutContextId, harnessId: options.harnessId, cwd: options.cwd, pty: { kill: vi.fn() }, releaseResources: vi.fn(async () => { await options.onExit(); }) });
      queueMicrotask(() => { terminals.delete(options.id); void options.onExit(); });
      return { id: options.id, pid: 99 };
    });

    const result = await callAs(originalToken, 'clanker_create_isolated_checkout', { branch: 'feature' });
    expect(result.result?.isError).toBe(true);
    // Still exactly the original terminal, bound to main, with a working credential.
    expect([...terminals.keys()]).toEqual([originalTerminal]);
    expect((await callAs(originalToken, 'clanker_context')).data).toMatchObject({ checkout: { kind: 'main' } });
    expect(events.map((event) => event.kind)).not.toContain('terminal-replaced');
    // The worktree that was created is kept and announced (visible and recoverable); the failed replacement's credential is gone.
    expect(events.map((event) => event.kind)).toContain('checkout-attached');
    expect(fs.existsSync(generated('feature'))).toBe(true);
    expect(bridge.credentials.size).toBe(1);
  });

  it('a bridge timeout before the commit point cancels the transaction: no split ownership, the original keeps running', async () => {
    build({ toolTimeoutMs: 40 });
    await handlers.get(SPAWN_TERMINAL)!(null, toPosixPath(appPath), 'claude', undefined, undefined, undefined, 'ws', 'local');
    const originalToken = grants();
    const originalTerminal = spawns[0].id;
    // The replacement starts but never produces output, so the transaction is still before its commit point when the bridge times out.
    mockSpawnPty.mockImplementationOnce((options: Spawned) => {
      spawns.push(options);
      terminals.set(options.id, { workspaceId: options.workspaceId, checkoutContextId: options.checkoutContextId, harnessId: options.harnessId, cwd: options.cwd, pty: { kill: vi.fn() }, releaseResources: vi.fn(async () => { await options.onExit(); }) });
      return { id: options.id, pid: 98 };
    });

    const started = Date.now();
    const result = await callAs(originalToken, 'clanker_create_isolated_checkout', { branch: 'feature' });
    expect(Date.now() - started).toBeLessThan(1_500); // answered at the bridge's bound, not the replacement's deadline
    expect(result.result?.isError).toBe(true);
    expect(JSON.stringify(result.data)).toContain('timed out');

    // The abort reaches the transaction (which the lifecycle service owns), and it rolls back completely.
    await vi.waitFor(() => expect(terminals.size).toBe(1));
    expect([...terminals.keys()]).toEqual([originalTerminal]);
    expect(events.map((event) => event.kind)).not.toContain('terminal-replaced');
    expect(bridge.credentials.resolve(originalToken)).not.toBeNull();
    expect(bridge.credentials.size).toBe(1);
    // The checkout it created before timing out is kept and announced, never deleted.
    expect(fs.existsSync(generated('feature'))).toBe(true);
    expect(events.map((event) => event.kind)).toContain('checkout-attached');

    // The transaction reports its rollback to the user as its last act; once it has, it is finished.
    await vi.waitFor(() => expect(events.some((event) => event.kind === 'notice')).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The same conversation can simply try again: its own idle checkout is reused, not duplicated.
    const retry = await callAs(originalToken, 'clanker_create_isolated_checkout', { branch: 'feature' });
    expect(retry.data).toMatchObject({ status: 'moved' });
    expect(contexts.filter((context) => context.kind === 'worktree')).toHaveLength(1);
    expect(terminals.size).toBe(1);
    expect(terminals.has(originalTerminal)).toBe(false);
  });
});
