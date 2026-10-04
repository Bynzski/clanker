import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessSession } from '../../../src/shared/types/session';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import type { GitWorktreeCreateResult } from '../../../src/shared/types/git';
import { SESSION_DISCOVER, SESSION_INVOKE } from '../../../src/shared/ipcChannels';
import { removeAttentionAdapterFiles } from '../../../src/main/agentAttentionAdapters';
import { createAgentLocationResolver } from '../../../src/main/agentLocation';
import { worktreeDirectoryName } from '../../../src/main/worktreePaths';

const { mockHandle, mockSpawnPty, mockDiscover } = vi.hoisted(() => ({ mockHandle: vi.fn(), mockSpawnPty: vi.fn(), mockDiscover: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: mockHandle }, BrowserWindow: vi.fn() }));
vi.mock('../../../src/main/ipc/ptySpawn', () => ({ spawnPtyProcess: mockSpawnPty }));
vi.mock('../../../src/main/sessionHistory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/main/sessionHistory')>()),
  discoverSessions: mockDiscover,
}));

import { registerSessionIpc } from '../../../src/main/ipc/sessionIpc';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
let root: string;
let workspacePath: string;
const containerOf = () => `${workspacePath}-worktrees`;
const generated = (branch: string) => path.join(containerOf(), worktreeDirectoryName(branch));
afterAll(() => removeAttentionAdapterFiles());

beforeEach(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'session-worktrees-')));
  workspacePath = path.join(root, 'app');
  fs.mkdirSync(workspacePath, { recursive: true });
  mockHandle.mockReset();
  mockSpawnPty.mockReset().mockReturnValue({ id: 'term', pid: 1 });
  mockDiscover.mockReset().mockResolvedValue([]);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const posix = (value: string) => value.replace(/\\/g, '/');
const mainContext = (): CheckoutContext => ({ id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: posix(workspacePath), kind: 'main' });
const session = (harness: HarnessSession['harness'], cwd: string, id = 's1'): HarnessSession => ({ id, harness, title: 't', cwd: posix(cwd), timestamp: 1 });
const live = (...branches: string[]) => branches.map((branch) => { fs.mkdirSync(path.join(generated(branch), 'src'), { recursive: true }); return generated(branch); });

function setup(options: {
  registered?: string[]; listed?: Array<{ path: string; branch: string | null; isPrunable?: boolean; isLocked?: boolean }>; branches?: string[];
  harnesses?: string[]; safe?: (dir: string, contexts: CheckoutContext[]) => string;
} = {}) {
  const handlers = new Map<string, Handler>();
  mockHandle.mockImplementation((channel: string, handler: Handler) => handlers.set(channel, handler));
  const workspace = { workspaceId: 'ws', location: { environmentId: 'local', path: posix(workspacePath) } };
  const contexts: CheckoutContext[] = [mainContext(),
    ...(options.registered ?? []).map((p, index): CheckoutContext => ({ id: `ws::wt-${index}`, workspaceId: 'ws', environmentId: 'local', path: posix(p), kind: 'worktree', branch: 'registered' }))];
  const registerCheckoutContext = vi.fn(async (request: { path: string; branch?: string }) => {
    const context: CheckoutContext = { id: 'ws::adopted', workspaceId: 'ws', environmentId: 'local', path: request.path, kind: 'worktree', branch: request.branch };
    contexts.push(context);
    return { success: true, checkoutContext: context };
  });
  const registry = {
    getWorkspace: (id: string) => id === 'ws' ? workspace : null,
    resolveCheckoutContext: () => contexts[0],
    getCheckoutContextsForWorkspace: () => contexts,
    getCheckoutContext: (id: string) => contexts.find((entry) => entry.id === id) ?? null,
    registerCheckoutContext,
  };
  const listed = [{ path: workspacePath, branch: 'main', isMain: true }, ...(options.listed ?? (options.registered ?? []).map((p) => ({ path: p, branch: 'registered' })))];
  const recreateWorktree = vi.fn(async (_workspaceId: string, branch: string): Promise<GitWorktreeCreateResult> => {
    const dir = generated(branch);
    fs.mkdirSync(dir, { recursive: true });
    const context: CheckoutContext = { id: 'ws::recreated', workspaceId: 'ws', environmentId: 'local', path: posix(dir), kind: 'worktree', branch };
    contexts.push(context);
    return { success: true, worktree: { path: posix(dir), branch, isMain: false, isLocked: false, isPrunable: false }, checkoutContext: context };
  });
  const harnessIds = options.harnesses ?? ['codex', 'claude', 'pi', 'opencode', 'agy'];
  registerSessionIpc({
    getTerminals: () => new Map(), getMainWindow: () => null, getSafeWorkspacePath: (dir: string) => options.safe ? options.safe(dir, contexts) : dir, getIsShuttingDown: () => false,
    getStore: () => ({ get: () => ({}) }) as never,
    getHarnessOptions: () => Object.fromEntries(harnessIds.map((id) => [id, { name: id, command: id, args: [], icon: '' }])),
    getWorkspaceRegistry: () => registry as never,
    listWorktrees: async () => ({ success: true, worktrees: listed.map((entry) => ({ isMain: false, isPrunable: false, isLocked: false, ...entry })) }),
    listBranches: async () => options.branches ?? [],
    recreateWorktree,
    ensureHarnessWrapperScript: () => null,
    // Resolution of the harness binary is not under test; keep it independent of what the CI host has installed.
    harnessSpawnOverrides: { platform: 'linux', fileExists: () => true },
  });
  const invoke = (value: HarnessSession, fork?: boolean, invokeOptions?: unknown) => handlers.get(SESSION_INVOKE)!({}, 'ws', value, fork, invokeOptions);
  const discover = () => handlers.get(SESSION_DISCOVER)!({}, 'ws') as Promise<HarnessSession[]>;
  const spawned = () => mockSpawnPty.mock.calls[0][0] as { cwd: string; checkoutContextId?: string; workspaceId?: string; id: string };
  return { invoke, discover, spawned, registerCheckoutContext, recreateWorktree, registry, contexts };
}

describe('history of isolated-agent conversations', () => {
  it('lists live and removed worktree conversations tagged with their real branch, and excludes everything else', async () => {
    const [liveDir] = live('feature/live');
    const removed = generated('feature/foo');
    const { discover } = setup({ registered: [liveDir], branches: ['main', 'feature/live', 'feature/foo'] });
    mockDiscover.mockImplementation(async (scanPath: string) => scanPath === containerOf() ? [
      session('claude', path.join(liveDir, 'src'), 'live'), session('claude', path.join(removed, 'src'), 'removed'),
      session('claude', path.join(containerOf(), 'random-folder'), 'stranger'),
    ] : []);
    const sessions = await discover();
    expect(sessions.map((entry) => [entry.id, entry.checkout?.branch, entry.checkout?.exists])).toEqual([
      ['live', 'registered', true], ['removed', 'feature/foo', false],
    ]);
  });
});

describe('local resume of isolated-agent conversations', () => {
  it('resumes into the registered checkout context of a live worktree, in the session\'s own directory', async () => {
    const [liveDir] = live('feature/live');
    const { invoke, spawned } = setup({ registered: [liveDir], branches: ['main', 'feature/live'] });
    const result = await invoke(session('codex', path.join(liveDir, 'src')));
    expect(spawned()).toMatchObject({ cwd: path.join(liveDir, 'src'), checkoutContextId: 'ws::wt-0' });
    expect(result).toMatchObject({ checkoutContextId: 'ws::wt-0', checkoutContext: { id: 'ws::wt-0' }, workingDir: posix(path.join(liveDir, 'src')) });
    expect(result).not.toHaveProperty('resumeNotice');
  });

  it('adopts an unmanaged live worktree through Git\'s listing before resuming into it', async () => {
    const [liveDir] = live('feature/live');
    const { invoke, spawned, registerCheckoutContext } = setup({ listed: [{ path: liveDir, branch: 'feature/live' }], branches: ['main', 'feature/live'] });
    await invoke(session('claude', liveDir));
    expect(registerCheckoutContext).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws', kind: 'worktree', path: posix(liveDir) }));
    expect(spawned().checkoutContextId).toBe('ws::adopted');
  });

  it('resumes a portable harness in the main checkout and says so when the worktree was removed', async () => {
    const { invoke, spawned } = setup({ branches: ['main', 'feature/foo'] });
    const result = await invoke(session('claude', path.join(generated('feature/foo'), 'src'))) as { resumeNotice?: string; checkoutContextId?: string; workingDir?: string };
    expect(spawned()).toMatchObject({ cwd: workspacePath, checkoutContextId: 'ws::main' });
    expect(result.checkoutContextId).toBe('ws::main');
    expect(result.workingDir).toBe(posix(workspacePath));
    expect(result.resumeNotice).toMatch(/feature\/foo.*was removed.*main checkout/);
  });

  it('offers to recreate for a harness that only resumes in its original directory, creating nothing', async () => {
    const { invoke, recreateWorktree } = setup({ branches: ['main', 'feature/foo'] });
    mockDiscover.mockImplementation(async (scanPath: string) => scanPath === containerOf()
      ? [session('opencode', path.join(generated('feature/foo'), 'src'))] : []);
    const result = await invoke(session('opencode', path.join(generated('feature/foo'), 'src')));
    expect(result).toEqual({ recreateOffer: { branch: 'feature/foo', path: posix(generated('feature/foo')) } });
    expect(recreateWorktree).not.toHaveBeenCalled();
    expect(mockSpawnPty).not.toHaveBeenCalled();
  });

  it('recreates only on confirmation, then launches into the recreated checkout at its original directory', async () => {
    const { invoke, recreateWorktree, spawned, contexts } = setup({ branches: ['main', 'feature/foo'] });
    const cwd = path.join(generated('feature/foo'), 'src');
    mockDiscover.mockImplementation(async (scanPath: string) => scanPath === containerOf() ? [session('opencode', cwd)] : []);
    // The conversation's directory exists again once recreated, as it would after `git worktree add`.
    recreateWorktree.mockImplementationOnce(async (_id, branch) => {
      fs.mkdirSync(cwd, { recursive: true });
      const checkoutContext: CheckoutContext = { id: 'ws::recreated', workspaceId: 'ws', environmentId: 'local', path: posix(generated(branch)), kind: 'worktree', branch };
      contexts.push(checkoutContext);
      return { success: true, worktree: { path: posix(generated(branch)), branch, isMain: false, isLocked: false, isPrunable: false }, checkoutContext };
    });
    const result = await invoke(session('opencode', cwd), false, { recreateCheckout: true });
    expect(recreateWorktree).toHaveBeenCalledExactlyOnceWith('ws', 'feature/foo');
    expect(spawned()).toMatchObject({ cwd, checkoutContextId: 'ws::recreated' });
    expect(result).toMatchObject({ checkoutContextId: 'ws::recreated', resumeNotice: expect.stringContaining('Recreated the worktree for feature/foo') });
  });

  it('refuses to recreate for a conversation main cannot find, or a directory with no provenance', async () => {
    const cwd = path.join(generated('feature/foo'), 'src');
    const first = setup({ branches: ['main', 'feature/foo'] });
    await expect(first.invoke(session('opencode', cwd), false, { recreateCheckout: true })).rejects.toThrow('Session was not found');
    expect(first.recreateWorktree).not.toHaveBeenCalled();
    const second = setup({ branches: ['main'] });
    // Deleted branch and never remembered: nothing proves the directory was this repository's worktree.
    await expect(second.invoke(session('pi', cwd))).rejects.toThrow(/outside the workspace/);
    expect(mockSpawnPty).not.toHaveBeenCalled();
  });

  it('refuses stranger directories under the container, other repositories and dot-segment tricks', async () => {
    const { invoke } = setup({ branches: ['main', 'feature/foo'] });
    for (const cwd of [path.join(containerOf(), 'random-folder'), path.join(root, 'other-repo'), `${workspacePath}/../elsewhere`, `${containerOf()}-other/x`]) {
      await expect(invoke(session('claude', cwd))).rejects.toThrow(/outside the workspace/);
    }
    expect(mockSpawnPty).not.toHaveBeenCalled();
  });
});

describe('resume fails closed and keeps main-side ownership', () => {
  const fallbackDir = () => { const dir = path.join(root, 'fallback-home'); fs.mkdirSync(dir, { recursive: true }); return dir; };

  it('never falls back to another directory when getSafeWorkspacePath leaves the selected worktree', async () => {
    const [liveDir] = live('feature/live');
    const { invoke } = setup({ registered: [liveDir], branches: ['main', 'feature/live'], safe: () => fallbackDir() });
    await expect(invoke(session('claude', path.join(liveDir, 'src')))).rejects.toThrow(/outside the checkout/);
    expect(mockSpawnPty).not.toHaveBeenCalled();
  });

  it('fails before the PTY exists when the worktree disappears between route resolution and spawn', async () => {
    const [liveDir] = live('feature/live');
    const { invoke } = setup({
      registered: [liveDir], branches: ['main', 'feature/live'],
      // The requested path is gone by the time it is resolved: the helper's own fallback is home/lastWorkspace.
      safe: (dir) => { fs.rmSync(liveDir, { recursive: true, force: true }); return fs.existsSync(dir) ? dir : fallbackDir(); },
    });
    await expect(invoke(session('claude', path.join(liveDir, 'src')))).rejects.toThrow(/outside the checkout/);
    expect(mockSpawnPty).not.toHaveBeenCalled();
  });

  it('confines main-checkout resume to the main root too', async () => {
    const { invoke } = setup({ safe: () => fallbackDir() });
    await expect(invoke(session('claude', path.join(workspacePath, 'src')))).rejects.toThrow(/outside the checkout/);
    expect(mockSpawnPty).not.toHaveBeenCalled();
  });

  it('refuses when the selected checkout was released while resume was being prepared', async () => {
    const [liveDir] = live('feature/live');
    const { invoke } = setup({
      registered: [liveDir], branches: ['main', 'feature/live'],
      safe: (dir, contexts) => { contexts.splice(contexts.findIndex((entry) => entry.kind === 'worktree'), 1); return dir; },
    });
    await expect(invoke(session('claude', liveDir))).rejects.toThrow(/closed or is being removed/);
    expect(mockSpawnPty).not.toHaveBeenCalled();
  });

  it('records the owning workspace in main so later location reports resolve (issue 99 behaviour after a resume)', async () => {
    const [liveDir] = live('feature/live');
    const t = setup({ registered: [liveDir], branches: ['main', 'feature/live'] });
    await t.invoke(session('claude', liveDir));
    const options = t.spawned();
    expect(options).toMatchObject({ workspaceId: 'ws', checkoutContextId: 'ws::wt-0' });
    const terminal = { workspaceId: options.workspaceId };
    const resolver = createAgentLocationResolver({
      getTerminal: (id) => id === options.id ? terminal : undefined,
      getCheckoutContexts: () => t.contexts,
    });
    expect(resolver(options.id, 'local', path.join(liveDir, 'src'))).toMatchObject({ checkoutContextId: 'ws::wt-0' });
    // The agent later cd's into main: the report resolves to the main context; the launch binding is untouched.
    expect(resolver(options.id, 'local', workspacePath)).toMatchObject({ checkoutContextId: 'ws::main' });
    expect(options.checkoutContextId).toBe('ws::wt-0');
  });
});
