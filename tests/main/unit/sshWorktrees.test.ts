import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SshEnvironment } from '../../../src/main/remote/sshEnvironment';
import { SshCommandExecutor, SshExecutionError } from '../../../src/main/remote/sshCommandExecutor';
import { worktreeDirectoryName } from '../../../src/main/worktreePaths';

const exec = promisify(execFile);
describe.skipIf(process.platform === 'win32')('SSH worktrees on a real POSIX host fixture', () => {
  let fixture: string;
  let root: string;
  let environment: SshEnvironment;
  let executor: SshCommandExecutor;
  const git = (args: string[]) => exec('git', ['-C', root, ...args]);
  beforeEach(async () => {
    // macOS temporary paths commonly have symlinked ancestors (e.g. /var).
    fixture = await realpath(await mkdtemp(join(tmpdir(), 'clanker-ssh-worktrees-')));
    root = join(fixture, 'repo with spaces');
    await mkdir(root);
    await git(['init', '-b', 'main']);
    await git(['config', 'user.name', 'Test']);
    await git(['config', 'user.email', 'test@example.com']);
    await writeFile(join(root, 'tracked.txt'), 'initial');
    await git(['add', '.']);
    await git(['commit', '-m', 'initial']);
    executor = { exec: vi.fn(async (target: string, command: string, args: string[]) => {
      expect(target).toBe('user@host');
      expect(command).toBe('python3');
      try {
        const result = await exec(command, args);
        return { ...result, exitCode: 0 };
      } catch (cause) {
        const error = cause as Error & { code: number; stdout: string; stderr: string };
        throw new SshExecutionError(error.message, error.code, error.stdout, error.stderr);
      }
    }) } as unknown as SshCommandExecutor;
    environment = new SshEnvironment({ id: 'ssh-host', kind: 'ssh', label: 'Host', target: 'user@host' }, executor);
  });
  afterEach(async () => { await rm(fixture, { recursive: true, force: true }); });

  it('creates a branch checkout through SSH and prefers a branch over an identically named tag', async () => {
    await git(['tag', 'base']);
    await writeFile(join(root, 'tracked.txt'), 'branch commit');
    await git(['commit', '-am', 'branch commit']);
    await git(['branch', 'base']);
    const result = await environment.createWorktree(root, 'base', 'task/new');
    const destination = join(fixture, 'repo with spaces-worktrees', worktreeDirectoryName('task/new'));
    expect(result).toMatchObject({ success: true, worktree: { path: destination, branch: 'task/new' } });
    expect(await readFile(join(destination, 'tracked.txt'), 'utf8')).toBe('branch commit');
    expect(executor.exec).toHaveBeenCalledWith('user@host', 'python3', expect.any(Array), expect.objectContaining({ timeoutMs: 120000 }));
    expect(environment.capabilities.worktrees).toBe(false); // Removal remains unsupported.
  });

  it('creates from a linked source beside the main repository and reuses an existing branch', async () => {
    const linked = join(fixture, 'source');
    await git(['worktree', 'add', '-b', 'source', linked]);
    await git(['branch', 'existing']);
    const result = await environment.createWorktree(linked, 'nonexistent-base', 'existing');
    expect(result).toMatchObject({ success: true, worktree: { path: join(fixture, 'repo with spaces-worktrees', worktreeDirectoryName('existing')) } });
    expect(await environment.createWorktree(root, 'HEAD', 'existing')).toMatchObject({ success: false, error: expect.stringContaining('already has a worktree') });
  });

  it('reserves the destination exclusively during overlapping creations', async () => {
    const results = await Promise.all([environment.createWorktree(root, 'HEAD', 'task'), environment.createWorktree(root, 'HEAD', 'task')]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect((await git(['worktree', 'list', '--porcelain'])).stdout.match(/branch refs\/heads\/task/g)).toHaveLength(1);
  });

  it.each(['directory', 'symlink'])('does not overwrite an existing destination %s', async (kind) => {
    const parent = join(fixture, 'repo with spaces-worktrees');
    const destination = join(parent, worktreeDirectoryName('task'));
    await mkdir(parent);
    if (kind === 'directory') await mkdir(destination);
    else await symlink(root, destination);
    await writeFile(join(destination, 'sentinel'), 'keep');
    expect(await environment.createWorktree(root, 'HEAD', 'task')).toMatchObject({ success: false });
    expect(await readFile(join(destination, 'sentinel'), 'utf8')).toBe('keep');
    expect((await git(['branch', '--list', 'task'])).stdout).toBe('');
  });

  it('rejects a symlinked parent and a changed canonical source', async () => {
    await symlink(root, join(fixture, 'repo with spaces-worktrees'));
    expect(await environment.createWorktree(root, 'HEAD', 'task')).toMatchObject({ success: false, error: expect.stringContaining('canonical regular directory') });
    const alias = join(fixture, 'alias');
    await symlink(root, alias);
    expect(await environment.createWorktree(alias, 'HEAD', 'task')).toMatchObject({ success: false, error: expect.stringContaining('no longer a canonical directory') });
    expect((await git(['branch', '--list', 'task'])).stdout).toBe('');
  });

  it('preserves registered checkout output when a post-checkout hook fails', async () => {
    const hooks = join(fixture, 'hooks');
    await mkdir(hooks);
    await writeFile(join(hooks, 'post-checkout'), '#!/bin/sh\nprintf keep > partial-output\nexit 1\n', { mode: 0o755 });
    await git(['config', 'core.hooksPath', hooks]);
    const result = await environment.createWorktree(root, 'HEAD', 'task');
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('preserved') });
    const destination = join(fixture, 'repo with spaces-worktrees', worktreeDirectoryName('task'));
    expect(await readFile(join(destination, 'partial-output'), 'utf8')).toBe('keep');
    expect((await git(['worktree', 'list', '--porcelain'])).stdout).toContain(destination);
  });

  it('rejects invalid refs and keeps ambiguous transport failures visible', async () => {
    expect(await environment.createWorktree(root, 'HEAD', '-bad')).toMatchObject({ success: false });
    expect(executor.exec).not.toHaveBeenCalled();
    expect(await environment.createWorktree(root, '-bad', 'task')).toMatchObject({ success: false });
    expect((await git(['branch', '--list', 'task'])).stdout).toBe('');
    vi.mocked(executor.exec).mockRejectedValueOnce(new Error('SSH disconnected'));
    expect(await environment.createWorktree(root, 'HEAD', 'task')).toMatchObject({ success: false, error: expect.stringContaining('may have completed') });
  });

  it('inspects a clean linked checkout and detects tracked, untracked, and ignored changes', async () => {
    const checkout = join(fixture, 'task');
    await git(['worktree', 'add', '-b', 'task', checkout]);
    expect(await environment.inspectWorktree(root, checkout, [root])).toMatchObject({ success: true, hasChanges: false, worktree: { path: checkout, branch: 'task' } });
    await writeFile(join(checkout, 'tracked.txt'), 'edited');
    expect(await environment.inspectWorktree(root, checkout, [])).toMatchObject({ success: true, hasChanges: true });
    await exec('git', ['-C', checkout, 'restore', 'tracked.txt']);
    await writeFile(join(checkout, 'untracked'), 'keep');
    expect(await environment.inspectWorktree(root, checkout, [])).toMatchObject({ success: true, hasChanges: true });
    await rm(join(checkout, 'untracked'));
    await writeFile(join(root, '.git', 'info', 'exclude'), 'ignored\n');
    await writeFile(join(checkout, 'ignored'), 'keep');
    expect(await environment.inspectWorktree(root, checkout, [])).toMatchObject({ success: true, hasChanges: true });
    expect(await readFile(join(checkout, 'ignored'), 'utf8')).toBe('keep');
    expect((await git(['worktree', 'list', '--porcelain'])).stdout).toContain(checkout);
  });

  it('handles detached checkouts and refuses main or unrelated directories', async () => {
    const checkout = join(fixture, 'detached');
    await git(['worktree', 'add', '--detach', checkout]);
    expect(await environment.inspectWorktree(root, checkout, [])).toMatchObject({ success: true, hasChanges: false, worktree: { branch: null } });
    expect(await environment.inspectWorktree(root, root, [])).toMatchObject({ success: false, error: expect.stringContaining('main repository') });
    expect(await environment.inspectWorktree(root, fixture, [])).toMatchObject({ success: false, error: expect.stringContaining('not a linked worktree') });
  });

  async function submoduleCheckout(nested = false) {
    const moduleSource = join(fixture, 'module-source');
    const initialize = async (directory: string) => {
      await mkdir(directory);
      await exec('git', ['-C', directory, 'init', '-b', 'main']);
      await exec('git', ['-C', directory, 'config', 'user.name', 'Test']);
      await exec('git', ['-C', directory, 'config', 'user.email', 'test@example.com']);
      await writeFile(join(directory, 'tracked.txt'), 'initial');
      await writeFile(join(directory, '.gitignore'), 'ignored\n');
      await exec('git', ['-C', directory, 'add', '.']);
      await exec('git', ['-C', directory, 'commit', '-m', 'initial']);
    };
    await initialize(moduleSource);
    if (nested) {
      const leafSource = join(fixture, 'leaf-source');
      await initialize(leafSource);
      await exec('git', ['-c', 'protocol.file.allow=always', '-C', moduleSource, 'submodule', 'add', leafSource, 'nested with spaces']);
      await exec('git', ['-C', moduleSource, 'commit', '-am', 'nested submodule']);
    }
    await git(['-c', 'protocol.file.allow=always', 'submodule', 'add', moduleSource, 'module with spaces']);
    await git(['commit', '-am', 'submodule']);
    const checkout = join(fixture, 'task');
    await git(['worktree', 'add', '-b', 'task', checkout]);
    await exec('git', ['-c', 'protocol.file.allow=always', '-C', checkout, 'submodule', 'update', '--init', '--recursive']);
    return { checkout, module: join(checkout, 'module with spaces') };
  }

  it('detects ignored files inside an initialized submodule even when parent status is clean', async () => {
    const { checkout, module } = await submoduleCheckout();
    expect(await environment.inspectWorktree(root, checkout, [])).toMatchObject({ success: true, hasChanges: false });
    await writeFile(join(module, 'ignored'), 'preserve');
    expect((await exec('git', ['-C', checkout, 'status', '--porcelain=v1', '--ignored'])).stdout).toBe('');
    expect(await environment.inspectWorktree(root, checkout, [])).toMatchObject({ success: true, hasChanges: true });
    expect(await readFile(join(module, 'ignored'), 'utf8')).toBe('preserve');
  });

  it.each(['tracked.txt', 'untracked'])('overrides submodule ignore=all for %s', async (filename) => {
    const { checkout, module } = await submoduleCheckout();
    await exec('git', ['-C', checkout, 'config', 'submodule.module with spaces.ignore', 'all']);
    await exec('git', ['-C', checkout, 'config', 'diff.ignoreSubmodules', 'all']);
    await writeFile(join(module, filename), 'preserve');
    expect((await exec('git', ['-C', checkout, 'status', '--porcelain=v1', '--ignored'])).stdout).toBe('');
    expect(await environment.inspectWorktree(root, checkout, [])).toMatchObject({ success: true, hasChanges: true });
    expect(await readFile(join(module, filename), 'utf8')).toBe('preserve');
  });

  it('recurses through nested initialized submodules to detect ignored files', async () => {
    const { checkout, module } = await submoduleCheckout(true);
    expect(await environment.inspectWorktree(root, checkout, [])).toMatchObject({ success: true, hasChanges: false });
    const leaf = join(module, 'nested with spaces');
    await writeFile(join(leaf, 'ignored'), 'preserve');
    expect((await exec('git', ['-C', checkout, 'status', '--porcelain=v1', '--ignored'])).stdout).toBe('');
    expect(await environment.inspectWorktree(root, checkout, [])).toMatchObject({ success: true, hasChanges: true });
    expect(await readFile(join(leaf, 'ignored'), 'utf8')).toBe('preserve');
  });

  it('allows empty uninitialized submodules and flags populated ones without Git metadata', async () => {
    const { checkout, module } = await submoduleCheckout();
    await exec('git', ['-C', checkout, 'submodule', 'deinit', '--force', '--all']);
    expect(await environment.inspectWorktree(root, checkout, [])).toMatchObject({ success: true, hasChanges: false });
    await writeFile(join(module, 'untracked'), 'preserve');
    expect(await environment.inspectWorktree(root, checkout, [])).toMatchObject({ success: true, hasChanges: true });
  });

  it('refuses locked and missing checkouts', async () => {
    const checkout = join(fixture, 'task');
    await git(['worktree', 'add', '-b', 'task', checkout]);
    await git(['worktree', 'lock', checkout]);
    expect(await environment.inspectWorktree(root, checkout, [])).toMatchObject({ success: false, error: expect.stringContaining('locked') });
    await git(['worktree', 'unlock', checkout]);
    await rm(checkout, { recursive: true });
    expect(await environment.inspectWorktree(root, checkout, [])).toMatchObject({ success: false, error: expect.stringContaining('missing') });
  });

  it('refuses active paths in a checkout, including descendants and symlink aliases', async () => {
    const checkout = join(fixture, 'task');
    await git(['worktree', 'add', '-b', 'task', checkout]);
    const alias = join(fixture, 'alias');
    await symlink(checkout, alias);
    for (const active of [checkout, join(checkout, 'missing-subdir'), alias, fixture]) {
      expect(await environment.inspectWorktree(root, checkout, [active])).toMatchObject({ success: false, error: expect.stringContaining('active terminals') });
    }
  });

  it('rejects a checkout replaced by a symlink or another repository', async () => {
    const checkout = join(fixture, 'task');
    await git(['worktree', 'add', '-b', 'task', checkout]);
    await rm(checkout, { recursive: true });
    await symlink(root, checkout);
    expect(await environment.inspectWorktree(root, checkout, [])).toMatchObject({ success: false });
    await rm(checkout);
    await mkdir(checkout);
    await exec('git', ['-C', checkout, 'init', '-b', 'other']);
    expect(await environment.inspectWorktree(root, checkout, [])).toMatchObject({ success: false, error: expect.stringContaining('identity changed') });
  });

  it('rejects invalid paths and incomplete inspection responses', async () => {
    expect(await environment.inspectWorktree(root, '../relative', [])).toMatchObject({ success: false });
    expect(executor.exec).not.toHaveBeenCalled();
    vi.mocked(executor.exec).mockResolvedValueOnce({ stdout: '{"success":true}', stderr: '', exitCode: 0 });
    expect(await environment.inspectWorktree(root, join(fixture, 'task'), [])).toMatchObject({ success: false, error: expect.stringContaining('Invalid remote') });
    vi.mocked(executor.exec).mockRejectedValueOnce(new Error('SSH disconnected'));
    expect(await environment.inspectWorktree(root, join(fixture, 'task'), [])).toMatchObject({ success: false, error: 'SSH disconnected' });
  });
});
