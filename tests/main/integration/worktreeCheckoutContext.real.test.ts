/**
 * One workspace, two execution roots: end-to-end through the real IPC handlers, a real Git
 * repository, the real GitService, the real WorkspaceRegistry and the real local environment.
 * Only Electron and node-pty are replaced.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { testHome } from '../../_helpers/tempPaths';

const { handlers, mockPtySpawn } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  mockPtySpawn: vi.fn(),
}));

vi.mock('node-pty', () => ({ spawn: mockPtySpawn }));
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => testHome()), on: vi.fn(), quit: vi.fn() },
  BrowserWindow: vi.fn(),
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => { handlers.set(channel, fn); }, on: vi.fn() },
  clipboard: { writeText: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openExternal: vi.fn() },
}));
// The real validators are used; only the electron-store backed module around them is bypassed.
vi.mock('../../../src/main/ipc/settingsIpc', async () => {
  const { resolveExistingDirectory } = await import('../../../src/main/security');
  const { toNativePath } = await import('../../../src/shared/pathNormalize');
  return {
    getValidatedWorkspacePath: (value: string) => (value ? resolveExistingDirectory(toNativePath(value, process.platform)) : null),
    getInvalidWorkspaceResult: () => ({ success: false, error: 'Workspace path is invalid or not a directory' }),
    refreshGitStatus: vi.fn(),
  };
});

import { registerGitIpc } from '../../../src/main/ipc/gitIpc';
import { registerTerminalIpc } from '../../../src/main/ipc/terminalIpc';
import { GitService } from '../../../src/main/gitService';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import { LocalEnvironment } from '../../../src/main/environment/localEnvironment';
import { mainCheckoutContextId } from '../../../src/shared/checkoutContext';
import { toPosixPath } from '../../../src/shared/pathNormalize';
import {
  REGISTER_OPEN_WORKSPACE, SPAWN_TERMINAL, GIT_CREATE_WORKTREE, GIT_LIST_WORKTREES,
  RELEASE_CHECKOUT_CONTEXT, GIT_INSPECT_WORKTREE, GIT_REMOVE_WORKTREE, KILL_TERMINAL, ADOPT_WORKTREE_CHECKOUT_CONTEXT,
  RECONCILE_CHECKOUT_CONTEXTS,
} from '../../../src/shared/ipcChannels';
import type { CheckoutContext, ReconcileCheckoutContextsResult, ReleaseCheckoutContextResult } from '../../../src/shared/types/checkoutContext';
import { releaseCheckoutContext } from '../../../src/main/checkoutContextRelease';
import type { GitWorktreeCreateResult, GitWorktreeInspectionResult, GitWorktreeListResult, GitWorktreeRemoveResult } from '../../../src/shared/types/git';

const execFileAsync = promisify(execFile);
const call = <T>(channel: string, ...args: unknown[]): Promise<T> => Promise.resolve(handlers.get(channel)!(null, ...args) as T);

let root: string;
let repo: string;
let service: GitService;
let registry: WorkspaceRegistry;
const terminals = new Map();
const onCheckoutContextsGone = vi.fn();

async function git(...args: string[]) {
  return execFileAsync('git', args, { cwd: repo });
}

beforeAll(async () => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-ckt-real-')));
  repo = path.join(root, 'clanker');
  fs.mkdirSync(repo);
  await git('init', '--initial-branch', 'main');
  await git('config', 'user.name', 'Context Test');
  await git('config', 'user.email', 'context@example.invalid');
  fs.writeFileSync(path.join(repo, 'README.md'), 'initial\n');
  await git('add', 'README.md');
  await git('commit', '-m', 'Initial commit');
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  handlers.clear();
  terminals.clear();
  mockPtySpawn.mockReset();
  mockPtySpawn.mockReturnValue({ pid: 99, write: vi.fn(), onData: vi.fn(), onExit: vi.fn(), kill: vi.fn(), resize: vi.fn() });
  const local = new LocalEnvironment();
  registry = new WorkspaceRegistry(() => local, { isWorktreeBeingRemoved: (p) => service.isWorktreeBeingRemoved(p) });
  // Live terminal directories feed the removal safeguards exactly as in main.ts.
  service = new GitService(
    () => undefined,
    async () => undefined,
    () => [...terminals.values()].map((terminal) => terminal.cwd as string | undefined).filter((cwd): cwd is string => typeof cwd === 'string'),
    () => registry.getLocalOpenWorkspacePaths(),
  );
  registerGitIpc({
    getGitService: () => service, getMainWindow: () => null, getWorkspaceRegistry: () => registry,
    // Exactly as main.ts wires it: the release check over main's own terminal table.
    releaseCheckoutContext: (workspaceId, checkoutContextId) => releaseCheckoutContext({ registry, terminals: terminals.values(), workspaceId, checkoutContextId }),
    onCheckoutContextsGone,
  });
  registerTerminalIpc({
    getTerminals: () => terminals,
    getMainWindow: () => null,
    getStore: () => ({ get: (key: string) => (key === 'harnessDefaults' ? {} : false) }) as never,
    getSafeWorkspacePath: (dir) => (fs.existsSync(dir) ? dir : testHome()),
    getHarnessOptions: () => ({}),
    getWorkspaceRegistry: () => registry,
  });
});

async function openWorkspace(id = 'ws') {
  const result = await call<{ success: boolean; checkoutContext?: CheckoutContext }>(REGISTER_OPEN_WORKSPACE, id, toPosixPath(repo));
  expect(result.success).toBe(true);
  return result.checkoutContext!;
}

/** `attach` mirrors the explicit opt-in; without it a workspace id only routes the Git operation. */
const create = (workspaceId: string | undefined, branch: string, attach = workspaceId !== undefined) =>
  workspaceId === undefined
    ? call<GitWorktreeCreateResult>(GIT_CREATE_WORKTREE, toPosixPath(repo), 'main', branch, undefined, attach ? { attachCheckoutContext: true } : undefined)
    : call<GitWorktreeCreateResult>(GIT_CREATE_WORKTREE, toPosixPath(repo), 'main', branch, workspaceId, attach ? { attachCheckoutContext: true } : undefined);

const spawn = (dir: string, workspaceId: string | undefined, contextId?: string) =>
  call<{ id: string; checkoutContextId?: string }>(SPAWN_TERMINAL, toPosixPath(dir), undefined, undefined, undefined, undefined, workspaceId, workspaceId ? 'local' : undefined, contextId);

const spawnedCwd = () => mockPtySpawn.mock.calls[mockPtySpawn.mock.calls.length - 1]?.[2]?.cwd;

describe('workspace-scoped worktree creation (local, real Git)', () => {
  it('creates a real linked worktree and attaches it as a second context of the same workspace', async () => {
    const main = await openWorkspace();
    expect(main).toMatchObject({ id: mainCheckoutContextId('ws'), kind: 'main', path: toPosixPath(repo) });

    const result = await create('ws', 'issue-90-test');

    expect(result.success).toBe(true);
    const checkout = result.worktree!.path;
    expect(fs.existsSync(path.join(checkout, 'README.md'))).toBe(true);
    expect(result.checkoutContext).toMatchObject({
      workspaceId: 'ws',
      environmentId: 'local',
      kind: 'worktree',
      branch: 'issue-90-test',
      path: toPosixPath(fs.realpathSync.native(checkout)),
      // From `git worktree list`: the repository's main checkout.
      mainCheckoutPath: toPosixPath(repo),
    });
    expect(path.dirname(checkout)).toBe(toPosixPath(path.join(root, 'clanker-worktrees')));

    // Still exactly one workspace with its root untouched, now owning two contexts.
    expect(registry.getAllWorkspaces().map((entry) => entry.location.path)).toEqual([toPosixPath(repo)]);
    expect(registry.getCheckoutContextsForWorkspace('ws').map((entry) => entry.id)).toEqual([main.id, result.checkoutContext!.id]);
    expect(registry.resolveCheckoutContext('ws')?.path).toBe(toPosixPath(repo));
    // The context returned to the renderer is the one main registered.
    expect(registry.getCheckoutContext(result.checkoutContext!.id)).toEqual(result.checkoutContext);
    // Git itself agrees, and the branch is a real branch.
    expect((await git('branch', '--list', 'issue-90-test')).stdout).toContain('issue-90-test');
  });

  it('keeps the legacy flow: no workspace id creates the worktree and attaches nothing', async () => {
    await openWorkspace();
    const before = registry.getAllCheckoutContexts().length;

    const result = await create(undefined, 'legacy-flow');

    expect(result.success).toBe(true);
    expect(result).not.toHaveProperty('checkoutContext');
    expect(fs.existsSync(path.join(result.worktree!.path, 'README.md'))).toBe(true);
    expect(registry.getAllCheckoutContexts()).toHaveLength(before);
    expect(registry.getAllWorkspaces()).toHaveLength(1);
  });

  it('a workspace id alone does not attach a context (open-repository workspace used by the legacy flow)', async () => {
    await openWorkspace();

    const result = await create('ws', 'routing-only', false);

    expect(result.success).toBe(true);
    expect(result).not.toHaveProperty('checkoutContext');
    expect(fs.existsSync(path.join(result.worktree!.path, 'README.md'))).toBe(true);
    expect(registry.getCheckoutContextsForWorkspace('ws')).toHaveLength(1);
  });

  it('asking to attach without a registered workspace creates nothing', async () => {
    const result = await create(undefined, 'orphan-attach', true);
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('registered workspace is required') });
    expect((await git('branch', '--list', 'orphan-attach')).stdout).toBe('');
  });

  it('rejects an unregistered workspace id before creating anything', async () => {
    await expect(create('nope', 'ghost-branch')).rejects.toThrow('no longer registered');
    expect((await git('branch', '--list', 'ghost-branch')).stdout).toBe('');
  });

  it('on a failed attach keeps the checkout and branch, reports a partial result, and lists the checkout normally', async () => {
    await openWorkspace();
    const register = vi.spyOn(registry, 'registerCheckoutContext').mockResolvedValueOnce({ success: false, error: 'registry unavailable' });

    const result = await create('ws', 'partial-attach');

    expect(register).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: false, created: true, error: expect.stringContaining('registry unavailable') });
    expect(result).not.toHaveProperty('checkoutContext');
    const checkout = result.worktree!.path;
    expect(fs.existsSync(path.join(checkout, 'README.md'))).toBe(true);
    expect((await git('branch', '--list', 'partial-attach')).stdout).toContain('partial-attach');
    expect(registry.getCheckoutContextsForWorkspace('ws')).toHaveLength(1);

    const listed = await call<GitWorktreeListResult>(GIT_LIST_WORKTREES, toPosixPath(repo), 'ws');
    expect(listed.worktrees.map((entry) => entry.branch)).toContain('partial-attach');
  });

  it('does not attach a checkout that Git does not report as a linked worktree', async () => {
    await openWorkspace();
    // createWorktree consults Git's listing itself; only the listing taken after it is falsified.
    const realCreate = service.createWorktree.bind(service);
    vi.spyOn(service, 'createWorktree').mockImplementation(async (...args) => {
      const created = await realCreate(...args);
      vi.spyOn(service, 'listWorktrees').mockResolvedValue({
        success: true, worktrees: [{ path: toPosixPath(repo), branch: 'main', isMain: true, isLocked: false, isPrunable: false }],
      });
      return created;
    });
    const result = await create('ws', 'unlisted');
    expect(result).toMatchObject({ success: false, created: true });
    expect(registry.getCheckoutContextsForWorkspace('ws')).toHaveLength(1);
  });

  it('a context registered for the new checkout keeps the Phase 1 removal safeguards in force', async () => {
    await openWorkspace();
    const { worktree, checkoutContext } = await create('ws', 'protected-removal');

    const nativeRepo = repo;
    const blocked = await service.removeWorktree(nativeRepo, worktree!.path, 'protected-removal', []);
    expect(blocked.success).toBe(false);
    expect(fs.existsSync(path.join(worktree!.path, 'README.md'))).toBe(true);

    // Releasing the context is a deliberate, separate step (not wired to the UI in this slice).
    registry.unregisterCheckoutContext(checkoutContext!.id);
    expect((await service.inspectWorktree(nativeRepo, worktree!.path, [])).success).toBe(true);
  });
});

describe('main and worktree agents coexist in one workspace (local, real Git)', () => {
  it('launches into each context at its own root, with each terminal bound to its context', async () => {
    const main = await openWorkspace();
    const created = await create('ws', 'coexist');
    const wt = created.checkoutContext!;

    const a = await spawn(repo, 'ws');
    expect(spawnedCwd()).toBe(repo);
    const b = await spawn(wt.path, 'ws', wt.id);
    expect(spawnedCwd()).toBe(path.normalize(wt.path));

    expect(a.checkoutContextId).toBe(main.id);
    expect(b.checkoutContextId).toBe(wt.id);
    expect(terminals.get(a.id)).toMatchObject({ checkoutContextId: main.id });
    expect(terminals.get(b.id)).toMatchObject({ checkoutContextId: wt.id });
    expect(registry.getAllWorkspaces()).toHaveLength(1);
  });

  it('confines each launch to its own root', async () => {
    const main = await openWorkspace();
    const wt = (await create('ws', 'confined')).checkoutContext!;
    mockPtySpawn.mockClear();

    await expect(spawn(wt.path, 'ws')).rejects.toThrow('outside the registered workspace');
    await expect(spawn(wt.path, 'ws', main.id)).rejects.toThrow('outside the registered workspace');
    await expect(spawn(repo, 'ws', wt.id)).rejects.toThrow('outside the registered workspace');
    await expect(spawn(root, 'ws', wt.id)).rejects.toThrow('outside the registered workspace');
    expect(mockPtySpawn).not.toHaveBeenCalled();
  });

  it('does not let another workspace use this workspace\'s worktree context', async () => {
    await openWorkspace('ws');
    const wt = (await create('ws', 'not-shared')).checkoutContext!;
    const other = path.join(root, 'other-project');
    fs.mkdirSync(other, { recursive: true });
    await call(REGISTER_OPEN_WORKSPACE, 'other', toPosixPath(other));
    mockPtySpawn.mockClear();

    await expect(spawn(wt.path, 'other', wt.id)).rejects.toThrow('Checkout context is not registered for this workspace');
    expect(mockPtySpawn).not.toHaveBeenCalled();
  });
});

describe('releasing and removing a worktree checkout (local, real Git)', () => {
  const release = (workspaceId: string, contextId: string) => call<ReleaseCheckoutContextResult>(RELEASE_CHECKOUT_CONTEXT, workspaceId, contextId);
  /** The same calls, in the same order and with the same arguments, as the renderer helper makes. */
  const inspect = (worktreePath: string) =>
    call<GitWorktreeInspectionResult>(GIT_INSPECT_WORKTREE, toPosixPath(repo), toPosixPath(worktreePath), registry.getLocalOpenWorkspacePaths(), 'ws');
  const remove = (worktreePath: string, expectedBranch: string | null) =>
    call<GitWorktreeRemoveResult>(GIT_REMOVE_WORKTREE, toPosixPath(repo), toPosixPath(worktreePath), expectedBranch, registry.getLocalOpenWorkspacePaths(), 'ws');
  const finish = async (context: CheckoutContext) => {
    const released = await release('ws', context.id);
    if (!released.success) return { released } as const;
    const inspection = await inspect(context.path);
    if (!inspection.success || inspection.hasChanges) return { released, inspection } as const;
    return { released, inspection, removal: await remove(inspection.worktree!.path, inspection.worktree!.branch) } as const;
  };
  const contextsOf = () => registry.getCheckoutContextsForWorkspace('ws').map((entry) => entry.id);

  it('releases and then removes a clean checkout, keeping the branch, the workspace and the main context', async () => {
    const main = await openWorkspace();
    const { checkoutContext } = await create('ws', 'finish-clean');
    const checkout = checkoutContext!.path;

    const outcome = await finish(checkoutContext!);

    expect(outcome.released).toEqual({ success: true });
    expect(outcome.removal).toMatchObject({ success: true });
    expect(fs.existsSync(checkout)).toBe(false);
    // Removing a worktree never deletes its branch.
    expect((await git('branch', '--list', 'finish-clean')).stdout).toContain('finish-clean');
    expect(contextsOf()).toEqual([main.id]);
    expect(registry.getWorkspace('ws')).not.toBeNull();
    expect((await git('worktree', 'list', '--porcelain')).stdout).not.toContain('finish-clean');
  });

  it('refuses to release while a terminal runs in the context; closing it lets the same sequence finish', async () => {
    await openWorkspace();
    const { checkoutContext } = await create('ws', 'busy-then-done');
    const agent = await spawn(checkoutContext!.path, 'ws', checkoutContext!.id);

    const blocked = await release('ws', checkoutContext!.id);
    expect(blocked).toMatchObject({ success: false, activeTerminals: 1 });
    expect(contextsOf()).toContain(checkoutContext!.id);
    expect(fs.existsSync(checkoutContext!.path)).toBe(true);

    await call(KILL_TERMINAL, agent.id);
    const outcome = await finish(checkoutContext!);
    expect(outcome.removal).toMatchObject({ success: true });
    expect(fs.existsSync(checkoutContext!.path)).toBe(false);
  });

  it('does not let a terminal launch into a released context', async () => {
    await openWorkspace();
    const { checkoutContext } = await create('ws', 'no-relaunch');
    await release('ws', checkoutContext!.id);
    mockPtySpawn.mockClear();

    await expect(spawn(checkoutContext!.path, 'ws', checkoutContext!.id)).rejects.toThrow('Checkout context is not registered for this workspace');
    expect(mockPtySpawn).not.toHaveBeenCalled();
  });

  it.each([
    ['an untracked file', (dir: string) => fs.writeFileSync(path.join(dir, 'notes.txt'), 'wip\n')],
    ['a modified tracked file', (dir: string) => fs.writeFileSync(path.join(dir, 'README.md'), 'changed\n')],
    ['an ignored file', (dir: string) => {
      fs.writeFileSync(path.join(dir, '.gitignore'), 'secret.env\n');
      gitIn(dir, ['add', '.gitignore']);
      gitIn(dir, ['commit', '-m', 'ignore secrets']);
      fs.writeFileSync(path.join(dir, 'secret.env'), 'token\n');
    }],
  ])('refuses to remove a checkout with %s, leaving it on disk and the context released', async (_label, dirty) => {
    await openWorkspace();
    const { checkoutContext } = await create('ws', `dirty-${Math.random().toString(36).slice(2, 8)}`);
    dirty(checkoutContext!.path);

    const outcome = await finish(checkoutContext!);

    expect(outcome.released).toEqual({ success: true });
    expect(outcome.inspection).toMatchObject({ success: true, hasChanges: true });
    expect(outcome).not.toHaveProperty('removal');
    // The existing removal path refuses too, independently of the inspection step.
    expect(await remove(checkoutContext!.path, checkoutContext!.branch!)).toMatchObject({ success: false, error: expect.stringContaining('uncommitted, untracked, or ignored') });
    expect(fs.existsSync(path.join(checkoutContext!.path, '.git'))).toBe(true);
    // A failed removal never re-registers the checkout.
    expect(contextsOf()).toEqual([mainCheckoutContextId('ws')]);
  });

  it('refuses to remove when the branch is not the expected one, leaving the checkout on disk', async () => {
    await openWorkspace();
    const { checkoutContext } = await create('ws', 'expected-branch');
    await release('ws', checkoutContext!.id);

    const wrong = await remove(checkoutContext!.path, 'some-other-branch');

    expect(wrong).toMatchObject({ success: false, error: expect.stringContaining('branch changed') });
    expect(fs.existsSync(path.join(checkoutContext!.path, 'README.md'))).toBe(true);
  });

  it('refuses when the checkout switches branch between inspection and removal', async () => {
    await openWorkspace();
    const { checkoutContext } = await create('ws', 'switch-after-inspect');
    await release('ws', checkoutContext!.id);
    const inspection = await inspect(checkoutContext!.path);
    expect(inspection).toMatchObject({ success: true, hasChanges: false });

    gitIn(checkoutContext!.path, ['switch', '-c', 'switched-meanwhile']);
    const removal = await remove(checkoutContext!.path, inspection.worktree!.branch);

    expect(removal).toMatchObject({ success: false, error: expect.stringContaining('branch changed') });
    expect(fs.existsSync(path.join(checkoutContext!.path, 'README.md'))).toBe(true);
    expect(contextsOf()).toEqual([mainCheckoutContextId('ws')]);
  });

  it('having just released the context does not bypass the live-terminal safeguard on the directory', async () => {
    await openWorkspace();
    const { checkoutContext } = await create('ws', 'terminal-after-release');
    await release('ws', checkoutContext!.id);
    // A path-only launch resolves no context, so release can no longer see it: the existing
    // directory-based safeguard must.
    await spawn(checkoutContext!.path, undefined);

    expect(await inspect(checkoutContext!.path)).toMatchObject({ success: false });
    expect(await remove(checkoutContext!.path, checkoutContext!.branch!)).toMatchObject({ success: false });
    expect(fs.existsSync(path.join(checkoutContext!.path, 'README.md'))).toBe(true);
  });

  it('still protects a checkout that another workspace has opened as its own root', async () => {
    await openWorkspace();
    const { checkoutContext } = await create('ws', 'opened-elsewhere');
    await call(REGISTER_OPEN_WORKSPACE, 'legacy-tab', toPosixPath(checkoutContext!.path));
    await release('ws', checkoutContext!.id);

    expect(await inspect(checkoutContext!.path)).toMatchObject({ success: false });
    expect(fs.existsSync(path.join(checkoutContext!.path, 'README.md'))).toBe(true);
  });
});

function gitIn(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

describe('explicit adoption of an existing linked worktree (local, real Git)', () => {
  const adopt = (workspaceId: unknown, worktreePath: unknown) =>
    call<{ success: boolean; checkoutContext?: CheckoutContext; error?: string }>(ADOPT_WORKTREE_CHECKOUT_CONTEXT, workspaceId, worktreePath);
  let made = 0;
  /** A worktree created outside Clanker, so no context exists for it. */
  async function externalWorktree(extraArgs: string[] = []) {
    const branch = `external-${++made}`;
    const dir = path.join(root, 'external', branch);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await git('worktree', 'add', ...extraArgs, '-b', branch, dir);
    return { branch, dir };
  }

  it('adopts a listed linked worktree as a worktree context with main-derived fields', async () => {
    const main = await openWorkspace();
    const { branch, dir } = await externalWorktree();

    const result = await adopt('ws', toPosixPath(dir));

    expect(result.success).toBe(true);
    expect(result.checkoutContext).toMatchObject({
      workspaceId: 'ws', environmentId: 'local', kind: 'worktree', branch,
      path: toPosixPath(fs.realpathSync.native(dir)), mainCheckoutPath: toPosixPath(repo),
    });
    expect(registry.getCheckoutContextsForWorkspace('ws').map((entry) => entry.id)).toEqual([main.id, result.checkoutContext!.id]);
    expect(registry.getAllWorkspaces()).toHaveLength(1);
    // Idempotent: adopting again returns the same context rather than a second one.
    expect((await adopt('ws', toPosixPath(dir))).checkoutContext?.id).toBe(result.checkoutContext!.id);
    expect(registry.getCheckoutContextsForWorkspace('ws')).toHaveLength(2);
    // And the adopted root is a usable, confined launch root.
    const terminal = await spawn(dir, 'ws', result.checkoutContext!.id);
    expect(terminal.checkoutContextId).toBe(result.checkoutContext!.id);
    expect(fs.realpathSync.native(spawnedCwd())).toBe(fs.realpathSync.native(dir));
  });

  it('registers Git\'s listed path, so a symlinked spelling of the same worktree resolves to its real root', async () => {
    await openWorkspace();
    const { dir } = await externalWorktree();
    const link = path.join(root, `link-${made}`);
    fs.symlinkSync(dir, link);
    const result = await adopt('ws', toPosixPath(link));
    expect(result.success).toBe(true);
    expect(result.checkoutContext?.path).toBe(toPosixPath(fs.realpathSync.native(dir)));
  });

  it.each([
    ['the main checkout', () => toPosixPath(repo), 'main checkout'],
    ['a directory Git does not list', () => toPosixPath(root), 'does not list'],
    ['a subdirectory of a listed worktree', () => '', 'does not list'],
    ['an empty path', () => '   ', 'Choose a worktree'],
  ])('rejects %s and registers nothing', async (_label, pick, message) => {
    await openWorkspace();
    const { dir } = await externalWorktree();
    const target = _label === 'a subdirectory of a listed worktree' ? toPosixPath(path.join(dir, '.git')) : pick();
    const result = await adopt('ws', target);
    expect(result.success).toBe(false);
    expect(result.error).toContain(message);
    expect(registry.getCheckoutContextsForWorkspace('ws')).toHaveLength(1);
  });

  it('rejects a non-string path and an unknown workspace', async () => {
    await openWorkspace();
    expect((await adopt('ws', { path: '/x' })).success).toBe(false);
    expect((await adopt('ws', undefined)).success).toBe(false);
    await expect(adopt('nope', toPosixPath(repo))).rejects.toThrow('no longer registered');
  });

  it('rejects a missing (prunable) worktree and a locked one, with the Git-menu hint', async () => {
    await openWorkspace();
    const gone = await externalWorktree();
    fs.rmSync(gone.dir, { recursive: true, force: true });
    const missing = await adopt('ws', toPosixPath(gone.dir));
    expect(missing.success).toBe(false);
    expect(missing.error).toContain('missing');

    const stuck = await externalWorktree();
    await git('worktree', 'lock', stuck.dir);
    const locked = await adopt('ws', toPosixPath(stuck.dir));
    expect(locked.success).toBe(false);
    expect(locked.error).toContain('locked');
    expect(registry.getCheckoutContextsForWorkspace('ws')).toHaveLength(1);
  });

  it('refuses to adopt the workspace\'s own checkout when the workspace is itself a linked worktree', async () => {
    const own = await externalWorktree();
    const opened = await call<{ success: boolean }>(REGISTER_OPEN_WORKSPACE, 'linked', toPosixPath(own.dir));
    expect(opened.success).toBe(true);
    const result = await adopt('linked', toPosixPath(own.dir));
    expect(result.success).toBe(false);
    expect(result.error).toContain('own checkout');
    expect(registry.getCheckoutContextsForWorkspace('linked')).toHaveLength(1);
  });

  it('does not let another repository\'s workspace adopt this repository\'s worktree', async () => {
    await openWorkspace('ws');
    const { dir } = await externalWorktree();

    const other = path.join(root, 'other-repo');
    fs.mkdirSync(other);
    await execFileAsync('git', ['init', '--initial-branch', 'main'], { cwd: other });
    await execFileAsync('git', ['config', 'user.name', 'Other'], { cwd: other });
    await execFileAsync('git', ['config', 'user.email', 'other@example.invalid'], { cwd: other });
    fs.writeFileSync(path.join(other, 'a.txt'), 'a\n');
    await execFileAsync('git', ['add', 'a.txt'], { cwd: other });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: other });
    expect((await call<{ success: boolean }>(REGISTER_OPEN_WORKSPACE, 'foreign', toPosixPath(other))).success).toBe(true);

    const result = await adopt('foreign', toPosixPath(dir));
    expect(result.success).toBe(false);
    expect(registry.getCheckoutContextsForWorkspace('foreign')).toHaveLength(1);
    expect(registry.getCheckoutContextsForWorkspace('ws')).toHaveLength(1);
  });
});

describe('reconciling worktree contexts with Git after an agent finishes a worktree itself (local, real Git)', () => {
  const reconcile = (workspaceId: unknown) => call<ReconcileCheckoutContextsResult>(RECONCILE_CHECKOUT_CONTEXTS, workspaceId);

  it('marks the checkout an agent merged and removed while the agent is open, and drops it once the agent is closed', async () => {
    await openWorkspace();
    const { checkoutContext } = await create('ws', 'agent-finishes-this');
    const agent = await spawn(checkoutContext!.path, 'ws', checkoutContext!.id);

    // The agent, on its own: back to the main checkout, remove the worktree, delete the branch.
    await git('worktree', 'remove', checkoutContext!.path);
    await git('branch', '-D', 'agent-finishes-this');

    onCheckoutContextsGone.mockClear();
    const marked = await reconcile('ws');
    expect(onCheckoutContextsGone).toHaveBeenCalledWith('ws', [checkoutContext!.id]);
    expect(marked.success).toBe(true);
    expect(marked.dropped).toEqual([]);
    expect(marked.contexts).toEqual([expect.objectContaining({ id: checkoutContext!.id, missing: true })]);
    // The agent's launch binding is untouched.
    expect(terminals.get(agent.id)).toMatchObject({ checkoutContextId: checkoutContext!.id });

    await call(KILL_TERMINAL, agent.id);
    const dropped = await reconcile('ws');
    expect(dropped).toEqual({ success: true, contexts: [], dropped: [checkoutContext!.id] });
    expect(registry.getCheckoutContext(checkoutContext!.id)).toBeNull();
    expect(registry.getCheckoutContext(mainCheckoutContextId('ws'))).not.toBeNull();
  });

  it('follows a branch switch inside a checkout that is still there', async () => {
    await openWorkspace();
    const { checkoutContext } = await create('ws', 'switch-inside');
    await execFileAsync('git', ['switch', '-c', 'switched-by-agent'], { cwd: checkoutContext!.path });

    const result = await reconcile('ws');
    expect(result.contexts).toEqual([expect.objectContaining({ id: checkoutContext!.id, branch: 'switched-by-agent', missing: false })]);
  });

  it('refuses an unknown workspace', async () => {
    await openWorkspace();
    // Like every workspace-scoped Git channel, an unknown or malformed identity is refused outright.
    await expect(reconcile('nope')).rejects.toThrow('no longer registered');
    await expect(reconcile(42)).rejects.toThrow('Invalid workspace identity');
  });
});
