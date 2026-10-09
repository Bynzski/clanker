import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HarnessUsageEntry } from '../../shared/types/harnessUsage';
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

  const storeNow = useUsageStore((s) => s.now);
  const storePending = useUsageStore((s) => s.pending[environmentId]);
  const storeForcing = useUsageStore((s) => s.forcing[environmentId] ?? 0);
  const storeReadings = useUsageStore((s) => s.readings[environmentId]);
  const storeSelected = useUsageStore((s) => s.selectedAccounts[environmentId]);

  const refreshAll = useCallback((force: boolean) => {
    useUsageStore.getState().refreshAll(environmentId, workspaceId, ids, force);
  }, [environmentId, workspaceId, ids]);

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

  // Project entries visible to this consumer
  const entries = useMemo(() => {
    const result: Record<string, HarnessUsageEntry | undefined> = {};
    for (const id of ids) {
      const selectedId = storeSelected?.[id] ?? 'default';
      const entry = storeReadings?.[id]?.[selectedId];
      if (entry) {
        result[id] = {
          ...entry,
          account: entry.account ? { ...entry.account, selected: true } : undefined,
        };
      }
    }
    return result;
  }, [ids, storeReadings, storeSelected]);

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
