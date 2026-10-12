import { useEffect, useState } from 'react';
import { GitBranch, X } from 'lucide-react';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import ConfirmCloseDialog from './ConfirmCloseDialog';
import type { GitWorktree } from '../../shared/types/git';
import type { WorkspaceTab } from '../store/workspaceTypes';
import { useWorkspaceStore } from '../store/workspaceStore';
import { mainCheckoutContextId } from '../../shared/checkoutContext';
import { isSameWorkspaceIdentity } from '../../shared/workspaceIdentity';
import { findManagedWorktreeContext, getUnusedWorktreeContexts, isCheckoutContextInUse, useCheckoutOccupancy } from '../lib/worktreeAgents';
import { formatCheckoutRemovalFailure, removeWorktreeCheckout } from '../lib/worktreeCheckoutRemoval';
import { refreshWorktreeInventory, useWorktreeInventory } from '../lib/worktreeInventory';
import { isWorktreeRemovalWorkspaceCurrent } from '../lib/worktreeRemovalScope';
import { GitWorktreesSection } from './git/GitWorktreesSection';

interface Notice { id: number; tone: 'error' | 'warning'; message: string }
let nextNoticeId = 1;
interface WorkspaceCheckoutsProps { workspace: WorkspaceTab; expanded: boolean; label: string }

/** Git-listed linked checkouts; registrations and occupancy describe them, never own them. */
export default function WorkspaceCheckouts({ workspace, expanded, label }: WorkspaceCheckoutsProps) {
  useCheckoutOccupancy();
  const inventory = useWorktreeInventory((state) => state.byWorkspace[workspace.id]);
  const [confirming, setConfirming] = useState<GitWorktree | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [repair, setRepair] = useState(false);
  useEffect(() => {
    if (expanded && !workspace.isLinkedWorktree) void refreshWorktreeInventory(workspace.id);
  }, [expanded, workspace.id, workspace.workspacePath, workspace.environmentId, workspace.isLinkedWorktree, workspace.checkoutContexts]);
  const inactive = new Set(getUnusedWorktreeContexts(workspace).map((context) => context.id));
  const entries = (inventory?.worktrees ?? []).filter((entry) => !entry.isMain && !isSameWorkspaceIdentity(
    { environmentId: workspace.environmentId || 'local', path: entry.path },
    { environmentId: workspace.environmentId || 'local', path: workspace.workspacePath }))
    .filter((entry) => {
      const context = findManagedWorktreeContext(workspace, entry.path);
      return context && !context.missing ? inactive.has(context.id) : !isCheckoutContextInUse(workspace, context ?? { id: '', path: entry.path });
    });
  const pushNotice = (tone: Notice['tone'], message: string) => setNotices((current) => [...current, { id: nextNoticeId++, tone, message }]);
  const select = async (entry: GitWorktree) => {
    if (busyPath) return;
    setBusyPath(entry.path);
    try {
      let context = findManagedWorktreeContext(workspace, entry.path);
      if (!context) {
        const result = await window.electronAPI.adoptWorktreeCheckoutContext(workspace.id, entry.path);
        if (!isWorktreeRemovalWorkspaceCurrent(workspace)) return;
        if (!result.success || !result.checkoutContext) throw new Error(result.error || 'Could not select checkout');
        context = result.checkoutContext;
        if (!useWorkspaceStore.getState().upsertCheckoutContext(workspace.id, context)) throw new Error('Checkout selection changed');
      }
      if (!useWorkspaceStore.getState().selectCheckoutContext(workspace.id, context.id)) throw new Error('Checkout is unavailable');
    } catch (error) { pushNotice('error', error instanceof Error ? error.message : 'Could not select checkout'); }
    finally { setBusyPath(null); }
  };
  const remove = async (entry: GitWorktree) => {
    setConfirming(null);
    if (busyPath) return;
    setBusyPath(entry.path);
    try {
      const result = await removeWorktreeCheckout(workspace, entry);
      if (result.success) { if (result.warning) pushNotice('warning', result.warning); }
      else pushNotice('error', formatCheckoutRemovalFailure({ branch: entry.branch || 'HEAD', path: entry.path, error: result.error || 'Could not remove worktree' }));
    } finally { setBusyPath(null); void refreshWorktreeInventory(workspace.id); }
  };
  return (
    <>
      {expanded && (entries.length > 0 || workspace.fileSurfaceContextId) && (
        <div>
          <Button type="button" size="xs" variant="ghost" disabled={busyPath !== null}
            onClick={() => useWorkspaceStore.getState().selectCheckoutContext(workspace.id, mainCheckoutContextId(workspace.id))}>
            Main checkout
          </Button>
          <ul className="ws-checkout-list" aria-label={`${label} inactive checkouts`}>
            {entries.map((entry) => {
              const branch = entry.branch || 'HEAD';
              const context = findManagedWorktreeContext(workspace, entry.path);
              const inUse = isCheckoutContextInUse(workspace, context ?? { id: '', path: entry.path });
              const unavailable = entry.isLocked || entry.isPrunable;
              const state = entry.isPrunable ? 'Missing' : entry.isLocked ? 'Locked' : inUse ? 'In use' : 'Available';
              return (
                <li key={entry.path} className="ws-checkout-row" title={`${state} checkout · ${branch}\n${entry.path}`}>
                  <GitBranch size={11} strokeWidth={2} aria-hidden="true" className="ws-checkout-icon" />
                  <Button type="button" size="xs" variant="ghost" className="ws-checkout-name"
                    aria-label={`Select checkout for branch ${branch}`}
                    disabled={busyPath !== null || unavailable || !inventory?.success} onClick={() => void select(entry)}>
                    {branch}{inUse ? ' · In use' : ''}{entry.isPrunable ? ' · Missing' : ''}{entry.isLocked ? ' · Locked' : ''}
                  </Button>
                  {unavailable ? (
                    <Button type="button" size="xs" variant="ghost" disabled={busyPath !== null} onClick={() => setRepair(!repair)}>Repair…</Button>
                  ) : !inUse && (
                    <Button type="button" size="xs" variant="ghost" className="ws-checkout-remove"
                      disabled={busyPath !== null || !inventory?.success} aria-label={`Remove checkout for branch ${branch}`}
                      onClick={() => setConfirming(entry)}>
                      {busyPath === entry.path ? 'Removing…' : 'Remove…'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {expanded && inventory?.error && (
        <div role="alert" className="ws-checkout-notice error">
          {inventory.error}
          <Button size="xs" variant="ghost" onClick={() => void refreshWorktreeInventory(workspace.id)}>Refresh worktrees</Button>
        </div>
      )}
      {expanded && repair && (
        <GitWorktreesSection workspacePath={workspace.workspacePath} workspaceId={workspace.id} refreshKey={0}
          onRefresh={() => { void refreshWorktreeInventory(workspace.id); }} />
      )}
      {expanded && notices.length > 0 && (
        <ul className="ws-checkout-notices" aria-label={`${label} checkout messages`}>
          {notices.map((notice) => (
            <li key={notice.id} className={`ws-checkout-notice ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
              <span>{notice.message}</span>
              <IconButton type="button" size="xs" variant="ghost" aria-label="Dismiss message" title="Dismiss"
                onClick={() => setNotices((current) => current.filter((entry) => entry.id !== notice.id))}>
                <X size={12} strokeWidth={2} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <ConfirmCloseDialog isOpen={confirming !== null}
        title={confirming ? `Remove checkout for branch ${confirming.branch || 'HEAD'}?` : 'Remove checkout?'}
        message={confirming ? `The branch remains. The checkout at ${confirming.path} is removed only if it has no uncommitted, untracked, or ignored files.` : ''}
        options={confirming ? [{ label: 'Remove worktree', variant: 'danger', action: () => void remove(confirming) }] : []}
        onCancel={() => setConfirming(null)} />
    </>
  );
}
