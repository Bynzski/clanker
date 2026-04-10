import { useEffect, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { MergeView } from '@codemirror/merge';
import { getLanguageExtension } from '../lib/editorLanguage';
import './DiffViewer.css';

export interface DiffViewerProps {
  /** Content from HEAD (old version) */
  oldContent: string;
  /** Content from working tree or index (new version) */
  newContent: string;
  /** File path label for old side */
  oldPath: string;
  /** File path label for new side */
  newPath: string;
  /** Whether the file is binary */
  isBinary: boolean;
  /** Whether old and new content differ */
  hasDiff: boolean;
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** Close handler */
  onClose: () => void;
}

export default function DiffViewer({
  oldContent,
  newContent,
  oldPath,
  newPath,
  isBinary,
  hasDiff,
  isLoading,
  error,
  onClose,
}: DiffViewerProps) {
  const mergeRootRef = useRef<HTMLDivElement>(null);
  const languageExtension = useMemo(
    () => getLanguageExtension(newPath || oldPath || ''),
    [newPath, oldPath]
  );

  useEffect(() => {
    const root = mergeRootRef.current;
    if (!root || isLoading || Boolean(error) || isBinary || !hasDiff) {
      return;
    }

    root.replaceChildren();
    const mergeView = new MergeView({
      parent: root,
      orientation: 'a-b',
      gutter: true,
      highlightChanges: true,
      collapseUnchanged: {
        margin: 3,
        minSize: 5,
      },
      a: {
        doc: oldContent,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          lineNumbers(),
          oneDark,
          languageExtension,
        ],
      },
      b: {
        doc: newContent,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          lineNumbers(),
          oneDark,
          languageExtension,
        ],
      },
    });

    return () => {
      mergeView.destroy();
    };
  }, [error, hasDiff, isBinary, isLoading, languageExtension, newContent, oldContent]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="diff-viewer-overlay" onClick={handleOverlayClick}>
        <div className="diff-viewer-modal">
          <div className="diff-viewer-header">
            <h2>Loading diff...</h2>
            <button className="diff-viewer-close" onClick={onClose} title="Close">
              <X size={18} />
            </button>
          </div>
          <div className="diff-viewer-loading">
            <span>Loading...</span>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="diff-viewer-overlay" onClick={handleOverlayClick}>
        <div className="diff-viewer-modal">
          <div className="diff-viewer-header">
            <h2>Diff Error</h2>
            <button className="diff-viewer-close" onClick={onClose} title="Close">
              <X size={18} />
            </button>
          </div>
          <div className="diff-viewer-error">
            <span>{error}</span>
          </div>
        </div>
      </div>
    );
  }

  // Binary file
  if (isBinary) {
    return (
      <div className="diff-viewer-overlay" onClick={handleOverlayClick}>
        <div className="diff-viewer-modal">
          <div className="diff-viewer-header">
            <h2>{newPath}</h2>
            <button className="diff-viewer-close" onClick={onClose} title="Close">
              <X size={18} />
            </button>
          </div>
          <div className="diff-viewer-binary">
            <span>Binary file — diff not shown</span>
          </div>
        </div>
      </div>
    );
  }

  // No diff
  if (!hasDiff) {
    return (
      <div className="diff-viewer-overlay" onClick={handleOverlayClick}>
        <div className="diff-viewer-modal">
          <div className="diff-viewer-header">
            <h2>{newPath}</h2>
            <button className="diff-viewer-close" onClick={onClose} title="Close">
              <X size={18} />
            </button>
          </div>
          <div className="diff-viewer-no-changes">
            <span>No changes</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="diff-viewer-overlay" onClick={handleOverlayClick}>
      <div className="diff-viewer-modal">
        <div className="diff-viewer-header">
          <h2>{newPath}</h2>
          <button className="diff-viewer-close" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>
        <div className="diff-viewer-body">
          <div className="diff-viewer-pane-container">
            <div className="diff-viewer-pane-headers">
              <div className="diff-viewer-pane-header">{oldPath || '(new file)'}</div>
              <div className="diff-viewer-pane-header">{newPath || '(deleted)'}</div>
            </div>
            <div className="diff-viewer-unified-content">
              <div className="diff-viewer-merge-root" ref={mergeRootRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
