import { Loader2 } from 'lucide-react';
import type { GitRemoteEntry } from './GitRemotesSection';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '../ui/AlertDialog';
import { Button } from '../ui/Button';

interface GitRemoveRemoteDialogProps {
  remote: GitRemoteEntry;
  isBusy: boolean;
  onCancel: () => void;
  onConfirmRemove: () => void;
  workspaceId?: string;
}

export function GitRemoveRemoteDialog({
  remote,
  isBusy,
  onCancel,
  onConfirmRemove,
  workspaceId,
}: GitRemoveRemoteDialogProps) {
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !isBusy) onCancel(); }}>
      <AlertDialogContent
        className="git-remote-dialog clanker-dialog-content"
        overlayClassName="git-remote-overlay"
        workspaceId={workspaceId}
        onBackdropCancel={isBusy ? undefined : onCancel}
        onEscapeKeyDown={(event) => {
          if (isBusy) event.preventDefault();
        }}
      >
        <div className="clanker-dialog-header">
          <AlertDialogTitle asChild>
            <h3 className="clanker-dialog-title">Remove remote '{remote.name}'?</h3>
          </AlertDialogTitle>
        </div>
        <div className="clanker-dialog-body">
          <AlertDialogDescription asChild>
            <div>
              <p>
                Are you sure you want to remove the remote <strong>{remote.name}</strong>?
              </p>
              <p className="git-remote-dialog-url" title={remote.fetchUrl}>
                Fetch URL: {remote.fetchUrl}
              </p>
              {remote.pushUrl && remote.pushUrl !== remote.fetchUrl && (
                <p className="git-remote-dialog-url" title={remote.pushUrl}>
                  Push URL: {remote.pushUrl}
                </p>
              )}
              <p className="git-remote-dialog-warning">
                This removes the remote configuration and remote-tracking branches from this local repository. Commits on the remote server remain unaffected.
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
          <Button size="sm" variant="danger" onClick={onConfirmRemove} disabled={isBusy}>
            {isBusy && <Loader2 size={13} className="spin" />}
            Remove remote
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
