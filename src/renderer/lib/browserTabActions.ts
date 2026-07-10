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

  if (url) {
    // Start the target tab's navigation before switching the native view. Main
    // loads tab-scoped views even in the background, so concurrent activations
    // cannot redirect or strand one another on the default page.
    const navigated = await window.electronAPI.browserTabNavigate(workspaceId, tabId, url);
    if (!navigated) return null;
    useWorkspaceStore.getState().updateBrowserTab(tabId, { url }, workspaceId);
  }

  store.setActiveBrowserTab(tabId, workspaceId);
  await window.electronAPI.browserSwitchTab(workspaceId, tabId);

  return tabId;
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
