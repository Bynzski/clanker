import { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, FilePlus, FolderPlus, PanelLeftClose, RefreshCw } from 'lucide-react';
import type React from 'react';
import type { FileListDirectoryResult } from '../../../shared/types/fileExplorer';
import type { FileExplorerEntry } from '../../../shared/types/fileExplorer';
import { dirnamePath, isAbsolutePath, joinPaths, relativePath } from '../../lib/pathUtils';
import { useWorkspaceStore } from '../../store/workspaceStore';
import FileTree from './FileTree';
import ContextMenu, { type ContextAction } from './ContextMenu';
import ConfirmCloseDialog from '../ConfirmCloseDialog';
import './FileExplorer.css';

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

export default function FileExplorer() {
  const {
    activeWorkspaceId,
    workspacePath,
    gitChanges,
    explorerVisible,
    explorerSidebarWidth,
    explorerEntriesByPath,
    explorerLoadingPaths,
    explorerErrorsByPath,
    explorerExpandedPaths,
    showHiddenFiles,
    explorerSelectedPath,
    setExplorerSelectedPath,
    toggleExplorerPath,
    setExplorerVisible,
    setShowHiddenFiles,
    setExplorerSidebarWidth,
    setExplorerDirectoryEntries,
    setExplorerDirectoryLoading,
    setExplorerDirectoryError,
  } = useWorkspaceStore();

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileExplorerEntry } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileExplorerEntry | null>(null);
  const [creating, setCreating] = useState<{ parentPath: string; type: 'file' | 'directory' } | null>(null);
  const [renaming, setRenaming] = useState<{ path: string; originalName: string } | null>(null);

  const loadDirectory = useCallback(async (directoryPath: string): Promise<FileListDirectoryResult> => {
    const requestWorkspaceId = activeWorkspaceId;
    if (!workspacePath || !requestWorkspaceId) {
      return {
        success: false,
        entries: [],
        errorCode: 'invalid-path',
        error: 'Workspace path is unavailable',
      };
    }

    setExplorerDirectoryLoading(directoryPath, true);
    setExplorerDirectoryError(directoryPath, null);

    try {
      const result = await window.electronAPI.fileListDirectory({
        workspacePath,
        directoryPath,
      });

      if (useWorkspaceStore.getState().activeWorkspaceId !== requestWorkspaceId) {
        return result;
      }

      if (result.success) {
        setExplorerDirectoryEntries(directoryPath, result.entries);
        setExplorerDirectoryError(directoryPath, null);
      } else {
        setExplorerDirectoryEntries(directoryPath, []);
        setExplorerDirectoryError(directoryPath, result.error ?? 'Unable to load directory');
      }

      return result;
    } catch (error) {
      const errorMessage = getDirectoryLoadErrorMessage(error);
      console.error('Failed to load directory', {
        workspacePath,
        directoryPath,
        error,
      });

      if (useWorkspaceStore.getState().activeWorkspaceId === requestWorkspaceId) {
        setExplorerDirectoryEntries(directoryPath, []);
        setExplorerDirectoryError(directoryPath, errorMessage);
      }

      return {
        success: false,
        entries: [],
        errorCode: 'unknown',
        error: errorMessage,
      };
    } finally {
      if (useWorkspaceStore.getState().activeWorkspaceId === requestWorkspaceId) {
        setExplorerDirectoryLoading(directoryPath, false);
      }
    }
  }, [activeWorkspaceId, setExplorerDirectoryEntries, setExplorerDirectoryError, setExplorerDirectoryLoading, workspacePath]);

  const handleRefresh = useCallback(() => {
    const pathsToReload = [workspacePath, ...explorerExpandedPaths];
    pathsToReload.forEach((dirPath) => {
      void loadDirectory(dirPath);
    });
  }, [workspacePath, explorerExpandedPaths, loadDirectory]);

  useEffect(() => {
    if (!explorerVisible || !workspacePath) {
      return;
    }

    const hasRootEntries = Object.prototype.hasOwnProperty.call(explorerEntriesByPath, workspacePath);
    const isRootLoading = explorerLoadingPaths.includes(workspacePath);
    if (!hasRootEntries && !isRootLoading) {
      void loadDirectory(workspacePath);
    }
  }, [explorerEntriesByPath, explorerLoadingPaths, explorerVisible, loadDirectory, workspacePath]);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = explorerSidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      setExplorerSidebarWidth(Math.max(180, Math.min(500, startWidth + delta)));
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
      workspacePath,
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
  }, [creating, workspacePath, loadDirectory]);

  const commitRenaming = useCallback(async (newName: string) => {
    const r = renaming;
    if (!r) return;

    const parentDir = dirnamePath(r.path);
    const newPath = joinPaths(parentDir, newName);

    const result = await window.electronAPI.fileRename({
      workspacePath,
      oldPath: r.path,
      newPath,
    });

    if (!result.success) {
      console.error('Failed to rename entry:', result.error);
      setRenaming(null);
      return;
    }

    // Update any open editor tabs that reference this file
    const { editorTabs, renameEditorTabPath } = useWorkspaceStore.getState();
    for (const tab of editorTabs) {
      if (tab.filePath === r.path) {
        renameEditorTabPath(r.path, newPath);
        break;
      }
    }

    const { explorerEntriesByPath: currentEntries } = useWorkspaceStore.getState();
    const parentEntries = currentEntries[parentDir] ?? [];
    const updatedParentEntries = parentEntries.map((entry) =>
      entry.path === r.path ? { ...entry, name: newName, path: newPath } : entry
    );
    setExplorerDirectoryEntries(parentDir, updatedParentEntries);

    if (useWorkspaceStore.getState().explorerSelectedPath === r.path) {
      setExplorerSelectedPath(newPath);
    }

    if (r.path !== newPath) {
      const descendantPaths = Object.keys(currentEntries).filter(
        (cachedPath) => cachedPath !== r.path && isPathWithinBase(r.path, cachedPath)
      );
      for (const descendantPath of descendantPaths) {
        setExplorerDirectoryEntries(descendantPath, []);
      }
    }

    setRenaming(null);
    // Refresh the parent directory
    void loadDirectory(parentDir);
  }, [renaming, workspacePath, loadDirectory, setExplorerDirectoryEntries, setExplorerSelectedPath]);

  const handleContextAction = useCallback(async (action: ContextAction, entry: FileExplorerEntry) => {
    closeContextMenu();

    switch (action) {
      case 'open-editor': {
        if (!entry.isDirectory) {
          const { openFileInEditor } = useWorkspaceStore.getState();
          void openFileInEditor(entry.path);
        } else {
          setExplorerSelectedPath(entry.path);
          const hasChildren = Object.prototype.hasOwnProperty.call(explorerEntriesByPath, entry.path);
          if (!explorerExpandedPaths.includes(entry.path) && !hasChildren) {
            void loadDirectory(entry.path).then((result) => {
              if (result.success) {
                toggleExplorerPath(entry.path);
              }
            });
          } else if (!explorerExpandedPaths.includes(entry.path)) {
            toggleExplorerPath(entry.path);
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
        const { workspacePath: root } = useWorkspaceStore.getState();
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
  }, [closeContextMenu, explorerEntriesByPath, explorerExpandedPaths, loadDirectory, setExplorerSelectedPath, toggleExplorerPath]);

  const performDelete = useCallback(async () => {
    const entry = deleteTarget;
    if (!entry) return;

    setDeleteTarget(null);

    const result = await window.electronAPI.fileDelete({
      workspacePath,
      targetPath: entry.path,
    });

    if (!result.success) {
      console.error('Failed to delete entry:', result.error);
      return;
    }

    // Close any open editor tabs for the deleted file or files inside the deleted directory
    const { editorTabs, closeEditorTab } = useWorkspaceStore.getState();
    const tabsToClose = editorTabs.filter((tab) =>
      tab.filePath === entry.path || isPathWithinBase(entry.path, tab.filePath)
    );
    for (const tab of tabsToClose) {
      closeEditorTab(tab.id);
    }

    const { explorerEntriesByPath: currentEntries } = useWorkspaceStore.getState();
    const parentDir = dirnamePath(entry.path);
    const parentEntries = currentEntries[parentDir] ?? [];
    const updatedParentEntries = parentEntries.filter((child) => child.path !== entry.path);
    setExplorerDirectoryEntries(parentDir, updatedParentEntries);

    const selectedPath = useWorkspaceStore.getState().explorerSelectedPath;
    if (selectedPath && (selectedPath === entry.path || isPathWithinBase(entry.path, selectedPath))) {
      setExplorerSelectedPath(null);
    }

    if (entry.isDirectory) {
      const childPaths = Object.keys(currentEntries).filter(
        (cachedPath) => cachedPath !== entry.path && isPathWithinBase(entry.path, cachedPath)
      );
      for (const childPath of childPaths) {
        setExplorerDirectoryEntries(childPath, []);
      }
    }

    // Refresh the parent directory to reflect the deletion
    void loadDirectory(parentDir);
  }, [deleteTarget, workspacePath, loadDirectory, setExplorerDirectoryEntries, setExplorerSelectedPath]);

  if (!explorerVisible || !workspacePath) {
    return null;
  }

  return (
    <aside className="file-explorer" style={{ width: explorerSidebarWidth }}>
      <div className="file-explorer-header">
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
              resolveCreateParentPath(workspacePath, explorerSelectedPath, explorerExpandedPaths, explorerEntriesByPath),
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
              resolveCreateParentPath(workspacePath, explorerSelectedPath, explorerExpandedPaths, explorerEntriesByPath),
              'directory'
            )}
            title="New Folder"
          >
            <FolderPlus size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            className={`file-explorer-action ${showHiddenFiles ? 'active' : ''}`}
            onClick={() => setShowHiddenFiles(!showHiddenFiles)}
            title={showHiddenFiles ? 'Hide dotfiles' : 'Show dotfiles'}
          >
            {showHiddenFiles ? <Eye size={14} strokeWidth={2} /> : <EyeOff size={14} strokeWidth={2} />}
          </button>
          <button
            type="button"
            className="file-explorer-close"
            onClick={() => setExplorerVisible(false)}
            title="Close Explorer"
          >
            <PanelLeftClose size={16} strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className="file-explorer-content">
        <FileTree
          rootPath={workspacePath}
          workspacePath={workspacePath}
          rootError={explorerErrorsByPath[workspacePath]}
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
