import { useWorkspaceStore } from '../store/workspaceStore';

/** Create a browser tab in renderer and main state, activate it, and optionally navigate it. */
export async function createAndActivateBrowserTab(
  workspaceId: string,
  url?: string,
): Promise<string | null> {
  const store = useWorkspaceStore.getState();
  const tabId = store.addBrowserTab(workspaceId);
  if (!tabId) return null;

  await window.electronAPI.browserCreateTab(workspaceId, tabId);

  const exists = () => useWorkspaceStore.getState().getWorkspaceById(workspaceId)?.browserPane?.tabs.some((tab) => tab.id === tabId);
  if (!exists()) return null;

  if (url) {
    // Start the target tab's navigation before switching the native view. Main
    // loads tab-scoped views even in the background, so concurrent activations
    // cannot redirect or strand one another on the default page.
    const navigated = await window.electronAPI.browserTabNavigate(workspaceId, tabId, url);
    if (!navigated) return null;
    if (!exists()) return null;
    useWorkspaceStore.getState().updateBrowserTab(tabId, { url }, workspaceId);
  }

  // addBrowserTab already selected this tab. Do not reclaim selection after
  // asynchronous creation/navigation if the user has since selected another.
  await syncSelectedBrowserTab(workspaceId, tabId);

  return tabId;
}

/** Synchronize only the current foreground selection after an async operation. */
export async function syncSelectedBrowserTab(workspaceId: string, expectedTabId?: string): Promise<void> {
  const state = useWorkspaceStore.getState();
  const workspace = state.getWorkspaceById(workspaceId);
  const tabId = workspace?.browserPane?.activeTabId;
  if (state.activeWorkspaceId !== workspaceId || !workspace?.browserVisible || !tabId
    || (expectedTabId && tabId !== expectedTabId)) return;
  await window.electronAPI.browserSwitchTab(workspaceId, tabId);
}

/** Ensure the active workspace browser is visible, then open a URL in a new tab. */
export async function openUrlInWorkspaceBrowser(
  workspaceId: string,
  url: string,
): Promise<string | null> {
  const store = useWorkspaceStore.getState();
  const workspace = store.getWorkspaceById(workspaceId);
  if (!workspace || workspace.id !== store.activeWorkspaceId) return null;

  if (!workspace.browserVisible) {
    store.toggleBrowser();
  }

  return createAndActivateBrowserTab(workspaceId, url);
}
