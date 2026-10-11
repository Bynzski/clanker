import { useRef } from 'react';
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
  diffResult, history, isBusy, isLoadingDiff, isLoadingHistory,
  onSelectCommitDiff, onSelectWorkingDiff, selectedCommit, selectedDiffMode,
  selectedDiffRef, management = false, diffError, hasMoreHistory = false, onLoadMoreHistory,
}: GitHistorySectionProps) {
  const summaryRef = useRef<HTMLHeadingElement>(null);
  const summaryTitle = selectedDiffMode === 'working'
    ? 'Working Changes Summary'
    : selectedDiffMode === 'staged' ? 'Staged Changes Summary'
      : selectedCommit ? `Commit Summary · ${selectedCommit.shortHash}`
        : selectedDiffRef ? `Commit Summary · ${selectedDiffRef.slice(0, 7)}` : 'Commit Summary';
  const summaryDescription = selectedDiffMode === 'working'
    ? 'Summary of uncommitted modifications in the working tree'
    : selectedDiffMode === 'staged' ? 'Summary of changes staged for the next commit'
      : 'Summary of files changed in this commit';
  const emptyText = management
    ? selectedDiffMode === 'working' ? 'No uncommitted working tree changes'
      : selectedDiffMode === 'staged' ? 'No staged changes' : 'No file changes recorded in this commit'
    : 'No diff to display';
  const summary = <div className="git-diff-panel">
    <div className="git-diff-header">
      <h3 ref={summaryRef} tabIndex={management ? -1 : undefined} className="git-diff-title">
        {management ? summaryTitle : (diffResult?.title || 'Diff')}
        {!management && selectedCommit && <span className="git-diff-subtitle">{selectedCommit.shortHash}</span>}
      </h3>
      {isLoadingDiff && <Loader2 size={13} className="spin" aria-label="Loading summary" />}
    </div>
    {management && <p className="git-diff-description">{summaryDescription}</p>}
    {management && selectedDiffRef && selectedDiffMode === 'commit' && <div className="git-commit-details">
      {selectedCommit && <>
        <span className="git-commit-detail-item">Author: <strong>{selectedCommit.author}</strong></span>
        <span className="git-commit-detail-item">Date: <strong>{selectedCommit.date}</strong></span>
      </>}
      <span className="git-commit-detail-item git-commit-hash-full" title={selectedDiffRef}>SHA: <code>{selectedDiffRef}</code></span>
    </div>}
    {diffError && <div className="git-diff-error" role="alert"><AlertCircle size={13} /><span>{diffError}</span></div>}
    <pre className="git-diff-output" aria-busy={isLoadingDiff}>
      {isLoadingDiff ? 'Loading summary…' : diffError || (diffResult && !diffResult.success)
        ? 'Summary unavailable' : diffResult?.success ? diffResult.output || emptyText : 'Select a summary to view'}
    </pre>
  </div>;

  return <div className={`git-menu-section${management ? ' source-control-history' : ''}`}>
    <div className="git-history-toolbar" aria-label="Change summaries">
      {(['working', 'staged'] as const).map(mode => <Button key={mode} size="xs" type="button"
        className={`git-history-toggle ${selectedDiffMode === mode ? 'active' : ''}`}
        aria-pressed={selectedDiffMode === mode} onClick={() => onSelectWorkingDiff(mode)} disabled={isBusy}
        title={`View summary of ${mode === 'working' ? 'uncommitted' : 'staged'} changes`}>
        {mode === 'working' ? 'Working Tree' : 'Staged'}
      </Button>)}
    </div>
    {management && summary}
    <h3 className="git-menu-section-header">{management ? 'Commits' : 'History'} <span className="git-menu-count">{history.length}</span></h3>
    {isLoadingHistory ? <div className="git-menu-empty" role="status">Loading history…</div>
      : history.length === 0 ? <div className="git-menu-empty">No commits found</div>
        : <div className="git-history-list">
          {history.map(entry => <button key={entry.hash} type="button"
            className={`git-history-item ${selectedDiffMode === 'commit' && selectedDiffRef === entry.hash ? 'active' : ''}`}
            onClick={() => {
              onSelectCommitDiff(entry);
              if (management) {
                summaryRef.current?.scrollIntoView({ block: 'start' });
                summaryRef.current?.focus({ preventScroll: true });
              }
            }} disabled={isBusy}
            title={`${entry.subject}\nCommit: ${entry.hash}\nAuthor: ${entry.author}\nDate: ${entry.date}`}
            aria-label={`View summary for commit ${entry.shortHash}: ${entry.subject}`}
            aria-pressed={selectedDiffMode === 'commit' && selectedDiffRef === entry.hash}>
            <div className="git-history-line"><span className="git-history-hash">{entry.shortHash}</span><span className="git-history-subject">{entry.subject}</span></div>
            <div className="git-history-meta"><span>{entry.author}</span><span>{entry.date}</span></div>
          </button>)}
          {hasMoreHistory && onLoadMoreHistory && <Button size="xs" variant="secondary" type="button"
            className="git-history-load-more" onClick={onLoadMoreHistory} disabled={isBusy || isLoadingHistory}>
            Load more commits
          </Button>}
        </div>}
    {!management && summary}
  </div>;
}
