import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { useEffect, useRef, useState } from 'react';

interface Props {
  workspaceId: string;
  workspacePath: string;
  launchReady: boolean;
  onBusyChange: (busy: boolean) => void;
  onOpenPath: (path: string) => void;
}

/** Keyed by registered source identity so drafts and late results cannot cross hosts. */
export default function RemoteWorktreeCreate({ workspaceId, workspacePath, launchReady, onBusyChange, onOpenPath }: Props) {
  const [base, setBase] = useState('HEAD');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const create = async () => {
    if (inFlight.current || !launchReady || !branch.trim()) return;
    inFlight.current = true;
    setBusy(true); onBusyChange(true); setError('');
    try {
      const result = await window.electronAPI.gitCreateWorktree(workspacePath, base, branch, workspaceId);
      if (!mounted.current) return;
      if (!result.success || !result.worktree) setError(result.error || 'Could not create remote worktree');
      else onOpenPath(result.worktree.path);
    } catch (cause: unknown) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not create remote worktree');
    } finally {
      inFlight.current = false;
      onBusyChange(false);
      if (mounted.current) setBusy(false);
    }
  };

  return <div className="gate-worktree-create">
    <label htmlFor="remote-worktree-base">Base ref</label>
    <Input id="remote-worktree-base" value={base} onChange={(event) => setBase(event.target.value)} disabled={busy} placeholder="HEAD, branch, tag, or commit" />
    <label htmlFor="remote-worktree-branch">Worktree branch</label>
    <Input id="remote-worktree-branch" value={branch} onChange={(event) => setBranch(event.target.value)} disabled={busy} placeholder="task/my-change" />
    <Button type="button" disabled={busy || !launchReady || !branch.trim()} onClick={() => void create()}>{busy ? 'Creating remote worktree…' : 'Create and open worktree'}</Button>
    <p>The checkout is created beside the repository in its worktrees folder. An existing branch keeps its current commit.</p>
    {error && <p role="alert" className="gate-worktree-error">{error}</p>}
  </div>;
}
