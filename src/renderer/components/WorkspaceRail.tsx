import { BellRing, FolderTree, GitBranch, PanelLeftOpen, Plus } from 'lucide-react';
import { IconButton } from './ui/IconButton';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { MutableRefObject } from 'react';
import type { Terminal, WorkspaceTab } from '../store/workspaceTypes';
import { attentionCounts, useAgentAttentionStore } from '../store/agentAttentionStore';
import { nextAttentionTarget } from '../lib/agentAttentionNavigation';
import { getAttentionSuffix } from '../lib/agentAttentionPresentation';
import { useTerminalAttention } from '../lib/useTerminalAttention';
import { getHarnessOption } from '../lib/harnessOptions';
import { getRemoteEnvironmentLabel, getWorkspaceTabLabel } from '../lib/workspaceLabels';
import { toggleFocusedWorkspaceExplorer } from '../lib/explorerToggle';
import { getAgentWorktreeContext, worktreeBranchLabel } from '../lib/worktreeAgents';
import { useAgentLocation } from '../lib/useAgentLocation';
import { useWorkspaceReorder } from '../lib/useWorkspaceReorder';
import { resolveDestinationCapabilities, useActiveDestination } from '../lib/activeDestination';
import { AssistantButton, useAssistantsEnabled, useAssistantRoster } from './assistants/AssistantsRoster';
import './WorkspaceRail.css';

/** Two-letter mark for a workspace: word initials ("demo-repo" → "DR") or the first two letters. */
export function getWorkspaceMonogram(label: string): string {
  const words = label.split(/[\s._/-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return letters.toUpperCase();
}

interface RailAgentProps {
  workspace: WorkspaceTab;
  terminal: Terminal;
  isCurrent: boolean;
  /** Set while a reorder drag settles, so its trailing click doesn't select. */
  suppressClickRef: MutableRefObject<boolean>;
}

function RailAgent({ workspace, terminal, isCurrent, suppressClickRef }: RailAgentProps) {
  const selectWorkspace = useWorkspaceStore((state) => state.selectWorkspace);
  const attentionView = useTerminalAttention(terminal.id);
  const harness = getHarnessOption(terminal.harnessId);
  const HarnessIcon = harness.Icon;
  const name = terminal.displayName ?? harness.label;
  const attentionOn = Boolean(terminal.harnessId && terminal.attentionEnabled);
  const attention = attentionOn ? attentionView : null;
  const display = attention?.display ?? null;
  const suffix = getAttentionSuffix(attention);
  const worktree = getAgentWorktreeContext(workspace, terminal, useAgentLocation(terminal.id));
  // Branch identity only: management of checkouts lives in the expanded sidebar.
  const description = worktree
    ? `${name} · ${harness.label} · on branch ${worktreeBranchLabel(worktree)}${suffix}`
    : `${name} · ${harness.label}${suffix}`;

  return (
    <button
      type="button"
      className={`ws-rail-agent${isCurrent ? ' current' : ''}${worktree ? ' worktree' : ''}`}
      aria-current={isCurrent ? 'true' : undefined}
      aria-label={description}
      title={worktree ? `${description}\n${worktree.path}` : description}
      onClick={() => { if (!suppressClickRef.current) selectWorkspace(workspace.id, terminal.id); }}
    >
      <HarnessIcon size={14} strokeWidth={2} />
      {worktree && <GitBranch className="ws-rail-agent-worktree" size={8} strokeWidth={2.5} aria-hidden="true" />}
      {display && (
        <span className={`ws-rail-agent-state state-${display}${attention?.unseen ? ' unseen' : ''}`} aria-hidden="true" />
      )}
    </button>
  );
}

interface WorkspaceRailProps {
  onOpenWorkspace?: () => void;
  onExpand: () => void;
}

/**
 * Collapsed sidebar: one column of workspace marks, each followed by its agents'
 * harness icons. Selection and drag/keyboard reordering match the expanded
 * navigator; neither changes residency or terminals.
 */
export default function WorkspaceRail({ onOpenWorkspace, onExpand }: WorkspaceRailProps) {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const activeTerminalId = useWorkspaceStore((state) => state.activeTerminalId);
  const selectWorkspace = useWorkspaceStore((state) => state.selectWorkspace);
  const moveWorkspace = useWorkspaceStore((state) => state.moveWorkspace);
  const byTerminalId = useAgentAttentionStore((state) => state.byTerminalId);
  const seenByTerminalId = useAgentAttentionStore((state) => state.seenByTerminalId);
  const reorder = useWorkspaceReorder(workspaces, moveWorkspace, {
    axis: 'vertical',
    // Nothing inside an entry opts out of dragging.
    ignoreDragSelector: '[data-no-reorder]',
  });
  const nextTarget = nextAttentionTarget(workspaces, byTerminalId, seenByTerminalId, activeTerminalId);
  const assistantsEnabled = useAssistantsEnabled();
  const { assistants, live } = useAssistantRoster();
  // Files is workspace-only: never offered with no workspace, nor while an Assistant is on screen (it would target the parked one).
  const destination = useActiveDestination();
  const showFiles = destination.kind === 'workspace' && resolveDestinationCapabilities(destination).explorer;

  return (
    <nav className="ws-rail" aria-label="Workspaces">
      <IconButton
        size="xs"
        variant="ghost"
        className="ws-rail-action"
        aria-label="Expand sidebar"
        title="Expand sidebar"
        onClick={onExpand}
      >
        <PanelLeftOpen size={14} strokeWidth={2} />
      </IconButton>

      <ul className="ws-rail-list">
        {workspaces.map((workspace, index) => {
          const isActive = workspace.id === activeWorkspaceId;
          const label = getWorkspaceTabLabel(workspace);
          const remoteLabel = getRemoteEnvironmentLabel(workspace);
          const branch = workspace.gitCurrentBranch;
          const counts = attentionCounts(workspace.terminals.map((terminal) => terminal.id), byTerminalId, seenByTerminalId);
          const pending = counts.needsInput > 0 ? 'needs-input' : counts.completed > 0 ? 'complete' : null;
          const details = [
            remoteLabel,
            label,
            workspace.isLinkedWorktree && branch ? `worktree · ${branch}` : null,
            workspace.workspacePath,
          ].filter(Boolean).join('\n');
          const dropClass = reorder.dropTarget?.id === workspace.id ? ` drop-${reorder.dropTarget.side === 'start' ? 'before' : 'after'}` : '';

          return (
            <li
              key={workspace.id}
              className={`ws-rail-workspace${isActive ? ' active' : ''}${dropClass}`}
              data-rail-workspace-id={workspace.id}
              draggable
              onDragStart={(event) => reorder.onDragStart(event, workspace.id)}
              onDragOver={(event) => reorder.onDragOver(event, workspace.id)}
              onDragLeave={() => reorder.onDragLeave(workspace.id)}
              onDrop={(event) => reorder.onDrop(event, workspace.id)}
              onDragEnd={reorder.onDragEnd}
            >
              <button
                type="button"
                className="ws-rail-mark"
                aria-current={isActive ? 'true' : undefined}
                aria-label={remoteLabel ? `${remoteLabel} · ${label}` : label}
                aria-keyshortcuts="Alt+Shift+ArrowUp Alt+Shift+ArrowDown"
                title={details}
                onClick={() => { if (!reorder.suppressClickRef.current) selectWorkspace(workspace.id); }}
                onKeyDown={(event) => reorder.onReorderKey(event, workspace.id, index)}
              >
                <span aria-hidden="true">{getWorkspaceMonogram(label)}</span>
                {remoteLabel && <span className="ws-rail-mark-remote" aria-hidden="true" />}
                {workspace.isLinkedWorktree && <GitBranch className="ws-rail-mark-worktree" size={9} strokeWidth={2.5} aria-hidden="true" />}
                {pending && <span className={`ws-rail-mark-badge ${pending}`} aria-hidden="true" />}
              </button>
              {workspace.terminals.length > 0 && (
                <div className="ws-rail-agents" role="group" aria-label={`${label} agents`}>
                  {workspace.terminals.map((terminal) => (
                    <RailAgent
                      key={terminal.id}
                      workspace={workspace}
                      terminal={terminal}
                      isCurrent={isActive && workspace.activeTerminalId === terminal.id}
                      suppressClickRef={reorder.suppressClickRef}
                    />
                  ))}
                </div>
              )}
            </li>
          );
        })}
        {assistantsEnabled && assistants.length > 0 && (
          <li className="ws-rail-workspace" aria-label="Assistants">
            {assistants.map((assistant) => <AssistantButton key={assistant.id} assistant={assistant} live={live.has(assistant.id)} variant="icon" />)}
          </li>
        )}
        {/* Opening a workspace sits right under the open ones, not down with the footer. */}
        {onOpenWorkspace && (
          <li className="ws-rail-workspace ws-rail-add">
            <IconButton size="xs" variant="ghost" className="ws-rail-action" aria-label="Open Workspace" title="Open Workspace" onClick={onOpenWorkspace}>
              <Plus size={14} strokeWidth={2.5} />
            </IconButton>
          </li>
        )}
      </ul>

      <div className="ws-rail-footer">
        {nextTarget && (
          <IconButton
            size="xs"
            variant="ghost"
            className="ws-rail-action attention"
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
        {showFiles && (
          <IconButton
            size="xs"
            variant="ghost"
            className="ws-rail-action"
            aria-label="Show Files"
            title="Show Files"
            onClick={toggleFocusedWorkspaceExplorer}
          >
            <FolderTree size={14} strokeWidth={2} />
          </IconButton>
        )}
      </div>
    </nav>
  );
}
