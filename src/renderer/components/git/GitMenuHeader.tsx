import { ArrowDown, ArrowUp, RefreshCw, X } from 'lucide-react';
import type { GitOperationState, VcsProvider } from './types';
import { getProviderLabel } from './gitButtonViewModels';

interface GitMenuHeaderProps {
  ahead: number;
  behind: number;
  changeCount: number;
  currentBranch: string | null;
  currentBranchLabel: string;
  isBusy: boolean;
  isDetached: boolean;
  isLoadingBranches: boolean;
  isLoadingHistory: boolean;
  isLoadingOperation: boolean;
  onClose: () => void;
  onOpenCommitDialog: () => void;
  onRefresh: () => void;
  operationState: GitOperationState | null;
  provider: VcsProvider;
  upstream: string | null;
  upstreamLabel: string | null;
}

export function GitMenuHeader({
  ahead,
  behind,
  changeCount,
  currentBranch,
  currentBranchLabel,
  isBusy,
  isDetached,
  isLoadingBranches,
  isLoadingHistory,
  isLoadingOperation,
  onClose,
  onOpenCommitDialog,
  onRefresh,
  operationState,
  provider,
  upstream,
  upstreamLabel,
}: GitMenuHeaderProps) {
  return (
    <>
      <div className="git-menu-header">
        <div>
          <div className="git-menu-label">Current Branch</div>
          <div className={`git-menu-branch ${isDetached ? 'detached' : ''}`}>
            {currentBranchLabel}
          </div>
          {upstream && <div className="git-menu-upstream">{upstream}</div>}
        </div>

        <div className="git-menu-header-right">
          <span className={`git-menu-provider ${provider === 'unknown' ? 'provider-none' : `provider-${provider}`}`}>
            {getProviderLabel(provider)}
          </span>

          <button
            type="button"
            className="git-menu-close"
            onClick={onClose}
            title="Close"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="git-menu-summary">
        <span>{changeCount} changed</span>
        {upstreamLabel && (
          <span className={`git-menu-sync ${ahead === 0 && behind === 0 ? 'synced' : 'diverged'}`}>
            {upstreamLabel}
            {ahead > 0 && <ArrowUp size={10} />}
            {behind > 0 && <ArrowDown size={10} />}
          </span>
        )}
        {!upstream && !isDetached && currentBranch && (
          <span className="git-menu-sync none">no upstream</span>
        )}
        {isDetached && <span>Detached HEAD</span>}
        {operationState?.inProgress && <span>{operationState.message}</span>}
      </div>

      <div className="git-menu-actions">
        <button
          type="button"
          className="header-btn header-btn-primary git-menu-action"
          onClick={onOpenCommitDialog}
        >
          Commit Changes
        </button>
        <button
          type="button"
          className="header-btn git-menu-action"
          onClick={onRefresh}
          disabled={isBusy || isLoadingBranches || isLoadingOperation || isLoadingHistory}
        >
          <RefreshCw size={13} className={isBusy ? 'spin' : ''} />
          Refresh
        </button>
      </div>
    </>
  );
}
