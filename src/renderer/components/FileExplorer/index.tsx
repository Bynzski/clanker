import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDragHandle } from '../dragHandleContext';
import { Eye, EyeOff, FilePlus, FolderPlus, PanelLeftClose, RefreshCw } from 'lucide-react';
import type React from 'react';
import type { FileListDirectoryResult } from '../../../shared/types/fileExplorer';
import type { FileExplorerEntry } from '../../../shared/types/fileExplorer';
import { dirnamePath, joinPaths, normalizePath } from '../../lib/pathUtils';
import { pathKey } from '../../../shared/pathKey';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useScopedWorkspace } from '../WorkspaceScope';
import FileTree from './FileTree';
import ContextMenu, { type ContextAction } from './ContextMenu';
import ConfirmCloseDialog from '../ConfirmCloseDialog';
import {
  type ExplorerActionDeps,
  dispatchContextAction,
  executeDelete,
  executeRename,
} from './explorerActionHandlers';
import './FileExplorer.css';

const EXPLORER_TREE_REFRESH_DEBOUNCE_MS = 100;

function getDirectoryLoadErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return 'Unable to load directory';
}



function resolveCreateParentPath(
  workspacePath: string,
  selectedPath: string | null,
  expandedPaths: string[],
  explorerEntriesByPath: Record<string, FileExplorerEntry[] | undefined>
): string {
  if (!selectedPath) {
    return workspacePath;
  }

  if (selectedPath === workspacePath) {
    return workspacePath;
  }

  if (
    expandedPaths.includes(selectedPath) ||
    Object.prototype.hasOwnProperty.call(explorerEntriesByPath, selectedPath)
  ) {
    return selectedPath;
  }

  return dirnamePath(selectedPath);
}

export default function FileExplorer({ workspaceId }: { workspaceId?: string }) {
  const workspace = useScopedWorkspace(workspaceId);
  const {
    setExplorerSelectedPath,
    toggleExplorerPath,
    setExplorerVisible,
    setShowHiddenFiles,
    setExplorerSidebarWidth,
    setExplorerDirectoryEntries,
    setExplorerDirectoryLoading,
    setExplorerDirectoryError,
    setExplorerExpandedPaths,
    clearExplorerDirectoryState,
    pushBrowserOverlay,
    popBrowserOverlay,
  } = useWorkspaceStore();
  const resolvedWorkspaceId = workspace?.id ?? null;
  const workspacePath = workspace?.workspacePath ?? '';
  const gitChanges = workspace?.gitChanges ?? [];
  const explorerVisible = workspace?.explorerVisible ?? false;
  const explorerSidebarWidth = workspace?.explorerSidebarWidth ?? 280;
  const explorerEntriesByPath = useMemo(() => workspace?.explorerEntriesByPath ?? {}, [workspace]);
  const explorerLoadingPaths = useMemo(() => workspace?.explorerLoadingPaths ?? [], [workspace]);
  const explorerErrorsByPath = useMemo(() => workspace?.explorerErrorsByPath ?? {}, [workspace]);
  const explorerExpandedPaths = useMemo(() => workspace?.explorerExpandedPaths ?? [], [workspace]);
  const showHiddenFiles = workspace?.showHiddenFiles ?? true;
  const explorerSelectedPath = workspace?.explorerSelectedPath ?? null;

  const normalizedWorkspacePath = workspacePath ? normalizePath(workspacePath) : workspacePath;

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileExplorerEntry } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileExplorerEntry | null>(null);
  const [creating, setCreating] = useState<{ parentPath: string; type: 'file' | 'directory' } | null>(null);
  const [renaming, setRenaming] = useState<{ path: string; originalName: string } | null>(null);
  const dragHandleProps = useDragHandle();
  const explorerTreeRefreshTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const previousExplorerVisibleRef = useRef(explorerVisible);

  // Hide the native browser whenever the delete confirmation modal is open.
  useEffect(() => {
    if (!deleteTarget || !resolvedWorkspaceId) return;
    pushBrowserOverlay(resolvedWorkspaceId);
    return () => popBrowserOverlay(resolvedWorkspaceId);
  }, [deleteTarget, resolvedWorkspaceId, pushBrowserOverlay, popBrowserOverlay]);

  const loadDirectory = useCallback(async (directoryPath: string): Promise<FileListDirectoryResult> => {
    const normalizedDirectoryPath = normalizePath(directoryPath);
    const requestWorkspaceId = resolvedWorkspaceId;
    if (!normalizedWorkspacePath || !requestWorkspaceId) {
      return {
        success: false,
        entries: [],
        errorCode: 'invalid-path',
        error: 'Workspace path is unavailable',
      };
    }

    setExplorerDirectoryLoading(normalizedDirectoryPath, true, requestWorkspaceId);
    setExplorerDirectoryError(normalizedDirectoryPath, null, requestWorkspaceId);

    try {
      const result = await window.electronAPI.fileListDirectory({
        workspacePath: normalizedWorkspacePath,
        directoryPath: normalizedDirectoryPath,
      });

      const liveWorkspace = useWorkspaceStore.getState().getWorkspaceById(requestWorkspaceId);
      if (liveWorkspace == null) {
        return result;
      }

      if (result.success) {
        // Normalize entry paths from main process to forward slashes.
        // On Windows, path.join() in the main process produces backslash
        // separators, but the renderer stores keys with forward slashes.
        const normalizedEntries = result.entries.map((entry: FileExplorerEntry) => ({
          ...entry,
          path: normalizePath(entry.path),
        }));
        setExplorerDirectoryEntries(normalizedDirectoryPath, normalizedEntries, requestWorkspaceId);
        setExplorerDirectoryError(normalizedDirectoryPath, null, requestWorkspaceId);
      } else {
        setExplorerDirectoryEntries(normalizedDirectoryPath, [], requestWorkspaceId);
        setExplorerDirectoryError(normalizedDirectoryPath, result.error ?? 'Unable to load directory', requestWorkspaceId);
      }

      return result;
    } catch (error) {
      const errorMessage = getDirectoryLoadErrorMessage(error);
      console.error('Failed to load directory', {
        workspacePath: normalizedWorkspacePath,
        directoryPath: normalizedDirectoryPath,
        error,
      });

      if (useWorkspaceStore.getState().getWorkspaceById(requestWorkspaceId) != null) {
        setExplorerDirectoryEntries(normalizedDirectoryPath, [], requestWorkspaceId);
        setExplorerDirectoryError(normalizedDirectoryPath, errorMessage, requestWorkspaceId);
      }

      return {
        success: false,
        entries: [],
        errorCode: 'unknown',
        error: errorMessage,
      };
    } finally {
      if (useWorkspaceStore.getState().getWorkspaceById(requestWorkspaceId) != null) {
        setExplorerDirectoryLoading(normalizedDirectoryPath, false, requestWorkspaceId);
      }
    }
  }, [
    resolvedWorkspaceId,
    normalizedWorkspacePath,
    setExplorerDirectoryEntries,
    setExplorerDirectoryError,
    setExplorerDirectoryLoading,
  ]);

  const handleRefresh = useCallback(() => {
    const pathsToReload = [normalizedWorkspacePath, ...explorerExpandedPaths].filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    );
    pathsToReload.forEach((dirPath) => {
      void loadDirectory(dirPath);
    });
  }, [normalizedWorkspacePath, explorerExpandedPaths, loadDirectory]);

  const scheduleDirectoryRefresh = useCallback(function scheduleDirectoryRefreshImpl(directoryPath: string) {
    if (!normalizedWorkspacePath) {
      return;
    }

    const normalizedDirectoryPath = normalizePath(directoryPath);
    const currentState = useWorkspaceStore.getState();
    const currentWorkspace = resolvedWorkspaceId ? currentState.getWorkspaceById(resolvedWorkspaceId) : null;
    if (!currentWorkspace?.explorerVisible) {
      return;
    }

    const currentWorkspacePath = currentWorkspace.workspacePath ? normalizePath(currentWorkspace.workspacePath) : null;
    const isRootDirectory = currentWorkspacePath === normalizedDirectoryPath;
    const isExpandedDirectory = currentWorkspace.explorerExpandedPaths.includes(normalizedDirectoryPath);
    const hasCachedEntries = Object.prototype.hasOwnProperty.call(
      currentWorkspace.explorerEntriesByPath,
      normalizedDirectoryPath
    );

    if (!isRootDirectory && !isExpandedDirectory && !hasCachedEntries) {
      return;
    }

    const refreshKey = pathKey(normalizedDirectoryPath);
    const existingTimer = explorerTreeRefreshTimersRef.current.get(refreshKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      explorerTreeRefreshTimersRef.current.delete(refreshKey);

      const latestState = useWorkspaceStore.getState();
      const latestWorkspace = resolvedWorkspaceId ? latestState.getWorkspaceById(resolvedWorkspaceId) : null;
      if (!latestWorkspace?.explorerVisible) {
        return;
      }

      const latestWorkspacePath = latestWorkspace.workspacePath ? normalizePath(latestWorkspace.workspacePath) : null;
      const stillRefreshable = latestWorkspacePath === normalizedDirectoryPath
        || latestWorkspace.explorerExpandedPaths.includes(normalizedDirectoryPath)
        || Object.prototype.hasOwnProperty.call(latestWorkspace.explorerEntriesByPath, normalizedDirectoryPath);

      if (!stillRefreshable) {
        return;
      }

      if (latestWorkspace.explorerLoadingPaths.includes(normalizedDirectoryPath)) {
        scheduleDirectoryRefreshImpl(normalizedDirectoryPath);
        return;
      }

      void loadDirectory(normalizedDirectoryPath);
    }, EXPLORER_TREE_REFRESH_DEBOUNCE_MS);

    explorerTreeRefreshTimersRef.current.set(refreshKey, timer);
  }, [resolvedWorkspaceId, loadDirectory, normalizedWorkspacePath]);

  useEffect(() => {
    const wasVisible = previousExplorerVisibleRef.current;
    previousExplorerVisibleRef.current = explorerVisible;

    if (!wasVisible && explorerVisible) {
      for (const timer of explorerTreeRefreshTimersRef.current.values()) {
        clearTimeout(timer);
      }
      explorerTreeRefreshTimersRef.current.clear();
      handleRefresh();
    }
  }, [explorerVisible, handleRefresh]);

  useEffect(() => {
    const refreshTimers = explorerTreeRefreshTimersRef.current;
    return () => {
      for (const timer of refreshTimers.values()) {
        clearTimeout(timer);
      }
      refreshTimers.clear();
    };
  }, [resolvedWorkspaceId, normalizedWorkspacePath]);

  useEffect(() => {
    if (!explorerVisible || !normalizedWorkspacePath) {
      return;
    }

    const hasRootEntries = Object.prototype.hasOwnProperty.call(explorerEntriesByPath, normalizedWorkspacePath);
    const isRootLoading = explorerLoadingPaths.includes(normalizedWorkspacePath);
    if (!hasRootEntries && !isRootLoading) {
      void loadDirectory(normalizedWorkspacePath);
    }
  }, [explorerEntriesByPath, explorerLoadingPaths, explorerVisible, loadDirectory, normalizedWorkspacePath]);

  /**
   * Subscribe to filesystem change events from the explorer watcher.
   * When a file or directory is created/deleted/renamed, reload the affected
   * parent directory to update the tree automatically.
   * Hidden explorers ignore live change events and refresh the visible tree
   * when the pane is shown again.
   */
  useEffect(() => {
    const dispose = window.electronAPI.onExplorerTreeChanged((event) => {
      const liveWorkspace = resolvedWorkspaceId
        ? useWorkspaceStore.getState().getWorkspaceById(resolvedWorkspaceId)
        : null;
      if (!liveWorkspace?.explorerVisible) {
        return;
      }

      scheduleDirectoryRefresh(event.directoryPath);
    });

    return dispose;
  }, [scheduleDirectoryRefresh, resolvedWorkspaceId]);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = explorerSidebarWidth;
    document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      setExplorerSidebarWidth(Math.max(180, Math.min(500, startWidth + delta)), resolvedWorkspaceId ?? undefined);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // This handler is passed to FileTree as the onContextMenu prop.
  // TreeNode wraps it (already called preventDefault/stopPropagation) and
  // passes (e, entry) so we can capture the entry in this closure.
  const handleTreeContextMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>, entry: FileExplorerEntry) => {
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const startCreating = useCallback((parentPath: string, type: 'file' | 'directory') => {
    setCreating({ parentPath, type });
  }, []);

  const cancelCreating = useCallback(() => {
    setCreating(null);
  }, []);

  const startRenaming = useCallback((path: string, originalName: string) => {
    setRenaming({ path, originalName });
  }, []);

  const cancelRenaming = useCallback(() => {
    setRenaming(null);
  }, []);

  const commitCreating = useCallback(async (name: string) => {
    const c = creating;
    if (!c) return;

    const targetPath = joinPaths(c.parentPath, name);

    const result = await window.electronAPI.fileCreate({
      workspacePath: normalizedWorkspacePath,
      targetPath,
      type: c.type,
    });

    if (!result.success) {
      console.error('Failed to create entry:', result.error);
      setCreating(null);
      return;
    }

    setCreating(null);
    void loadDirectory(c.parentPath);
  }, [creating, normalizedWorkspacePath, loadDirectory]);

  const actionDeps = useMemo<ExplorerActionDeps>(() => ({
    resolvedWorkspaceId,
    normalizedWorkspacePath,
    explorerEntriesByPath,
    explorerExpandedPaths,
    setExplorerSelectedPath,
    setExplorerDirectoryEntries,
    setExplorerExpandedPaths,
    clearExplorerDirectoryState,
    toggleExplorerPath,
    loadDirectory,
  }), [
    resolvedWorkspaceId,
    normalizedWorkspacePath,
    explorerEntriesByPath,
    explorerExpandedPaths,
    setExplorerSelectedPath,
    setExplorerDirectoryEntries,
    setExplorerExpandedPaths,
    clearExplorerDirectoryState,
    toggleExplorerPath,
    loadDirectory,
  ]);

  const commitRenaming = useCallback(async (newName: string) => {
    const r = renaming;
    if (!r) return;

    const state = useWorkspaceStore.getState();
    const liveWorkspace = resolvedWorkspaceId ? state.getWorkspaceById(resolvedWorkspaceId) : null;

    await executeRename(
      r.path,
      newName,
      liveWorkspace?.editorTabs ?? [],
      normalizedWorkspacePath,
      actionDeps,
      state.renameEditorTabPath,
      () => {
        const latest = resolvedWorkspaceId
          ? useWorkspaceStore.getState().getWorkspaceById(resolvedWorkspaceId)
          : null;
        return {
          explorerEntriesByPath: latest?.explorerEntriesByPath ?? {},
          explorerExpandedPaths: latest?.explorerExpandedPaths ?? [],
          explorerSelectedPath: latest?.explorerSelectedPath ?? null,
        };
      },
    );

    setRenaming(null);
  }, [renaming, normalizedWorkspacePath, resolvedWorkspaceId, actionDeps]);

  const handleContextAction = useCallback(async (action: ContextAction, entry: FileExplorerEntry) => {
    closeContextMenu();

    const state = useWorkspaceStore.getState();
    await dispatchContextAction(action, entry, actionDeps, {
      openFileInEditor: state.openFileInEditor,
      addTerminal: state.addTerminal,
      setRenaming,
      setDeleteTarget,
      getWorkspacePath: (id: string) => state.getWorkspaceById(id)?.workspacePath,
    });
  }, [closeContextMenu, actionDeps, setRenaming, setDeleteTarget]);

  const performDelete = useCallback(async () => {
    const entry = deleteTarget;
    if (!entry) return;

    setDeleteTarget(null);

    const state = useWorkspaceStore.getState();
    const liveWorkspace = resolvedWorkspaceId ? state.getWorkspaceById(resolvedWorkspaceId) : null;

    await executeDelete(
      entry,
      liveWorkspace?.editorTabs ?? [],
      normalizedWorkspacePath,
      state.closeEditorTab,
      actionDeps,
      () => {
        const latest = resolvedWorkspaceId
          ? useWorkspaceStore.getState().getWorkspaceById(resolvedWorkspaceId)
          : null;
        return {
          explorerEntriesByPath: latest?.explorerEntriesByPath ?? {},
          explorerExpandedPaths: latest?.explorerExpandedPaths ?? [],
          explorerSelectedPath: latest?.explorerSelectedPath ?? null,
        };
      },
    );
  }, [deleteTarget, normalizedWorkspacePath, resolvedWorkspaceId, actionDeps]);

  if (!explorerVisible || !normalizedWorkspacePath) {
    return null;
  }

  return (
    <aside className="file-explorer" style={{ width: explorerSidebarWidth }}>
      <div className="file-explorer-header" {...dragHandleProps}>
        <div className="file-explorer-drag-handle" aria-hidden="true" title="Drag to move pane" />
        <span className="file-explorer-title">Explorer</span>
        <div className="file-explorer-actions">
          <button
            type="button"
            className="file-explorer-action"
            onClick={handleRefresh}
            title="Refresh"
          >
            <RefreshCw size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="file-explorer-action"
            onClick={() => startCreating(
              resolveCreateParentPath(normalizedWorkspacePath, explorerSelectedPath, explorerExpandedPaths, explorerEntriesByPath),
              'file'
            )}
            title="New File"
          >
            <FilePlus size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="file-explorer-action"
            onClick={() => startCreating(
              resolveCreateParentPath(normalizedWorkspacePath, explorerSelectedPath, explorerExpandedPaths, explorerEntriesByPath),
              'directory'
            )}
            title="New Folder"
          >
            <FolderPlus size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            className={`file-explorer-action ${showHiddenFiles ? 'active' : ''}`}
            onClick={() => setShowHiddenFiles(!showHiddenFiles, resolvedWorkspaceId ?? undefined)}
            title={showHiddenFiles ? 'Hide dotfiles' : 'Show dotfiles'}
          >
            {showHiddenFiles ? <Eye size={14} strokeWidth={2} /> : <EyeOff size={14} strokeWidth={2} />}
          </button>
          <button
            type="button"
            className="file-explorer-close"
            onClick={() => setExplorerVisible(false, resolvedWorkspaceId ?? undefined)}
            title="Close Explorer"
          >
            <PanelLeftClose size={16} strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className="file-explorer-content">
        <FileTree
          workspaceId={resolvedWorkspaceId ?? undefined}
          rootPath={normalizedWorkspacePath}
          workspacePath={normalizedWorkspacePath}
          rootError={explorerErrorsByPath[normalizedWorkspacePath]}
          onLoadDirectory={loadDirectory}
          gitChanges={gitChanges}
          onContextMenu={handleTreeContextMenu}
          creating={creating}
          renaming={renaming}
          onStartCreating={startCreating}
          onStartRenaming={startRenaming}
          onCancelCreating={cancelCreating}
          onCancelRenaming={cancelRenaming}
          onCommitCreating={commitCreating}
          onCommitRenaming={commitRenaming}
        />
      </div>
      <div className="explorer-resize-handle" onMouseDown={handleResizeStart} />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          entry={contextMenu.entry}
          onAction={(action) => handleContextAction(action, contextMenu.entry)}
          onClose={closeContextMenu}
        />
      )}

      <ConfirmCloseDialog
        isOpen={deleteTarget !== null}
        title={deleteTarget?.isDirectory ? 'Delete Folder' : 'Delete File'}
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        options={[{ label: 'Delete', variant: 'danger', action: performDelete }]}
        onCancel={() => setDeleteTarget(null)}
      />
    </aside>
  );
}
