import { act, renderHook } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initUsageListeners, useUsageStore, USAGE_POLL_INTERVAL_MS } from '../../../src/renderer/store/usageStore';
import { useHarnessUsage } from '../../../src/renderer/components/useHarnessUsage';
import type { HarnessUsageResponse } from '../../../src/shared/types/harnessUsage';
import { installElectronApiMock } from '../../setup/electron';
import { WARMUP_DELAY_MS } from '../../../src/renderer/lib/idleWarmup';

function deferred() {
  let resolve!: (response: HarnessUsageResponse) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<HarnessUsageResponse>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const response = (environmentId = 'local', environmentGeneration = 0, accountId = 'a', used = 10): HarnessUsageResponse => ({
  environmentId, environmentGeneration,
  entries: [{ harnessId: 'codex', status: 'ok', measurements: [{ kind: 'rate-limit', unit: 'percent', used }], account: { id: accountId, name: accountId, selected: true } }],
});
const store = () => useUsageStore.getState();
let api: ReturnType<typeof installElectronApiMock>;
const accountEvent = (type: 'selected' | 'removed' | 'reconnected', accountId: string) =>
  api.onHarnessAccountsChanged.mock.calls[0][0]({ type, accountId, harness: 'codex', environmentId: 'local' });
const environmentEvent = (environmentGeneration: number) =>
  api.onSshEnvironmentInvalidated.mock.calls[0][0]({ environmentId: 'ssh-1', environmentGeneration });

beforeEach(() => { api = installElectronApiMock(); });
afterEach(() => { store().reset(); vi.useRealTimers(); });

describe('Usage owned operations', () => {
  it.each(['removed', 'reconnected'] as const)('%s accounts cannot be resurrected by late successes; unaffected accounts remain', async (type) => {
    const old = deferred();
    api.getHarnessUsage.mockReturnValueOnce(old.promise);
    const request = store().request('local', null, 'codex');
    store().setEntry('local', 'codex', response().entries[0], response('local', 0, 'b').entries);
    accountEvent(type, 'a');
    old.resolve(response());
    await request;
    expect(store().readings.local.codex.a).toBeUndefined();
    expect(store().readings.local.codex.b).toBeDefined();
    expect(store().pending.local?.codex).toBeFalsy();
  });

  it('A rejection cannot mark B failed or clear B pending', async () => {
    const old = deferred(); const replacement = deferred();
    api.getHarnessUsage.mockReturnValueOnce(old.promise).mockReturnValueOnce(replacement.promise);
    const a = store().request('local', null, 'codex', true);
    accountEvent('selected', 'b');
    const b = store().request('local', null, 'codex');
    old.reject(new Error('old credentials'));
    await a;
    expect(store().pending.local.codex).toBe(true);
    expect(store().forcing.local ?? 0).toBe(0);
    expect(store().getEntries('local').codex).toBeUndefined();
    replacement.resolve(response('local', 0, 'b'));
    await b;
    expect(store().getEntries('local').codex?.status).toBe('ok');
    expect(store().pending.local?.codex).toBeFalsy();
  });

  it('ordinary then forced overlap: only the forced owner can publish or clear indicators', async () => {
    const old = deferred(); const forced = deferred();
    api.getHarnessUsage.mockReturnValueOnce(old.promise).mockReturnValueOnce(forced.promise);
    const ordinary = store().request('local', 'w1', 'codex');
    const refresh = store().request('local', 'w2', 'codex', true);
    const joined = store().request('local', null, 'codex');
    expect(api.getHarnessUsage).toHaveBeenCalledTimes(2);
    old.resolve(response()); await ordinary;
    expect(store().pending.local.codex).toBe(true);
    expect(store().forcing.local).toBe(1);
    expect(store().getEntries('local').codex).toBeUndefined();
    forced.resolve(response('local', 0, 'a', 80)); await Promise.all([refresh, joined]);
    expect(store().forcing.local ?? 0).toBe(0);
    expect(store().pending.local?.codex).toBeFalsy();
    expect(store().getEntries('local').codex?.measurements[0].used).toBe(80);
  });

  it('two passive local consumers schedule only one warm-up even for empty responses', async () => {
    vi.useFakeTimers(); api.getHarnessUsage.mockResolvedValue({ environmentId: 'local', environmentGeneration: 0, entries: [] });
    const one = store().registerConsumer({ environmentId: 'local', workspaceId: 'w1', harnessIds: ['codex'], active: false, prefetch: true });
    const two = store().registerConsumer({ environmentId: 'local', workspaceId: 'w2', harnessIds: ['codex'], active: false, prefetch: true });
    await vi.advanceTimersByTimeAsync(USAGE_POLL_INTERVAL_MS);
    expect(api.getHarnessUsage).toHaveBeenCalledTimes(1);
    one(); two();
  });

  it('two local workspaces and an Assistant share one pending IPC', async () => {
    const pending = deferred(); api.getHarnessUsage.mockReturnValueOnce(pending.promise);
    const requests = ['w1', 'w2', null].map((ws) => store().request('local', ws, 'codex'));
    expect(api.getHarnessUsage).toHaveBeenCalledExactlyOnceWith(null, { harnessIds: ['codex'] });
    pending.resolve(response()); await Promise.all(requests);
  });

  it('a reset retires promises and cancels warm-ups rather than restoring old readings', async () => {
    vi.useFakeTimers();
    const old = deferred(); api.getHarnessUsage.mockReturnValueOnce(old.promise);
    const request = store().request('local', null, 'codex');
    store().registerConsumer({ environmentId: 'local', workspaceId: null, harnessIds: ['claude'], active: false, prefetch: true });
    store().reset(); old.resolve(response()); await request;
    vi.advanceTimersByTime(USAGE_POLL_INTERVAL_MS);
    expect(store().readings).toEqual({});
    expect(api.getHarnessUsage).toHaveBeenCalledTimes(1);
  });

  it('remaining consumer receives updates and final removal ends polling', async () => {
    vi.useFakeTimers(); api.getHarnessUsage.mockResolvedValue(response());
    const consumer = { environmentId: 'local', workspaceId: null, harnessIds: ['codex'], active: true };
    const first = store().registerConsumer(consumer); const last = store().registerConsumer(consumer);
    await store().request('local', null, 'codex'); first();
    api.getHarnessUsage.mockResolvedValue(response('local', 0, 'a', 75));
    await vi.advanceTimersByTimeAsync(USAGE_POLL_INTERVAL_MS);
    expect(store().getEntries('local').codex?.measurements[0].used).toBe(75);
    last(); const count = api.getHarnessUsage.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3 * USAGE_POLL_INTERVAL_MS);
    expect(api.getHarnessUsage).toHaveBeenCalledTimes(count);
  });
});

describe('freshness-aware local idle warm-up', () => {
  const consumer = (workspaceId: string | null, harnessIds = ['codex']) => ({ environmentId: 'local', workspaceId, harnessIds, active: false, prefetch: true });

  it('expired cached readings can warm again; concurrent workspace/Assistant consumers still deduplicate', async () => {
    vi.useFakeTimers();
    const initial = response(); initial.entries[0].nextRefreshAt = Date.now() + WARMUP_DELAY_MS + 100;
    api.getHarnessUsage.mockResolvedValueOnce(initial).mockResolvedValue(response());
    const first = store().registerConsumer(consumer('w1'));
    await vi.advanceTimersByTimeAsync(WARMUP_DELAY_MS);
    expect(api.getHarnessUsage).toHaveBeenCalledTimes(1);
    first();
    await vi.advanceTimersByTimeAsync(101); // nextRefreshAt is authoritative even before the fallback throttle
    const next = store().registerConsumer(consumer('w2'));
    const assistant = store().registerConsumer(consumer(null));
    await vi.advanceTimersByTimeAsync(WARMUP_DELAY_MS);
    expect(api.getHarnessUsage).toHaveBeenCalledTimes(2);
    expect(api.getHarnessUsage.mock.calls.every(([ws]) => ws === null)).toBe(true);
    next(); assistant();
  });

  it('fresh readings skip warm-up across navigation and partial provider sets', async () => {
    vi.useFakeTimers();
    const value = response(); value.entries[0].nextRefreshAt = Date.now() + 30 * USAGE_POLL_INTERVAL_MS;
    api.getHarnessUsage.mockResolvedValue(value);
    const first = store().registerConsumer(consumer('w1'));
    await vi.advanceTimersByTimeAsync(WARMUP_DELAY_MS); first();
    for (const workspaceId of ['w2', null, 'w3']) {
      const release = store().registerConsumer(consumer(workspaceId));
      await vi.advanceTimersByTimeAsync(WARMUP_DELAY_MS); release();
    }
    expect(api.getHarnessUsage).toHaveBeenCalledTimes(1);
    const partial = store().registerConsumer(consumer(null, ['codex', 'claude']));
    await vi.advanceTimersByTimeAsync(WARMUP_DELAY_MS);
    expect(api.getHarnessUsage).toHaveBeenLastCalledWith(null, { harnessIds: ['claude'] });
    expect(api.getHarnessUsage).toHaveBeenCalledTimes(2); partial();
  });

  it('failed or empty warm-ups without a new authoritative deadline do not repeat on every navigation', async () => {
    vi.useFakeTimers(); api.getHarnessUsage.mockRejectedValueOnce(new Error('IPC unavailable'));
    const expired = response().entries[0]; expired.nextRefreshAt = Date.now() - 1;
    store().setEntry('local', 'codex', expired);
    const first = store().registerConsumer(consumer('w1'));
    await vi.advanceTimersByTimeAsync(WARMUP_DELAY_MS); first();
    const next = store().registerConsumer(consumer(null));
    await vi.advanceTimersByTimeAsync(WARMUP_DELAY_MS); next();
    expect(api.getHarnessUsage).toHaveBeenCalledTimes(1);
    // This fallback is bounded in time, not a permanent warmed flag.
    await vi.advanceTimersByTimeAsync(USAGE_POLL_INTERVAL_MS);
    const retry = store().registerConsumer(consumer('w2'));
    await vi.advanceTimersByTimeAsync(WARMUP_DELAY_MS);
    expect(api.getHarnessUsage).toHaveBeenCalledTimes(2); retry();
  });

  it('rechecks freshness at idle time if another consumer already populated readings', async () => {
    vi.useFakeTimers();
    const release = store().registerConsumer(consumer(null));
    const entry = response().entries[0]; entry.nextRefreshAt = Date.now() + 60_000;
    store().setEntry('local', 'codex', entry);
    await vi.advanceTimersByTimeAsync(WARMUP_DELAY_MS);
    expect(api.getHarnessUsage).not.toHaveBeenCalled(); release();
  });

  it('unmounting cancels a pending warm-up but leaves another consumer eligible', async () => {
    vi.useFakeTimers(); api.getHarnessUsage.mockResolvedValue(response());
    const first = store().registerConsumer(consumer('w1')); first();
    await vi.advanceTimersByTimeAsync(WARMUP_DELAY_MS);
    expect(api.getHarnessUsage).not.toHaveBeenCalled();
    const remaining = store().registerConsumer(consumer(null));
    await vi.advanceTimersByTimeAsync(WARMUP_DELAY_MS);
    expect(api.getHarnessUsage).toHaveBeenCalledTimes(1); remaining();
  });

  it('never schedules unattended SSH warm-up even if a caller requests prefetch', async () => {
    vi.useFakeTimers();
    const release = store().registerConsumer({ ...consumer('remote'), environmentId: 'ssh-1' });
    await vi.advanceTimersByTimeAsync(3 * USAGE_POLL_INTERVAL_MS);
    expect(api.getHarnessUsage).not.toHaveBeenCalled(); release();
  });
});

describe('authoritative environment incarnations', () => {
  it('a fresh renderer accepts restarted main counters but cannot recover pre-restart readings', async () => {
    environmentEvent(12);
    store().reset();
    api.getHarnessUsage.mockResolvedValue(response('ssh-1', 0));
    await store().request('ssh-1', 'w', 'codex');
    expect(store().environmentGenerations['ssh-1']).toBe(0);
  });

  it('startup generation is unknown; a first response may start above zero', async () => {
    expect(store().environmentGenerations['ssh-1']).toBeUndefined();
    api.getHarnessUsage.mockResolvedValue(response('ssh-1', 7));
    await store().request('ssh-1', 'w', 'codex');
    expect(store().environmentGenerations['ssh-1']).toBe(7);
    expect(store().getEntries('ssh-1').codex).toBeDefined();
  });

  it.each([false, true])('invalidation-before-response drops old work, preserves new pending (forced=%s)', async (force) => {
    const old = deferred(); const replacement = deferred();
    api.getHarnessUsage.mockReturnValueOnce(old.promise).mockReturnValueOnce(replacement.promise);
    const a = store().request('ssh-1', 'w', 'codex', force);
    environmentEvent(4);
    const b = store().request('ssh-1', 'w', 'codex');
    old.resolve(response('ssh-1', 3)); await a;
    expect(store().pending['ssh-1'].codex).toBe(true);
    expect(store().forcing['ssh-1'] ?? 0).toBe(0);
    replacement.resolve(response('ssh-1', 4)); await b;
    expect(store().environmentGenerations['ssh-1']).toBe(4);
    expect(store().pending['ssh-1']?.codex).toBeFalsy();
  });

  it('initial concurrent providers keep ownership when unknown generation is established', async () => {
    const codex = deferred(); const claude = deferred();
    api.getHarnessUsage.mockReturnValueOnce(codex.promise).mockReturnValueOnce(claude.promise);
    const a = store().request('ssh-1', 'w', 'codex');
    const b = store().request('ssh-1', 'w', 'claude');
    codex.resolve(response('ssh-1', 8)); await a;
    expect(store().pending['ssh-1'].claude).toBe(true);
    const value = response('ssh-1', 8);
    value.entries[0].harnessId = 'claude'; claude.resolve(value); await b;
    expect(Object.keys(store().getEntries('ssh-1')).sort()).toEqual(['claude', 'codex']);
  });

  it('new response before its event clears old incarnation; equal and delayed events are no-ops', async () => {
    api.getHarnessUsage.mockResolvedValueOnce(response('ssh-1', 1));
    await store().request('ssh-1', 'w', 'codex');
    store().setEntry('ssh-1', 'claude', { harnessId: 'claude', status: 'ok', measurements: [] });
    api.getHarnessUsage.mockResolvedValueOnce(response('ssh-1', 5));
    await store().request('ssh-1', 'w', 'codex', true);
    environmentEvent(5); environmentEvent(3);
    expect(store().environmentGenerations['ssh-1']).toBe(5);
    expect(store().getEntries('ssh-1').codex).toBeDefined();
    expect(store().getEntries('ssh-1').claude).toBeUndefined();
  });

  it('multiple changes including delete/recreate retain the newest identity', async () => {
    environmentEvent(9); environmentEvent(7); environmentEvent(10);
    api.getHarnessUsage.mockResolvedValueOnce(response('ssh-1', 8));
    await store().request('ssh-1', 'w', 'codex');
    expect(store().getEntries('ssh-1').codex).toBeUndefined();
    api.getHarnessUsage.mockResolvedValueOnce(response('ssh-1', 10));
    await store().request('ssh-1', 'w', 'codex');
    expect(store().environmentGenerations['ssh-1']).toBe(10);
    expect(store().getEntries('ssh-1').codex).toBeDefined();
  });

  it.each([
    { entries: response().entries },
    response('other', 0),
    response('ssh-1', -1),
  ])('rejects malformed or foreign identities', async (value) => {
    api.getHarnessUsage.mockResolvedValueOnce(value);
    await store().request('ssh-1', 'w', 'codex');
    expect(store().getEntries('ssh-1').codex).toBeUndefined();
  });

  it('changing SSH workspace replaces the old request context without clearing new pending', async () => {
    const old = deferred(); const replacement = deferred();
    api.getHarnessUsage.mockReturnValueOnce(old.promise).mockReturnValueOnce(replacement.promise);
    const a = store().request('ssh-1', 'old', 'codex');
    const b = store().request('ssh-1', 'new', 'codex');
    expect(api.getHarnessUsage).toHaveBeenCalledTimes(2);
    old.resolve(response('ssh-1', 1)); await a;
    expect(store().pending['ssh-1'].codex).toBe(true);
    replacement.resolve(response('ssh-1', 1)); await b;
    expect(store().getEntries('ssh-1').codex).toBeDefined();
  });

  it('SSH responses are discarded after the requesting workspace consumer leaves', async () => {
    const old = deferred(); api.getHarnessUsage.mockReturnValueOnce(old.promise);
    const release = store().registerConsumer({ environmentId: 'ssh-1', workspaceId: 'old', harnessIds: ['codex'], active: true });
    const request = store().request('ssh-1', 'old', 'codex'); release();
    const remaining = store().registerConsumer({ environmentId: 'local', workspaceId: null, harnessIds: [], active: false });
    old.resolve(response('ssh-1', 1)); await request;
    expect(store().getEntries('ssh-1').codex).toBeUndefined(); remaining();
  });
});

describe('account event ordering and subscriptions', () => {
  it.each([false, true])('Usage selection uses one broadcast, not IPC completion (broadcast first=%s)', async (broadcastFirst) => {
    let finish!: () => void;
    api.selectHarnessAccount.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ accounts: [] }); }));
    const request = store().selectAccount('local', null, 'codex', 'a');
    if (broadcastFirst) accountEvent('selected', 'a');
    finish(); await request;
    if (!broadcastFirst) {
      expect(store().selectedAccounts.local?.codex).toBeUndefined();
      accountEvent('selected', 'a');
    }
    expect(store().selectedAccounts.local.codex).toBe('a');
    expect(store().accountGenerations['local\u0000codex']).toBe(1);
    // Settings sends the identical authoritative event.
    accountEvent('selected', 'b');
    expect(store().selectedAccounts.local.codex).toBe('b');
  });

  it('one confirmed selection issues one replacement refresh, never another on IPC completion', async () => {
    const old = deferred(); const next = deferred();
    api.getHarnessUsage.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const release = store().registerConsumer({ environmentId: 'local', workspaceId: null, harnessIds: ['codex'], active: true });
    api.selectHarnessAccount.mockImplementationOnce(async () => {
      accountEvent('selected', 'b'); return { accounts: [] };
    });
    await store().selectAccount('local', null, 'codex', 'b');
    expect(api.getHarnessUsage).toHaveBeenCalledTimes(2);
    old.resolve(response()); next.resolve(response('local', 0, 'b'));
    await store().request('local', null, 'codex');
    expect(store().getEntries('local').codex?.account?.id).toBe('b'); release();
  });

  it('rapid selections cannot replay old completions over the last confirmed event', async () => {
    let finishA!: () => void; let finishB!: () => void;
    api.selectHarnessAccount.mockImplementationOnce(() => new Promise((resolve) => { finishA = () => resolve({ accounts: [] }); }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishB = () => resolve({ accounts: [] }); }));
    const a = store().selectAccount('local', null, 'codex', 'a');
    const b = store().selectAccount('local', null, 'codex', 'b');
    accountEvent('selected', 'a'); accountEvent('selected', 'b');
    finishB(); await b; finishA(); await a;
    expect(store().selectedAccounts.local.codex).toBe('b');
    expect(store().accountGenerations['local\u0000codex']).toBe(2);
  });

  it('Strict Mode setup/cleanup has one shared subscription; widget removal does not disable it', () => {
    // installElectronApiMock owns the test application boundary subscription.
    const { unmount } = renderHook(() => {
      useEffect(() => initUsageListeners(), []);
      return useHarnessUsage({ workspaceId: null, open: false, harnessIds: ['codex'] });
    }, { wrapper: StrictMode });
    expect(api.onHarnessAccountsChanged).toHaveBeenCalledTimes(1);
    expect(api.onSshEnvironmentInvalidated).toHaveBeenCalledTimes(1);
    unmount();
    act(() => { accountEvent('selected', 'b'); environmentEvent(4); });
    expect(store().selectedAccounts.local.codex).toBe('b');
    expect(store().environmentGenerations['ssh-1']).toBe(4);
  });
});
