import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SshEnvironment, isPathContained } from '../../../src/main/remote/sshEnvironment';
import { SshCommandExecutor, SshExecutionError } from '../../../src/main/remote/sshCommandExecutor';

describe('SshEnvironment', () => {
  describe('isPathContained', () => {
    it('returns true for exact match or children', () => {
      expect(isPathContained('/var/www/app', '/var/www/app')).toBe(true);
      expect(isPathContained('/var/www/app/', '/var/www/app')).toBe(true);
      expect(isPathContained('/var/www/app', '/var/www/app/src/index.ts')).toBe(true);
      expect(isPathContained('/var/www/app', '/var/www/app/deep/nested/dir/')).toBe(true);
      expect(isPathContained('/', '/etc/hosts')).toBe(true);
    });

    it('returns false for path traversal attempts', () => {
      expect(isPathContained('/var/www/app', '/var/www/app/../other')).toBe(false);
      expect(isPathContained('/var/www/app', '/var/www/app/../../etc/passwd')).toBe(false);
      expect(isPathContained('/var/www/app', '/var/www/app-sibling')).toBe(false);
      expect(isPathContained('/var/www/app', '/etc/shadow')).toBe(false);
    });

    it('returns false for empty inputs', () => {
      expect(isPathContained('', '/var/www/app')).toBe(false);
      expect(isPathContained('/var/www/app', '')).toBe(false);
    });
  });

  describe('operations', () => {
    let mockExecutor: SshCommandExecutor;
    let env: SshEnvironment;

    beforeEach(() => {
      mockExecutor = {
        exec: vi.fn(),
        testConnection: vi.fn(),
      } as unknown as SshCommandExecutor;

      env = new SshEnvironment(
        {
          id: 'vps-test',
          kind: 'ssh',
          label: 'Test VPS',
          target: 'user@test-host',
        },
        mockExecutor
      );
    });

    it('validates workspace path and resolves canonical directory', async () => {
      vi.mocked(mockExecutor.exec).mockResolvedValueOnce({
        stdout: '/var/www/canonical-app\n',
        stderr: '',
        exitCode: 0,
      });

      const res = await env.validateWorkspacePath('/var/www/canonical-app/');
      expect(res.valid).toBe(true);
      expect(res.resolvedPath).toBe('/var/www/canonical-app');

      expect(mockExecutor.exec).toHaveBeenCalledWith(
        'user@test-host',
        'sh',
        expect.arrayContaining(['-c', expect.stringContaining('pwd -P')])
      );
    });

    it('rejects relative workspace paths', async () => {
      const res = await env.validateWorkspacePath('relative/path');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('absolute POSIX path');
      expect(mockExecutor.exec).not.toHaveBeenCalled();
    });

    it('prevents file reads outside workspace root', async () => {
      const res = await env.readFile({
        workspacePath: '/var/www/app',
        filePath: '/etc/passwd',
      });

      expect(res.success).toBe(false);
      expect(res.errorCode).toBe('invalid-path');
      expect(mockExecutor.exec).not.toHaveBeenCalled();
    });

    it('reads files and maps specific remote exit codes', async () => {
      // Success read
      const base64Content = Buffer.from('hello remote world', 'utf8').toString('base64');
      vi.mocked(mockExecutor.exec).mockResolvedValueOnce({
        stdout: `${base64Content}\n`,
        stderr: '',
        exitCode: 0,
      });

      const okRes = await env.readFile({
        workspacePath: '/var/www/app',
        filePath: '/var/www/app/hello.txt',
      });
      expect(okRes.success).toBe(true);
      expect(okRes.content).toBe('hello remote world');

      // File too large (exit code 4)
      vi.mocked(mockExecutor.exec).mockRejectedValueOnce(
        new SshExecutionError('too large', 4, '', '')
      );
      const largeRes = await env.readFile({
        workspacePath: '/var/www/app',
        filePath: '/var/www/app/big.bin',
      });
      expect(largeRes.success).toBe(false);
      expect(largeRes.errorCode).toBe('file-too-large');

      // Binary file (exit code 5)
      vi.mocked(mockExecutor.exec).mockRejectedValueOnce(
        new SshExecutionError('binary', 5, '', '')
      );
      const binRes = await env.readFile({
        workspacePath: '/var/www/app',
        filePath: '/var/www/app/image.png',
      });
      expect(binRes.success).toBe(false);
      expect(binRes.errorCode).toBe('binary-file');
    });

    it('prevents file writes outside workspace root', async () => {
      const res = await env.writeFile({
        workspacePath: '/var/www/app',
        filePath: '/etc/evil',
        content: 'test',
      });

      expect(res.success).toBe(false);
      expect(res.errorCode).toBe('invalid-path');
      expect(mockExecutor.exec).not.toHaveBeenCalled();
    });

    it('prevents deleting the workspace root itself', async () => {
      const res = await env.deleteEntry({
        workspacePath: '/var/www/app',
        targetPath: '/var/www/app',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('Cannot delete the workspace root');
      expect(mockExecutor.exec).not.toHaveBeenCalled();
    });

    it('prevents renaming the workspace root itself', async () => {
      const res = await env.renameEntry({
        workspacePath: '/var/www/app',
        oldPath: '/var/www/app',
        newPath: '/var/www/app/nested',
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe('Cannot rename the workspace root directory');
      expect(mockExecutor.exec).not.toHaveBeenCalled();
    });

    it('handles remote exit code 3 as root rename error', async () => {
      vi.mocked(mockExecutor.exec).mockRejectedValueOnce(
        new SshExecutionError('root rename', 3, '', '')
      );
      const res = await env.renameEntry({
        workspacePath: '/var/www/app',
        oldPath: '/var/www/app/symlink-to-root',
        newPath: '/var/www/app/nested',
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe('Cannot rename the workspace root directory');
    });

    it('routes git commands through SSH executor in remote workspace path', async () => {
      vi.mocked(mockExecutor.exec).mockResolvedValueOnce({
        stdout: 'On branch main\n',
        stderr: '',
        exitCode: 0,
      });

      const res = await env.execGit('/var/www/app', ['status', '--short']);
      expect(res.stdout).toBe('On branch main\n');

      expect(mockExecutor.exec).toHaveBeenCalledWith(
        'user@test-host',
        'git',
        ['status', '--short'],
        expect.objectContaining({ cwd: '/var/www/app' })
      );
    });

    it('probes available harnesses on remote host', async () => {
      vi.mocked(mockExecutor.exec).mockResolvedValueOnce({
        stdout: 'codex\nclaude\n',
        stderr: '',
        exitCode: 0,
      });

      const harnesses = await env.probeAvailableHarnessIds();
      expect(harnesses).toEqual(['codex', 'claude']);
    });

    it('resolves terminal spawn to system ssh with TTY allocation', async () => {
      const spawnConfig = await env.resolveTerminalSpawn({
        id: 'term-1',
        workingDir: '/var/www/app',
        harness: 'codex',
      });

      expect(spawnConfig.spawnCmd).toBe('ssh');
      expect(spawnConfig.spawnArgs[0]).toBe('-t');
      expect(spawnConfig.spawnArgs[1]).toBe('user@test-host');
      expect(spawnConfig.spawnArgs[2]).toContain("cd '/var/www/app'");
      expect(spawnConfig.spawnArgs[2]).toContain("'codex'");
      expect(spawnConfig.attentionEnabled).toBe(false);
    });
    it('embeds initialCommand into remoteExec and leaves initialCommand undefined for PTY', async () => {
      const spawnConfig = await env.resolveTerminalSpawn({
        id: 'term-2',
        workingDir: '/var/www/app',
        initialCommand: 'npm run dev',
      });

      expect(spawnConfig.spawnArgs[2]).toContain("sh -lc 'npm run dev'");
      expect(spawnConfig.initialCommand).toBeUndefined();
    });
  });
});

describe('remote filesystem scripts executed on a POSIX host', () => {
  it('mutates within the workspace and rejects symlink escapes without touching external files', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'clanker-ssh-files-'));
    const root = join(sandbox, 'workspace');
    const outside = join(sandbox, 'outside');
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(outside, 'secret'), 'unchanged');
    await symlink(outside, join(root, 'escape'));
    const executor = {
      exec: async (_target: string, command: string, args: string[], options?: { input?: string | Buffer }) =>
        new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
          const child = execFile(command, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
              reject(new SshExecutionError(error.message, Number(error.code), stdout, stderr));
            } else {
              resolve({ stdout, stderr, exitCode: 0 });
            }
          });
          child.stdin?.end(options?.input);
        }),
    } as unknown as SshCommandExecutor;
    const env = new SshEnvironment({ id: 'host', kind: 'ssh', label: 'host', target: 'host' }, executor);
    try {
      expect((await env.createDirectory({ workspacePath: root, targetPath: join(root, 'escape', 'nested'), type: 'directory' })).success).toBe(false);
      expect((await env.createFile({ workspacePath: root, targetPath: join(root, 'escape', 'new'), type: 'file' })).success).toBe(false);
      expect((await env.listDirectory({ workspacePath: root, directoryPath: join(root, 'escape') })).success).toBe(false);
      expect((await env.readFile({ workspacePath: root, filePath: join(root, 'escape', 'secret') })).success).toBe(false);
      expect((await env.renameEntry({ workspacePath: root, oldPath: root, newPath: join(root, 'renamed') })).success).toBe(false);
      expect((await env.writeFile({ workspacePath: root, filePath: join(root, 'notes'), content: 'first' })).success).toBe(true);
      expect((await env.writeFile({ workspacePath: root, filePath: join(root, 'notes'), content: 'second' })).success).toBe(true);
      expect((await env.readFile({ workspacePath: root, filePath: join(root, 'notes') })).content).toBe('second');
      expect((await env.listDirectory({ workspacePath: root, directoryPath: root })).entries.some((entry) => entry.name === 'notes')).toBe(true);
      expect(await readFile(join(outside, 'secret'), 'utf8')).toBe('unchanged');
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});
