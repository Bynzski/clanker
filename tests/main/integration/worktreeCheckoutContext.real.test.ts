/**
 * One workspace, two execution roots: end-to-end through the real IPC handlers, a real Git
 * repository, the real GitService, the real WorkspaceRegistry and the real local environment.
 * Only Electron and node-pty are replaced.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
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
import { REGISTER_OPEN_WORKSPACE, SPAWN_TERMINAL, GIT_CREATE_WORKTREE, GIT_LIST_WORKTREES } from '../../../src/shared/ipcChannels';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import type { GitWorktreeCreateResult, GitWorktreeListResult } from '../../../src/shared/types/git';

const execFileAsync = promisify(execFile);
const call = <T>(channel: string, ...args: unknown[]): Promise<T> => Promise.resolve(handlers.get(channel)!(null, ...args) as T);

let root: string;
let repo: string;
let service: GitService;
let registry: WorkspaceRegistry;
const terminals = new Map();

async function git(...args: string[]) {
  return execFileAsync('git', args, { cwd: repo });
}

beforeAll(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-ckt-real-')));
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
  service = new GitService(() => undefined, async () => undefined, () => [], () => registry.getLocalOpenWorkspacePaths());
  registerGitIpc({ getGitService: () => service, getMainWindow: () => null, getWorkspaceRegistry: () => registry });
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
      path: toPosixPath(fs.realpathSync(checkout)),
      // From `git worktree list`: the repository's main checkout.
      mainCheckoutPath: toPosixPath(repo),
    });
    expect(path.dirname(checkout)).toBe(path.join(root, 'clanker-worktrees'));

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
