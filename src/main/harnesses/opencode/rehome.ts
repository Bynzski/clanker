import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import type { HarnessCheckoutRehomeCapability } from '../types';

const SERVER_START_MS = 15_000;
const REQUEST_MS = 15_000;

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
 * OpenCode's resume ignores the launch directory (and `--dir`): it runs in the directory recorded in
 * the conversation. Measured with 1.18.34, the one native way to change that record while keeping the
 * conversation id is its own `POST /experimental/control-plane/move-session`, which OpenCode refuses for
 * a destination outside the conversation's project (400) or a relative path (500), and which touches no
 * files here (`moveChanges` is never sent). It is reached through a transient `opencode serve` that is
 * owned by this call only: loopback, a fresh random password, a free port, and killed in every outcome.
 */
export async function moveOpenCodeConversation(
  request: { sessionId: string; directory: string; env: NodeJS.ProcessEnv },
  command = 'opencode',
): Promise<void> {
  const port = await freeLoopbackPort();
  const password = randomBytes(24).toString('hex');
  const child = spawn(command, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: request.directory,
    env: { ...request.env, OPENCODE_SERVER_PASSWORD: password, OPENCODE_SERVER_USERNAME: 'opencode' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
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
    try { child.kill(); } catch { /* already gone */ }
  }
}

/** The seam tests replace; production always uses the real mover. */
export const openCodeMover = { move: moveOpenCodeConversation };

export const checkoutRehome: HarnessCheckoutRehomeCapability = {
  mode: 'after-turn',
  relocateConversation: (request) => openCodeMover.move(request),
};
