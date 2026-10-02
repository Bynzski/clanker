import { HarnessCapabilityError } from '../harnesses/types';
import {
  normalizeHarnessCommand,
  type HarnessCommandRequest,
  type HarnessCommandResult,
} from '../harnesses/commandExecution';
import { quotePosixCommand } from './posixQuote';
import { REMOTE_CLI_PATH_SETUP } from './sshAgentAttention';
import { SshExecutionError, type SshCommandExecutor } from './sshCommandExecutor';

/**
 * Remote implementation of the bounded harness command boundary. Every call
 * goes through SshCommandExecutor for the registered environment's target; the
 * caller never supplies a target, and nothing falls back to local execution.
 */
export async function executeSshHarnessCommand(
  executor: SshCommandExecutor, target: string, request: HarnessCommandRequest, signal?: AbortSignal,
): Promise<HarnessCommandResult> {
  const command = normalizeHarnessCommand(request);
  const script = `${REMOTE_CLI_PATH_SETUP}\nexec ${quotePosixCommand(command.command, command.args)}`;
  try {
    const result = await executor.exec(target, 'sh', ['-c', script], {
      signal,
      cwd: command.cwd,
      timeoutMs: command.timeoutMs,
      maxBuffer: command.maxOutputBytes,
      input: command.stdin,
      remoteEnv: command.env,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  } catch (error) {
    if (error instanceof HarnessCapabilityError) throw error;
    if (error instanceof SshExecutionError) {
      // 255 is OpenSSH's own failure code. A remote program can also exit 255, which is
      // indistinguishable without redesigning SshCommandExecutor; the consequence is
      // bounded (reported as temporarily unavailable, retried only after backoff).
      // Exit 127 is deliberately NOT interpreted: binary availability comes from the
      // environment's batched availability probe, not from a command's exit status.
      if (error.exitCode === 255) throw new HarnessCapabilityError('transport-failure', error.message, error);
      return { stdout: error.stdout, stderr: error.stderr, exitCode: error.exitCode };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/aborted/i.test(message)) throw new HarnessCapabilityError('aborted', message, error);
    if (/timed out/i.test(message)) throw new HarnessCapabilityError('timeout', message, error);
    if (/exceeded limit/i.test(message)) throw new HarnessCapabilityError('output-limit', message, error);
    throw new HarnessCapabilityError('transport-failure', message, error);
  }
}
