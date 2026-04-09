import { useMemo } from 'react';
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

type SideType = 'added' | 'removed' | 'context' | 'empty';

interface DiffRow {
  oldLineNo: number | null;
  newLineNo: number | null;
  oldText: string;
  newText: string;
  oldType: SideType;
  newType: SideType;
}

/**
 * Convert diff Changes to aligned DiffRow rows for side-by-side rendering.
 *
 * Algorithm:
 * - Context emits paired left+right rows.
 * - Removed or added emits a row with the other side empty.
 * - A removed hunk immediately followed by an added hunk is "zipped" so edits
 *   appear on the same visual row where possible.
 */
function buildSideBySideRows(changes: Change[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = 1;
  let newLine = 1;

  const splitValue = (value: string): string[] => {
    // `diff` values usually end with a trailing `\n`. Preserve intentional empty
    // lines but drop the trailing empty chunk from `split`.
    const parts = value.split('\n');
    if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
    return parts;
  };

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];

    // Pair adjacent removed+added hunks so edits line up visually.
    const next = i + 1 < changes.length ? changes[i + 1] : null;
    if (change.removed && next?.added) {
      const removedLines = splitValue(change.value);
      const addedLines = splitValue(next.value);
      const max = Math.max(removedLines.length, addedLines.length);

      for (let j = 0; j < max; j++) {
        const hasOld = j < removedLines.length;
        const hasNew = j < addedLines.length;
        rows.push({
          oldLineNo: hasOld ? oldLine++ : null,
          newLineNo: hasNew ? newLine++ : null,
          oldText: hasOld ? removedLines[j] : '',
          newText: hasNew ? addedLines[j] : '',
          oldType: hasOld ? 'removed' : 'empty',
          newType: hasNew ? 'added' : 'empty',
        });
      }

      i += 1;
      continue;
    }

    if (change.removed) {
      for (const line of splitValue(change.value)) {
        rows.push({
          oldLineNo: oldLine++,
          newLineNo: null,
          oldText: line,
          newText: '',
          oldType: 'removed',
          newType: 'empty',
        });
      }
      continue;
    }

    if (change.added) {
      for (const line of splitValue(change.value)) {
        rows.push({
          oldLineNo: null,
          newLineNo: newLine++,
          oldText: '',
          newText: line,
          oldType: 'empty',
          newType: 'added',
        });
      }
      continue;
    }

    for (const line of splitValue(change.value)) {
      rows.push({
        oldLineNo: oldLine++,
        newLineNo: newLine++,
        oldText: line,
        newText: line,
        oldType: 'context',
        newType: 'context',
      });
    }
  }

  return rows;
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
  const diffLinesResult = useMemo(() => {
    return diffLines(oldContent, newContent);
  }, [oldContent, newContent]);

  const rows = useMemo(() => {
    return buildSideBySideRows(diffLinesResult);
  }, [diffLinesResult]);

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
              <table className="diff-viewer-table">
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={idx} className="diff-viewer-row">
                      <td className={`diff-viewer-line-no diff-viewer-line-no-${row.oldType}`}>
                        {row.oldLineNo ?? ''}
                      </td>
                      <td className={`diff-viewer-cell diff-viewer-cell-${row.oldType}`}>
                        <pre>{row.oldType === 'empty' ? '\u00A0' : row.oldText}</pre>
                      </td>
                      <td
                        className={`diff-viewer-line-no diff-viewer-line-no-${row.newType} diff-viewer-line-no-right`}
                      >
                        {row.newLineNo ?? ''}
                      </td>
                      <td className={`diff-viewer-cell diff-viewer-cell-${row.newType}`}>
                        <pre>{row.newType === 'empty' ? '\u00A0' : row.newText}</pre>
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
  );
}
