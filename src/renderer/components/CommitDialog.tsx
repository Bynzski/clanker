import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Check, Loader2, Sparkles, Eye } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { AiCommitSettings } from '../types/shared';
import DiffViewer from './DiffViewer';
import type { DiffViewerState } from './git/diffTypes';
import { initialDiffViewerState } from './git/diffTypes';
import { Dialog, DialogContent, DialogTitle, DialogClose } from './ui/Dialog';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { Textarea } from './ui/Textarea';
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
  onStageAll: () => void | Promise<{ success: boolean; error?: string }>;
  onUnstage: (path: string) => Promise<{ success: boolean; error?: string }>;
  onUnstageAll: () => Promise<{ success: boolean; error?: string }>;
  changes: GitStatus[];
  workspacePath: string;
  workspaceId?: string;
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
  workspaceId,
}: CommitDialogProps) {
  const [message, setMessage] = useState('');
  const [aiSettings, setAiSettings] = useState<AiCommitSettings | null>(null);
  const isRemoteWorkspace = useWorkspaceStore((state) => {
    const workspace = state.workspaces.find((entry) => entry.id === (workspaceId ?? state.activeWorkspaceId));
    return workspace ? !!workspace.environmentId && workspace.environmentId !== 'local' : !!workspaceId;
  });
  const [isCommitting, setIsCommitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUnstaging, setIsUnstaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commitStatus, setCommitStatus] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const generationRef = useRef(0);
  const draftRevisionRef = useRef(0);
  const changesIdentity = JSON.stringify(changes);
  const changesIdentityRef = useRef(changesIdentity);
  changesIdentityRef.current = changesIdentity;
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
    }
    generationRef.current += 1;
    return () => { generationRef.current += 1; };
  }, [isOpen, workspaceId, workspacePath]);

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


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!message.trim()) {
      setError('Please enter a commit message');
      return;
    }

    setIsCommitting(true);
    setError(null);
    setCommitStatus(hasUnstagedChanges ? 'Staging changes…' : 'Running git hooks…');

    try {
      if (hasUnstagedChanges) {
        const staged = await onStageAll();
        if (staged && !staged.success) throw new Error(staged.error || 'Failed to stage changes');
        setCommitStatus('Running git hooks…');
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


  const handleGenerateMessage = async () => {
    if (!workspacePath || isGenerating || isRemoteWorkspace) {
      return;
    }

    setIsGenerating(true);
    setError(null);
    const generation = ++generationRef.current;
    const draftRevision = draftRevisionRef.current;
    const changeSnapshot = changesIdentityRef.current;
    const isCurrent = () => generationRef.current === generation;

    try {
      const result = await window.electronAPI.generateCommitMessage(workspacePath, workspaceId);
      if (!isCurrent()) return;
      if (changesIdentityRef.current !== changeSnapshot) {
        setError('Changes updated during generation. Generate the message again.');
      } else if (draftRevisionRef.current !== draftRevision) {
        // Preserve text the user edited while the harness was working.
      } else if (result.success && result.message) {
        setMessage(result.message);
        window.setTimeout(() => inputRef.current?.focus(), 0);
      } else {
        setError(result.error || 'Failed to generate commit message');
      }
    } catch (err: unknown) {
      if (isCurrent()) setError(err instanceof Error ? err.message : 'Failed to generate commit message');
    } finally {
      if (isCurrent()) setIsGenerating(false);
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
          mode,
          workspaceId
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
    [workspacePath, workspaceId]
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
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="commit-dialog"
        overlayClassName="commit-dialog-overlay"
        workspaceId={workspaceId}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="commit-dialog-header clanker-dialog-header">
          <DialogTitle asChild>
            <h2 className="clanker-dialog-title">Create Commit</h2>
          </DialogTitle>
          <DialogClose asChild>
            <IconButton variant="ghost" className="clanker-dialog-close" aria-label="Close" title="Close">
              <X size={14} />
            </IconButton>
          </DialogClose>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="commit-dialog-body clanker-dialog-body">
            {error && <div className="commit-error">{error}</div>}

            <div>
              <div className="commit-message-header">
                <label className="commit-message-label" htmlFor="commit-message">
                  Commit Message
                </label>
                {aiCommitEnabled && hasChanges && !isRemoteWorkspace && (
                  <Button
                    size="sm"
                    variant="secondary"
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
                  </Button>
                )}
              </div>
              <Textarea
                ref={inputRef}
                id="commit-message"
                variant="mono"
                className="commit-message-input"
                value={message}
                onChange={(e) => { draftRevisionRef.current += 1; setMessage(e.target.value); }}
                placeholder="Describe your changes…"
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
                    <Button
                      size="sm"
                      variant="secondary"
                      type="button"
                      className="commit-unstage-btn"
                      onClick={() => void handleUnstageAll()}
                      disabled={isBusy}
                    >
                      {isUnstaging ? 'Unstaging…' : 'Unstage All'}
                    </Button>
                  )}
                  {hasUnstagedChanges && (
                    <Button
                      size="sm"
                      variant="secondary"
                      type="button"
                      className="commit-stage-btn"
                      onClick={onStageAll}
                      disabled={isBusy}
                    >
                      Stage All
                    </Button>
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
                      <IconButton variant="ghost"
                        size="sm"
                        className="commit-file-diff-action"
                        onClick={() => void handleViewFileDiff(change.path, change.staged ? 'staged' : 'working')}
                        disabled={isBusy}
                        aria-label={`View diff for ${change.path}`}
                        title="View diff"
                      >
                        <Eye size={12} />
                      </IconButton>
                      {change.staged && (
                        <>
                          <span className="commit-file-staged" title="Staged">
                            <Check size={12} />
                          </span>
                          <Button
                            type="button"
                            className="commit-file-unstage"
                            onClick={() => void handleUnstageFile(change.path)}
                            disabled={isBusy || unstagingPaths.has(change.path)}
                            title="Unstage this file"
                          >
                            {unstagingPaths.has(change.path) ? '...' : 'unstage'}
                          </Button>
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

          <div className="commit-dialog-footer clanker-dialog-footer">
            <div className="commit-status" aria-live="polite">
              {isCommitting && commitStatus && (
                <>
                  <Loader2 size={12} className="spin" />
                  <span>{commitStatus}</span>
                </>
              )}
            </div>
            <div className="commit-dialog-actions">
              <Button
                size="sm"
                variant="secondary"
                type="button"
                onClick={onClose}
                disabled={isBusy}
              >
                Cancel
              </Button>
              {hasUnstagedChanges ? (
                <Button
                  size="sm"
                  variant="primary"
                  type="submit"
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
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  type="submit"
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
                </Button>
              )}
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
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
        workspaceId={workspaceId}
        onClose={handleCloseDiff}
      />
    )}
    </>
  );
}
