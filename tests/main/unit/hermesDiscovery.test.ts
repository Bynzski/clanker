import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, chmod, rm, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { discoverHermesBackend, hermesRendezvousDirectory, readHermesRendezvous } from '../../../src/main/assistants/hermesDiscovery';
import { HermesAssistantService } from '../../../src/main/assistants/hermesAssistantService';
import { FakeHermes, TOKEN } from '../../_helpers/fakeHermes';

const fingerprint = createHash('sha256').update(TOKEN).digest('hex').slice(0, 16);
const roots: string[] = [];
async function fixture(overrides: Record<string, unknown> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'clanker-hermes-discovery-')); roots.push(root);
  const dir = path.join(root, 'gateway-locks'); await mkdir(dir, { mode: 0o700 });
  const file = path.join(dir, 'host-serve.json');
  await writeFile(file, JSON.stringify({ role: 'serve', pid: process.pid, port: 44173, host: '127.0.0.1', protocolVersion: 1, tokenFingerprint: fingerprint, ...overrides }), { mode: 0o600 });
  return { dir, file };
}
function backend(identity: Record<string, unknown> = { protocolVersion: 1, pid: process.pid, role: 'serve' }) {
  const hermes = new FakeHermes();
  const fetcher = vi.fn(async (url: string, init?: { headers?: Record<string, string>; redirect?: string }) => {
    if (new URL(url).pathname === '/api/host/identity') {
      expect(init?.headers).toEqual({ 'X-Hermes-Session-Token': TOKEN }); expect(init?.redirect).toBe('error');
      return { ok: true, status: 200, text: async () => JSON.stringify(identity), json: async () => identity };
    }
    return hermes.fetch(url);
  });
  return { hermes, fetcher };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
describe('Hermes OS-user rendezvous discovery', () => {
  it('matches upstream location and ignores relative XDG/override paths', () => {
    expect(hermesRendezvousDirectory({}, '/home/user')).toBe('/home/user/.local/state/hermes/gateway-locks');
    expect(hermesRendezvousDirectory({ XDG_STATE_HOME: '/state' }, '/home/user')).toBe('/state/hermes/gateway-locks');
    expect(hermesRendezvousDirectory({ XDG_STATE_HOME: 'relative', HERMES_GATEWAY_LOCK_DIR: 'relative' }, '/home/user')).toBe('/home/user/.local/state/hermes/gateway-locks');
    expect(hermesRendezvousDirectory({ HERMES_GATEWAY_LOCK_DIR: '/private/locks' }, '/home/user')).toBe('/private/locks');
  });
  it('adopts a verified dynamic port instead of probing only 9119', async () => {
    const { dir } = await fixture(); const { fetcher } = backend();
    expect(await discoverHermesBackend(fetcher, () => readHermesRendezvous(dir))).toEqual({ kind: 'usable', port: 44173, token: TOKEN });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['http://127.0.0.1:44173/api/status', 'http://127.0.0.1:44173/', 'http://127.0.0.1:44173/api/host/identity']);
  });
  it.each([{ host: 'attacker.example' }, { port: 0 }, { port: 65536 }, { protocolVersion: 2 }, { role: 'gateway' }, { pid: 2147483647 }, { startTime: -1 }])('rejects invalid/stale records: %j', async (override) => {
    const { dir } = await fixture(override); expect(await readHermesRendezvous(dir)).toEqual([]);
  });
  it('rejects recycled Linux process incarnations', async () => {
    if (process.platform !== 'linux') return;
    const { dir } = await fixture({ startTime: 1 }); expect(await readHermesRendezvous(dir)).toEqual([]);
    const text = await readFile(`/proc/${process.pid}/stat`, 'utf8');
    const valid = await fixture({ startTime: Number(text.slice(text.lastIndexOf(')') + 2).split(' ')[19]) });
    expect(await readHermesRendezvous(valid.dir)).toHaveLength(1);
  });
  it('refuses symlink records, oversized files and writable-by-other private state', async () => {
    const { dir, file } = await fixture();
    await writeFile(file, 'x'.repeat(65537)); expect(await readHermesRendezvous(dir)).toEqual([]);
    await rm(file); const target = path.join(path.dirname(dir), 'target'); await writeFile(target, '{}'); await symlink(target, file);
    expect(await readHermesRendezvous(dir)).toEqual([]);
    if (process.platform !== 'win32') {
      const another = await fixture(); await chmod(another.file, 0o644); expect(await readHermesRendezvous(another.dir)).toEqual([]);
      const third = await fixture(); await chmod(third.dir, 0o777); expect(await readHermesRendezvous(third.dir)).toEqual([]);
    }
  });
  it.each([{ protocolVersion: 1, pid: process.pid + 1, role: 'serve' }, { protocolVersion: 1, pid: process.pid, role: 'gateway' }, { protocolVersion: 2, pid: process.pid, role: 'serve' }])('fails closed on an identity mismatch without starting a competing service', async (identity) => {
    const { dir } = await fixture(); const { fetcher } = backend(identity);
    expect(await discoverHermesBackend(fetcher, () => readHermesRendezvous(dir))).toMatchObject({ kind: 'unusable' });
    expect(fetcher.mock.calls.some(([url]) => url.includes(':9119/'))).toBe(false);
  });
  it('fails closed on a torn token/record restart and keeps sign-in policy', async () => {
    const { dir } = await fixture({ tokenFingerprint: '0'.repeat(16) }); const { fetcher } = backend();
    expect(await discoverHermesBackend(fetcher, () => readHermesRendezvous(dir))).toMatchObject({ kind: 'unusable' });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/api/host/identity'))).toBe(false);
    const valid = await fixture(); const gated = backend(); gated.hermes.authRequired = true;
    expect(await discoverHermesBackend(gated.fetcher, () => readHermesRendezvous(valid.dir))).toMatchObject({ kind: 'unusable' });
  });
  it('preserves default-port fallback for older Hermes and dead listeners', async () => {
    const { fetcher } = backend(); expect(await discoverHermesBackend(fetcher, async () => [])).toMatchObject({ kind: 'usable', port: 9119 });
    const { dir } = await fixture();
    const unavailable = vi.fn(async (url: string) => { if (url.includes(':44173/')) throw new Error('refused'); return fetcher(url); });
    expect(await discoverHermesBackend(unavailable, () => readHermesRendezvous(dir))).toMatchObject({ kind: 'usable', port: 9119 });
  });
  it('supports IPv6 loopback without accepting a remote host', async () => {
    const { dir } = await fixture({ host: '::1' }); const { fetcher } = backend();
    expect(await discoverHermesBackend(fetcher, () => readHermesRendezvous(dir))).toMatchObject({ kind: 'usable', host: '[::1]' });
    expect(fetcher.mock.calls[0][0]).toBe('http://[::1]:44173/api/status');
  });
  it('service adopts without spawning or ever stopping the external backend', async () => {
    const { dir } = await fixture(); const { hermes, fetcher } = backend(); const spawn = vi.fn();
    const service = new HermesAssistantService({ readSettings: () => ({ enabled: true, autoStart: true }), writeSettings: vi.fn(), onChanged: vi.fn(), onPtyData: vi.fn(), isShuttingDown: () => false, isHermesAvailable: () => true, fetch: fetcher, readRendezvous: () => readHermesRendezvous(dir), spawnServe: spawn, createWebSocket: hermes.createWebSocket });
    expect((await service.refresh()).service).toMatchObject({ state: 'connected', ownership: 'external' });
    expect(spawn).not.toHaveBeenCalled(); expect(service.hasRunningOwnedService()).toBe(false);
    expect(hermes.wsSockets()[0].url).toContain(':44173/api/ws');
    await service.shutdown(); expect(spawn).not.toHaveBeenCalled(); expect(hermes.running).toBe(true);
  });
});
