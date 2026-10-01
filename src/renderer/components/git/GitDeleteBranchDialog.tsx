import { Loader2 } from 'lucide-react';
import type { DeleteDialogState } from './gitButtonTypes';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '../ui/AlertDialog';
import { Button } from '../ui/Button';

interface GitDeleteBranchDialogProps {
  currentBranch: string | null;
  deleteDialog: DeleteDialogState;
  isBusy: boolean;
  onCancel: () => void;
  onConfirmDelete: (forceDelete: boolean) => void;
  workspaceId?: string;
}

export function GitDeleteBranchDialog({
  currentBranch,
  deleteDialog,
  isBusy,
  onCancel,
  onConfirmDelete,
  workspaceId,
}: GitDeleteBranchDialogProps) {
  const isForce = deleteDialog.stage === 'force';
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !isBusy) onCancel(); }}>
      <AlertDialogContent
        className="git-delete-dialog"
        overlayClassName="git-delete-overlay"
        workspaceId={workspaceId}
        onBackdropCancel={isBusy ? undefined : onCancel}
        onEscapeKeyDown={(event) => {
          if (isBusy) event.preventDefault();
        }}
      >
        <div className="git-delete-dialog-header">
          <AlertDialogTitle asChild>
            <p className="git-delete-dialog-title">
              {isForce ? 'Force delete branch' : 'Delete branch'}
            </p>
          </AlertDialogTitle>
          <span className="git-delete-dialog-branch">{deleteDialog.branch}</span>
        </div>
        <AlertDialogDescription asChild>
          <p className="git-delete-dialog-body">
            {isForce
              ? `This branch has commits that are not merged into ${currentBranch ?? 'the current branch'}. Deleting it now may permanently discard work.`
              : 'Removing a branch simply deletes the reference; commits remain reachable from other branches or remotes if they exist elsewhere.'}
          </p>
        </AlertDialogDescription>
        {deleteDialog.detail && (
          <div className="git-delete-detail">
            <span>Git message</span>
            <p>{deleteDialog.detail}</p>
          </div>
        )}
        <div className="git-delete-actions">
          <AlertDialogCancel asChild>
            <Button
              size="sm"
              variant="secondary"
              className="git-delete-cancel"
              disabled={isBusy}
            >
              Cancel
            </Button>
          </AlertDialogCancel>
          <Button
            size="sm"
            variant={isForce ? 'danger' : 'primary'}
            onClick={() => onConfirmDelete(isForce)}
            disabled={isBusy}
          >
            {isBusy && <Loader2 size={13} className="spin" />}
            {isForce ? 'Force Delete' : 'Delete branch'}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
