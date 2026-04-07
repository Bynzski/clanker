import { useState, useRef, useEffect, MouseEvent } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { terminateWorkspaceTerminals } from '../lib/workspaceLifecycle';
import { X, Check, Edit2 } from 'lucide-react';
import './WorkspaceTabs.css';

export default function WorkspaceTabs() {
  const { workspaces, activeWorkspaceId, selectWorkspace, closeWorkspace, updateWorkspaceName } = useWorkspaceStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

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

    const workspace = workspaces.find((entry) => entry.id === id);
    if (workspace == null) {
      return;
    }

    await terminateWorkspaceTerminals(workspace);
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
                  {workspace.name || workspace.workspacePath.split('/').pop() || 'Workspace'}
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
    </div>
  );
}
