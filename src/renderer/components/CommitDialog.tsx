import { useState, useEffect, useRef } from 'react';
import { X, Check, Loader2 } from 'lucide-react';

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
  changes: GitStatus[];
}

export default function CommitDialog({
  isOpen,
  onClose,
  onCommit,
  onStageAll,
  changes,
}: CommitDialogProps) {
  const [message, setMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setMessage('');
      setError(null);
      setIsCommitting(false);
      // Focus the input after a brief delay
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

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

    try {
      const result = await onCommit(message);
      if (result.success) {
        setMessage('');
        onClose();
      } else {
        setError(result.error || 'Failed to create commit');
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setIsCommitting(false);
    }
  };

  const handleStageAndCommit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!message.trim()) {
      setError('Please enter a commit message');
      return;
    }

    setIsCommitting(true);
    setError(null);

    try {
      // Stage all changes first
      await onStageAll();
      // Then commit
      const result = await onCommit(message);
      if (result.success) {
        setMessage('');
        onClose();
      } else {
        setError(result.error || 'Failed to create commit');
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setIsCommitting(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
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

  if (!isOpen) return null;

  const hasChanges = changes.length > 0;
  const hasUnstagedChanges = changes.some((c) => !c.staged);

  return (
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
              <label className="commit-message-label" htmlFor="commit-message">
                Commit Message
              </label>
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
                {hasUnstagedChanges && (
                  <button
                    type="button"
                    className="commit-stage-btn"
                    onClick={onStageAll}
                    disabled={isCommitting}
                  >
                    Stage All
                  </button>
                )}
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
                      {change.staged && (
                        <span className="commit-file-staged" title="Staged">
                          <Check size={12} />
                        </span>
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
            <button
              type="button"
              className="header-btn"
              onClick={onClose}
              disabled={isCommitting}
            >
              Cancel
            </button>
            {hasUnstagedChanges ? (
              <button
                type="submit"
                className="header-btn header-btn-primary"
                disabled={isCommitting || !message.trim()}
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
                disabled={isCommitting || !message.trim()}
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
        </form>
      </div>
    </div>
  );
}
