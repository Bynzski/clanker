/**
 * Extracted action handlers for FileExplorer operations.
 *
 * Each handler is a pure async function that receives the dependencies it needs,
 * keeping the component callbacks thin and the logic independently testable.
 */

import type { EditorTab } from '../../store/workspaceTypes';
import type { FileExplorerEntry } from '../../../shared/types/fileExplorer';
import type { FileOperationResult } from '../../../shared/types/fileOperations';
import type { ContextAction } from './ContextMenu';
import { dirnamePath, isAbsolutePath, joinPaths, relativePath } from '../../lib/pathUtils';

// ---------------------------------------------------------------------------
// Shared path utilities (extracted from index.tsx to avoid circular imports)
// ---------------------------------------------------------------------------

function isPathWithinBase(basePath: string, candidatePath: string): boolean {
  const nextRelativePath = relativePath(basePath, candidatePath);
  return nextRelativePath !== '' && nextRelativePath !== candidatePath && !nextRelativePath.startsWith('..');
}

function filterPathsOutsideBase(basePath: string, paths: string[]): string[] {
  return paths.filter((path) => path !== basePath && !isPathWithinBase(basePath, path));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callbacks and state slices the extracted handlers need from the component. */
export interface ExplorerActionDeps {
  resolvedWorkspaceId: string | null;
  normalizedWorkspacePath: string;
  explorerEntriesByPath: Record<string, FileExplorerEntry[] | undefined>;
  explorerExpandedPaths: string[];

  // Store actions
  setExplorerSelectedPath: (path: string | null, workspaceId?: string) => void;
  setExplorerDirectoryEntries: (directoryPath: string, entries: FileExplorerEntry[], workspaceId?: string) => void;
  setExplorerExpandedPaths: (paths: string[], workspaceId?: string) => void;
  clearExplorerDirectoryState: (paths: string[], workspaceId?: string) => void;
  toggleExplorerPath: (path: string, workspaceId?: string) => void;
  loadDirectory: (directoryPath: string) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Find all open editor tabs whose file path is the target itself or a child
 * of the target (when the target is a directory).
 */
function findEditorTabsForPath(
  targetPath: string,
  editorTabs: EditorTab[],
): EditorTab[] {
  return editorTabs.filter(
    (tab) => tab.filePath === targetPath || isPathWithinBase(targetPath, tab.filePath),
  );
}

// ---------------------------------------------------------------------------
// Context action handlers
// ---------------------------------------------------------------------------

async function handleOpenEditor(
  entry: FileExplorerEntry,
  deps: ExplorerActionDeps,
  openFileInEditor: (filePath: string, workspaceId?: string) => Promise<void>,
): Promise<void> {
  if (!entry.isDirectory) {
    void openFileInEditor(entry.path, deps.resolvedWorkspaceId ?? undefined);
    return;
  }

  deps.setExplorerSelectedPath(entry.path, deps.resolvedWorkspaceId ?? undefined);
  const hasChildren = Object.prototype.hasOwnProperty.call(deps.explorerEntriesByPath, entry.path);

  if (!deps.explorerExpandedPaths.includes(entry.path) && !hasChildren) {
    const result = await deps.loadDirectory(entry.path) as { success: boolean };
    if (result.success) {
      deps.toggleExplorerPath(entry.path, deps.resolvedWorkspaceId ?? undefined);
    }
  } else if (!deps.explorerExpandedPaths.includes(entry.path)) {
    deps.toggleExplorerPath(entry.path, deps.resolvedWorkspaceId ?? undefined);
  }
}

async function handleOpenTerminal(
  entry: FileExplorerEntry,
  addTerminal: (terminal: { id: string; pid: number; workingDir: string }) => void,
): Promise<void> {
  const targetDir = entry.isDirectory ? entry.path : dirnamePath(entry.path);

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
}

async function handleCopyPath(entry: FileExplorerEntry): Promise<void> {
  await window.electronAPI.writeClipboard(entry.path);
}

async function handleCopyRelativePath(
  entry: FileExplorerEntry,
  deps: Pick<ExplorerActionDeps, 'resolvedWorkspaceId' | 'normalizedWorkspacePath'>,
  getWorkspacePath: (workspaceId: string) => string | undefined,
): Promise<void> {
  const root = deps.resolvedWorkspaceId
    ? getWorkspacePath(deps.resolvedWorkspaceId) ?? deps.normalizedWorkspacePath
    : deps.normalizedWorkspacePath;

  const resolved = root
    ? (() => {
        const rel = relativePath(root, entry.path);
        return rel === '' || (rel !== entry.path && !rel.startsWith('..') && !isAbsolutePath(rel))
          ? rel
          : entry.path;
      })()
    : entry.path;

  await window.electronAPI.writeClipboard(resolved);
}

async function handleRevealInFiles(entry: FileExplorerEntry): Promise<void> {
  await window.electronAPI.revealInFileManager(entry.path);
}

function handleStartRename(
  entry: FileExplorerEntry,
  setRenaming: (state: { path: string; originalName: string } | null) => void,
): void {
  setRenaming({ path: entry.path, originalName: entry.name });
}

function handleStartDelete(
  entry: FileExplorerEntry,
  setDeleteTarget: (entry: FileExplorerEntry | null) => void,
): void {
  setDeleteTarget(entry);
}

/**
 * Dispatch a context menu action to the appropriate extracted handler.
 * Returns `true` when the action was handled.
 */
export async function dispatchContextAction(
  action: ContextAction,
  entry: FileExplorerEntry,
  deps: ExplorerActionDeps,
  callbacks: {
    openFileInEditor: (filePath: string, workspaceId?: string) => Promise<void>;
    addTerminal: (terminal: { id: string; pid: number; workingDir: string }) => void;
    setRenaming: (state: { path: string; originalName: string } | null) => void;
    setDeleteTarget: (entry: FileExplorerEntry | null) => void;
    getWorkspacePath: (workspaceId: string) => string | undefined;
  },
): Promise<void> {
  switch (action) {
    case 'open-editor':
      await handleOpenEditor(entry, deps, callbacks.openFileInEditor);
      break;
    case 'open-terminal':
      await handleOpenTerminal(entry, callbacks.addTerminal);
      break;
    case 'copy-path':
      await handleCopyPath(entry);
      break;
    case 'copy-relative-path':
      await handleCopyRelativePath(entry, deps, callbacks.getWorkspacePath);
      break;
    case 'reveal-in-files':
      await handleRevealInFiles(entry);
      break;
    case 'rename':
      handleStartRename(entry, callbacks.setRenaming);
      break;
    case 'delete':
      handleStartDelete(entry, callbacks.setDeleteTarget);
      break;
  }
}

// ---------------------------------------------------------------------------
// Post-operation explorer state updates
// ---------------------------------------------------------------------------

/**
 * Update the explorer tree state after a successful delete.
 *
 * - Removes the entry from its parent directory listing
 * - Clears expanded paths that are inside the deleted path
 * - Deselects if the selected path was inside the deleted path
 * - Clears cached directory state for the deleted path and children
 */
function updateExplorerAfterDelete(
  entry: FileExplorerEntry,
  currentEntries: Record<string, FileExplorerEntry[] | undefined>,
  currentExpandedPaths: string[],
  selectedPath: string | null,
  deps: ExplorerActionDeps,
): void {
  const parentDir = dirnamePath(entry.path);
  const parentEntries = currentEntries[parentDir] ?? [];
  const updatedParentEntries = parentEntries.filter((child) => child.path !== entry.path);
  deps.setExplorerDirectoryEntries(parentDir, updatedParentEntries, deps.resolvedWorkspaceId ?? undefined);

  const remainingExpandedPaths = filterPathsOutsideBase(entry.path, currentExpandedPaths);
  if (remainingExpandedPaths.length !== currentExpandedPaths.length) {
    deps.setExplorerExpandedPaths(remainingExpandedPaths, deps.resolvedWorkspaceId ?? undefined);
  }

  if (selectedPath && (selectedPath === entry.path || isPathWithinBase(entry.path, selectedPath))) {
    deps.setExplorerSelectedPath(null, deps.resolvedWorkspaceId ?? undefined);
  }

  if (entry.isDirectory) {
    const staleDirectoryPaths = Object.keys(currentEntries).filter(
      (cachedPath) => cachedPath === entry.path || isPathWithinBase(entry.path, cachedPath),
    );
    if (staleDirectoryPaths.length > 0) {
      deps.clearExplorerDirectoryState(staleDirectoryPaths, deps.resolvedWorkspaceId ?? undefined);
    }
  }

  void deps.loadDirectory(parentDir);
}

/**
 * Update the explorer tree state after a successful rename.
 *
 * - Updates editor tab paths that reference the old path
 * - Updates the parent directory listing with the new name/path
 * - Updates the selected path if it was the renamed file
 * - Clears stale expanded paths and cached directory state
 */
function updateExplorerAfterRename(
  oldPath: string,
  newPath: string,
  newName: string,
  editorTabs: EditorTab[],
  currentEntries: Record<string, FileExplorerEntry[] | undefined>,
  currentExpandedPaths: string[],
  selectedPath: string | null,
  deps: ExplorerActionDeps,
  renameEditorTabPath: (oldPath: string, newPath: string, workspaceId?: string) => void,
): void {
  // Update any open editor tabs that reference this file
  for (const tab of editorTabs) {
    if (tab.filePath === oldPath) {
      renameEditorTabPath(oldPath, newPath, deps.resolvedWorkspaceId ?? undefined);
      break;
    }
  }

  const parentDir = dirnamePath(oldPath);
  const parentEntries = currentEntries[parentDir] ?? [];
  const updatedParentEntries = parentEntries.map((entry) =>
    entry.path === oldPath ? { ...entry, name: newName, path: newPath } : entry,
  );
  deps.setExplorerDirectoryEntries(parentDir, updatedParentEntries, deps.resolvedWorkspaceId ?? undefined);

  if (selectedPath === oldPath) {
    deps.setExplorerSelectedPath(newPath, deps.resolvedWorkspaceId ?? undefined);
  }

  if (oldPath !== newPath) {
    const staleDirectoryPaths = Object.keys(currentEntries).filter(
      (cachedPath) => cachedPath === oldPath || isPathWithinBase(oldPath, cachedPath),
    );
    if (staleDirectoryPaths.length > 0) {
      deps.clearExplorerDirectoryState(staleDirectoryPaths, deps.resolvedWorkspaceId ?? undefined);
    }
  }

  const remainingExpandedPaths = filterPathsOutsideBase(oldPath, currentExpandedPaths);
  if (remainingExpandedPaths.length !== currentExpandedPaths.length) {
    deps.setExplorerExpandedPaths(remainingExpandedPaths, deps.resolvedWorkspaceId ?? undefined);
  }

  void deps.loadDirectory(parentDir);
}

// ---------------------------------------------------------------------------
// File operation helpers
// ---------------------------------------------------------------------------

async function releaseEditorWatchForPath(workspacePath: string, filePath: string): Promise<void> {
  await window.electronAPI.editorUnwatchFile({ workspacePath, filePath });
}

async function rewatchEditorPath(workspacePath: string, filePath: string): Promise<void> {
  await window.electronAPI.editorWatchFile({ workspacePath, filePath });
}

function getFileInUseMessage(result: FileOperationResult): string {
  if (result.errorCode === 'FILE_IN_USE') {
    return 'File is open in an editor or another app. Close it and retry.';
  }
  return result.error ?? 'File operation failed';
}

/**
 * Execute the full delete flow: release watches, call API, handle failure or
 * update state on success.
 */
export async function executeDelete(
  entry: FileExplorerEntry,
  editorTabs: EditorTab[],
  normalizedWorkspacePath: string,
  closeEditorTab: (tabId: string, workspaceId?: string) => void,
  deps: ExplorerActionDeps,
  getLatestSnapshot: () => {
    explorerEntriesByPath: Record<string, FileExplorerEntry[] | undefined>;
    explorerExpandedPaths: string[];
    explorerSelectedPath: string | null;
  },
): Promise<void> {
  const tabsToClose = findEditorTabsForPath(entry.path, editorTabs);

  await Promise.all(tabsToClose.map((tab) => releaseEditorWatchForPath(normalizedWorkspacePath, tab.filePath)));

  const result = await window.electronAPI.fileDelete({
    workspacePath: normalizedWorkspacePath,
    targetPath: entry.path,
  });

  if (!result.success) {
    await Promise.all(tabsToClose.map((tab) => rewatchEditorPath(normalizedWorkspacePath, tab.filePath)));
    const message = getFileInUseMessage(result);
    console.error('Failed to delete entry:', message);
    window.alert(message);
    return;
  }

  for (const tab of tabsToClose) {
    closeEditorTab(tab.id, deps.resolvedWorkspaceId ?? undefined);
  }

  const snapshot = getLatestSnapshot();
  updateExplorerAfterDelete(
    entry,
    snapshot.explorerEntriesByPath,
    snapshot.explorerExpandedPaths,
    snapshot.explorerSelectedPath,
    deps,
  );
}

/**
 * Execute the full rename flow: release watch, call API, handle failure or
 * update state on success.
 */
export async function executeRename(
  oldPath: string,
  newName: string,
  editorTabs: EditorTab[],
  normalizedWorkspacePath: string,
  deps: ExplorerActionDeps,
  renameEditorTabPath: (oldPath: string, newPath: string, workspaceId?: string) => void,
  getLatestSnapshot: () => {
    explorerEntriesByPath: Record<string, FileExplorerEntry[] | undefined>;
    explorerExpandedPaths: string[];
    explorerSelectedPath: string | null;
  },
): Promise<void> {
  const parentDir = dirnamePath(oldPath);
  const newPath = joinPaths(parentDir, newName);

  await releaseEditorWatchForPath(normalizedWorkspacePath, oldPath);

  const result = await window.electronAPI.fileRename({
    workspacePath: normalizedWorkspacePath,
    oldPath,
    newPath,
  });

  if (!result.success) {
    void rewatchEditorPath(normalizedWorkspacePath, oldPath);
    const message = getFileInUseMessage(result);
    console.error('Failed to rename entry:', message);
    window.alert(message);
    return;
  }

  const snapshot = getLatestSnapshot();
  updateExplorerAfterRename(
    oldPath,
    newPath,
    newName,
    editorTabs,
    snapshot.explorerEntriesByPath,
    snapshot.explorerExpandedPaths,
    snapshot.explorerSelectedPath,
    deps,
    renameEditorTabPath,
  );
}
