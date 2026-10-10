import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '../ui/AlertDialog';
import { Button } from '../ui/Button';

interface GitClearStashesDialogProps {
  stashCount: number;
  isBusy: boolean;
  onCancel: () => void;
  onConfirmClear: () => void;
  workspaceId?: string;
}

export function GitClearStashesDialog({
  stashCount,
  isBusy,
  onCancel,
  onConfirmClear,
  workspaceId,
}: GitClearStashesDialogProps) {
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !isBusy) onCancel(); }}>
      <AlertDialogContent
        className="git-stash-dialog clanker-dialog-content"
        overlayClassName="git-stash-overlay"
        workspaceId={workspaceId}
        onBackdropCancel={isBusy ? undefined : onCancel}
        onEscapeKeyDown={(event) => {
          if (isBusy) event.preventDefault();
        }}
      >
        <div className="clanker-dialog-header">
          <AlertDialogTitle asChild>
            <h3 className="clanker-dialog-title">Clear all stashes?</h3>
          </AlertDialogTitle>
        </div>
        <div className="clanker-dialog-body">
          <AlertDialogDescription asChild>
            <div>
              <p>
                Permanently delete all {stashCount} saved {stashCount === 1 ? 'stash' : 'stashes'} in this repository?
              </p>
              <p className="git-stash-dialog-warning">
                This deletes the entire stash collection. This action cannot be undone.
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
          <Button size="sm" variant="danger" onClick={onConfirmClear} disabled={isBusy}>
            {isBusy && <Loader2 size={13} className="spin" />}
            Clear all stashes
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
