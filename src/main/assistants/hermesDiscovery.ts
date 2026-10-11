import { readHermesRest, record } from './assistantDetails';
import { constants } from 'node:fs';
import { lstat, open, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { probeExternalBackend, type ExternalProbe, type FetchLike } from './hermesBackend';

interface Rendezvous {
  role: 'serve' | 'desktop-serve';
  pid: number;
  port: number;
  host: '127.0.0.1' | '[::1]';
  fingerprint: string;
  startTime?: number;
}
/** Hermes scopes rendezvous to the OS user, not HERMES_HOME or a profile. No arbitrary port scan. */
export function hermesRendezvousDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (env.HERMES_GATEWAY_LOCK_DIR && path.isAbsolute(env.HERMES_GATEWAY_LOCK_DIR)) return env.HERMES_GATEWAY_LOCK_DIR;
  const state = env.XDG_STATE_HOME && path.isAbsolute(env.XDG_STATE_HOME) ? env.XDG_STATE_HOME : path.join(home, '.local', 'state');
  return path.join(state, 'hermes', 'gateway-locks');
}
async function incarnationMatches(row: Rendezvous): Promise<boolean> {
  try {
    process.kill(row.pid, 0); // Liveness check only; never stop an external process.
    if (process.platform === 'linux' && row.startTime !== undefined) {
      const text = await readFile(`/proc/${row.pid}/stat`, 'utf8');
      const ticks = Number(text.slice(text.lastIndexOf(')') + 2).split(' ')[19]);
      return ticks === row.startTime;
    }
    return true; // Other platforms still require the authenticated identity response below.
  } catch { return false; }
}
/** Private owner-written record nominates a candidate; it does not grant connection authority. */
export async function readHermesRendezvous(directory = hermesRendezvousDirectory()): Promise<Rendezvous[]> {
  const rows: Rendezvous[] = [];
  try {
    const dir = await lstat(directory);
    const uid = process.getuid?.();
    if (!dir.isDirectory() || (process.platform !== 'win32' && (dir.uid !== uid || (dir.mode & 0o077) !== 0))) return rows;
    for (const role of ['serve', 'desktop-serve'] as const) {
      let handle;
      try {
        const filename = path.join(directory, `host-${role}.json`);
        if (!(await lstat(filename)).isFile()) continue; // Also reject symlinks on platforms without O_NOFOLLOW.
        handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK);
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 64 * 1024 || (process.platform !== 'win32' && (stat.uid !== uid || (stat.mode & 0o077) !== 0))) continue;
        const bytes = Buffer.alloc(64 * 1024 + 1); const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        if (bytesRead > 64 * 1024) continue;
        const raw = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>;
        if (raw.role !== role || raw.protocolVersion !== 1 || !Number.isSafeInteger(raw.pid) || (raw.pid as number) <= 0 ||
          !Number.isInteger(raw.port) || (raw.port as number) < 1 || (raw.port as number) > 65535 ||
          typeof raw.tokenFingerprint !== 'string' || !/^[a-f0-9]{16}$/.test(raw.tokenFingerprint)) continue;
        // Never send a credential to a renderer/record-selected remote hostname or LAN endpoint.
        const host = raw.host === '::1' || raw.host === '::' ? '[::1]' : ['127.0.0.1', 'localhost', '0.0.0.0'].includes(String(raw.host)) ? '127.0.0.1' : undefined;
        if (!host || (raw.startTime !== undefined && raw.startTime !== null && (!Number.isSafeInteger(raw.startTime) || (raw.startTime as number) <= 0))) continue;
        const row: Rendezvous = { role, pid: raw.pid as number, port: raw.port as number, host, fingerprint: raw.tokenFingerprint,
          ...(typeof raw.startTime === 'number' ? { startTime: raw.startTime } : {}) };
        if (await incarnationMatches(row)) rows.push(row);
      } catch { /* Missing, stale, unsafe or older records do not authorize an endpoint. */ }
      finally { await handle?.close(); }
    }
  } catch { /* Older Hermes has no rendezvous directory; keep default-port discovery. */ }
  return rows;
}

/** Discover dynamic-port host owners before the legacy 9119 fallback. Authentication stays main-only. */
export async function discoverHermesBackend(fetcher: FetchLike, readCandidates = readHermesRendezvous): Promise<ExternalProbe> {
  const candidates = await readCandidates();
  for (const row of candidates.slice(0, 2)) {
    const probe = await probeExternalBackend(fetcher, row.port, 2000, row.host);
    if (probe.kind === 'none') continue; // Dead listener/stale record: legacy fallback may still be usable.
    if (probe.kind === 'unusable') return probe; // Do not spawn beside a live but inaccessible backend.
    if (createHash('sha256').update(probe.token).digest('hex').slice(0, 16) !== row.fingerprint) {
      return { kind: 'unusable', reason: 'Hermes discovery record does not match the running service. Retry after Hermes finishes restarting.' };
    }
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const identity = record(await readHermesRest(fetcher, { port: row.port, token: probe.token, host: row.host }, '/api/host/identity', controller.signal));
      if (identity.protocolVersion === 1 && identity.pid === row.pid && identity.role === row.role && await incarnationMatches(row)) return probe;
    } catch { /* Never expose URLs, credentials or raw upstream errors. */ }
    finally { clearTimeout(timer); }
    return { kind: 'unusable', reason: 'The running Hermes service could not confirm its discovery identity. Retry after Hermes finishes restarting.' };
  }
  return probeExternalBackend(fetcher);
}
