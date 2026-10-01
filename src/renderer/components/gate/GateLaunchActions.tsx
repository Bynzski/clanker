import { GitBranch, Loader2, Play } from 'lucide-react';
import { Button } from '../ui/Button';

interface GateLaunchActionsProps {
  opening?: boolean;
  showWorktree?: boolean;
  launchDisabled: boolean;
  worktreeDisabled: boolean;
  worktreeTitle: string;
  onLaunch: () => void;
  onWorktree: () => void;
}

export function GateLaunchActions({ showWorktree = true, opening = false, launchDisabled, worktreeDisabled, worktreeTitle, onLaunch, onWorktree }: GateLaunchActionsProps) {
  return (
    <div className="gate-launch-actions">
      <Button variant="primary" className="gate-button" onClick={onLaunch} disabled={launchDisabled || opening} aria-busy={opening}>
        {opening ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Play size={14} strokeWidth={2.5} fill="currentColor" aria-hidden="true" />}
        <span aria-live="polite">{opening ? 'Opening workspace…' : 'Launch Workspace'}</span>
      </Button>
      {showWorktree && <GateWorktreeAction worktreeDisabled={worktreeDisabled} worktreeTitle={worktreeTitle} onWorktree={onWorktree} />}
    </div>
  );
}


export function GateWorktreeAction({ worktreeDisabled, worktreeTitle, onWorktree }: Pick<GateLaunchActionsProps, 'worktreeDisabled' | 'worktreeTitle' | 'onWorktree'>) {
  return (
      <Button variant="secondary" className="gate-worktree-forward" aria-label="Worktree options"
        disabled={worktreeDisabled} title={worktreeTitle} onClick={onWorktree}>
        <GitBranch size={13} strokeWidth={2} />
        <span>Worktree</span>
      </Button>
  );
}
