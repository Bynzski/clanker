import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { BellRing, Check, ChevronDown, ChevronRight, Edit2, GitBranch, PanelLeftClose, Plus, Server, X } from 'lucide-react';
import { IconButton } from './ui/IconButton';
import { Input } from './ui/Input';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { Terminal, WorkspaceTab } from '../store/workspaceTypes';
import { attentionCounts, useAgentAttentionStore } from '../store/agentAttentionStore';
import { nextAttentionTarget } from '../lib/agentAttentionNavigation';
import { getAttentionSuffix } from '../lib/agentAttentionPresentation';
import { useTerminalAttention } from '../lib/useTerminalAttention';
import { AgentAttentionState, WorkspaceAttentionBadge } from './AgentAttentionIndicators';
import { getHarnessOption } from '../lib/harnessOptions';
import { closeWorkspaceWithCleanup } from '../lib/workspaceClose';
import { getRemoteEnvironmentLabel, getWorkspaceRenameValue, getWorkspaceTabLabel } from '../lib/workspaceLabels';
import { useWorkspaceRename } from '../lib/useWorkspaceRename';
import { useWorkspaceReorder } from '../lib/useWorkspaceReorder';
import WorkspaceCheckouts from './WorkspaceCheckouts';
import DevServerRow, { DevServerControls } from './DevServerRow';
import { useWorkspaceServiceStore } from '../store/workspaceServiceStore';
import { isLiveWorkspaceService } from '../../shared/types/workspaceServices';
import { mainCheckoutContextId } from '../../shared/checkoutContext';
import { getAgentWorktreeContext, worktreeBranchLabel, worktreeDisplayLabel } from '../lib/worktreeAgents';
import { useAgentLocation } from '../lib/useAgentLocation';
import { closeWorkspaceTerminal } from '../lib/workspaceTerminalClose';
import './WorkspaceNavigatorSection.css';

function AgentRow({ workspace, terminal, isCurrent }: { workspace: WorkspaceTab; terminal: Terminal; isCurrent: boolean }) {
  const selectWorkspace = useWorkspaceStore((state) => state.selectWorkspace);
  const attention = useTerminalAttention(terminal.id);
  const harness = getHarnessOption(terminal.harnessId);
  const HarnessIcon = harness.Icon;
  const showAttention = Boolean(terminal.harnessId && terminal.attentionEnabled);
  const name = terminal.displayName ?? harness.label;
  const worktree = getAgentWorktreeContext(workspace, terminal, useAgentLocation(terminal.id));
  const branch = worktree ? worktreeBranchLabel(worktree) : null;
  const removed = Boolean(worktree?.missing);
  const attentionSuffix = showAttention ? getAttentionSuffix(attention) : '';
  const pane = workspace.panes.find((item) => item.terminalId === terminal.id);
  const minimized = workspace.minimizedPanes?.some((item) => item.paneId === pane?.id);

  return (
    <li className={`ws-agent-card${isCurrent ? ' current' : ''}`}>
      <button
        type="button"
        className={`ws-agent-row${isCurrent ? ' current' : ''}`}
        aria-current={isCurrent ? 'true' : undefined}
        title={worktree
          ? `${name} · ${harness.label} · ${branch}${removed ? ' (checkout removed)' : ''}${attentionSuffix}\n${worktree.path}`
          : `${name} · ${harness.label}${attentionSuffix}`}
        onClick={() => selectWorkspace(workspace.id, terminal.id)}
      >
        <span className="ws-agent-primary">
          <span className="ws-agent-harness" aria-hidden="true"><HarnessIcon size={14} strokeWidth={2} /></span>
          <span className="ws-agent-name">{name}{minimized && <span className="ws-agent-meta"> · minimized</span>}</span>
          <span className="sr-only">{harness.label}</span>
          {showAttention && <AgentAttentionState attention={attention} name={name} />}
        </span>
        {branch && <span className="ws-agent-meta">
          {branch && (
            <span
              className={`ws-agent-branch${removed ? ' missing' : ''}`}
              aria-label={removed ? `on branch ${branch}, checkout removed` : `on branch ${branch}`}
            >
              <GitBranch size={10} strokeWidth={2} aria-hidden="true" />
              <span>{worktree ? worktreeDisplayLabel(worktree) : branch}</span>
            </span>
          )}
        </span>}
      </button>
      {minimized && <IconButton aria-label={`Close ${name}`} title="Close conversation (keep history)" onClick={() => void closeWorkspaceTerminal(workspace.id, terminal.id)}><X size={12} /></IconButton>}
      <DevServerRow workspace={workspace} terminal={terminal} />
    </li>
  );
}

interface WorkspaceNavigatorSectionProps {
  onOpenWorkspace?: () => void;
  /** Collapses the sidebar shell to its icon rail. */
  onCollapseSidebar?: () => void;
}

export default function WorkspaceNavigatorSection({ onOpenWorkspace, onCollapseSidebar }: WorkspaceNavigatorSectionProps) {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const activeTerminalId = useWorkspaceStore((state) => state.activeTerminalId);
  const selectWorkspace = useWorkspaceStore((state) => state.selectWorkspace);
  const moveWorkspace = useWorkspaceStore((state) => state.moveWorkspace);
  const byTerminalId = useAgentAttentionStore((state) => state.byTerminalId);
  const services = useWorkspaceServiceStore((state) => state.services);
  const seenByTerminalId = useAgentAttentionStore((state) => state.seenByTerminalId);
  const nextTarget = nextAttentionTarget(workspaces, byTerminalId, seenByTerminalId, activeTerminalId);

  // Expansion is navigation-only UI state: it never affects residency or terminals.
  const [sectionOpen, setSectionOpen] = useState(true);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set(activeWorkspaceId ? [activeWorkspaceId] : []));
  // Auto-expand a workspace whenever it becomes active. Subscribing to the store
  // (rather than deriving state in render or an effect body) keeps this a pure
  // reaction to an external change; the initial active workspace is seeded above.
  useEffect(() => useWorkspaceStore.subscribe((state, prev) => {
    const id = state.activeWorkspaceId;
    if (id && id !== prev.activeWorkspaceId) {
      setExpandedIds((current) => current.has(id) ? current : new Set(current).add(id));
    }
  }), []);

  const toggleExpanded = (id: string) => setExpandedIds((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  const rename = useWorkspaceRename();
  const reorder = useWorkspaceReorder(workspaces, moveWorkspace, {
    axis: 'vertical',
    ignoreDragSelector: '.ws-nav-edit, .ws-nav-action',
  });

  const handleClose = async (id: string, event: MouseEvent) => {
    event.stopPropagation();
    await closeWorkspaceWithCleanup(id);
  };

  return (
    <section className="ws-nav" aria-label="Workspaces">
      <div className="ws-nav-header">
        <button
          type="button"
          className="ws-nav-section-toggle"
          aria-expanded={sectionOpen}
          onClick={() => setSectionOpen((open) => !open)}
          title={sectionOpen ? 'Collapse Workspaces' : 'Expand Workspaces'}
        >
          {sectionOpen ? <ChevronDown size={12} strokeWidth={2} aria-hidden="true" /> : <ChevronRight size={12} strokeWidth={2} aria-hidden="true" />}
          <span>Workspaces</span>
        </button>
        <div className="ws-nav-header-actions">
          {nextTarget && (
            <IconButton
              type="button"
              className="ws-nav-action"
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
            <IconButton type="button" className="ws-nav-action" aria-label="Open Workspace" title="Open Workspace" onClick={onOpenWorkspace}>
              <Plus size={14} strokeWidth={2.5} />
            </IconButton>
          )}
          {onCollapseSidebar && (
            <IconButton type="button" className="ws-nav-action" aria-label="Collapse sidebar" title="Collapse sidebar" onClick={onCollapseSidebar}>
              <PanelLeftClose size={14} strokeWidth={2} />
            </IconButton>
          )}
        </div>
      </div>

      {sectionOpen && (
        <ul className="ws-nav-list">
          {workspaces.map((workspace, index) => {
            const isActive = workspace.id === activeWorkspaceId;
            const isEditing = workspace.id === rename.editingId;
            const isExpanded = expandedIds.has(workspace.id);
            const label = getWorkspaceTabLabel(workspace);
            const remoteLabel = getRemoteEnvironmentLabel(workspace);
            const branch = workspace.gitCurrentBranch;
            const counts = attentionCounts(workspace.terminals.map((terminal) => terminal.id), byTerminalId, seenByTerminalId);
            const editName = getWorkspaceRenameValue(workspace);
            const dropClass = reorder.dropTarget?.id === workspace.id ? ` drop-${reorder.dropTarget.side === 'start' ? 'before' : 'after'}` : '';

            return (
              <li key={workspace.id} className="ws-nav-item" data-nav-workspace-id={workspace.id}>
                <div
                  className={`ws-nav-row${isActive ? ' active' : ''}${dropClass}`}
                  draggable={!isEditing}
                  title={`${remoteLabel ? `${remoteLabel}\n` : ''}${label}${workspace.isLinkedWorktree && branch ? ` · ${branch}` : ''}\n${workspace.workspacePath}`}
                  onDragStart={(event) => reorder.onDragStart(event, workspace.id)}
                  onDragOver={(event) => reorder.onDragOver(event, workspace.id)}
                  onDragLeave={() => reorder.onDragLeave(workspace.id)}
                  onDrop={(event) => reorder.onDrop(event, workspace.id)}
                  onDragEnd={reorder.onDragEnd}
                >
                  <IconButton
                    type="button"
                    className="ws-nav-action ws-nav-chevron"
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${label}`}
                    onClick={() => toggleExpanded(workspace.id)}
                  >
                    {isExpanded ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />}
                  </IconButton>
                  {isEditing ? (
                    <div className="ws-nav-edit">
                      <Input
                        ref={rename.inputRef}
                        type="text"
                        className="ws-nav-edit-input"
                        aria-label="Workspace name"
                        value={rename.editValue}
                        onChange={(event) => rename.setEditValue(event.target.value)}
                        onKeyDown={rename.handleEditKeyDown}
                        onBlur={rename.saveEdit}
                      />
                      <IconButton aria-label="Save" className="ws-nav-action" title="Save" onClick={rename.saveEdit}>
                        <Check size={14} strokeWidth={2} />
                      </IconButton>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="ws-nav-select"
                      aria-current={isActive ? 'true' : undefined}
                      aria-keyshortcuts="Alt+Shift+ArrowUp Alt+Shift+ArrowDown"
                      onClick={() => { if (!reorder.suppressClickRef.current) selectWorkspace(workspace.id); }}
                      onDoubleClick={() => rename.startEditing(workspace.id, editName)}
                      onKeyDown={(event) => reorder.onReorderKey(event, workspace.id, index)}
                    >
                      {remoteLabel && (
                        <span className="ws-nav-remote">
                          <Server size={12} strokeWidth={2} aria-hidden="true" />
                          <span className="sr-only">{remoteLabel}</span>
                        </span>
                      )}
                      <span className="ws-nav-name">{label}</span>
                      {workspace.isLinkedWorktree && (
                        <span className="ws-nav-worktree" aria-label={`Worktree ${branch ? `on ${branch}` : 'at detached HEAD'}`}>
                          <GitBranch size={11} strokeWidth={2} aria-hidden="true" />
                          <span>{branch || 'HEAD'}</span>
                        </span>
                      )}
                    </button>
                  )}
                  <WorkspaceAttentionBadge counts={counts} />
                  {!isEditing && (
                    <IconButton
                      aria-label="Rename workspace"
                      className="ws-nav-action ws-nav-hover"
                      title="Rename workspace"
                      onClick={() => rename.startEditing(workspace.id, editName)}
                    >
                      <Edit2 size={12} strokeWidth={2} />
                    </IconButton>
                  )}
                  <IconButton
                    className="ws-nav-action ws-nav-hover"
                    aria-label="Close workspace"
                    title="Close workspace"
                    onClick={(event) => handleClose(workspace.id, event)}
                  >
                    <X size={14} strokeWidth={2} />
                  </IconButton>
                </div>
                {isExpanded && workspace.terminals.length > 0 && (
                  <ul className="ws-agent-list" aria-label={`${label} agents`}>
                    {workspace.terminals.map((terminal) => (
                      <AgentRow
                        key={terminal.id}
                        workspace={workspace}
                        terminal={terminal}
                        isCurrent={isActive && workspace.activeTerminalId === terminal.id}
                      />
                    ))}
                  </ul>
                )}
                {isExpanded && workspace.environmentId && workspace.environmentId !== 'local' && (
                  <div className="ws-service-row" role="note" title="Dev Server launch is local-only for now. For SSH, start the server in a remote terminal and use the Browser's remote preview discovery.">
                    <Server size={11} aria-hidden="true" /><span className="sr-only">Dev Server · local only</span>
                  </div>
                )}
                {isExpanded && services.filter((service) => service.workspaceId === workspace.id && isLiveWorkspaceService(service) && !workspace.terminals.some((terminal) => {
                  const location = byTerminalId[terminal.id]?.location;
                  return (location ? location.checkoutContextId : terminal.checkoutContextId ?? mainCheckoutContextId(workspace.id)) === service.checkoutContextId;
                })).map((service) => (
                  <div key={service.id} className="ws-detached-service" aria-label="Checkout service">
                    <div className="ws-service-checkout" title={service.cwd}>
                      <GitBranch size={10} aria-hidden="true" />
                      <span>{workspace.checkoutContexts?.find((context) => context.id === service.checkoutContextId)?.branch || 'Main checkout'}</span>
                      <DevServerControls workspace={workspace} service={service} />
                    </div>
                  </div>
                ))}
                <WorkspaceCheckouts workspace={workspace} expanded={isExpanded} label={label} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
