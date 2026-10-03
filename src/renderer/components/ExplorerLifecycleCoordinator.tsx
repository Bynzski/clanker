import { useEffect } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';

/**
 * Nonvisual owner of the local Explorer watcher.
 *
 * Keeps the single main-process watcher aligned with the active workspace.
 * Only an active local workspace is watched; parked workspaces keep cached
 * explorer state and refresh when activated again. SSH workspaces never route
 * through the local watcher (remote polling is owned elsewhere).
 */
export default function ExplorerLifecycleCoordinator() {
  useEffect(() => {
    const syncExplorerWatcher = async (
      workspaceId: string | null,
      state = useWorkspaceStore.getState(),
    ) => {
      if (typeof window.electronAPI?.explorerStartWatching !== 'function') {
        return;
      }

      const workspace = state.getWorkspaceById(workspaceId);
      if (!workspace) {
        if (typeof window.electronAPI?.explorerStopWatching === 'function') {
          await window.electronAPI.explorerStopWatching();
        }
        return;
      }

      if ((workspace.environmentId ?? 'local') !== 'local') {
        await window.electronAPI.explorerStopWatching();
        return;
      }
      await window.electronAPI.explorerStartWatching(workspace.id);
    };

    void syncExplorerWatcher(useWorkspaceStore.getState().activeWorkspaceId);

    const unsubscribe = useWorkspaceStore.subscribe((state, prevState) => {
      if (state.activeWorkspaceId !== prevState.activeWorkspaceId) {
        void syncExplorerWatcher(state.activeWorkspaceId, state);
      }
    });

    return () => {
      unsubscribe();
      if (typeof window.electronAPI?.explorerStopWatching === 'function') {
        void window.electronAPI.explorerStopWatching();
      }
    };
  }, []);

  return null;
}
