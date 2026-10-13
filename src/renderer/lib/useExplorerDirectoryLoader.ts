import { useEffect, useMemo } from 'react';
import type { FileListDirectoryResult } from '../../shared/types/fileExplorer';
import { checkoutSelectionToken, subscribeCheckoutSelection } from './checkoutSelectionRuntime';
import { focusedFileCheckout, pathInFileCheckout } from './fileCheckout';
import { dirnamePath, normalizePath } from './pathUtils';
import { requestCheckoutReconciliation } from './checkoutReconciliation';
import { useWorkspaceStore } from '../store/workspaceStore';
import { ExplorerDirectoryScheduler } from './explorerDirectoryScheduler';

const explorerDirectoryScheduler = new ExplorerDirectoryScheduler();

// Loading ownership is separate from physical permits: old completion cannot clear a newer request.
const owners = new Map<string, object>();
let observing = false;
function createDirectoryLoader(workspaceId: string | null, environmentId: string, root: string, checkoutContextId: string | undefined, token: number) {
    let alive = true;
    const valid = () => {
      const state = useWorkspaceStore.getState();
      const workspace = workspaceId ? state.getWorkspaceById(workspaceId) : null;
      if (!alive || !root || !workspace || state.activeWorkspaceId !== workspaceId || !workspace.explorerVisible
        || (workspace.environmentId ?? 'local') !== environmentId || checkoutSelectionToken(workspace.id) !== token) return false;
      const current = focusedFileCheckout(workspace);
      return normalizePath(current.workspacePath) === root && current.checkoutContextId === checkoutContextId;
    };
    const load = (path: string, options: { force?: boolean; background?: boolean } = {}): Promise<FileListDirectoryResult> => {
      const directoryPath = normalizePath(path);
      if (!workspaceId || !valid() || !pathInFileCheckout(root, directoryPath)) return Promise.resolve({ success: false, entries: [], errorCode: 'invalid-path', error: 'Checkout is unavailable' });
      if (!observing) { observing = true; subscribeCheckoutSelection(() => explorerDirectoryScheduler.prune()); }
      const stateKey = JSON.stringify([workspaceId, directoryPath]);
      const owner = {};
      const clearLoading = () => {
        if (owners.get(stateKey) !== owner) return;
        owners.delete(stateKey);
        useWorkspaceStore.getState().setExplorerDirectoryLoading(directoryPath, false, workspaceId);
      };
      return explorerDirectoryScheduler.request({
        key: JSON.stringify([workspaceId, environmentId, checkoutContextId, root, token, directoryPath]),
        remote: environmentId !== 'local', priority: directoryPath === root || !options.background ? 0 : 1,
        force: options.force ?? false, valid,
        queued: () => { owners.set(stateKey, owner); useWorkspaceStore.getState().setExplorerDirectoryLoading(directoryPath, true, workspaceId); },
        retired: clearLoading,
        read: async current => {
          if (!current()) return { success: false, entries: [], errorCode: 'unknown', error: 'Directory request retired' };
          const ancestors = [directoryPath];
          while (ancestors[ancestors.length - 1] !== root) {
            const parent = dirnamePath(ancestors[ancestors.length - 1]);
            if (parent === ancestors[ancestors.length - 1]) break;
            ancestors.push(parent);
          }
          const revisions = useWorkspaceStore.getState().getWorkspaceById(workspaceId)?.explorerRevisionByPath;
          const expected = ancestors.map(path => revisions?.[path] ?? 0);
          const applicable = () => current() && ancestors.every((path, index) => (useWorkspaceStore.getState().getWorkspaceById(workspaceId)?.explorerRevisionByPath?.[path] ?? 0) === expected[index]);
          let result: FileListDirectoryResult;
          try {
            result = await window.electronAPI.fileListDirectory({ workspacePath: root, workspaceId, ...(checkoutContextId ? { checkoutContextId } : {}), directoryPath });
          } catch (error) {
            result = { success: false, entries: [], errorCode: 'unknown', error: error instanceof Error && error.message.trim() ? error.message : 'Unable to load directory' };
          }
          if (applicable()) {
            const state = useWorkspaceStore.getState();
            if (result.success) state.setExplorerDirectoryEntries(directoryPath, result.entries.map(entry => ({ ...entry, path: normalizePath(entry.path) })), workspaceId, token);
            else {
              state.setExplorerDirectoryError(directoryPath, result.error || 'Unable to load directory', workspaceId);
              if (checkoutContextId) void requestCheckoutReconciliation(workspaceId);
            }
          }
          return result;
        },
      });
    };
    return { load, valid, activate: () => { alive = true; }, dispose: () => { alive = false; explorerDirectoryScheduler.prune(); } };
}

export function useExplorerDirectoryLoader(workspaceId: string | null, environmentId: string, root: string, checkoutContextId?: string) {
  const token = workspaceId ? checkoutSelectionToken(workspaceId) : -1;
  const loader = useMemo(() => createDirectoryLoader(workspaceId, environmentId, root, checkoutContextId, token), [workspaceId, environmentId, root, checkoutContextId, token]);
  useEffect(() => { loader.activate(); return loader.dispose; }, [loader]);
  return loader;
}
