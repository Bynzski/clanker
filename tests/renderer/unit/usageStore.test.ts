import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUsageStore, USAGE_POLL_INTERVAL_MS } from '../../../src/renderer/store/usageStore';
import { installElectronApiMock } from '../../setup/electron';
import type { HarnessUsageEntry, HarnessUsageResponse } from '../../../src/shared/types/harnessUsage';

const okEntry = (harnessId: string, accountId = 'default', extra: Partial<HarnessUsageEntry> = {}): HarnessUsageEntry => ({
  harnessId,
  status: 'ok',
  account: accountId !== 'default' ? { id: accountId, name: `Account ${accountId}`, selected: true } : undefined,
  measurements: [{ kind: 'rate-limit', unit: 'percent', used: 25 }],
  checkedAt: Date.now(),
  nextRefreshAt: Date.now() + 60_000,
  refreshableAt: Date.now() + 10_000,
  ...extra,
});

describe('useUsageStore architecture hardening', () => {
  let mockApi: ReturnType<typeof installElectronApiMock>;

  beforeEach(() => {
    mockApi = installElectronApiMock();
  });

  afterEach(() => {
    useUsageStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('Local workspace A → local workspace B retains the same correct readings without extra provider probes inside freshness windows', async () => {
    const entryA = okEntry('claude', 'default', { nextRefreshAt: Date.now() + 300_000 });
    vi.mocked(mockApi.getHarnessUsage).mockResolvedValueOnce({
      workspaceId: 'ws-a',
      environmentId: 'local',
      environmentGeneration: 0,
      entries: [entryA],
    });

    // Workspace A initiates request
    await useUsageStore.getState().request('local', 'ws-a', 'claude', false);
    expect(mockApi.getHarnessUsage).toHaveBeenCalledTimes(1);

    const entriesA = useUsageStore.getState().getEntries('local');
    expect(entriesA.claude).toMatchObject({ harnessId: 'claude', status: 'ok' });

    // Workspace B requests the same harness within freshness window
    await useUsageStore.getState().request('local', 'ws-b', 'claude', false);
    // No extra probe was sent!
    expect(mockApi.getHarnessUsage).toHaveBeenCalledTimes(1);

    const entriesB = useUsageStore.getState().getEntries('local');
    expect(entriesB.claude).toMatchObject({ harnessId: 'claude', status: 'ok' });
  });

  it('Local workspace → Hermes Assistant → local workspace maintains a consistent shared usage state', async () => {
    const entryLocal = okEntry('codex', 'default', { nextRefreshAt: Date.now() + 300_000 });
    vi.mocked(mockApi.getHarnessUsage).mockResolvedValueOnce({
      workspaceId: 'ws-local',
      environmentId: 'local',
      environmentGeneration: 0,
      entries: [entryLocal],
    });

    // In local workspace
    await useUsageStore.getState().request('local', 'ws-local', 'codex', false);
    expect(useUsageStore.getState().getEntries('local').codex?.status).toBe('ok');

    // Switch to Assistant destination (workspaceId: null, environmentId: 'local')
    // Shared readings are immediately accessible
    expect(useUsageStore.getState().getEntries('local').codex?.status).toBe('ok');
    // Assistant requests codex; cached reading is within freshness window, so no redundant probe
    await useUsageStore.getState().request('local', null, 'codex', false);
    expect(mockApi.getHarnessUsage).toHaveBeenCalledTimes(1);

    // Switch back to local workspace
    expect(useUsageStore.getState().getEntries('local').codex?.status).toBe('ok');
  });

  it('Assistant-only operation works with zero registered workspaces', async () => {
    const entry = okEntry('hermes', 'default');
    vi.mocked(mockApi.getHarnessUsage).mockResolvedValueOnce({
      workspaceId: undefined,
      environmentId: 'local',
      environmentGeneration: 0,
      entries: [entry],
    });

    // Query with null workspaceId
    await useUsageStore.getState().request('local', null, 'hermes', false);
    expect(mockApi.getHarnessUsage).toHaveBeenCalledWith(null, { harnessIds: ['hermes'] });
    expect(useUsageStore.getState().getEntries('local').hermes?.status).toBe('ok');
  });

  it('Multiple concurrent consumers requesting the same provider share one refresh operation', async () => {
    let resolveIpc!: (res: HarnessUsageResponse) => void;
    vi.mocked(mockApi.getHarnessUsage).mockImplementation(
      () => new Promise((resolve) => { resolveIpc = resolve; })
    );

    // Consumer 1 (e.g. header dropdown) and Consumer 2 (e.g. pinned widget) request concurrently
    const p1 = useUsageStore.getState().request('local', 'ws-a', 'claude', false);
    const p2 = useUsageStore.getState().request('local', 'ws-a', 'claude', false);

    // Main IPC was called exactly once for claude
    expect(mockApi.getHarnessUsage).toHaveBeenCalledTimes(1);

    // Resolve the single in-flight call
    resolveIpc({
      workspaceId: 'ws-a',
      environmentId: 'local',
      environmentGeneration: 0,
      entries: [okEntry('claude')],
    });

    await Promise.all([p1, p2]);
    expect(useUsageStore.getState().getEntries('local').claude?.status).toBe('ok');
  });

  it('Closing one consumer does not interrupt another active consumer', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(mockApi.getHarnessUsage).mockResolvedValue({
        environmentId: 'local',
        environmentGeneration: 0,
        entries: [okEntry('claude', 'default', { nextRefreshAt: Date.now() + 30_000 })],
      });

      // Register Consumer 1 (active)
      const unsub1 = useUsageStore.getState().registerConsumer({
        environmentId: 'local',
        workspaceId: 'ws-1',
        harnessIds: ['claude'],
        active: true,
      });

      // Register Consumer 2 (active)
      const unsub2 = useUsageStore.getState().registerConsumer({
        environmentId: 'local',
        workspaceId: 'ws-2',
        harnessIds: ['claude'],
        active: true,
      });

      // Allow initial request to resolve and settle
      await vi.waitFor(() => {
        expect(useUsageStore.getState().pending.local?.claude).toBeFalsy();
      });
      const initialCalls = vi.mocked(mockApi.getHarnessUsage).mock.calls.length;

      // Unregister Consumer 1 (simulate close)
      unsub1();

      // Advance time by poll interval; Consumer 2 is still active, so polling continues!
      vi.advanceTimersByTime(USAGE_POLL_INTERVAL_MS);
      expect(vi.mocked(mockApi.getHarnessUsage).mock.calls.length).toBeGreaterThan(initialCalls);

      unsub2();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Removing the final consumer stops unnecessary polling', () => {
    vi.useFakeTimers();
    try {
      vi.mocked(mockApi.getHarnessUsage).mockResolvedValue({
        environmentId: 'local',
        environmentGeneration: 0,
        entries: [okEntry('claude')],
      });

      const unsub = useUsageStore.getState().registerConsumer({
        environmentId: 'local',
        workspaceId: 'ws-1',
        harnessIds: ['claude'],
        active: true,
      });

      // Remove the final consumer
      unsub();

      const callCountAfterUnsub = vi.mocked(mockApi.getHarnessUsage).mock.calls.length;

      // Advance time by several poll intervals
      vi.advanceTimersByTime(USAGE_POLL_INTERVAL_MS * 3);

      // No additional calls were made!
      expect(vi.mocked(mockApi.getHarnessUsage).mock.calls.length).toBe(callCountAfterUnsub);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Manual refresh passes force flag, while unforced request respects freshness window', async () => {
    const entry = okEntry('claude', 'default', { nextRefreshAt: Date.now() + 300_000 });
    vi.mocked(mockApi.getHarnessUsage).mockResolvedValue({
      environmentId: 'local',
      environmentGeneration: 0,
      entries: [entry],
    });

    // Ordinary request populates cache
    await useUsageStore.getState().request('local', 'ws-1', 'claude', false);
    expect(mockApi.getHarnessUsage).toHaveBeenLastCalledWith(null, { harnessIds: ['claude'] });

    // Ordinary request within freshness window is skipped
    await useUsageStore.getState().request('local', 'ws-1', 'claude', false);
    expect(mockApi.getHarnessUsage).toHaveBeenCalledTimes(1);

    // Force request bypasses freshness window and passes force: true
    await useUsageStore.getState().request('local', 'ws-1', 'claude', true);
    expect(mockApi.getHarnessUsage).toHaveBeenCalledTimes(2);
    expect(mockApi.getHarnessUsage).toHaveBeenLastCalledWith(null, { harnessIds: ['claude'], force: true });
  });

  it('Account selection through Usage and through Settings both reconcile the displayed readings', async () => {
    const acc1Entry = okEntry('claude', 'acc-1', { account: { id: 'acc-1', name: 'Work Account', selected: true } });
    const acc2Entry = okEntry('claude', 'acc-2', { account: { id: 'acc-2', name: 'Personal Account', selected: false } });

    // Initial load returns both accounts, acc-1 selected
    vi.mocked(mockApi.getHarnessUsage).mockResolvedValueOnce({
      workspaceId: 'ws-1',
      environmentId: 'local',
      environmentGeneration: 0,
      entries: [acc1Entry, acc2Entry],
    });

    await useUsageStore.getState().request('local', 'ws-1', 'claude', false);

    // Primary entry is acc-1
    expect(useUsageStore.getState().getEntries('local').claude?.account?.id).toBe('acc-1');
    // Other accounts lists acc-2
    expect(useUsageStore.getState().getOtherAccounts('local').claude?.[0]?.account?.id).toBe('acc-2');

    // 1. Account selection through Usage
    vi.mocked(mockApi.selectHarnessAccount).mockImplementationOnce(async () => {
      mockApi.onHarnessAccountsChanged.mock.calls[0][0]({ type: 'selected', accountId: 'acc-2', harness: 'claude', environmentId: 'local' });
      return { accounts: [], selections: {} };
    });
    const acc2Selected = { ...acc2Entry, account: { id: 'acc-2', name: 'Personal Account', selected: true } };
    const acc1Deselected = { ...acc1Entry, account: { id: 'acc-1', name: 'Work Account', selected: false } };
    vi.mocked(mockApi.getHarnessUsage).mockResolvedValueOnce({
      workspaceId: 'ws-1',
      environmentId: 'local',
      environmentGeneration: 0,
      entries: [acc2Selected, acc1Deselected],
    });

    await useUsageStore.getState().selectAccount('local', 'ws-1', 'claude', 'acc-2');

    expect(mockApi.selectHarnessAccount).toHaveBeenCalledWith('local', 'claude', 'acc-2');
    expect(useUsageStore.getState().getEntries('local').claude?.account?.id).toBe('acc-2');
    expect(useUsageStore.getState().getOtherAccounts('local').claude?.[0]?.account?.id).toBe('acc-1');

    // 2. Account selection through Settings (authoritative IPC event)
    useUsageStore.getState().handleAccountChange({
      type: 'selected',
      accountId: 'acc-1',
      harness: 'claude',
      environmentId: 'local',
    });

    expect(useUsageStore.getState().getEntries('local').claude?.account?.id).toBe('acc-1');
    expect(useUsageStore.getState().getOtherAccounts('local').claude?.[0]?.account?.id).toBe('acc-2');
  });

  it('Failed account selection does not produce a misleading UI state', async () => {
    const acc1Entry = okEntry('claude', 'acc-1', { account: { id: 'acc-1', name: 'Account 1', selected: true } });
    vi.mocked(mockApi.getHarnessUsage).mockResolvedValueOnce({
      environmentId: 'local',
      environmentGeneration: 0,
      entries: [acc1Entry],
    });
    await useUsageStore.getState().request('local', 'ws-1', 'claude', false);
    expect(useUsageStore.getState().getEntries('local').claude?.account?.id).toBe('acc-1');

    // Account selection fails in main
    vi.mocked(mockApi.selectHarnessAccount).mockRejectedValueOnce(new Error('Permission denied'));

    await useUsageStore.getState().selectAccount('local', 'ws-1', 'claude', 'acc-2');

    // State remains untouched: acc-1 remains selected, no optimistic switch to acc-2
    expect(useUsageStore.getState().getEntries('local').claude?.account?.id).toBe('acc-1');
  });

  it('In-flight responses from a previous account cannot overwrite current readings', async () => {
    let resolveP1!: (res: HarnessUsageResponse) => void;
    vi.mocked(mockApi.getHarnessUsage).mockImplementationOnce(
      () => new Promise((resolve) => { resolveP1 = resolve; })
    );

    // Initial request starts for account 1 (account generation = 0)
    const p1 = useUsageStore.getState().request('local', 'ws-1', 'claude', false);

    // While in flight, user switches to account 2 via authoritative change
    useUsageStore.getState().handleAccountChange({
      type: 'selected',
      accountId: 'acc-2',
      harness: 'claude',
      environmentId: 'local',
    });

    // Old in-flight response for account 1 resolves claiming it is selected
    resolveP1({
      environmentId: 'local',
      environmentGeneration: 0,
      entries: [okEntry('claude', 'acc-1', { account: { id: 'acc-1', name: 'Account 1', selected: true } })],
    });
    await p1;

    // acc-2 remains selected; old acc-1 response was not adopted as selected
    expect(useUsageStore.getState().selectedAccounts.local?.claude).toBe('acc-2');
  });

  it('Removing or reconnecting accounts invalidates relevant readings', async () => {
    const acc1Entry = okEntry('claude', 'acc-1', { account: { id: 'acc-1', name: 'Account 1', selected: true } });
    const acc2Entry = okEntry('claude', 'acc-2', { account: { id: 'acc-2', name: 'Account 2', selected: false } });

    useUsageStore.getState().setEntry('local', 'claude', acc1Entry, [acc2Entry]);
    expect(useUsageStore.getState().readings.local?.claude?.['acc-1']).toBeDefined();
    expect(useUsageStore.getState().readings.local?.claude?.['acc-2']).toBeDefined();

    // Removing acc-1 invalidates its reading and resets selection
    useUsageStore.getState().handleAccountChange({
      type: 'removed',
      accountId: 'acc-1',
      harness: 'claude',
      environmentId: 'local',
    });

    expect(useUsageStore.getState().readings.local?.claude?.['acc-1']).toBeUndefined();
    expect(useUsageStore.getState().readings.local?.claude?.['acc-2']).toBeDefined();
    expect(useUsageStore.getState().selectedAccounts.local?.claude).toBe('default');

    // Reconnecting acc-2 invalidates its cached reading
    useUsageStore.getState().handleAccountChange({
      type: 'reconnected',
      accountId: 'acc-2',
      harness: 'claude',
      environmentId: 'local',
    });

    expect(useUsageStore.getState().readings.local?.claude?.['acc-2']).toBeUndefined();
  });

  it('SSH host A → host B under the same saved environment ID cannot display host A\'s usage', async () => {
    const hostAEntry = okEntry('claude', 'default', {
      measurements: [{ kind: 'rate-limit', unit: 'percent', used: 99 }],
    });

    vi.mocked(mockApi.getHarnessUsage).mockResolvedValueOnce({
      workspaceId: 'ws-ssh-a',
      environmentId: 'ssh-1',
      environmentGeneration: 0,
      entries: [hostAEntry],
    });

    // Query host A on ssh-1
    await useUsageStore.getState().request('ssh-1', 'ws-ssh-a', 'claude', false);
    expect(useUsageStore.getState().getEntries('ssh-1').claude?.measurements[0].used).toBe(99);

    // Host A workspaces close, user edits ssh-1 to point to host B.
    // Main broadcasts onSshEnvironmentInvalidated.
    mockApi.onSshEnvironmentInvalidated.mock.calls[0][0]({ environmentId: 'ssh-1', environmentGeneration: 1 });

    // ssh-1 usage is immediately wiped clean; host A readings are never presented for host B!
    expect(useUsageStore.getState().getEntries('ssh-1').claude).toBeUndefined();
  });

  it('Late requests from an invalidated SSH environment cannot repopulate its replacement\'s cache', async () => {
    let resolveHostA!: (res: HarnessUsageResponse) => void;
    vi.mocked(mockApi.getHarnessUsage).mockImplementationOnce(
      () => new Promise((resolve) => { resolveHostA = resolve; })
    );

    // In-flight request to host A on ssh-1
    const p1 = useUsageStore.getState().request('ssh-1', 'ws-ssh-a', 'claude', false);

    // Environment ssh-1 is invalidated while request is in flight
    mockApi.onSshEnvironmentInvalidated.mock.calls[0][0]({ environmentId: 'ssh-1', environmentGeneration: 1 });

    // Host A response arrives late
    resolveHostA({
      workspaceId: 'ws-ssh-a',
      environmentId: 'ssh-1',
      environmentGeneration: 0,
      entries: [okEntry('claude', 'default', { measurements: [{ kind: 'rate-limit', unit: 'percent', used: 88 }] })],
    });
    await p1;

    // Cache remains empty; late response from invalidated host A was dropped!
    expect(useUsageStore.getState().getEntries('ssh-1').claude).toBeUndefined();
  });

  it('Switching between local and SSH environments never leaks readings', async () => {
    const localEntry = okEntry('claude', 'default', { measurements: [{ kind: 'rate-limit', unit: 'percent', used: 10 }] });
    const sshEntry = okEntry('claude', 'default', { measurements: [{ kind: 'rate-limit', unit: 'percent', used: 80 }] });

    useUsageStore.getState().setEntry('local', 'claude', localEntry);
    useUsageStore.getState().setEntry('ssh-1', 'claude', sshEntry);

    expect(useUsageStore.getState().getEntries('local').claude?.measurements[0].used).toBe(10);
    expect(useUsageStore.getState().getEntries('ssh-1').claude?.measurements[0].used).toBe(80);

    // Invalidating SSH does not affect local
    mockApi.onSshEnvironmentInvalidated.mock.calls[0][0]({ environmentId: 'ssh-1', environmentGeneration: 1 });
    expect(useUsageStore.getState().getEntries('local').claude?.measurements[0].used).toBe(10);
    expect(useUsageStore.getState().getEntries('ssh-1').claude).toBeUndefined();
  });

  it('Error handling retains valid last-known readings as stale only when they still belong to the correct scope', async () => {
    const goodEntry = okEntry('claude', 'default', {
      measurements: [{ kind: 'rate-limit', unit: 'percent', used: 42 }],
    });

    vi.mocked(mockApi.getHarnessUsage).mockResolvedValueOnce({
      environmentId: 'local',
      environmentGeneration: 0,
      entries: [goodEntry],
    });
    await useUsageStore.getState().request('local', 'ws-1', 'claude', false);
    expect(useUsageStore.getState().getEntries('local').claude?.measurements[0].used).toBe(42);

    // Subsequent request fails
    vi.mocked(mockApi.getHarnessUsage).mockRejectedValueOnce(new Error('Network disconnected'));
    await useUsageStore.getState().request('local', 'ws-1', 'claude', true);

    const errorReading = useUsageStore.getState().getEntries('local').claude;
    expect(errorReading?.status).toBe('error');
    expect(errorReading?.stale).toBe(true);
    expect(errorReading?.error).toBe('Usage could not be read');
    // Prior measurements are retained!
    expect(errorReading?.measurements[0].used).toBe(42);
  });
});
