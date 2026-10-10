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
  const [clearDialog, setClearDialog] = useState(false);

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

  const handleApplyStash = async (stashRef: string) => {
    if (!canAct()) return;
    pending.current = true;
    onSetActiveAction(`apply:${stashRef}`);
    setStashError(null);

    try {
      const result = await window.electronAPI.gitApplyStash(workspacePath, stashRef, workspaceId);
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

  const handlePopStash = async (stashRef: string) => {
    if (!canAct()) return;
    pending.current = true;
    onSetActiveAction(`pop:${stashRef}`);
    setStashError(null);

    try {
      const result = await window.electronAPI.gitPopStash(workspacePath, stashRef, workspaceId);
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

  const handleDropStash = (stashOrRef: GitStash | string) => {
    if (!canAct()) return;
    const target = typeof stashOrRef === 'string'
      ? stashes.find((s) => s.ref === stashOrRef) ?? { ref: stashOrRef, hash: '', message: '' }
      : stashOrRef;
    setStashError(null);
    setDropDialog(target);
  };

  const closeDropDialog = () => {
    if (pending.current) return;
    setDropDialog(null);
  };

  const performDropStash = async () => {
    if (!canAct() || !dropDialog) return;
    const target = dropDialog;
    pending.current = true;
    onSetActiveAction(`drop:${target.ref}`);
    setStashError(null);

    try {
      // Re-verify stash identity: avoid dropping the wrong stash if positional references shifted!
      const latestStashes = await window.electronAPI.gitGetStashes(workspacePath, workspaceId);
      if (!isCurrent()) return;

      const matching = latestStashes.find((s) => s.ref === target.ref);
      if (!matching || (target.hash && matching.hash !== target.hash)) {
        setStashError('Stash reference changed. The operation was cancelled to avoid dropping a different stash.');
        setDropDialog(null);
        return;
      }

      const result = await window.electronAPI.gitDropStash(workspacePath, target.ref, workspaceId);
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
    setStashError(null);
    setClearDialog(true);
  };

  const closeClearDialog = () => {
    if (pending.current) return;
    setClearDialog(false);
  };

  const performClearStashes = async () => {
    if (!canAct()) return;
    pending.current = true;
    onSetActiveAction('clear-stashes');
    setStashError(null);

    try {
      const result = await window.electronAPI.gitClearStashes(workspacePath, workspaceId);
      if (!isCurrent()) return;

      if (result.success) {
        setClearDialog(false);
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
