import { useCallback, useEffect, useRef, useState } from 'react';
import type { HarnessSession } from '../../shared/types/session';
import { scheduleIdleWarmup } from '../lib/idleWarmup';

export interface UseConversationHistoryResult {
  sessions: HarnessSession[];
  /** True only while nothing is known yet for this workspace; a background refresh keeps the list. */
  isLoading: boolean;
  error: string;
  /** Opening shows the remembered list at once and refreshes it; closing drops any in-flight answer. */
  setOpen: (open: boolean) => void;
}

/**
 * Conversation history for the focused workspace, remembered per workspace and warmed shortly
 * after the workspace becomes active, so opening Chat History is instant. Ownership is explicit:
 * every request captures a token, and a workspace change, close or newer opening invalidates it,
 * so a late answer never lands in another workspace's list or a dismissed panel.
 */
export function useConversationHistory(workspaceId: string | null): UseConversationHistoryResult {
  const cache = useRef(new Map<string, HarnessSession[]>());
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

  // Background warm-up: once per workspace, only when nothing is remembered yet, and only after the
  // workspace has settled (see scheduleIdleWarmup). Failures stay quiet; opening retries and shows them.
  useEffect(() => {
    if (!workspaceId || cache.current.has(workspaceId)) return;
    return scheduleIdleWarmup(() => {
      if (cache.current.has(workspaceId)) return;
      window.electronAPI.discoverSessions(workspaceId).then((found) => {
        if (!cache.current.has(workspaceId)) cache.current.set(workspaceId, found);
      }, () => undefined);
    });
  }, [workspaceId]);

  const setOpen = useCallback((open: boolean) => {
    const request = ++visibleRequest.current;
    if (!open) return;
    const id = workspaceRef.current;
    const remembered = id ? cache.current.get(id) : undefined;
    setSessions(remembered ?? []);
    setIsLoading(!remembered);
    setError('');
    if (!id) {
      setIsLoading(false);
      return;
    }
    window.electronAPI.discoverSessions(id).then((found) => {
      cache.current.set(id, found);
      if (visibleRequest.current === request) setSessions(found);
    }, (err: unknown) => {
      console.error('Failed to discover sessions:', err);
      if (visibleRequest.current === request) setError(err instanceof Error ? err.message : 'Could not discover sessions');
    }).finally(() => {
      if (visibleRequest.current === request) setIsLoading(false);
    });
  }, []);

  return { sessions, isLoading, error, setOpen };
}
