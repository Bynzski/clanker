import { execFile } from 'child_process';
import * as os from 'node:os';
import { resolveHarnessSpawn } from '../harnessLaunch';
import { prependUserCliBinsToPath } from '../platformShell';
import { withoutAttentionEnvironment } from '../agentAttentionAdapters';
import { toNativePath } from '../../shared/pathNormalize';
import { HarnessCapabilityError } from '../harnesses/types';
import {
  normalizeHarnessCommand,
  type HarnessCommandRequest,
  type HarnessCommandResult,
} from '../harnesses/commandExecution';

/** Local implementation of the bounded harness command boundary. */
export function executeLocalHarnessCommand(request: HarnessCommandRequest, signal?: AbortSignal): Promise<HarnessCommandResult> {
  const command = normalizeHarnessCommand(request);
  if (signal?.aborted) return Promise.reject(new HarnessCapabilityError('aborted', 'Command aborted'));
  const { spawnCmd, spawnArgs } = resolveHarnessSpawn(command.command, command.args, null);
  return new Promise((resolve, reject) => {
    const child = execFile(spawnCmd, spawnArgs, {
      cwd: command.cwd ? toNativePath(command.cwd, process.platform) : undefined,
      timeout: command.timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: command.maxOutputBytes,
      encoding: 'utf8',
      signal,
      windowsHide: true,
      env: {
        ...withoutAttentionEnvironment(process.env),
        PATH: prependUserCliBinsToPath(process.env.PATH ?? '', os.homedir()),
        ...command.env,
      },
    }, (error, stdout, stderr) => {
      if (!error) { resolve({ stdout: String(stdout), stderr: String(stderr), exitCode: 0 }); return; }
      const details = error as NodeJS.ErrnoException & { killed?: boolean; code?: string | number; name: string };
      if (details.name === 'AbortError' || signal?.aborted) reject(new HarnessCapabilityError('aborted', 'Command aborted', error));
      else if (details.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') reject(new HarnessCapabilityError('output-limit', `Command output exceeded ${command.maxOutputBytes} bytes`, error));
      else if (details.killed) reject(new HarnessCapabilityError('timeout', `Command timed out after ${command.timeoutMs}ms`, error));
      else if (details.code === 'ENOENT') reject(new HarnessCapabilityError('binary-unavailable', `${command.command} is not installed`, error));
      else if (typeof details.code === 'number') resolve({ stdout: String(stdout), stderr: String(stderr), exitCode: details.code });
      else reject(new HarnessCapabilityError('command-failed', details.message, error));
    });
    child.stdin?.on('error', () => { /* early exit before stdin was consumed */ });
    child.stdin?.end(command.stdin);
  });
}
