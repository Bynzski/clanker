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
  // Absent until main supplies an identity; renderer never increments it.
  environmentGenerations: Record<string, number>;
  // Renderer request invalidation version, keyed by environment + harness.
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
  invalidateEnvironment: (environmentId: string, environmentGeneration: number) => void;
  registerConsumer: (consumer: UsageConsumer) => () => void;
  reset: () => void;
}

let nextConsumerId = 0;
const consumers = new Map<number, UsageConsumer>();
const pollingTimers = new Map<string, ReturnType<typeof setInterval>>();
interface UsageOperation {
  promise: Promise<void>;
  force: boolean;
  environmentId: string;
  harnessId: string;
  workspaceId: string | null;
  environmentGeneration: number | undefined;
  accountGeneration: number;
}
const inflight = new Map<string, UsageOperation>();

// Indicators are projections of owned operations, never counters updated by old promises.
function operationIndicators() {
  const pending: Record<string, Record<string, boolean>> = {};
  const forcing: Record<string, number> = {};
  for (const op of inflight.values()) {
    (pending[op.environmentId] ??= {})[op.harnessId] = true;
    if (op.force) forcing[op.environmentId] = (forcing[op.environmentId] ?? 0) + 1;
  }
  return { pending, forcing };
}
const warmedKeys = new Set<string>();
let clockTimer: ReturnType<typeof setInterval> | null = null;
const warmupDisposers = new Map<number, () => void>();

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

    const inflightKey = `${environmentId}\u0000${harnessId}`;
    const reqEnvGen = get().environmentGenerations[environmentId];
    const reqAcctGen = get().accountGenerations[inflightKey] ?? 0;
    const effectiveWsId = environmentId === 'local' ? null : workspaceId;
    const existing = inflight.get(inflightKey);
    if (existing && existing.workspaceId === effectiveWsId && existing.environmentGeneration === reqEnvGen && existing.accountGeneration === reqAcctGen && (!force || existing.force)) {
      return existing.promise;
    }
    const owned = () => inflight.get(inflightKey)?.promise === promise &&
      (get().accountGenerations[inflightKey] ?? 0) === reqAcctGen;
    const contextValid = () => environmentId === 'local' || consumers.size === 0 ||
      [...consumers.values()].some((c) => c.environmentId === environmentId && c.workspaceId === workspaceId);

    const promise = window.electronAPI.getHarnessUsage(effectiveWsId, {
      harnessIds: [harnessId],
      ...(force ? { force: true } : {}),
    })
      .then((response: HarnessUsageResponse) => {
        if (!owned() || !contextValid()) return;
        if (response.environmentId !== environmentId || !Number.isSafeInteger(response.environmentGeneration) || response.environmentGeneration < 0) return;
        const currentEnvGen = get().environmentGenerations[environmentId];
        if (currentEnvGen !== undefined && response.environmentGeneration < currentEnvGen) return;
        if (currentEnvGen === undefined) {
          set((state) => ({ environmentGenerations: { ...state.environmentGenerations, [environmentId]: response.environmentGeneration } }));
          for (const op of inflight.values()) {
            if (op.environmentId === environmentId) op.environmentGeneration = response.environmentGeneration;
          }
        } else if (currentEnvGen !== response.environmentGeneration) {
          // Adopt main's identity, not a renderer-generated counter. Keep this
          // operation owned, but retire every operation from the previous incarnation.
          get().invalidateEnvironment(environmentId, response.environmentGeneration);
          inflight.set(inflightKey, { promise, force, environmentId, harnessId, workspaceId: effectiveWsId, environmentGeneration: response.environmentGeneration, accountGeneration: reqAcctGen });
          set(operationIndicators());
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
            if (entry.account?.selected) {
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
        if (!owned() || !contextValid() || get().environmentGenerations[environmentId] !== inflight.get(inflightKey)?.environmentGeneration) return;

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
        if (inflight.get(inflightKey)?.promise !== promise) return;
        inflight.delete(inflightKey);
        set(operationIndicators());
      });

    inflight.set(inflightKey, { promise, force, environmentId, harnessId, workspaceId: effectiveWsId, environmentGeneration: reqEnvGen, accountGeneration: reqAcctGen });
    set(operationIndicators());
    return promise;
  },

  refreshAll: (environmentId: string, workspaceId: string | null, harnessIds: readonly string[], force = false) => {
    for (const id of harnessIds) {
      void get().request(environmentId, workspaceId, id, force);
    }
  },

  selectAccount: async (environmentId: string, _workspaceId: string | null, harnessId: string, accountId: string) => {
    // Never commit optimistically before main confirms success
    try {
      await window.electronAPI.selectHarnessAccount(environmentId, harnessId, accountId);
      // The account service broadcasts confirmed changes (also for Settings).
      // Never replay an IPC completion: it may arrive after a newer selection.
    } catch {
      // Failed selections preserve authoritative state untouched
    }
  },

  handleAccountChange: (change: HarnessAccountChange) => {
    const env = change.environmentId ?? 'local';
    const harness = change.harness;
    const key = `${env}\u0000${harness}`;
    inflight.delete(key);
    set((state) => {
      const harnessReadings = { ...(state.readings[env]?.[harness] ?? {}) };
      const selected = { ...(state.selectedAccounts[env] ?? {}) };
      if (change.type === 'removed' || change.type === 'reconnected') delete harnessReadings[change.accountId];
      if (change.type === 'selected') selected[harness] = change.accountId;
      if (change.type === 'removed' && selected[harness] === change.accountId) selected[harness] = 'default';
      return {
        readings: { ...state.readings, [env]: { ...state.readings[env], [harness]: harnessReadings } },
        selectedAccounts: { ...state.selectedAccounts, [env]: selected },
        accountGenerations: { ...state.accountGenerations, [key]: (state.accountGenerations[key] ?? 0) + 1 },
        ...operationIndicators(),
      };
    });
    const activeConsumer = [...consumers.values()].find((c) => c.environmentId === env && c.active && c.harnessIds.includes(harness));
    if (activeConsumer) void get().request(env, activeConsumer.workspaceId, harness, false);
  },

  invalidateEnvironment: (environmentId: string, environmentGeneration: number) => {
    if (!Number.isSafeInteger(environmentGeneration) || environmentGeneration < 0) return;
    const current = get().environmentGenerations[environmentId];
    if (current !== undefined && environmentGeneration <= current) return;
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
      const nextGen = environmentGeneration;
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
      const warmKey = `${env}\u0000${env === 'local' ? '' : ws ?? ''}\u0000${consumer.harnessIds.join('\u0000')}`;
      if (!warmedKeys.has(warmKey)) {
        warmupDisposers.set(id, scheduleIdleWarmup(() => {
          warmupDisposers.delete(id);
          if (consumers.has(id) && !warmedKeys.has(warmKey)) {
            warmedKeys.add(warmKey);
            for (const h of consumer.harnessIds) {
              void get().request(env, ws, h, false);
            }
          }
        }));
      }
    }

    return () => {
      warmupDisposers.get(id)?.();
      warmupDisposers.delete(id);
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
    for (const dispose of warmupDisposers.values()) dispose();
    warmupDisposers.clear();
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

let listenerOwners = 0;
let disposeListeners: (() => void) | undefined;

export function initUsageListeners(): () => void {
  if (typeof window === 'undefined' || !window.electronAPI) return () => {};
  if (listenerOwners++ === 0) {
    const unsubs = [
      window.electronAPI.onHarnessAccountsChanged((change) => {
        useUsageStore.getState().handleAccountChange(change);
      }),
      window.electronAPI.onSshEnvironmentInvalidated((event) => {
        useUsageStore.getState().invalidateEnvironment(event.environmentId, event.environmentGeneration);
      }),
    ];
    disposeListeners = () => { for (const unsub of unsubs) unsub(); };
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (--listenerOwners === 0) {
      disposeListeners?.();
      disposeListeners = undefined;
    }
  };
}
