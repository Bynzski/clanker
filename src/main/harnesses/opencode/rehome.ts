import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { planLocalLaunch, type LocalLaunchOverrides } from '../../environment/localCommandExecutor';
import { normalizeHarnessCommand } from '../commandExecution';
import type { HarnessCheckoutRehomeCapability } from '../types';

const SERVER_START_MS = 15_000;
const REQUEST_MS = 15_000;
const EXIT_GRACE_MS = 2_000;

/** Stops the server and everything it started (a Windows `.cmd` shim runs it as a grandchild of `cmd.exe`). */
export function killProcessTree(child: Pick<ChildProcess, 'pid' | 'kill'>, platform: NodeJS.Platform = process.platform,
  run: (command: string, args: string[]) => void = (command, args) => { spawn(command, args, { stdio: 'ignore', windowsHide: true }).on('error', () => undefined).unref(); }): void {
  try {
    if (platform === 'win32' && child.pid) run('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else child.kill();
  } catch { /* already gone */ }
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
 * owned by this call only: loopback, a fresh random password, a free port, and killed in every outcome.
 */
export async function moveOpenCodeConversation(
  request: { sessionId: string; directory: string; env: NodeJS.ProcessEnv },
  options: { command?: string; launch?: LocalLaunchOverrides; kill?: typeof killProcessTree } = {},
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
  const exited = new Promise<void>((resolve) => { child.once('exit', () => resolve()); child.once('error', () => resolve()); });
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
    // Killed in every outcome, and the call returns only once it is really gone (bounded).
    (options.kill ?? killProcessTree)(child);
    if (child.exitCode === null && child.signalCode === null) {
      await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, EXIT_GRACE_MS))]);
      if (child.exitCode === null && child.signalCode === null) { try { child.kill('SIGKILL'); } catch { /* gone */ } }
    }
  }
}

/** The seam tests replace; production always uses the real mover. */
export const openCodeMover = { move: moveOpenCodeConversation };

export const checkoutRehome: HarnessCheckoutRehomeCapability = {
  mode: 'after-turn',
  relocateConversation: (request) => openCodeMover.move(request),
};
