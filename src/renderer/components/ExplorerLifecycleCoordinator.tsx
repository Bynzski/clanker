import { useEffect } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { focusedFileCheckout } from '../lib/fileCheckout';

/** Align the single local tree watcher with focus; same-checkout terminal switches are no-ops. */
export default function ExplorerLifecycleCoordinator() {
  useEffect(() => {
    let previousKey = '';
    const sync = () => {
      if (typeof window.electronAPI?.explorerStartWatching !== 'function') return;
      const state = useWorkspaceStore.getState();
      const workspace = state.getWorkspaceById(state.activeWorkspaceId);
      const root = workspace ? focusedFileCheckout(workspace) : null;
      const local = workspace && (workspace.environmentId ?? 'local') === 'local';
      const key = JSON.stringify(local ? [workspace.id, root?.workspacePath, root?.checkoutContextId] : null);
      if (key === previousKey) return;
      previousKey = key;
      const request = local
        ? root?.checkoutContextId
          ? window.electronAPI.explorerStartWatching(workspace.id, root.checkoutContextId)
          : window.electronAPI.explorerStartWatching(workspace.id)
        : window.electronAPI.explorerStopWatching?.();
      void request?.catch((error) => console.warn('Could not update Explorer watcher:', error));
    };
    sync();
    const unsubscribe = useWorkspaceStore.subscribe(sync);
    return () => {
      unsubscribe();
      void window.electronAPI.explorerStopWatching?.();
    };
  }, []);
  return null;
}
