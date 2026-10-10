import { useRef, useState } from 'react';
import type { GitOperationState } from './types';

interface UseGitMergeActionsParams {
  isCurrent?: () => boolean;
  activeAction?: string | null;
  onSetActiveAction: (action: string | null) => void;
  refreshAfterAction: () => Promise<void>;
  workspacePath: string;
  workspaceId?: string;
  operationState?: GitOperationState | null;
}

export function useGitMergeActions({
  isCurrent = () => true,
  activeAction,
  onSetActiveAction,
  refreshAfterAction,
  workspacePath,
  workspaceId,
  operationState = null,
}: UseGitMergeActionsParams) {
  const pending = useRef(false);
  const canAct = () => isCurrent() && !pending.current && !activeAction;
  const [mergeTargetBranch, setMergeTargetBranch] = useState('');
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [abortDialog, setAbortDialog] = useState<{ mode: 'merge' | 'rebase'; conflicts: string[] } | null>(null);

  const handleMergeBranch = async () => {
    if (!canAct()) return;
    if (!operationState) {
      setMergeError('Cannot merge: repository operation state is unknown. Refresh to inspect.');
      return;
    }
    if (!operationState.success) {
      setMergeError(operationState.message || operationState.error || 'Cannot merge: operation state discovery failed.');
      return;
    }
    if (operationState.inProgress) {
      setMergeError(`Cannot merge: a ${operationState.mode === 'rebase' ? 'rebase' : 'merge'} is already in progress.`);
      return;
    }
    if (!mergeTargetBranch) {
      setMergeError('Select a branch to merge');
      return;
    }

    pending.current = true;
    onSetActiveAction(`merge:${mergeTargetBranch}`);
    setMergeError(null);

    try {
      const result = await window.electronAPI.gitMergeBranch(workspacePath, mergeTargetBranch, workspaceId);
      if (!isCurrent()) return;

      if (result.success) {
        await refreshAfterAction();
      } else {
        setMergeError(result.error || 'Failed to merge branch');
      }
    } catch (error: unknown) {
      if (isCurrent()) setMergeError(error instanceof Error ? error.message : 'Failed to merge branch');
    } finally {
      pending.current = false;
      if (isCurrent()) onSetActiveAction(null);
    }
  };

  const handleRequestAbort = (mode: 'merge' | 'rebase' = 'merge', conflicts: string[] = []) => {
    if (!canAct()) return;
    if (!operationState) {
      setMergeError('Cannot abort: repository operation state is unknown. Refresh to inspect.');
      return;
    }
    if (!operationState.success || !operationState.inProgress) {
      setMergeError('Cannot abort: no merge or rebase operation is confirmed in progress.');
      return;
    }
    setMergeError(null);
    setAbortDialog({ mode, conflicts });
  };

  const closeAbortDialog = () => {
    if (pending.current) return;
    setAbortDialog(null);
  };

  const performAbortOperation = async () => {
    if (!canAct() || !abortDialog) return;
    if (!operationState || !operationState.success || !operationState.inProgress) {
      setMergeError('Cannot abort: no merge or rebase operation is confirmed in progress.');
      closeAbortDialog();
      return;
    }
    pending.current = true;
    onSetActiveAction('abort-operation');
    setMergeError(null);

    try {
      const result = await window.electronAPI.gitAbortOperation(workspacePath, workspaceId);
      if (!isCurrent()) return;

      if (result.success) {
        setAbortDialog(null);
        await refreshAfterAction();
      } else {
        setMergeError(result.error || 'Failed to abort operation');
      }
    } catch (error: unknown) {
      if (isCurrent()) setMergeError(error instanceof Error ? error.message : 'Failed to abort operation');
    } finally {
      pending.current = false;
      if (isCurrent()) onSetActiveAction(null);
    }
  };

  return {
    abortDialog,
    closeAbortDialog,
    handleMergeBranch,
    handleRequestAbort,
    mergeError,
    mergeTargetBranch,
    performAbortOperation,
    setMergeError,
    setMergeTargetBranch,
  };
}
