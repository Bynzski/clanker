import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { planLocalLaunch, type LocalLaunchOverrides } from '../../environment/localCommandExecutor';
import { normalizeHarnessCommand } from '../commandExecution';
import { UnverifiedProcessExitError, type HarnessCheckoutRehomeCapability } from '../types';

const SERVER_START_MS = 15_000;
const REQUEST_MS = 15_000;
const DEFAULT_GRACEFUL_MS = 2_000;
const DEFAULT_FORCED_MS = 3_000;
const TASKKILL_MS = 5_000;

type TeardownChild = Pick<ChildProcess, 'pid' | 'kill' | 'exitCode' | 'signalCode'>;

export interface TeardownOptions {
  platform?: NodeJS.Platform;
  /** How long a graceful termination gets before it is escalated. */
  gracefulMs?: number;
  /** How long the forced termination gets before teardown is declared failed. */
  forcedMs?: number;
  /**
   * Runs one fixed command (never user text, no shell) and settles when it has completed, failed or hit its bound.
   * Never rejects. Only `taskkill` is ever run, and only on Windows.
   */
  run?: (command: string, args: string[]) => Promise<void>;
}

/** Runs a fixed argv without a shell and resolves when it finished, errored or exceeded `TASKKILL_MS` (then it is killed). */
function runBounded(command: string, args: string[]): Promise<void> {
  return new Promise<void>((resolve) => {
    let helper: ChildProcess;
    try { helper = spawn(command, args, { stdio: 'ignore', windowsHide: true }); } catch { resolve(); return; }
    const timer = setTimeout(() => { try { helper.kill(); } catch { /* gone */ } resolve(); }, TASKKILL_MS);
    const done = () => { clearTimeout(timer); resolve(); };
    helper.once('error', done);
    helper.once('close', done);
  });
}

/**
 * Stops the transient server and PROVES it exited, in two bounded phases. The proof is the child's own `exit`
 * event (`exited`, owned by the caller from the moment it spawned the child) or the exit status Node recorded
 * for it; never a signal having been sent, a timer, a taskkill having run, or a pid lookup (pids are reused).
 *
 *   phase 1  graceful: SIGTERM (POSIX) / `taskkill /PID n /T` (Windows, the tree: a `.cmd` shim runs the server
 *            under `cmd.exe`)  -> wait up to `gracefulMs` for the exit
 *   phase 2  forced:   SIGKILL / `taskkill /PID n /T /F`, awaited  -> wait up to `forcedMs` for the exit
 *
 * Rejects with `UnverifiedProcessExitError` if the child still has not exited: the caller must fail closed.
 */
export async function stopTransientServer(child: TeardownChild, exited: Promise<void>, options: TeardownOptions = {}): Promise<void> {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? runBounded;
  const hasExited = () => child.exitCode !== null || child.signalCode !== null;
  if (hasExited()) return;
  const waitForExit = (ms: number): Promise<boolean> => new Promise((resolve) => {
    if (hasExited()) { resolve(true); return; }
    const timer = setTimeout(() => resolve(hasExited()), ms);
    void exited.then(() => { clearTimeout(timer); resolve(true); });
  });
  const windows = platform === 'win32' && typeof child.pid === 'number';
  const treeKill = (force: boolean) => run('taskkill', ['/PID', String(child.pid), '/T', ...(force ? ['/F'] : [])]).catch(() => undefined);
  const signal = (name: NodeJS.Signals) => { try { child.kill(name); } catch { /* already gone */ } };

  if (windows) await treeKill(false); else signal('SIGTERM');
  if (await waitForExit(options.gracefulMs ?? DEFAULT_GRACEFUL_MS)) return;
  if (windows) await treeKill(true); else signal('SIGKILL');
  if (await waitForExit(options.forcedMs ?? DEFAULT_FORCED_MS)) return;
  throw new UnverifiedProcessExitError('The OpenCode relocation server could not be confirmed stopped');
}

function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

/**
 * The launch plan of the transient server, from the same planner every bounded local harness command and
 * interactive session uses: user CLI bin directories on PATH (desktop/AppImage launches lack them), Windows
 * PATH/PATHEXT resolution and the safe `.cmd`/`.bat` shim form, attention credentials stripped. No second
 * resolver lives here.
 */
export function planOpenCodeServe(
  server: { port: number; password: string; directory: string; env: NodeJS.ProcessEnv },
  command = 'opencode',
  launch: LocalLaunchOverrides = {},
) {
  return planLocalLaunch(normalizeHarnessCommand({
    command,
    args: ['serve', '--hostname', '127.0.0.1', '--port', String(server.port)],
    cwd: server.directory,
    env: { OPENCODE_SERVER_PASSWORD: server.password, OPENCODE_SERVER_USERNAME: 'opencode' },
  }), { baseEnv: server.env, ...launch });
}

/**
 * OpenCode's resume ignores the launch directory (and `--dir`): it runs in the directory recorded in
 * the conversation. Measured with 1.18.34, the one native way to change that record while keeping the
 * conversation id is its own `POST /experimental/control-plane/move-session`, which OpenCode refuses for
 * a destination outside the conversation's project (400) or a relative path (500), and which touches no
 * files here (`moveChanges` is never sent). It is reached through a transient `opencode serve` that is
 * owned by this call only: loopback, a fresh random password, a free port, and stopped (with its exit proven) in every outcome.
 */
export async function moveOpenCodeConversation(
  request: { sessionId: string; directory: string; env: NodeJS.ProcessEnv },
  options: { command?: string; launch?: LocalLaunchOverrides; teardown?: TeardownOptions } = {},
): Promise<void> {
  const port = await freeLoopbackPort();
  const password = randomBytes(24).toString('hex');
  const { plan, env } = planOpenCodeServe({ port, password, directory: request.directory, env: request.env }, options.command, options.launch);
  const child = spawn(plan.file, plan.args, {
    cwd: request.directory,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    windowsVerbatimArguments: plan.windowsVerbatimArguments,
  });
  // The child's own exit event: the proof teardown relies on. A spawn failure never produced a process, so it
  // also counts as "nothing to stop" (and is reported as a failure to start).
  const exited = new Promise<void>((resolve) => { child.once('exit', () => resolve()); });
  let spawnError: Error | undefined;
  child.once('error', (error) => { spawnError = error; });
  child.stdout.resume();
  child.stderr.resume();
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
  const base = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + SERVER_START_MS;
    for (;;) {
      if (spawnError) throw new Error('OpenCode could not be started');
      if (child.exitCode !== null) throw new Error('OpenCode exited before it could move the conversation');
      try {
        const alive = await fetch(`${base}/session/status`, { headers: { authorization }, signal: AbortSignal.timeout(1000) });
        if (alive.ok) break;
      } catch { /* not listening yet */ }
      if (Date.now() > deadline) throw new Error('OpenCode did not start in time');
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const response = await fetch(`${base}/experimental/control-plane/move-session`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ sessionID: request.sessionId, destination: { directory: request.directory } }),
      signal: AbortSignal.timeout(REQUEST_MS),
    });
    if (response.status !== 204) throw new Error(`OpenCode refused to move the conversation (HTTP ${response.status})`);
  } finally {
    // Stopped in every outcome, and the call settles only once the child has really exited. If that cannot be
    // proven this REJECTS (replacing any earlier error): a relocation that may still have a server touching the
    // session must never be reported as done, and nothing may be resumed after it.
    if (spawnError && child.pid === undefined) { /* never started: nothing to stop */ }
    else await stopTransientServer(child, exited, options.teardown);
  }
}

/** The seam tests replace; production always uses the real mover. */
export const openCodeMover = { move: moveOpenCodeConversation };

export const checkoutRehome: HarnessCheckoutRehomeCapability = {
  mode: 'after-turn',
  relocateConversation: (request) => openCodeMover.move(request),
};
