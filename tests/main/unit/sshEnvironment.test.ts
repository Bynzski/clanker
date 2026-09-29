import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SshEnvironment, isPathContained } from '../../../src/main/remote/sshEnvironment';
import { SshCommandExecutor, SshExecutionError } from '../../../src/main/remote/sshCommandExecutor';

function localPythonExecutor(umask022 = false): SshCommandExecutor {
  return {
    exec: async (_target: string, command: string, args: string[], options?: { input?: string | Buffer }) =>
      new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
        const binary = umask022 ? 'sh' : command;
        const commandArgs = umask022 ? ['-c', 'umask 022; exec "$@"', 'sh', command, ...args] : args;
        const child = execFile(binary, commandArgs, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error) {
            reject(new SshExecutionError(error.message, Number(error.code), stdout, stderr));
          } else {
            resolve({ stdout, stderr, exitCode: 0 });
          }
        });
        child.stdin?.end(options?.input);
      }),
  } as unknown as SshCommandExecutor;
}

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

    it('uses the same user CLI PATH for discovery as for remote execution', async () => {
      vi.mocked(mockExecutor.exec).mockResolvedValueOnce({ stdout: 'codex\n', stderr: '', exitCode: 0 });
      await env.probeAvailableHarnessIds();
      const script = vi.mocked(mockExecutor.exec).mock.calls[0]?.[2]?.[1] ?? '';
      expect(script).toContain('"$HOME/.npm-global/bin"');
      expect(script).toContain('export PATH');
      const terminal = await env.resolveTerminalSpawn({
        id: 'term-cli', workingDir: '/tmp', harness: 'codex',
      });
      expect(terminal.spawnArgs[2]).toContain('"$HOME/.npm-global/bin"');
      expect(terminal.spawnArgs[2]).toContain('export PATH');
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
      expect(spawnConfig.attentionEnabled).toBe(false);
    });

    it('does not forward local Agent Attention adapter variables to SSH', async () => {
      vi.stubEnv('CLANKER_ATTENTION_COMMAND', '/local/adapter.js');
      vi.stubEnv('CLANKER_ATTENTION_TOKEN', 'local-token');
      try {
        const config = await env.resolveTerminalSpawn({
          id: 'term-attention', workingDir: '/var/www/app', harness: 'codex',
        });
        expect(config.env.CLANKER_ATTENTION_COMMAND).toBeUndefined();
        expect(config.env.CLANKER_ATTENTION_TOKEN).toBeUndefined();
      } finally {
        vi.unstubAllEnvs();
      }
    });
    it('runs an initial command exactly once inside the requested remote directory', async () => {
      const sandbox = await mkdtemp(join(tmpdir(), 'clanker-ssh-command-'));
      try {
        const home = join(sandbox, 'home');
        await mkdir(home);
        await writeFile(join(home, 'exit-shell'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
        const spawnConfig = await env.resolveTerminalSpawn({
          id: 'term-2',
          workingDir: sandbox,
          initialCommand: 'printf "%s\\n" "$PWD" >> "$HOME/captured"',
        });
        const launched = spawnSync('sh', ['-c', spawnConfig.spawnArgs[2]], {
          env: { HOME: home, PATH: '/usr/bin:/bin', SHELL: join(home, 'exit-shell') },
          encoding: 'utf8',
        });
        expect(launched.status).toBe(0);
        expect(await readFile(join(home, 'captured'), 'utf8')).toBe(`${sandbox}\n`);
        expect(spawnConfig.initialCommand).toBeUndefined();
      } finally {
        await rm(sandbox, { recursive: true, force: true });
      }
    });
  });
});

describe('remote harness commands executed on a POSIX host', () => {
  it('discovers user-installed CLIs, safely passes model and working directory, and isolates attention', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'clanker-ssh-cli-'));
    const home = join(sandbox, 'home');
    const cliDir = join(home, '.npm-global', 'bin');
    const marker = join(sandbox, 'injected');
    const workingDir = join(sandbox, "repo' $(touch injected)");
    const model = `model'; touch ${marker}; echo '`;
    const flag = `--danger=;touch${marker}`;
    try {
      await mkdir(cliDir, { recursive: true });
      await mkdir(workingDir);
      await writeFile(join(cliDir, 'codex'), '#!/bin/sh\nprintf "%s\\n" "$PWD" "$@" > "$HOME/captured"\n', { mode: 0o755 });
      await chmod(join(cliDir, 'codex'), 0o755);
      await writeFile(join(home, 'exit-shell'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      await chmod(join(home, 'exit-shell'), 0o755);
      const executor = { exec: vi.fn(async (_target: string, _command: string, args: string[]) => {
        const result = spawnSync('sh', ['-c', args[1]], {
          env: { PATH: '/usr/bin:/bin', HOME: home }, encoding: 'utf8',
        });
        if (result.status !== 0) throw new Error(result.stderr);
        return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status };
      }) } as unknown as SshCommandExecutor;
      const environment = new SshEnvironment({
        id: 'vps-test', kind: 'ssh', label: 'Test VPS', target: 'user@test-host',
      }, executor);
      const available = await environment.probeAvailableHarnessIds();
      expect(available).toContain('codex');
      const terminal = await environment.resolveTerminalSpawn({
        id: 'term', workingDir, harness: 'codex', model, flags: `--verbose ${flag}`,
      });
      expect(terminal.attentionEnabled).toBe(false);
      const launched = spawnSync('sh', ['-c', terminal.spawnArgs[2]], {
        env: {
          PATH: '/usr/bin:/bin', HOME: home, SHELL: join(home, 'exit-shell'),
          CLANKER_ATTENTION_COMMAND: 'local-adapter',
        },
        cwd: sandbox,
        encoding: 'utf8',
      });
      expect(launched.status).toBe(0);
      expect(await readFile(join(home, 'captured'), 'utf8')).toBe(`${workingDir}\n-m\n${model}\n--verbose\n${flag}\n`);
      await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it('initializes a POSIX login profile for a CLI in a custom PATH without polluting discovery output', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'clanker-ssh-profile-'));
    try {
      const home = join(sandbox, 'home');
      const customBin = join(home, 'custom bin');
      await mkdir(customBin, { recursive: true });
      await writeFile(join(home, '.profile'), 'PATH="$HOME/custom bin:$PATH"; export PATH; printf "profile banner\\n"\n');
      await writeFile(join(customBin, 'codex'), '#!/bin/sh\nprintf "launched\\n" > "$HOME/captured"\n', { mode: 0o755 });
      await writeFile(join(home, 'exit-shell'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      const executor = { exec: vi.fn(async (_target: string, _command: string, args: string[]) => {
        const result = spawnSync('sh', ['-c', args[1]], {
          env: { HOME: home, PATH: '/usr/bin:/bin' }, encoding: 'utf8',
        });
        if (result.status !== 0) throw new Error(result.stderr);
        return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status };
      }) } as unknown as SshCommandExecutor;
      const environment = new SshEnvironment({
        id: 'vps-test', kind: 'ssh', label: 'Test VPS', target: 'user@test-host',
      }, executor);
      expect(await environment.probeAvailableHarnessIds()).toEqual(['codex']);
      const terminal = await environment.resolveTerminalSpawn({
        id: 'term', workingDir: sandbox, harness: 'codex',
      });
      const launched = spawnSync('sh', ['-c', terminal.spawnArgs[2]], {
        env: { HOME: home, PATH: '/usr/bin:/bin', SHELL: join(home, 'exit-shell') },
        encoding: 'utf8',
      });
      expect(launched.status).toBe(0);
      expect(await readFile(join(home, 'captured'), 'utf8')).toBe('launched\n');
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it('passes safe harness-specific environment values without shell expansion', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'clanker-ssh-env-'));
    try {
      const home = join(sandbox, 'home');
      const bin = join(home, '.local', 'bin');
      await mkdir(bin, { recursive: true });
      await writeFile(join(bin, 'opencode'), '#!/bin/sh\nprintf "%s\\n%s\\n" "$OPENCODE_PERMISSION" "${CLANKER_ATTENTION_COMMAND-unset}" > "$HOME/captured"\n', { mode: 0o755 });
      await writeFile(join(home, 'exit-shell'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      const environment = new SshEnvironment({
        id: 'vps-test', kind: 'ssh', label: 'Test VPS', target: 'user@test-host',
      });
      const terminal = await environment.resolveTerminalSpawn({
        id: 'term', workingDir: sandbox, harness: 'opencode',
      });
      const launched = spawnSync('sh', ['-c', terminal.spawnArgs[2]], {
        env: { PATH: '/usr/bin:/bin', HOME: home, SHELL: join(home, 'exit-shell'), CLANKER_ATTENTION_COMMAND: 'local-adapter' },
        encoding: 'utf8',
      });
      expect(launched.status).toBe(0);
      const [permission, attention] = (await readFile(join(home, 'captured'), 'utf8')).trim().split('\n');
      expect(JSON.parse(permission)).toEqual({ bash: { '*': 'allow' }, edit: 'allow' });
      expect(attention).toBe('unset');
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});

describe('remote filesystem scripts executed on a POSIX host', () => {
  it('preserves modes on existing files and uses the remote umask for new files', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'clanker-ssh-modes-'));
    const root = join(sandbox, 'workspace');
    await mkdir(root);
    const env = new SshEnvironment({ id: 'host', kind: 'ssh', label: 'host', target: 'host' }, localPythonExecutor(true));

    try {
      for (const mode of [0o755, 0o644, 0o600]) {
        const filePath = join(root, `existing-${mode.toString(8)}`);
        await writeFile(filePath, 'before');
        await chmod(filePath, mode);
        const original = await stat(filePath);
        expect((await env.writeFile({ workspacePath: root, filePath, content: 'after' })).success).toBe(true);
        const updated = await stat(filePath);
        expect(updated.mode & 0o777).toBe(mode);
        expect(updated.ino).not.toBe(original.ino);
        expect(await readFile(filePath, 'utf8')).toBe('after');
      }

      const newPath = join(root, 'new.txt');
      expect((await env.writeFile({ workspacePath: root, filePath: newPath, content: 'new' })).success).toBe(true);
      expect((await stat(newPath)).mode & 0o777).toBe(0o644);
      expect(await readFile(newPath, 'utf8')).toBe('new');
      expect((await readdir(root)).some((name) => name.startsWith('.clanker-'))).toBe(false);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it('rejects symlink escapes and cleans up a temporary file after replacement fails', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'clanker-ssh-write-failure-'));
    const root = join(sandbox, 'workspace');
    const outside = join(sandbox, 'outside.txt');
    await mkdir(root);
    await writeFile(outside, 'untouched');
    await symlink(outside, join(root, 'escape.txt'));
    await mkdir(join(root, 'directory-target'));
    const env = new SshEnvironment({ id: 'host', kind: 'ssh', label: 'host', target: 'host' }, localPythonExecutor());

    try {
      expect((await env.writeFile({ workspacePath: root, filePath: join(root, 'escape.txt'), content: 'changed' })).errorCode).toBe('invalid-path');
      expect((await env.writeFile({ workspacePath: root, filePath: join(root, 'directory-target'), content: 'changed' })).success).toBe(false);
      expect((await env.writeFile({ workspacePath: root, filePath: outside, content: 'changed' })).errorCode).toBe('invalid-path');
      expect(await readFile(outside, 'utf8')).toBe('untouched');
      expect((await readdir(root)).some((name) => name.startsWith('.clanker-'))).toBe(false);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it('mutates within the workspace and rejects symlink escapes without touching external files', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'clanker-ssh-files-'));
    const root = join(sandbox, 'workspace');
    const outside = join(sandbox, 'outside');
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(outside, 'secret'), 'unchanged');
    await symlink(outside, join(root, 'escape'));
    const env = new SshEnvironment({ id: 'host', kind: 'ssh', label: 'host', target: 'host' }, localPythonExecutor());
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

describe('pre-workspace SSH directory browsing', () => {
  const config = { id: 'host', kind: 'ssh' as const, label: 'host', target: 'host' };

  it('canonicalizes HOME and browses directories, hidden names, unicode, and symlinks without shell interpolation', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'clanker-ssh-browse-'));
    const home = join(sandbox, "home's ünicode");
    const homeAlias = join(sandbox, 'home alias');
    const workspaces = join(home, 'workspaces');
    const external = join(sandbox, 'outside');
    const marker = join(sandbox, 'injected');
    try {
      await mkdir(workspaces, { recursive: true });
      await symlink(home, homeAlias);
      await mkdir(external);
      await mkdir(join(workspaces, '.hidden'));
      await mkdir(join(workspaces, "it's $pecial ü"));
      await writeFile(join(workspaces, 'ordinary.txt'), 'not a directory');
      await symlink(external, join(workspaces, 'external link'));
      await symlink(join(sandbox, 'gone'), join(workspaces, 'broken link'));
      const executor = {
        exec: vi.fn(async (_target: string, command: string, args: string[], options?: { timeoutMs: number; maxBuffer: number }) => {
          expect(command).toBe('python3');
          expect(options).toEqual({ timeoutMs: 12000, maxBuffer: 128 * 1024 });
          const result = spawnSync(command, args, {
            env: { ...process.env, HOME: homeAlias },
            encoding: 'utf8',
          });
          if (result.status !== 0) {
            throw new SshExecutionError(result.stderr, result.status ?? 1, result.stdout, result.stderr);
          }
          return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
        }),
      } as unknown as SshCommandExecutor;
      const env = new SshEnvironment(config, executor);
      expect(await env.getHomeDirectory()).toEqual({ homePath: home, initialPath: workspaces });
      const listing = await env.listBrowsableDirectories(workspaces);
      expect(listing).toEqual({
        path: workspaces,
        parentPath: home,
        directories: [
          { name: '.hidden', path: join(workspaces, '.hidden') },
          { name: 'external link', path: external },
          { name: "it's $pecial ü", path: join(workspaces, "it's $pecial ü") },
        ],
      });
      expect((await env.listBrowsableDirectories(join(workspaces, 'external link'))).path).toBe(external);
      expect((await env.listBrowsableDirectories('/')).parentPath).toBeNull();
      const injection = join(workspaces, `nonexistent'; touch ${marker}; echo '`);
      await expect(env.listBrowsableDirectories(injection)).rejects.toThrow();
      await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
      await chmod(workspaces, 0o000);
      expect(await env.getHomeDirectory()).toEqual({ homePath: home, initialPath: home });
      await expect(env.listBrowsableDirectories(workspaces)).rejects.toThrow();
      await chmod(workspaces, 0o755);
      await rm(workspaces, { recursive: true });
      expect(await env.getHomeDirectory()).toEqual({ homePath: home, initialPath: home });
      await expect(env.listBrowsableDirectories(workspaces)).rejects.toThrow();
    } finally {
      await chmod(workspaces, 0o755).catch(() => {});
      await rm(sandbox, { recursive: true, force: true });
    }
  });
  it('creates browsable directories and rejects invalid names or existing paths', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'clanker-ssh-create-dir-'));
    try {
      const executor = {
        exec: vi.fn(async (_target: string, command: string, args: string[]) => {
          const result = spawnSync(command, args, { encoding: 'utf8' });
          if (result.status !== 0) {
            throw new SshExecutionError(result.stderr, result.status ?? 1, result.stdout, result.stderr);
          }
          return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
        }),
      } as unknown as SshCommandExecutor;
      const env = new SshEnvironment(config, executor);
      for (const name of ['my-project', 'with spaces', "it's here", 'üñíçødë']) {
        expect(await env.createBrowsableDirectory(sandbox, name)).toEqual({ path: join(sandbox, name) });
      }
      await expect(env.createBrowsableDirectory(sandbox, 'my-project'))
        .rejects.toThrow('Directory already exists');
      for (const badName of ['../escaped', 'nested/sub', '.', '..', '', '/root', 'back\\slash', 'line\nbreak', 'x'.repeat(256)]) {
        await expect(env.createBrowsableDirectory(sandbox, badName))
          .rejects.toThrow('Invalid directory name');
      }
      for (const badParent of ['relative', '/tmp/../etc', '/tmp/', '']) {
        await expect(env.createBrowsableDirectory(badParent, 'good-name'))
          .rejects.toThrow('Invalid remote parent directory path');
      }
      await expect(env.createBrowsableDirectory(join(sandbox, 'missing'), 'good-name'))
        .rejects.toThrow('Parent directory does not exist');
      await symlink(sandbox, join(sandbox, 'alias'));
      await expect(env.createBrowsableDirectory(join(sandbox, 'alias'), 'bad-alias'))
        .rejects.toThrow('Parent directory must be canonical');
      await symlink(join(sandbox, 'missing'), join(sandbox, 'broken'));
      await expect(env.createBrowsableDirectory(sandbox, 'broken'))
        .rejects.toThrow('Directory already exists');
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });


  it('stops a remote scan at the directory count limit', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'clanker-ssh-browse-limit-'));
    try {
      await Promise.all(Array.from({ length: 501 }, (_, i) => mkdir(join(sandbox, String(i)))));
      const executor = {
        exec: vi.fn(async (_target: string, command: string, args: string[]) => {
          const result = spawnSync(command, args, { encoding: 'utf8' });
          if (result.status !== 0) {
            throw new SshExecutionError(result.stderr, result.status ?? 1, result.stdout, result.stderr);
          }
          return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
        }),
      } as unknown as SshCommandExecutor;
      await expect(new SshEnvironment(config, executor).listBrowsableDirectories(sandbox))
        .rejects.toThrow('too many subdirectories');
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it('rejects invalid inputs, malformed responses, excess entries, and timeouts', async () => {
    const exec = vi.fn();
    const env = new SshEnvironment(config, { exec } as unknown as SshCommandExecutor);
    for (const input of ['relative', '/tmp/../etc', '/tmp\nx', `/tmp/${'x'.repeat(4100)}`, '']) {
      await expect(env.listBrowsableDirectories(input)).rejects.toThrow('Invalid remote directory path');
    }
    expect(exec).not.toHaveBeenCalled();
    for (const stdout of ['not json', '{}', '{"homePath":"/tmp","initialPath":"relative"}']) {
      exec.mockResolvedValueOnce({ stdout });
      await expect(env.getHomeDirectory()).rejects.toThrow();
    }
    const response = (directories: unknown, extra: Record<string, unknown> = {}) =>
      JSON.stringify({ path: '/tmp', parentPath: '/', directories, ...extra });
    for (const stdout of [
      response([{ name: 'file', path: 'relative' }]),
      response([{ name: '../escape', path: '/tmp/x' }]),
      response([], { parentPath: '/not-parent' }),
      response(Array.from({ length: 501 }, (_, i) => ({ name: String(i), path: `/tmp/${i}` }))),
      'x'.repeat(128 * 1024 + 1),
    ]) {
      exec.mockResolvedValueOnce({ stdout });
      await expect(env.listBrowsableDirectories('/tmp')).rejects.toThrow();
    }
    exec.mockRejectedValueOnce(new Error('Remote SSH command timed out after 12000ms'));
    await expect(env.listBrowsableDirectories('/tmp')).rejects.toThrow('timed out');
    for (const stdout of ['{"path":"/tmp/other"}', '{"path":"/outside/child"}', '{"path":"relative"}']) {
      exec.mockResolvedValueOnce({ stdout });
      await expect(env.createBrowsableDirectory('/tmp', 'child')).rejects.toThrow('Invalid remote create directory response');
    }
  });
});
