import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HarnessUsageEntry, HarnessUsageResponse } from '../../shared/types/harnessUsage';
import { scheduleIdleWarmup } from '../lib/idleWarmup';
import { useUsageStore } from '../store/usageStore';

export const USAGE_POLL_INTERVAL_MS = 60_000;
const CLOCK_INTERVAL_MS = 30_000;
const GENERIC_ERROR = 'Usage could not be read';

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
 * with stale-while-revalidate presentation. Polling and the display clock run only while `open`;
 * with `prefetch`, a delayed idle prefetch warms readings for newly active environments.
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
  /** Warm the panel in the background shortly after the workspace becomes active (delayed, best-effort idle prefetch). */
  prefetch?: boolean;
}): UseHarnessUsageResult {
  // Pre-populate with shared cached readings for this environment
  const [entries, setEntries] = useState<Record<string, HarnessUsageEntry | undefined>>(() =>
    useUsageStore.getState().getEntries(environmentId)
  );
  const [otherAccounts, setOtherAccounts] = useState<Record<string, HarnessUsageEntry[] | undefined>>(() =>
    useUsageStore.getState().getOtherAccounts(environmentId)
  );
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(() => Date.now());
  const generation = useRef(0);
  const unmounted = useRef(false);
  const inflight = useRef(new Map<string, { force: boolean }>());

  const idsKey = harnessIds.join('\u0000');
  const ids = useMemo(() => (idsKey ? idsKey.split('\u0000') : []), [idsKey]);
  const idsRef = useRef<readonly string[]>(ids);
  const [forcing, setForcing] = useState(0);

  // New workspace (or environment): preserve cached readings for the active environment (stale-while-revalidate),
  // but bump the ownership generation and clear in-flight requests so old in-flight responses don't land here.
  const [ownerKey, setOwnerKey] = useState(() => `${environmentId}\u0000${workspaceId ?? ''}`);
  const currentKey = `${environmentId}\u0000${workspaceId ?? ''}`;
  if (ownerKey !== currentKey) {
    setOwnerKey(currentKey);
    const cached = useUsageStore.getState().getEntries(environmentId);
    const cachedOthers = useUsageStore.getState().getOtherAccounts(environmentId);
    setEntries(cached);
    setOtherAccounts(cachedOthers);
    setPending({});
    setForcing(0);
  }
  useEffect(() => {
    generation.current++;
    inflight.current.clear();
  }, [workspaceId, environmentId]);

  useEffect(() => {
    unmounted.current = false;
    return () => { unmounted.current = true; };
  }, []);

  // A harness that left the selected set loses its entry and pending flag (here) and its in-flight token
  // (in the effect), so a late response can never bring its row back.
  const [ownerIds, setOwnerIds] = useState(idsKey);
  if (ownerIds !== idsKey) {
    setOwnerIds(idsKey);
    const keep = <T,>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => ids.includes(id)));
    setEntries(keep);
    setOtherAccounts(keep);
    setPending(keep);
  }
  useEffect(() => {
    idsRef.current = ids;
    for (const id of [...inflight.current.keys()]) if (!ids.includes(id)) inflight.current.delete(id);
  }, [ids]);

  const request = useCallback((harnessId: string, force: boolean) => {
    if (!idsRef.current.includes(harnessId)) return;
    if (environmentId !== 'local' && !workspaceId) return;
    const running = inflight.current.get(harnessId);
    if (running && (running.force || !force)) return;
    const owner = generation.current;
    const token = { force };
    inflight.current.set(harnessId, token);
    setPending((current) => ({ ...current, [harnessId]: true }));
    if (force) setForcing((count) => count + 1);

    const effectiveWsId = environmentId === 'local' ? (workspaceId ?? null) : workspaceId;
    void window.electronAPI.getHarnessUsage(effectiveWsId, { harnessIds: [harnessId], ...(force ? { force: true } : {}) })
      .then((response: HarnessUsageResponse) => {
        if (generation.current !== owner || unmounted.current || !idsRef.current.includes(harnessId)) return;
        const [entry, ...others] = response.entries.filter((candidate) => candidate.harnessId === harnessId);
        if (entry) {
          setEntries((current) => ({ ...current, [harnessId]: entry }));
          useUsageStore.getState().setEntry(environmentId, harnessId, entry, others);
        }
        setOtherAccounts((current) => ({ ...current, [harnessId]: others }));
      }, () => {
        if (generation.current !== owner || unmounted.current || !idsRef.current.includes(harnessId)) return;
        setEntries((current) => {
          const prior = current[harnessId] ?? useUsageStore.getState().getEntries(environmentId)[harnessId];
          const errorEntry: HarnessUsageEntry = prior && prior.measurements.length > 0
            ? { ...prior, status: 'error', stale: true, error: GENERIC_ERROR }
            : { harnessId, status: 'error', measurements: [], error: GENERIC_ERROR };
          useUsageStore.getState().setEntry(environmentId, harnessId, errorEntry, []);
          return { ...current, [harnessId]: errorEntry };
        });
      })
      .finally(() => {
        if (generation.current !== owner || unmounted.current) return;
        if (inflight.current.get(harnessId) === token) inflight.current.delete(harnessId);
        setPending((current) => { const next = { ...current }; if (!inflight.current.has(harnessId)) delete next[harnessId]; return next; });
        if (force) setForcing((count) => Math.max(0, count - 1));
      });
  }, [workspaceId, environmentId]);

  const refreshAll = useCallback((force: boolean) => {
    for (const id of idsRef.current) request(id, force);
  }, [request]);

  const selectAccount = useCallback((harnessId: string, accountId: string) => {
    useUsageStore.getState().selectAccount(environmentId, harnessId, accountId);
    void window.electronAPI.selectHarnessAccount(environmentId, harnessId, accountId)
      .then(() => request(harnessId, false), () => undefined);
  }, [environmentId, request]);

  // Closed: one ordinary read per environment/workspace (and provider set) shortly after becoming active
  // (a delayed, best-effort idle prefetch, see scheduleIdleWarmup).
  const warmed = useRef<string | null>(null);
  useEffect(() => {
    const key = `${environmentId}\u0000${workspaceId ?? ''}\u0000${idsKey}`;
    if (open || !prefetch || ids.length === 0 || warmed.current === key) return;
    return scheduleIdleWarmup(() => {
      warmed.current = key;
      refreshAll(false);
    });
  }, [open, prefetch, environmentId, workspaceId, idsKey, ids, refreshAll]);

  // Open: immediate ordinary read, then an ordinary read every minute. Polling only runs while open.
  useEffect(() => {
    if (!open) return;
    if (environmentId !== 'local' && !workspaceId) return;
    warmed.current = `${environmentId}\u0000${workspaceId ?? ''}\u0000${idsKey}`;
    refreshAll(false);
    const first = setTimeout(() => setNow(Date.now()), 0);
    const poll = setInterval(() => refreshAll(false), USAGE_POLL_INTERVAL_MS);
    const clock = setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS);
    return () => { clearTimeout(first); clearInterval(poll); clearInterval(clock); };
  }, [open, environmentId, workspaceId, refreshAll, idsKey]);

  const nextManualRefreshAt = useMemo(() => {
    const resolved = ids.map((id) => entries[id]).filter((entry): entry is HarnessUsageEntry => entry !== undefined);
    if (resolved.some((entry) => typeof entry.refreshableAt !== 'number')) return undefined;
    const times = resolved.map((entry) => entry.refreshableAt as number);
    if (times.length === 0) return undefined;
    return times.some((time) => time <= now) ? undefined : Math.min(...times);
  }, [entries, now, ids]);

  useEffect(() => {
    if (!open || nextManualRefreshAt === undefined) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, nextManualRefreshAt - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [open, nextManualRefreshAt]);

  const refreshing = forcing > 0;
  const hasPending = ids.some((id) => pending[id] === true);
  const canManualRefresh = ids.length > 0 && !hasPending && !refreshing && nextManualRefreshAt === undefined;
  return { harnessIds: ids, entries, otherAccounts, selectAccount, pending, refreshing, now, refreshAll, canManualRefresh, nextManualRefreshAt };
}
