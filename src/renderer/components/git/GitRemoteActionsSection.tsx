import { Button } from '../ui/Button';
import { Download, Upload } from 'lucide-react';
import type { RemoteAction } from './gitButtonTypes';

interface GitRemoteActionsSectionProps {
  currentBranch: string | null;
  hasRemotes: boolean;
  isBusy: boolean;
  onFetch: () => void;
  onPublish: () => void;
  onPull: () => void;
  onPush: () => void;
  remoteAction: RemoteAction;
  upstream: string | null;
}

export function GitRemoteActionsSection({
  currentBranch,
  hasRemotes,
  isBusy,
  onFetch,
  onPublish,
  onPull,
  onPush,
  remoteAction,
  upstream,
}: GitRemoteActionsSectionProps) {
  return (
    <div className="git-menu-section">
      <div className="git-menu-section-header">
        <span>Remote</span>
      </div>
      <div className="git-menu-remote-actions">
        <Button
          size="xs"
          type="button"
          className="header-btn git-menu-action"
          onClick={onFetch}
          disabled={isBusy || remoteAction !== null}
        >
          <Download size={13} className={remoteAction === 'fetch' ? 'spin' : ''} />
          {remoteAction === 'fetch' ? 'Fetching…' : 'Fetch'}
        </Button>
        <Button
          size="xs"
          type="button"
          className="header-btn git-menu-action"
          onClick={onPull}
          disabled={isBusy || remoteAction !== null || !upstream}
          title={!upstream ? 'Set an upstream branch to enable pull' : undefined}
        >
          <Download size={13} className={remoteAction === 'pull' ? 'spin' : ''} />
          {remoteAction === 'pull' ? 'Pulling…' : 'Pull'}
        </Button>
        {!upstream && currentBranch && (
          <Button
            size="xs"
            type="button"
            className="header-btn git-menu-action"
            onClick={onPublish}
            disabled={isBusy || remoteAction !== null || !hasRemotes}
            title={!hasRemotes ? 'Add a remote to publish this branch' : undefined}
          >
            <Upload size={13} className={remoteAction === 'publish' ? 'spin' : ''} />
            {remoteAction === 'publish' ? 'Publishing…' : 'Publish branch'}
          </Button>
        )}
        <Button
          size="xs"
          type="button"
          className="header-btn git-menu-action"
          onClick={onPush}
          disabled={isBusy || remoteAction !== null || !upstream}
          title={!upstream ? 'Set an upstream branch to enable push' : undefined}
        >
          <Upload size={13} className={remoteAction === 'push' ? 'spin' : ''} />
          {remoteAction === 'push' ? 'Pushing…' : 'Push'}
        </Button>
      </div>
    </div>
  );
}
