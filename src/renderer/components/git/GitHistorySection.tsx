import { Button } from '../ui/Button';
import { Loader2, AlertCircle } from 'lucide-react';
import type { DiffMode, GitDiffResult, GitHistoryEntry } from './types';
import './GitHistorySection.css';

export interface GitHistorySectionProps {
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
  management?: boolean;
  diffError?: string | null;
  hasMoreHistory?: boolean;
  onLoadMoreHistory?: () => void;
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
  management = false,
  diffError,
  hasMoreHistory = false,
  onLoadMoreHistory,
}: GitHistorySectionProps) {
  const summaryTitle = selectedDiffMode === 'working'
    ? 'Working Changes Summary'
    : selectedDiffMode === 'staged'
      ? 'Staged Changes Summary'
      : selectedCommit
        ? `Commit Summary · ${selectedCommit.shortHash}`
        : selectedDiffRef
          ? `Commit Summary · ${selectedDiffRef.slice(0, 7)}`
          : 'Commit Summary';

  const summaryDescription = selectedDiffMode === 'working'
    ? 'Summary of uncommitted modifications in the working tree (git diff --stat --summary)'
    : selectedDiffMode === 'staged'
      ? 'Summary of changes staged for the next commit (git diff --cached --stat --summary)'
      : 'Summary of files changed in this commit (git show --stat --summary)';

  const emptyText = management
    ? selectedDiffMode === 'working'
      ? 'No uncommitted working tree changes'
      : selectedDiffMode === 'staged'
        ? 'No staged changes'
        : 'No file changes recorded in this commit'
    : 'No diff to display';

  return (
    <div className={`git-menu-section${management ? ' source-control-history' : ''}`}>
      <div className="git-menu-section-header">
        History
        <span className="git-menu-count">{history.length}</span>
      </div>

      <div className="git-history-toolbar">
        <Button size="xs"
          type="button"
          className={`git-history-toggle ${selectedDiffMode === 'working' ? 'active' : ''}`}
          onClick={() => onSelectWorkingDiff('working')}
          disabled={isBusy}
          title="View summary of uncommitted changes in the working tree"
        >
          Working Tree
        </Button>
        <Button size="xs"
          type="button"
          className={`git-history-toggle ${selectedDiffMode === 'staged' ? 'active' : ''}`}
          onClick={() => onSelectWorkingDiff('staged')}
          disabled={isBusy}
          title="View summary of changes staged for the next commit"
        >
          Staged
        </Button>
      </div>

      {isLoadingHistory ? (
        <div className="git-menu-empty">Loading history…</div>
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
              title={`${entry.subject}\nCommit: ${entry.hash}\nAuthor: ${entry.author}\nDate: ${entry.date}`}
              aria-label={`View summary for commit ${entry.shortHash}: ${entry.subject}`}
              aria-pressed={selectedDiffMode === 'commit' && selectedDiffRef === entry.hash}
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
          {hasMoreHistory && onLoadMoreHistory && (
            <Button
              size="xs"
              variant="secondary"
              type="button"
              className="git-history-load-more"
              onClick={onLoadMoreHistory}
              disabled={isBusy || isLoadingHistory}
            >
              {isLoadingHistory ? <Loader2 size={12} className="spin" /> : null}
              Load more commits
            </Button>
          )}
        </div>
      )}

      <div className="git-diff-panel">
        <div className="git-diff-header">
          <div className="git-diff-title">
            {management ? summaryTitle : (diffResult?.title || 'Diff')}
            {selectedCommit ? (
              <span className="git-diff-subtitle">{selectedCommit.shortHash}</span>
            ) : null}
          </div>
          {isLoadingDiff && <Loader2 size={13} className="spin" />}
        </div>
        {management && (
          <p className="git-diff-description">{summaryDescription}</p>
        )}
        {management && selectedCommit && selectedDiffMode === 'commit' && (
          <div className="git-commit-details">
            <span className="git-commit-detail-item">Author: <strong>{selectedCommit.author}</strong></span>
            <span className="git-commit-detail-item">Date: <strong>{selectedCommit.date}</strong></span>
            <span className="git-commit-detail-item git-commit-hash-full" title={selectedCommit.hash}>
              SHA: <code>{selectedCommit.hash}</code>
            </span>
          </div>
        )}
        {diffError ? (
          <div className="git-diff-error">
            <AlertCircle size={13} />
            <span>{diffError}</span>
          </div>
        ) : null}
        <pre className="git-diff-output">
          {diffResult?.output || emptyText}
        </pre>
      </div>
    </div>
  );
}
