import { useState } from 'react';
import type { DeleteDialogState } from './gitButtonTypes';

interface UseGitBranchActionsParams {
  activeAction: string | null;
  currentBranch: string | null;
  onSetActiveAction: (action: string | null) => void;
  refreshAfterAction: () => Promise<void>;
  workspacePath: string;
}

export function useGitBranchActions({
  activeAction,
  currentBranch,
  onSetActiveAction,
  refreshAfterAction,
  workspacePath,
}: UseGitBranchActionsParams) {
  const [branchError, setBranchError] = useState<string | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [newBranchName, setNewBranchName] = useState('');

  const handleCreateBranch = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!newBranchName.trim()) {
      setBranchError('Enter a branch name');
      return;
    }

    onSetActiveAction('create');
    setBranchError(null);

    try {
      const result = await window.electronAPI.gitCreateBranch(
        workspacePath,
        newBranchName,
        currentBranch ?? undefined
      );

      if (result.success) {
        setNewBranchName('');
        await refreshAfterAction();
      } else {
        setBranchError(result.error || 'Failed to create branch');
      }
    } catch (error: unknown) {
      setBranchError(error instanceof Error ? error.message : 'Failed to create branch');
    } finally {
      onSetActiveAction(null);
    }
  };

  const handleSwitchBranch = async (branchName: string) => {
    onSetActiveAction(`switch:${branchName}`);
    setBranchError(null);

    try {
      const result = await window.electronAPI.gitSwitchBranch(workspacePath, branchName);
      if (result.success) {
        await refreshAfterAction();
      } else {
        setBranchError(result.error || 'Failed to switch branch');
      }
    } catch (error: unknown) {
      setBranchError(error instanceof Error ? error.message : 'Failed to switch branch');
    } finally {
      onSetActiveAction(null);
    }
  };

  const handleDeleteBranch = (branchName: string) => {
    setBranchError(null);
    setDeleteDialog({ branch: branchName, stage: 'confirm' });
  };

  const closeDeleteDialog = () => {
    if (activeAction) {
      return;
    }

    setDeleteDialog(null);
  };

  const performDeleteBranch = async (forceDelete = false) => {
    if (!workspacePath || !deleteDialog) {
      return;
    }

    const branchName = deleteDialog.branch;
    const actionKey = forceDelete ? `force-delete:${branchName}` : `delete:${branchName}`;
    onSetActiveAction(actionKey);
    setBranchError(null);

    try {
      const result = forceDelete
        ? await window.electronAPI.gitForceDeleteBranch(workspacePath, branchName)
        : await window.electronAPI.gitDeleteBranch(workspacePath, branchName);

      if (result.success) {
        setDeleteDialog(null);
        await refreshAfterAction();
        return;
      }

      if (!forceDelete && result.blockedByUnmergedCommits) {
        setDeleteDialog({
          branch: branchName,
          stage: 'force',
          detail: result.error,
        });
        return;
      }

      setDeleteDialog(null);
      setBranchError(result.error || 'Failed to delete branch');
    } catch (error: unknown) {
      setDeleteDialog(null);
      setBranchError(error instanceof Error ? error.message : 'Failed to delete branch');
    } finally {
      onSetActiveAction(null);
    }
  };

  return {
    branchError,
    closeDeleteDialog,
    deleteDialog,
    handleCreateBranch,
    handleDeleteBranch,
    handleSwitchBranch,
    newBranchName,
    performDeleteBranch,
    setBranchError,
    setNewBranchName,
  };
}
