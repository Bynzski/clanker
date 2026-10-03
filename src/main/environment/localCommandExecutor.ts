import { execFile, spawn } from 'child_process';
import * as os from 'node:os';
import { planBoundedSpawn, UnsafeBatchArgumentError, type BoundedSpawnPlan } from './boundedSpawn';
import { normalizeSessionRequest, openBoundedSession } from './boundedSession';
import { prependUserCliBinsToPath } from '../platformShell';
import { withoutAttentionEnvironment } from '../agentAttentionAdapters';
import { toNativePath } from '../../shared/pathNormalize';
import { HarnessCapabilityError } from '../harnesses/types';
import {
  normalizeHarnessCommand,
  type HarnessCommandRequest,
  type HarnessCommandResult,
  type HarnessCommandSession,
  type NormalizedHarnessCommand,
} from '../harnesses/commandExecution';

/** PATH is case-insensitive on Windows; never leave two spellings in the copy. */
function buildEnvironment(extra: Record<string, string>, platform: NodeJS.Platform, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env = withoutAttentionEnvironment(base);
  const pathKey = platform === 'win32' ? Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH' : 'PATH';
  // The user-bin list is host-specific, so it only applies when planning for the host platform.
  if (platform === process.platform) env[pathKey] = prependUserCliBinsToPath(env[pathKey] ?? '', os.homedir());
  for (const [key, value] of Object.entries(extra)) {
    const existing = platform === 'win32' ? Object.keys(env).find((candidate) => candidate.toLowerCase() === key.toLowerCase()) : undefined;
    env[existing ?? key] = value;
  }
  return env;
}

export interface LocalLaunch { plan: BoundedSpawnPlan; env: Record<string, string> }
export interface LocalLaunchOverrides { platform?: NodeJS.Platform; baseEnv?: NodeJS.ProcessEnv; fileExists?: (file: string) => boolean }

/**
 * Shared by one-shot and interactive local execution so PATH handling, credential stripping,
 * Windows resolution and `.cmd`/`.bat` safety are defined once. Throws typed errors.
 */
export function planLocalLaunch(command: NormalizedHarnessCommand, overrides: LocalLaunchOverrides = {}): LocalLaunch {
  const platform = overrides.platform ?? process.platform;
  const env = buildEnvironment(command.env, platform, overrides.baseEnv);
  let plan: BoundedSpawnPlan | null;
  try {
    plan = planBoundedSpawn(command.command, command.args, { platform, env, fileExists: overrides.fileExists });
  } catch (error) {
    if (error instanceof UnsafeBatchArgumentError) throw new HarnessCapabilityError('command-failed', error.message, error);
    throw error;
  }
  if (!plan) throw new HarnessCapabilityError('binary-unavailable', `${command.command} is not installed`);
  return { plan, env };
}

/** Local implementation of the bounded harness command boundary. */
export function executeLocalHarnessCommand(request: HarnessCommandRequest, signal?: AbortSignal, overrides: LocalLaunchOverrides = {}): Promise<HarnessCommandResult> {
  const command = normalizeHarnessCommand(request);
  if (signal?.aborted) return Promise.reject(new HarnessCapabilityError('aborted', 'Command aborted'));
  let launch: LocalLaunch;
  try { launch = planLocalLaunch(command, overrides); } catch (error) { return Promise.reject(error); }
  const { plan, env } = launch;
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

/** Local implementation of the interactive bounded stdio session. */
export async function openLocalHarnessSession(request: HarnessCommandRequest, signal?: AbortSignal): Promise<HarnessCommandSession> {
  const command = normalizeSessionRequest(request);
  if (signal?.aborted) throw new HarnessCapabilityError('aborted', 'Session aborted');
  const { plan, env } = planLocalLaunch(command);
  const child = spawn(plan.file, plan.args, {
    cwd: command.cwd ? toNativePath(command.cwd, process.platform) : undefined,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    windowsVerbatimArguments: plan.windowsVerbatimArguments,
  });
  return openBoundedSession({
    child, timeoutMs: command.timeoutMs, maxOutputBytes: command.maxOutputBytes, signal,
    mapExit: (code) => {
      if (code === null) throw new HarnessCapabilityError('command-failed', 'Process was terminated by a signal');
      return code;
    },
    mapSpawnError: (error) => (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? new HarnessCapabilityError('binary-unavailable', `${command.command} is not installed`, error)
      : new HarnessCapabilityError('command-failed', error.message, error),
  });
}
