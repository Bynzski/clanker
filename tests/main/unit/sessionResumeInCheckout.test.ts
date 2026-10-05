/**
 * `resumeInCheckout` / `findSession`: main's own routing of a conversation to a checkout it chose.
 * Real directories (containment and canonical paths are real); the PTY and history discovery are faked.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessSession } from '../../../src/shared/types/session';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import { SESSION_DISCOVER } from '../../../src/shared/ipcChannels';
import { removeAttentionAdapterFiles } from '../../../src/main/agentAttentionAdapters';
import { worktreeDirectoryName } from '../../../src/main/worktreePaths';

const { mockHandle, mockSpawnPty, mockDiscover } = vi.hoisted(() => ({ mockHandle: vi.fn(), mockSpawnPty: vi.fn(), mockDiscover: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: mockHandle }, BrowserWindow: vi.fn() }));
vi.mock('../../../src/main/ipc/ptySpawn', () => ({ spawnPtyProcess: mockSpawnPty }));
vi.mock('../../../src/main/sessionHistory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/main/sessionHistory')>()),
  discoverSessions: mockDiscover,
}));

import { registerSessionIpc } from '../../../src/main/ipc/sessionIpc';

let root: string;
let workspacePath: string;
afterAll(() => removeAttentionAdapterFiles());
const posix = (value: string) => value.replace(/\\/g, '/');
const generated = (branch: string) => path.join(`${workspacePath}-worktrees`, worktreeDirectoryName(branch));

beforeEach(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'resume-in-checkout-')));
  workspacePath = path.join(root, 'app');
  fs.mkdirSync(workspacePath, { recursive: true });
  mockHandle.mockReset();
  mockSpawnPty.mockReset().mockReturnValue({ id: 'term', pid: 7 });
  mockDiscover.mockReset().mockResolvedValue([]);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const MAIN = (): CheckoutContext => ({ id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: posix(workspacePath), kind: 'main' });
const TREE = (branch: string): CheckoutContext => ({ id: 'ws::ckt', workspaceId: 'ws', environmentId: 'local', path: posix(generated(branch)), kind: 'worktree', branch });
const session = (harness: string, cwd: string, id = 's1'): HarnessSession => ({ id, harness: harness as HarnessSession['harness'], title: 't', cwd: posix(cwd), timestamp: 1 });

function setup(options: { registered?: CheckoutContext[]; listed?: Array<{ path: string; branch: string | null; isPrunable?: boolean }>; environmentId?: string } = {}) {
  const workspace = { workspaceId: 'ws', location: { environmentId: options.environmentId ?? 'local', path: posix(workspacePath) } };
  const contexts = [MAIN(), ...(options.registered ?? [])];
  const registry = {
    getWorkspace: (id: string) => (id === 'ws' ? workspace : null),
    resolveCheckoutContext: () => contexts[0],
    getCheckoutContextsForWorkspace: () => contexts,
    getCheckoutContext: (id: string) => contexts.find((entry) => entry.id === id) ?? null,
  };
  const listed = [{ path: workspacePath, branch: 'main', isMain: true }, ...(options.listed ?? (options.registered ?? []).map((context) => ({ path: context.path, branch: context.branch ?? null })))];
  return registerSessionIpc({
    getTerminals: () => new Map(), getMainWindow: () => null, getSafeWorkspacePath: (dir: string) => dir, getIsShuttingDown: () => false,
    getStore: () => ({ get: () => ({}) }) as never,
    getHarnessOptions: () => Object.fromEntries(['codex', 'claude', 'pi', 'opencode'].map((id) => [id, { name: id, command: id, args: [], icon: '' }])),
    getWorkspaceRegistry: () => registry as never,
    harnessSpawnOverrides: { fileExists: () => true },
    listWorktrees: async () => ({ success: true, worktrees: listed.map((entry) => ({ isMain: false, isPrunable: false, isLocked: false, ...entry })) }),
    listBranches: async () => ['main'],
  });
}
const lastSpawn = () => mockSpawnPty.mock.calls[mockSpawnPty.mock.calls.length - 1][0] as { cwd: string; checkoutContextId?: string; spawnArgs: string[] | string };

describe('resumeInCheckout routes by main\'s choice, not by where the conversation was recorded', () => {
  it('a conversation recorded in the main checkout can be resumed in a worktree', async () => {
    const tree = TREE('feature');
    fs.mkdirSync(generated('feature'), { recursive: true });
    const controller = setup({ registered: [tree] });
    const launched = await controller.resumeInCheckout('ws', session('codex', workspacePath), { targetContext: tree });

    expect(launched.checkoutContextId).toBe(tree.id);
    expect(lastSpawn().cwd).toBe(generated('feature'));
    expect(lastSpawn().checkoutContextId).toBe(tree.id);
  });

  it('a conversation recorded in a live worktree can be resumed in the main checkout', async () => {
    const tree = TREE('feature');
    fs.mkdirSync(generated('feature'), { recursive: true });
    const controller = setup({ registered: [tree] });
    const launched = await controller.resumeInCheckout('ws', session('claude', generated('feature')), { targetContext: MAIN() });

    expect(launched.checkoutContextId).toBe('ws::main');
    expect(lastSpawn().cwd).toBe(workspacePath);
  });

  it('a conversation recorded in a worktree that was removed is resumed in main without any recreate offer', async () => {
    const tree = TREE('feature'); // its directory does not exist
    const controller = setup({ registered: [tree], listed: [{ path: generated('feature'), branch: 'feature', isPrunable: true }] });
    const launched = await controller.resumeInCheckout('ws', session('claude', generated('feature')), { targetContext: MAIN() });

    expect(launched.checkoutContextId).toBe('ws::main');
    expect(lastSpawn().cwd).toBe(workspacePath);
    expect(fs.existsSync(generated('feature'))).toBe(false); // a removed path is never recreated or launched into
  });

  it('never launches in a directory outside the chosen checkout', async () => {
    const controller = setup();
    await controller.resumeInCheckout('ws', session('codex', path.join(workspacePath, 'src')), { targetContext: MAIN() });
    expect(lastSpawn().cwd).toBe(workspacePath);
  });

  it('a conversation recorded outside the workspace is refused', async () => {
    const controller = setup();
    await expect(controller.resumeInCheckout('ws', session('codex', root), { targetContext: MAIN() })).rejects.toThrow(/outside the workspace/);
    expect(mockSpawnPty).not.toHaveBeenCalled();
  });

  it('refuses a target checkout that belongs to another workspace, before any process exists', async () => {
    const controller = setup();
    const foreign: CheckoutContext = { ...MAIN(), id: 'other::main', workspaceId: 'other' };
    await expect(controller.resumeInCheckout('ws', session('codex', workspacePath), { targetContext: foreign })).rejects.toThrow(/does not belong to this workspace/);
    await expect(controller.resumeInCheckout('ws', session('codex', workspacePath), { targetContext: { ...MAIN(), environmentId: 'vps' } })).rejects.toThrow(/does not belong to this workspace/);
    expect(mockSpawnPty).not.toHaveBeenCalled();
  });

  it('is local only', async () => {
    const controller = setup({ environmentId: 'vps' });
    await expect(controller.resumeInCheckout('ws', session('codex', workspacePath), { targetContext: MAIN() })).rejects.toThrow(/local workspaces only/);
    expect(mockSpawnPty).not.toHaveBeenCalled();
  });

  it('a harness that cannot resume from another directory would still be refused by its own validation, not silently moved', async () => {
    // Pi validates the recorded directory against its own store; the internal route does not relax that.
    const controller = setup();
    await expect(controller.resumeInCheckout('ws', session('pi', workspacePath), { targetContext: MAIN() })).rejects.toThrow();
    expect(mockSpawnPty).not.toHaveBeenCalled();
  });
});

describe('findSession is main\'s own rediscovery', () => {
  it('finds a conversation by harness and native id from discovered history', async () => {
    mockDiscover.mockResolvedValue([session('claude', workspacePath, 'abc'), session('codex', workspacePath, 'def')]);
    const controller = setup();
    expect(await controller.findSession('ws', 'claude', 'abc')).toMatchObject({ id: 'abc', harness: 'claude' });
    expect(await controller.findSession('ws', 'codex', 'def')).toMatchObject({ id: 'def', harness: 'codex' });
  });

  it('does not match another harness\'s identical id, or an unknown id', async () => {
    mockDiscover.mockResolvedValue([session('claude', workspacePath, 'abc')]);
    const controller = setup();
    expect(await controller.findSession('ws', 'codex', 'abc')).toBeNull();
    expect(await controller.findSession('ws', 'claude', 'nope')).toBeNull();
  });

  it('finds a conversation recorded in a worktree of the workspace', async () => {
    const tree = TREE('feature');
    fs.mkdirSync(generated('feature'), { recursive: true });
    // The plan scans the worktree container (which already contains the worktree), as real discovery does.
    mockDiscover.mockImplementation(async (scanPath: string) => (scanPath === `${workspacePath}-worktrees` ? [session('claude', generated('feature'), 'in-tree')] : []));
    const controller = setup({ registered: [tree] });
    expect(await controller.findSession('ws', 'claude', 'in-tree')).toMatchObject({ id: 'in-tree' });
  });

  it('never reads the history cache: a conversation that began after the listing was cached must still be found', async () => {
    mockDiscover.mockResolvedValue([session('claude', workspacePath, 'abc')]);
    const controller = setup();
    await controller.findSession('ws', 'claude', 'abc');
    // Every scan (the workspace and each worktree scope) is a forced refresh.
    expect(mockDiscover.mock.calls.length).toBeGreaterThan(0);
    for (const call of mockDiscover.mock.calls) expect(call[1]).toMatchObject({ forceRefresh: true });
  });

  it('ordinary history discovery is unchanged: it still uses the cache', async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
    mockHandle.mockImplementation((channel: string, handler: never) => handlers.set(channel, handler));
    mockDiscover.mockResolvedValue([]);
    setup();
    await handlers.get(SESSION_DISCOVER)!(null, 'ws');
    for (const call of mockDiscover.mock.calls) expect(call[1]).toBeUndefined();
  });

  it('is null for an unknown workspace and for an SSH workspace', async () => {
    mockDiscover.mockResolvedValue([session('claude', workspacePath, 'abc')]);
    expect(await setup().findSession('nope', 'claude', 'abc')).toBeNull();
    expect(await setup({ environmentId: 'vps' }).findSession('ws', 'claude', 'abc')).toBeNull();
  });
});
