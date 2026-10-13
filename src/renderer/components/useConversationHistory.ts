import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionDiscoveryResult, HarnessSession } from '../../shared/types/session';
import { scheduleIdleWarmup } from '../lib/idleWarmup';
import { checkoutSelectionToken } from '../lib/checkoutSelectionRuntime';
import { useWorkspaceStore } from '../store/workspaceStore';

const MAX_CACHED_WORKSPACES = 8;
const historyScope = (id: string): string => {
  const workspace = useWorkspaceStore.getState().getWorkspaceById(id);
  return JSON.stringify([id, workspace?.environmentId, workspace?.workspacePath]);
};

export interface UseConversationHistoryResult {
  sessions: HarnessSession[];
  /** Cold loading only; useful history stays visible during refresh/failure. */
  isLoading: boolean;
  error: string;
  isRefreshing: boolean;
  isLastKnown: boolean;
  /** Opening requests fresh discovery; closing retires UI publication, not the main scan. */
  setOpen: (open: boolean) => void;
}

/** Delayed local warmup and panel presentation; main owns discovery sharing and authorization. */
export function useConversationHistory(workspaceId: string | null, { warmup = true }: { warmup?: boolean } = {}): UseConversationHistoryResult {
  const cache = useRef(new Map<string, SessionDiscoveryResult>());
  const remember = useCallback((scope: string, found: SessionDiscoveryResult) => {
    // Partial results carry diagnostics and remain retryable; never replace last-good history.
    if (found.issues.length > 0 && cache.current.get(scope)?.issues.length === 0) return;
    cache.current.delete(scope);
    cache.current.set(scope, found);
    while (cache.current.size > MAX_CACHED_WORKSPACES) cache.current.delete(cache.current.keys().next().value as string);
  }, []);
  const [sessions, setSessions] = useState<HarnessSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLastKnown, setIsLastKnown] = useState(false);
  const visibleRequest = useRef(0);
  const workspaceRef = useRef(workspaceId);
  const [owner, setOwner] = useState(workspaceId);
  if (owner !== workspaceId) {
    setOwner(workspaceId);
    setSessions([]);
    setIsLoading(false);
    setError('');
    setIsRefreshing(false);
    setIsLastKnown(false);
    workspaceRef.current = workspaceId;
    visibleRequest.current++;
  }
  useEffect(() => { workspaceRef.current = workspaceId; visibleRequest.current++; }, [workspaceId]);
  useEffect(() => () => { visibleRequest.current++; }, []);

  // Optional, local-only at the Header caller. No eager activation or SSH warmup is added.
  useEffect(() => {
    if (!warmup || !workspaceId || cache.current.get(historyScope(workspaceId))?.issues.length === 0) return;
    let cancelled = false;
    const cancelWarmup = scheduleIdleWarmup(() => {
      const request = visibleRequest.current;
      const epoch = checkoutSelectionToken(workspaceId);
      const scope = historyScope(workspaceId);
      if (cache.current.get(scope)?.issues.length === 0) return;
      window.electronAPI.discoverSessionHistory(workspaceId).then((found) => {
        if (!cancelled && workspaceRef.current === workspaceId && visibleRequest.current === request
          && historyScope(workspaceId) === scope && checkoutSelectionToken(workspaceId) === epoch
          && cache.current.get(scope)?.issues.length !== 0) remember(scope, found);
      }, () => undefined);
    });
    return () => { cancelled = true; cancelWarmup(); };
  }, [warmup, workspaceId, remember]);

  const setOpen = useCallback((open: boolean) => {
    const request = ++visibleRequest.current;
    if (!open) { setIsLoading(false); setIsRefreshing(false); return; }
    const id = workspaceRef.current;
    const scope = id ? historyScope(id) : '';
    const epoch = id ? checkoutSelectionToken(id) : 0;
    const current = () => visibleRequest.current === request && workspaceRef.current === id
      && (!id || historyScope(id) === scope && checkoutSelectionToken(id) === epoch);
    const remembered = id ? cache.current.get(scope) : undefined;
    if (id && remembered) remember(scope, remembered);
    setSessions(remembered?.sessions ?? []);
    setIsLoading(!remembered);
    setIsRefreshing(Boolean(id));
    setIsLastKnown(Boolean(remembered));
    setError(remembered?.issues.map((issue) => issue.message).join(' ') ?? '');
    if (!id) { setIsLoading(false); return; }
    window.electronAPI.discoverSessionHistory(id, true).then((found) => {
      if (!current()) return;
      const retainGood = found.issues.length > 0 && remembered?.issues.length === 0;
      remember(scope, found);
      setSessions(retainGood ? remembered.sessions : found.sessions);
      setIsLastKnown(retainGood);
      setError(found.issues.map((issue) => issue.message).join(' '));
    }, (err: unknown) => {
      console.error('Failed to discover sessions:', err);
      if (current()) {
        setIsLastKnown(Boolean(remembered));
        setError(err instanceof Error ? err.message : 'Could not discover sessions');
      }
    }).finally(() => {
      if (visibleRequest.current === request && workspaceRef.current === id) {
        // A batched selection round-trip can retire publication without rendering a different id.
        setIsLoading(false); setIsRefreshing(false);
        if (!current()) {
          setIsLastKnown(Boolean(remembered));
          setError('Workspace selection changed; reopen History to refresh.');
        }
      }
    });
  }, [remember]);

  return { sessions, isLoading, error, isRefreshing, isLastKnown, setOpen };
}
