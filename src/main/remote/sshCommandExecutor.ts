import { spawn, type ChildProcess } from 'child_process';
import { quotePosixArg, quotePosixCommand } from './posixQuote';
import { withoutAttentionEnvironment } from '../agentAttentionAdapters';
import { validateSshTarget } from '../../shared/sshValidation';

export interface SshExecOptions {
  signal?: AbortSignal;
  cwd?: string;
  timeoutMs?: number;
  maxBuffer?: number;
  input?: string | Buffer;
  env?: Record<string, string>;
  remoteEnv?: Record<string, string>;
}

export interface SshExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class SshExecutionError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = 'SshExecutionError';
  }
}

function createResolvers<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export class SshCommandExecutor {
  constructor(
    private readonly defaultTimeoutMs: number = 15000,
    private readonly defaultMaxBuffer: number = 10 * 1024 * 1024,
  ) {}

  /**
   * Executes a command on a remote machine via system OpenSSH.
   * Uses argument arrays directly with no local shell wrapper.
   */
  public async exec(
    target: string,
    command: string,
    args: string[] = [],
    options: SshExecOptions = {}
  ): Promise<SshExecResult> {
    if (options.signal?.aborted) throw new Error('Remote SSH command aborted');
    const targetValidation = validateSshTarget(target);
    if (!targetValidation.valid || !targetValidation.target) {
      throw new Error(targetValidation.error || 'Invalid SSH target');
    }

    const validTarget = targetValidation.target;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const maxBuffer = options.maxBuffer ?? this.defaultMaxBuffer;

    let remoteCommand = quotePosixCommand(command, args);
    if (options.remoteEnv && Object.keys(options.remoteEnv).length > 0) {
      const envPrefix = Object.entries(options.remoteEnv)
        .map(([key, value]) => {
          if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(key) || key.startsWith('CLANKER_ATTENTION_') || key.startsWith('CLANKER_REMOTE_ATTENTION_')) {
            throw new Error('Invalid remote environment variable name');
          }
          return `${key}=${quotePosixArg(value)}`;
        })
        .join(' ');
      remoteCommand = `${envPrefix} ${remoteCommand}`;
    }
    if (options.cwd) {
      remoteCommand = `cd ${quotePosixArg(options.cwd)} && ${remoteCommand}`;
    }

    const sshArgs = [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      validTarget,
      remoteCommand,
    ];

    const { promise, resolve, reject } = createResolvers<SshExecResult>();

    let child: ChildProcess;
    try {
      child = spawn('ssh', sshArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: withoutAttentionEnvironment({ ...process.env, ...options.env }),
      });
    } catch (err) {
      reject(new Error(`Failed to spawn ssh: ${err instanceof Error ? err.message : String(err)}`));
      return promise;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let totalStdoutLen = 0;
    let totalStderrLen = 0;
    let killed = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });

    const terminateChild = () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // Already exited
      }
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            child.kill('SIGKILL');
          } catch {
            // Already exited
          }
        }
      }, 1000);
      forceKillTimer.unref();
    };

    const onAbort = () => {
      if (killed) return;
      killed = true;
      clearTimeout(timer);
      terminateChild();
      reject(new Error('Remote SSH command aborted'));
    };

    const timer = setTimeout(() => {
      killed = true;
      terminateChild();
      reject(new Error(`Remote SSH command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (killed) return;
      totalStdoutLen += chunk.length;
      if (totalStdoutLen > maxBuffer) {
        killed = true;
        clearTimeout(timer);
        terminateChild();
        reject(new Error(`Remote SSH command stdout exceeded limit of ${maxBuffer} bytes`));
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (killed) return;
      totalStderrLen += chunk.length;
      if (totalStderrLen > maxBuffer) {
        killed = true;
        clearTimeout(timer);
        terminateChild();
        reject(new Error(`Remote SSH command stderr exceeded limit of ${maxBuffer} bytes`));
        return;
      }
      stderrChunks.push(chunk);
    });

    child.on('error', (err) => {
      options.signal?.removeEventListener('abort', onAbort);
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (!killed) {
        reject(new Error(`SSH process error: ${err.message}`));
      }
    });

    child.on('close', (code, signal) => {
      resolveClosed();
      options.signal?.removeEventListener('abort', onAbort);
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (killed) return;

      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (code === null) {
        const errorMsg = stderr.trim() || `SSH process terminated by signal: ${signal ?? 'unknown'}`;
        reject(new SshExecutionError(errorMsg, 1, stdout, stderr));
        return;
      }

      const exitCode = code;
      if (exitCode !== 0) {
        let errorMsg = stderr.trim();
        if (exitCode === 255) {
          errorMsg = errorMsg || 'SSH connection failed or authentication required interactive login';
        }
        reject(new SshExecutionError(errorMsg || `Command exited with code ${exitCode}`, exitCode, stdout, stderr));
        return;
      }

      resolve({ stdout, stderr, exitCode });
    });

    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    if (typeof child.stdin?.on === 'function') {
      child.stdin.on('error', () => {
        // Ignore EPIPE / early stream termination on SSH disconnect
      });
    }

    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    } else {
      child.stdin?.end();
    }

    return promise.finally(async () => {
      options.signal?.removeEventListener('abort', onAbort);
      // Cancellation is complete only when the owned client is gone. Pollers
      // and shutdown drains must not start new work/quit during kill escalation.
      if (killed) await closed;
    });
  }

  /**
   * Tests reachability and authentication for an SSH target in noninteractive batch mode.
   * Preserves host-key verification.
   */
  public async testConnection(
    target: string,
    timeoutMs = 10000
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.exec(target, 'echo', ['clanker-ssh-ok'], { timeoutMs });
      return { success: true };
    } catch (err) {
      if (err instanceof SshExecutionError) {
        return { success: false, error: err.message };
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
