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
describe.skipIf(process.platform === 'win32')('SSH worktree creation on a real POSIX host fixture', () => {
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
});
