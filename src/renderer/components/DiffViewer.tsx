import { useMemo, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { diffLines, type Change } from 'diff';
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

interface DiffLine {
  type: 'added' | 'removed' | 'context';
  oldLineNo: number | null;
  newLineNo: number | null;
  content: string;
}

/**
 * Convert diff Changes to aligned DiffLine rows for side-by-side rendering.
 *
 * Algorithm: walk through changes. For context and removed lines, emit rows
 * with both sides populated. For added lines with no corresponding removed
 * line at the same position, emit a row with an empty left side.
 */
function buildSideBySideLines(changes: Change[]): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const change of changes) {
    const count = change.count ?? 0;

    if (change.removed) {
      // Removed lines: left side has content, right side is blank
      for (let i = 0; i < count; i++) {
        lines.push({
          type: 'removed',
          oldLineNo: oldLine++,
          newLineNo: null,
          content: change.value.split('\n').filter((_l: string, idx: number) => idx === i).join('') || '',
        });
      }
    } else if (change.added) {
      // Added lines: right side has content, left side is blank
      for (let i = 0; i < count; i++) {
        lines.push({
          type: 'added',
          oldLineNo: null,
          newLineNo: newLine++,
          content: change.value.split('\n').filter((_l: string, idx: number) => idx === i).join('') || '',
        });
      }
    } else {
      // Context lines: both sides have same content
      for (let i = 0; i < count; i++) {
        lines.push({
          type: 'context',
          oldLineNo: oldLine++,
          newLineNo: newLine++,
          content: change.value.split('\n').filter((_l: string, idx: number) => idx === i).join('') || '',
        });
      }
    }
  }

  return lines;
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
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const isScrollSyncing = useRef(false);

  const diffLines_result = useMemo(() => {
    return diffLines(oldContent, newContent);
  }, [oldContent, newContent]);

  const rows = useMemo(() => {
    return buildSideBySideLines(diffLines_result);
  }, [diffLines_result]);

  const handleScroll = useCallback(
    (source: 'left' | 'right') => {
      if (isScrollSyncing.current) return;
      isScrollSyncing.current = true;

      const src = source === 'left' ? leftRef.current : rightRef.current;
      const target = source === 'left' ? rightRef.current : leftRef.current;

      if (src && target) {
        target.scrollTop = src.scrollTop;
        target.scrollLeft = src.scrollLeft;
      }

      requestAnimationFrame(() => {
        isScrollSyncing.current = false;
      });
    },
    []
  );

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
            {/* Left pane (old) */}
            <div className="diff-viewer-pane">
              <div className="diff-viewer-pane-header">{oldPath || '(new file)'}</div>
              <div
                className="diff-viewer-pane-content"
                ref={leftRef}
                onScroll={() => handleScroll('left')}
              >
                <table className="diff-viewer-table">
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr key={idx} className={`diff-viewer-row diff-viewer-row-${row.type}`}>
                        <td className="diff-viewer-line-no">
                          {row.oldLineNo ?? ''}
                        </td>
                        <td className={`diff-viewer-cell diff-viewer-cell-${row.type}`}>
                          <pre>{row.content}</pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {/* Right pane (new) */}
            <div className="diff-viewer-pane">
              <div className="diff-viewer-pane-header">{newPath || '(deleted)'}</div>
              <div
                className="diff-viewer-pane-content"
                ref={rightRef}
                onScroll={() => handleScroll('right')}
              >
                <table className="diff-viewer-table">
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr key={idx} className={`diff-viewer-row diff-viewer-row-${row.type}`}>
                        <td className="diff-viewer-line-no">
                          {row.newLineNo ?? ''}
                        </td>
                        <td className={`diff-viewer-cell diff-viewer-cell-${row.type}`}>
                          <pre>{row.content}</pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
