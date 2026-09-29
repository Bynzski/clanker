import { useEffect, useState } from 'react';
import type { GitWorktree } from '../../shared/types/git';
import type { WorkspaceTab } from '../store/workspaceTypes';

interface Props {
  repositories: WorkspaceTab[];
  preferredWorkspaceId: string | null;
  onOpenPath: (path: string) => void;
  launchReady: boolean;
}

/** Discover from registered repositories; each selected checkout is registered separately on open. */
export default function RemoteWorktreePicker({ repositories, preferredWorkspaceId, onOpenPath, launchReady }: Props) {
  const [selectedId, setSelectedId] = useState(preferredWorkspaceId ?? '');
  const [result, setResult] = useState<{ workspaceId: string; workspacePath: string; refresh: number; worktrees: GitWorktree[]; error?: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const repository = repositories.find((entry) => entry.id === selectedId)
    ?? repositories.find((entry) => entry.id === preferredWorkspaceId) ?? repositories[0];
  const workspaceId = repository?.id;
  const workspacePath = repository?.workspacePath;

  useEffect(() => {
    let active = true;
    if (!workspaceId || !workspacePath) return;
    void window.electronAPI.gitListWorktrees(workspacePath, workspaceId).then((list) => {
      if (!active) return;
      setResult({ workspaceId, workspacePath, refresh, worktrees: list.success ? list.worktrees : [],
        error: list.success ? undefined : list.error || 'Could not discover remote worktrees' });
    }).catch((cause: unknown) => {
      if (active) setResult({ workspaceId, workspacePath, refresh, worktrees: [],
        error: cause instanceof Error ? cause.message : 'Could not discover remote worktrees' });
    });
    return () => { active = false; };
  }, [workspaceId, workspacePath, refresh]);

  if (!repository) return <p>Open a repository workspace on this SSH target to discover its worktrees.</p>;
  const currentResult = result?.workspaceId === workspaceId && result.workspacePath === workspacePath && result.refresh === refresh ? result : null;
  const loading = !currentResult;
  const error = currentResult?.error;
  const worktrees = currentResult?.worktrees ?? [];
  return <div className="gate-worktrees remote-worktree-picker">
    <label htmlFor="remote-worktree-repository">Open SSH repository</label>
    <select id="remote-worktree-repository" className="ssh-env-select" value={workspaceId} onChange={(event) => setSelectedId(event.target.value)}>
      {repositories.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} — {entry.workspacePath}</option>)}
    </select>
    <button type="button" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>Refresh worktrees</button>
    {loading && <p role="status">Loading remote worktrees…</p>}
    {error && <p className="gate-worktree-error" role="alert">{error}</p>}
    {!loading && !error && !worktrees.length && <p>No worktrees found.</p>}
    {worktrees.map((worktree) => <div className="gate-worktree-row" key={worktree.path}>
      <span className="gate-worktree-identity" title={worktree.path}>
        <span className="gate-worktree-branch">{worktree.branch || 'Detached'}{worktree.isMain ? ' · Main' : ''}</span>
        <span className="gate-worktree-project">{worktree.path}{worktree.isLocked ? ' · Locked' : ''}{worktree.isPrunable ? ' · Missing' : ''}</span>
      </span>
      <button type="button" onClick={() => onOpenPath(worktree.path)} disabled={loading || !launchReady || worktree.isPrunable} title={worktree.isPrunable ? 'Checkout directory is missing' : undefined}>Open</button>
    </div>)}
  </div>;
}
