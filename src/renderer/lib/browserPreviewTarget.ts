import { collectLeafPaneIds } from '../store/workspaceLayout';
import type { WorkspaceTab } from '../store/workspaceTypes';

/** Relevant user selection, not periodically refreshed title/history metadata. */
export function browserPageSelection(workspace: WorkspaceTab, pageId?: string): string {
  const page = workspace.pages?.find((entry) => entry.id === pageId);
  const pane = page?.browser?.pane ?? (!workspace.pages ? workspace.browserPane : null);
  return JSON.stringify([pane?.id, pane?.activeTabId, pane?.tabs.find((tab) => tab.id === pane.activeTabId)?.url,
    page?.browser?.visible ?? (!workspace.pages && workspace.browserVisible), page?.maximizedPaneId,
    workspace.minimizedPanes?.some((entry) => entry.paneId === pane?.id)]);
}

/** A minimized terminal retains its page membership; presentation is never restored here. */
export function terminalPageId(workspace: WorkspaceTab, terminalId?: string): string | undefined {
  if (!terminalId) return workspace.activePageId;
  const pane = workspace.panes.find((entry) => entry.terminalId === terminalId);
  if (!pane) return undefined;
  return workspace.pages?.find((page) => collectLeafPaneIds(page.layoutRoot).includes(pane.id)
    || workspace.minimizedPanes?.some((entry) => entry.paneId === pane.id && entry.pageId === page.id))?.id;
}
