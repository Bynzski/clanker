import { useWorkspaceStore } from '../store/workspaceStore';

/**
 * Start the editor file watcher listener.
 *
 * Subscribes to FILE_CHANGED events from the main process and dispatches
 * the appropriate store actions (reload, mark external change, mark deleted).
 * Also subscribes to workspace switches to update watch registrations.
 *
 * Call once at app mount. Returns an unsubscribe function.
 */
export function startEditorFileWatcher(): () => void {
  const unsubFileChanged = window.electronAPI.onFileChanged((event) => {
    handleFileChanged(event.filePath, event.deleted);
  });

  const unsubStore = useWorkspaceStore.subscribe((state, prevState) => {
    if (state.activeWorkspaceId !== prevState.activeWorkspaceId) {
      const previousWorkspace = prevState.getWorkspaceById(prevState.activeWorkspaceId);
      const nextWorkspace = state.getWorkspaceById(state.activeWorkspaceId);

      // Workspace switched — unwatch old, watch new
      for (const tab of prevState.editorTabs) {
        if (previousWorkspace == null) {
          void window.electronAPI.editorUnwatchFile({
            workspacePath: prevState.workspacePath,
            filePath: tab.filePath,
          });
          continue;
        }
        void window.electronAPI.editorUnwatchFile({
          workspacePath: previousWorkspace.workspacePath,
          filePath: tab.filePath,
        });
      }
      for (const tab of state.editorTabs) {
        if (nextWorkspace == null) {
          void window.electronAPI.editorWatchFile({
            workspacePath: state.workspacePath,
            filePath: tab.filePath,
          });
          continue;
        }
        void window.electronAPI.editorWatchFile({
          workspacePath: nextWorkspace.workspacePath,
          filePath: tab.filePath,
        });
      }
    }
  });

  return () => {
    unsubFileChanged();
    unsubStore();
  };
}

function handleFileChanged(filePath: string, deleted: boolean): void {
  const state = useWorkspaceStore.getState();
  const activeWorkspace = state.getActiveWorkspace();
  const editorTabs = activeWorkspace?.editorTabs ?? state.editorTabs;
  const tab = editorTabs.find((t) => t.filePath === filePath) ?? null;
  if (!tab) return;

  if (deleted) {
    state.markEditorTabDeleted(tab.id);
    return;
  }

  // Don't interrupt the user if they have unsaved changes
  if (tab.isDirty) {
    state.markEditorTabExternallyChanged(tab.id);
    return;
  }

  // Tab is clean — auto-reload from disk
  void state.reloadEditorTab(tab.id);
}
