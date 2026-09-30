import { GitBranch, Play } from 'lucide-react';
import { Button } from '../ui/Button';

interface GateLaunchActionsProps {
  launchDisabled: boolean;
  worktreeDisabled: boolean;
  worktreeTitle: string;
  onLaunch: () => void;
  onWorktree: () => void;
}

export function GateLaunchActions({ launchDisabled, worktreeDisabled, worktreeTitle, onLaunch, onWorktree }: GateLaunchActionsProps) {
  return (
    <div className="gate-launch-actions">
      <Button variant="primary" className="gate-button" onClick={onLaunch} disabled={launchDisabled}>
        <Play size={14} strokeWidth={2.5} fill="currentColor" />
        Launch Workspace
      </Button>
      <Button variant="secondary" className="gate-worktree-forward" aria-label="Worktree options"
        disabled={worktreeDisabled} title={worktreeTitle} onClick={onWorktree}>
        <GitBranch size={13} strokeWidth={2} />
        <span>Worktree</span>
      </Button>
    </div>
  );
}
