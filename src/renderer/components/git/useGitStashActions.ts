import { useRef, useState } from 'react';
import type { GitStash } from './types';

interface UseGitStashActionsParams {
  isCurrent?: () => boolean;
  activeAction?: string | null;
  onSetActiveAction: (action: string | null) => void;
  refreshAfterAction: () => Promise<void>;
  workspacePath: string;
  workspaceId?: string;
  stashes?: GitStash[];
}

export function useGitStashActions({
  isCurrent = () => true,
  activeAction,
  onSetActiveAction,
  refreshAfterAction,
  workspacePath,
  workspaceId,
  stashes = [],
}: UseGitStashActionsParams) {
  const pending = useRef(false);
  const canAct = () => isCurrent() && !pending.current && !activeAction;
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [stashError, setStashError] = useState<string | null>(null);
  const [stashMessage, setStashMessage] = useState('');
  const [dropDialog, setDropDialog] = useState<GitStash | null>(null);
  const [clearDialog, setClearDialog] = useState<{ count: number; hashes: string[] } | null>(null);

  const handleStash = async () => {
    if (!canAct()) return;
    pending.current = true;
    onSetActiveAction('stash');
    setStashError(null);

    try {
      const result = await window.electronAPI.gitStash(workspacePath, stashMessage, includeUntracked, workspaceId);
      if (!isCurrent()) return;

      if (result.success) {
        setStashMessage('');
        await refreshAfterAction();
      } else {
        setStashError(result.error || 'Failed to stash changes');
      }
    } catch (error: unknown) {
      if (isCurrent()) setStashError(error instanceof Error ? error.message : 'Failed to stash changes');
    } finally {
      pending.current = false;
      if (isCurrent()) onSetActiveAction(null);
    }
  };

  const handleApplyStash = async (stash: GitStash) => {
    if (!canAct()) return;
    if (!stash || !stash.hash || typeof stash.hash !== 'string' || !stash.hash.trim()) {
      setStashError('Cannot apply stash without verified commit identity');
      return;
    }
    pending.current = true;
    onSetActiveAction(`apply:${stash.ref}`);
    setStashError(null);

    try {
      const result = await window.electronAPI.gitApplyStash(workspacePath, stash.ref, stash.hash.trim(), workspaceId);
      if (!isCurrent()) return;

      if (result.success) {
        await refreshAfterAction();
      } else {
        setStashError(result.error || 'Failed to apply stash');
      }
    } catch (error: unknown) {
      if (isCurrent()) setStashError(error instanceof Error ? error.message : 'Failed to apply stash');
    } finally {
      pending.current = false;
      if (isCurrent()) onSetActiveAction(null);
    }
  };

  const handlePopStash = async (stash: GitStash) => {
    if (!canAct()) return;
    if (!stash || !stash.hash || typeof stash.hash !== 'string' || !stash.hash.trim()) {
      setStashError('Cannot pop stash without verified commit identity');
      return;
    }
    pending.current = true;
    onSetActiveAction(`pop:${stash.ref}`);
    setStashError(null);

    try {
      const result = await window.electronAPI.gitPopStash(workspacePath, stash.ref, stash.hash.trim(), workspaceId);
      if (!isCurrent()) return;

      if (result.success) {
        await refreshAfterAction();
      } else {
        setStashError(result.error || 'Failed to pop stash');
      }
    } catch (error: unknown) {
      if (isCurrent()) setStashError(error instanceof Error ? error.message : 'Failed to pop stash');
    } finally {
      pending.current = false;
      if (isCurrent()) onSetActiveAction(null);
    }
  };

  const handleDropStash = (stash: GitStash) => {
    if (!canAct()) return;
    if (!stash || !stash.hash || typeof stash.hash !== 'string' || !stash.hash.trim()) {
      setStashError('Cannot drop stash without verified commit identity');
      return;
    }
    setStashError(null);
    setDropDialog(stash);
  };

  const closeDropDialog = () => {
    if (pending.current) return;
    setDropDialog(null);
  };

  const performDropStash = async () => {
    if (!canAct() || !dropDialog) return;
    const target = dropDialog;
    if (!target.hash || !target.hash.trim()) {
      setStashError('Cannot drop stash without verified commit identity');
      setDropDialog(null);
      return;
    }
    pending.current = true;
    onSetActiveAction(`drop:${target.ref}`);
    setStashError(null);

    try {
      const result = await window.electronAPI.gitDropStash(workspacePath, target.ref, target.hash.trim(), workspaceId);
      if (!isCurrent()) return;

      if (result.success) {
        setDropDialog(null);
        await refreshAfterAction();
      } else {
        setStashError(result.error || 'Failed to drop stash');
      }
    } catch (error: unknown) {
      if (isCurrent()) setStashError(error instanceof Error ? error.message : 'Failed to drop stash');
    } finally {
      pending.current = false;
      if (isCurrent()) onSetActiveAction(null);
    }
  };

  const handleClearStashes = () => {
    if (!canAct()) return;
    if (stashes.length === 0) return;
    setStashError(null);
    setClearDialog({
      count: stashes.length,
      hashes: stashes.map((s) => s.hash).filter(Boolean),
    });
  };

  const closeClearDialog = () => {
    if (pending.current) return;
    setClearDialog(null);
  };

  const performClearStashes = async () => {
    if (!canAct() || !clearDialog) return;
    const expectedHashes = clearDialog.hashes;
    pending.current = true;
    onSetActiveAction('clear-stashes');
    setStashError(null);

    try {
      const result = await window.electronAPI.gitClearStashes(workspacePath, expectedHashes, workspaceId);
      if (!isCurrent()) return;

      if (result.success) {
        setClearDialog(null);
        await refreshAfterAction();
      } else {
        setStashError(result.error || 'Failed to clear stashes');
      }
    } catch (error: unknown) {
      if (isCurrent()) setStashError(error instanceof Error ? error.message : 'Failed to clear stashes');
    } finally {
      pending.current = false;
      if (isCurrent()) onSetActiveAction(null);
    }
  };

  return {
    clearDialog,
    closeClearDialog,
    closeDropDialog,
    dropDialog,
    handleApplyStash,
    handleClearStashes,
    handleDropStash,
    handlePopStash,
    handleStash,
    includeUntracked,
    performClearStashes,
    performDropStash,
    setIncludeUntracked,
    setStashError,
    setStashMessage,
    stashError,
    stashMessage,
  };
}
