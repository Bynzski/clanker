import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { localExec } = vi.hoisted(() => ({ localExec: vi.fn() }));
vi.mock('../../../src/main/environment/localCommandExecutor', () => ({ executeLocalHarnessCommand: localExec }));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, app: { getPath: () => '/home/test' } }));

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getHarnessProvider, getHarnessProviders } from '../../../src/main/harnesses/registry';
import { HarnessCapabilityError, type HarnessProvider, type HarnessUsageCapability, type HarnessUsageSnapshot } from '../../../src/main/harnesses/types';
import { HarnessUsageService, USAGE_FORCE_FLOOR_MS, DEFAULT_USAGE_CACHE_TTL_MS, USAGE_PROVIDER_DEADLINE_MS } from '../../../src/main/usage/harnessUsageService';
import { LocalEnvironment } from '../../../src/main/environment/localEnvironment';
import { SshEnvironment } from '../../../src/main/remote/sshEnvironment';
import { SshExecutionError, type SshCommandExecutor } from '../../../src/main/remote/sshCommandExecutor';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import type { WorkspaceEnvironment } from '../../../src/main/environment/workspaceEnvironment';
import { registerUsageIpc } from '../../../src/main/ipc/usageIpc';
import { HARNESS_USAGE_GET, ALL_IPC_CHANNELS } from '../../../src/shared/ipcChannels';

const snapshot = (overrides: Partial<HarnessUsageSnapshot['measurements'][number]> = {}): HarnessUsageSnapshot => ({
  observedAt: 1000,
  measurements: [{ kind: 'allowance', unit: 'percent', used: 25, limit: 100, remaining: 75, resetsAt: 5000, label: '5 hour',
    scope: { accountId: 'acct-secret-key', accountLabel: 'me@example.com', providerId: 'openai' }, ...overrides }],
});

function withUsage(id: 'codex' | 'claude' | 'pi' | 'omp', usage?: HarnessUsageCapability): HarnessProvider {
  return { ...getHarnessProvider(id), usage };
}

function registryFor(environment: WorkspaceEnvironment, workspaceId = 'ws') {
  const registry = new WorkspaceRegistry(() => environment);
  return { registry, register: () => registry.registerWorkspace({ workspaceId, workspacePath: '/ws', environmentId: environment.id }) };
}
function fakeEnv(kind: 'local' | 'ssh', id = kind === 'local' ? 'local' : 'ssh-1') {
  return {
    id, kind, label: id, capabilities: {}, validateWorkspacePath: async () => ({ valid: true, resolvedPath: '/ws' }),
    executeHarnessCommand: vi.fn().mockResolvedValue({ stdout: '{}', stderr: '', exitCode: 0 }),
  } as unknown as WorkspaceEnvironment & { executeHarnessCommand: ReturnType<typeof vi.fn> };
}

beforeEach(() => { localExec.mockReset(); localExec.mockResolvedValue({ stdout: 'local-out', stderr: '', exitCode: 0 }); });
afterEach(() => { vi.useRealTimers(); });

describe('HarnessUsageService delegation', () => {
  it('represents providers without usage as explicitly unsupported (every real provider except OMP/Hermes/Agy)', async () => {
    const env = fakeEnv('local');
    const { registry, register } = registryFor(env); await register();
    const response = await new HarnessUsageService(registry).get('ws');
    expect(response.entries.map((e) => e.harnessId)).toEqual(getHarnessProviders().map((p) => p.descriptor.id));
    for (const entry of response.entries.filter((e) => !['omp', 'hermes', 'agy'].includes(e.harnessId))) expect(entry).toMatchObject({ status: 'unsupported', measurements: [] });
    expect(env.executeHarnessCommand).toHaveBeenCalledTimes(3); // only the real adapters probe (agy stops after its version check)
  });

  it('calls provider.usage.get generically with only an executor, transport and signal', async () => {
    const env = fakeEnv('local');
    const { registry, register } = registryFor(env); await register();
    const get = vi.fn(async (ctx) => { await ctx.executor.run({ command: 'probe', args: ['--json'] }); return snapshot(); });
    const service = new HarnessUsageService(registry, { providers: () => [withUsage('codex', { get })] });
    const [entry] = (await service.get('ws')).entries;
    expect(entry).toMatchObject({ harnessId: 'codex', status: 'ok', observedAt: 1000 });
    expect(Object.keys(get.mock.calls[0][0]).sort()).toEqual(['clientInfo', 'executor', 'signal', 'transport']);
    expect(get.mock.calls[0][0].clientInfo).toEqual({ name: 'clanker-grid', title: 'Clanker Grid', version: 'unknown' });
    expect(get.mock.calls[0][0].transport).toBe('local');
    expect(env.executeHarnessCommand).toHaveBeenCalledWith({ command: 'probe', args: ['--json'] }, expect.any(AbortSignal));
  });

  it('local workspaces run through LocalEnvironment execution', async () => {
    const env = new LocalEnvironment();
    const { registry, register } = registryFor(env);
    vi.spyOn(env, 'validateWorkspacePath').mockResolvedValue({ valid: true, resolvedPath: '/ws' });
    await register();
    const provider = withUsage('codex', { get: async ({ executor }) => { const r = await executor.run({ command: 'probe' }); expect(r.stdout).toBe('local-out'); return snapshot(); } });
    const [entry] = (await new HarnessUsageService(registry, { providers: () => [provider] }).get('ws')).entries;
    expect(entry.status).toBe('ok');
    expect(localExec).toHaveBeenCalledTimes(1);
  });

  it('SSH workspaces run through SshCommandExecutor and never the local path', async () => {
    const exec = vi.fn(async (_t: string, _c: string, args: string[]) => ({ stdout: String(args[1]).includes('command -v') ? 'codex\n' : 'remote-out', stderr: '', exitCode: 0 }));
    const env = new SshEnvironment({ kind: 'ssh', id: 'ssh-1', label: 'r', target: 'me@remote' }, { exec } as unknown as SshCommandExecutor);
    vi.spyOn(env, 'validateWorkspacePath').mockResolvedValue({ valid: true, resolvedPath: '/ws' });
    const { registry, register } = registryFor(env); await register();
    const provider = withUsage('codex', { get: async ({ executor, transport }) => {
      expect(transport).toBe('ssh');
      expect((await executor.run({ command: 'probe' })).stdout).toBe('remote-out'); return snapshot();
    } });
    expect((await new HarnessUsageService(registry, { providers: () => [provider] }).get('ws')).entries[0].status).toBe('ok');
    expect(exec).toHaveBeenCalledWith('me@remote', 'sh', expect.any(Array), expect.any(Object));
    expect(localExec).not.toHaveBeenCalled();
  });

  it('SSH failure is reported, not retried locally', async () => {
    const exec = vi.fn().mockRejectedValue(new SshExecutionError('Permission denied', 255, '', 'Permission denied'));
    const env = new SshEnvironment({ kind: 'ssh', id: 'ssh-1', label: 'r', target: 'me@remote' }, { exec } as unknown as SshCommandExecutor);
    vi.spyOn(env, 'validateWorkspacePath').mockResolvedValue({ valid: true, resolvedPath: '/ws' });
    const { registry, register } = registryFor(env); await register();
    const provider = withUsage('codex', { get: ({ executor }) => executor.run({ command: 'probe' }).then(() => snapshot()) });
    const [entry] = (await new HarnessUsageService(registry, { providers: () => [provider] }).get('ws')).entries;
    expect(entry).toMatchObject({ status: 'unavailable', error: 'Usage temporarily unavailable' });
    expect(entry.error).not.toContain('Permission');
    expect(localExec).not.toHaveBeenCalled();
  });

  it('reports unavailable when the environment cannot execute commands', async () => {
    const env = fakeEnv('ssh'); delete (env as { executeHarnessCommand?: unknown }).executeHarnessCommand;
    const { registry, register } = registryFor(env); await register();
    const service = new HarnessUsageService(registry, { providers: () => [withUsage('codex', { get: async () => snapshot() })] });
    expect((await service.get('ws')).entries[0].status).toBe('unavailable');
  });
});

describe('shared availability flight across per-harness requests', () => {
  const probeEnv = (impl: () => Promise<string[]>) => {
    const env = fakeEnv('ssh') as ReturnType<typeof fakeEnv> & { probeAvailableHarnessIds: ReturnType<typeof vi.fn> };
    env.probeAvailableHarnessIds = vi.fn(impl);
    return env;
  };
  const three = () => [withUsage('codex', { get: vi.fn(async () => snapshot()) }), withUsage('claude', { get: vi.fn(async () => snapshot()) }), withUsage('pi', { get: vi.fn(async () => snapshot()) })];

  it('concurrent per-harness requests cause one availability probe while provider probes stay independent', async () => {
    const env = probeEnv(async () => ['codex', 'claude', 'pi']);
    const { registry, register } = registryFor(env); await register();
    const providers = three();
    const service = new HarnessUsageService(registry, { providers: () => providers });
    const results = await Promise.all(['codex', 'claude', 'pi'].map((id) => service.get('ws', { harnessIds: [id] })));
    expect(env.probeAvailableHarnessIds).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.entries.map((e) => [e.harnessId, e.status]))).toEqual([[['codex', 'ok']], [['claude', 'ok']], [['pi', 'ok']]]);
    for (const provider of providers) expect(provider.usage!.get).toHaveBeenCalledTimes(1);
  });
  it('concurrent forced requests share one availability refresh, and force bypasses a stale cached answer', async () => {
    let now = 0;
    const env = probeEnv(async () => ['codex', 'claude', 'pi']);
    const { registry, register } = registryFor(env); await register();
    const service = new HarnessUsageService(registry, { now: () => now, providers: three });
    await service.get('ws');
    expect(env.probeAvailableHarnessIds).toHaveBeenCalledTimes(1);
    now += 15_000;
    await Promise.all(['codex', 'claude', 'pi'].map((id) => service.get('ws', { harnessIds: [id], force: true })));
    expect(env.probeAvailableHarnessIds).toHaveBeenCalledTimes(2);
  });
  it('a failed or empty shared flight is inconclusive, lets provider probes run, and does not poison later checks', async () => {
    for (const impl of [async () => { throw new Error('ssh down'); }, async () => [] as string[]]) {
      const calls = { n: 0 };
      const env = probeEnv(async () => { calls.n++; return calls.n === 1 ? impl() : ['codex']; });
      const { registry, register } = registryFor(env, 'w');
      await register();
      const workspaceId = 'w';
      const providers = three();
      const service = new HarnessUsageService(registry, { providers: () => providers });
      const first = await Promise.all(['codex', 'claude'].map((h) => service.get(workspaceId, { harnessIds: [h] })));
      expect(first.every((r) => r.entries[0].status === 'ok')).toBe(true);
      expect(calls.n).toBe(1);
      const later = await service.get(workspaceId, { harnessIds: ['pi'] });
      expect(calls.n).toBe(2); // the failed flight was removed, so the next request checks again
      expect(later.entries[0].status).toBe('not-installed'); // the second answer ('codex' only) is authoritative
    }
  });
});

describe('client identity', () => {
  it('passes the desktop version to providers, read lazily at probe time', async () => {
    const env = fakeEnv('local');
    const { registry, register } = registryFor(env); await register();
    const get = vi.fn(async (...args: unknown[]) => { void args; return snapshot(); });
    let version = '1.0.0';
    const service = new HarnessUsageService(registry, { clientVersion: () => version, providers: () => [withUsage('codex', { get })] });
    version = '2.0.0';
    await service.get('ws');
    expect((get.mock.calls[0][0] as { clientInfo: unknown }).clientInfo).toEqual({ name: 'clanker-grid', title: 'Clanker Grid', version: '2.0.0' });
  });
});

describe('workspace identity', () => {
  it('rejects unregistered workspaces and non-string IDs', async () => {
    const { registry } = registryFor(fakeEnv('local'));
    const service = new HarnessUsageService(registry);
    await expect(service.get('missing')).rejects.toThrow('not registered');
    await expect(service.get({} as unknown as string)).rejects.toThrow('not registered');
  });

  it('does not deliver a result to a workspace that closed or was replaced mid-request', async () => {
    const env = fakeEnv('local');
    const { registry, register } = registryFor(env); await register();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const provider = withUsage('codex', { get: async () => { await gate; return snapshot(); } });
    const service = new HarnessUsageService(registry, { providers: () => [provider] });
    const pending = service.get('ws');
    registry.unregisterWorkspace('ws');
    await register(); // same ID, new registration
    release();
    await expect(pending).rejects.toThrow('Workspace closed during usage request');
  });

  it('keeps local and SSH caches separate even for the same harness', async () => {
    const local = fakeEnv('local'); const remote = fakeEnv('ssh');
    const registry = new WorkspaceRegistry((id) => (id === 'local' ? local : remote));
    await registry.registerWorkspace({ workspaceId: 'a', workspacePath: '/ws' });
    await registry.registerWorkspace({ workspaceId: 'b', workspacePath: '/ws', environmentId: 'ssh-1' });
    const get = vi.fn(async ({ transport }) => snapshot({ used: transport === 'ssh' ? 90 : 10 }));
    const service = new HarnessUsageService(registry, { providers: () => [withUsage('codex', { get })] });
    const a = await service.get('a'); const b = await service.get('b');
    expect(get).toHaveBeenCalledTimes(2);
    expect(a.entries[0].measurements[0].used).toBe(10);
    expect(b.entries[0].measurements[0].used).toBe(90);
  });
});

describe('isolation, caching and bounds', () => {
  it('one provider failing or returning malformed data does not affect the others', async () => {
    const env = fakeEnv('local');
    const { registry, register } = registryFor(env); await register();
    const providers = [
      withUsage('codex', { get: async () => { throw new HarnessCapabilityError('unauthenticated', 'token=sk-secret-123'); } }),
      withUsage('claude', { get: async () => ({ observedAt: 1, measurements: [{ kind: 'allowance', unit: 'percent', used: NaN }] }) as HarnessUsageSnapshot }),
      withUsage('pi', { get: async () => snapshot() }),
      withUsage('omp'),
    ];
    const { entries } = await new HarnessUsageService(registry, { providers: () => providers }).get('ws');
    expect(entries.map((e) => [e.harnessId, e.status])).toEqual([['codex', 'unauthenticated'], ['claude', 'error'], ['pi', 'ok'], ['omp', 'unsupported']]);
    expect(JSON.stringify(entries)).not.toContain('sk-secret');
  });

  it('maps failure categories (timeout, output limit, non-zero exit) to safe statuses', async () => {
    const env = fakeEnv('local');
    const { registry, register } = registryFor(env); await register();
    const failing = (kind: ConstructorParameters<typeof HarnessCapabilityError>[0]) => ({ get: async () => { throw new HarnessCapabilityError(kind, 'raw stderr SECRET'); } });
    const providers = [withUsage('codex', failing('timeout')), withUsage('claude', failing('output-limit')), withUsage('pi', failing('binary-unavailable')), withUsage('omp', failing('command-failed'))];
    const { entries } = await new HarnessUsageService(registry, { providers: () => providers }).get('ws');
    expect(entries.map((e) => e.status)).toEqual(['unavailable', 'error', 'not-installed', 'error']);
    expect(JSON.stringify(entries)).not.toContain('SECRET');
  });

  it('caches, deduplicates concurrent probes, honors force with a floor, and backs off failures', async () => {
    let now = 1_000_000;
    const env = fakeEnv('local');
    const { registry, register } = registryFor(env); await register();
    let calls = 0; let fail = false;
    const get = vi.fn(async () => { calls++; if (fail) throw new Error('boom'); return snapshot({ used: calls }); });
    const service = new HarnessUsageService(registry, { now: () => now, providers: () => [withUsage('codex', { get })] });
    await Promise.all([service.get('ws'), service.get('ws'), service.get('ws')]);
    expect(calls).toBe(1);
    await service.get('ws'); expect(calls).toBe(1);
    await service.get('ws', { force: true }); expect(calls).toBe(1); // inside the floor
    now += USAGE_FORCE_FLOOR_MS;
    await service.get('ws', { force: true }); expect(calls).toBe(2);
    now += DEFAULT_USAGE_CACHE_TTL_MS;
    fail = true;
    const failed = (await service.get('ws')).entries[0];
    expect(calls).toBe(3);
    expect(failed).toMatchObject({ status: 'error', stale: true });
    expect(failed.measurements[0].used).toBe(2); // last good reading retained
    await service.get('ws'); expect(calls).toBe(3); // failure backoff
    now += 61_000; fail = false;
    expect((await service.get('ws')).entries[0].status).toBe('ok');
  });

  it('applies a provider-specific refresh policy', async () => {
    let now = 0; const env = fakeEnv('local');
    const { registry, register } = registryFor(env); await register();
    const get = vi.fn(async () => snapshot());
    const service = new HarnessUsageService(registry, { now: () => now, providers: () => [withUsage('codex', { get, refresh: { cacheTtlMs: 20 * 60_000 } })] });
    expect((await service.get('ws')).entries[0].nextRefreshAt).toBe(20 * 60_000);
    now = 19 * 60_000; await service.get('ws'); expect(get).toHaveBeenCalledTimes(1);
  });

  it('abandons a provider that ignores cancellation after the deadline', async () => {
    vi.useFakeTimers();
    const env = fakeEnv('local');
    const { registry, register } = registryFor(env); await register();
    let aborted = false;
    const provider = withUsage('codex', { get: ({ signal }) => { signal.addEventListener('abort', () => { aborted = true; }); return new Promise(() => {}); } });
    const pending = new HarnessUsageService(registry, { providers: () => [provider] }).get('ws');
    await vi.advanceTimersByTimeAsync(USAGE_PROVIDER_DEADLINE_MS + 1);
    expect((await pending).entries[0]).toMatchObject({ status: 'unavailable' });
    expect(aborted).toBe(true);
  });

  it('dispose aborts in-flight probes', async () => {
    const env = fakeEnv('local');
    const { registry, register } = registryFor(env); await register();
    let signal!: AbortSignal;
    const provider = withUsage('codex', { get: (ctx) => { signal = ctx.signal; return new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new HarnessCapabilityError('aborted', 'x')))); } });
    const service = new HarnessUsageService(registry, { providers: () => [provider] });
    const pending = service.get('ws');
    await Promise.resolve(); await Promise.resolve();
    service.dispose();
    expect(signal.aborted).toBe(true);
    expect((await pending).entries[0].status).toBe('unavailable');
  });

  it('sanitizes snapshots: drops account IDs and unknown fields, rejects oversize/bad shapes', async () => {
    const env = fakeEnv('local');
    const { registry, register } = registryFor(env); await register();
    const leaky = snapshot(); (leaky.measurements[0] as unknown as Record<string, unknown>).token = 'sk-leak'; (leaky.measurements[0].scope as unknown as Record<string, unknown>).authPath = '/home/u/.codex/auth.json';
    const many = { observedAt: 1, measurements: Array.from({ length: 65 }, () => snapshot().measurements[0]) };
    const providers = [withUsage('codex', { get: async () => leaky }), withUsage('claude', { get: async () => many })];
    const { entries } = await new HarnessUsageService(registry, { providers: () => providers }).get('ws');
    const text = JSON.stringify(entries[0]);
    expect(text).not.toMatch(/sk-leak|auth\.json|acct-secret-key/);
    expect(entries[0].measurements[0].scope).toEqual({ accountLabel: 'me@example.com', providerId: 'openai' });
    expect(entries[1].status).toBe('error');
  });

  it('supports multi-provider, non-window measurements', async () => {
    const env = fakeEnv('local');
    const { registry, register } = registryFor(env); await register();
    const multi: HarnessUsageSnapshot = { observedAt: 5, measurements: [
      { kind: 'spend', unit: 'usd', used: 3.2, limit: 10, scope: { providerId: 'openrouter' } },
      { kind: 'tokens', unit: 'tokens', remaining: 1e6, period: { label: 'monthly', endsAt: 9 }, scope: { providerId: 'anthropic', accountId: 'a' } },
      { kind: 'rate-limit', unit: 'requests', remaining: 3, resetsAt: 7 },
    ] };
    const { entries } = await new HarnessUsageService(registry, { providers: () => [withUsage('omp', { get: async () => multi })] }).get('ws');
    expect(entries[0].measurements).toHaveLength(3);
    expect(entries[0].measurements[1].period).toEqual({ label: 'monthly', endsAt: 9 });
  });

  it('filters requested harness IDs and ignores unknown ones', async () => {
    const env = fakeEnv('local');
    const { registry, register } = registryFor(env); await register();
    const service = new HarnessUsageService(registry);
    expect((await service.get('ws', { harnessIds: ['pi', 'nope'] })).entries.map((e) => e.harnessId)).toEqual(['pi']);
  });
});

describe('hard provider limits vs ordinary cache freshness', () => {
  async function setup(refresh: HarnessUsageCapability['refresh'], failing = () => false) {
    let now = 1_000_000;
    const env = fakeEnv('local');
    const { registry, register } = registryFor(env); await register();
    const get = vi.fn(async () => { if (failing()) throw new Error('rate limited'); return snapshot(); });
    const service = new HarnessUsageService(registry, { now: () => now, providers: () => [withUsage('codex', { get, refresh })] });
    return { service, get, advance: (ms: number) => { now += ms; } };
  }

  it('lets a manual refresh bypass ordinary cache TTL once the global floor passes', async () => {
    const { service, get, advance } = await setup({ cacheTtlMs: 30 * 60_000 });
    await service.get('ws');
    advance(USAGE_FORCE_FLOOR_MS);
    await service.get('ws'); expect(get).toHaveBeenCalledTimes(1);
    await service.get('ws', { force: true }); expect(get).toHaveBeenCalledTimes(2);
  });

  it('repeated forced refreshes cannot defeat an explicit provider minimum', async () => {
    const { service, get, advance } = await setup({ minimumProbeIntervalMs: 5 * 60_000 });
    await service.get('ws');
    for (let i = 0; i < 4; i++) { advance(60_000); await service.get('ws', { force: true }); }
    expect(get).toHaveBeenCalledTimes(1); // 4 of 5 minutes elapsed
    const entry = (await service.get('ws', { force: true })).entries[0];
    expect(entry.refreshableAt).toBe(entry.checkedAt! + 5 * 60_000);
    advance(60_000);
    await service.get('ws', { force: true }); expect(get).toHaveBeenCalledTimes(2);
  });

  it('repeated forced refreshes cannot defeat failure backoff', async () => {
    let failing = true;
    const { service, get, advance } = await setup({ failureBackoffMs: 5 * 60_000 }, () => failing);
    expect((await service.get('ws')).entries[0].status).toBe('error');
    for (let i = 0; i < 4; i++) { advance(60_000); await service.get('ws', { force: true }); }
    expect(get).toHaveBeenCalledTimes(1);
    failing = false; advance(61_000);
    expect((await service.get('ws', { force: true })).entries[0].status).toBe('ok');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('still deduplicates concurrent forced refreshes', async () => {
    const { service, get, advance } = await setup(undefined);
    await service.get('ws'); advance(USAGE_FORCE_FLOOR_MS);
    await Promise.all([service.get('ws', { force: true }), service.get('ws', { force: true })]);
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('provider-demanded backoff', () => {
  it('a failure can require a longer hard backoff than the policy, even under force', async () => {
    let now = 1_000_000; const env = fakeEnv('local');
    const { registry, register } = registryFor(env); await register();
    const get = vi.fn(async () => { throw new HarnessCapabilityError('unsupported', 'x', undefined, 3_600_000); });
    const service = new HarnessUsageService(registry, { now: () => now, providers: () => [withUsage('codex', { get })] });
    await service.get('ws');
    for (let i = 0; i < 5; i++) { now += 600_000; await service.get('ws', { force: true }); }
    expect(get).toHaveBeenCalledTimes(1);
    now += 700_000; await service.get('ws', { force: true });
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('retryAfterMs normalization', () => {
  it.each([[NaN], [Infinity], [-Infinity], [-5], [0]])('ignores a non-positive/non-finite demand (%s) instead of corrupting cache timing', async (demand) => {
    let now = 1_000_000; const env = fakeEnv('local');
    const { registry, register } = registryFor(env); await register();
    const get = vi.fn(async () => { throw new HarnessCapabilityError('command-failed', 'x', undefined, demand); });
    const service = new HarnessUsageService(registry, { now: () => now, providers: () => [withUsage('codex', { get, refresh: { failureBackoffMs: 60_000 } })] });
    const entry = (await service.get('ws')).entries[0];
    expect(Number.isFinite(entry.nextRefreshAt)).toBe(true);
    expect(entry.nextRefreshAt).toBe(now + 60_000);
    expect(entry.refreshableAt).toBe(now + 60_000);
    now += 61_000; await service.get('ws', { force: true });
    expect(get).toHaveBeenCalledTimes(2); // backoff expired normally; Infinity did not freeze the provider
  });
});

describe('interactive sessions', () => {
  const sessionEnv = () => {
    const env = fakeEnv('local') as unknown as Record<string, unknown> & ReturnType<typeof fakeEnv>;
    const open = vi.fn();
    const sessions: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
    open.mockImplementation(async () => { const session = { dispose: vi.fn(async () => {}) }; sessions.push(session); return session; });
    env.openHarnessCommandSession = open;
    return { env, sessions, open };
  };
  it('exposes the environment session seam to providers and reaps leaked sessions after the probe', async () => {
    const { env, sessions, open } = sessionEnv();
    const { registry, register } = registryFor(env); await register();
    const get = vi.fn(async (ctx) => { await ctx.sessionExecutor.open({ command: 'tool' }); return snapshot(); }); // never disposes
    await new HarnessUsageService(registry, { providers: () => [withUsage('codex', { get })] }).get('ws');
    expect(open).toHaveBeenCalledWith({ command: 'tool' }, expect.any(AbortSignal));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].dispose).toHaveBeenCalledTimes(1);
  });
  it('reaps sessions even when the probe fails, and omits the executor when the environment has none', async () => {
    const { env, sessions } = sessionEnv();
    const { registry, register } = registryFor(env); await register();
    const failing = vi.fn(async (ctx) => { await ctx.sessionExecutor.open({ command: 'tool' }); throw new HarnessCapabilityError('timeout', 'x'); });
    await new HarnessUsageService(registry, { providers: () => [withUsage('codex', { get: failing })] }).get('ws');
    expect(sessions[0].dispose).toHaveBeenCalledTimes(1);

    const plain = fakeEnv('ssh');
    const other = registryFor(plain, 'other'); await other.register();
    const seen = vi.fn(async (ctx) => { expect('sessionExecutor' in ctx).toBe(false); return snapshot(); });
    await new HarnessUsageService(other.registry, { providers: () => [withUsage('codex', { get: seen })] }).get('other');
    expect(seen).toHaveBeenCalled();
  });
});

describe('opaque account identity', () => {
  it('is retained in main but never returned to the renderer', async () => {
    const env = fakeEnv('local');
    const { registry, register } = registryFor(env); await register();
    const service = new HarnessUsageService(registry, { providers: () => [withUsage('codex', { get: async () => snapshot() })] });
    const response = await service.get('ws');
    expect(JSON.stringify(response)).not.toContain('acct-secret-key');
    expect(JSON.stringify(response)).toContain('me@example.com');
    const [cached] = service.getCachedSnapshots('ws');
    expect(cached).toMatchObject({ harnessId: 'codex', status: 'ok' });
    expect(cached.snapshot.measurements[0].scope).toMatchObject({ accountId: 'acct-secret-key', providerId: 'openai' });
    // Cached copy is unaffected by the renderer projection, and survives a stale failure.
    expect(service.getCachedSnapshots('ws')[0].snapshot.measurements[0].scope?.accountId).toBe('acct-secret-key');
  });
});

describe('installed-harness detection', () => {
  const probeable = (ids: string[] | Error) => {
    const env = fakeEnv('ssh') as ReturnType<typeof fakeEnv> & { probeAvailableHarnessIds: ReturnType<typeof vi.fn> };
    env.probeAvailableHarnessIds = ids instanceof Error ? vi.fn().mockRejectedValue(ids) : vi.fn().mockResolvedValue(ids);
    return env;
  };

  it('reports not-installed without probing, once per request batch, and probes installed adapters', async () => {
    const env = probeable(['codex']);
    const { registry, register } = registryFor(env); await register();
    const gets = { codex: vi.fn(async () => snapshot()), claude: vi.fn(async () => snapshot()), pi: vi.fn(async () => snapshot()) };
    const providers = [withUsage('codex', { get: gets.codex }), withUsage('claude', { get: gets.claude }), withUsage('pi', { get: gets.pi }), withUsage('omp')];
    const { entries } = await new HarnessUsageService(registry, { providers: () => providers }).get('ws');
    expect(entries.map((e) => [e.harnessId, e.status])).toEqual([['codex', 'ok'], ['claude', 'not-installed'], ['pi', 'not-installed'], ['omp', 'unsupported']]);
    expect(gets.claude).not.toHaveBeenCalled();
    expect(env.probeAvailableHarnessIds).toHaveBeenCalledTimes(1);
  });

  it('is one batched SSH availability call regardless of provider count', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: 'codex\npi\n', stderr: '', exitCode: 0 });
    const env = new SshEnvironment({ kind: 'ssh', id: 'ssh-1', label: 'r', target: 'me@remote' }, { exec } as unknown as SshCommandExecutor);
    vi.spyOn(env, 'validateWorkspacePath').mockResolvedValue({ valid: true, resolvedPath: '/ws' });
    const { registry, register } = registryFor(env); await register();
    const get = async ({ executor }: { executor: { run: (r: { command: string }) => Promise<unknown> } }) => { await executor.run({ command: 'x' }); return snapshot(); };
    const providers = [withUsage('codex', { get }), withUsage('claude', { get }), withUsage('pi', { get }), withUsage('omp', { get })];
    await new HarnessUsageService(registry, { providers: () => providers }).get('ws');
    const availabilityCalls = exec.mock.calls.filter(([, , args]) => String(args[1]).includes('command -v'));
    expect(availabilityCalls).toHaveLength(1);
  });

  it('treats a failed or empty availability answer as inconclusive and still probes', async () => {
    for (const ids of [new Error('ssh down'), []] as const) {
      const env = probeable(ids as string[] | Error);
      const { registry, register } = registryFor(env, 'w'); await register();
      const get = vi.fn(async () => snapshot());
      const { entries } = await new HarnessUsageService(registry, { providers: () => [withUsage('codex', { get })] }).get('w');
      expect(entries[0].status).toBe('ok');
    }
  });

  it('reuses the availability answer across requests within its window', async () => {
    const env = probeable(['codex']);
    const { registry, register } = registryFor(env); await register();
    let now = 0;
    const providers = [withUsage('codex', { get: async () => snapshot() }), withUsage('claude', { get: async () => snapshot() })];
    const service = new HarnessUsageService(registry, { now: () => now, providers: () => providers });
    await service.get('ws'); now += 1000; await service.get('ws');
    expect(env.probeAvailableHarnessIds).toHaveBeenCalledTimes(1);
  });

  it('a remote command exiting 127 is the provider\'s result, not a missing harness', async () => {
    const exec = vi.fn().mockRejectedValue(new SshExecutionError('x', 127, '', ''));
    const env = new SshEnvironment({ kind: 'ssh', id: 'ssh-1', label: 'r', target: 'me@remote' }, { exec } as unknown as SshCommandExecutor);
    vi.spyOn(env, 'validateWorkspacePath').mockResolvedValue({ valid: true, resolvedPath: '/ws' });
    vi.spyOn(env, 'probeAvailableHarnessIds').mockResolvedValue(['codex']);
    const { registry, register } = registryFor(env); await register();
    const provider = withUsage('codex', { get: async ({ executor }) => { const r = await executor.run({ command: 'probe' }); if (r.exitCode !== 0) throw new HarnessCapabilityError('command-failed', 'bad'); return snapshot(); } });
    expect((await new HarnessUsageService(registry, { providers: () => [provider] }).get('ws')).entries[0].status).toBe('error');
  });
});

describe('IPC and preload contract', () => {
  it('registers a centralized channel taking only workspaceId and plain options', async () => {
    const { ipcMain } = await import('electron');
    const handle = ipcMain.handle as unknown as ReturnType<typeof vi.fn>;
    handle.mockClear();
    const get = vi.fn().mockResolvedValue({ workspaceId: 'ws', entries: [] });
    registerUsageIpc({ getUsageService: () => ({ get }) as unknown as HarnessUsageService });
    expect(ALL_IPC_CHANNELS).toContain(HARNESS_USAGE_GET);
    const [channel, handler] = handle.mock.calls[0];
    expect(channel).toBe(HARNESS_USAGE_GET);
    await handler({}, 'ws', { harnessIds: ['codex'], force: true, target: 'evil@host', env: { A: '1' }, path: '/etc' });
    expect(get).toHaveBeenCalledWith('ws', { harnessIds: ['codex'], force: true });
    await expect(handler({}, 42)).rejects.toThrow();
    await expect(handler({}, 'ws', { harnessIds: [1] })).rejects.toThrow('Invalid usage request');
    await expect(handler({}, 'ws', 'x')).rejects.toThrow('Invalid usage request');
  });

  it('preload exposes only workspaceId and request options', () => {
    const source = readFileSync(resolve(__dirname, '../../../src/main/preload.ts'), 'utf8');
    const match = /getHarnessUsage:[^\n]*\n[^\n]*\n/.exec(source)?.[0] ?? '';
    expect(match).toContain('workspaceId: string, request?: HarnessUsageRequest');
    expect(match).toContain('ipcRenderer.invoke(HARNESS_USAGE_GET, workspaceId, request)');
    expect(match).not.toMatch(/target|token|credential|env|path/i);
  });

  it('the shared response type has no credential-bearing fields', () => {
    const source = readFileSync(resolve(__dirname, '../../../src/shared/types/harnessUsage.ts'), 'utf8');
    const properties = [...source.matchAll(/^\s*(?:\w+\??|\{\s*\w+\??):/gm)].map((m) => m[0]);
    expect(source.match(/\b(\w+)\??:/g)?.join(' ')).not.toMatch(/\b(accountId|token|secret|password|authPath|env|target|credentials?)\??:/);
    expect(properties.length).toBeGreaterThan(0);
  });
});
