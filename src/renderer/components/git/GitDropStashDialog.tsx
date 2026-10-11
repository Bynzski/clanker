import { Loader2 } from 'lucide-react';
import type { GitStash } from './types';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '../ui/AlertDialog';
import { Button } from '../ui/Button';

interface GitDropStashDialogProps {
  stash: GitStash;
  isBusy: boolean;
  onCancel: () => void;
  onConfirmDrop: () => void;
  workspaceId?: string;
}

export function GitDropStashDialog({
  stash,
  isBusy,
  onCancel,
  onConfirmDrop,
  workspaceId,
}: GitDropStashDialogProps) {
  const shortHash = stash.hash ? stash.hash.slice(0, 7) : null;
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
            <h3 className="clanker-dialog-title">Drop {stash.ref}?</h3>
          </AlertDialogTitle>
        </div>
        <div className="clanker-dialog-body">
          <AlertDialogDescription asChild>
            <div>
              <p>
                Permanently delete stash <strong>{stash.ref}</strong>{shortHash ? ` (${shortHash})` : ''}?
              </p>
              {stash.message && (
                <p className="git-stash-dialog-message">
                  {stash.message}
                </p>
              )}
              <p className="git-stash-dialog-warning">
                This action cannot be undone. Stashed changes will be permanently discarded.
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
          <Button size="sm" variant="danger" onClick={onConfirmDrop} disabled={isBusy}>
            {isBusy && <Loader2 size={13} className="spin" />}
            Drop stash
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
