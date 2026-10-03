import { selectFocusedWorkspace, useWorkspaceStore } from '../store/workspaceStore';
import { useWorkspaceNavigationStore } from '../store/workspaceNavigationStore';
import { isWorkspaceSidebarCollapsed } from '../../shared/types/workspaceNavigation';

/** Whether the focused workspace's Files/Explorer panel is actually on screen. */
export function isExplorerShown(explorerVisible: boolean, mode: string, sidebarWidth: number): boolean {
  // The collapsed sidebar rail has no room for FILES, so it never counts as shown.
  return explorerVisible && !(mode === 'sidebar' && isWorkspaceSidebarCollapsed(sidebarWidth));
}

/**
 * Toggles the Files section (sidebar mode) or Explorer dock (tabs mode) for the
 * focused workspace. Opening Files from the collapsed rail expands the sidebar
 * first, since FILES lives in the expanded shell.
 */
export function toggleFocusedWorkspaceExplorer(): void {
  const state = useWorkspaceStore.getState();
  const workspace = selectFocusedWorkspace(state);
  if (!workspace) return;
  const navigation = useWorkspaceNavigationStore.getState();
  if (navigation.mode === 'sidebar' && isWorkspaceSidebarCollapsed(navigation.sidebarWidth)) {
    navigation.expandSidebar();
    if (!workspace.explorerVisible) state.setExplorerVisible(true, workspace.id);
    return;
  }
  state.setExplorerVisible(!workspace.explorerVisible, workspace.id);
}
