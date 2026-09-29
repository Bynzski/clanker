import { useEffect, useRef, useState } from 'react';

interface Props {
  workspaceId: string;
  workspacePath: string;
  worktreePath: string;
  disabled: boolean;
}

export default function RemoteWorktreeInspect({ workspaceId, workspacePath, worktreePath, disabled }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const inspect = async () => {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy(true); setMessage(''); setError('');
    try {
      // Main derives active paths from registered workspaces and live terminals.
      const result = await window.electronAPI.gitInspectWorktree(workspacePath, worktreePath, [], workspaceId);
      if (!mounted.current) return;
      if (!result.success || !result.worktree || typeof result.hasChanges !== 'boolean') {
        setError(result.error || 'Could not inspect remote worktree');
      } else setMessage(result.hasChanges
        ? 'Checkout has uncommitted, untracked, or ignored files.'
        : 'Checkout is clean. Remote removal is not enabled.');
    } catch (cause: unknown) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not inspect remote worktree');
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return <div className="remote-worktree-inspect">
    <button type="button" disabled={busy || disabled} onClick={() => void inspect()} aria-label={`Inspect ${worktreePath}`}>{busy ? 'Inspecting…' : 'Inspect'}</button>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="gate-worktree-error">{error}</p>}
  </div>;
}
