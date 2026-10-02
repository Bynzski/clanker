import { execFile } from 'child_process';
import * as os from 'node:os';
import { planBoundedSpawn, UnsafeBatchArgumentError } from './boundedSpawn';
import { prependUserCliBinsToPath } from '../platformShell';
import { withoutAttentionEnvironment } from '../agentAttentionAdapters';
import { toNativePath } from '../../shared/pathNormalize';
import { HarnessCapabilityError } from '../harnesses/types';
import {
  normalizeHarnessCommand,
  type HarnessCommandRequest,
  type HarnessCommandResult,
} from '../harnesses/commandExecution';

/** PATH is case-insensitive on Windows; never leave two spellings in the copy. */
function buildEnvironment(extra: Record<string, string>, platform: NodeJS.Platform): Record<string, string> {
  const env = withoutAttentionEnvironment(process.env);
  const pathKey = platform === 'win32' ? Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH' : 'PATH';
  env[pathKey] = prependUserCliBinsToPath(env[pathKey] ?? '', os.homedir());
  for (const [key, value] of Object.entries(extra)) {
    const existing = platform === 'win32' ? Object.keys(env).find((candidate) => candidate.toLowerCase() === key.toLowerCase()) : undefined;
    env[existing ?? key] = value;
  }
  return env;
}

/** Local implementation of the bounded harness command boundary. */
export function executeLocalHarnessCommand(request: HarnessCommandRequest, signal?: AbortSignal): Promise<HarnessCommandResult> {
  const command = normalizeHarnessCommand(request);
  if (signal?.aborted) return Promise.reject(new HarnessCapabilityError('aborted', 'Command aborted'));
  const env = buildEnvironment(command.env, process.platform);
  let plan;
  try {
    plan = planBoundedSpawn(command.command, command.args, { platform: process.platform, env });
  } catch (error) {
    if (error instanceof UnsafeBatchArgumentError) return Promise.reject(new HarnessCapabilityError('command-failed', error.message, error));
    throw error;
  }
  if (!plan) return Promise.reject(new HarnessCapabilityError('binary-unavailable', `${command.command} is not installed`));
  return new Promise((resolve, reject) => {
    const child = execFile(plan.file, plan.args, {
      cwd: command.cwd ? toNativePath(command.cwd, process.platform) : undefined,
      timeout: command.timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: command.maxOutputBytes,
      encoding: 'utf8',
      signal,
      windowsHide: true,
      windowsVerbatimArguments: plan.windowsVerbatimArguments,
      env,
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
