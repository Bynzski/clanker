import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { Loader2 } from 'lucide-react';
import type { GitOperationState } from './types';
import './GitMergeSection.css';

interface GitMergeSectionProps {
  activeAction: string | null;
  availableMergeTargets: string[];
  isBusy: boolean;
  isLoadingOperation: boolean;
  mergeTargetBranch: string;
  onAbortOperation: () => void;
  onMergeBranch: () => void;
  onSetMergeTargetBranch: (value: string) => void;
  operationState: GitOperationState | null;
  currentBranch?: string | null;
  isDetached?: boolean;
  management?: boolean;
}

export function GitMergeSection({
  activeAction,
  availableMergeTargets,
  isBusy,
  isLoadingOperation,
  mergeTargetBranch,
  onAbortOperation,
  onMergeBranch,
  onSetMergeTargetBranch,
  operationState,
  currentBranch,
  isDetached = false,
  management = false,
}: GitMergeSectionProps) {
  const isOperationUnknown = operationState === null;
  const isOperationFailed = Boolean(operationState && !operationState.success);
  const isInProgress = Boolean(operationState && operationState.success && operationState.inProgress);
  const isClean = Boolean(operationState && operationState.success && !operationState.inProgress);

  return (
    <div className={`git-menu-section${management ? ' source-control-merge' : ''}`}>
      <div className="git-menu-section-header">
        Merge
        {isInProgress ? (
          <span className="git-menu-count">Active</span>
        ) : isClean ? (
          <span className="git-menu-count">{availableMergeTargets.length}</span>
        ) : (
          <span className="git-menu-count">—</span>
        )}
      </div>

      {isLoadingOperation ? (
        <div className="git-menu-empty">Checking merge state…</div>
      ) : isOperationUnknown ? (
        <div className="git-menu-empty">Merge state is unknown. Refresh to inspect repository operations.</div>
      ) : isOperationFailed ? (
        <div className="git-menu-empty">{operationState.message || operationState.error || 'Merge state unavailable. Refresh to retry.'}</div>
      ) : isInProgress ? (
        <div className="git-operation-panel">
          <div className={`git-operation-status ${operationState.mode}`}>
            {operationState.message}
          </div>
          {operationState.conflicts.length > 0 && (
            <div className="git-conflict-list">
              {operationState.conflicts.map((file) => (
                <span key={file} className="git-conflict-file">
                  {file}
                </span>
              ))}
            </div>
          )}
          <Button size="xs" variant="danger"
            type="button"
            className="git-operation-abort"
            onClick={onAbortOperation}
            disabled={isBusy}
          >
            Abort {operationState.mode === 'rebase' ? 'Rebase' : 'Merge'}
          </Button>
        </div>
      ) : isClean ? (
        <div className="git-merge-container">
          {management && isDetached ? (
            <p className="git-merge-warning">
              The current checkout is in a detached HEAD state. Merging into a detached HEAD is disabled to prevent unreferenced commits.
            </p>
          ) : management && !currentBranch ? (
            <p className="git-merge-warning">
              No branch is currently checked out. Merging requires a checked-out branch.
            </p>
          ) : management && availableMergeTargets.length === 0 ? (
            <p className="git-merge-warning">
              No other branches available to merge into {currentBranch}.
            </p>
          ) : management && currentBranch && mergeTargetBranch ? (
            <p className="git-merge-direction">
              Merge branch <strong>{mergeTargetBranch}</strong> into <strong>{currentBranch}</strong> (<code>git merge {mergeTargetBranch}</code>)
            </p>
          ) : null}
          <div className="git-merge-form">
            <Select
              className="git-merge-select"
              value={mergeTargetBranch}
              onChange={(event) => onSetMergeTargetBranch(event.target.value)}
              disabled={isBusy || isDetached || (management && !currentBranch) || availableMergeTargets.length === 0}
            >
              {availableMergeTargets.length === 0 ? (
                <option value="">No branches available</option>
              ) : (
                availableMergeTargets.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))
              )}
            </Select>
            <Button size="xs"
              type="button"
              className="header-btn git-create-branch-submit"
              onClick={onMergeBranch}
              disabled={isBusy || isDetached || (management && !currentBranch) || !mergeTargetBranch}
              aria-label={management && currentBranch && mergeTargetBranch ? `Merge ${mergeTargetBranch} into ${currentBranch}` : management ? 'Merge branch' : undefined}
              title={management && currentBranch && mergeTargetBranch ? `Merge ${mergeTargetBranch} into ${currentBranch}` : undefined}
            >
              {activeAction?.startsWith('merge:') ? <Loader2 size={13} className="spin" /> : null}
              Merge
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
