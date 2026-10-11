import { useEffect, useRef, useState } from 'react';
import type { GitRemote } from './types';
import type { RemoteAction } from './gitButtonTypes';

interface UseGitRemoteActionsParams {
  isCurrent?: () => boolean;
  currentBranch: string | null;
  loadRemotes: () => Promise<void>;
  refreshAfterAction: () => Promise<void>;
  remotes: GitRemote[];
  workspacePath: string;
  workspaceId?: string;
  checkoutContextId?: string;
}

export function useGitRemoteActions({
  isCurrent = () => true,
  currentBranch,
  loadRemotes,
  refreshAfterAction,
  remotes,
  workspacePath,
  workspaceId,
  checkoutContextId,
}: UseGitRemoteActionsParams) {
  const [remoteAction, setRemoteAction] = useState<RemoteAction>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const pending = useRef(false);
  // Also protect standalone consumers when props change without remounting.
  const scope = JSON.stringify([workspacePath, workspaceId, checkoutContextId]);
  const liveScope = useRef({ key: scope, generation: 0 });
  if (liveScope.current.key !== scope) {
    liveScope.current = { key: scope, generation: liveScope.current.generation + 1 };
  }
  const generation = liveScope.current.generation;
  const current = () => isCurrent() && liveScope.current.generation === generation;
  useEffect(() => {
    setRemoteAction(null);
    setRemoteError(null);
  }, [scope]);
  const checkoutArgs = checkoutContextId ? [checkoutContextId] : [];

  const run = async (
    action: Exclude<RemoteAction, null>,
    execute: () => Promise<{ success: boolean; error?: string }>,
  ) => {
    if (!current() || pending.current) return;
    pending.current = true;
    setRemoteAction(action);
    setRemoteError(null);
    const label = `${action[0].toUpperCase()}${action.slice(1)}`;
    const fallback = `${label} failed`;
    let succeeded = false;
    try {
      const result = await execute();
      if (!current()) return;
      if (!result.success) {
        setRemoteError(result.error || fallback);
        return;
      }
      succeeded = true;
      await refreshAfterAction();
      if (!current()) return;
      if (action === 'publish') await loadRemotes();
    } catch (error: unknown) {
      if (current()) {
        const detail = error instanceof Error ? error.message : 'Refresh failed';
        setRemoteError(succeeded
          ? `${label} succeeded, but refreshing repository status failed. Status may be stale; use Refresh before continuing. ${detail}`
          : error instanceof Error ? error.message : fallback);
      }
    } finally {
      pending.current = false;
      if (current()) setRemoteAction(null);
    }
  };

  const handleFetch = () => run('fetch', () =>
    window.electronAPI.gitFetch(workspacePath, undefined, workspaceId, ...checkoutArgs));
  const handlePull = () => run('pull', () =>
    window.electronAPI.gitPull(workspacePath, undefined, workspaceId, ...checkoutArgs));
  const handlePush = () => run('push', () =>
    window.electronAPI.gitPush(workspacePath, undefined, undefined, undefined, undefined, workspaceId, ...checkoutArgs));
  const handlePublish = async () => {
    if (!currentBranch) return;
    await run('publish', () => window.electronAPI.gitPush(
      workspacePath, remotes[0]?.name ?? 'origin', currentBranch, false, true, workspaceId, ...checkoutArgs,
    ));
  };

  return { handleFetch, handlePublish, handlePull, handlePush, remoteAction, remoteError, setRemoteError };
}
