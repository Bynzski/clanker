import { create } from 'zustand';
import type { HarnessUsageEntry, HarnessUsageResponse } from '../../shared/types/harnessUsage';
import type { HarnessAccountChange } from '../../shared/types/harnessAccounts';
import { scheduleIdleWarmup } from '../lib/idleWarmup';

export const USAGE_POLL_INTERVAL_MS = 60_000;
const CLOCK_INTERVAL_MS = 30_000;
const GENERIC_ERROR = 'Usage could not be read';

interface UsageConsumer {
  id?: number;
  environmentId: string;
  workspaceId: string | null;
  harnessIds: readonly string[];
  active: boolean;
  prefetch?: boolean;
}

interface UsageStoreState {
  // Keyed by environmentId -> harnessId -> accountId ('default' when unmanaged)
  readings: Record<string, Record<string, Record<string, HarnessUsageEntry>>>;
  // Keyed by environmentId -> harnessId -> accountId
  selectedAccounts: Record<string, Record<string, string>>;
  environmentGenerations: Record<string, number>;
  accountGenerations: Record<string, number>;
  pending: Record<string, Record<string, boolean>>;
  forcing: Record<string, number>;
  now: number;

  getEntries: (environmentId: string) => Record<string, HarnessUsageEntry | undefined>;
  getOtherAccounts: (environmentId: string) => Record<string, HarnessUsageEntry[] | undefined>;
  setEntry: (environmentId: string, harnessId: string, entry: HarnessUsageEntry | undefined, others?: HarnessUsageEntry[]) => void;
  request: (environmentId: string, workspaceId: string | null, harnessId: string, force?: boolean) => Promise<void>;
  refreshAll: (environmentId: string, workspaceId: string | null, harnessIds: readonly string[], force?: boolean) => void;
  selectAccount: (environmentId: string, workspaceId: string | null, harnessId: string, accountId: string) => Promise<void>;
  handleAccountChange: (change: HarnessAccountChange) => void;
  invalidateEnvironment: (environmentId: string) => void;
  registerConsumer: (consumer: UsageConsumer) => () => void;
  reset: () => void;
}

let nextConsumerId = 0;
const consumers = new Map<number, UsageConsumer>();
const pollingTimers = new Map<string, ReturnType<typeof setInterval>>();
const inflight = new Map<string, { promise: Promise<void>; force: boolean }>();
const warmedKeys = new Set<string>();
let clockTimer: ReturnType<typeof setInterval> | null = null;

export const useUsageStore = create<UsageStoreState>((set, get) => ({
  readings: {},
  selectedAccounts: {},
  environmentGenerations: {},
  accountGenerations: {},
  pending: {},
  forcing: {},
  now: Date.now(),

  getEntries: (environmentId: string) => {
    const envReadings = get().readings[environmentId] ?? {};
    const envSelected = get().selectedAccounts[environmentId] ?? {};
    const result: Record<string, HarnessUsageEntry | undefined> = {};
    for (const [harnessId, accountMap] of Object.entries(envReadings)) {
      const selectedId = envSelected[harnessId] ?? 'default';
      const entry = accountMap[selectedId];
      if (entry) {
        result[harnessId] = {
          ...entry,
          account: entry.account ? { ...entry.account, selected: true } : undefined,
        };
      }
    }
    return result;
  },

  getOtherAccounts: (environmentId: string) => {
    const envReadings = get().readings[environmentId] ?? {};
    const envSelected = get().selectedAccounts[environmentId] ?? {};
    const result: Record<string, HarnessUsageEntry[] | undefined> = {};
    for (const [harnessId, accountMap] of Object.entries(envReadings)) {
      const selectedId = envSelected[harnessId] ?? 'default';
      const others = Object.entries(accountMap)
        .filter(([accId]) => accId !== selectedId)
        .map(([, entry]) => ({
          ...entry,
          account: entry.account ? { ...entry.account, selected: false } : undefined,
        }));
      result[harnessId] = others;
    }
    return result;
  },

  setEntry: (environmentId: string, harnessId: string, entry: HarnessUsageEntry | undefined, others: HarnessUsageEntry[] = []) => {
    set((state) => {
      const envReadings = { ...(state.readings[environmentId] ?? {}) };
      const harnessReadings: Record<string, HarnessUsageEntry> = {};
      let selectedId = state.selectedAccounts[environmentId]?.[harnessId] ?? 'default';

      if (entry) {
        const accId = entry.account?.id ?? 'default';
        harnessReadings[accId] = entry;
        selectedId = accId;
      }
      for (const other of others) {
        const accId = other.account?.id ?? 'default';
        harnessReadings[accId] = other;
      }
      envReadings[harnessId] = harnessReadings;

      return {
        readings: { ...state.readings, [environmentId]: envReadings },
        selectedAccounts: {
          ...state.selectedAccounts,
          [environmentId]: { ...(state.selectedAccounts[environmentId] ?? {}), [harnessId]: selectedId },
        },
      };
    });
  },

  request: async (environmentId: string, workspaceId: string | null, harnessId: string, force = false): Promise<void> => {
    if (environmentId !== 'local' && !workspaceId) return;

    // Freshness check: unless force is requested, skip if cached reading is within its freshness window
    if (!force) {
      const selectedId = get().selectedAccounts[environmentId]?.[harnessId] ?? 'default';
      const current = get().readings[environmentId]?.[harnessId]?.[selectedId];
      if (current && typeof current.nextRefreshAt === 'number' && Date.now() < current.nextRefreshAt) {
        return;
      }
    }

    const inflightKey = `${environmentId}\u0000${workspaceId ?? ''}\u0000${harnessId}`;
    const existing = inflight.get(inflightKey);
    if (existing && (!force || existing.force)) {
      return existing.promise;
    }

    set((state) => ({
      pending: {
        ...state.pending,
        [environmentId]: { ...(state.pending[environmentId] ?? {}), [harnessId]: true },
      },
      forcing: force
        ? { ...state.forcing, [environmentId]: (state.forcing[environmentId] ?? 0) + 1 }
        : state.forcing,
    }));

    const reqEnvGen = get().environmentGenerations[environmentId] ?? 0;
    const reqAcctGen = get().accountGenerations[environmentId] ?? 0;
    const effectiveWsId = environmentId === 'local' ? (workspaceId ?? null) : workspaceId;

    const promise = window.electronAPI.getHarnessUsage(effectiveWsId, {
      harnessIds: [harnessId],
      ...(force ? { force: true } : {}),
    })
      .then((response: HarnessUsageResponse) => {
        const currentEnvGen = get().environmentGenerations[environmentId] ?? 0;
        if (currentEnvGen !== reqEnvGen) return;
        if (typeof response.environmentGeneration === 'number' && response.environmentGeneration < reqEnvGen) return;
        if (consumers.size > 0 && workspaceId !== null) {
          const hasConsumerForWs = [...consumers.values()].some((c) => c.workspaceId === workspaceId);
          if (!hasConsumerForWs) return;
        }

        const matchedEntries = response.entries.filter((candidate) => candidate.harnessId === harnessId);
        if (matchedEntries.length === 0) return;

        set((state) => {
          const envReadings = { ...(state.readings[environmentId] ?? {}) };
          const harnessReadings = { ...(envReadings[harnessId] ?? {}) };
          let selectedId = state.selectedAccounts[environmentId]?.[harnessId] ?? 'default';

          for (const entry of matchedEntries) {
            const accId = entry.account?.id ?? 'default';
            harnessReadings[accId] = entry;
            // Only adopt reported selection if accounts haven't changed since request started
            if ((state.accountGenerations[environmentId] ?? 0) === reqAcctGen && entry.account?.selected) {
              selectedId = accId;
            }
          }
          envReadings[harnessId] = harnessReadings;

          return {
            readings: { ...state.readings, [environmentId]: envReadings },
            selectedAccounts: {
              ...state.selectedAccounts,
              [environmentId]: { ...(state.selectedAccounts[environmentId] ?? {}), [harnessId]: selectedId },
            },
          };
        });
      })
      .catch(() => {
        const currentEnvGen = get().environmentGenerations[environmentId] ?? 0;
        if (currentEnvGen !== reqEnvGen) return;
        if (consumers.size > 0 && workspaceId !== null) {
          const hasConsumerForWs = [...consumers.values()].some((c) => c.workspaceId === workspaceId);
          if (!hasConsumerForWs) return;
        }

        set((state) => {
          const envReadings = { ...(state.readings[environmentId] ?? {}) };
          const harnessReadings = { ...(envReadings[harnessId] ?? {}) };
          const selectedId = state.selectedAccounts[environmentId]?.[harnessId] ?? 'default';
          const prior = harnessReadings[selectedId];

          const errorEntry: HarnessUsageEntry = prior && prior.measurements && prior.measurements.length > 0
            ? { ...prior, status: 'error', stale: true, error: GENERIC_ERROR }
            : { harnessId, status: 'error', measurements: [], error: GENERIC_ERROR };

          harnessReadings[selectedId] = errorEntry;
          envReadings[harnessId] = harnessReadings;

          return {
            readings: { ...state.readings, [environmentId]: envReadings },
          };
        });
      })
      .finally(() => {
        if (inflight.get(inflightKey)?.promise === promise) {
          inflight.delete(inflightKey);
        }
        set((state) => {
          const envPending = { ...(state.pending[environmentId] ?? {}) };
          delete envPending[harnessId];
          const envForcing = force
            ? Math.max(0, (state.forcing[environmentId] ?? 0) - 1)
            : (state.forcing[environmentId] ?? 0);
          return {
            pending: { ...state.pending, [environmentId]: envPending },
            forcing: { ...state.forcing, [environmentId]: envForcing },
          };
        });
      });

    inflight.set(inflightKey, { promise, force });
    return promise;
  },

  refreshAll: (environmentId: string, workspaceId: string | null, harnessIds: readonly string[], force = false) => {
    for (const id of harnessIds) {
      void get().request(environmentId, workspaceId, id, force);
    }
  },

  selectAccount: async (environmentId: string, workspaceId: string | null, harnessId: string, accountId: string) => {
    // Never commit optimistically before main confirms success
    try {
      await window.electronAPI.selectHarnessAccount(environmentId, harnessId, accountId);
      set((state) => {
        const nextSelected = {
          ...state.selectedAccounts,
          [environmentId]: { ...(state.selectedAccounts[environmentId] ?? {}), [harnessId]: accountId },
        };
        const nextGen = (state.accountGenerations[environmentId] ?? 0) + 1;
        return {
          selectedAccounts: nextSelected,
          accountGenerations: { ...state.accountGenerations, [environmentId]: nextGen },
        };
      });
      void get().request(environmentId, workspaceId, harnessId, false);
    } catch {
      // Failed selections preserve authoritative state untouched
    }
  },

  handleAccountChange: (change: HarnessAccountChange) => {
    const env = change.environmentId ?? 'local';
    const harness = change.harness;

    if (change.type === 'selected') {
      set((state) => {
        const nextSelected = {
          ...state.selectedAccounts,
          [env]: { ...(state.selectedAccounts[env] ?? {}), [harness]: change.accountId },
        };
        const nextGen = (state.accountGenerations[env] ?? 0) + 1;
        return {
          selectedAccounts: nextSelected,
          accountGenerations: { ...state.accountGenerations, [env]: nextGen },
        };
      });
      const activeConsumer = [...consumers.values()].find((c) => c.environmentId === env && c.active && c.harnessIds.includes(harness));
      if (activeConsumer) {
        void get().request(env, activeConsumer.workspaceId, harness, false);
      }
    } else if (change.type === 'removed') {
      set((state) => {
        const envReadings = { ...(state.readings[env] ?? {}) };
        const harnessReadings = { ...(envReadings[harness] ?? {}) };
        delete harnessReadings[change.accountId];
        envReadings[harness] = harnessReadings;

        const envSelected = { ...(state.selectedAccounts[env] ?? {}) };
        if (envSelected[harness] === change.accountId) {
          envSelected[harness] = 'default';
        }
        const nextGen = (state.accountGenerations[env] ?? 0) + 1;
        return {
          readings: { ...state.readings, [env]: envReadings },
          selectedAccounts: { ...state.selectedAccounts, [env]: envSelected },
          accountGenerations: { ...state.accountGenerations, [env]: nextGen },
        };
      });
    } else if (change.type === 'reconnected') {
      set((state) => {
        const envReadings = { ...(state.readings[env] ?? {}) };
        const harnessReadings = { ...(envReadings[harness] ?? {}) };
        delete harnessReadings[change.accountId];
        envReadings[harness] = harnessReadings;
        const nextGen = (state.accountGenerations[env] ?? 0) + 1;
        return {
          readings: { ...state.readings, [env]: envReadings },
          accountGenerations: { ...state.accountGenerations, [env]: nextGen },
        };
      });
      const activeConsumer = [...consumers.values()].find((c) => c.environmentId === env && c.active && c.harnessIds.includes(harness));
      if (activeConsumer) {
        void get().request(env, activeConsumer.workspaceId, harness, false);
      }
    }
  },

  invalidateEnvironment: (environmentId: string) => {
    const timer = pollingTimers.get(environmentId);
    if (timer) {
      clearInterval(timer);
      pollingTimers.delete(environmentId);
    }
    for (const [key] of inflight) {
      if (key.startsWith(`${environmentId}\u0000`)) inflight.delete(key);
    }
    set((state) => {
      const nextReadings = { ...state.readings };
      delete nextReadings[environmentId];
      const nextSelected = { ...state.selectedAccounts };
      delete nextSelected[environmentId];
      const nextPending = { ...state.pending };
      delete nextPending[environmentId];
      const nextForcing = { ...state.forcing };
      delete nextForcing[environmentId];
      const nextGen = (state.environmentGenerations[environmentId] ?? 0) + 1;
      return {
        readings: nextReadings,
        selectedAccounts: nextSelected,
        pending: nextPending,
        forcing: nextForcing,
        environmentGenerations: { ...state.environmentGenerations, [environmentId]: nextGen },
      };
    });
  },

  registerConsumer: (consumer: UsageConsumer) => {
    const id = ++nextConsumerId;
    consumers.set(id, { ...consumer, id });
    const env = consumer.environmentId;
    const ws = consumer.workspaceId;

    if (!clockTimer) {
      clockTimer = setInterval(() => {
        set({ now: Date.now() });
      }, CLOCK_INTERVAL_MS);
    }

    if (consumer.active) {
      if (!pollingTimers.has(env) && (env === 'local' || ws)) {
        const timer = setInterval(() => {
          const activeForEnv = [...consumers.values()].filter((c) => c.environmentId === env && c.active);
          if (activeForEnv.length === 0) return;
          const allHarnesses = new Set<string>();
          let latestWs: string | null = null;
          for (const c of activeForEnv) {
            for (const h of c.harnessIds) allHarnesses.add(h);
            if (c.workspaceId) latestWs = c.workspaceId;
          }
          for (const h of allHarnesses) {
            void get().request(env, latestWs, h, false);
          }
        }, USAGE_POLL_INTERVAL_MS);
        pollingTimers.set(env, timer);
      }
      for (const h of consumer.harnessIds) {
        void get().request(env, ws, h, false);
      }
    } else if (consumer.prefetch && consumer.harnessIds.length > 0) {
      const warmKey = `${env}\u0000${ws ?? ''}\u0000${consumer.harnessIds.join('\u0000')}`;
      if (!warmedKeys.has(warmKey)) {
        scheduleIdleWarmup(() => {
          if (consumers.has(id)) {
            warmedKeys.add(warmKey);
            for (const h of consumer.harnessIds) {
              void get().request(env, ws, h, false);
            }
          }
        });
      }
    }

    return () => {
      consumers.delete(id);
      const hasActive = [...consumers.values()].some((c) => c.environmentId === env && c.active);
      if (!hasActive) {
        const timer = pollingTimers.get(env);
        if (timer) {
          clearInterval(timer);
          pollingTimers.delete(env);
        }
      }
      if (consumers.size === 0 && clockTimer) {
        clearInterval(clockTimer);
        clockTimer = null;
      }
    };
  },

  reset: () => {
    for (const timer of pollingTimers.values()) clearInterval(timer);
    pollingTimers.clear();
    inflight.clear();
    consumers.clear();
    warmedKeys.clear();
    if (clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
    set({
      readings: {},
      selectedAccounts: {},
      environmentGenerations: {},
      accountGenerations: {},
      pending: {},
      forcing: {},
      now: Date.now(),
    });
  },
}));

export function initUsageListeners(): () => void {
  if (typeof window === 'undefined' || !window.electronAPI) return () => {};
  const unsubs: Array<() => void> = [];
  if (window.electronAPI.onHarnessAccountsChanged) {
    unsubs.push(window.electronAPI.onHarnessAccountsChanged((change) => {
      useUsageStore.getState().handleAccountChange(change);
    }));
  }
  if (window.electronAPI.onSshEnvironmentInvalidated) {
    unsubs.push(window.electronAPI.onSshEnvironmentInvalidated((event) => {
      useUsageStore.getState().invalidateEnvironment(event.environmentId);
    }));
  }
  return () => {
    for (const unsub of unsubs) unsub();
  };
}

initUsageListeners();
