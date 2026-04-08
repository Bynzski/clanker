/**
 * ProviderBadge Component
 * Displays PR/MR information badge next to branch name.
 */

import { ExternalLink, CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react';
import type { PullRequestContext } from '../../store/vcsStore';
import './ProviderBadge.css';

interface ProviderBadgeProps {
  /** Pull request context */
  pullRequest: PullRequestContext | null;
  /** Provider name for display */
  providerName?: string;
  /** Callback when badge is clicked */
  onViewPr?: () => void;
  /** Callback when create PR is clicked */
  onCreatePr?: () => void;
}

/**
 * Get the icon for check status.
 */
function StatusIcon({ status }: { status: PullRequestContext['checksStatus'] }) {
  switch (status) {
    case 'success':
      return <CheckCircle size={10} className="pr-status-icon success" />;
    case 'failure':
      return <XCircle size={10} className="pr-status-icon failure" />;
    case 'error':
      return <AlertCircle size={10} className="pr-status-icon error" />;
    case 'pending':
      return <Clock size={10} className="pr-status-icon pending" />;
    default:
      return null;
  }
}

/**
 * Get the display label for review state.
 */
function ReviewStateLabel({ state }: { state: PullRequestContext['reviewState'] }) {
  switch (state) {
    case 'approved':
      return <span className="review-state approved">Approved</span>;
    case 'changes_requested':
      return <span className="review-state changes-requested">Changes requested</span>;
    case 'commented':
      return <span className="review-state commented">Commented</span>;
    case 'pending':
      return <span className="review-state pending">Pending review</span>;
    default:
      return null;
  }
}

export default function ProviderBadge({
  pullRequest,
  onViewPr,
  onCreatePr,
}: ProviderBadgeProps) {
  if (!pullRequest) {
    // No PR exists - show "Create PR" button
    return (
      <div className="provider-badge-container">
        <button
          type="button"
          className="provider-badge create-pr-badge"
          onClick={onCreatePr}
          title="Create Pull Request"
        >
          <ExternalLink size={10} />
          <span>Create PR</span>
        </button>
      </div>
    );
  }

  const { exists, number, title, state, checksStatus, reviewState } = pullRequest;

  if (!exists) {
    return (
      <div className="provider-badge-container">
        <button
          type="button"
          className="provider-badge create-pr-badge"
          onClick={onCreatePr}
          title="Create Pull Request"
        >
          <ExternalLink size={10} />
          <span>Create PR</span>
        </button>
      </div>
    );
  }

  // PR exists - show badge with details
  const stateClass = state === 'merged' ? 'merged' : state;

  return (
    <div className="provider-badge-container">
      <button
        type="button"
        className={`provider-badge pr-badge ${stateClass}`}
        onClick={onViewPr}
        title={title || `PR #${number}`}
      >
        <span className="pr-number">#{number}</span>
        {title && <span className="pr-title">{title}</span>}
        {state && <span className={`pr-state ${state}`}>{state}</span>}
      </button>

      {/* Status indicators */}
      <div className="pr-status-indicators">
        {checksStatus && checksStatus !== 'success' && (
          <div className="status-indicator" title={`CI: ${checksStatus}`}>
            <StatusIcon status={checksStatus} />
          </div>
        )}
        {reviewState && (
          <div className="review-indicator" title={`Review: ${reviewState}`}>
            <ReviewStateLabel state={reviewState} />
          </div>
        )}
      </div>
    </div>
  );
}
