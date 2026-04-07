import { Loader2 } from 'lucide-react';
import type { GitOperationState } from './types';

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
}: GitMergeSectionProps) {
  return (
    <div className="git-menu-section">
      <div className="git-menu-section-header">
        Merge
        {operationState?.inProgress ? (
          <span className="git-menu-count">Active</span>
        ) : (
          <span className="git-menu-count">{availableMergeTargets.length}</span>
        )}
      </div>

      {isLoadingOperation ? (
        <div className="git-menu-empty">Checking merge state...</div>
      ) : operationState?.inProgress ? (
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
          <button
            type="button"
            className="git-operation-abort"
            onClick={onAbortOperation}
            disabled={isBusy}
          >
            Abort {operationState.mode === 'rebase' ? 'Rebase' : 'Merge'}
          </button>
        </div>
      ) : (
        <div className="git-merge-form">
          <select
            className="git-merge-select"
            value={mergeTargetBranch}
            onChange={(event) => onSetMergeTargetBranch(event.target.value)}
            disabled={isBusy || availableMergeTargets.length === 0}
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
          </select>
          <button
            type="button"
            className="header-btn git-create-branch-submit"
            onClick={onMergeBranch}
            disabled={isBusy || !mergeTargetBranch}
          >
            {activeAction?.startsWith('merge:') ? <Loader2 size={13} className="spin" /> : null}
            Merge
          </button>
        </div>
      )}
    </div>
  );
}
