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
import { requestCheckoutReconciliation } from '../../lib/checkoutReconciliation';
import './GitWorktreesSection.css';

interface Notice {
  tone: 'error' | 'warning' | 'info';
  message: string;
}

type Confirmation =
  | { kind: 'remove'; entry: GitWorktree; managed: CheckoutContext | null }
  | { kind: 'unlock'; entry: GitWorktree }
  | { kind: 'forget'; context: CheckoutContext }
  | { kind: 'prune'; entries: GitWorktree[] };

interface GitWorktreesSectionProps {
  workspacePath: string;
  workspaceId?: string;
  /** Changes whenever the menu refreshes its data; the list reloads with it (no polling of its own). */
  refreshKey: number;
  /** Refreshes the isolated-agent picker after reading authoritative recovery state. */
  onRefresh?: () => void;
  /**
   * Reports whether this section has a confirmation open. It renders in a portal outside the menu, so
   * the menu's host uses this to avoid treating clicks inside it as outside clicks and closing the menu
   * (and with it this section) before the confirmed action runs.
   */
  onModalOpenChange?: (open: boolean) => void;
}

/**
 * The linked worktrees that exist, for inspection and cleanup only. Nothing here creates a worktree:
 * that is `New isolated agent`. Each row says whose it is:
 *
 * - in use / managed: attached to this workspace as a checkout context. Removal goes through
 *   `removeWorktreeCheckout` (release, inspect, remove), never directly;
 * - unmanaged: no context (made outside Clanker, by the old launcher, or released). Removal goes
 *   through the existing inspect/remove calls with all their protections.
 *
 * Two Git-authoritative cleanups sit beside removal, neither of which deletes a branch or files:
 * `Unlock` clears the lock of one listed worktree (removal stays a separate step), and a section-level
 * prune drops Git's stale records for checkouts whose directory is already gone (repository-wide).
 */
export function GitWorktreesSection({ workspacePath, workspaceId, refreshKey, onModalOpenChange, onRefresh }: GitWorktreesSectionProps) {
  const workspace = useWorkspaceStore((state) => (workspaceId ? state.getWorkspaceById(workspaceId) : null));
  const [entries, setEntries] = useState<GitWorktree[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const requestRef = useRef(0);
  const modalOpen = confirming !== null;

  useEffect(() => {
    if (!modalOpen) return;
    onModalOpenChange?.(true);
    return () => onModalOpenChange?.(false);
  }, [modalOpen, onModalOpenChange]);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const request = ++requestRef.current;
    try {
      const result = await window.electronAPI.gitListWorktrees(workspacePath, workspaceId);
      if (request !== requestRef.current) return;
      if (result.success) {
        setEntries(result.worktrees.filter((entry: GitWorktree) => !entry.isMain));
        setLoadError(null);
        onRefresh?.();
        // The same listing may show a managed checkout changed or gone: let main reconcile its contexts.
        void requestCheckoutReconciliation(workspaceId);
      } else {
        setEntries([]);
        setLoadError(result.error || 'Could not list worktrees');
      }
    } catch (cause) {
      if (request !== requestRef.current) return;
      setEntries([]);
      setLoadError(cause instanceof Error ? cause.message : 'Could not list worktrees');
    }
  }, [workspacePath, workspaceId, onRefresh]);

  useEffect(() => {
    void load();
    // A newer load, or unmounting, makes any in-flight answer stale.
    return () => { requestRef.current += 1; };
  }, [load, refreshKey]);

  const staleContexts = workspace?.checkoutContexts?.filter((context) => context.kind === 'worktree' && context.missing
    && !entries.some((entry) => isSameWorkspaceIdentity({ environmentId: context.environmentId, path: context.path }, { environmentId: context.environmentId, path: entry.path }))) ?? [];
  if (!workspace || (entries.length === 0 && staleContexts.length === 0 && !loadError && !notice)) return null;

  const environmentId = workspace.environmentId || 'local';
  const staleEntries = entries.filter((entry) => entry.isPrunable && !entry.isLocked);
  const staleCount = staleEntries.length;

  const forget = async (context: CheckoutContext) => {
    setConfirming(null);
    if (working) return;
    setWorking(true);
    setNotice(null);
    try {
      // Main re-lists Git and uses its normal release/usage guard, never a UI-selected root.
      const result = await window.electronAPI.reconcileCheckoutContexts(workspace.id);
      useWorkspaceStore.getState().applyCheckoutContextReconciliation(workspace.id, result);
      setNotice(result.success && !result.contexts.some((entry: CheckoutContext) => entry.id === context.id)
        ? { tone: 'info', message: 'Stale checkout forgotten; no files or branches were deleted' }
        : { tone: 'error', message: result.success ? 'Checkout is still registered: it is in use or Git lists it again. Close its terminals and stop its dev servers before retrying.' : result.error || 'Could not verify checkout state' });
    } catch (cause) {
      setNotice({ tone: 'error', message: cause instanceof Error ? cause.message : 'Could not forget stale checkout' });
    } finally {
      setWorking(false);
      void load();
    }
  };

  const prune = async () => {
    setConfirming(null);
    if (working) return;
    setWorking(true);
    setNotice(null);
    try {
      const result = await window.electronAPI.gitPruneWorktrees(workspacePath, workspace.id);
      if (!result.success) {
        setNotice({ tone: 'error', message: result.error || 'Could not prune worktree records' });
      } else {
        setNotice({
          tone: 'info',
          message: result.pruned.length === 0
            ? 'No stale worktree records found'
            : `Pruned ${result.pruned.length} stale worktree record${result.pruned.length === 1 ? '' : 's'}; branches were kept`,
        });
      }
    } catch (cause) {
      setNotice({ tone: 'error', message: cause instanceof Error && cause.message ? cause.message : 'Could not prune worktree records' });
    } finally {
      setWorking(false);
      void load();
    }
  };

  const unlock = async (entry: GitWorktree) => {
    setConfirming(null);
    if (working) return;
    setWorking(true);
    setNotice(null);
    try {
      const result = await window.electronAPI.gitUnlockWorktree(workspacePath, entry.path, workspace.id);
      if (!result.success) setNotice({ tone: 'error', message: result.error || `Could not unlock ${entry.branch ?? entry.path}` });
    } catch (cause) {
      setNotice({ tone: 'error', message: cause instanceof Error && cause.message ? cause.message : `Could not unlock ${entry.branch ?? entry.path}` });
    } finally {
      setWorking(false);
      void load();
    }
  };

  const remove = async (entry: GitWorktree, managed: CheckoutContext | null) => {
    setConfirming(null);
    if (removingPath || working) return;
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
        <span className="git-menu-count">{entries.length + staleContexts.length}</span>
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
          const ownership = isThisWorkspace ? 'This workspace' : inUse ? 'In use' : managed ? 'Managed' : 'Unmanaged';

          // The tag says whose checkout this is and why it cannot be removed: a missing directory is
          // cleaned up by the section-level prune, a lock is cleared by Unlock (removal stays separate).
          const tag = entry.isPrunable
            ? (entry.isLocked ? 'Missing · Locked' : 'Missing')
            : entry.isLocked ? (managed || isThisWorkspace ? `${ownership} · Locked` : 'Locked') : ownership;
          const canRemove = !isThisWorkspace && !inUse && !entry.isPrunable && !entry.isLocked;
          const canUnlock = entry.isLocked && !isThisWorkspace;

          return (
            <div key={entry.path} className="git-worktree-item" title={`${branch}\n${entry.path}`}>
              <div className="git-worktree-meta">
                <span className="git-worktree-branch">{branch}</span>
                <span className="git-worktree-path">{entry.path}</span>
                {entry.isPrunable && <span className="git-worktree-explanation">Directory is missing. {entry.pruneReason}</span>}
                {entry.isLocked && <span className="git-worktree-explanation">{entry.lockReason ? `Lock reason: ${entry.lockReason}. ` : ''}Unlock explicitly before removal or pruning; a missing locked checkout cannot be pruned.</span>}
                {inUse && <span className="git-worktree-explanation">Close this checkout’s terminals and stop its dev servers before cleanup.</span>}
              </div>
              <div className="git-worktree-actions">
                <span className={`git-worktree-tag${managed ? ' managed' : ''}`}>{tag}</span>
                {canRemove && (
                  <Button
                    size="xs"
                    variant="ghost"
                    type="button"
                    className="git-branch-action danger"
                    disabled={removingPath !== null || working}
                    aria-label={`Remove checkout for branch ${branch}`}
                    onClick={() => setConfirming({ kind: 'remove', entry, managed })}
                  >
                    {removingPath === entry.path ? 'Removing…' : 'Remove…'}
                  </Button>
                )}
                {canUnlock && (
                  <Button
                    size="xs"
                    variant="ghost"
                    type="button"
                    className="git-branch-action"
                    disabled={working || removingPath !== null}
                    aria-label={`Unlock checkout for branch ${branch}`}
                    onClick={() => setConfirming({ kind: 'unlock', entry })}
                  >
                    Unlock
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {staleContexts.map((context) => (
          <div key={context.id} className="git-worktree-item">
            <div className="git-worktree-meta">
              <span className="git-worktree-branch">{worktreeBranchLabel(context)}</span>
              <span className="git-worktree-path">{context.path}</span>
              <span className="git-worktree-explanation">Missing checkout; retained while a terminal or dev server uses it. Forget rechecks Git and live usage; it deletes no files or branches.</span>
            </div>
            <Button type="button" size="xs" variant="ghost" disabled={working || removingPath !== null} onClick={() => setConfirming({ kind: 'forget', context })}>Forget stale checkout…</Button>
          </div>
        ))}
      </div>

      {staleCount > 0 && (
        <div className="git-worktree-footer">
          <Button
            size="xs"
            variant="ghost"
            type="button"
            className="git-branch-action"
            disabled={working || removingPath !== null}
            onClick={() => setConfirming({ kind: 'prune', entries: staleEntries })}
          >
            Prune missing worktrees…
          </Button>
        </div>
      )}

      <ConfirmCloseDialog
        isOpen={confirming !== null}
        title={confirming?.kind === 'prune' ? 'Prune missing worktrees?' : confirming?.kind === 'unlock' ? `Unlock checkout for branch ${confirming.entry.branch ?? 'HEAD'}?` : confirming?.kind === 'forget' ? 'Forget stale checkout?' : confirming ? `Remove checkout for branch ${confirming.entry.branch ?? 'HEAD'}?` : 'Remove checkout?'}
        message={confirming?.kind === 'prune'
          ? `Git still lists worktrees whose directories are already gone. This cleans up those stale records for every such worktree in this repository. No branch and no existing checkout directory is deleted. Active workspaces, terminals and dev servers block pruning.\n${confirming.entries.map((entry) => `${entry.branch ?? 'HEAD'}: ${entry.path}`).join('\n')}`
          : confirming?.kind === 'unlock'
            ? `Unlock ${confirming.entry.path}? ${confirming.entry.lockReason ? `Lock reason: ${confirming.entry.lockReason}. ` : ''}Locks may be intentional. Nothing is deleted. If the directory is missing, prune its stale metadata after unlocking.`
            : confirming?.kind === 'forget'
              ? `Recheck and forget ${worktreeBranchLabel(confirming.context)} at ${confirming.context.path} only if Git no longer has it and no terminal or dev server uses it. No files or branches are deleted.`
              : confirming
                ? `The branch remains. The checkout at ${confirming.entry.path} is removed only if it has no uncommitted, untracked, or ignored files.`
                : ''}
        options={!confirming ? [] : confirming.kind === 'prune'
          ? [{ label: 'Prune records', variant: 'danger', action: () => void prune() }]
          : confirming.kind === 'unlock'
            ? [{ label: 'Unlock worktree', variant: 'danger', action: () => void unlock(confirming.entry) }]
            : confirming.kind === 'forget'
              ? [{ label: 'Forget checkout', variant: 'danger', action: () => void forget(confirming.context) }]
              : [{ label: 'Remove worktree', variant: 'danger', action: () => void remove(confirming.entry, confirming.managed) }]}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
