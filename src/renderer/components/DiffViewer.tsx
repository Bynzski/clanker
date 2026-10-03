import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { getEditorTheme } from '../theme/editorTheme';
import { useThemeStore } from '../theme/themeStore';
import { MergeView } from '@codemirror/merge';
import { getLanguageExtension } from '../lib/editorLanguage';
import { Dialog, DialogContent, DialogTitle, DialogClose } from './ui/Dialog';
import { IconButton } from './ui/IconButton';
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
  /** Workspace identity for browser view suppression */
  workspaceId?: string;
};

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
  workspaceId,
}: DiffViewerProps) {
  const theme = useThemeStore((state) => state.theme);
  const mergeViewRef = useRef<MergeView | null>(null);
  const themeARef = useRef(new Compartment());
  const themeBRef = useRef(new Compartment());
  const appliedThemeRef = useRef(theme);
  const [mergeRoot, setMergeRoot] = useState<HTMLDivElement | null>(null);
  const languageExtension = useMemo(
    () => getLanguageExtension(newPath || oldPath || ''),
    [newPath, oldPath]
  );

  useEffect(() => {
    if (!mergeRoot || isLoading || Boolean(error) || isBinary || !hasDiff) {
      return;
    }

    mergeRoot.replaceChildren();
    const currentTheme = useThemeStore.getState().theme;
    const mergeView = new MergeView({
      parent: mergeRoot,
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
          themeARef.current.of(getEditorTheme(currentTheme)),
          languageExtension,
        ],
      },
      b: {
        doc: newContent,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          lineNumbers(),
          themeBRef.current.of(getEditorTheme(currentTheme)),
          languageExtension,
        ],
      },
    });

    mergeViewRef.current = mergeView;
    appliedThemeRef.current = currentTheme;
    return () => {
      mergeViewRef.current = null;
      mergeView.destroy();
    };
  }, [mergeRoot, error, hasDiff, isBinary, isLoading, languageExtension, newContent, oldContent]);

  useEffect(() => {
    const mergeView = mergeViewRef.current;
    if (!mergeView || appliedThemeRef.current === theme) return;
    mergeView.a.dispatch({ effects: themeARef.current.reconfigure(getEditorTheme(theme)) });
    mergeView.b.dispatch({ effects: themeBRef.current.reconfigure(getEditorTheme(theme)) });
    appliedThemeRef.current = theme;
  }, [theme]);
  const title = isLoading ? 'Loading diff…' : error ? 'Diff Error' : newPath;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="diff-viewer-modal"
        overlayClassName="diff-viewer-overlay"
        workspaceId={workspaceId}
        aria-describedby={undefined}
      >
        <div className="diff-viewer-header clanker-dialog-header">
          <DialogTitle asChild>
            <h2 className="clanker-dialog-title">{title}</h2>
          </DialogTitle>
          <DialogClose asChild>
            <IconButton variant="ghost" className="clanker-dialog-close" aria-label="Close" title="Close">
              <X size={14} />
            </IconButton>
          </DialogClose>
        </div>

        {isLoading ? (
          <div className="diff-viewer-loading">
            <span>Loading…</span>
          </div>
        ) : error ? (
          <div className="diff-viewer-error">
            <span>{error}</span>
          </div>
        ) : isBinary ? (
          <div className="diff-viewer-binary">
            <span>Binary file — diff not shown</span>
          </div>
        ) : !hasDiff ? (
          <div className="diff-viewer-no-changes">
            <span>No changes</span>
          </div>
        ) : (
          <div className="diff-viewer-body">
            <div className="diff-viewer-pane-container">
              <div className="diff-viewer-pane-headers">
                <div className="diff-viewer-pane-header">{oldPath || '(new file)'}</div>
                <div className="diff-viewer-pane-header">{newPath || '(deleted)'}</div>
              </div>
              <div className="diff-viewer-unified-content">
                <div className="diff-viewer-merge-root" ref={setMergeRoot} />
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
