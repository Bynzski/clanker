import { collectLeafPaneIds } from '../store/workspaceLayout';
import type { WorkspaceTab } from '../store/workspaceTypes';

/** A minimized terminal retains its page membership; presentation is never restored here. */
export function terminalPageId(workspace: WorkspaceTab, terminalId?: string): string | undefined {
  if (!terminalId) return workspace.activePageId;
  const pane = workspace.panes.find((entry) => entry.terminalId === terminalId);
  if (!pane) return undefined;
  return workspace.pages?.find((page) => collectLeafPaneIds(page.layoutRoot).includes(pane.id)
    || workspace.minimizedPanes?.some((entry) => entry.paneId === pane.id && entry.pageId === page.id))?.id;
}
