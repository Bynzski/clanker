import { useState } from 'react';
import type { MouseEvent } from 'react';
import { IconButton } from './ui/IconButton';
import { Input } from './ui/Input';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';
import { AgentRow } from './WorkspaceNavigatorSection';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { WorkspaceTab } from '../store/workspaceTypes';
import { closeWorkspaceWithCleanup } from '../lib/workspaceClose';
import { Plus, X, Check, Edit2, BellRing, GitBranch, ChevronDown, Minus } from 'lucide-react';
import { getRemoteEnvironmentLabel, getWorkspaceRenameValue, getWorkspaceTabLabel } from '../lib/workspaceLabels';
import { useAgentAttentionStore, attentionCounts } from '../store/agentAttentionStore';
import { useWorkspaceRename } from '../lib/useWorkspaceRename';
import { useWorkspaceReorder } from '../lib/useWorkspaceReorder';
import { nextAttentionTarget } from '../lib/agentAttentionNavigation';
import { WorkspaceAttentionBadge } from './AgentAttentionIndicators';
import './WorkspaceTabs.css';
import './WorkspaceNavigatorSection.css';

interface WorkspaceTabsProps {
  onOpenWorkspace?: () => void;
}

interface WorkspaceTabItemProps {
  workspace: WorkspaceTab;
  index: number;
  isActive: boolean;
  editingId: string | null;
  editValue: string;
  setEditValue: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  startEditing: (id: string, currentName: string, event: MouseEvent) => void;
  saveEdit: () => void;
  handleEditKeyDown: (event: React.KeyboardEvent) => void;
  handleClose: (id: string, event: MouseEvent) => void;
  selectWorkspace: (id: string, terminalId?: string) => void;
  reorder: ReturnType<typeof useWorkspaceReorder>;
  byTerminalId: ReturnType<typeof useAgentAttentionStore.getState>['byTerminalId'];
  seenByTerminalId: ReturnType<typeof useAgentAttentionStore.getState>['seenByTerminalId'];
}

function WorkspaceTabItem({
  workspace,
  index,
  isActive,
  editingId,
  editValue,
  setEditValue,
  inputRef,
  startEditing,
  saveEdit,
  handleEditKeyDown,
  handleClose,
  selectWorkspace,
  reorder,
  byTerminalId,
  seenByTerminalId,
}: WorkspaceTabItemProps) {
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const isEditing = workspace.id === editingId;
  const counts = attentionCounts(workspace.terminals.map((terminal) => terminal.id), byTerminalId, seenByTerminalId);
  const tabLabel = getWorkspaceTabLabel(workspace);
  const branch = workspace.gitCurrentBranch;
  const remoteLabel = getRemoteEnvironmentLabel(workspace);
  const editName = getWorkspaceRenameValue(workspace);
  const dropTarget = reorder.dropTarget;

  const hasMinimizedAgents = Boolean(
    workspace.minimizedPanes?.some((minimized) =>
      workspace.panes.some((pane) => pane.id === minimized.paneId && pane.terminalId)
    )
  );

  return (
    <div
      tabIndex={0}
      key={workspace.id}
      className={`workspace-tab ${isActive ? 'active' : ''}${dropTarget?.id === workspace.id ? ` drop-${dropTarget.side === 'start' ? 'left' : 'right'}` : ''}`}
      role="tab"
      aria-selected={isActive}
      aria-keyshortcuts="Alt+Shift+ArrowLeft Alt+Shift+ArrowRight"
      title={`${remoteLabel ? `${remoteLabel}\n` : ''}${tabLabel}${workspace.isLinkedWorktree && branch ? ` · ${branch}` : ''}\n${workspace.workspacePath}`}
      draggable={!isEditing}
      onDragStart={(event) => reorder.onDragStart(event, workspace.id)}
      onDragOver={(event) => reorder.onDragOver(event, workspace.id)}
      onDragLeave={() => reorder.onDragLeave(workspace.id)}
      onDrop={(event) => reorder.onDrop(event, workspace.id)}
      onDragEnd={reorder.onDragEnd}
      onKeyDown={(event) => {
        reorder.onReorderKey(event, workspace.id, index);
        if (event.target === event.currentTarget && !isEditing && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          selectWorkspace(workspace.id);
        }
      }}
      onClick={() => { if (!isEditing && !reorder.suppressClickRef.current) selectWorkspace(workspace.id); }}
    >
      {isEditing ? (
        <div className="workspace-tab-edit" onClick={(e) => e.stopPropagation()}>
          <Input
            ref={inputRef}
            type="text"
            className="workspace-tab-edit-input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleEditKeyDown}
            onBlur={saveEdit}
          />
          <IconButton variant="ghost" aria-label="Save"
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
          {workspace.terminals.length > 0 && (
            <Popover open={agentMenuOpen} onOpenChange={setAgentMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={`workspace-tab-agents-trigger${agentMenuOpen ? ' active' : ''}${hasMinimizedAgents ? ' has-minimized' : ''}`}
                  aria-label={hasMinimizedAgents ? `Agents in ${tabLabel} (has minimized agents)` : `Agents in ${tabLabel}`}
                  title={hasMinimizedAgents ? `Agents in ${tabLabel} · has minimized agents (click to select or restore)` : `Agents in ${tabLabel}`}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  {hasMinimizedAgents && (
                    <span className="workspace-tab-minimized" aria-hidden="true">
                      <Minus size={10} strokeWidth={2.5} />
                    </span>
                  )}
                  <ChevronDown size={11} strokeWidth={2} />
                </button>
              </PopoverTrigger>
              <PopoverContent
                workspaceId={workspace.id}
                align="start"
                sideOffset={6}
                className="workspace-tab-agents-popover"
                aria-label={`Agents in ${tabLabel}`}
                onClick={(e) => e.stopPropagation()}
              >
                <ul className="ws-agent-list" aria-label={`Agents in ${tabLabel}`}>
                  {workspace.terminals.map((terminal) => (
                    <AgentRow
                      key={terminal.id}
                      workspace={workspace}
                      terminal={terminal}
                      isCurrent={isActive && workspace.activeTerminalId === terminal.id}
                      onSelect={() => setAgentMenuOpen(false)}
                    />
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          )}
          <IconButton aria-label="Rename tab"
            variant="ghost" size="xs" className="workspace-tab-edit-trigger"
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
      <WorkspaceAttentionBadge counts={counts} />
      <IconButton
        variant="ghost" size="xs" className="workspace-tab-close"
        onClick={(event) => handleClose(workspace.id, event)}
        aria-label="Close workspace"
        title="Close workspace"
      >
        <X size={14} strokeWidth={2} />
      </IconButton>
    </div>
  );
}

export default function WorkspaceTabs({ onOpenWorkspace }: WorkspaceTabsProps) {
  const { workspaces, activeWorkspaceId, activeTerminalId, selectWorkspace, moveWorkspace } = useWorkspaceStore();
  const byTerminalId = useAgentAttentionStore((state) => state.byTerminalId);
  const seenByTerminalId = useAgentAttentionStore((state) => state.seenByTerminalId);
  const nextTarget = nextAttentionTarget(workspaces, byTerminalId, seenByTerminalId, activeTerminalId);
  const { editingId, editValue, setEditValue, inputRef, startEditing: beginEditing, saveEdit, handleEditKeyDown } = useWorkspaceRename();
  const reorder = useWorkspaceReorder(workspaces, moveWorkspace, {
    axis: 'horizontal',
    ignoreDragSelector: '.workspace-tab-edit, .workspace-tab-edit-trigger, .workspace-tab-close',
  });

  const handleClose = async (id: string, event: MouseEvent) => {
    event.stopPropagation();

    await closeWorkspaceWithCleanup(id);
  };

  const startEditing = (id: string, currentName: string, event: MouseEvent) => {
    event.stopPropagation();
    beginEditing(id, currentName);
  };

  return (
    <div className="workspace-tabs" role="tablist" aria-label="Workspaces">
      {workspaces.map((workspace, index) => (
        <WorkspaceTabItem
          key={workspace.id}
          workspace={workspace}
          index={index}
          isActive={workspace.id === activeWorkspaceId}
          editingId={editingId}
          editValue={editValue}
          setEditValue={setEditValue}
          inputRef={inputRef}
          startEditing={startEditing}
          saveEdit={saveEdit}
          handleEditKeyDown={handleEditKeyDown}
          handleClose={handleClose}
          selectWorkspace={selectWorkspace}
          reorder={reorder}
          byTerminalId={byTerminalId}
          seenByTerminalId={seenByTerminalId}
        />
      ))}
      {nextTarget && (
        <IconButton
          type="button"
          variant="ghost" size="xs" className="workspace-tab-jump"
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
          variant="ghost" size="xs" className="workspace-tab-new"
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
