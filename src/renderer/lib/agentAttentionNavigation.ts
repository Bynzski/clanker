import type { WorkspaceTab } from '../store/workspaceTypes';
import type { AgentAttentionSnapshot } from '../../shared/types/agentAttention';
import type { AttentionSeen } from '../store/agentAttentionStore';
import { deriveAttention } from './agentAttentionPresentation';
import { collectLeafPaneIds } from '../store/workspaceLayout';

export interface AttentionTarget {
  workspaceId: string;
  terminalId: string;
}

export function nextAttentionTarget(
  workspaces: WorkspaceTab[],
  byTerminalId: Record<string, AgentAttentionSnapshot>,
  seenByTerminalId: Record<string, AttentionSeen>,
  currentTerminalId: string | null,
): AttentionTarget | null {
  const ordered = workspaces.flatMap((workspace) => {
    const paneById = new Map(workspace.panes.map((pane) => [pane.id, pane]));
    const terminalIds = new Set(workspace.terminals.map((terminal) => terminal.id));
    const paneIds = workspace.pages
      ? [...workspace.pages.flatMap((page) => collectLeafPaneIds(page.layoutRoot)), ...(workspace.minimizedPanes ?? []).map((entry) => entry.paneId)]
      : workspace.layoutRoot ? collectLeafPaneIds(workspace.layoutRoot) : workspace.panes.map((pane) => pane.id);
    return paneIds.flatMap((paneId) => {
      const terminalId = paneById.get(paneId)?.terminalId;
      return terminalId && terminalIds.has(terminalId)
        ? [{ workspaceId: workspace.id, terminalId }]
        : [];
    });
  });
  if (ordered.length === 0) return null;
  const currentIndex = ordered.findIndex((item) => item.terminalId === currentTerminalId);
  const rotated = [...ordered.slice(currentIndex + 1), ...ordered.slice(0, currentIndex + 1)];
  const unseen = (display: 'needs_input' | 'turn_complete') => rotated.find((target) => {
    const view = deriveAttention(byTerminalId[target.terminalId], seenByTerminalId[target.terminalId]);
    return view?.unseen && view.display === display;
  });
  return unseen('needs_input') ?? unseen('turn_complete') ?? null;
}
