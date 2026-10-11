import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '../ui/AlertDialog';
import { Button } from '../ui/Button';

interface GitAbortOperationDialogProps {
  mode: 'merge' | 'rebase';
  conflicts: string[];
  isBusy: boolean;
  onCancel: () => void;
  onConfirmAbort: () => void;
  workspaceId?: string;
}

export function GitAbortOperationDialog({
  mode,
  conflicts,
  isBusy,
  onCancel,
  onConfirmAbort,
  workspaceId,
}: GitAbortOperationDialogProps) {
  const isRebase = mode === 'rebase';
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !isBusy) onCancel(); }}>
      <AlertDialogContent
        className="git-abort-dialog clanker-dialog-content"
        overlayClassName="git-abort-overlay"
        workspaceId={workspaceId}
        onBackdropCancel={isBusy ? undefined : onCancel}
        onEscapeKeyDown={(event) => {
          if (isBusy) event.preventDefault();
        }}
      >
        <div className="clanker-dialog-header">
          <AlertDialogTitle asChild>
            <h3 className="clanker-dialog-title">Abort {isRebase ? 'rebase' : 'merge'}?</h3>
          </AlertDialogTitle>
        </div>
        <div className="clanker-dialog-body">
          <AlertDialogDescription asChild>
            <div>
              <p>
                Are you sure you want to abort the in-progress {isRebase ? 'rebase' : 'merge'}?
              </p>
              {conflicts.length > 0 && (
                <div className="git-abort-conflicts">
                  <p>Unresolved conflicts in {conflicts.length} {conflicts.length === 1 ? 'file' : 'files'}:</p>
                  <ul className="git-abort-conflict-list">
                    {conflicts.slice(0, 5).map((file) => (
                      <li key={file} className="git-abort-conflict-item">{file}</li>
                    ))}
                    {conflicts.length > 5 && (
                      <li className="git-abort-conflict-more">and {conflicts.length - 5} more…</li>
                    )}
                  </ul>
                </div>
              )}
              <p className="git-abort-dialog-warning">
                Aborting will discard all uncommitted conflict-resolution changes and return the working tree to the state before the operation started.
              </p>
            </div>
          </AlertDialogDescription>
        </div>
        <div className="clanker-dialog-footer">
          <AlertDialogCancel asChild>
            <Button size="sm" variant="secondary" disabled={isBusy}>
              Cancel
            </Button>
          </AlertDialogCancel>
          <Button size="sm" variant="danger" onClick={onConfirmAbort} disabled={isBusy}>
            {isBusy && <Loader2 size={13} className="spin" />}
            Abort {isRebase ? 'rebase' : 'merge'}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
