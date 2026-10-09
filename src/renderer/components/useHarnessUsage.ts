import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HarnessUsageEntry } from '../../shared/types/harnessUsage';
import { scheduleIdleWarmup } from '../lib/idleWarmup';
import { useUsageStore } from '../store/usageStore';

export { USAGE_POLL_INTERVAL_MS } from '../store/usageStore';

export interface UseHarnessUsageResult {
  /** The harnesses this panel operates on (usage-capable AND enabled); nothing else is requested. */
  harnessIds: readonly string[];
  entries: Record<string, HarnessUsageEntry | undefined>;
  /** Further accounts of a harness that has managed accounts; `entries` holds the selected one. */
  otherAccounts: Record<string, HarnessUsageEntry[] | undefined>;
  /** Selects an account through the account service (usage never owns accounts), then re-reads. */
  selectAccount: (harnessId: string, accountId: string) => void;
  /** Harness requests currently in flight (initial load or refresh). */
  pending: Record<string, boolean>;
  /** A manual (forced) refresh is running. */
  refreshing: boolean;
  now: number;
  refreshAll: (force: boolean) => void;
  canManualRefresh: boolean;
  nextManualRefreshAt?: number;
}

/**
 * Accesses usage readings for an effective environment (local or SSH) and selected harnesses.
 * State is shared across workspaces in the same environment and Assistant destinations,
 * with stale-while-revalidate presentation. Polling and refresh cycles are coordinated
 * centrally through `useUsageStore`.
 */
export function useHarnessUsage({
  workspaceId,
  open,
  harnessIds,
  environmentId = 'local',
  prefetch = false,
}: {
  workspaceId: string | null;
  open: boolean;
  harnessIds: readonly string[];
  environmentId?: string;
  prefetch?: boolean;
}): UseHarnessUsageResult {
  const idsKey = harnessIds.join('\u0000');
  const ids = useMemo(() => (idsKey ? idsKey.split('\u0000') : []), [idsKey]);
  const idsRef = useRef<readonly string[]>(ids);
  idsRef.current = ids;

  const storeNow = useUsageStore((s) => s.now);
  const storePending = useUsageStore((s) => s.pending[environmentId]);
  const storeForcing = useUsageStore((s) => s.forcing[environmentId] ?? 0);
  const storeReadings = useUsageStore((s) => s.readings[environmentId]);
  const storeSelected = useUsageStore((s) => s.selectedAccounts[environmentId]);

  const [ownerKey, setOwnerKey] = useState(() => `${environmentId}\u0000${workspaceId ?? ''}`);
  const [cachedAtSwitch, setCachedAtSwitch] = useState<Record<string, HarnessUsageEntry | undefined>>(() =>
    useUsageStore.getState().getEntries(environmentId)
  );
  const [allowedHarnesses, setAllowedHarnesses] = useState<Record<string, boolean>>({});
  const generation = useRef(0);
  const unmounted = useRef(false);

  const currentOwner = `${environmentId}\u0000${workspaceId ?? ''}`;
  if (ownerKey !== currentOwner) {
    setOwnerKey(currentOwner);
    setCachedAtSwitch(useUsageStore.getState().getEntries(environmentId));
    setAllowedHarnesses({});
  }

  useEffect(() => {
    generation.current++;
  }, [workspaceId, environmentId]);

  useEffect(() => {
    unmounted.current = false;
    return () => { unmounted.current = true; };
  }, []);

  const request = useCallback((harnessId: string, force: boolean) => {
    if (!idsRef.current.includes(harnessId)) return;
    const reqGen = generation.current;
    void useUsageStore.getState().request(environmentId, workspaceId, harnessId, force).then(() => {
      if (generation.current === reqGen && !unmounted.current) {
        setAllowedHarnesses((cur) => ({ ...cur, [harnessId]: true }));
      }
    });
  }, [environmentId, workspaceId]);

  const refreshAll = useCallback((force: boolean) => {
    for (const id of idsRef.current) request(id, force);
  }, [request]);

  const selectAccount = useCallback((harnessId: string, accountId: string) => {
    void useUsageStore.getState().selectAccount(environmentId, workspaceId, harnessId, accountId);
  }, [environmentId, workspaceId]);

  // Register consumer in shared store (manages centralized polling timers and prefetch)
  useEffect(() => {
    return useUsageStore.getState().registerConsumer({
      environmentId,
      workspaceId,
      harnessIds: ids,
      active: open,
      prefetch,
    });
  }, [environmentId, workspaceId, idsKey, open, prefetch, ids]);

  // Initial request when open or when ids change while open
  useEffect(() => {
    if (open) {
      for (const id of ids) {
        request(id, false);
      }
    }
  }, [open, idsKey, ids, request]);

  // Closed idle warmup
  const warmed = useRef<string | null>(null);
  useEffect(() => {
    const key = `${environmentId}\u0000${workspaceId ?? ''}\u0000${idsKey}`;
    if (open || !prefetch || ids.length === 0 || warmed.current === key) return;
    return scheduleIdleWarmup(() => {
      warmed.current = key;
      refreshAll(false);
    });
  }, [open, prefetch, environmentId, workspaceId, idsKey, ids, refreshAll]);

  // Project entries visible to this consumer
  const entries = useMemo(() => {
    const result: Record<string, HarnessUsageEntry | undefined> = {};
    for (const id of ids) {
      if (cachedAtSwitch[id] !== undefined || allowedHarnesses[id]) {
        const selectedId = storeSelected?.[id] ?? 'default';
        const entry = storeReadings?.[id]?.[selectedId];
        if (entry) {
          result[id] = {
            ...entry,
            account: entry.account ? { ...entry.account, selected: true } : undefined,
          };
        }
      }
    }
    return result;
  }, [ids, cachedAtSwitch, allowedHarnesses, storeReadings, storeSelected]);

  const otherAccounts = useMemo(() => {
    const result: Record<string, HarnessUsageEntry[] | undefined> = {};
    for (const id of ids) {
      const selectedId = storeSelected?.[id] ?? 'default';
      const harnessMap = storeReadings?.[id] ?? {};
      const others = Object.entries(harnessMap)
        .filter(([accId]) => accId !== selectedId)
        .map(([, entry]) => ({
          ...entry,
          account: entry.account ? { ...entry.account, selected: false } : undefined,
        }));
      result[id] = others;
    }
    return result;
  }, [ids, storeReadings, storeSelected]);

  const pending = useMemo(() => {
    const result: Record<string, boolean> = {};
    for (const id of ids) {
      if (storePending?.[id]) result[id] = true;
    }
    return result;
  }, [ids, storePending]);

  const [localNow, setLocalNow] = useState(() => Date.now());
  const currentNow = Math.max(storeNow, localNow);

  const nextManualRefreshAt = useMemo(() => {
    const resolved = ids.map((id) => entries[id]).filter((entry): entry is HarnessUsageEntry => entry !== undefined);
    if (resolved.some((entry) => typeof entry.refreshableAt !== 'number')) return undefined;
    const times = resolved.map((entry) => entry.refreshableAt as number);
    if (times.length === 0) return undefined;
    return times.some((time) => time <= currentNow) ? undefined : Math.min(...times);
  }, [entries, currentNow, ids]);

  // Wake up when the earliest refreshableAt arrives so the button enables itself promptly.
  useEffect(() => {
    if (!open || nextManualRefreshAt === undefined) return;
    const delay = Math.max(0, nextManualRefreshAt - Date.now()) + 50;
    const timer = setTimeout(() => {
      setLocalNow(Date.now());
    }, delay);
    return () => clearTimeout(timer);
  }, [open, nextManualRefreshAt]);

  const refreshing = storeForcing > 0;
  const hasPending = ids.some((id) => pending[id] === true);
  const canManualRefresh = ids.length > 0 && !hasPending && !refreshing && nextManualRefreshAt === undefined;

  return {
    harnessIds: ids,
    entries,
    otherAccounts,
    selectAccount,
    pending,
    refreshing,
    now: currentNow,
    refreshAll,
    canManualRefresh,
    nextManualRefreshAt,
  };
}
