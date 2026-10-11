/**
 * The Git behavior the isolated-checkout lifecycle stands on, against real repositories: removing one
 * stale worktree record, the cleanliness preflight, safe-only branch deletion, and the scoped controller
 * entry points that IPC and the lifecycle service share.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const { mockHandle } = vi.hoisted(() => ({ mockHandle: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: mockHandle, on: vi.fn() }, BrowserWindow: vi.fn() }));

import { GitService } from '../../../src/main/gitService';
import { registerGitIpc, type GitIpcController } from '../../../src/main/ipc/gitIpc';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import { toPosixPath } from '../../../src/shared/pathNormalize';

const exec = promisify(execFile);
let root: string;
let repo: string;
const git = (cwd: string, ...args: string[]) => exec('git', args, { cwd }).then((result) => result.stdout);
const commit = async (cwd: string, message: string) => {
  fs.writeFileSync(path.join(cwd, `${message}.txt`), message);
  await git(cwd, 'add', '-A');
  await git(cwd, '-c', 'user.email=t@e.invalid', '-c', 'user.name=T', 'commit', '-q', '-m', message);
};

beforeEach(async () => {
  // `.native` expands Windows 8.3 short names (RUNNER~1), which Git never reports.
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-lifecycle-git-')));
  repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  await git(repo, 'init', '-q', '--initial-branch', 'main');
  await commit(repo, 'initial');
  mockHandle.mockReset();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const service = (livePaths: string[] = []) => new GitService(() => undefined, async (target) => { await fs.promises.rename(target, `${target}.trashed`); }, () => livePaths);
const addWorktree = async (branch: string) => {
  const dir = path.join(root, `wt-${branch}`);
  await git(repo, 'worktree', 'add', '-q', '-b', branch, dir);
  return fs.realpathSync.native(dir);
};

describe('Source Control branch deletion safeguards (isolated real Git)', () => {
  it('distinguishes normal and explicit force deletion of unmerged work', async () => {
    await git(repo, 'switch', '-c', 'unmerged'); await commit(repo, 'unmerged-work'); await git(repo, 'switch', 'main');
    const normal = await service().deleteBranch(repo, 'unmerged');
    expect(normal.success).toBe(false); expect(normal.blockedByUnmergedCommits).toBe(true); expect(normal.error).toBeTruthy();
    expect(await git(repo, 'branch', '--list', 'unmerged')).toContain('unmerged');
    expect((await service().forceDeleteBranch(repo, 'unmerged')).success).toBe(true);
    expect(await git(repo, 'branch', '--list', 'unmerged')).toBe('');
  });
  it('refuses normal and force deletion of the current branch and a branch attached to another worktree', async () => {
    const linked = await addWorktree('attached');
    for (const force of [false, true]) for (const name of ['main', 'attached']) {
      const result = force ? await service().forceDeleteBranch(repo, name) : await service().deleteBranch(repo, name);
      expect(result.success).toBe(false); expect(result.blockedByUnmergedCommits).not.toBe(true); expect(result.error).toBeTruthy();
      expect(await git(repo, 'branch', '--list', name)).toContain(name);
    }
    expect(fs.existsSync(linked)).toBe(true);
  });
  it('creates and switches only on Git success, retaining identity on invalid/attached branch errors', async () => {
    const target = service(); const linked = await addWorktree('attached');
    expect((await target.createBranch(repo, 'bad name', 'main')).success).toBe(false);
    expect((await target.createBranch(repo, 'new-task', 'main')).success).toBe(true);
    expect((await target.switchBranch(repo, 'new-task')).success).toBe(true);
    expect(await target.getCurrentBranch(repo)).toBe('new-task');
    expect((await target.switchBranch(repo, 'attached')).success).toBe(false);
    expect(await target.getCurrentBranch(repo)).toBe('new-task'); expect(fs.existsSync(linked)).toBe(true);
  });
});

describe('GitService.forgetMissingWorktree', () => {
  it('drops only the named stale record, leaving other stale records, branches and directories alone', async () => {
    const one = await addWorktree('one');
    const two = await addWorktree('two');
    const live = await addWorktree('live');
    fs.rmSync(one, { recursive: true, force: true });
    fs.rmSync(two, { recursive: true, force: true });

    const result = await service().forgetMissingWorktree(repo, one);
    expect(result).toEqual({ success: true });

    const listing = await service().listWorktrees(repo);
    const byPath = new Map(listing.worktrees.map((entry) => [toPosixPath(fs.existsSync(entry.path) ? fs.realpathSync.native(entry.path) : entry.path), entry]));
    expect(byPath.has(toPosixPath(one))).toBe(false); // gone
    expect(byPath.get(toPosixPath(two))?.isPrunable).toBe(true); // the other stale record is untouched
    expect(byPath.get(toPosixPath(live))).toBeDefined(); // a live worktree is untouched
    expect(fs.existsSync(live)).toBe(true);
    const branches = await git(repo, 'branch', '--list');
    for (const branch of ['one', 'two', 'live']) expect(branches).toContain(branch); // no branch deleted
  });

  it('makes deleting the branch possible: Git refuses while a stale record still names it', async () => {
    const dir = await addWorktree('gone');
    fs.rmSync(dir, { recursive: true, force: true });
    const before = await service().deleteBranch(repo, 'gone');
    expect(before.success).toBe(false);
    expect(before.error).toMatch(/used by worktree|checked out/i);

    expect((await service().forgetMissingWorktree(repo, dir)).success).toBe(true);
    expect((await service().deleteBranch(repo, 'gone')).success).toBe(true); // an unchanged branch is "fully merged"
    expect(await git(repo, 'branch', '--list')).not.toContain('gone');
  });

  it.each([
    ['a worktree whose directory still exists', async () => addWorktree('present'), /still exists/],
    ['the main checkout', async () => repo, /not a linked worktree/],
    ['a path Git does not list', async () => path.join(root, 'nope'), /not a linked worktree/],
  ])('refuses %s', async (_label, target, error) => {
    const result = await service().forgetMissingWorktree(repo, await target());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(error);
  });

  it('refuses a locked missing worktree', async () => {
    const dir = await addWorktree('locked');
    await git(repo, 'worktree', 'lock', dir);
    fs.rmSync(dir, { recursive: true, force: true });
    const result = await service().forgetMissingWorktree(repo, dir);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/locked/);
  });
});

describe('GitService.inspectWorktree preflight', () => {
  it('refuses while a terminal is inside, but the preflight can still read cleanliness', async () => {
    const dir = await addWorktree('busy');
    const busy = service([dir]);
    expect((await busy.inspectWorktree(repo, dir)).error).toMatch(/Close this workspace tab/);
    expect(await busy.inspectWorktree(repo, dir, [], { skipOpenCheck: true })).toMatchObject({ success: true, hasChanges: false });
  });

  it('reports uncommitted, untracked and ignored files', async () => {
    const dir = await addWorktree('dirty');
    expect(await service().inspectWorktree(repo, dir, [], { skipOpenCheck: true })).toMatchObject({ hasChanges: false });
    fs.writeFileSync(path.join(dir, 'untracked.txt'), 'x');
    expect(await service().inspectWorktree(repo, dir, [], { skipOpenCheck: true })).toMatchObject({ hasChanges: true });
    fs.rmSync(path.join(dir, 'untracked.txt'));
    fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored.log\n');
    await commit(repo, 'ignore'); await git(dir, 'merge', '-q', 'main');
    fs.writeFileSync(path.join(dir, 'ignored.log'), 'x');
    expect(await service().inspectWorktree(repo, dir, [], { skipOpenCheck: true })).toMatchObject({ hasChanges: true });
  });

  it('removal always runs the full check: skipping it for a preflight never weakens removal', async () => {
    const dir = await addWorktree('guarded');
    const result = await service([dir]).removeWorktree(repo, dir, 'guarded', []);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Close this workspace tab/);
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('removal still checks the branch identity it was given', async () => {
    const dir = await addWorktree('identity');
    const result = await service().removeWorktree(repo, dir, 'some-other-branch', []);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/branch changed/);
    expect(fs.existsSync(dir)).toBe(true);
  });
});

describe('safe-only branch deletion', () => {
  it('deletes a merged branch, keeps an unmerged one and reports why, and never deletes the current branch', async () => {
    const merged = await addWorktree('merged');
    await commit(merged, 'work');
    await git(repo, '-c', 'user.email=t@e.invalid', '-c', 'user.name=T', 'merge', '-q', '--no-ff', 'merged', '-m', 'merge');
    await git(repo, 'worktree', 'remove', merged);
    expect((await service().deleteBranch(repo, 'merged')).success).toBe(true);

    const unmerged = await addWorktree('unmerged');
    await commit(unmerged, 'unmerged-work');
    await git(repo, 'worktree', 'remove', '--force', unmerged);
    const kept = await service().deleteBranch(repo, 'unmerged');
    expect(kept).toMatchObject({ success: false, blockedByUnmergedCommits: true });
    expect(await git(repo, 'branch', '--list')).toContain('unmerged');

    expect(await service().deleteBranch(repo, 'main')).toMatchObject({ success: false, error: 'Cannot delete the current branch' });
  });
});

describe('GitIpcController (the scoped entry points IPC and the lifecycle service share)', () => {
  function controller(options: { environmentId?: string } = {}) {
    const git = service();
    const contexts: CheckoutContext[] = [];
    const workspace = { workspaceId: 'ws', location: { environmentId: options.environmentId ?? 'local', path: repo }, environment: {} };
    const registry = {
      getWorkspace: (id: string) => (id === 'ws' ? workspace : null),
      registerCheckoutContext: vi.fn(async (request: { workspaceId: string; path: string; kind: 'worktree'; branch?: string | null; mainCheckoutPath?: string }) => {
        const context: CheckoutContext = { id: `ws::ckt-${contexts.length}`, workspaceId: request.workspaceId, environmentId: 'local', path: request.path, kind: 'worktree', branch: request.branch, mainCheckoutPath: request.mainCheckoutPath };
        contexts.push(context);
        return { success: true, checkoutContext: context };
      }),
      getCheckoutContextsForWorkspace: () => contexts,
      getCheckoutContext: (id: string) => contexts.find((entry) => entry.id === id) ?? null,
      unregisterCheckoutContext: vi.fn(),
      getLocalOpenWorkspacePaths: () => [],
      resolveCheckoutContext: () => null,
    };
    const ipc: GitIpcController = registerGitIpc({
      getGitService: () => git, getMainWindow: () => null, getWorkspaceRegistry: () => registry as never,
    });
    return { ipc, contexts, registry };
  }

  it('reads the branch state of the workspace\'s own checkout', async () => {
    const { ipc } = controller();
    expect(await ipc.getBranchState('ws')).toMatchObject({ success: true, isRepo: true, currentBranch: 'main', isDetached: false });
  });

  it('creates a worktree for a new branch through the shared creation path and attaches it as a context', async () => {
    const { ipc, contexts, registry } = controller();
    const created = await ipc.createCheckoutWorktree('ws', 'feature', 'main');

    expect(created.success).toBe(true);
    expect(created.checkoutContext).toMatchObject({ kind: 'worktree', branch: 'feature', workspaceId: 'ws' });
    expect(fs.existsSync(created.checkoutContext!.path)).toBe(true);
    // Branch and path come from Git's own listing, and the context lives under the generated container.
    expect(created.checkoutContext!.path).toContain(`${path.basename(repo)}-worktrees`);
    expect(created.checkoutContext!.mainCheckoutPath).toBe(toPosixPath(repo));
    expect(registry.registerCheckoutContext).toHaveBeenCalledTimes(1);
    expect(contexts).toHaveLength(1);
    expect(await git(repo, 'branch', '--list')).toContain('feature');
  });

  it('refuses an invalid branch name and a name that already has a worktree, creating nothing', async () => {
    const { ipc, contexts } = controller();
    expect((await ipc.createCheckoutWorktree('ws', '-bad', 'main')).success).toBe(false);
    expect((await ipc.createCheckoutWorktree('ws', 'has space~^', 'main')).success).toBe(false);
    expect((await ipc.createCheckoutWorktree('ws', 'main', 'main')).success).toBe(false); // already the main checkout's branch
    expect(contexts).toHaveLength(0);
    expect((await git(repo, 'worktree', 'list')).trim().split('\n')).toHaveLength(1);
  });

  it('checks cleanliness, inspects and removes through the existing protections, then deletes the merged branch', async () => {
    const { ipc } = controller();
    const created = await ipc.createCheckoutWorktree('ws', 'feature', 'main');
    const dir = created.checkoutContext!.path;

    expect(await ipc.checkWorktreeClean('ws', dir)).toMatchObject({ success: true, hasChanges: false });
    fs.writeFileSync(path.join(dir, 'dirty.txt'), 'x');
    expect(await ipc.checkWorktreeClean('ws', dir)).toMatchObject({ success: true, hasChanges: true });
    fs.rmSync(path.join(dir, 'dirty.txt'));

    const inspection = await ipc.inspectWorktree('ws', dir, []);
    expect(inspection).toMatchObject({ success: true, hasChanges: false, worktree: { branch: 'feature' } });
    const removal = await ipc.removeWorktree('ws', inspection.worktree!.path, inspection.worktree!.branch, []);
    expect(removal.success).toBe(true);
    expect(fs.existsSync(dir)).toBe(false);
    expect((await ipc.deleteBranch('ws', 'feature')).success).toBe(true);
    expect(await git(repo, 'branch', '--list')).not.toContain('feature');
  });

  it('forgets a missing worktree\'s record and lists what Git lists', async () => {
    const { ipc } = controller();
    const created = await ipc.createCheckoutWorktree('ws', 'gone', 'main');
    const dir = created.checkoutContext!.path;
    fs.rmSync(dir, { recursive: true, force: true });
    const listed = await ipc.listWorktrees('ws');
    expect(listed.worktrees.find((entry) => entry.branch === 'gone')).toMatchObject({ isPrunable: true });
    expect((await ipc.forgetMissingWorktree('ws', dir)).success).toBe(true);
    expect((await ipc.listWorktrees('ws')).worktrees.some((entry) => entry.branch === 'gone')).toBe(false);
  });

  it.each(['createCheckoutWorktree', 'getBranchState', 'listWorktrees', 'checkWorktreeClean', 'inspectWorktree', 'removeWorktree', 'forgetMissingWorktree', 'deleteBranch', 'reconcileCheckoutContexts'] as const)(
    '%s refuses an unknown workspace and an SSH workspace', async (method) => {
      const argsFor: Record<string, unknown[]> = {
        createCheckoutWorktree: ['x', 'main'], getBranchState: [], listWorktrees: [], checkWorktreeClean: [repo], inspectWorktree: [repo, []],
        removeWorktree: [repo, null, []], forgetMissingWorktree: [repo], deleteBranch: ['x'], reconcileCheckoutContexts: [],
      };
      const unknown = await (controller().ipc[method] as (...args: unknown[]) => Promise<{ success: boolean }>)('nope', ...argsFor[method]);
      expect(unknown.success).toBe(false);
      const remote = await (controller({ environmentId: 'vps' }).ipc[method] as (...args: unknown[]) => Promise<{ success: boolean; error?: string }>)('ws', ...argsFor[method]);
      expect(remote.success).toBe(false);
      expect(remote.error).toMatch(/local workspaces only/);
    });
});
