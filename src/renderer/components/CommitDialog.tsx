import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Check, Loader2, Sparkles, Eye } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { AiCommitSettings } from '../types/shared';
import DiffViewer from './DiffViewer';
import type { DiffViewerState } from './git/diffTypes';
import { initialDiffViewerState } from './git/diffTypes';
import './CommitDialog.css';

interface GitStatus {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';
  staged: boolean;
}

interface CommitDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCommit: (message: string) => Promise<{ success: boolean; error?: string }>;
  onStageAll: () => void;
  onUnstage: (path: string) => Promise<{ success: boolean; error?: string }>;
  onUnstageAll: () => Promise<{ success: boolean; error?: string }>;
  changes: GitStatus[];
  workspacePath: string;
}

export default function CommitDialog({
  isOpen,
  onClose,
  onCommit,
  onStageAll,
  onUnstage,
  onUnstageAll,
  changes,
  workspacePath,
}: CommitDialogProps) {
  const [message, setMessage] = useState('');
  const [aiSettings, setAiSettings] = useState<AiCommitSettings | null>(null);
  const pushBrowserOverlay = useWorkspaceStore((state) => state.pushBrowserOverlay);
  const popBrowserOverlay = useWorkspaceStore((state) => state.popBrowserOverlay);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUnstaging, setIsUnstaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commitStatus, setCommitStatus] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [unstagingPaths, setUnstagingPaths] = useState<Set<string>>(new Set());
  const [diffState, setDiffState] = useState<DiffViewerState>(initialDiffViewerState);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setMessage('');
      setError(null);
      setIsCommitting(false);
      setIsGenerating(false);
      setIsUnstaging(false);
      setCommitStatus(null);
      setUnstagingPaths(new Set());
      // Focus the input after a brief delay
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setAiSettings(null);
      return;
    }

    let cancelled = false;

    const loadSettings = async () => {
      try {
        const settings = await window.electronAPI.getAiCommitSettings();
        if (!cancelled) {
          setAiSettings(settings);
        }
      } catch {
        if (!cancelled) {
          setAiSettings(null);
        }
      }
    };

    loadSettings();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (!activeWorkspaceId) {
      return;
    }

    pushBrowserOverlay(activeWorkspaceId);
    return () => popBrowserOverlay(activeWorkspaceId);
  }, [activeWorkspaceId, isOpen, pushBrowserOverlay, popBrowserOverlay]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!message.trim()) {
      setError('Please enter a commit message');
      return;
    }

    setIsCommitting(true);
    setError(null);
    setCommitStatus(hasUnstagedChanges ? 'Staging changes...' : 'Running git hooks...');

    try {
      if (hasUnstagedChanges) {
        await onStageAll();
        setCommitStatus('Running git hooks...');
      }

      const result = await onCommit(message);
      if (result.success) {
        setMessage('');
        onClose();
      } else {
        setError(result.error || 'Failed to create commit');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsCommitting(false);
      setCommitStatus(null);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleGenerateMessage = async () => {
    if (!workspacePath || isGenerating) {
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const result = await window.electronAPI.generateCommitMessage(workspacePath);
      if (result.success && result.message) {
        setMessage(result.message);
        window.setTimeout(() => inputRef.current?.focus(), 0);
      } else {
        setError(result.error || 'Failed to generate commit message');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate commit message');
    } finally {
      setIsGenerating(false);
    }
  };

  const getStatusBadge = (status: GitStatus['status']) => {
    const badges: Record<string, string> = {
      modified: 'M',
      added: 'A',
      deleted: 'D',
      untracked: '??',
      renamed: 'R',
    };
    return badges[status] || '?';
  };

  const handleUnstageFile = useCallback(
    async (path: string) => {
      if (isUnstaging || isCommitting) return;

      setUnstagingPaths((prev) => new Set(prev).add(path));

      try {
        const result = await onUnstage(path);
        if (!result.success) {
          setError(result.error || 'Failed to unstage file');
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to unstage file');
      } finally {
        setUnstagingPaths((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    [isUnstaging, isCommitting, onUnstage]
  );

  const handleUnstageAll = useCallback(async () => {
    if (isUnstaging || isCommitting) return;

    setIsUnstaging(true);
    setError(null);

    try {
      const result = await onUnstageAll();
      if (!result.success) {
        setError(result.error || 'Failed to unstage files');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to unstage files');
    } finally {
      setIsUnstaging(false);
    }
  }, [isUnstaging, isCommitting, onUnstageAll]);

  const handleViewFileDiff = useCallback(
    async (filePath: string, mode: 'working' | 'staged') => {
      if (!workspacePath) return;

      setDiffState({
        ...initialDiffViewerState,
        isOpen: true,
        filePath,
        isLoading: true,
      });

      try {
        const result = await window.electronAPI.gitGetFileDiff(
          workspacePath,
          filePath,
          mode
        );

        if (result.success) {
          setDiffState({
            ...initialDiffViewerState,
            isOpen: true,
            filePath,
            oldContent: result.oldContent,
            newContent: result.newContent,
            oldPath: result.oldPath,
            newPath: result.newPath,
            isBinary: result.isBinary,
            hasDiff: result.hasDiff,
            isLoading: false,
            error: null,
          });
        } else {
          setDiffState({
            ...initialDiffViewerState,
            isOpen: true,
            filePath,
            isLoading: false,
            error: result.error || 'Failed to load diff',
          });
        }
      } catch {
        setDiffState({
          ...initialDiffViewerState,
          isOpen: true,
          filePath,
          isLoading: false,
          error: 'Failed to load diff',
        });
      }
    },
    [workspacePath]
  );

  const handleCloseDiff = useCallback(() => {
    setDiffState(initialDiffViewerState);
  }, []);

  if (!isOpen) return null;

  const hasChanges = changes.length > 0;
  const hasUnstagedChanges = changes.some((c) => !c.staged);
  const hasStagedChanges = changes.some((c) => c.staged);
  const aiCommitEnabled = Boolean(aiSettings?.enabled);
  const isBusy = isCommitting || isUnstaging;

  return (
    <>
    <div className="commit-dialog-overlay" onClick={handleOverlayClick}>
      <div className="commit-dialog">
        <div className="commit-dialog-header">
          <h2>Create Commit</h2>
          <button className="commit-dialog-close" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="commit-dialog-body">
            {error && <div className="commit-error">{error}</div>}

            <div>
              <div className="commit-message-header">
                <label className="commit-message-label" htmlFor="commit-message">
                  Commit Message
                </label>
                {aiCommitEnabled && hasChanges && (
                  <button
                    type="button"
                    className="commit-ai-btn"
                    onClick={() => void handleGenerateMessage()}
                    disabled={isCommitting || isGenerating}
                    title="Generate commit message with AI"
                  >
                    {isGenerating ? (
                      <Loader2 size={12} className="spin" />
                    ) : (
                      <Sparkles size={12} />
                    )}
                    <span>Generate</span>
                  </button>
                )}
              </div>
              <textarea
                ref={inputRef}
                id="commit-message"
                className="commit-message-input"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe your changes..."
                disabled={isCommitting}
                rows={3}
              />
            </div>

            <div className="commit-files-section">
              <div className="commit-files-header">
                <span className="commit-files-title">
                  {hasChanges
                    ? `${changes.length} file${changes.length !== 1 ? 's' : ''} changed`
                    : 'No changes'}
                </span>
                <div className="commit-files-header-actions">
                  {hasStagedChanges && (
                    <button
                      type="button"
                      className="commit-unstage-btn"
                      onClick={() => void handleUnstageAll()}
                      disabled={isBusy}
                    >
                      {isUnstaging ? 'Unstaging...' : 'Unstage All'}
                    </button>
                  )}
                  {hasUnstagedChanges && (
                    <button
                      type="button"
                      className="commit-stage-btn"
                      onClick={onStageAll}
                      disabled={isBusy}
                    >
                      Stage All
                    </button>
                  )}
                </div>
              </div>

              {hasChanges ? (
                <div className="commit-files-list">
                  {changes.map((change, index) => (
                    <div key={index} className="commit-file-item">
                      <span className={`commit-file-status ${change.status}`}>
                        {getStatusBadge(change.status)}
                      </span>
                      <span className="commit-file-path" title={change.path}>
                        {change.path}
                      </span>
                      <button
                        type="button"
                        className="commit-file-diff-action"
                        onClick={() => void handleViewFileDiff(change.path, change.staged ? 'staged' : 'working')}
                        disabled={isBusy}
                        title="View diff"
                      >
                        <Eye size={12} />
                      </button>
                      {change.staged && (
                        <>
                          <span className="commit-file-staged" title="Staged">
                            <Check size={12} />
                          </span>
                          <button
                            type="button"
                            className="commit-file-unstage"
                            onClick={() => void handleUnstageFile(change.path)}
                            disabled={isBusy || unstagingPaths.has(change.path)}
                            title="Unstage this file"
                          >
                            {unstagingPaths.has(change.path) ? '...' : 'unstage'}
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="commit-no-changes">Working directory is clean</div>
              )}
            </div>
          </div>

          <div className="commit-dialog-footer">
            <div className="commit-status" aria-live="polite">
              {isCommitting && commitStatus && (
                <>
                  <Loader2 size={12} className="spin" />
                  <span>{commitStatus}</span>
                </>
              )}
            </div>
            <div className="commit-dialog-actions">
              <button
                type="button"
                className="header-btn"
                onClick={onClose}
                disabled={isBusy}
              >
                Cancel
              </button>
              {hasUnstagedChanges ? (
                <button
                  type="submit"
                  className="header-btn header-btn-primary"
                  disabled={isBusy || !message.trim()}
                >
                  {isCommitting ? (
                    <>
                      <Loader2 size={15} className="spin" />
                      Stage & Commit
                    </>
                  ) : (
                    'Stage All & Commit'
                  )}
                </button>
              ) : (
                <button
                  type="submit"
                  className="header-btn header-btn-primary"
                  disabled={isBusy || !message.trim()}
                >
                  {isCommitting ? (
                    <>
                      <Loader2 size={15} className="spin" />
                      Commit
                    </>
                  ) : (
                    'Commit'
                  )}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
    {diffState.isOpen && (
      <DiffViewer
        oldContent={diffState.oldContent}
        newContent={diffState.newContent}
        oldPath={diffState.oldPath}
        newPath={diffState.newPath}
        isBinary={diffState.isBinary}
        hasDiff={diffState.hasDiff}
        isLoading={diffState.isLoading}
        error={diffState.error}
        onClose={handleCloseDiff}
      />
    )}
    </>
  );
}
