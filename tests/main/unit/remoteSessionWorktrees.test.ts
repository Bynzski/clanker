import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import type { GitWorktreeCreateResult } from '../../../src/shared/types/git';
import type { HarnessSession } from '../../../src/shared/types/session';
import { SESSION_DISCOVER } from '../../../src/shared/ipcChannels';
import { worktreeDirectoryName } from '../../../src/main/worktreePaths';
import { WorktreeProvenance } from '../../../src/main/worktreeProvenance';
import type { RegisteredWorkspace } from '../../../src/main/workspaceRegistry';

const { mockHandle } = vi.hoisted(() => ({ mockHandle: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: mockHandle }, BrowserWindow: vi.fn() }));
vi.mock('../../../src/main/ipc/ptySpawn', () => ({ spawnPtyProcess: vi.fn() }));
import { spawnPtyProcess } from '../../../src/main/ipc/ptySpawn';
import { invokeRemoteSession } from '../../../src/main/ipc/remoteSessionInvocation';
import { registerSessionIpc, type RegisterSessionIpcDeps } from '../../../src/main/ipc/sessionIpc';

const generated = (branch: string) => `/ws-worktrees/${worktreeDirectoryName(branch)}`;
const entry = (path: string, branch: string | null, extra: Record<string, unknown> = {}) => ({ path, branch, isMain: false, isLocked: false, isPrunable: false, ...extra });
const host = (harness: HarnessSession['harness'], cwd: string, id = 'native-id'): HarnessSession => ({
  id, harness, title: 'Host session', cwd, timestamp: 1,
  ...(harness === 'pi' || harness === 'omp' ? { filePath: `/home/remote/.${harness}/agent/sessions/p/session.jsonl` } : {}),
});

function fixture(options: { harness?: HarnessSession['harness']; sessions: HarnessSession[]; contexts?: CheckoutContext[]; worktrees?: Array<ReturnType<typeof entry>>; branches?: string[]; reserved?: (path: string) => boolean }) {
  const harness = options.harness ?? 'codex';
  const environment = {
    capabilities: { sessionDiscovery: true, agentAttention: false },
    discoverSessions: vi.fn().mockResolvedValue(options.sessions),
    getHarnessOptions: vi.fn().mockResolvedValue({ [harness]: { command: harness } }),
    validateWorkspacePath: vi.fn(async (p: string) => ({ valid: true, resolvedPath: p })),
    resolveTerminalSpawn: vi.fn().mockResolvedValue({ spawnCmd: 'ssh', spawnArgs: [], env: {}, attentionEnabled: false }),
  };
  const workspace = { workspaceId: 'remote-ws', location: { environmentId: 'ssh-a', path: '/ws' }, environment } as unknown as RegisteredWorkspace;
  const main: CheckoutContext = { id: 'remote-ws::main', workspaceId: 'remote-ws', environmentId: 'ssh-a', path: '/ws', kind: 'main' };
  const contexts = [main, ...(options.contexts ?? [])];
  const registerCheckoutContext = vi.fn(async (request: { path: string; branch?: string }) => {
    const context: CheckoutContext = { id: 'remote-ws::adopted', workspaceId: 'remote-ws', environmentId: 'ssh-a', path: request.path, kind: 'worktree', branch: request.branch };
    contexts.push(context);
    return { success: true, checkoutContext: context };
  });
  const registry = {
    getWorkspace: (id: string) => id === 'remote-ws' ? workspace : null,
    isRemotePathReserved: (_environmentId: string, p: string) => options.reserved?.(p) ?? false,
    resolveCheckoutContext: () => main,
    getCheckoutContext: (id: string) => contexts.find((context) => context.id === id) ?? null,
    getCheckoutContextsForWorkspace: () => contexts,
    registerCheckoutContext,
  };
  const worktrees = options.worktrees ?? [entry('/ws', 'main', { isMain: true })];
  const recreateWorktree = vi.fn(async (_id: string, branch: string): Promise<GitWorktreeCreateResult> => {
    const context: CheckoutContext = { id: 'remote-ws::recreated', workspaceId: 'remote-ws', environmentId: 'ssh-a', path: generated(branch), kind: 'worktree', branch };
    contexts.push(context);
    return { success: true, worktree: { path: generated(branch), branch, isMain: false, isLocked: false, isPrunable: false }, checkoutContext: context };
  });
  const provenance = new WorktreeProvenance({ read: () => [], write: () => undefined });
  const deps = {
    getWorkspaceRegistry: () => registry, getIsShuttingDown: () => false, getTerminals: () => new Map(), getMainWindow: () => null,
    getStore: () => ({ get: () => ({ [harness]: {} }) }), getHarnessOptions: () => ({}),
    listWorktrees: async () => ({ success: true, worktrees }),
    listBranches: async () => options.branches ?? [],
    worktreeProvenance: provenance,
    recreateWorktree,
  } as unknown as RegisterSessionIpcDeps;
  return { environment, workspace, registry, registerCheckoutContext, recreateWorktree, deps, main, contexts };
}
const spawnOptions = () => vi.mocked(spawnPtyProcess).mock.calls[0][0];
beforeEach(() => {
  mockHandle.mockReset();
  vi.mocked(spawnPtyProcess).mockReset().mockImplementation((options) => ({ id: options.id, pid: 9 }));
});

describe('SSH history of isolated-agent conversations', () => {
  async function discover(f: ReturnType<typeof fixture>) {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
    mockHandle.mockImplementation((channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler));
    registerSessionIpc(f.deps);
    return handlers.get(SESSION_DISCOVER)!({}, 'remote-ws') as Promise<HarnessSession[]>;
  }

  it('asks the host for the workspace plus main-derived worktree scopes, then tags and filters by main-owned provenance', async () => {
    const live = generated('feature/live');
    const f = fixture({
      sessions: [], worktrees: [entry('/ws', 'main', { isMain: true }), entry(live, 'feature/live'), entry('/sibling', 'sib')],
      branches: ['main', 'feature/live', 'feature/foo'],
    });
    f.environment.discoverSessions.mockResolvedValue([
      host('codex', `${live}/src`, 'live'), host('codex', `${generated('feature/foo')}/src`, 'removed'),
      host('codex', '/ws-worktrees/random-folder', 'stranger'), host('codex', '/sibling/x', 'sib'), host('codex', '/ws/sub', 'main'),
      host('codex', '/ws-other/x', 'other-repo'),
    ]);
    const sessions = await discover(f);
    expect(f.environment.discoverSessions).toHaveBeenCalledWith('/ws', ['/ws-worktrees', '/sibling']);
    expect(Object.fromEntries(sessions.map((entry_) => [entry_.id, entry_.checkout ? [entry_.checkout.branch, entry_.checkout.exists] : null]))).toEqual({
      live: ['feature/live', true], removed: ['feature/foo', false], sib: ['sib', true], main: null,
    });
  });

  it('adds no scopes for a workspace inside a linked worktree, and tolerates Git being unreachable', async () => {
    const inLinked = fixture({ sessions: [], worktrees: [entry('/main', 'main', { isMain: true }), entry('/ws', 'feat')] });
    await discover(inLinked);
    expect(inLinked.environment.discoverSessions).toHaveBeenCalledWith('/ws');
    const noGit = fixture({ sessions: [host('codex', '/ws/x', 'a')] });
    noGit.deps.listWorktrees = async () => { throw new Error('ssh down'); };
    expect(await discover(noGit)).toHaveLength(1);
  });
});

describe('SSH resume of isolated-agent conversations', () => {
  const liveDir = generated('feature/live');
  const liveContext: CheckoutContext = { id: 'remote-ws::wt', workspaceId: 'remote-ws', environmentId: 'ssh-a', path: liveDir, kind: 'worktree', branch: 'feature/live' };
  const worktrees = [entry('/ws', 'main', { isMain: true }), entry(liveDir, 'feature/live')];

  it('resumes into a live worktree\'s registered context, confined to that root and bound to it', async () => {
    const f = fixture({ sessions: [host('codex', `${liveDir}/src`)], contexts: [liveContext], worktrees, branches: ['main', 'feature/live'] });
    const result = await invokeRemoteSession(f.deps, f.workspace, host('codex', '/spoofed') ) as { checkoutContext?: CheckoutContext; checkoutContextId?: string; workingDir?: string };
    expect(f.environment.validateWorkspacePath).toHaveBeenCalledWith(`${liveDir}/src`);
    expect(f.environment.resolveTerminalSpawn).toHaveBeenCalledWith(expect.objectContaining({
      workingDir: `${liveDir}/src`, resumeSession: expect.objectContaining({ workspaceRoot: liveDir }),
    }));
    expect(spawnOptions()).toMatchObject({ checkoutContextId: 'remote-ws::wt', environmentId: 'ssh-a', remoteWorkingDir: `${liveDir}/src` });
    expect(result).toMatchObject({ checkoutContextId: 'remote-ws::wt', checkoutContext: { id: 'remote-ws::wt' }, workingDir: `${liveDir}/src` });
    expect(result).not.toHaveProperty('resumeNotice');
  });

  it('adopts an unmanaged live remote worktree through the trusted registration route', async () => {
    const f = fixture({ sessions: [host('claude', liveDir)], worktrees, harness: 'claude' });
    const result = await invokeRemoteSession(f.deps, f.workspace, host('claude', liveDir)) as { checkoutContextId?: string };
    expect(f.registerCheckoutContext).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'remote-ws', kind: 'worktree', path: liveDir }));
    expect(result.checkoutContextId).toBe('remote-ws::adopted');
  });

  it('never launches in a removed worktree: portable harnesses resume in the main checkout with an explicit notice', async () => {
    const removed = `${generated('feature/foo')}/src`;
    const f = fixture({ sessions: [host('codex', removed)], branches: ['main', 'feature/foo'] });
    const result = await invokeRemoteSession(f.deps, f.workspace, host('codex', removed)) as { resumeNotice?: string; workingDir?: string; checkoutContextId?: string };
    expect(f.environment.validateWorkspacePath).toHaveBeenCalledTimes(1);
    expect(f.environment.validateWorkspacePath).toHaveBeenCalledWith('/ws');
    expect(f.environment.resolveTerminalSpawn).toHaveBeenCalledWith(expect.objectContaining({
      workingDir: '/ws', resumeSession: expect.objectContaining({ workspaceRoot: '/ws', session: expect.objectContaining({ cwd: '/ws', id: 'native-id' }) }),
    }));
    expect(spawnOptions()).toMatchObject({ checkoutContextId: 'remote-ws::main', remoteWorkingDir: '/ws' });
    expect(result).toMatchObject({ workingDir: '/ws', checkoutContextId: 'remote-ws::main' });
    expect(result.resumeNotice).toMatch(/feature\/foo.*was removed.*main checkout/);
  });

  it('offers recreation for a harness that needs its original directory, then recreates only when confirmed', async () => {
    const removed = `${generated('feature/foo')}/src`;
    const f = fixture({ harness: 'opencode', sessions: [host('opencode', removed)], branches: ['main', 'feature/foo'] });
    const offer = await invokeRemoteSession(f.deps, f.workspace, host('opencode', removed));
    expect(offer).toEqual({ recreateOffer: { branch: 'feature/foo', path: generated('feature/foo') } });
    expect(f.recreateWorktree).not.toHaveBeenCalled();
    expect(f.environment.resolveTerminalSpawn).not.toHaveBeenCalled();
    expect(spawnPtyProcess).not.toHaveBeenCalled();

    const confirmed = await invokeRemoteSession(f.deps, f.workspace, host('opencode', removed), undefined, { recreateCheckout: true }) as { checkoutContextId?: string; resumeNotice?: string };
    expect(f.recreateWorktree).toHaveBeenCalledExactlyOnceWith('remote-ws', 'feature/foo');
    expect(f.environment.validateWorkspacePath).toHaveBeenCalledWith(removed);
    expect(confirmed).toMatchObject({ checkoutContextId: 'remote-ws::recreated', resumeNotice: expect.stringContaining('Recreated') });
  });

  it('refuses when the host no longer reports the conversation, for stranger directories, and for reserved directories', async () => {
    const stranger = fixture({ sessions: [host('codex', '/ws-worktrees/random-folder')], branches: ['main'] });
    await expect(invokeRemoteSession(stranger.deps, stranger.workspace, host('codex', '/x'))).rejects.toThrow('outside the workspace');
    const missing = fixture({ sessions: [], worktrees, contexts: [liveContext] });
    await expect(invokeRemoteSession(missing.deps, missing.workspace, host('codex', liveDir))).rejects.toThrow('not found');
    const reserved = fixture({ sessions: [host('codex', liveDir)], contexts: [liveContext], worktrees, reserved: (p) => p.startsWith(liveDir) });
    await expect(invokeRemoteSession(reserved.deps, reserved.workspace, host('codex', liveDir))).rejects.toThrow('being removed');
    expect(spawnPtyProcess).not.toHaveBeenCalled();
    expect(reserved.environment.resolveTerminalSpawn).not.toHaveBeenCalled();
  });

  it('keeps the canonical-path check on the launch directory', async () => {
    const f = fixture({ sessions: [host('codex', `${liveDir}/src`)], contexts: [liveContext], worktrees });
    f.environment.validateWorkspacePath.mockResolvedValueOnce({ valid: true, resolvedPath: '/somewhere/else' });
    await expect(invokeRemoteSession(f.deps, f.workspace, host('codex', liveDir))).rejects.toThrow('no longer valid');
    expect(spawnPtyProcess).not.toHaveBeenCalled();
  });
});
