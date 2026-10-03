import { BellRing, FolderTree, GitBranch, PanelLeftOpen, Plus } from 'lucide-react';
import { IconButton } from './ui/IconButton';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { Terminal, WorkspaceTab } from '../store/workspaceTypes';
import { attentionCounts, useAgentAttentionStore } from '../store/agentAttentionStore';
import { nextAttentionTarget } from '../lib/agentAttentionNavigation';
import { getAttentionDisplay, getAttentionSuffix } from '../lib/agentAttentionPresentation';
import { getHarnessOption } from '../lib/harnessOptions';
import { getRemoteEnvironmentLabel, getWorkspaceTabLabel } from '../lib/workspaceLabels';
import { toggleFocusedWorkspaceExplorer } from '../lib/explorerToggle';
import './WorkspaceRail.css';

/** Two-letter mark for a workspace: word initials ("demo-repo" → "DR") or the first two letters. */
export function getWorkspaceMonogram(label: string): string {
  const words = label.split(/[\s._/-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return letters.toUpperCase();
}

function RailAgent({ workspace, terminal, isCurrent }: { workspace: WorkspaceTab; terminal: Terminal; isCurrent: boolean }) {
  const selectWorkspace = useWorkspaceStore((state) => state.selectWorkspace);
  const attention = useAgentAttentionStore((state) => state.byTerminalId[terminal.id]);
  const harness = getHarnessOption(terminal.harnessId);
  const HarnessIcon = harness.Icon;
  const name = terminal.displayName ?? harness.label;
  const attentionOn = Boolean(terminal.harnessId && terminal.attentionEnabled);
  const display = attentionOn ? getAttentionDisplay(attention) : null;
  const suffix = attentionOn ? getAttentionSuffix(attention) : '';

  return (
    <button
      type="button"
      className={`ws-rail-agent${isCurrent ? ' current' : ''}`}
      aria-current={isCurrent ? 'true' : undefined}
      aria-label={`${name} · ${harness.label}${suffix}`}
      title={`${name} · ${harness.label}${suffix}`}
      onClick={() => selectWorkspace(workspace.id, terminal.id)}
    >
      <HarnessIcon size={14} strokeWidth={2} />
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
 * harness icons. Selection matches the expanded navigator; it never changes
 * residency or terminals.
 */
export default function WorkspaceRail({ onOpenWorkspace, onExpand }: WorkspaceRailProps) {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const activeTerminalId = useWorkspaceStore((state) => state.activeTerminalId);
  const selectWorkspace = useWorkspaceStore((state) => state.selectWorkspace);
  const byTerminalId = useAgentAttentionStore((state) => state.byTerminalId);
  const nextTarget = nextAttentionTarget(workspaces, byTerminalId, activeTerminalId);

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
        {workspaces.map((workspace) => {
          const isActive = workspace.id === activeWorkspaceId;
          const label = getWorkspaceTabLabel(workspace);
          const remoteLabel = getRemoteEnvironmentLabel(workspace);
          const branch = workspace.gitCurrentBranch;
          const counts = attentionCounts(workspace.terminals.map((terminal) => terminal.id), byTerminalId);
          const pending = counts.needsInput > 0 ? 'needs-input' : counts.completed > 0 ? 'complete' : null;
          const details = [
            remoteLabel,
            label,
            workspace.isLinkedWorktree && branch ? `worktree · ${branch}` : null,
            workspace.workspacePath,
          ].filter(Boolean).join('\n');

          return (
            <li key={workspace.id} className={`ws-rail-workspace${isActive ? ' active' : ''}`} data-rail-workspace-id={workspace.id}>
              <button
                type="button"
                className="ws-rail-mark"
                aria-current={isActive ? 'true' : undefined}
                aria-label={remoteLabel ? `${remoteLabel} · ${label}` : label}
                title={details}
                onClick={() => selectWorkspace(workspace.id)}
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
                    />
                  ))}
                </div>
              )}
            </li>
          );
        })}
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
      </div>
    </nav>
  );
}
