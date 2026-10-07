import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChevronDown, ChevronUp, Eye, EyeOff, FilePlus, FolderPlus, PanelLeftClose, RefreshCw, Search, X } from 'lucide-react';
import type React from 'react';
import type { FileListDirectoryResult } from '../../../shared/types/fileExplorer';
import type { FileExplorerEntry } from '../../../shared/types/fileExplorer';
import { dirnamePath, joinPaths, normalizePath } from '../../lib/pathUtils';
import { pathKey } from '../../../shared/pathKey';
import { focusedFileCheckout, pathInFileCheckout } from '../../lib/fileCheckout';
import { requestCheckoutReconciliation } from '../../lib/checkoutReconciliation';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useScopedWorkspaceSelector } from '../WorkspaceScope';
import FileTree from './FileTree';
import { useExplorerFilter } from './explorerFilterStore';
import ContextMenu, { type ContextAction } from './ContextMenu';
import ConfirmCloseDialog from '../ConfirmCloseDialog';
import {
  type ExplorerActionDeps,
  dispatchContextAction,
  executeDelete,
  executeRename,
} from './explorerActionHandlers';
import './FileExplorer.css';
import '../EdgeResizeHandle.css';

const EXPLORER_TREE_REFRESH_DEBOUNCE_MS = 100;
const EMPTY_ENTRIES: Record<string, FileExplorerEntry[] | undefined> = {};
const EMPTY_PATHS: string[] = [];
const EMPTY_ERRORS: Record<string, string | null | undefined> = {};

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

interface FileExplorerProps {
  workspaceId?: string;
  /**
   * `dock` (default): standalone resizable sidebar owned by a workspace surface.
   * `section`: FILES section embedded in the workspace sidebar shell, which owns
   * sizing and resizing; `explorerVisible` expands/collapses it.
   */
  variant?: 'dock' | 'section';
}

export default function FileExplorer({ workspaceId, variant = 'dock' }: FileExplorerProps) {
  const isSection = variant === 'section';
  const workspace = useScopedWorkspaceSelector((current) => current && ({
    id: current.id,
    ...focusedFileCheckout(current),
    environmentId: current.environmentId,
    gitChanges: current.gitChanges,
    explorerVisible: current.explorerVisible,
    explorerSidebarWidth: current.explorerSidebarWidth,
    explorerEntriesByPath: current.explorerEntriesByPath,
    explorerLoadingPaths: current.explorerLoadingPaths,
    explorerErrorsByPath: current.explorerErrorsByPath,
    explorerExpandedPaths: current.explorerExpandedPaths,
    showHiddenFiles: current.showHiddenFiles,
    explorerSelectedPath: current.explorerSelectedPath,
  }), workspaceId);
  const {
    setExplorerSelectedPath,
    toggleExplorerPath,
    setExplorerVisible,
    setExplorerSidebarWidth,
    setShowHiddenFiles,
    setExplorerDirectoryEntries,
    setExplorerDirectoryLoading,
    setExplorerDirectoryError,
    setExplorerExpandedPaths,
    clearExplorerDirectoryState,
    pushBrowserOverlay,
    popBrowserOverlay,
  } = useWorkspaceStore(useShallow((state) => ({
    setExplorerSelectedPath: state.setExplorerSelectedPath,
    toggleExplorerPath: state.toggleExplorerPath,
    setExplorerVisible: state.setExplorerVisible,
    setExplorerSidebarWidth: state.setExplorerSidebarWidth,
    setShowHiddenFiles: state.setShowHiddenFiles,
    setExplorerDirectoryEntries: state.setExplorerDirectoryEntries,
    setExplorerDirectoryLoading: state.setExplorerDirectoryLoading,
    setExplorerDirectoryError: state.setExplorerDirectoryError,
    setExplorerExpandedPaths: state.setExplorerExpandedPaths,
    clearExplorerDirectoryState: state.clearExplorerDirectoryState,
    pushBrowserOverlay: state.pushBrowserOverlay,
    popBrowserOverlay: state.popBrowserOverlay,
  })));
  const resolvedWorkspaceId = workspace?.id ?? null;
  const workspacePath = workspace?.workspacePath ?? '';
  const checkoutContextId = workspace?.checkoutContextId;
  const gitChanges = checkoutContextId ? [] : workspace?.gitChanges ?? [];
  const isRemote = workspace?.environmentId != null && workspace.environmentId !== 'local';
  const explorerVisible = workspace?.explorerVisible ?? false;
  const explorerSidebarWidth = workspace?.explorerSidebarWidth ?? 280;
  const explorerEntriesByPath = workspace?.explorerEntriesByPath ?? EMPTY_ENTRIES;
  const explorerLoadingPaths = workspace?.explorerLoadingPaths ?? EMPTY_PATHS;
  const explorerErrorsByPath = workspace?.explorerErrorsByPath ?? EMPTY_ERRORS;
  const explorerExpandedPaths = useMemo(() => (workspace?.explorerExpandedPaths ?? EMPTY_PATHS).filter((entry) => pathInFileCheckout(workspacePath, entry)), [workspace?.explorerExpandedPaths, workspacePath]);
  const showHiddenFiles = workspace?.showHiddenFiles ?? true;
  const explorerSelectedPath = workspace?.explorerSelectedPath && pathInFileCheckout(workspacePath, workspace.explorerSelectedPath) ? workspace.explorerSelectedPath : null;

  const normalizedWorkspacePath = workspacePath ? normalizePath(workspacePath) : workspacePath;
  const rootIdentity = `${checkoutContextId ?? ''}:${normalizedWorkspacePath}`;

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileExplorerEntry } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileExplorerEntry | null>(null);
  const [creating, setCreating] = useState<{ parentPath: string; type: 'file' | 'directory' } | null>(null);
  const [renaming, setRenaming] = useState<{ path: string; originalName: string } | null>(null);
  const [filterQuery, setFilterQuery] = useExplorerFilter(resolvedWorkspaceId, isSection);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const explorerTreeRefreshTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const previousExplorerVisibleRef = useRef(explorerVisible);
  const previousRootRef = useRef(rootIdentity);

  useEffect(() => {
    setContextMenu(null);
    setDeleteTarget(null);
    setCreating(null);
    setRenaming(null);
  }, [normalizedWorkspacePath, checkoutContextId]);

  const handleResizeStart = (event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = explorerSidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (moveEvent: MouseEvent) => {
      setExplorerSidebarWidth(Math.max(180, Math.min(500, startWidth + moveEvent.clientX - startX)), resolvedWorkspaceId ?? undefined);
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
        workspaceId: requestWorkspaceId,
        ...(checkoutContextId ? { checkoutContextId } : {}),
        directoryPath: normalizedDirectoryPath,
      });

      const liveWorkspace = useWorkspaceStore.getState().getWorkspaceById(requestWorkspaceId);
      if (liveWorkspace == null || normalizePath(focusedFileCheckout(liveWorkspace).workspacePath) !== normalizedWorkspacePath
        || focusedFileCheckout(liveWorkspace).checkoutContextId !== checkoutContextId) {
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
        if (checkoutContextId) void requestCheckoutReconciliation(requestWorkspaceId);
      }

      return result;
    } catch (error) {
      const errorMessage = getDirectoryLoadErrorMessage(error);
      console.error('Failed to load directory', {
        workspacePath: normalizedWorkspacePath,
        directoryPath: normalizedDirectoryPath,
        error,
      });

      const liveWorkspace = useWorkspaceStore.getState().getWorkspaceById(requestWorkspaceId);
      if (liveWorkspace && normalizePath(focusedFileCheckout(liveWorkspace).workspacePath) === normalizedWorkspacePath
        && focusedFileCheckout(liveWorkspace).checkoutContextId === checkoutContextId) {
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
    checkoutContextId,
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

  useEffect(() => {
    if (previousRootRef.current === rootIdentity) return;
    previousRootRef.current = rootIdentity;
    if (explorerVisible) handleRefresh();
  }, [rootIdentity, explorerVisible, handleRefresh]);

  // Keep the immediate SSH focus refresh alongside bounded background polling;
  // never route remote paths into local chokidar.
  useEffect(() => {
    if (!isRemote || !explorerVisible || !resolvedWorkspaceId) return;
    const onFocus = () => {
      const state = useWorkspaceStore.getState();
      if (state.activeWorkspaceId !== resolvedWorkspaceId) return;
      handleRefresh();
      const current = state.getWorkspaceById(resolvedWorkspaceId);
      current?.editorTabs.filter((tab) => !tab.isDirty).forEach((tab) => {
        void state.reloadEditorTab(tab.id, resolvedWorkspaceId, { onlyIfClean: true });
      });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [isRemote, explorerVisible, resolvedWorkspaceId, handleRefresh]);

  const scheduleDirectoryRefresh = useCallback(function scheduleDirectoryRefreshImpl(directoryPath: string) {
    if (!normalizedWorkspacePath) {
      return;
    }

    const normalizedDirectoryPath = normalizePath(directoryPath);
    if (!pathInFileCheckout(normalizedWorkspacePath, normalizedDirectoryPath)) return;
    const currentState = useWorkspaceStore.getState();
    const currentWorkspace = resolvedWorkspaceId ? currentState.getWorkspaceById(resolvedWorkspaceId) : null;
    if (!currentWorkspace?.explorerVisible) {
      return;
    }

    const currentWorkspacePath = normalizePath(focusedFileCheckout(currentWorkspace).workspacePath);
    const isRootDirectory = currentWorkspacePath === normalizedDirectoryPath;
    const isExpandedDirectory = currentWorkspace.explorerExpandedPaths.includes(normalizedDirectoryPath);
    const hasCachedEntries = Object.prototype.hasOwnProperty.call(
      currentWorkspace.explorerEntriesByPath,
      normalizedDirectoryPath
    );

    if (!isRootDirectory && !isExpandedDirectory && !hasCachedEntries) {
      return;
    }

    const refreshKey = isRemote ? normalizedDirectoryPath : pathKey(normalizedDirectoryPath);
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

      const latestWorkspacePath = normalizePath(focusedFileCheckout(latestWorkspace).workspacePath);
      if (latestWorkspacePath !== normalizedWorkspacePath) return;
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
  }, [resolvedWorkspaceId, loadDirectory, normalizedWorkspacePath, isRemote]);

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

      if (checkoutContextId && pathInFileCheckout(event.directoryPath, normalizedWorkspacePath) && !pathInFileCheckout(normalizedWorkspacePath, event.directoryPath)) {
        void requestCheckoutReconciliation(resolvedWorkspaceId!);
        return;
      }
      scheduleDirectoryRefresh(event.directoryPath);
    });

    return dispose;
  }, [scheduleDirectoryRefresh, resolvedWorkspaceId, checkoutContextId, normalizedWorkspacePath]);

  useEffect(() => {
    if (typeof window.electronAPI.onRemoteFilesChanged !== 'function') return;
    return window.electronAPI.onRemoteFilesChanged((event) => {
      const state = useWorkspaceStore.getState();
      if (event.workspaceId !== resolvedWorkspaceId || state.activeWorkspaceId !== resolvedWorkspaceId) return;
      event.directoryPaths.forEach(scheduleDirectoryRefresh);
      const liveWorkspace = state.getWorkspaceById(event.workspaceId);
      for (const directoryPath of event.unchangedDirectoryPaths ?? []) {
        if (liveWorkspace?.explorerErrorsByPath[directoryPath]) scheduleDirectoryRefresh(directoryPath);
      }
    });
  }, [resolvedWorkspaceId, scheduleDirectoryRefresh]);

  // This handler is passed to FileTree as the onContextMenu prop.
  // TreeNode wraps it (already called preventDefault/stopPropagation) and
  // passes (e, entry) so we can capture the entry in this closure.
  const handleTreeContextMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>, entry: FileExplorerEntry) => {
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const focusFilterInput = useCallback(() => {
    filterInputRef.current?.focus();
    filterInputRef.current?.select();
  }, []);

  const handleFilterKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (filterQuery.length > 0) {
        setFilterQuery('');
      } else {
        filterInputRef.current?.blur();
      }
    }
  }, [filterQuery, setFilterQuery]);

  const startCreating = useCallback((parentPath: string, type: 'file' | 'directory') => {
    // If the parent is a loaded-but-collapsed subdirectory, expand it so the
    // inline create input has a place to render. Root and already-expanded dirs
    // need no toggle.
    if (
      parentPath !== normalizedWorkspacePath &&
      Object.prototype.hasOwnProperty.call(explorerEntriesByPath, parentPath) &&
      !explorerExpandedPaths.includes(parentPath)
    ) {
      toggleExplorerPath(parentPath, resolvedWorkspaceId ?? undefined);
    }
    setCreating({ parentPath, type });
  }, [normalizedWorkspacePath, explorerEntriesByPath, explorerExpandedPaths, toggleExplorerPath, resolvedWorkspaceId]);

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
      workspaceId: resolvedWorkspaceId ?? undefined,
      ...(checkoutContextId ? { checkoutContextId } : {}),
      targetPath,
      type: c.type,
    });

    if (!result.success) {
      const message = result.error ?? 'Failed to create entry';
      console.error('Failed to create entry:', message);
      window.alert(message);
      setCreating(null);
      return;
    }

    setCreating(null);
    void loadDirectory(c.parentPath);
  }, [creating, normalizedWorkspacePath, resolvedWorkspaceId, checkoutContextId, loadDirectory]);

  const actionDeps = useMemo<ExplorerActionDeps>(() => ({
    resolvedWorkspaceId,
    environmentId: workspace?.environmentId ?? 'local',
    normalizedWorkspacePath,
    checkoutContextId,
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
    workspace?.environmentId,
    checkoutContextId,
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

  if (!normalizedWorkspacePath) {
    return null;
  }

  if (isSection && !explorerVisible) {
    return (
      <section className="file-explorer file-explorer-section collapsed" aria-label="Files">
        <Button
          type="button"
          className="file-explorer-section-toggle"
          aria-expanded={false}
          onClick={() => setExplorerVisible(true, resolvedWorkspaceId ?? undefined)}
          aria-label="Expand Files"
          title="Expand Files"
        >
          <ChevronUp size={12} strokeWidth={2} aria-hidden="true" />
          <span>Files</span>
        </Button>
      </section>
    );
  }

  if (!explorerVisible) {
    return null;
  }

  const Root = isSection ? 'section' : 'aside';

  return (
    <Root
      className={`file-explorer${isSection ? ' file-explorer-section' : ''}`}
      style={isSection ? undefined : { width: explorerSidebarWidth }}
      aria-label={isSection ? 'Files' : undefined}
    >
      <div className="file-explorer-header">
        {isSection ? (
          <button
            type="button"
            className="file-explorer-title file-explorer-section-title"
            aria-expanded={true}
            aria-label="Collapse Files"
            title="Collapse Files"
            onClick={() => setExplorerVisible(false, resolvedWorkspaceId ?? undefined)}
          >
            <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
            <span>Files</span>
          </button>
        ) : (
          <span className="file-explorer-title">Explorer</span>
        )}
        <div className="file-explorer-actions">
          <IconButton size="xs" variant="ghost" aria-label="Refresh"
            type="button"
            className="file-explorer-action"
            onClick={handleRefresh}
            title="Refresh"
          >
            <RefreshCw size={14} strokeWidth={2} />
          </IconButton>
          <IconButton size="xs" variant="ghost" aria-label="New File"
            type="button"
            className="file-explorer-action"
            onClick={() => startCreating(
              resolveCreateParentPath(normalizedWorkspacePath, explorerSelectedPath, explorerExpandedPaths, explorerEntriesByPath),
              'file'
            )}
            title="New File"
          >
            <FilePlus size={14} strokeWidth={2} />
          </IconButton>
          <IconButton size="xs" variant="ghost" aria-label="New Folder"
            type="button"
            className="file-explorer-action"
            onClick={() => startCreating(
              resolveCreateParentPath(normalizedWorkspacePath, explorerSelectedPath, explorerExpandedPaths, explorerEntriesByPath),
              'directory'
            )}
            title="New Folder"
          >
            <FolderPlus size={14} strokeWidth={2} />
          </IconButton>
          <IconButton
            size="xs"
            variant="ghost"
            aria-label={showHiddenFiles ? 'Hide dotfiles' : 'Show dotfiles'}
            aria-pressed={showHiddenFiles}
            type="button"
            className={`file-explorer-action ${showHiddenFiles ? 'active' : ''}`}
            onClick={() => setShowHiddenFiles(!showHiddenFiles, resolvedWorkspaceId ?? undefined)}
            title={showHiddenFiles ? 'Hide dotfiles' : 'Show dotfiles'}
          >
            {showHiddenFiles ? <Eye size={14} strokeWidth={2} /> : <EyeOff size={14} strokeWidth={2} />}
          </IconButton>
          {!isSection && (
            <IconButton size="xs" variant="ghost" aria-label="Close Explorer"
              type="button"
              className="file-explorer-close"
              onClick={() => setExplorerVisible(false, resolvedWorkspaceId ?? undefined)}
              title="Close Explorer"
            >
              <PanelLeftClose size={14} strokeWidth={2} />
            </IconButton>
          )}
        </div>
      </div>
      {workspace?.checkoutLabel && <div className="file-explorer-checkout" title={normalizedWorkspacePath}>Checkout: {workspace.checkoutLabel}</div>}
      <div className="file-explorer-filter">
        <Search size={12} strokeWidth={2} className="file-explorer-filter-icon" aria-hidden="true" />
        <Input
          ref={filterInputRef}
          type="text"
          className="file-explorer-filter-input"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          onKeyDown={handleFilterKeyDown}
          placeholder="Filter files (press / to focus)"
          aria-label="Filter files"
        />
        {filterQuery.length > 0 ? (
          <IconButton variant="ghost"
            type="button"
            className="file-explorer-filter-clear"
            onClick={() => setFilterQuery('')}
            title="Clear filter"
            aria-label="Clear filter"
          >
            <X size={12} strokeWidth={2} />
          </IconButton>
        ) : null}
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
          filterQuery={filterQuery}
          onFocusFilter={focusFilterInput}
        />
      </div>
      {!isSection && <div className="edge-resize-handle explorer-resize-handle" onMouseDown={handleResizeStart} />}
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
    </Root>
  );
}
