import { REMOTE_WATCH_MAX_FILES, REMOTE_WATCH_MAX_DIRECTORIES, type RemoteFileWatchRequest, type RemoteFilesChangedEvent } from '../../shared/types/remoteFileWatch';
import { useWorkspaceStore } from '../store/workspaceStore';
import { isEditorOperationPending } from '../store/workspaceStoreHelpers';
import { handleWorkspaceFileChanged } from './editorFileWatcher';
import { focusedFileCheckout, pathInFileCheckout } from './fileCheckout';
import { requestCheckoutReconciliation } from './checkoutReconciliation';

/** Keep the single main-process remote poller aligned with the active workspace. */
export function startRemoteFileWatcher(): () => void {
  if (typeof window.electronAPI?.remoteFilesWatch !== 'function' || typeof window.electronAPI?.onRemoteFilesChanged !== 'function') return () => {};
  let previousKey = '';
  let stopped = false;
  let draining = false;
  // Retain notifications through pending operations and outstanding reads.
  // A tab's external-change flag can be cleared by a manual read or save.
  const pendingChanges = new Map<string, {
    workspaceId: string;
    file: RemoteFilesChangedEvent['files'][number];
    processing: boolean;
    retryIfIdle?: boolean;
  }>();
  const changeKey = (workspaceId: string, filePath: string) => JSON.stringify([workspaceId, filePath]);
  const drainChanges = () => {
    if (stopped || draining) return;
    draining = true;
    try {
      for (const [key, change] of pendingChanges) {
        const state = useWorkspaceStore.getState();
        const workspace = state.workspaces.find((entry) => entry.id === change.workspaceId);
        if (!workspace?.editorTabs.some((tab) => tab.filePath === change.file.filePath)) {
          pendingChanges.delete(key);
          continue;
        }
        if (change.processing || state.activeWorkspaceId !== workspace.id ||
            isEditorOperationPending(state, change.file.filePath, workspace.environmentId)) continue;
        change.processing = true;
        const file = change.file;
        void handleWorkspaceFileChanged(workspace, file.filePath, file.deleted, file.initial, change.retryIfIdle).then(() => {
          if (stopped || pendingChanges.get(key) !== change) return;
          change.processing = false;
          const latest = useWorkspaceStore.getState();
          // Newer notifications and notifications overlapping a manual
          // operation remain queued, regardless of the tab's current flags.
          if (change.file === file && !isEditorOperationPending(latest, file.filePath, workspace.environmentId)) pendingChanges.delete(key);
          drainChanges();
        });
      }
    } finally {
      draining = false;
    }
  };
  const sync = () => {
    const state = useWorkspaceStore.getState();
    const workspace = state.workspaces.find((entry) => entry.id === state.activeWorkspaceId);
    let request: RemoteFileWatchRequest | null = null;
    if (workspace && (workspace.environmentId ?? 'local') !== 'local') {
      const root = focusedFileCheckout(workspace);
      const filePaths = [...new Set(workspace.editorTabs.filter((tab) => tab.checkoutContextId === root.checkoutContextId && pathInFileCheckout(root.workspacePath, tab.filePath)).map((tab) => tab.filePath))].sort().slice(0, REMOTE_WATCH_MAX_FILES);
      const directoryPaths = workspace.explorerVisible
        ? [...new Set([root.workspacePath, ...workspace.explorerExpandedPaths.filter((entry) => pathInFileCheckout(root.workspacePath, entry))])].slice(0, REMOTE_WATCH_MAX_DIRECTORIES).sort()
        : [];
      if (filePaths.length || directoryPaths.length) request = { workspaceId: workspace.id, ...(root.checkoutContextId ? { checkoutContextId: root.checkoutContextId } : {}), filePaths, directoryPaths };
    }
    const key = JSON.stringify(request);
    if (key === previousKey) return;
    previousKey = key;
    void window.electronAPI.remoteFilesWatch(request).catch((error) => console.warn('Could not sync remote file monitoring:', error));
  };
  const unsubscribeEvents = window.electronAPI.onRemoteFilesChanged((event) => {
    const state = useWorkspaceStore.getState();
    if (state.activeWorkspaceId !== event.workspaceId) return;
    const workspace = state.workspaces.find((entry) => entry.id === event.workspaceId);
    if (!workspace || (workspace.environmentId ?? 'local') === 'local' || event.checkoutContextId !== focusedFileCheckout(workspace).checkoutContextId) return;
    if (event.reconcileCheckout) void requestCheckoutReconciliation(workspace.id);
    for (const file of event.files) {
      if (!workspace.editorTabs.some((tab) => tab.filePath === file.filePath)) continue;
      const key = changeKey(workspace.id, file.filePath);
      const pending = pendingChanges.get(key);
      const latestFile = { ...file, initial: file.initial && (pending?.file.initial ?? true) };
      if (pending) { pending.file = latestFile; pending.retryIfIdle = false; }
      else pendingChanges.set(key, { workspaceId: workspace.id, file: latestFile, processing: false });
    }
    for (const path of event.unchangedFilePaths ?? []) {
      const key = changeKey(workspace.id, path);
      if (!pendingChanges.has(key) && workspace.editorTabs.some((tab) => tab.filePath === path && !tab.isDirty && tab.hasExternalChange)) {
        pendingChanges.set(key, { workspaceId: workspace.id, file: { filePath: path, deleted: false, initial: false }, processing: false, retryIfIdle: true });
      }
    }
    drainChanges();
  });
  const unsubscribeStore = useWorkspaceStore.subscribe(() => { sync(); drainChanges(); });
  sync();
  return () => {
    stopped = true;
    pendingChanges.clear();
    unsubscribeStore();
    unsubscribeEvents();
    void window.electronAPI.remoteFilesWatch(null).catch(() => {});
  };
}
