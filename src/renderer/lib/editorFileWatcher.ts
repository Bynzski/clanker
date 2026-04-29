import { useWorkspaceStore, type WorkspaceTab } from '../store/workspaceStore';
import type { WorkspaceState } from '../store/workspaceStoreTypes';
import { pathKey } from '../../shared/pathKey';

interface EditorWatchTarget {
  filePath: string;
  workspaceId: string;
  workspacePath: string;
}

function getEditorWatchWorkspaces(state: WorkspaceState): Array<Pick<WorkspaceTab, 'id' | 'workspacePath' | 'editorTabs'>> {
  if (state.workspaces.length > 0) {
    return state.workspaces;
  }

  if (!state.workspacePath) {
    return [];
  }

  return [{
    id: state.activeWorkspaceId ?? 'workspace-active',
    workspacePath: state.workspacePath,
    editorTabs: state.editorTabs,
  }];
}

function getEditorWatchTargets(state: WorkspaceState): EditorWatchTarget[] {
  return getEditorWatchWorkspaces(state).flatMap((workspace) => (
    workspace.editorTabs.map((tab) => ({
      filePath: tab.filePath,
      workspaceId: workspace.id,
      workspacePath: workspace.workspacePath,
    }))
  ));
}

function getOwnerKey(target: Pick<EditorWatchTarget, 'workspaceId' | 'filePath'>): string {
  return `${target.workspaceId}:${pathKey(target.filePath)}`;
}

function buildTargetsByOwner(state: WorkspaceState): Map<string, EditorWatchTarget> {
  const targetsByOwner = new Map<string, EditorWatchTarget>();

  for (const target of getEditorWatchTargets(state)) {
    targetsByOwner.set(getOwnerKey(target), target);
  }

  return targetsByOwner;
}

function handleFileChanged(filePath: string, deleted: boolean): void {
  const state = useWorkspaceStore.getState();
  const workspaces = getEditorWatchWorkspaces(state);

  for (const workspace of workspaces) {
    for (const tab of workspace.editorTabs) {
      if (pathKey(tab.filePath) !== pathKey(filePath)) {
        continue;
      }

      if (deleted) {
        state.markEditorTabDeleted(tab.id, workspace.id);
        continue;
      }

      if (tab.isDirty) {
        state.markEditorTabExternallyChanged(tab.id, workspace.id);
        continue;
      }

      void state.reloadEditorTab(tab.id, workspace.id);
    }
  }
}

/**
 * Start the editor file watcher listener.
 *
 * Subscribes to FILE_CHANGED events from the main process and dispatches
 * the appropriate store actions (reload, mark external change, mark deleted).
 * Also keeps main-process file watch registrations aligned with the set of all
 * open editor tabs across active and parked workspaces.
 *
 * Call once at app mount. Returns an unsubscribe function.
 */
export function startEditorFileWatcher(): () => void {
  const watchedOwnersByFilePath = new Map<string, Set<string>>();
  let targetsByOwner = new Map<string, EditorWatchTarget>();

  const watchTarget = (target: EditorWatchTarget) => {
    const normalizedFilePath = pathKey(target.filePath);
    const existingOwners = watchedOwnersByFilePath.get(normalizedFilePath);
    const ownerKey = getOwnerKey(target);

    if (existingOwners) {
      existingOwners.add(ownerKey);
      return;
    }

    watchedOwnersByFilePath.set(normalizedFilePath, new Set([ownerKey]));
    void window.electronAPI.editorWatchFile({
      workspacePath: target.workspacePath,
      filePath: target.filePath,
    });
  };

  const unwatchTarget = (target: EditorWatchTarget) => {
    const normalizedFilePath = pathKey(target.filePath);
    const existingOwners = watchedOwnersByFilePath.get(normalizedFilePath);
    if (!existingOwners) {
      return;
    }

    existingOwners.delete(getOwnerKey(target));
    if (existingOwners.size > 0) {
      return;
    }

    watchedOwnersByFilePath.delete(normalizedFilePath);
    void window.electronAPI.editorUnwatchFile({
      workspacePath: target.workspacePath,
      filePath: target.filePath,
    });
  };

  const syncWatchTargets = (state: WorkspaceState) => {
    const nextTargetsByOwner = buildTargetsByOwner(state);

    for (const [ownerKey, target] of nextTargetsByOwner) {
      if (!targetsByOwner.has(ownerKey)) {
        watchTarget(target);
      }
    }

    for (const [ownerKey, target] of targetsByOwner) {
      if (!nextTargetsByOwner.has(ownerKey)) {
        unwatchTarget(target);
      }
    }

    targetsByOwner = nextTargetsByOwner;
  };

  syncWatchTargets(useWorkspaceStore.getState());

  const unsubFileChanged = window.electronAPI.onFileChanged((event) => {
    handleFileChanged(event.filePath, event.deleted);
  });

  const unsubStore = useWorkspaceStore.subscribe((state) => {
    syncWatchTargets(state);
  });

  return () => {
    for (const target of targetsByOwner.values()) {
      unwatchTarget(target);
    }

    targetsByOwner = new Map();
    unsubFileChanged();
    unsubStore();
  };
}
