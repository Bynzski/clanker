import { useState } from 'react';
import type { GitBranch, GitWorktree } from '../../shared/types/git';
import { sameWorkspacePath } from '../lib/pathUtils';

interface Props {
  repoPath: string | null;
  openPaths: string[];
  onOpenPath: (path: string) => void;
}

export default function WorktreeLauncher({ repoPath, openPaths, onOpenPath }: Props) {
  const [loadedRepo, setLoadedRepo] = useState('');
  const [baseRef, setBaseRef] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchOptions, setBranchOptions] = useState<string[]>([]);
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<GitWorktree | null>(null);
  const ready = !!repoPath && loadedRepo === repoPath;

  const loadRepository = async () => {
    if (!repoPath) { setError('Choose a repository directory first'); return; }
    setBusy(true);
    setError('');
    setPendingRemoval(null);
    try {
      const [branchState, list] = await Promise.all([
        window.electronAPI.gitGetBranchState(repoPath),
        window.electronAPI.gitListWorktrees(repoPath),
      ]);
      if (!branchState.success || !branchState.isRepo || !list.success) {
        setLoadedRepo('');
        setError(branchState.error || list.error || 'Choose a Git repository');
        return;
      }
      setLoadedRepo(repoPath);
      setBranchOptions(branchState.branches.map((branch: GitBranch) => branch.name));
      setBaseRef(branchState.currentBranch || branchState.branches[0]?.name || 'HEAD');
      setWorktrees(list.worktrees.filter((worktree: GitWorktree) => !worktree.isMain));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load repository');
    } finally {
      setBusy(false);
    }
  };

  const createWorktree = async () => {
    if (!ready) { setError('Load the repository first'); return; }
    setBusy(true);
    setError('');
    try {
      const result = await window.electronAPI.gitCreateWorktree(loadedRepo, baseRef, branchName);
      if (!result.success || !result.worktree) {
        setError(result.error || 'Could not create worktree');
        return;
      }
      onOpenPath(result.worktree.path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create worktree');
    } finally {
      setBusy(false);
    }
  };

  const isOpen = (worktreePath: string) => openPaths.some((entry) => sameWorkspacePath(entry, worktreePath));

  const inspectRemoval = async (worktree: GitWorktree) => {
    if (isOpen(worktree.path)) { setError('Close this workspace tab before removing its worktree'); return; }
    setBusy(true);
    setError('');
    try {
      const result = await window.electronAPI.gitInspectWorktree(loadedRepo, worktree.path, openPaths);
      if (!result.success || !result.worktree) {
        setError(result.error || 'Could not inspect worktree');
      } else if (result.hasChanges) {
        setError('Worktree has uncommitted, untracked, or ignored files. Save or remove them first.');
      } else {
        setPendingRemoval(result.worktree);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not inspect worktree');
    } finally {
      setBusy(false);
    }
  };

  const removeWorktree = async () => {
    if (!pendingRemoval || !ready) return;
    if (isOpen(pendingRemoval.path)) {
      setPendingRemoval(null);
      setError('Close this workspace tab before removing its worktree');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await window.electronAPI.gitRemoveWorktree(loadedRepo, pendingRemoval.path, pendingRemoval.branch, openPaths);
      if (!result.success) { setError(result.error || 'Could not remove worktree'); return; }
      setWorktrees((entries) => entries.filter((entry) => entry.path !== pendingRemoval.path));
      setPendingRemoval(null);
      if (result.warning) setError(result.warning);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove worktree');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate-worktrees">
      <button type="button" onClick={() => void loadRepository()} disabled={busy}>Load repository</button>
      {ready && (
        <>
          <label>Base ref
            <input value={baseRef} onChange={(event) => setBaseRef(event.target.value)} list="gate-branch-options" />
            <datalist id="gate-branch-options">{branchOptions.map((branch) => <option key={branch} value={branch} />)}</datalist>
          </label>
          <label>Task branch
            <input value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="feature/my-task" />
          </label>
          <button type="button" onClick={() => void createWorktree()} disabled={busy || !branchName.trim()}>Create and open worktree</button>
          <div className="gate-worktree-list-title">Existing worktrees</div>
          {worktrees.length === 0 && <span>No linked worktrees</span>}
          {worktrees.map((worktree) => (
            <div className="gate-worktree-row" key={worktree.path}>
              <span title={worktree.path}>{worktree.branch || 'Detached'} · {worktree.path}</span>
              <button type="button" onClick={() => onOpenPath(worktree.path)} disabled={worktree.isPrunable} title={worktree.isPrunable ? 'Checkout directory is missing' : undefined}>Open</button>
              <button type="button" onClick={() => void inspectRemoval(worktree)} disabled={busy || worktree.isLocked || worktree.isPrunable}>Remove…</button>
            </div>
          ))}
        </>
      )}
      {error && <p className="gate-worktree-error" role="alert">{error}</p>}
      {ready && pendingRemoval && (
        <div className="gate-worktree-confirm" role="dialog" aria-label="Confirm worktree removal">
          <p>Remove checkout at <strong>{pendingRemoval.path}</strong> on branch <strong>{pendingRemoval.branch || 'Detached'}</strong>? The branch remains.</p>
          <button type="button" onClick={() => setPendingRemoval(null)}>Cancel</button>
          <button type="button" onClick={() => void removeWorktree()} disabled={busy}>Remove this worktree</button>
        </div>
      )}
    </div>
  );
}
