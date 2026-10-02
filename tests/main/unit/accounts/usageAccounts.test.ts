import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { getHarnessProvider } from '../../../../src/main/harnesses/registry';
import { HarnessCapabilityError, type HarnessProvider, type HarnessUsageContext, type HarnessUsageSnapshot } from '../../../../src/main/harnesses/types';
import { HarnessUsageService } from '../../../../src/main/usage/harnessUsageService';
import { WorkspaceRegistry } from '../../../../src/main/workspaceRegistry';
import type { WorkspaceEnvironment } from '../../../../src/main/environment/workspaceEnvironment';
import { addAccount, createHarness, type Harness } from './accountFixtures';

const snapshot = (used = 10): HarnessUsageSnapshot => ({ observedAt: 1000, measurements: [{ kind: 'rate-limit', unit: 'percent', used, limit: 100, remaining: 100 - used, label: '5 hour', scope: { accountLabel: 'x@example.test' } }] });

function env(kind: 'local' | 'ssh' = 'local') {
  return {
    id: kind === 'local' ? 'local' : 'ssh-1', kind, label: kind, capabilities: {},
    validateWorkspacePath: async () => ({ valid: true, resolvedPath: '/ws' }),
    executeHarnessCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    openHarnessCommandSession: vi.fn(),
  } as unknown as WorkspaceEnvironment & { executeHarnessCommand: ReturnType<typeof vi.fn> };
}

let h: Harness;
let clock: number;
beforeEach(() => { h = createHarness(); clock = 1_000_000; });
afterEach(() => { fs.rmSync(h.root, { recursive: true, force: true }); });

async function setup(options: { kind?: 'local' | 'ssh'; get?: (context: HarnessUsageContext) => Promise<HarnessUsageSnapshot> } = {}) {
  const environment = env(options.kind);
  const registry = new WorkspaceRegistry(() => environment);
  await registry.registerWorkspace({ workspaceId: 'ws', workspacePath: '/ws', environmentId: environment.id });
  const get = vi.fn(options.get ?? (async () => snapshot()));
  const provider: HarnessProvider = { ...getHarnessProvider('codex'), usage: { get, refresh: { cacheTtlMs: 60_000, minimumProbeIntervalMs: 60_000, failureBackoffMs: 120_000 } }, accounts: h.capabilities.codex };
  const service = new HarnessUsageService(registry, { providers: () => [provider], accounts: h.service, now: () => clock });
  return { service, get, environment };
}

describe('default-only users', () => {
  it('keep the exact single-entry shape and the provider context they always had', async () => {
    const { service, get } = await setup();
    const { entries } = await service.get('ws');
    expect(entries).toHaveLength(1);
    expect(entries[0]).not.toHaveProperty('account');
    expect(Object.keys(get.mock.calls[0][0]).sort()).toEqual(['clientInfo', 'executor', 'sessionExecutor', 'signal', 'transport']);
  });
});

describe('with managed accounts', () => {
  it('probes each account independently under its own bound environment, selected account first', async () => {
    const work = await addAccount(h, 'codex', 'Work');
    h.service.select('local', 'codex', work.id);
    const seen: Array<{ accountId?: string }> = [];
    const { service, environment } = await setup({ get: async (context) => { seen.push({ accountId: context.accountId }); await context.executor.run({ command: 'probe' }); return snapshot(); } });
    const { entries } = await service.get('ws');
    expect(entries.map((e) => e.account)).toEqual([
      { id: work.id, name: 'Work', selected: true },
      { id: 'default', name: 'Default', selected: false },
    ]);
    expect(seen.map((s) => s.accountId).sort()).toEqual([undefined, work.id].sort());
    const envs = environment.executeHarnessCommand.mock.calls.map((call) => call[0].env);
    expect(envs).toContainEqual({ CODEX_HOME: h.homes.resolve('codex', work.id) });
    expect(envs.filter((e) => e === undefined)).toHaveLength(1); // default account: request untouched
    expect(JSON.stringify(entries)).not.toContain(h.root);
  });

  it('caches and backs off per environment + harness + account', async () => {
    const work = await addAccount(h, 'codex', 'Work');
    const { service, get } = await setup({ get: async (context) => { if (context.accountId) throw new HarnessCapabilityError('command-failed', 'boom'); return snapshot(); } });
    const first = await service.get('ws');
    expect(first.entries.find((e) => e.account?.id === work.id)?.status).toBe('error');
    expect(first.entries.find((e) => e.account?.id === 'default')?.status).toBe('ok'); // one failure never poisons another account
    expect(get).toHaveBeenCalledTimes(2);

    await service.get('ws');
    expect(get).toHaveBeenCalledTimes(2); // both served from their own cache / backoff
    await service.get('ws', { force: true });
    expect(get).toHaveBeenCalledTimes(2); // manual refresh cannot shorten either hard limit

    clock += 61_000; // default's 60 s minimum has passed; the managed account is still inside its 120 s failure backoff
    await service.get('ws');
    expect(get).toHaveBeenCalledTimes(3);
    expect(get.mock.calls[get.mock.calls.length - 1][0].accountId).toBeUndefined();
    clock += 61_000;
    await service.get('ws');
    expect(get.mock.calls[get.mock.calls.length - 1][0].accountId === work.id || get.mock.calls[get.mock.calls.length - 2][0].accountId === work.id).toBe(true);
  });

  it('shares nothing between two managed accounts either', async () => {
    const one = await addAccount(h, 'codex', 'One');
    const two = await addAccount(h, 'codex', 'Two');
    const { service, get } = await setup({ get: async (context) => { if (context.accountId === one.id) throw new HarnessCapabilityError('timeout', 'slow'); return snapshot(); } });
    const { entries } = await service.get('ws');
    expect(entries.find((e) => e.account?.id === one.id)?.status).toBe('unavailable');
    expect(entries.find((e) => e.account?.id === two.id)?.status).toBe('ok');
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('selection changes reorder entries without probing again, and never serve a stale "selected" flag', async () => {
    const work = await addAccount(h, 'codex', 'Work');
    const { service, get } = await setup();
    const before = await service.get('ws');
    expect(before.entries[0].account).toMatchObject({ id: 'default', selected: true });
    h.service.select('local', 'codex', work.id);
    const after = await service.get('ws');
    expect(after.entries[0].account).toMatchObject({ id: work.id, selected: true });
    expect(after.entries[1].account).toMatchObject({ id: 'default', selected: false });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('marks managed accounts connected or needing sign-in from probe outcomes, and never deletes them', async () => {
    const work = await addAccount(h, 'codex', 'Work');
    let unauthenticated = true;
    const { service } = await setup({ get: async (context) => {
      if (context.accountId && unauthenticated) throw new HarnessCapabilityError('unauthenticated', 'signed out');
      return snapshot();
    } });
    await service.get('ws');
    expect(h.service.list('local', 'codex').accounts.find((a) => a.id === work.id)?.status).toBe('needs-auth');
    clock += 200_000;
    unauthenticated = false;
    await service.get('ws');
    expect(h.service.list('local', 'codex').accounts.find((a) => a.id === work.id)?.status).toBe('connected');
    expect(h.service.managedAccounts('local')).toHaveLength(1);
  });

  it('drops a removed account\'s cached readings and backoff', async () => {
    const work = await addAccount(h, 'codex', 'Work');
    const { service, get } = await setup();
    await service.get('ws');
    expect(get).toHaveBeenCalledTimes(2);
    await h.service.remove('local', 'codex', work.id);
    const { entries } = await service.get('ws');
    expect(entries).toHaveLength(1);
    expect(entries[0]).not.toHaveProperty('account');
    const records = (service as unknown as { recordMaps: Array<Map<string, unknown>> }).recordMaps.flatMap((map) => [...map.keys()]);
    expect(records.some((key) => key.includes(work.id))).toBe(false);
    expect(get).toHaveBeenCalledTimes(2); // default stayed cached
  });

  it('SSH environments never see local managed accounts', async () => {
    await addAccount(h, 'codex', 'Work');
    const { service, get, environment } = await setup({ kind: 'ssh' });
    const { entries } = await service.get('ws');
    expect(entries).toHaveLength(1);
    expect(entries[0]).not.toHaveProperty('account');
    expect(get.mock.calls[0][0].accountId).toBeUndefined();
    expect(environment.executeHarnessCommand).not.toHaveBeenCalled();
  });

  it('does not run account logic for providers without the capability', async () => {
    await addAccount(h, 'codex', 'Work');
    const environment = env();
    const registry = new WorkspaceRegistry(() => environment);
    await registry.registerWorkspace({ workspaceId: 'ws', workspacePath: '/ws', environmentId: 'local' });
    const get = vi.fn(async () => snapshot());
    const provider: HarnessProvider = { ...getHarnessProvider('hermes'), usage: { get } };
    const { entries } = await new HarnessUsageService(registry, { providers: () => [provider], accounts: h.service }).get('ws');
    expect(entries).toHaveLength(1);
    expect(entries[0]).not.toHaveProperty('account');
  });
});
