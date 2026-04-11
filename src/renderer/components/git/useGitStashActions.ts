import { useState } from 'react';

interface UseGitStashActionsParams {
  onSetActiveAction: (action: string | null) => void;
  refreshAfterAction: () => Promise<void>;
  workspacePath: string;
}

export function useGitStashActions({
  onSetActiveAction,
  refreshAfterAction,
  workspacePath,
}: UseGitStashActionsParams) {
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [stashError, setStashError] = useState<string | null>(null);
  const [stashMessage, setStashMessage] = useState('');

  const handleStash = async () => {
    onSetActiveAction('stash');
    setStashError(null);

    try {
      const result = await window.electronAPI.gitStash(workspacePath, stashMessage, includeUntracked);

      if (result.success) {
        setStashMessage('');
        await refreshAfterAction();
      } else {
        setStashError(result.error || 'Failed to stash changes');
      }
    } catch (error: unknown) {
      setStashError(error instanceof Error ? error.message : 'Failed to stash changes');
    } finally {
      onSetActiveAction(null);
    }
  };

  const handleApplyStash = async (stashRef: string) => {
    onSetActiveAction(`apply:${stashRef}`);
    setStashError(null);

    try {
      const result = await window.electronAPI.gitApplyStash(workspacePath, stashRef);
      if (result.success) {
        await refreshAfterAction();
      } else {
        setStashError(result.error || 'Failed to apply stash');
      }
    } catch (error: unknown) {
      setStashError(error instanceof Error ? error.message : 'Failed to apply stash');
    } finally {
      onSetActiveAction(null);
    }
  };

  const handlePopStash = async (stashRef: string) => {
    onSetActiveAction(`pop:${stashRef}`);
    setStashError(null);

    try {
      const result = await window.electronAPI.gitPopStash(workspacePath, stashRef);
      if (result.success) {
        await refreshAfterAction();
      } else {
        setStashError(result.error || 'Failed to pop stash');
      }
    } catch (error: unknown) {
      setStashError(error instanceof Error ? error.message : 'Failed to pop stash');
    } finally {
      onSetActiveAction(null);
    }
  };

  const handleDropStash = async (stashRef: string) => {
    if (!window.confirm(`Drop ${stashRef}? This cannot be undone.`)) {
      return;
    }

    onSetActiveAction(`drop:${stashRef}`);
    setStashError(null);

    try {
      const result = await window.electronAPI.gitDropStash(workspacePath, stashRef);
      if (result.success) {
        await refreshAfterAction();
      } else {
        setStashError(result.error || 'Failed to drop stash');
      }
    } catch (error: unknown) {
      setStashError(error instanceof Error ? error.message : 'Failed to drop stash');
    } finally {
      onSetActiveAction(null);
    }
  };

  const handleClearStashes = async () => {
    if (!window.confirm('Clear all stashes? This cannot be undone.')) {
      return;
    }

    onSetActiveAction('clear-stashes');
    setStashError(null);

    try {
      const result = await window.electronAPI.gitClearStashes(workspacePath);
      if (result.success) {
        await refreshAfterAction();
      } else {
        setStashError(result.error || 'Failed to clear stashes');
      }
    } catch (error: unknown) {
      setStashError(error instanceof Error ? error.message : 'Failed to clear stashes');
    } finally {
      onSetActiveAction(null);
    }
  };

  return {
    handleApplyStash,
    handleClearStashes,
    handleDropStash,
    handlePopStash,
    handleStash,
    includeUntracked,
    setIncludeUntracked,
    setStashError,
    setStashMessage,
    stashError,
    stashMessage,
  };
}
