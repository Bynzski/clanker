import { useMemo, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useDragHandle } from './dragHandleContext';
import { useScopedWorkspace, useScopedWorkspaceActivity } from './WorkspaceScope';
import {
  getNotesContentStorageKey,
  readStoredNote,
  writeStoredNote,
} from '../lib/notesStorage';
import './NotesPane.css';

export default function NotesPane({ workspaceId }: { workspaceId?: string }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const workspace = useScopedWorkspace(workspaceId);
  const isInteractive = useScopedWorkspaceActivity(workspaceId);
  const closeNotesPane = useWorkspaceStore((state) => state.closeNotesPane);
  const dragHandleProps = useDragHandle();
  const headerDragHandleProps = isInteractive ? dragHandleProps : undefined;
  const notesVisible = workspace?.notesVisible ?? false;
  const storageKey = useMemo(
    () => getNotesContentStorageKey(workspace?.workspacePath ?? '', workspace?.id ?? null),
    [workspace?.id, workspace?.workspacePath],
  );
  const initialContent = useMemo(() => readStoredNote(storageKey), [storageKey]);

  useEffect(() => {
    if (panelRef.current == null) {
      return;
    }

    panelRef.current.inert = !isInteractive;
    panelRef.current.setAttribute('aria-hidden', isInteractive ? 'false' : 'true');

    if (!isInteractive && panelRef.current.contains(document.activeElement)) {
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  }, [isInteractive]);

  const handleClosePane = () => {
    if (!isInteractive) {
      return;
    }
    closeNotesPane(workspaceId);
  };

  return (
    <div
      ref={panelRef}
      className={`notes-panel${notesVisible ? '' : ' notes-panel--hidden'}`}
      data-workspace-interactive={isInteractive ? 'true' : 'false'}
    >
      <div className="notes-pane-header">
        <div className="pane-drag-surface" title="Drag to move pane" aria-label="Move notes pane" {...headerDragHandleProps}>
          <div className="notes-pane-drag-handle" aria-hidden="true" />
          <span className="notes-pane-title">Notes</span>
          <span className="notes-pane-spacer" />
        </div>
        <button
          className="notes-pane-close-btn"
          onClick={handleClosePane}
          title="Close notes"
          aria-label="Close notes"
          disabled={!isInteractive}
        >
          <X size={12} strokeWidth={2} />
        </button>
      </div>
      <textarea
        key={storageKey}
        className="notes-editor"
        defaultValue={initialContent}
        placeholder="Notes..."
        spellCheck
        onChange={(event) => writeStoredNote(storageKey, event.currentTarget.value)}
      />
    </div>
  );
}
