import { useRef, useState } from 'react';
import type { DeleteDialogState } from './gitButtonTypes';

interface UseGitBranchActionsParams {
  isCurrent?: () => boolean;
  activeAction: string | null;
  currentBranch: string | null;
  onSetActiveAction: (action: string | null) => void;
  refreshAfterAction: () => Promise<void>;
  workspacePath: string;
  workspaceId?: string;
}

export function useGitBranchActions({
  isCurrent = () => true,
  activeAction,
  currentBranch,
  onSetActiveAction,
  refreshAfterAction,
  workspacePath,
  workspaceId,
}: UseGitBranchActionsParams) {
  const pending = useRef(false);
  const canAct = () => isCurrent() && !pending.current && !activeAction;
  const [branchError, setBranchError] = useState<string | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [newBranchName, setNewBranchName] = useState('');

  const handleCreateBranch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canAct()) return;
    if (!newBranchName.trim()) {
      setBranchError('Enter a branch name');
      return;
    }

    pending.current = true;
    onSetActiveAction('create');
    setBranchError(null);

    try {
      const result = await window.electronAPI.gitCreateBranch(
        workspacePath,
        newBranchName,
        currentBranch ?? undefined,
        workspaceId
      );
      if (!isCurrent()) return;
      if (result.success) {
        setNewBranchName('');
        await refreshAfterAction();
      } else {
        setBranchError(result.error || 'Failed to create branch');
      }
    } catch (error: unknown) {
      if (isCurrent()) setBranchError(error instanceof Error ? error.message : 'Failed to create branch');
    } finally {
      pending.current = false;
      if (isCurrent()) onSetActiveAction(null);
    }
  };

  const handleSwitchBranch = async (branchName: string) => {
    if (!canAct() || branchName === currentBranch) return;
    pending.current = true;
    onSetActiveAction(`switch:${branchName}`);
    setBranchError(null);

    try {
      const result = await window.electronAPI.gitSwitchBranch(workspacePath, branchName, workspaceId);
      if (!isCurrent()) return;
      if (result.success) {
        await refreshAfterAction();
      } else {
        setBranchError(result.error || 'Failed to switch branch');
      }
    } catch (error: unknown) {
      if (isCurrent()) setBranchError(error instanceof Error ? error.message : 'Failed to switch branch');
    } finally {
      pending.current = false;
      if (isCurrent()) onSetActiveAction(null);
    }
  };

  const handleDeleteBranch = (branchName: string) => {
    if (!canAct()) return;
    if (branchName === currentBranch) { setBranchError('The current branch cannot be deleted'); return; }
    setBranchError(null);
    setDeleteDialog({ branch: branchName, stage: 'confirm' });
  };

  const closeDeleteDialog = () => {
    if (activeAction || pending.current) {
      return;
    }

    setDeleteDialog(null);
  };

  const performDeleteBranch = async (forceDelete = false) => {
    if (!canAct() || !workspacePath || !deleteDialog || (forceDelete && deleteDialog.stage !== 'force')) {
      return;
    }

    const branchName = deleteDialog.branch;
    if (branchName === currentBranch) { setDeleteDialog(null); setBranchError('The current branch cannot be deleted'); return; }
    pending.current = true;
    const actionKey = forceDelete ? `force-delete:${branchName}` : `delete:${branchName}`;
    onSetActiveAction(actionKey);
    setBranchError(null);

    try {
      const result = forceDelete
        ? await window.electronAPI.gitForceDeleteBranch(workspacePath, branchName, workspaceId)
        : await window.electronAPI.gitDeleteBranch(workspacePath, branchName, workspaceId);
      if (!isCurrent()) return;
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
      if (isCurrent()) { setDeleteDialog(null); setBranchError(error instanceof Error ? error.message : 'Failed to delete branch'); }
    } finally {
      pending.current = false;
      if (isCurrent()) onSetActiveAction(null);
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
