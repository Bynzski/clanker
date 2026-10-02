import { HarnessCapabilityError } from './types';

/**
 * Transport-neutral bounded command execution for harness capabilities.
 * Providers describe a command; the workspace environment decides where and
 * how it runs (local child process or system OpenSSH through
 * SshCommandExecutor). Non-zero exits are returned, not thrown. Timeouts,
 * output overflow, cancellation and transport failures throw
 * HarnessCapabilityError.
 */
export interface HarnessCommandRequest {
  command: string;
  args?: string[];
  /** Working directory in the target environment's own path form. */
  cwd?: string;
  /** Extra environment variables; Clanker attention credentials are rejected. */
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs?: number;
  /** Per-stream limit; exceeding it fails the command. */
  maxOutputBytes?: number;
}

export interface HarnessCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface HarnessCommandExecutor {
  run(request: HarnessCommandRequest): Promise<HarnessCommandResult>;
}

/** Environment-side primitive; the signal is supplied per call. */
export type ExecuteHarnessCommand = (request: HarnessCommandRequest, signal?: AbortSignal) => Promise<HarnessCommandResult>;

/**
 * Interactive bounded stdio session: the second execution form, for stateful
 * line-oriented protocols that one-shot `run()` cannot serve. The environment owns the
 * process and transport; the session is protocol-neutral (UTF-8 lines in, UTF-8 lines
 * out) and exposes no process handle, target, argv or environment. Request `stdin` is
 * not allowed; the request's timeout bounds the whole session lifetime and
 * `maxOutputBytes` bounds cumulative stdout and stderr separately.
 *
 * - `writeLine` appends one newline; rejects after `closeInput`, after failure, for
 *   lines containing CR/LF/NUL, and beyond the total input cap (`input-limit`).
 * - `readLine` returns the next stdout line (LF or CRLF stripped) or `null` on clean EOF;
 *   it never filters. Timeout, abort, output overflow and transport failure reject.
 * - `closeInput` idempotently ends stdin without declaring success.
 * - `wait` resolves with stderr and the program's exit code after the process is reaped
 *   (a non-zero exit is a result); failures reject with `HarnessCapabilityError`.
 * - `dispose` is idempotent, safe in `finally`, terminates if needed and awaits reaping.
 */
export interface HarnessCommandSessionResult {
  stderr: string;
  exitCode: number;
}
export interface HarnessCommandSession {
  writeLine(line: string): Promise<void>;
  readLine(): Promise<string | null>;
  closeInput(): Promise<void>;
  wait(): Promise<HarnessCommandSessionResult>;
  dispose(): Promise<void>;
}
export interface HarnessCommandSessionExecutor {
  open(request: HarnessCommandRequest): Promise<HarnessCommandSession>;
}
/** Environment-side primitive; the signal is supplied per call. */
export type OpenHarnessCommandSession = (request: HarnessCommandRequest, signal?: AbortSignal) => Promise<HarnessCommandSession>;
export const MAX_SESSION_INPUT_BYTES = 64 * 1024;

export const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
export const MAX_COMMAND_TIMEOUT_MS = 30_000;
export const DEFAULT_COMMAND_OUTPUT_BYTES = 256 * 1024;
export const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
const MAX_STDIN_BYTES = 64 * 1024;
const MAX_ARGS = 64;

export interface NormalizedHarnessCommand {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  stdin?: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

function invalid(message: string): HarnessCapabilityError {
  return new HarnessCapabilityError('command-failed', `Invalid harness command: ${message}`);
}

/** Shared validation and clamping so every transport enforces the same bounds. */
export function normalizeHarnessCommand(request: HarnessCommandRequest): NormalizedHarnessCommand {
  const { command, args = [], cwd, env = {}, stdin } = request;
  if (typeof command !== 'string' || !command || command.includes('\0') || /[\s/\\]/.test(command)) throw invalid('executable must be a bare command name');
  if (!Array.isArray(args) || args.length > MAX_ARGS || args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) throw invalid('bad argument list');
  if (cwd !== undefined && (typeof cwd !== 'string' || !cwd || cwd.includes('\0'))) throw invalid('bad cwd');
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(key) || key.startsWith('CLANKER_ATTENTION_') || key.startsWith('CLANKER_REMOTE_ATTENTION_')
      || typeof value !== 'string' || value.includes('\0')) throw invalid('bad environment variable');
  }
  if (stdin !== undefined && (typeof stdin !== 'string' || Buffer.byteLength(stdin) > MAX_STDIN_BYTES)) throw invalid('bad stdin');
  const clamp = (value: number | undefined, fallback: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), max) : fallback;
  return {
    command, args: [...args], cwd, env: { ...env }, stdin,
    timeoutMs: clamp(request.timeoutMs, DEFAULT_COMMAND_TIMEOUT_MS, MAX_COMMAND_TIMEOUT_MS),
    maxOutputBytes: clamp(request.maxOutputBytes, DEFAULT_COMMAND_OUTPUT_BYTES, MAX_COMMAND_OUTPUT_BYTES),
  };
}

/** Provider helper: stdout of a successful command, else a typed failure. */
export function requireSuccess(result: HarnessCommandResult, what: string): string {
  if (result.exitCode !== 0) {
    throw new HarnessCapabilityError('command-failed', `${what} exited with code ${result.exitCode}`, { exitCode: result.exitCode, stderr: result.stderr });
  }
  return result.stdout;
}

/** Provider helper: strict JSON from stdout. Decorated or empty output is a schema/command problem. */
export function parseJsonOutput(stdout: string, what: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new HarnessCapabilityError('parse-failure', `${what} did not produce valid JSON`, error);
  }
}
