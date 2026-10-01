import { Button } from './ui/Button';
import { useEffect, useRef, useState } from 'react';
import type { GitWorktree, GitWorktreeRemoveResult } from '../../shared/types/git';

interface Props {
  workspaceId: string;
  workspacePath: string;
  worktreePath: string;
  disabled: boolean;
  onBusyChange?: (busy: boolean) => void;
  onRemoved?: (result: GitWorktreeRemoveResult) => void;
}

export default function RemoteWorktreeInspect({ workspaceId, workspacePath, worktreePath, disabled, onBusyChange, onRemoved }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<GitWorktree | null>(null);
  const [removing, setRemoving] = useState(false);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const inspect = async (forRemoval = false) => {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy(true); setMessage(''); setError(''); setPendingRemoval(null);
    try {
      // Main derives active paths from registered workspaces and live terminals.
      const result = await window.electronAPI.gitInspectWorktree(workspacePath, worktreePath, [], workspaceId);
      if (!mounted.current) return;
      if (!result.success || !result.worktree || typeof result.hasChanges !== 'boolean') {
        setError(result.error || 'Could not inspect remote worktree');
      } else {
        setMessage(result.hasChanges ? 'Checkout has uncommitted, untracked, or ignored files.' : 'Checkout is clean.');
        if (forRemoval && !result.hasChanges) setPendingRemoval(result.worktree);
      }
    } catch (cause: unknown) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not inspect remote worktree');
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const remove = async () => {
    if (!pendingRemoval || inFlight.current || disabled) return;
    inFlight.current = true; setBusy(true); setRemoving(true); setError(''); onBusyChange?.(true);
    try {
      const result = await window.electronAPI.gitRemoveWorktree(workspacePath, pendingRemoval.path, pendingRemoval.branch, [], workspaceId);
      if (!mounted.current) return;
      setPendingRemoval(null); setMessage('');
      if (!result.success) setError(result.error || 'Could not remove remote worktree');
      else onRemoved?.(result);
    } catch (cause: unknown) {
      if (mounted.current) { setPendingRemoval(null); setError(cause instanceof Error ? cause.message : 'Could not remove remote worktree'); }
    } finally {
      inFlight.current = false; onBusyChange?.(false);
      if (mounted.current) { setBusy(false); setRemoving(false); }
    }
  };
  return <div className="remote-worktree-inspect">
    <Button type="button" disabled={busy || disabled} onClick={() => void inspect()} aria-label={`Inspect ${worktreePath}`}>{removing ? 'Removing…' : busy ? 'Inspecting…' : 'Inspect'}</Button>
    {onRemoved && <Button type="button" disabled={busy || disabled} onClick={() => void inspect(true)} aria-label={`Remove ${worktreePath}`}>Remove…</Button>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="gate-worktree-error">{error}</p>}
    {pendingRemoval && <div role="dialog" aria-label="Confirm remote worktree removal" className="gate-worktree-confirm">
      <p>Remove checkout at <strong>{pendingRemoval.path}</strong> on branch <strong>{pendingRemoval.branch || 'Detached'}</strong> from this SSH target? Files are moved to a recovery folder beside the checkout. The branch remains.</p>
      <Button type="button" onClick={() => setPendingRemoval(null)} disabled={busy}>Cancel</Button>
      <Button type="button" onClick={() => void remove()} disabled={busy || disabled}>Remove this worktree</Button>
    </div>}
  </div>;
}
