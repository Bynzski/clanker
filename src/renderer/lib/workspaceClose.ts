import { useWorkspaceStore } from '../store/workspaceStore';
import { disposeWorkspaceResources } from './workspaceLifecycle';

/**
 * Canonical "close workspace" workflow shared by every navigation surface.
 *
 * Order matters: resources (PTYs, browser, active Explorer watcher) are disposed
 * first, then the renderer workspace is removed, then main's registration is
 * released. A failed unregister is logged and never resurrects the workspace.
 */
export async function closeWorkspaceWithCleanup(workspaceId: string): Promise<void> {
  const state = useWorkspaceStore.getState();
  const workspace = state.getWorkspaceById(workspaceId);
  if (workspace == null) {
    return;
  }

  await disposeWorkspaceResources(workspace, { isActiveWorkspace: state.activeWorkspaceId === workspaceId });
  useWorkspaceStore.getState().closeWorkspace(workspaceId);
  await window.electronAPI.unregisterOpenWorkspace(workspaceId).catch((error) => {
    console.error('Could not unregister closed workspace:', error);
  });
}
