import { workspaceBrowserPresented } from '../store/workspacePages';
import { useAssistantNavStore } from '../store/assistantNavStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { currentBrowserPresentation } from './browserPresentation';

export async function createAndActivateBrowserTab(workspaceId: string, url?: string, paneId?: string): Promise<string | null> {
  const store = useWorkspaceStore.getState();
  const workspace = store.getWorkspaceById(workspaceId);
  const pane = paneId && workspace?.pages ? workspace.pages.find((page) => page.browser?.pane?.id === paneId)?.browser?.pane
    : !paneId || workspace?.browserPane?.id === paneId ? workspace?.browserPane : null;
  if (!pane) return null;
  const tabId = store.addBrowserTab(workspaceId, workspace?.pages ? pane.id : undefined);
  if (!tabId) return null;
  const exists = () => {
    const owner = useWorkspaceStore.getState().getWorkspaceById(workspaceId);
    return owner === undefined ? false : Boolean(owner?.pages ? owner.pages.some((page) => page.browser?.pane?.id === pane.id && page.browser.pane.tabs.some((tab) => tab.id === tabId))
      : owner?.browserPane?.id === pane.id && owner.browserPane.tabs.some((tab) => tab.id === tabId));
  };
  if (!exists()) return null;
  if (workspace?.pages) await window.electronAPI.browserCreateTab(workspaceId, tabId, pane.id);
  else await window.electronAPI.browserCreateTab(workspaceId, tabId);
  if (!exists()) { await window.electronAPI.browserCloseTab(workspaceId, tabId); return null; }
  if (url) {
    if (!await window.electronAPI.browserTabNavigate(workspaceId, tabId, url) || !exists()) return null;
    useWorkspaceStore.getState().updateBrowserTab(tabId, { url }, workspaceId);
  }
  await syncSelectedBrowserTab(workspaceId, tabId);
  return tabId;
}

export async function syncSelectedBrowserTab(workspaceId: string, expectedTabId?: string): Promise<void> {
  const state = useWorkspaceStore.getState();
  const workspace = state.getWorkspaceById(workspaceId);
  const tabId = workspace?.browserPane?.activeTabId;
  if (useAssistantNavStore.getState().activeAssistantId || state.activeWorkspaceId !== workspaceId || !workspace
    || !workspaceBrowserPresented(workspace) || workspace.browserOverlayCount || !tabId || (expectedTabId && tabId !== expectedTabId)) return;
  const presentation = currentBrowserPresentation(workspaceId, workspace.browserPane?.id, tabId);
  if (presentation?.ready) await window.electronAPI.browserSwitchTab(workspaceId, tabId, presentation.lease);
  else if (!workspace.pages) await window.electronAPI.browserSwitchTab(workspaceId, tabId);
}

/** Explicit target pages may be populated in the background, without selecting them. */
export async function openUrlInWorkspaceBrowser(workspaceId: string, url: string, pageId?: string): Promise<string | null> {
  const store = useWorkspaceStore.getState();
  const workspace = store.getWorkspaceById(workspaceId);
  if (!workspace || useAssistantNavStore.getState().activeAssistantId || workspace.id !== store.activeWorkspaceId) return null;
  const target = pageId ?? workspace.activePageId;
  if (target && !workspace.pages?.some((page) => page.id === target)) return null;
  store.setBrowserVisible(true, workspaceId, target);
  const live = useWorkspaceStore.getState().getWorkspaceById(workspaceId);
  const pane = target ? live?.pages?.find((page) => page.id === target)?.browser?.pane : live?.browserPane;
  return pane ? createAndActivateBrowserTab(workspaceId, url, pane.id) : null;
}
