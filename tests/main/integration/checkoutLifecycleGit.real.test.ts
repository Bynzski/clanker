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
