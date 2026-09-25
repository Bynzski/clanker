import type { WorkspaceTab } from '../store/workspaceTypes';
import type { TerminalAttention } from '../store/agentAttentionStore';
import { collectLeafPaneIds } from '../store/workspaceLayout';

export interface AttentionTarget {
  workspaceId: string;
  terminalId: string;
}

export function nextAttentionTarget(
  workspaces: WorkspaceTab[],
  byTerminalId: Record<string, TerminalAttention>,
  currentTerminalId: string | null,
): AttentionTarget | null {
  const ordered = workspaces.flatMap((workspace) => {
    const paneById = new Map(workspace.panes.map((pane) => [pane.id, pane]));
    const terminalIds = new Set(workspace.terminals.map((terminal) => terminal.id));
    const paneIds = workspace.layoutRoot
      ? collectLeafPaneIds(workspace.layoutRoot)
      : workspace.panes.map((pane) => pane.id);
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
  return rotated.find((target) => byTerminalId[target.terminalId]?.unseen
    && byTerminalId[target.terminalId]?.lifecycle === 'needs_input')
    ?? rotated.find((target) => byTerminalId[target.terminalId]?.unseen
      && byTerminalId[target.terminalId]?.lifecycle === 'turn_complete')
    ?? null;
}
