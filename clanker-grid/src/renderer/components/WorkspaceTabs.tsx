import type { MouseEvent } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { X } from 'lucide-react';
import './WorkspaceTabs.css';

const getTabTitle = (path: string) => {
  const trimmed = path.replace(/\/+$/, '');
  if (!trimmed) return 'Workspace';
  const parts = trimmed.split('/');
  return parts[parts.length - 1] || 'Workspace';
};

export default function WorkspaceTabs() {
  const { workspaces, activeWorkspaceId, selectWorkspace, closeWorkspace } = useWorkspaceStore();

  if (workspaces.length === 0) {
    return null;
  }

  const handleClose = async (id: string, event: MouseEvent) => {
    event.stopPropagation();

    const workspace = workspaces.find((entry) => entry.id === id);
    if (workspace == null) {
      return;
    }

    for (const terminal of workspace.terminals) {
      try {
        await window.electronAPI.killTerminal(terminal.id);
      } catch (err) {
        console.error('Failed to kill terminal:', err);
      }
    }

    closeWorkspace(id);
  };

  return (
    <div className="workspace-tabs" role="tablist" aria-label="Workspaces">
      {workspaces.map((workspace) => {
        const isActive = workspace.id === activeWorkspaceId;
        const label = getTabTitle(workspace.workspacePath);

        return (
          <button
            key={workspace.id}
            className={`workspace-tab ${isActive ? 'active' : ''}`}
            role="tab"
            aria-selected={isActive}
            onClick={() => selectWorkspace(workspace.id)}
            title={workspace.workspacePath}
          >
            <span className="workspace-tab-label">{label}</span>
            <span className="workspace-tab-count">{workspace.terminals.length}</span>
            <span
              className="workspace-tab-close"
              onClick={(event) => handleClose(workspace.id, event)}
              role="button"
              aria-label={`Close ${label}`}
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
