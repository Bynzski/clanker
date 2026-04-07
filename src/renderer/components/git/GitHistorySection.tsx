import { Loader2 } from 'lucide-react';
import type { DiffMode, GitDiffResult, GitHistoryEntry } from './types';

interface GitHistorySectionProps {
  diffResult: GitDiffResult | null;
  history: GitHistoryEntry[];
  isBusy: boolean;
  isLoadingDiff: boolean;
  isLoadingHistory: boolean;
  onSelectCommitDiff: (commit: GitHistoryEntry) => void;
  onSelectWorkingDiff: (mode: DiffMode) => void;
  selectedCommit: GitHistoryEntry | null;
  selectedDiffMode: DiffMode;
  selectedDiffRef: string | null;
}

export function GitHistorySection({
  diffResult,
  history,
  isBusy,
  isLoadingDiff,
  isLoadingHistory,
  onSelectCommitDiff,
  onSelectWorkingDiff,
  selectedCommit,
  selectedDiffMode,
  selectedDiffRef,
}: GitHistorySectionProps) {
  return (
    <div className="git-menu-section">
      <div className="git-menu-section-header">
        History
        <span className="git-menu-count">{history.length}</span>
      </div>

      <div className="git-history-toolbar">
        <button
          type="button"
          className={`git-history-toggle ${selectedDiffMode === 'working' ? 'active' : ''}`}
          onClick={() => onSelectWorkingDiff('working')}
          disabled={isBusy}
        >
          Working Tree
        </button>
        <button
          type="button"
          className={`git-history-toggle ${selectedDiffMode === 'staged' ? 'active' : ''}`}
          onClick={() => onSelectWorkingDiff('staged')}
          disabled={isBusy}
        >
          Staged
        </button>
      </div>

      {isLoadingHistory ? (
        <div className="git-menu-empty">Loading history...</div>
      ) : history.length === 0 ? (
        <div className="git-menu-empty">No commits found</div>
      ) : (
        <div className="git-history-list">
          {history.map((entry) => (
            <button
              key={entry.hash}
              type="button"
              className={`git-history-item ${
                selectedDiffMode === 'commit' && selectedDiffRef === entry.hash ? 'active' : ''
              }`}
              onClick={() => onSelectCommitDiff(entry)}
              disabled={isBusy}
            >
              <div className="git-history-line">
                <span className="git-history-hash">{entry.shortHash}</span>
                <span className="git-history-subject">{entry.subject}</span>
              </div>
              <div className="git-history-meta">
                <span>{entry.author}</span>
                <span>{entry.date}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="git-diff-panel">
        <div className="git-diff-header">
          <div className="git-diff-title">
            {diffResult?.title || 'Diff'}
            {selectedCommit ? (
              <span className="git-diff-subtitle">{selectedCommit.shortHash}</span>
            ) : null}
          </div>
          {isLoadingDiff && <Loader2 size={13} className="spin" />}
        </div>
        <pre className="git-diff-output">
          {diffResult?.output || 'No diff to display'}
        </pre>
      </div>
    </div>
  );
}
