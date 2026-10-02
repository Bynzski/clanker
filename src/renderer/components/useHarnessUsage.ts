import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HarnessUsageEntry, HarnessUsageResponse } from '../../shared/types/harnessUsage';
import { HARNESS_OPTIONS } from '../lib/harnessOptions';

/** Every canonical harness, in launcher order (the empty Terminal entry excluded). */
export const USAGE_HARNESS_IDS: readonly string[] = HARNESS_OPTIONS.filter((option) => option.id !== '').map((option) => option.id);

export const USAGE_POLL_INTERVAL_MS = 60_000;
const CLOCK_INTERVAL_MS = 30_000;
const GENERIC_ERROR = 'Usage could not be read';

export interface UseHarnessUsageResult {
  entries: Record<string, HarnessUsageEntry | undefined>;
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
export function useHarnessUsage({ workspaceId, open }: { workspaceId: string | null; open: boolean }): UseHarnessUsageResult {
  const [entries, setEntries] = useState<Record<string, HarnessUsageEntry | undefined>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(() => Date.now());
  const generation = useRef(0);
  const unmounted = useRef(false);
  const inflight = useRef(new Map<string, { force: boolean }>());
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const [forcing, setForcing] = useState(0);

  // New workspace (or none): drop everything that belonged to the old one.
  useEffect(() => {
    generation.current++;
    inflight.current.clear();
    setEntries({});
    setPending({});
    setForcing(0);
  }, [workspaceId]);

  useEffect(() => {
    unmounted.current = false;
    return () => { unmounted.current = true; };
  }, []);

  const request = useCallback((harnessId: string, force: boolean) => {
    if (!workspaceId) return;
    const running = inflight.current.get(harnessId);
    if (running && (running.force || !force)) return; // never duplicate work already in flight
    const owner = generation.current;
    const token = { force };
    inflight.current.set(harnessId, token);
    setPending((current) => ({ ...current, [harnessId]: true }));
    if (force) setForcing((count) => count + 1);
    void window.electronAPI.getHarnessUsage(workspaceId, { harnessIds: [harnessId], ...(force ? { force: true } : {}) })
      .then((response: HarnessUsageResponse) => {
        if (generation.current !== owner || unmounted.current) return;
        const entry = response.entries.find((candidate) => candidate.harnessId === harnessId);
        if (entry) setEntries((current) => ({ ...current, [harnessId]: entry }));
      }, () => {
        if (generation.current !== owner || unmounted.current) return;
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
    for (const id of USAGE_HARNESS_IDS) request(id, force);
  }, [request]);

  // Open: immediate ordinary read, then an ordinary read every minute. Nothing runs while closed.
  useEffect(() => {
    if (!open || !workspaceId) return;
    setNow(Date.now());
    refreshAll(false);
    const poll = setInterval(() => refreshAll(false), USAGE_POLL_INTERVAL_MS);
    const clock = setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [open, workspaceId, refreshAll]);

  const nextManualRefreshAt = useMemo(() => {
    const times = USAGE_HARNESS_IDS.map((id) => entries[id]?.refreshableAt).filter((time): time is number => typeof time === 'number');
    if (times.length === 0) return undefined;
    return times.some((time) => time <= now) ? undefined : Math.min(...times);
  }, [entries, now]);

  // Wake exactly when the earliest provider becomes force-refreshable.
  useEffect(() => {
    if (!open || nextManualRefreshAt === undefined) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, nextManualRefreshAt - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [open, nextManualRefreshAt]);

  const refreshing = forcing > 0;
  return { entries, pending, refreshing, now, refreshAll, canManualRefresh: !refreshing && nextManualRefreshAt === undefined, nextManualRefreshAt };
}
