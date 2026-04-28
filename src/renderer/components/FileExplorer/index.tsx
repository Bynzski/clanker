import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDragHandle } from '../DynamicPaneLayout';
import { Eye, EyeOff, FilePlus, FolderPlus, PanelLeftClose, RefreshCw } from 'lucide-react';
import type React from 'react';
import type { FileListDirectoryResult } from '../../../shared/types/fileExplorer';
import type { FileExplorerEntry } from '../../../shared/types/fileExplorer';
import { dirnamePath, isAbsolutePath, joinPaths, relativePath, normalizePath } from '../../lib/pathUtils';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useScopedWorkspace } from '../WorkspaceScope';
import FileTree from './FileTree';
import ContextMenu, { type ContextAction } from './ContextMenu';
import ConfirmCloseDialog from '../ConfirmCloseDialog';
import './FileExplorer.css';

const EXPLORER_TREE_REFRESH_DEBOUNCE_MS = 100;

function getDirectoryLoadErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return 'Unable to load directory';
}

function isPathWithinBase(basePath: string, candidatePath: string): boolean {
  const nextRelativePath = relativePath(basePath, candidatePath);
  return nextRelativePath !== '' && nextRelativePath !== candidatePath && !nextRelativePath.startsWith('..');
}

function filterPathsOutsideBase(basePath: string, paths: string[]): string[] {
  return paths.filter((path) => path !== basePath && !isPathWithinBase(basePath, path));
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

    const existingTimer = explorerTreeRefreshTimersRef.current.get(normalizedDirectoryPath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      explorerTreeRefreshTimersRef.current.delete(normalizedDirectoryPath);

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

    explorerTreeRefreshTimersRef.current.set(normalizedDirectoryPath, timer);
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

  const commitRenaming = useCallback(async (newName: string) => {
    const r = renaming;
    if (!r) return;

    const parentDir = dirnamePath(r.path);
    const newPath = joinPaths(parentDir, newName);

    const result = await window.electronAPI.fileRename({
      workspacePath: normalizedWorkspacePath,
      oldPath: r.path,
      newPath,
    });

    if (!result.success) {
      console.error('Failed to rename entry:', result.error);
      setRenaming(null);
      return;
    }

    // Update any open editor tabs that reference this file
    const state = useWorkspaceStore.getState();
    const liveWorkspace = resolvedWorkspaceId ? state.getWorkspaceById(resolvedWorkspaceId) : null;
    const editorTabs = liveWorkspace?.editorTabs ?? [];
    const { renameEditorTabPath } = state;
    for (const tab of editorTabs) {
      if (tab.filePath === r.path) {
        renameEditorTabPath(r.path, newPath, resolvedWorkspaceId ?? undefined);
        break;
      }
    }

    const latestWorkspace = resolvedWorkspaceId ? useWorkspaceStore.getState().getWorkspaceById(resolvedWorkspaceId) : null;
    const currentEntries = latestWorkspace?.explorerEntriesByPath ?? {};
    const currentExpandedPaths = latestWorkspace?.explorerExpandedPaths ?? [];
    const selectedPath = latestWorkspace?.explorerSelectedPath ?? null;
    const parentEntries = currentEntries[parentDir] ?? [];
    const updatedParentEntries = parentEntries.map((entry) =>
      entry.path === r.path ? { ...entry, name: newName, path: newPath } : entry
    );
    setExplorerDirectoryEntries(parentDir, updatedParentEntries, resolvedWorkspaceId ?? undefined);

    if (selectedPath === r.path) {
      setExplorerSelectedPath(newPath, resolvedWorkspaceId ?? undefined);
    }

    if (r.path !== newPath) {
      const staleDirectoryPaths = Object.keys(currentEntries).filter(
        (cachedPath) => cachedPath === r.path || isPathWithinBase(r.path, cachedPath)
      );
      if (staleDirectoryPaths.length > 0) {
        clearExplorerDirectoryState(staleDirectoryPaths, resolvedWorkspaceId ?? undefined);
      }
    }

    const remainingExpandedPaths = filterPathsOutsideBase(r.path, currentExpandedPaths);
    if (remainingExpandedPaths.length !== currentExpandedPaths.length) {
      setExplorerExpandedPaths(remainingExpandedPaths, resolvedWorkspaceId ?? undefined);
    }

    setRenaming(null);
    void loadDirectory(parentDir);
  }, [
    renaming,
    normalizedWorkspacePath,
    clearExplorerDirectoryState,
    loadDirectory,
    setExplorerDirectoryEntries,
    setExplorerSelectedPath,
    setExplorerExpandedPaths,
    resolvedWorkspaceId,
  ]);

  const handleContextAction = useCallback(async (action: ContextAction, entry: FileExplorerEntry) => {
    closeContextMenu();

    switch (action) {
      case 'open-editor': {
        if (!entry.isDirectory) {
          const { openFileInEditor } = useWorkspaceStore.getState();
          void openFileInEditor(entry.path, resolvedWorkspaceId ?? undefined);
        } else {
          setExplorerSelectedPath(entry.path, resolvedWorkspaceId ?? undefined);
          const hasChildren = Object.prototype.hasOwnProperty.call(explorerEntriesByPath, entry.path);
          if (!explorerExpandedPaths.includes(entry.path) && !hasChildren) {
            void loadDirectory(entry.path).then((result) => {
              if (result.success) {
                toggleExplorerPath(entry.path, resolvedWorkspaceId ?? undefined);
              }
            });
          } else if (!explorerExpandedPaths.includes(entry.path)) {
            toggleExplorerPath(entry.path, resolvedWorkspaceId ?? undefined);
          }
        }
        break;
      }

      case 'open-terminal': {
        const targetDir = entry.isDirectory ? entry.path : dirnamePath(entry.path);
        const { addTerminal, canAddPane } = useWorkspaceStore.getState();
        if (!canAddPane()) {
          console.warn('All panes are locked. Unlock a pane before opening a terminal here.');
          return;
        }

        try {
          const info = await window.electronAPI.spawnTerminal(targetDir);
          addTerminal({
            id: info.id,
            pid: info.pid,
            workingDir: targetDir,
          });
        } catch (error) {
          console.error('Failed to open terminal:', error);
        }
        break;
      }

      case 'copy-path': {
        await window.electronAPI.writeClipboard(entry.path);
        break;
      }

      case 'copy-relative-path': {
        const root = resolvedWorkspaceId
          ? useWorkspaceStore.getState().getWorkspaceById(resolvedWorkspaceId)?.workspacePath ?? normalizedWorkspacePath
          : normalizedWorkspacePath;
        const nextRelativePath = root
          ? (() => {
              const resolved = relativePath(root, entry.path);
              return resolved === '' || (resolved !== entry.path && !resolved.startsWith('..') && !isAbsolutePath(resolved))
                ? resolved
                : entry.path;
            })()
          : entry.path;
        await window.electronAPI.writeClipboard(nextRelativePath);
        break;
      }

      case 'reveal-in-files': {
        await window.electronAPI.revealInFileManager(entry.path);
        break;
      }

      case 'rename': {
        setRenaming({ path: entry.path, originalName: entry.name });
        break;
      }

      case 'delete': {
        setDeleteTarget(entry);
        break;
      }
    }
  }, [closeContextMenu, explorerEntriesByPath, explorerExpandedPaths, loadDirectory, normalizedWorkspacePath, resolvedWorkspaceId, setExplorerSelectedPath, toggleExplorerPath]);

  const performDelete = useCallback(async () => {
    const entry = deleteTarget;
    if (!entry) return;

    setDeleteTarget(null);

    const result = await window.electronAPI.fileDelete({
      workspacePath: normalizedWorkspacePath,
      targetPath: entry.path,
    });

    if (!result.success) {
      console.error('Failed to delete entry:', result.error);
      return;
    }

    // Close any open editor tabs for the deleted file or files inside the deleted directory
    const state = useWorkspaceStore.getState();
    const liveWorkspace = resolvedWorkspaceId ? state.getWorkspaceById(resolvedWorkspaceId) : null;
    const editorTabs = liveWorkspace?.editorTabs ?? [];
    const { closeEditorTab } = state;
    const tabsToClose = editorTabs.filter((tab) =>
      tab.filePath === entry.path || isPathWithinBase(entry.path, tab.filePath)
    );
    for (const tab of tabsToClose) {
      closeEditorTab(tab.id, resolvedWorkspaceId ?? undefined);
    }

    const latestWorkspace = resolvedWorkspaceId ? useWorkspaceStore.getState().getWorkspaceById(resolvedWorkspaceId) : null;
    const currentEntries = latestWorkspace?.explorerEntriesByPath ?? {};
    const currentExpandedPaths = latestWorkspace?.explorerExpandedPaths ?? [];
    const parentDir = dirnamePath(entry.path);
    const parentEntries = currentEntries[parentDir] ?? [];
    const updatedParentEntries = parentEntries.filter((child) => child.path !== entry.path);
    setExplorerDirectoryEntries(parentDir, updatedParentEntries, resolvedWorkspaceId ?? undefined);

    // Clear expanded state for the deleted entry or any children within it
    const remainingExpandedPaths = filterPathsOutsideBase(entry.path, currentExpandedPaths);
    if (remainingExpandedPaths.length !== currentExpandedPaths.length) {
      setExplorerExpandedPaths(remainingExpandedPaths, resolvedWorkspaceId ?? undefined);
    }

    const selectedPath = resolvedWorkspaceId
      ? useWorkspaceStore.getState().getWorkspaceById(resolvedWorkspaceId)?.explorerSelectedPath ?? null
      : null;
    if (selectedPath && (selectedPath === entry.path || isPathWithinBase(entry.path, selectedPath))) {
      setExplorerSelectedPath(null, resolvedWorkspaceId ?? undefined);
    }

    if (entry.isDirectory) {
      const staleDirectoryPaths = Object.keys(currentEntries).filter(
        (cachedPath) => cachedPath === entry.path || isPathWithinBase(entry.path, cachedPath)
      );
      if (staleDirectoryPaths.length > 0) {
        clearExplorerDirectoryState(staleDirectoryPaths, resolvedWorkspaceId ?? undefined);
      }
    }

    void loadDirectory(parentDir);
  }, [
    deleteTarget,
    normalizedWorkspacePath,
    clearExplorerDirectoryState,
    loadDirectory,
    setExplorerDirectoryEntries,
    setExplorerSelectedPath,
    setExplorerExpandedPaths,
    resolvedWorkspaceId,
  ]);

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
