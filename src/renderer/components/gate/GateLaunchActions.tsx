import { Loader2, Play } from 'lucide-react';
import { Button } from '../ui/Button';

interface GateLaunchActionsProps {
  opening?: boolean;
  launchDisabled: boolean;
  onLaunch: () => void;
}

/**
 * The launcher has one way to open a project. Isolated worktrees are created later, from an open
 * workspace (New isolated agent), so they stay inside the workspace instead of becoming another one.
 */
export function GateLaunchActions({ opening = false, launchDisabled, onLaunch }: GateLaunchActionsProps) {
  return (
    <div className="gate-launch-actions">
      <Button variant="primary" className="gate-button" onClick={onLaunch} disabled={launchDisabled || opening} aria-busy={opening}>
        {opening ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Play size={14} strokeWidth={2.5} fill="currentColor" aria-hidden="true" />}
        <span aria-live="polite">{opening ? 'Opening workspace…' : 'Launch Workspace'}</span>
      </Button>
    </div>
  );
}
