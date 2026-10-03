import { IconButton } from './ui/IconButton';
import { Input } from './ui/Input';
import { useState, useRef, useEffect } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { closeWorkspaceWithCleanup } from '../lib/workspaceClose';
import { Plus, X, Check, Edit2, BellRing, GitBranch } from 'lucide-react';
import { getRemoteEnvironmentLabel, getWorkspaceRenameValue, getWorkspaceTabLabel } from '../lib/workspaceLabels';
import { useAgentAttentionStore, attentionCounts } from '../store/agentAttentionStore';
import { nextAttentionTarget } from '../lib/agentAttentionNavigation';
import './WorkspaceTabs.css';

interface WorkspaceTabsProps {
  onOpenWorkspace?: () => void;
}

export default function WorkspaceTabs({ onOpenWorkspace }: WorkspaceTabsProps) {
  const { workspaces, activeWorkspaceId, activeTerminalId, selectWorkspace, moveWorkspace, updateWorkspaceName } = useWorkspaceStore();
  const byTerminalId = useAgentAttentionStore((state) => state.byTerminalId);
  const nextTarget = nextAttentionTarget(workspaces, byTerminalId, activeTerminalId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const draggedWorkspaceIdRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const [dropTarget, setDropTarget] = useState<{ id: string; side: 'left' | 'right' } | null>(null);

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

    await closeWorkspaceWithCleanup(id);
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

  const handleDragStart = (event: DragEvent<HTMLDivElement>, workspaceId: string) => {
    if (event.target instanceof Element && event.target.closest('.workspace-tab-edit, .workspace-tab-edit-trigger, .workspace-tab-close')) {
      event.preventDefault();
      return;
    }
    draggedWorkspaceIdRef.current = workspaceId;
    suppressClickRef.current = true;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', workspaceId);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>, targetId: string) => {
    const draggedId = draggedWorkspaceIdRef.current;
    if (!draggedId || draggedId === targetId) return;
    const fromIndex = workspaces.findIndex((workspace) => workspace.id === draggedId);
    const targetIndex = workspaces.findIndex((workspace) => workspace.id === targetId);
    if (fromIndex < 0 || targetIndex < 0) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget({ id: targetId, side: fromIndex < targetIndex ? 'right' : 'left' });
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, targetId: string) => {
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

  const handleReorderKey = (event: KeyboardEvent<HTMLDivElement>, workspaceId: string, index: number) => {
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
        const tabLabel = getWorkspaceTabLabel(workspace);
        const branch = workspace.gitCurrentBranch;
        const remoteLabel = getRemoteEnvironmentLabel(workspace);
        const editName = getWorkspaceRenameValue(workspace);

        return (
          <div
            tabIndex={0}
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
            onKeyDown={(event) => {
              handleReorderKey(event, workspace.id, index);
              if (event.target === event.currentTarget && !isEditing && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                selectWorkspace(workspace.id);
              }
            }}
            onClick={() => { if (!isEditing && !suppressClickRef.current) selectWorkspace(workspace.id); }}
          >
            {isEditing ? (
              <div className="workspace-tab-edit" onClick={(e) => e.stopPropagation()}>
                <Input
                  ref={inputRef}
                  type="text"
                  className="workspace-tab-edit-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={saveEdit}
                />
                <IconButton aria-label="Save"
                  className="workspace-tab-edit-btn"
                  onClick={(e) => { e.stopPropagation(); saveEdit(); }}
                  title="Save"
                >
                  <Check size={14} strokeWidth={2} />
                </IconButton>
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
                <IconButton aria-label="Rename tab"
                  className="workspace-tab-edit-trigger"
                  onClick={(e) => startEditing(workspace.id, editName, e)}
                  title="Rename tab"
                >
                  <Edit2 size={12} strokeWidth={2} />
                </IconButton>
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
            <IconButton
              className="workspace-tab-close"
              onClick={(event) => handleClose(workspace.id, event)}
              aria-label="Close workspace"
              title="Close workspace"
            >
              <X size={14} strokeWidth={2} />
            </IconButton>
          </div>
        );
      })}
      {nextTarget && (
        <IconButton
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
        </IconButton>
      )}
      {onOpenWorkspace && (
        <IconButton
          type="button"
          className="workspace-tab-new"
          onClick={onOpenWorkspace}
          aria-label="Open Workspace"
          title="Open Workspace"
        >
          <Plus size={14} strokeWidth={2.5} />
        </IconButton>
      )}
    </div>
  );
}
