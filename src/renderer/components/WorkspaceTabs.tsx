import { useState, useRef, useEffect, MouseEvent } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { disposeWorkspaceResources } from '../lib/workspaceLifecycle';
import { Plus, X, Check, Edit2 } from 'lucide-react';
import { normalizePath } from '../lib/pathUtils';
import './WorkspaceTabs.css';

interface WorkspaceTabsProps {
  onOpenWorkspace?: () => void;
}

export default function WorkspaceTabs({ onOpenWorkspace }: WorkspaceTabsProps) {
  const { workspaces, activeWorkspaceId, selectWorkspace, closeWorkspace, updateWorkspaceName } = useWorkspaceStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Keep the explorer watcher aligned with the active workspace.
   * Only the active workspace explorer watcher remains live. Parked workspaces
   * keep cached explorer state and refresh when activated again.
   */
  useEffect(() => {
    const syncExplorerWatcher = async (
      workspaceId: string | null,
      state = useWorkspaceStore.getState(),
    ) => {
      if (typeof window.electronAPI?.explorerStartWatching !== 'function') {
        return;
      }

      const workspace = state.getWorkspaceById(workspaceId);
      if (!workspace) {
        if (typeof window.electronAPI?.explorerStopWatching === 'function') {
          await window.electronAPI.explorerStopWatching();
        }
        return;
      }

      await window.electronAPI.explorerStartWatching(normalizePath(workspace.workspacePath));
    };

    void syncExplorerWatcher(useWorkspaceStore.getState().activeWorkspaceId);

    const unsubscribe = useWorkspaceStore.subscribe((state, prevState) => {
      if (state.activeWorkspaceId !== prevState.activeWorkspaceId) {
        void syncExplorerWatcher(state.activeWorkspaceId, state);
      }
    });

    return () => {
      unsubscribe();
      if (typeof window.electronAPI?.explorerStopWatching === 'function') {
        void window.electronAPI.explorerStopWatching();
      }
    };
  }, []);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  if (workspaces.length === 0) {
    return null;
  }

  const handleClose = async (id: string, event: MouseEvent) => {
    event.stopPropagation();

    const state = useWorkspaceStore.getState();
    const workspace = state.getWorkspaceById(id);
    if (workspace == null) {
      return;
    }

    await disposeWorkspaceResources(workspace, { isActiveWorkspace: state.activeWorkspaceId === id });
    closeWorkspace(id);
  };

  const startEditing = (id: string, currentName: string, event: MouseEvent) => {
    event.stopPropagation();
    setEditingId(id);
    setEditValue(currentName);
  };

  const saveEdit = () => {
    if (editingId && editValue.trim()) {
      updateWorkspaceName(editingId, editValue.trim());
    }
    setEditingId(null);
    setEditValue('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveEdit();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  };

  return (
    <div className="workspace-tabs" role="tablist" aria-label="Workspaces">
      {workspaces.map((workspace) => {
        const isActive = workspace.id === activeWorkspaceId;
        const isEditing = workspace.id === editingId;

        return (
          <button
            key={workspace.id}
            className={`workspace-tab ${isActive ? 'active' : ''}`}
            role="tab"
            aria-selected={isActive}
            onClick={() => !isEditing && selectWorkspace(workspace.id)}
          >
            {isEditing ? (
              <div className="workspace-tab-edit" onClick={(e) => e.stopPropagation()}>
                <input
                  ref={inputRef}
                  type="text"
                  className="workspace-tab-edit-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={saveEdit}
                />
                <button
                  className="workspace-tab-edit-btn"
                  onClick={(e) => { e.stopPropagation(); saveEdit(); }}
                  title="Save"
                >
                  <Check size={14} strokeWidth={2} />
                </button>
              </div>
            ) : (
              <>
                <span
                  className="workspace-tab-label"
                  title={workspace.name || workspace.workspacePath}
                  onDoubleClick={(e) => startEditing(workspace.id, workspace.name, e)}
                >
                  {workspace.name || workspace.workspacePath.split(/[/\\]/).pop() || 'Workspace'}
                </span>
                <button
                  className="workspace-tab-edit-trigger"
                  onClick={(e) => startEditing(workspace.id, workspace.name, e)}
                  title="Rename tab"
                >
                  <Edit2 size={12} strokeWidth={2} />
                </button>
              </>
            )}
            <span className="workspace-tab-count">{workspace.terminals.length}</span>
            <span
              className="workspace-tab-close"
              onClick={(event) => handleClose(workspace.id, event)}
              role="button"
              aria-label="Close workspace"
              title="Close workspace"
            >
              <X size={14} strokeWidth={2} />
            </span>
          </button>
        );
      })}
      {onOpenWorkspace && (
        <button
          type="button"
          className="workspace-tab workspace-tab-new"
          onClick={onOpenWorkspace}
          aria-label="Open Workspace"
          title="Open Workspace"
        >
          <Plus size={14} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
