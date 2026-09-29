import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import { SshCommandExecutor, SshExecutionError } from '../../../src/main/remote/sshCommandExecutor';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';

interface MockChildProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: {
    end: (chunk?: unknown) => void;
    on?: (event: string, handler: unknown) => void;
  };
  kill: (signal?: string) => void;
}

function createMockChild(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: vi.fn(), on: vi.fn() };
  child.kill = vi.fn();
  return child;
}

describe('SshCommandExecutor', () => {
  let executor: SshCommandExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new SshCommandExecutor(5000, 1024 * 1024);
  });

  it('spawns ssh with argument array, batch mode, and quoted remote command', async () => {
    const mockChild = createMockChild();
    vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

    const execPromise = executor.exec('deploy@example.com', 'git', ['status', '--short'], {
      cwd: '/var/www/app',
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    const [binary, args] = vi.mocked(spawn).mock.calls[0];
    expect(binary).toBe('ssh');
    expect(args).toEqual([
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      'deploy@example.com',
      "cd '/var/www/app' && 'git' 'status' '--short'",
    ]);

    mockChild.stdout.emit('data', Buffer.from('M package.json\n'));
    mockChild.emit('close', 0);

    const result = await execPromise;
    expect(result.stdout).toBe('M package.json\n');
    expect(result.exitCode).toBe(0);
  });

  it('rejects option-injection targets before spawning', async () => {
    await expect(executor.exec('-oProxyCommand=calc.exe', 'ls'))
      .rejects.toThrow('cannot start with a hyphen');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('handles non-zero exit codes with SshExecutionError', async () => {
    const mockChild = createMockChild();
    vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

    const execPromise = executor.exec('vps', 'test', ['-f', 'foo']);
    mockChild.stderr.emit('data', Buffer.from('No such file or directory\n'));
    mockChild.emit('close', 1);

    await expect(execPromise).rejects.toThrow(SshExecutionError);
  });
  it('rejects when process is terminated by a signal (code is null)', async () => {
    const mockChild = createMockChild();
    vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

    const execPromise = executor.exec('vps', 'sleep', ['10']);
    mockChild.emit('close', null, 'SIGTERM');

    await expect(execPromise).rejects.toThrow('SSH process terminated by signal: SIGTERM');
  });


  it('provides a descriptive error on exit code 255 (batch auth/connection failure)', async () => {
    const mockChild = createMockChild();
    vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

    const execPromise = executor.exec('vps', 'ls');
    mockChild.stderr.emit('data', Buffer.from('Permission denied (publickey)\n'));
    mockChild.emit('close', 255);

    await expect(execPromise).rejects.toThrow('Permission denied (publickey)');
  });

  it('enforces maximum output buffer limit', async () => {
    const mockChild = createMockChild();
    vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

    const execPromise = executor.exec('vps', 'cat', ['large.bin'], { maxBuffer: 100 });
    mockChild.stdout.emit('data', Buffer.alloc(200));

    await expect(execPromise).rejects.toThrow('stdout exceeded limit');
    expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('tests connection using echo clanker-ssh-ok', async () => {
    const mockChild = createMockChild();
    vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

    const testPromise = executor.testConnection('my-host');
    mockChild.stdout.emit('data', Buffer.from('clanker-ssh-ok\n'));
    mockChild.emit('close', 0);

    const res = await testPromise;
    expect(res.success).toBe(true);
  });

  it('reports failure when test connection fails', async () => {
    const mockChild = createMockChild();
    vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

    const testPromise = executor.testConnection('bad-host');
    mockChild.stderr.emit('data', Buffer.from('Host key verification failed.\n'));
    mockChild.emit('close', 255);

    const res = await testPromise;
    expect(res.success).toBe(false);
    expect(res.error).toContain('Host key verification failed.');
  });
});
