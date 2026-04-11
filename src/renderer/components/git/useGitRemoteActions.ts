import { useState } from 'react';
import type { GitRemote } from './types';
import type { RemoteAction } from './gitButtonTypes';

interface UseGitRemoteActionsParams {
  currentBranch: string | null;
  loadRemotes: () => Promise<void>;
  refreshAfterAction: () => Promise<void>;
  remotes: GitRemote[];
  workspacePath: string;
}

export function useGitRemoteActions({
  currentBranch,
  loadRemotes,
  refreshAfterAction,
  remotes,
  workspacePath,
}: UseGitRemoteActionsParams) {
  const [remoteAction, setRemoteAction] = useState<RemoteAction>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const handleFetch = async () => {
    setRemoteAction('fetch');
    setRemoteError(null);

    try {
      const result = await window.electronAPI.gitFetch(workspacePath);
      if (result.success) {
        await refreshAfterAction();
      } else {
        setRemoteError(result.error || 'Fetch failed');
      }
    } catch (error: unknown) {
      setRemoteError(error instanceof Error ? error.message : 'Fetch failed');
    } finally {
      setRemoteAction(null);
    }
  };

  const handlePull = async () => {
    setRemoteAction('pull');
    setRemoteError(null);

    try {
      const result = await window.electronAPI.gitPull(workspacePath);
      if (result.success) {
        await refreshAfterAction();
      } else {
        setRemoteError(result.error || 'Pull failed');
      }
    } catch (error: unknown) {
      setRemoteError(error instanceof Error ? error.message : 'Pull failed');
    } finally {
      setRemoteAction(null);
    }
  };

  const handlePush = async () => {
    setRemoteAction('push');
    setRemoteError(null);

    try {
      const result = await window.electronAPI.gitPush(workspacePath);
      if (result.success) {
        await refreshAfterAction();
      } else {
        setRemoteError(result.error || 'Push failed');
      }
    } catch (error: unknown) {
      setRemoteError(error instanceof Error ? error.message : 'Push failed');
    } finally {
      setRemoteAction(null);
    }
  };

  const handlePublish = async () => {
    if (!currentBranch) {
      return;
    }

    const targetRemote = remotes[0]?.name ?? 'origin';

    setRemoteAction('publish');
    setRemoteError(null);

    try {
      const result = await window.electronAPI.gitPush(
        workspacePath,
        targetRemote,
        currentBranch,
        false,
        true
      );
      if (result.success) {
        await refreshAfterAction();
        await loadRemotes();
        setRemoteError(null);
      } else {
        setRemoteError(result.error || 'Publish failed');
      }
    } catch (error: unknown) {
      setRemoteError(error instanceof Error ? error.message : 'Publish failed');
    } finally {
      setRemoteAction(null);
    }
  };

  return {
    handleFetch,
    handlePublish,
    handlePull,
    handlePush,
    remoteAction,
    remoteError,
    setRemoteError,
  };
}
