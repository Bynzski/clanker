import { Loader2 } from 'lucide-react';
import type { DeleteDialogState } from './gitButtonTypes';

interface GitDeleteBranchDialogProps {
  currentBranch: string | null;
  deleteDialog: DeleteDialogState;
  isBusy: boolean;
  onCancel: () => void;
  onConfirmDelete: (forceDelete: boolean) => void;
}

export function GitDeleteBranchDialog({
  currentBranch,
  deleteDialog,
  isBusy,
  onCancel,
  onConfirmDelete,
}: GitDeleteBranchDialogProps) {
  return (
    <div
      className="git-delete-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={
        deleteDialog.stage === 'force'
          ? `Force delete branch ${deleteDialog.branch}`
          : `Delete branch ${deleteDialog.branch}`
      }
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isBusy) {
          onCancel();
        }
      }}
    >
      <div className="git-delete-dialog">
        <div className="git-delete-dialog-header">
          <p className="git-delete-dialog-title">
            {deleteDialog.stage === 'force' ? 'Force delete branch' : 'Delete branch'}
          </p>
          <span className="git-delete-dialog-branch">{deleteDialog.branch}</span>
        </div>
        <p className="git-delete-dialog-body">
          {deleteDialog.stage === 'force'
            ? `This branch has commits that are not merged into ${currentBranch ?? 'the current branch'}. Deleting it now may permanently discard work.`
            : 'Removing a branch simply deletes the reference; commits remain reachable from other branches or remotes if they exist elsewhere.'}
        </p>
        {deleteDialog.detail && (
          <div className="git-delete-detail">
            <span>Git message</span>
            <p>{deleteDialog.detail}</p>
          </div>
        )}
        <div className="git-delete-actions">
          <button
            type="button"
            className="header-btn git-delete-cancel"
            onClick={onCancel}
            disabled={isBusy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`header-btn ${deleteDialog.stage === 'force' ? 'header-btn-danger' : 'header-btn-primary'}`}
            onClick={() => onConfirmDelete(deleteDialog.stage === 'force')}
            disabled={isBusy}
          >
            {isBusy && <Loader2 size={13} className="spin" />}
            {deleteDialog.stage === 'force' ? 'Force Delete' : 'Delete branch'}
          </button>
        </div>
      </div>
    </div>
  );
}
