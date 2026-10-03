import { describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GitService } from '../../../src/main/gitService';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import type { WorkspaceEnvironment } from '../../../src/main/environment/workspaceEnvironment';

const execFileAsync = promisify(execFile);

function readCheckedOutText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function makeService(trashWorktree: (worktreePath: string) => Promise<void> = async (worktreePath) => {
  await fs.promises.rename(worktreePath, `${worktreePath}.recycled`);
}, getLiveTerminalPaths: () => string[] = () => []): GitService {
  return new GitService(() => undefined, trashWorktree, getLiveTerminalPaths);
}

async function withRepo(run: (repo: string) => Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-worktree-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  try {
    await execFileAsync('git', ['init', '--initial-branch', 'main'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.name', 'Worktree Test'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.email', 'worktree@example.invalid'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'README.md'), 'initial\n');
    await execFileAsync('git', ['add', 'README.md'], { cwd: repo });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: repo });
    await run(repo);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('GitService worktree lifecycle', () => {
  it('creates a branch and checkout, lists it, and keeps the branch after safe removal', async () => {
    await withRepo(async (repo) => {
      const service = makeService();
      const created = await service.createWorktree(repo, 'main', 'task/example');
      expect(created.success).toBe(true);
      const checkout = created.worktree?.path ?? '';
      expect(path.basename(path.dirname(checkout))).toBe('repo-worktrees');
      expect(fs.existsSync(path.join(path.dirname(repo), 'repo-worktrees'))).toBe(true);
      expect(path.basename(checkout)).toMatch(/^task-example-[0-9a-f]{20}$/);
      expect(path.basename(checkout).length).toBeLessThanOrEqual(37);
      expect(fs.existsSync(path.join(checkout, 'README.md'))).toBe(true);
      const sibling = await service.createWorktree(checkout, 'main', 'task/second');
      expect(path.dirname(sibling.worktree?.path ?? '')).toBe(path.dirname(checkout));
      const listed = await service.listWorktrees(repo);
      expect(listed.worktrees).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: checkout.replace(/\\/g, '/'), branch: 'task/example', isMain: false }),
      ]));
      expect((await service.inspectWorktree(repo, checkout)).hasChanges).toBe(false);
      expect((await service.removeWorktree(repo, repo, 'main')).success).toBe(false);
      expect((await service.removeWorktree(repo, checkout, 'task/example')).success).toBe(true);
      expect((await service.removeWorktree(repo, sibling.worktree?.path ?? '', 'task/second')).success).toBe(true);
      expect(fs.existsSync(checkout)).toBe(false);
      const { stdout } = await execFileAsync('git', ['branch', '--list', 'task/example'], { cwd: repo });
      expect(stdout).toContain('task/example');
    });
  });

  it('prefers a local branch over a same-named tag while accepting explicit refs', async () => {
    await withRepo(async (repo) => {
      await execFileAsync('git', ['tag', 'shared'], { cwd: repo });
      fs.writeFileSync(path.join(repo, 'README.md'), 'branch tip\n');
      await execFileAsync('git', ['commit', '-am', 'Advance main'], { cwd: repo });
      await execFileAsync('git', ['branch', 'shared', 'main'], { cwd: repo });
      const service = makeService();

      const fromBranch = await service.createWorktree(repo, 'shared', 'from-branch');
      expect(fromBranch.success).toBe(true);
      expect(readCheckedOutText(path.join(fromBranch.worktree?.path ?? '', 'README.md'))).toBe('branch tip\n');

      const fromTag = await service.createWorktree(repo, 'refs/tags/shared', 'from-tag');
      expect(fromTag.success).toBe(true);
      expect(readCheckedOutText(path.join(fromTag.worktree?.path ?? '', 'README.md'))).toBe('initial\n');

      const fromExpression = await service.createWorktree(repo, 'HEAD~1', 'from-expression');
      expect(fromExpression.success).toBe(true);
      expect(readCheckedOutText(path.join(fromExpression.worktree?.path ?? '', 'README.md'))).toBe('initial\n');
    });
  });

  it('rejects invalid names, existing branches, and destination collisions without changing the checkout', async () => {
    await withRepo(async (repo) => {
      const service = makeService();
      expect((await service.createWorktree(repo, 'main', '../bad')).success).toBe(false);
      expect((await service.createWorktree(repo, 'missing-base', 'task')).success).toBe(false);
      expect((await service.createWorktree(repo, 'main', 'main')).success).toBe(false);
      const created = await service.createWorktree(repo, 'main', 'task');
      const destination = created.worktree?.path ?? '';
      expect(created.success).toBe(true);
      expect((await service.removeWorktree(repo, destination, 'task')).success).toBe(true);
      await execFileAsync('git', ['branch', '-D', 'task'], { cwd: repo });
      fs.mkdirSync(destination);
      fs.writeFileSync(path.join(destination, 'keep.txt'), 'keep');
      expect((await service.createWorktree(repo, 'main', 'task')).success).toBe(false);
      expect(fs.readFileSync(path.join(destination, 'keep.txt'), 'utf8')).toBe('keep');
      expect((await service.listWorktrees(repo)).worktrees).toHaveLength(1);
    });
  });

  it('gives distinct checkout directories to branch names with the same old flattened name', async () => {
    await withRepo(async (repo) => {
      const service = makeService();
      const first = await service.createWorktree(repo, 'main', 'task/foo/bar');
      const second = await service.createWorktree(repo, 'main', 'task/foo--bar');
      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      expect(first.worktree?.path).not.toBe(second.worktree?.path);
      expect(fs.existsSync(path.join(first.worktree?.path ?? '', 'README.md'))).toBe(true);
      expect(fs.existsSync(path.join(second.worktree?.path ?? '', 'README.md'))).toBe(true);
      expect((await service.listWorktrees(repo)).worktrees).toHaveLength(3);
    });
  });

  it('keeps checkout directory names short for long valid branches', async () => {
    await withRepo(async (repo) => {
      const branch = `feature/${'long-task-'.repeat(7)}end`;
      const created = await makeService().createWorktree(repo, 'main', branch);
      expect(created.success).toBe(true);
      expect(path.basename(created.worktree?.path ?? '').length).toBeLessThanOrEqual(37);
      expect(fs.existsSync(path.join(created.worktree?.path ?? '', 'README.md'))).toBe(true);
    });
  });

  it('serializes competing creates and keeps the successful checkout', async () => {
    await withRepo(async (repo) => {
      const service = makeService();
      const internals = service as unknown as { execGit: (cwd: string, args: string[], timeout?: number) => Promise<{ stdout: string; stderr: string }> };
      const original = internals.execGit.bind(service);
      let addCalls = 0;
      const spy = vi.spyOn(internals, 'execGit').mockImplementation(async (cwd, args, timeout) => {
        if (args[0] === 'worktree' && args[1] === 'add') {
          addCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return original(cwd, args, timeout);
      });
      const results = await Promise.all([
        service.createWorktree(repo, 'main', 'same-task'),
        service.createWorktree(repo, 'main', 'same-task'),
      ]);
      spy.mockRestore();
      expect(results.map((result) => result.success)).toEqual([true, false]);
      expect(addCalls).toBe(1);
      expect(fs.existsSync(path.join(results[0].worktree?.path ?? '', 'README.md'))).toBe(true);
      expect((await service.listWorktrees(repo)).worktrees).toHaveLength(2);
    });
  });

  it('keeps a registered checkout when a failed add cannot prove ownership', async () => {
    await withRepo(async (repo) => {
      const service = makeService();
      const internals = service as unknown as { execGit: (cwd: string, args: string[], timeout?: number) => Promise<{ stdout: string; stderr: string }> };
      const original = internals.execGit.bind(service);
      let destination = '';
      const spy = vi.spyOn(internals, 'execGit').mockImplementation(async (cwd, args, timeout) => {
        if (args[0] === 'worktree' && args[1] === 'add') {
          destination = args[4];
          await original(cwd, args, timeout);
          throw new Error('simulated response failure after checkout creation');
        }
        return original(cwd, args, timeout);
      });
      const result = await service.createWorktree(repo, 'main', 'owned-elsewhere');
      spy.mockRestore();
      expect(result.success).toBe(false);
      expect(result.error).toContain('kept because this request cannot establish ownership');
      expect(fs.existsSync(path.join(destination, 'README.md'))).toBe(true);
      expect((await service.listWorktrees(repo)).worktrees).toHaveLength(2);
    });
  });

  it('preserves a branch created externally after the preflight check', async () => {
    await withRepo(async (repo) => {
      const service = makeService();
      const internals = service as unknown as { execGit: (cwd: string, args: string[], timeout?: number) => Promise<{ stdout: string; stderr: string }> };
      const original = internals.execGit.bind(service);
      const spy = vi.spyOn(internals, 'execGit').mockImplementation(async (cwd, args, timeout) => {
        if (args[0] === 'worktree' && args[1] === 'add') {
          await execFileAsync('git', ['branch', 'external-task', 'main'], { cwd: repo });
        }
        return original(cwd, args, timeout);
      });
      const result = await service.createWorktree(repo, 'main', 'external-task');
      spy.mockRestore();
      expect(result.success).toBe(false);
      const { stdout } = await execFileAsync('git', ['branch', '--list', 'external-task'], { cwd: repo });
      expect(stdout).toContain('external-task');
      expect((await service.listWorktrees(repo)).worktrees).toHaveLength(1);
    });
  });

  it('retries a failed checkout using the branch left by that attempt', async () => {
    await withRepo(async (repo) => {
      const service = makeService();
      const internals = service as unknown as { execGit: (cwd: string, args: string[], timeout?: number) => Promise<{ stdout: string; stderr: string }> };
      const original = internals.execGit.bind(service);
      const spy = vi.spyOn(internals, 'execGit').mockImplementation(async (cwd, args, timeout) => {
        if (args[0] === 'worktree' && args[1] === 'add') {
          await original(cwd, ['branch', args[3], args[5]]);
          throw new Error('simulated checkout failure after branch creation');
        }
        return original(cwd, args, timeout);
      });
      const failed = await service.createWorktree(repo, 'main', 'retry-task');
      spy.mockRestore();
      expect(failed.success).toBe(false);
      expect((await service.listWorktrees(repo)).worktrees).toHaveLength(1);
      const { stdout: branchBefore } = await execFileAsync('git', ['rev-parse', 'refs/heads/retry-task'], { cwd: repo });

      const retried = await makeService().createWorktree(repo, 'main', 'retry-task');
      expect(retried.success).toBe(true);
      expect(fs.existsSync(path.join(retried.worktree?.path ?? '', 'README.md'))).toBe(true);
      const { stdout: branchAfter } = await execFileAsync('git', ['rev-parse', 'refs/heads/retry-task'], { cwd: repo });
      expect(branchAfter).toBe(branchBefore);
    });
  });

  it('attaches an existing unlinked branch without changing its commit', async () => {
    await withRepo(async (repo) => {
      await execFileAsync('git', ['branch', 'existing-task', 'main'], { cwd: repo });
      const { stdout: branchBefore } = await execFileAsync('git', ['rev-parse', 'refs/heads/existing-task'], { cwd: repo });
      fs.writeFileSync(path.join(repo, 'README.md'), 'main moved\n');
      await execFileAsync('git', ['commit', '-am', 'Advance main'], { cwd: repo });
      const service = makeService();
      const attached = await service.createWorktree(repo, 'main', 'existing-task');
      expect(attached.success).toBe(true);
      const { stdout: branchAfter } = await execFileAsync('git', ['rev-parse', 'refs/heads/existing-task'], { cwd: repo });
      expect(branchAfter).toBe(branchBefore);
      expect(readCheckedOutText(path.join(attached.worktree?.path ?? '', 'README.md'))).toBe('initial\n');
    });
  });

  it('refuses removal when an open workspace reaches the checkout through an alias', async () => {
    await withRepo(async (repo) => {
      const service = makeService();
      const created = await service.createWorktree(repo, 'main', 'alias-guard');
      const checkout = created.worktree?.path ?? '';
      const alias = path.join(path.dirname(repo), 'checkout-alias');
      fs.symlinkSync(checkout, alias, process.platform === 'win32' ? 'junction' : 'dir');
      const dotPath = `${checkout}${path.sep}..${path.sep}${path.basename(checkout)}`;
      expect((await service.inspectWorktree(repo, checkout, [alias])).success).toBe(false);
      expect((await service.removeWorktree(repo, checkout, 'alias-guard', [alias])).success).toBe(false);
      expect((await service.removeWorktree(repo, checkout, 'alias-guard', [path.join(alias, 'deleted-child')])).success).toBe(false);
      expect((await service.removeWorktree(repo, checkout, 'alias-guard', [dotPath])).success).toBe(false);
      expect(fs.existsSync(path.join(checkout, 'README.md'))).toBe(true);
    });
  });

  it('refuses removal for a workspace inside the checkout but allows a sibling path', async () => {
    await withRepo(async (repo) => {
      const service = makeService();
      const created = await service.createWorktree(repo, 'main', 'nested-guard');
      const checkout = created.worktree?.path ?? '';
      const nested = path.join(checkout, 'nested');
      fs.mkdirSync(nested);
      const alias = path.join(path.dirname(repo), 'nested-alias');
      fs.symlinkSync(nested, alias, process.platform === 'win32' ? 'junction' : 'dir');
      expect((await service.inspectWorktree(repo, checkout, [nested])).success).toBe(false);
      expect((await service.removeWorktree(repo, checkout, 'nested-guard', [alias])).success).toBe(false);
      expect(fs.existsSync(path.join(checkout, 'README.md'))).toBe(true);

      const sibling = `${checkout}-other`;
      fs.mkdirSync(sibling);
      expect((await service.inspectWorktree(repo, checkout, [sibling])).success).toBe(true);
    });
  });

  it('ignores a missing unrelated workspace but protects a missing path inside the checkout', async () => {
    await withRepo(async (repo) => {
      const service = makeService();
      const created = await service.createWorktree(repo, 'main', 'stale-path-guard');
      const checkout = created.worktree?.path ?? '';
      const missingInside = path.join(checkout, 'deleted-subdirectory');
      const missingOutside = path.join(path.dirname(repo), 'deleted-other-workspace');
      expect((await service.removeWorktree(repo, checkout, 'stale-path-guard', [missingInside])).success).toBe(false);
      expect((await service.inspectWorktree(repo, checkout, [missingOutside])).success).toBe(true);
      expect((await service.removeWorktree(repo, checkout, 'stale-path-guard', [missingOutside])).success).toBe(true);
    });
  });

  it('uses the main-process workspace registry when the renderer supplies no open paths', async () => {
    await withRepo(async (repo) => {
      const service = makeService();
      const created = await service.createWorktree(repo, 'main', 'registered-guard');
      const checkout = created.worktree?.path ?? '';
      expect(service.registerOpenWorkspace('tab-1', checkout)).toEqual({ success: true });
      expect((await service.inspectWorktree(repo, checkout, [])).success).toBe(false);
      expect((await service.removeWorktree(repo, checkout, 'registered-guard', [])).success).toBe(false);
      expect(fs.existsSync(path.join(checkout, 'README.md'))).toBe(true);
      service.unregisterOpenWorkspace('tab-1');
      expect((await service.removeWorktree(repo, checkout, 'registered-guard', [])).success).toBe(true);
    });
  });

  it('refuses removal while a registered checkout context uses the checkout, without any workspace tab for it', async () => {
    await withRepo(async (repo) => {
      const environment = {
        validateWorkspacePath: async (dir: string) => ({ valid: true, resolvedPath: dir }),
      } as unknown as WorkspaceEnvironment;
      const registry = new WorkspaceRegistry(() => environment);
      const service = new GitService(
        () => undefined,
        async (worktreePath) => { await fs.promises.rename(worktreePath, `${worktreePath}.recycled`); },
        () => [],
        () => registry.getLocalOpenWorkspacePaths(),
      );
      const created = await service.createWorktree(repo, 'main', 'context-guard');
      const checkout = created.worktree?.path ?? '';

      await registry.registerWorkspace({ workspaceId: 'project', workspacePath: repo });
      const context = await registry.registerCheckoutContext({ workspaceId: 'project', path: checkout, kind: 'worktree' });
      expect(context.success).toBe(true);

      expect((await service.inspectWorktree(repo, checkout, [])).success).toBe(false);
      expect((await service.removeWorktree(repo, checkout, 'context-guard', [])).success).toBe(false);
      expect(fs.existsSync(path.join(checkout, 'README.md'))).toBe(true);

      // Closing the project releases its contexts; the same safeguards then allow removal.
      registry.unregisterWorkspace('project');
      expect((await service.removeWorktree(repo, checkout, 'context-guard', [])).success).toBe(true);
    });
  });

  it('refuses removal while a main-process terminal still uses the checkout', async () => {
    await withRepo(async (repo) => {
      let terminalPath = '';
      const service = makeService(undefined, () => terminalPath ? [terminalPath] : []);
      const created = await service.createWorktree(repo, 'main', 'terminal-guard');
      const checkout = created.worktree?.path ?? '';
      terminalPath = checkout;
      expect((await service.removeWorktree(repo, checkout, 'terminal-guard', [])).success).toBe(false);
      terminalPath = '';
      expect((await service.removeWorktree(repo, checkout, 'terminal-guard', [])).success).toBe(true);
    });
  });

  it('rejects a new workspace while its checkout is being removed', async () => {
    await withRepo(async (repo) => {
      let markTrashStarted: () => void = () => undefined;
      let finishTrash: () => void = () => undefined;
      const trashStarted = new Promise<void>((resolve) => { markTrashStarted = resolve; });
      const continueTrash = new Promise<void>((resolve) => { finishTrash = resolve; });
      const service = makeService(async (worktreePath) => {
        markTrashStarted();
        await continueTrash;
        await fs.promises.rename(worktreePath, `${worktreePath}.recycled`);
      });
      const created = await service.createWorktree(repo, 'main', 'removal-reservation');
      const checkout = created.worktree?.path ?? '';
      const removal = service.removeWorktree(repo, checkout, 'removal-reservation', []);
      await trashStarted;
      expect(service.registerOpenWorkspace('late-tab', checkout).success).toBe(false);
      finishTrash();
      expect((await removal).success).toBe(true);
    });
  });

  it('preserves an ignored file written after inspection during removal', async () => {
    await withRepo(async (repo) => {
      fs.writeFileSync(path.join(repo, '.gitignore'), '.env\n');
      await execFileAsync('git', ['add', '.gitignore'], { cwd: repo });
      await execFileAsync('git', ['commit', '-m', 'Ignore local env'], { cwd: repo });
      let recycledPath = '';
      const service = makeService(async (worktreePath) => {
        fs.writeFileSync(path.join(worktreePath, '.env'), 'LOCAL_SECRET=keep\n');
        recycledPath = `${worktreePath}.recycled`;
        await fs.promises.rename(worktreePath, recycledPath);
      });
      const created = await service.createWorktree(repo, 'main', 'late-ignored-file');
      const checkout = created.worktree?.path ?? '';
      expect((await service.inspectWorktree(repo, checkout)).hasChanges).toBe(false);
      expect((await service.removeWorktree(repo, checkout, 'late-ignored-file')).success).toBe(true);
      expect(fs.readFileSync(path.join(recycledPath, '.env'), 'utf8')).toBe('LOCAL_SECRET=keep\n');
      expect((await service.listWorktrees(repo)).worktrees).toHaveLength(1);
    });
  });

  it('does not delete files recreated at the original path after staging', async () => {
    await withRepo(async (repo) => {
      let originalPath = '';
      const service = makeService(async (stagingPath) => {
        fs.mkdirSync(originalPath);
        fs.writeFileSync(path.join(originalPath, '.env'), 'keep\n');
        await fs.promises.rename(stagingPath, `${stagingPath}.recycled`);
      });
      const created = await service.createWorktree(repo, 'main', 'recreated-path');
      originalPath = created.worktree?.path ?? '';
      const removed = await service.removeWorktree(repo, originalPath, 'recreated-path');
      expect(removed.success).toBe(true);
      expect(removed.warning).toContain('left in place');
      expect(fs.readFileSync(path.join(originalPath, '.env'), 'utf8')).toBe('keep\n');
      expect((await service.listWorktrees(repo)).worktrees).toHaveLength(1);
    });
  });

  it('restores the checkout when moving it to Trash fails', async () => {
    await withRepo(async (repo) => {
      const service = makeService(async () => { throw new Error('Trash unavailable'); });
      const created = await service.createWorktree(repo, 'main', 'trash-failure');
      const checkout = created.worktree?.path ?? '';
      expect((await service.removeWorktree(repo, checkout, 'trash-failure')).success).toBe(false);
      expect(fs.existsSync(path.join(checkout, 'README.md'))).toBe(true);
      expect((await service.listWorktrees(repo)).worktrees).toHaveLength(2);
    });
  });

  it('refuses removal when an otherwise clean checkout contains an ignored local file', async () => {
    await withRepo(async (repo) => {
      fs.writeFileSync(path.join(repo, '.gitignore'), '.env\n');
      await execFileAsync('git', ['add', '.gitignore'], { cwd: repo });
      await execFileAsync('git', ['commit', '-m', 'Ignore local env'], { cwd: repo });
      const service = makeService();
      const created = await service.createWorktree(repo, 'main', 'ignored-file-guard');
      const checkout = created.worktree?.path ?? '';
      const envFile = path.join(checkout, '.env');
      fs.writeFileSync(envFile, 'LOCAL_SECRET=keep\n');

      const { stdout: ordinaryStatus } = await execFileAsync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: checkout });
      expect(ordinaryStatus).toBe('');
      expect((await service.inspectWorktree(repo, checkout)).hasChanges).toBe(true);
      expect((await service.removeWorktree(repo, checkout, 'ignored-file-guard')).error).toContain('ignored files');
      expect(fs.readFileSync(envFile, 'utf8')).toBe('LOCAL_SECRET=keep\n');

      fs.rmSync(envFile);
      expect((await service.inspectWorktree(repo, checkout)).hasChanges).toBe(false);
      expect((await service.removeWorktree(repo, checkout, 'ignored-file-guard')).success).toBe(true);
    });
  });

  it('cleans up a failed Git add and refuses removal when files or branch state change', async () => {
    await withRepo(async (repo) => {
      const service = makeService();
      const internals = service as unknown as { execGit: (cwd: string, args: string[], timeout?: number) => Promise<{ stdout: string; stderr: string }> };
      const original = internals.execGit.bind(service);
      const spy = vi.spyOn(internals, 'execGit').mockImplementation((cwd, args, timeout) => {
        if (args[0] === 'worktree' && args[1] === 'add') return Promise.reject(new Error('simulated add failure'));
        return original(cwd, args, timeout);
      });
      expect((await service.createWorktree(repo, 'main', 'failed')).success).toBe(false);
      spy.mockRestore();
      expect(fs.existsSync(path.join(path.dirname(repo), 'repo-worktrees'))).toBe(false);
      const created = await service.createWorktree(repo, 'main', 'clean');
      const checkout = created.worktree?.path ?? '';
      fs.writeFileSync(path.join(checkout, 'untracked.txt'), 'work');
      expect((await service.inspectWorktree(repo, checkout)).hasChanges).toBe(true);
      expect((await service.removeWorktree(repo, checkout, 'clean')).success).toBe(false);
      fs.rmSync(path.join(checkout, 'untracked.txt'));
      fs.writeFileSync(path.join(checkout, 'README.md'), 'changed\n');
      expect((await service.removeWorktree(repo, checkout, 'clean')).success).toBe(false);
      await execFileAsync('git', ['restore', 'README.md'], { cwd: checkout });
      expect((await service.removeWorktree(repo, checkout, 'wrong-branch')).success).toBe(false);
      expect(fs.existsSync(checkout)).toBe(true);
    });
  });
});

describe('GitService worktree prune and unlock (real Git)', () => {
  const branchExists = async (repo: string, branch: string) =>
    (await execFileAsync('git', ['branch', '--list', branch], { cwd: repo })).stdout.includes(branch);

  it('prunes only stale records: the branch and every existing checkout remain', async () => {
    await withRepo(async (repo) => {
      const service = makeService();
      const gone = (await service.createWorktree(repo, 'main', 'task/gone')).worktree!.path;
      const kept = (await service.createWorktree(repo, 'main', 'task/kept')).worktree!.path;
      fs.writeFileSync(path.join(kept, 'work.txt'), 'uncommitted\n');
      fs.rmSync(gone, { recursive: true, force: true });

      const before = await service.listWorktrees(repo);
      expect(before.worktrees.find((entry) => entry.branch === 'task/gone')?.isPrunable).toBe(true);

      const result = await service.pruneWorktrees(repo);
      expect(result).toEqual({ success: true, pruned: [expect.stringContaining('task-gone')] });

      const after = await service.listWorktrees(repo);
      expect(after.worktrees.map((entry) => entry.branch)).toEqual(['main', 'task/kept']);
      expect(await branchExists(repo, 'task/gone')).toBe(true);
      expect(fs.readFileSync(path.join(kept, 'work.txt'), 'utf8')).toBe('uncommitted\n');
      // Nothing left to prune is a successful no-op.
      expect(await service.pruneWorktrees(repo)).toEqual({ success: true, pruned: [] });
    });
  });

  it('does not prune a locked missing worktree (Git keeps it) and reports nothing pruned', async () => {
    await withRepo(async (repo) => {
      const service = makeService();
      const gone = (await service.createWorktree(repo, 'main', 'task/locked-gone')).worktree!.path;
      await execFileAsync('git', ['worktree', 'lock', gone], { cwd: repo });
      fs.rmSync(gone, { recursive: true, force: true });
      expect(await service.pruneWorktrees(repo)).toEqual({ success: true, pruned: [] });
      expect((await service.listWorktrees(repo)).worktrees.some((entry) => entry.branch === 'task/locked-gone')).toBe(true);
    });
  });

  it('refuses to prune while a removal is in flight', async () => {
    await withRepo(async (repo) => {
      let release!: () => void;
      const trash = new Promise<void>((resolve) => { release = resolve; });
      const service = makeService(async (worktreePath) => { await trash; await fs.promises.rename(worktreePath, `${worktreePath}.recycled`); });
      const checkout = (await service.createWorktree(repo, 'main', 'task/busy')).worktree!.path;
      const removing = service.removeWorktree(repo, checkout, 'task/busy');
      await vi.waitFor(() => expect(service.isWorktreeBeingRemoved(checkout)).toBe(true));
      expect(await service.pruneWorktrees(repo)).toMatchObject({ success: false, error: expect.stringContaining('in progress') });
      release();
      expect((await removing).success).toBe(true);
    });
  });

  it('unlocks a locked linked worktree and leaves its checkout and branch alone', async () => {
    await withRepo(async (repo) => {
      const service = makeService();
      const checkout = (await service.createWorktree(repo, 'main', 'task/locked')).worktree!.path;
      await execFileAsync('git', ['worktree', 'lock', '--reason', 'external', checkout], { cwd: repo });
      const locked = (await service.listWorktrees(repo)).worktrees.find((entry) => entry.branch === 'task/locked');
      expect(locked?.isLocked).toBe(true);
      // A locked checkout cannot be inspected or removed until it is unlocked.
      expect((await service.inspectWorktree(repo, checkout)).success).toBe(false);
      expect((await service.removeWorktree(repo, checkout, 'task/locked')).success).toBe(false);
      expect(fs.existsSync(checkout)).toBe(true);

      expect(await service.unlockWorktree(repo, checkout)).toEqual({ success: true });
      const unlocked = (await service.listWorktrees(repo)).worktrees.find((entry) => entry.branch === 'task/locked');
      expect(unlocked?.isLocked).toBe(false);
      expect(fs.existsSync(checkout)).toBe(true);
      expect(await branchExists(repo, 'task/locked')).toBe(true);
      // Removal is a separate, explicit step.
      expect((await service.removeWorktree(repo, checkout, 'task/locked')).success).toBe(true);
    });
  });

  it('only unlocks entries Git lists: not the main checkout, an unlocked worktree, or a foreign path', async () => {
    await withRepo(async (repo) => {
      const service = makeService();
      const open = (await service.createWorktree(repo, 'main', 'task/open')).worktree!.path;
      const foreign = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-foreign-'));
      try {
        expect(await service.unlockWorktree(repo, repo)).toMatchObject({ success: false });
        expect(await service.unlockWorktree(repo, open)).toMatchObject({ success: false, error: 'This worktree is not locked' });
        expect(await service.unlockWorktree(repo, foreign)).toMatchObject({ success: false, error: 'This is not a linked worktree' });
        expect(await service.unlockWorktree(repo, path.join(open, '..', '..'))).toMatchObject({ success: false });
      } finally {
        fs.rmSync(foreign, { recursive: true, force: true });
      }
    });
  });
});
