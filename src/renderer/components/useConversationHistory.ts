import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionDiscoveryResult, HarnessSession } from '../../shared/types/session';
import { scheduleIdleWarmup } from '../lib/idleWarmup';

const MAX_CACHED_WORKSPACES = 8;

export interface UseConversationHistoryResult {
  sessions: HarnessSession[];
  /** True only while nothing is known yet for this workspace; a background refresh keeps the list. */
  isLoading: boolean;
  error: string;
  /** Opening shows the remembered list at once and refreshes it; closing drops any in-flight answer. */
  setOpen: (open: boolean) => void;
}

/**
 * Conversation history for the focused workspace, remembered per workspace and warmed (local workspaces
 * only) shortly after the workspace becomes active, so opening Chat History is instant. Ownership is explicit:
 * every request captures a token, and a workspace change, close or newer opening invalidates it,
 * so a late answer never lands in another workspace's list or a dismissed panel.
 */
export function useConversationHistory(workspaceId: string | null, { warmup = true }: { warmup?: boolean } = {}): UseConversationHistoryResult {
  const cache = useRef(new Map<string, SessionDiscoveryResult>());
  // Bounded so closed workspaces cannot grow it forever; the oldest entry goes first.
  const remember = useCallback((id: string, found: SessionDiscoveryResult) => {
    // Keep partial results WITH their issues when no complete scan exists. An incomplete scan must
    // never overwrite last-good history or suppress idle retries when returning to this workspace.
    if (found.issues.length > 0 && cache.current.get(id)?.issues.length === 0) return;
    cache.current.delete(id);
    cache.current.set(id, found);
    while (cache.current.size > MAX_CACHED_WORKSPACES) {
      cache.current.delete(cache.current.keys().next().value as string);
    }
  }, []);
  const [sessions, setSessions] = useState<HarnessSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const visibleRequest = useRef(0);
  const workspaceRef = useRef(workspaceId);

  // New workspace: show what is remembered for it (nothing until opened) and void older answers.
  const [owner, setOwner] = useState(workspaceId);
  if (owner !== workspaceId) {
    setOwner(workspaceId);
    setSessions([]);
    setIsLoading(false);
    setError('');
  }
  useEffect(() => {
    workspaceRef.current = workspaceId;
    visibleRequest.current++;
  }, [workspaceId]);

  useEffect(() => () => { visibleRequest.current++; }, []);

  // Background warm-up: only without a complete cached scan (partial scans retry on reactivation),
  // after a delay and idle moment. Failures stay quiet; opening retries and shows diagnostics.
  useEffect(() => {
    if (!warmup || !workspaceId || cache.current.get(workspaceId)?.issues.length === 0) return;
    let cancelled = false;
    const cancelWarmup = scheduleIdleWarmup(() => {
      const request = visibleRequest.current;
      if (cache.current.get(workspaceId)?.issues.length === 0) return;
      window.electronAPI.discoverSessionHistory(workspaceId).then((found) => {
        if (!cancelled && workspaceRef.current === workspaceId && visibleRequest.current === request
          && cache.current.get(workspaceId)?.issues.length !== 0) remember(workspaceId, found);
      }, () => undefined);
    });
    return () => { cancelled = true; cancelWarmup(); };
  }, [warmup, workspaceId, remember]);

  const setOpen = useCallback((open: boolean) => {
    const request = ++visibleRequest.current;
    if (!open) { setIsLoading(false); return; }
    const id = workspaceRef.current;
    const remembered = id ? cache.current.get(id) : undefined;
    if (id && remembered) remember(id, remembered); // reopening keeps it among the most recent
    setSessions(remembered?.sessions ?? []);
    setIsLoading(!remembered);
    setError(remembered?.issues.map((issue) => issue.message).join(' ') ?? '');
    if (!id) {
      setIsLoading(false);
      return;
    }
    window.electronAPI.discoverSessionHistory(id, true).then((found) => {
      if (visibleRequest.current !== request || workspaceRef.current !== id) return;
      remember(id, found);
      setSessions(found.sessions);
      setError(found.issues.map((issue) => issue.message).join(' '));
    }, (err: unknown) => {
      console.error('Failed to discover sessions:', err);
      if (visibleRequest.current === request) setError(err instanceof Error ? err.message : 'Could not discover sessions');
    }).finally(() => {
      if (visibleRequest.current === request) setIsLoading(false);
    });
  }, [remember]);

  return { sessions, isLoading, error, setOpen };
}
