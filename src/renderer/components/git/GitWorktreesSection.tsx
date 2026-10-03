import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import ConfirmCloseDialog from '../ConfirmCloseDialog';
import type { CheckoutContext } from '../../../shared/types/checkoutContext';
import type { GitWorktree } from '../../../shared/types/git';
import { isSameWorkspaceIdentity } from '../../../shared/workspaceIdentity';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { findManagedWorktreeContext, isCheckoutContextInUse, worktreeBranchLabel } from '../../lib/worktreeAgents';
import { formatCheckoutRemovalFailure, removeWorktreeCheckout } from '../../lib/worktreeCheckoutRemoval';
import { removeUnmanagedWorktree } from '../../lib/unmanagedWorktreeRemoval';
import './GitWorktreesSection.css';

interface Notice {
  tone: 'error' | 'warning';
  message: string;
}

interface GitWorktreesSectionProps {
  workspacePath: string;
  workspaceId?: string;
  /** Changes whenever the menu refreshes its data; the list reloads with it (no polling of its own). */
  refreshKey: number;
}

/**
 * The linked worktrees that exist, for inspection and cleanup only. Nothing here creates a worktree:
 * that is `New isolated agent`. Each row says whose it is:
 *
 * - in use / managed: attached to this workspace as a checkout context. Removal goes through
 *   `removeWorktreeCheckout` (release, inspect, remove), never directly;
 * - unmanaged: no context (made outside Clanker, by the old launcher, or released). Removal goes
 *   through the existing inspect/remove calls with all their protections.
 */
export function GitWorktreesSection({ workspacePath, workspaceId, refreshKey }: GitWorktreesSectionProps) {
  const workspace = useWorkspaceStore((state) => (workspaceId ? state.getWorkspaceById(workspaceId) : null));
  const [entries, setEntries] = useState<GitWorktree[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ entry: GitWorktree; managed: CheckoutContext | null } | null>(null);
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const request = ++requestRef.current;
    try {
      const result = await window.electronAPI.gitListWorktrees(workspacePath, workspaceId);
      if (request !== requestRef.current) return;
      if (result.success) {
        setEntries(result.worktrees.filter((entry: GitWorktree) => !entry.isMain));
        setLoadError(null);
      } else {
        setEntries([]);
        setLoadError(result.error || 'Could not list worktrees');
      }
    } catch (cause) {
      if (request !== requestRef.current) return;
      setEntries([]);
      setLoadError(cause instanceof Error ? cause.message : 'Could not list worktrees');
    }
  }, [workspacePath, workspaceId]);

  useEffect(() => {
    void load();
    // A newer load, or unmounting, makes any in-flight answer stale.
    return () => { requestRef.current += 1; };
  }, [load, refreshKey]);

  if (!workspace || (entries.length === 0 && !loadError)) return null;

  const environmentId = workspace.environmentId || 'local';

  const remove = async (entry: GitWorktree, managed: CheckoutContext | null) => {
    setConfirming(null);
    if (removingPath) return;
    setRemovingPath(entry.path);
    setNotice(null);
    const branch = entry.branch ?? 'HEAD';
    try {
      if (managed) {
        const result = await removeWorktreeCheckout(workspace, managed);
        if (result.success) {
          if (result.warning) setNotice({ tone: 'warning', message: result.warning });
        } else {
          setNotice({ tone: 'error', message: formatCheckoutRemovalFailure({ branch: worktreeBranchLabel(managed), path: managed.path, error: result.error, released: result.released }) });
        }
      } else {
        const result = await removeUnmanagedWorktree(workspace, entry);
        if (result.success) {
          if (result.warning) setNotice({ tone: 'warning', message: result.warning });
        } else {
          setNotice({ tone: 'error', message: formatCheckoutRemovalFailure({ branch, path: entry.path, error: result.error, released: false }) });
        }
      }
    } finally {
      setRemovingPath(null);
      // Whatever happened, show what Git says now: a removed checkout leaves the list, a refused one stays.
      void load();
    }
  };

  return (
    <div className="git-menu-section">
      <div className="git-menu-section-header">
        Worktrees
        <span className="git-menu-count">{entries.length}</span>
      </div>

      {notice && (
        <div className={`git-worktree-notice ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
          <span>{notice.message}</span>
          <IconButton type="button" size="xs" variant="ghost" aria-label="Dismiss message" title="Dismiss" onClick={() => setNotice(null)}>
            <X size={12} strokeWidth={2} />
          </IconButton>
        </div>
      )}
      {loadError && <div className="git-menu-empty">{loadError}</div>}

      <div className="git-worktree-list">
        {entries.map((entry) => {
          const branch = entry.branch ?? 'HEAD';
          const managed = findManagedWorktreeContext(workspace, entry.path);
          const inUse = managed ? isCheckoutContextInUse(workspace, managed) : false;
          const isThisWorkspace = isSameWorkspaceIdentity({ environmentId, path: entry.path }, { environmentId, path: workspace.workspacePath });
          const unavailable = entry.isPrunable ? 'Missing' : entry.isLocked ? 'Locked' : null;

          // The tag says whose checkout this is; only an unused one can be removed here.
          const tag = isThisWorkspace ? 'This workspace' : inUse ? 'In use' : managed ? 'Managed' : unavailable ?? 'Unmanaged';
          const canRemove = !isThisWorkspace && !inUse && !unavailable;

          return (
            <div key={entry.path} className="git-worktree-item" title={`${branch}\n${entry.path}`}>
              <div className="git-worktree-meta">
                <span className="git-worktree-branch">{branch}</span>
                <span className="git-worktree-path">{entry.path}</span>
              </div>
              <div className="git-worktree-actions">
                <span className={`git-worktree-tag${managed ? ' managed' : ''}`}>{tag}</span>
                {canRemove && (
                  <Button
                    size="xs"
                    variant="ghost"
                    type="button"
                    className="git-branch-action danger"
                    disabled={removingPath !== null}
                    aria-label={`Remove checkout for branch ${branch}`}
                    onClick={() => setConfirming({ entry, managed })}
                  >
                    {removingPath === entry.path ? 'Removing…' : 'Remove…'}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmCloseDialog
        isOpen={confirming !== null}
        title={confirming ? `Remove checkout for branch ${confirming.entry.branch ?? 'HEAD'}?` : 'Remove checkout?'}
        message={confirming
          ? `The branch remains. The checkout at ${confirming.entry.path} is removed only if it has no uncommitted, untracked, or ignored files.`
          : ''}
        options={confirming ? [{ label: 'Remove worktree', variant: 'danger', action: () => void remove(confirming.entry, confirming.managed) }] : []}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
