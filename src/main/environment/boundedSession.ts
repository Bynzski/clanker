import type { ChildProcess } from 'child_process';
import { HarnessCapabilityError } from '../harnesses/types';
import {
  MAX_SESSION_INPUT_BYTES,
  MAX_SESSION_TIMEOUT_MS,
  normalizeHarnessCommand,
  type HarnessCommandRequest,
  type HarnessCommandSession,
  type HarnessCommandSessionResult,
  type NormalizedHarnessCommand,
} from '../harnesses/commandExecution';

/** Validates a session request with the shared command rules; sessions take no initial stdin. */
export function normalizeSessionRequest(request: HarnessCommandRequest): NormalizedHarnessCommand {
  if (request.stdin !== undefined) throw new HarnessCapabilityError('command-failed', 'Invalid harness command: sessions take no initial stdin');
  return normalizeHarnessCommand(request, MAX_SESSION_TIMEOUT_MS);
}

export interface BoundedSessionOptions {
  child: ChildProcess;
  timeoutMs: number;
  maxOutputBytes: number;
  maxInputBytes?: number;
  signal?: AbortSignal;
  /** Transport-specific exit interpretation: returns the program exit code or throws a typed error. */
  mapExit(code: number | null, signal: NodeJS.Signals | null): number;
  /** Transport-specific spawn-failure classification. */
  mapSpawnError(error: Error): HarnessCapabilityError;
}

const KILL_GRACE_MS = 1000;

/**
 * Transport-neutral session over an already-spawned child with piped stdio. Used by both the
 * local and SSH environments; it knows nothing about any protocol (or any harness).
 */
class BoundedSession implements HarnessCommandSession {
  private readonly lines: string[] = [];
  private pending: Buffer = Buffer.alloc(0);
  private readonly stderrChunks: Buffer[] = [];
  private stdoutBytes = 0;
  private stderrBytes = 0;
  private inputBytes = 0;
  private failure?: HarnessCapabilityError;
  private exited = false;
  private exitCode = 0;
  private inputClosed = false;
  private stdinBroken = false;
  private readonly readers: Array<{ resolve: (line: string | null) => void; reject: (error: Error) => void }> = [];
  private readonly waiters: Array<{ resolve: (result: HarnessCommandSessionResult) => void; reject: (error: Error) => void }> = [];
  private readonly closed: Promise<void>;
  private resolveClosed!: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private killTimer?: ReturnType<typeof setTimeout>;
  private readonly onAbort = () => this.fail(new HarnessCapabilityError('aborted', 'Session aborted'));
  private readonly maxInputBytes: number;

  constructor(private readonly options: BoundedSessionOptions) {
    this.maxInputBytes = options.maxInputBytes ?? MAX_SESSION_INPUT_BYTES;
    this.closed = new Promise((resolve) => { this.resolveClosed = resolve; });
    const { child } = options;
    child.stdout?.on('data', (chunk: Buffer) => this.onStdout(chunk));
    child.stderr?.on('data', (chunk: Buffer) => this.onStderr(chunk));
    child.stdin?.on('error', () => { this.stdinBroken = true; });
    child.on('error', (error) => this.fail(options.mapSpawnError(error)));
    child.on('close', (code, signal) => this.onClose(code, signal));
    this.timer = setTimeout(() => this.fail(new HarnessCapabilityError('timeout', `Session timed out after ${options.timeoutMs}ms`)), options.timeoutMs);
    if (options.signal) {
      if (options.signal.aborted) this.onAbort();
      else options.signal.addEventListener('abort', this.onAbort, { once: true });
    }
  }

  private onStdout(chunk: Buffer): void {
    if (this.failure || this.exited) return;
    this.stdoutBytes += chunk.length;
    // Cumulative cap also bounds an unterminated line, so no unbounded buffering.
    if (this.stdoutBytes > this.options.maxOutputBytes) {
      this.fail(new HarnessCapabilityError('output-limit', `Session stdout exceeded ${this.options.maxOutputBytes} bytes`));
      return;
    }
    this.pending = Buffer.concat([this.pending, chunk]);
    let index: number;
    while ((index = this.pending.indexOf(0x0a)) >= 0) {
      let line = this.pending.subarray(0, index);
      if (line.length > 0 && line[line.length - 1] === 0x0d) line = line.subarray(0, line.length - 1);
      // Decoding whole lines keeps multi-byte characters split across chunks intact.
      this.pushLine(new TextDecoder('utf-8').decode(line));
      this.pending = this.pending.subarray(index + 1);
    }
  }

  private onStderr(chunk: Buffer): void {
    if (this.failure || this.exited) return;
    this.stderrBytes += chunk.length;
    if (this.stderrBytes > this.options.maxOutputBytes) {
      this.fail(new HarnessCapabilityError('output-limit', `Session stderr exceeded ${this.options.maxOutputBytes} bytes`));
      return;
    }
    this.stderrChunks.push(chunk);
  }

  private pushLine(line: string): void {
    const reader = this.readers.shift();
    if (reader) reader.resolve(line);
    else this.lines.push(line);
  }

  /** First failure wins; terminates and rejects everything pending. */
  private fail(error: HarnessCapabilityError): void {
    if (this.failure || this.exited) return;
    this.failure = error;
    this.settleFailure(error);
    this.terminate();
  }

  private settleFailure(error: Error): void {
    for (const reader of this.readers.splice(0)) reader.reject(error);
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  private terminate(): void {
    const { child } = this.options;
    try { child.stdin?.destroy(); } catch { /* already closed */ }
    try { child.kill('SIGTERM'); } catch { /* already exited */ }
    this.killTimer = setTimeout(() => {
      if (!this.exited) { try { child.kill('SIGKILL'); } catch { /* already exited */ } }
    }, KILL_GRACE_MS);
    this.killTimer.unref?.();
  }

  private onClose(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exited) return;
    this.exited = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.killTimer) clearTimeout(this.killTimer);
    this.options.signal?.removeEventListener('abort', this.onAbort);
    if (!this.failure) {
      if (this.pending.length > 0) {
        this.pushLine(new TextDecoder('utf-8').decode(this.pending));
        this.pending = Buffer.alloc(0);
      }
      try {
        this.exitCode = this.options.mapExit(code, signal);
      } catch (error) {
        this.failure = error instanceof HarnessCapabilityError ? error : new HarnessCapabilityError('command-failed', String(error), error);
      }
      if (this.failure) {
        this.settleFailure(this.failure);
      } else {
        for (const reader of this.readers.splice(0)) reader.resolve(null);
        const result = this.result();
        for (const waiter of this.waiters.splice(0)) waiter.resolve(result);
      }
    }
    this.resolveClosed();
  }

  private result(): HarnessCommandSessionResult {
    return { stderr: Buffer.concat(this.stderrChunks).toString('utf8'), exitCode: this.exitCode };
  }

  public async writeLine(line: string): Promise<void> {
    if (this.failure) throw this.failure;
    if (this.inputClosed || this.exited || this.stdinBroken) throw new HarnessCapabilityError('command-failed', 'Session input is closed');
    if (typeof line !== 'string' || /[\r\n\0]/.test(line)) throw new HarnessCapabilityError('command-failed', 'Invalid protocol line');
    const data = Buffer.from(`${line}\n`, 'utf8');
    if (this.inputBytes + data.length > this.maxInputBytes) {
      const error = new HarnessCapabilityError('input-limit', `Session input exceeded ${this.maxInputBytes} bytes`);
      this.fail(error);
      throw error;
    }
    this.inputBytes += data.length;
    await new Promise<void>((resolve, reject) => {
      const stdin = this.options.child.stdin;
      if (!stdin) { reject(new HarnessCapabilityError('command-failed', 'Session input is closed')); return; }
      stdin.write(data, (error) => (error ? reject(this.failure ?? new HarnessCapabilityError('command-failed', 'Session input failed', error)) : resolve()));
    });
  }

  public readLine(): Promise<string | null> {
    if (this.failure) return Promise.reject(this.failure);
    const next = this.lines.shift();
    if (next !== undefined) return Promise.resolve(next);
    if (this.exited) return Promise.resolve(null);
    return new Promise((resolve, reject) => { this.readers.push({ resolve, reject }); });
  }

  public async closeInput(): Promise<void> {
    if (this.inputClosed) return;
    this.inputClosed = true;
    const stdin = this.options.child.stdin;
    if (!stdin || stdin.destroyed || this.exited) return;
    await new Promise<void>((resolve) => {
      stdin.once('finish', resolve);
      stdin.once('close', resolve);
      stdin.once('error', () => resolve());
      stdin.end();
    });
  }

  public wait(): Promise<HarnessCommandSessionResult> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.exited) return Promise.resolve(this.result());
    return new Promise((resolve, reject) => { this.waiters.push({ resolve, reject }); });
  }

  public async dispose(): Promise<void> {
    if (!this.exited) this.fail(new HarnessCapabilityError('aborted', 'Session disposed'));
    await this.closed;
  }
}

/** Resolves once the child has spawned; spawn failures surface here as typed errors. */
export async function openBoundedSession(options: BoundedSessionOptions): Promise<HarnessCommandSession> {
  const { child } = options;
  const started = new Promise<void>((resolve, reject) => {
    child.once('spawn', () => resolve());
    child.once('error', (error) => reject(options.mapSpawnError(error)));
  });
  try {
    await started;
  } catch (error) {
    try { child.kill('SIGKILL'); } catch { /* never started */ }
    throw error;
  }
  return new BoundedSession(options);
}
