import { useState, useRef, useEffect } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { disposeWorkspaceResources } from '../lib/workspaceLifecycle';
import { Plus, X, Check, Edit2, BellRing, GitBranch } from 'lucide-react';
import { getRemoteEnvironmentLabel, getWorkspaceNameFromPath, getWorkspaceProjectName, getWorkspaceTabLabel } from '../lib/workspaceLabels';
import { useAgentAttentionStore, attentionCounts } from '../store/agentAttentionStore';
import { nextAttentionTarget } from '../lib/agentAttentionNavigation';
import './WorkspaceTabs.css';

interface WorkspaceTabsProps {
  onOpenWorkspace?: () => void;
}

export default function WorkspaceTabs({ onOpenWorkspace }: WorkspaceTabsProps) {
  const { workspaces, activeWorkspaceId, activeTerminalId, selectWorkspace, moveWorkspace, closeWorkspace, updateWorkspaceName } = useWorkspaceStore();
  const byTerminalId = useAgentAttentionStore((state) => state.byTerminalId);
  const nextTarget = nextAttentionTarget(workspaces, byTerminalId, activeTerminalId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const draggedWorkspaceIdRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const [dropTarget, setDropTarget] = useState<{ id: string; side: 'left' | 'right' } | null>(null);

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

      if ((workspace.environmentId ?? 'local') !== 'local') {
        await window.electronAPI.explorerStopWatching();
        return;
      }
      await window.electronAPI.explorerStartWatching(workspace.id);
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
    await window.electronAPI.unregisterOpenWorkspace(id).catch((error) => {
      console.error('Could not unregister closed workspace:', error);
    });
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

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, workspaceId: string) => {
    if (event.target instanceof HTMLElement && event.target.closest('.workspace-tab-edit, .workspace-tab-edit-trigger, .workspace-tab-close')) {
      event.preventDefault();
      return;
    }
    draggedWorkspaceIdRef.current = workspaceId;
    suppressClickRef.current = true;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', workspaceId);
  };

  const handleDragOver = (event: DragEvent<HTMLButtonElement>, targetId: string) => {
    const draggedId = draggedWorkspaceIdRef.current;
    if (!draggedId || draggedId === targetId) return;
    const fromIndex = workspaces.findIndex((workspace) => workspace.id === draggedId);
    const targetIndex = workspaces.findIndex((workspace) => workspace.id === targetId);
    if (fromIndex < 0 || targetIndex < 0) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget({ id: targetId, side: fromIndex < targetIndex ? 'right' : 'left' });
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>, targetId: string) => {
    event.preventDefault();
    const draggedId = draggedWorkspaceIdRef.current;
    draggedWorkspaceIdRef.current = null;
    setDropTarget(null);
    if (draggedId && draggedId !== targetId) moveWorkspace(draggedId, targetId);
  };

  const handleDragEnd = () => {
    draggedWorkspaceIdRef.current = null;
    setDropTarget(null);
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
  };

  const handleReorderKey = (event: KeyboardEvent<HTMLButtonElement>, workspaceId: string, index: number) => {
    if (event.target !== event.currentTarget || !event.altKey || !event.shiftKey) return;
    const targetIndex = event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowRight' ? index + 1 : -1;
    const target = workspaces[targetIndex];
    if (!target) return;
    event.preventDefault();
    moveWorkspace(workspaceId, target.id);
  };

  return (
    <div className="workspace-tabs" role="tablist" aria-label="Workspaces">
      {workspaces.map((workspace, index) => {
        const isActive = workspace.id === activeWorkspaceId;
        const isEditing = workspace.id === editingId;
        const counts = attentionCounts(workspace.terminals.map((terminal) => terminal.id), byTerminalId);
        const projectName = getWorkspaceProjectName(workspace);
        const tabLabel = getWorkspaceTabLabel(workspace);
        const branch = workspace.gitCurrentBranch;
        const remoteLabel = getRemoteEnvironmentLabel(workspace);
        const editName = workspace.isLinkedWorktree && workspace.name === getWorkspaceNameFromPath(workspace.workspacePath)
          ? projectName
          : workspace.name || projectName;

        return (
          <button
            key={workspace.id}
            className={`workspace-tab ${isActive ? 'active' : ''}${dropTarget?.id === workspace.id ? ` drop-${dropTarget.side}` : ''}`}
            role="tab"
            aria-selected={isActive}
            aria-keyshortcuts="Alt+Shift+ArrowLeft Alt+Shift+ArrowRight"
            title={`${remoteLabel ? `${remoteLabel}\n` : ''}${tabLabel}${workspace.isLinkedWorktree && branch ? ` · ${branch}` : ''}\n${workspace.workspacePath}`}
            draggable={!isEditing}
            onDragStart={(event) => handleDragStart(event, workspace.id)}
            onDragOver={(event) => handleDragOver(event, workspace.id)}
            onDragLeave={() => setDropTarget((current) => current?.id === workspace.id ? null : current)}
            onDrop={(event) => handleDrop(event, workspace.id)}
            onDragEnd={handleDragEnd}
            onKeyDown={(event) => handleReorderKey(event, workspace.id, index)}
            onClick={() => { if (!isEditing && !suppressClickRef.current) selectWorkspace(workspace.id); }}
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
                  onDoubleClick={(e) => startEditing(workspace.id, editName, e)}
                >
                  {remoteLabel && <span className="workspace-tab-remote" title={remoteLabel}>{remoteLabel}</span>}
                  <span className="workspace-tab-name">{tabLabel}</span>
                </span>
                <button
                  className="workspace-tab-edit-trigger"
                  onClick={(e) => startEditing(workspace.id, editName, e)}
                  title="Rename tab"
                >
                  <Edit2 size={12} strokeWidth={2} />
                </button>
              </>
            )}
            {workspace.isLinkedWorktree && (
              <span className="workspace-tab-worktree" title={`Worktree: ${branch || 'Detached HEAD'}`} aria-label={`Worktree ${branch ? `on ${branch}` : 'at detached HEAD'}`}>
                <GitBranch size={11} strokeWidth={2} />
                <span>{branch || 'HEAD'}</span>
              </span>
            )}
            {(counts.needsInput > 0 || counts.completed > 0) && (
              <span
                className={`workspace-tab-attention ${counts.needsInput > 0 ? 'needs-input' : 'complete'}`}
                aria-label={`${counts.needsInput} agents need input, ${counts.completed} turns complete`}
                title={`${counts.needsInput} need input · ${counts.completed} complete`}
              >
                {counts.needsInput > 0 ? `! ${counts.needsInput}` : `✓ ${counts.completed}`}
              </span>
            )}
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
      {nextTarget && (
        <button
          type="button"
          className="workspace-tab-jump"
          aria-label="Jump to next agent needing attention"
          title="Jump to next agent needing attention"
          onClick={() => {
            selectWorkspace(nextTarget.workspaceId, nextTarget.terminalId);
            useAgentAttentionStore.getState().acknowledge(nextTarget.terminalId);
          }}
        >
          <BellRing size={14} strokeWidth={2} />
        </button>
      )}
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
