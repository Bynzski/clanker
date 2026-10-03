import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HarnessUsageEntry, HarnessUsageResponse } from '../../shared/types/harnessUsage';
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
 * Owns usage state for ONE workspace. Each harness is requested independently and concurrently so a slow
 * provider never delays the others. Ownership is explicit: every request captures a generation that is
 * bumped on workspace change/unmount, so late responses never land in a different workspace's panel.
 * Polling and the display clock exist only while `open`. Cache TTLs, backoff and floors stay in main;
 * `refreshableAt` is used only to avoid knowingly pointless manual refreshes.
 */
export function useHarnessUsage({ workspaceId, open, harnessIds, environmentId = 'local' }: { workspaceId: string | null; open: boolean; harnessIds: readonly string[]; environmentId?: string }): UseHarnessUsageResult {
  const [entries, setEntries] = useState<Record<string, HarnessUsageEntry | undefined>>({});
  const [otherAccounts, setOtherAccounts] = useState<Record<string, HarnessUsageEntry[] | undefined>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(() => Date.now());
  const generation = useRef(0);
  const unmounted = useRef(false);
  const inflight = useRef(new Map<string, { force: boolean }>());
  // Stable identity for the selected set so effects only restart when membership actually changes.
  const idsKey = harnessIds.join('\u0000');
  const ids = useMemo(() => (idsKey ? idsKey.split('\u0000') : []), [idsKey]);
  const idsRef = useRef<readonly string[]>(ids);
  const [forcing, setForcing] = useState(0);

  // New workspace (or none): drop everything that belonged to the old one. State is reset during render
  // (derived-state pattern); the ownership generation and in-flight tokens are reset in the effect.
  const [ownerWorkspace, setOwnerWorkspace] = useState(workspaceId);
  if (ownerWorkspace !== workspaceId) {
    setOwnerWorkspace(workspaceId);
    setEntries({});
    setOtherAccounts({});
    setPending({});
    setForcing(0);
  }
  useEffect(() => {
    generation.current++;
    inflight.current.clear();
  }, [workspaceId]);

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
    if (!workspaceId || !idsRef.current.includes(harnessId)) return;
    const running = inflight.current.get(harnessId);
    if (running && (running.force || !force)) return; // never duplicate work already in flight
    const owner = generation.current;
    const token = { force };
    inflight.current.set(harnessId, token);
    setPending((current) => ({ ...current, [harnessId]: true }));
    if (force) setForcing((count) => count + 1);
    void window.electronAPI.getHarnessUsage(workspaceId, { harnessIds: [harnessId], ...(force ? { force: true } : {}) })
      .then((response: HarnessUsageResponse) => {
        if (generation.current !== owner || unmounted.current || !idsRef.current.includes(harnessId)) return;
        // Entries arrive selected-account first; a harness without managed accounts has exactly one.
        const [entry, ...others] = response.entries.filter((candidate) => candidate.harnessId === harnessId);
        if (entry) setEntries((current) => ({ ...current, [harnessId]: entry }));
        setOtherAccounts((current) => ({ ...current, [harnessId]: others }));
      }, () => {
        if (generation.current !== owner || unmounted.current || !idsRef.current.includes(harnessId)) return;
        // Safe text only; a prior good reading is kept and flagged stale.
        setEntries((current) => {
          const prior = current[harnessId];
          return { ...current, [harnessId]: prior && prior.measurements.length > 0
            ? { ...prior, status: 'error', stale: true, error: GENERIC_ERROR }
            : { harnessId, status: 'error', measurements: [], error: GENERIC_ERROR } };
        });
      })
      .finally(() => {
        if (generation.current !== owner || unmounted.current) return;
        if (inflight.current.get(harnessId) === token) inflight.current.delete(harnessId);
        setPending((current) => { const next = { ...current }; if (!inflight.current.has(harnessId)) delete next[harnessId]; return next; });
        if (force) setForcing((count) => Math.max(0, count - 1));
      });
  }, [workspaceId]);

  const refreshAll = useCallback((force: boolean) => {
    for (const id of idsRef.current) request(id, force);
  }, [request]);

  const selectAccount = useCallback((harnessId: string, accountId: string) => {
    void window.electronAPI.selectHarnessAccount(environmentId, harnessId, accountId)
      .then(() => request(harnessId, false), () => undefined);
  }, [environmentId, request]);

  // Open: immediate ordinary read, then an ordinary read every minute. Nothing runs while closed.
  useEffect(() => {
    if (!open || !workspaceId) return;
    refreshAll(false);
    const first = setTimeout(() => setNow(Date.now()), 0); // fresh clock on open
    const poll = setInterval(() => refreshAll(false), USAGE_POLL_INTERVAL_MS);
    const clock = setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS);
    return () => { clearTimeout(first); clearInterval(poll); clearInterval(clock); };
  }, [open, workspaceId, refreshAll, ids]);

  const nextManualRefreshAt = useMemo(() => {
    const resolved = ids.map((id) => entries[id]).filter((entry): entry is HarnessUsageEntry => entry !== undefined);
    // A resolved entry without refreshableAt (e.g. not-installed) can always be re-checked by a forced
    // refresh; unresolved/initial-loading entries do not count.
    if (resolved.some((entry) => typeof entry.refreshableAt !== 'number')) return undefined;
    const times = resolved.map((entry) => entry.refreshableAt as number);
    if (times.length === 0) return undefined;
    return times.some((time) => time <= now) ? undefined : Math.min(...times);
  }, [entries, now, ids]);

  // Wake exactly when the earliest provider becomes force-refreshable.
  useEffect(() => {
    if (!open || nextManualRefreshAt === undefined) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, nextManualRefreshAt - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [open, nextManualRefreshAt]);

  const refreshing = forcing > 0;
  // Any ordinary (initial/poll) or forced request in flight for a selected harness makes Refresh unavailable.
  const hasPending = ids.some((id) => pending[id] === true);
  const canManualRefresh = ids.length > 0 && !hasPending && !refreshing && nextManualRefreshAt === undefined;
  return { harnessIds: ids, entries, otherAccounts, selectAccount, pending, refreshing, now, refreshAll, canManualRefresh, nextManualRefreshAt };
}
