import { useState } from 'react';
import { GitBranch, X } from 'lucide-react';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import ConfirmCloseDialog from './ConfirmCloseDialog';
import type { CheckoutContext } from '../../shared/types/checkoutContext';
import type { WorkspaceTab } from '../store/workspaceTypes';
import { getUnusedWorktreeContexts, worktreeBranchLabel } from '../lib/worktreeAgents';
import { removeWorktreeCheckout } from '../lib/worktreeCheckoutRemoval';

interface Notice {
  id: number;
  tone: 'error' | 'warning';
  message: string;
}

let nextNoticeId = 1;

interface WorkspaceCheckoutsProps {
  workspace: WorkspaceTab;
  expanded: boolean;
  label: string;
}

/**
 * Inactive isolated checkouts of one workspace: worktree contexts no agent is using. Each is a quiet
 * row with a Remove action that goes through `removeWorktreeCheckout`; all safety lives there.
 *
 * Outcomes are kept here, not on the row: a removal that fails after the context was released has
 * already dropped the row, and its message must still be readable.
 */
export default function WorkspaceCheckouts({ workspace, expanded, label }: WorkspaceCheckoutsProps) {
  const unused = getUnusedWorktreeContexts(workspace);
  const [confirming, setConfirming] = useState<CheckoutContext | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);

  const pushNotice = (tone: Notice['tone'], message: string) =>
    setNotices((current) => [...current, { id: nextNoticeId++, tone, message }]);
  const dismiss = (id: number) => setNotices((current) => current.filter((notice) => notice.id !== id));

  const remove = async (context: CheckoutContext) => {
    setConfirming(null);
    if (removingId) return;
    setRemovingId(context.id);
    const branch = worktreeBranchLabel(context);
    try {
      const result = await removeWorktreeCheckout(workspace, context);
      if (result.success) {
        if (result.warning) pushNotice('warning', result.warning);
        return;
      }
      pushNotice('error', result.released
        ? `Could not remove the checkout for branch "${branch}": ${result.error} It was left on disk at ${context.path} and is no longer listed here. The branch was not deleted.`
        : `Could not remove the checkout for branch "${branch}": ${result.error} It was left on disk. The branch was not deleted.`);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <>
      {expanded && unused.length > 0 && (
        <ul className="ws-checkout-list" aria-label={`${label} inactive checkouts`}>
          {unused.map((context) => {
            const branch = worktreeBranchLabel(context);
            return (
              <li key={context.id} className="ws-checkout-row" title={`Inactive checkout · ${branch}\n${context.path}`}>
                <GitBranch size={11} strokeWidth={2} aria-hidden="true" className="ws-checkout-icon" />
                <span className="ws-checkout-name">{branch}</span>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="ws-checkout-remove"
                  disabled={removingId !== null}
                  aria-label={`Remove checkout for branch ${branch}`}
                  onClick={() => setConfirming(context)}
                >
                  {removingId === context.id ? 'Removing…' : 'Remove…'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {expanded && notices.length > 0 && (
        <ul className="ws-checkout-notices" aria-label={`${label} checkout messages`}>
          {notices.map((notice) => (
            <li key={notice.id} className={`ws-checkout-notice ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
              <span>{notice.message}</span>
              <IconButton type="button" size="xs" variant="ghost" aria-label="Dismiss message" title="Dismiss" onClick={() => dismiss(notice.id)}>
                <X size={12} strokeWidth={2} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <ConfirmCloseDialog
        isOpen={confirming !== null}
        title={confirming ? `Remove checkout for branch ${worktreeBranchLabel(confirming)}?` : 'Remove checkout?'}
        message={confirming
          ? `The branch remains. The checkout at ${confirming.path} is removed only if it has no uncommitted, untracked, or ignored files.`
          : ''}
        options={confirming ? [{ label: 'Remove worktree', variant: 'danger', action: () => void remove(confirming) }] : []}
        onCancel={() => setConfirming(null)}
      />
    </>
  );
}
