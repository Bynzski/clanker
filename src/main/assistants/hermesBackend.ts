import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { planLocalLaunch } from '../environment/localCommandExecutor';
import { normalizeHarnessCommand } from '../harnesses/commandExecution';

/** Defaults for the local, loopback-only V1 endpoint. */
export const HERMES_LOOPBACK_HOST = '127.0.0.1';
export const HERMES_DEFAULT_PORT = 9119;

const MAX_BOOTSTRAP_BYTES = 64 * 1024;
const BOOTSTRAP_TOKEN = /window\.__HERMES_SESSION_TOKEN__="([A-Za-z0-9_-]{16,128})";/;
const READY_LINE = /^HERMES_BACKEND_READY port=(\d{1,5})$/;
const PORT_IN_USE_LINE = /^BACKEND_PORT_IN_USE port=\d{1,5}$/;
const MAX_LINE_BYTES = 4096;
const MAX_CAPTURED_BYTES = 64 * 1024;

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown>;
}>;

export type ExternalProbe =
  | { kind: 'none' }
  | { kind: 'unusable'; reason: string }
  | { kind: 'usable'; port: number; token: string };

async function bounded<T>(fetcher: FetchLike, url: string, timeoutMs: number, read: (response: Awaited<ReturnType<FetchLike>>) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { signal: controller.signal });
    return await read(response);
  } finally { clearTimeout(timer); }
}

/**
 * Detect and authenticate to an already-running local backend. A bare open port is never enough:
 * `/api/status` must look like Hermes, and the loopback token is read only from the exact
 * `window.__HERMES_SESSION_TOKEN__="…";` assignment in a bounded root response. Gated or
 * token-less backends are reported unusable (never killed, never replaced by a second backend).
 */
export async function probeExternalBackend(fetcher: FetchLike, port = HERMES_DEFAULT_PORT, timeoutMs = 2000): Promise<ExternalProbe> {
  const base = `http://${HERMES_LOOPBACK_HOST}:${port}`;
  let status: unknown;
  try {
    status = await bounded(fetcher, `${base}/api/status`, timeoutMs, async (response) => response.ok ? response.json() : null);
  } catch { return { kind: 'none' }; }
  const record = status && typeof status === 'object' ? status as Record<string, unknown> : null;
  if (!record || typeof record.version !== 'string' || !('config_version' in record || 'install_id' in record)) return { kind: 'none' };
  if (record.auth_required === true) return { kind: 'unusable', reason: 'Hermes service requires sign-in that Clanker cannot provide' };
  try {
    const html = await bounded(fetcher, `${base}/`, timeoutMs, async (response) => response.ok ? response.text() : '');
    if (html.length > MAX_BOOTSTRAP_BYTES) return { kind: 'unusable', reason: 'Hermes service returned an unexpected bootstrap page' };
    const match = BOOTSTRAP_TOKEN.exec(html);
    if (match) return { kind: 'usable', port, token: match[1] };
  } catch { /* fall through */ }
  return { kind: 'unusable', reason: 'Hermes service is running but Clanker could not authenticate to it' };
}

/** Strong per-start loopback token handed to the owned child; never persisted. */
export function generateServiceToken(): string { return randomBytes(32).toString('base64url'); }

export interface ServeChild {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: 'exit' | 'error', listener: (...args: never[]) => void): unknown;
  once(event: 'exit', listener: (...args: never[]) => void): unknown;
  exitCode: number | null;
}

export type SpawnServe = (token: string) => ServeChild;

/** `hermes serve --host 127.0.0.1 --port 0` through the shared safe resolution; no shell string. */
export const spawnHermesServe: SpawnServe = (token) => {
  const command = normalizeHarnessCommand({
    command: 'hermes',
    args: ['serve', '--host', HERMES_LOOPBACK_HOST, '--port', '0'],
    env: { HERMES_DASHBOARD_SESSION_TOKEN: token },
  });
  const { plan, env } = planLocalLaunch(command);
  return spawn(plan.file, plan.args, {
    env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, windowsVerbatimArguments: plan.windowsVerbatimArguments,
  }) as ChildProcess as unknown as ServeChild;
};

export class ServeStartError extends Error {}

/** Wait for the exact machine-readable readiness sentinel on stdout OR stderr, bounded in time and size. */
export function waitForServeReady(child: ServeChild, timeoutMs: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let settled = false;
    let captured = 0;
    const finish = (error: Error | null, port?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(port!);
    };
    const timer = setTimeout(() => finish(new ServeStartError('Hermes service did not become ready in time')), timeoutMs);
    const attach = (stream: NodeJS.ReadableStream | null) => {
      if (!stream) return;
      let buffer = '';
      stream.on('data', (chunk: Buffer | string) => {
        if (settled) return; // after readiness the stream is only drained
        const text = chunk.toString();
        captured += text.length;
        buffer += text;
        let index: number;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).replace(/\r$/, '');
          buffer = buffer.slice(index + 1);
          if (line.length <= MAX_LINE_BYTES) {
            const ready = READY_LINE.exec(line);
            if (ready) {
              const port = Number(ready[1]);
              if (port >= 1 && port <= 65535) { finish(null, port); return; }
              finish(new ServeStartError('Hermes service reported an invalid port')); return;
            }
            if (PORT_IN_USE_LINE.test(line)) { finish(new ServeStartError('Hermes service port is already in use')); return; }
          }
        }
        if (buffer.length > MAX_LINE_BYTES) buffer = ''; // bound a newline-less flood
        if (captured > MAX_CAPTURED_BYTES) finish(new ServeStartError('Hermes service produced too much output before becoming ready'));
      });
    };
    attach(child.stdout);
    attach(child.stderr);
    child.on('exit', (() => finish(new ServeStartError('Hermes service exited before becoming ready'))) as never);
    child.on('error', (() => finish(new ServeStartError('Hermes service could not be started'))) as never);
  });
}
