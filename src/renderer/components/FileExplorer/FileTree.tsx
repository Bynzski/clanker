import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import type { GitStatus } from '../../components/git/types';
import { isAbsolutePath, relativePath } from '../../lib/pathUtils';
import { getFileTypeConfig } from './fileTypeConfig';
import type { FileExplorerEntry, FileListDirectoryResult } from '../../../shared/types/fileExplorer';
import { useWorkspaceStore } from '../../store/workspaceStore';

interface FileTreeProps {
  rootPath: string;
  workspacePath: string;
  rootError?: string | null;
  onLoadDirectory: (directoryPath: string) => Promise<FileListDirectoryResult>;
  gitChanges: GitStatus[];
  onContextMenu: {(e: React.MouseEvent<HTMLButtonElement>, entry: FileExplorerEntry): void};
  creating: { parentPath: string; type: 'file' | 'directory' } | null;
  renaming: { path: string; originalName: string } | null;
  onStartCreating: (parentPath: string, type: 'file' | 'directory') => void;
  onStartRenaming: (path: string, originalName: string) => void;
  onCancelCreating: () => void;
  onCancelRenaming: () => void;
  onCommitCreating: (name: string) => Promise<void>;
  onCommitRenaming: (newName: string) => Promise<void>;
}

interface TreeNodeProps {
  entry: FileExplorerEntry;
  depth: number;
  onLoadDirectory: (directoryPath: string) => Promise<FileListDirectoryResult>;
  gitStatusByRelativePath: Map<string, GitStatus>;
  descendantChangePaths: Set<string>;
  workspaceRoot: string;
  showHiddenFiles: boolean;
  onContextMenu: {(e: React.MouseEvent<HTMLButtonElement>, entry: FileExplorerEntry): void};
  creating: { parentPath: string; type: 'file' | 'directory' } | null;
  renaming: { path: string; originalName: string } | null;
  onStartCreating: (parentPath: string, type: 'file' | 'directory') => void;
  onStartRenaming: (path: string, originalName: string) => void;
  onCancelCreating: () => void;
  onCancelRenaming: () => void;
  onCommitCreating: (name: string) => Promise<void>;
  onCommitRenaming: (newName: string) => Promise<void>;
}

export function toRelativePath(
  absolutePath: string,
  workspaceRoot: string,
  pathModule:
    | Pick<typeof import('../../lib/pathUtils'), 'relativePath' | 'isAbsolutePath'>
    | Pick<typeof import('node:path'), 'relative' | 'isAbsolute' | 'sep'> = {
    relativePath,
    isAbsolutePath,
  }
): string {
  const nextRelativePath = 'relativePath' in pathModule
    ? pathModule.relativePath(workspaceRoot, absolutePath)
    : pathModule.relative(workspaceRoot, absolutePath).split(pathModule.sep).join('/');
  const isAbsolute = 'isAbsolutePath' in pathModule
    ? pathModule.isAbsolutePath(nextRelativePath)
    : pathModule.isAbsolute(nextRelativePath);

  if (nextRelativePath === '' || (!nextRelativePath.startsWith('..') && !isAbsolute)) {
    return nextRelativePath;
  }
  return absolutePath;
}

function TreeNode({ entry, depth, onLoadDirectory, gitStatusByRelativePath, descendantChangePaths, workspaceRoot, showHiddenFiles, onContextMenu, creating, renaming, onStartCreating, onStartRenaming, onCancelCreating, onCancelRenaming, onCommitCreating, onCommitRenaming }: TreeNodeProps) {
  const {
    explorerExpandedPaths,
    explorerSelectedPath,
    explorerEntriesByPath,
    explorerLoadingPaths,
    explorerErrorsByPath,
    toggleExplorerPath,
    setExplorerSelectedPath,
  } = useWorkspaceStore();

  const isExpanded = explorerExpandedPaths.includes(entry.path);
  const isSelected = explorerSelectedPath === entry.path;
  const childEntries = (explorerEntriesByPath[entry.path] ?? []).filter(
    (e) => showHiddenFiles || !e.name.startsWith('.')
  );
  const isLoading = explorerLoadingPaths.includes(entry.path);
  const error = explorerErrorsByPath[entry.path];

  const handleClick = async () => {
    setExplorerSelectedPath(entry.path);

    if (!entry.isDirectory) {
      return;
    }

    const shouldExpand = !isExpanded;
    if (shouldExpand && !Object.prototype.hasOwnProperty.call(explorerEntriesByPath, entry.path)) {
      const result = await onLoadDirectory(entry.path);
      if (!result.success) {
        return;
      }
    }

    toggleExplorerPath(entry.path);
  };

  const handleDoubleClick = () => {
    if (entry.isDirectory) return;
    const { openFileInEditor } = useWorkspaceStore.getState();
    void openFileInEditor(entry.path);
  };

  const relativePath = toRelativePath(entry.path, workspaceRoot);
  const gitStatus = gitStatusByRelativePath.get(relativePath);
  const hasDescendantChange = entry.isDirectory && descendantChangePaths.has(relativePath);

  const isRenaming = renaming?.path === entry.path;
  const [renameValue, setRenameValue] = useState(entry.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Focus on mount
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
    }
  }, [isRenaming, entry.name]);

  const handleRenameKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = renameValue.trim();
      if (trimmed && trimmed !== entry.name) {
        await onCommitRenaming(trimmed);
      } else {
        onCancelRenaming();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancelRenaming();
    }
  }, [renameValue, entry.name, onCommitRenaming, onCancelRenaming]);

  const handleRenameBlur = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== entry.name) {
      await onCommitRenaming(trimmed);
    } else {
      onCancelRenaming();
    }
  }, [renameValue, entry.name, onCommitRenaming, onCancelRenaming]);

  return (
    <>
      <button
        type="button"
        className={`tree-node ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => void handleClick()}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e, entry);
        }}
      >
        <span className="tree-node-indicator">
          {entry.isDirectory ? (
            isExpanded ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />
          ) : null}
        </span>
        <span className="tree-node-icon">
          {entry.isDirectory ? (
            isExpanded ? <FolderOpen size={16} strokeWidth={2} /> : <Folder size={16} strokeWidth={2} />
          ) : (() => {
            const { Icon, color } = getFileTypeConfig(entry.name);
            return <Icon size={16} strokeWidth={2} style={{ color }} />;
          })()}
        </span>
        {isRenaming ? (
          <input
            ref={renameInputRef}
            className="tree-node-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={handleRenameBlur}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="tree-node-name">{entry.name}</span>
        )}
        {(gitStatus || hasDescendantChange) && !isRenaming && (
          <span className={`git-status-indicator git-${gitStatus?.status ?? 'modified'}`} />
        )}
      </button>
      {entry.isDirectory && isExpanded ? (
        <>
          {isLoading ? <div className="tree-node-status" style={{ paddingLeft: depth * 16 + 40 }}>Loading...</div> : null}
          {!isLoading && error ? <div className="tree-node-status error" style={{ paddingLeft: depth * 16 + 40 }}>{error}</div> : null}
          {!isLoading && !error ? (
            <>
              {/* Inline create input — shown as first child of this directory */}
              {creating && creating.parentPath === entry.path ? (
                <CreateInput
                  type={creating.type}
                  depth={depth + 1}
                  onCommit={onCommitCreating}
                  onCancel={onCancelCreating}
                />
              ) : null}
              {childEntries.map((childEntry) => (
                <TreeNode
                  key={childEntry.path}
                  entry={childEntry}
                  depth={depth + 1}
                  onLoadDirectory={onLoadDirectory}
                  gitStatusByRelativePath={gitStatusByRelativePath}
                  descendantChangePaths={descendantChangePaths}
                  workspaceRoot={workspaceRoot}
                  showHiddenFiles={showHiddenFiles}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onContextMenu(e, childEntry);
                  }}
                  creating={creating}
                  renaming={renaming}
                  onStartCreating={onStartCreating}
                  onStartRenaming={onStartRenaming}
                  onCancelCreating={onCancelCreating}
                  onCancelRenaming={onCancelRenaming}
                  onCommitCreating={onCommitCreating}
                  onCommitRenaming={onCommitRenaming}
                />
              ))}
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function CreateInput({ type, depth, onCommit, onCancel }: {
  type: 'file' | 'directory';
  depth: number;
  onCommit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = name.trim();
      if (trimmed) {
        await onCommit(trimmed);
      } else {
        onCancel();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const handleBlur = async () => {
    const trimmed = name.trim();
    if (trimmed) {
      await onCommit(trimmed);
    } else {
      onCancel();
    }
  };

  return (
    <div className="tree-node tree-node-creating" style={{ paddingLeft: depth * 16 + 8 }}>
      <span className="tree-node-indicator" style={{ width: 16 }} />
      <span className="tree-node-icon">
        {type === 'directory' ? (
          <Folder size={16} strokeWidth={2} />
        ) : (() => {
          const { Icon, color } = getFileTypeConfig(name || 'tmp');
          return <Icon size={16} strokeWidth={2} style={{ color }} />;
        })()}
      </span>
      <input
        ref={inputRef}
        className="tree-node-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={type === 'directory' ? 'folder-name/' : 'file-name.ext'}
      />
    </div>
  );
}

export default function FileTree({ rootPath, workspacePath, rootError, onLoadDirectory, gitChanges, onContextMenu, creating, renaming, onStartCreating, onStartRenaming, onCancelCreating, onCancelRenaming, onCommitCreating, onCommitRenaming }: FileTreeProps) {
  const {
    explorerEntriesByPath,
    explorerLoadingPaths,
    toggleExplorerPath,
    setExplorerSelectedPath,
    openFileInEditor,
  } = useWorkspaceStore();

  const { gitStatusByRelativePath, descendantChangePaths } = useMemo(() => {
    const map = new Map<string, GitStatus>();
    const descendantPaths = new Set<string>();
    for (const change of gitChanges) {
      const relativeChangePath = change.path.replace(/\\/g, '/');
      map.set(relativeChangePath, change);

      const segments = relativeChangePath.split('/').filter(Boolean);
      let currentPath = '';
      for (let index = 0; index < segments.length - 1; index += 1) {
        currentPath = currentPath.length === 0 ? segments[index] : `${currentPath}/${segments[index]}`;
        descendantPaths.add(currentPath);
      }
      if (segments.length > 0) {
        descendantPaths.add('');
      }
    }
    return {
      gitStatusByRelativePath: map,
      descendantChangePaths: descendantPaths,
    };
  }, [gitChanges]);

  const showHiddenFiles = useWorkspaceStore((s) => s.showHiddenFiles);
  const rootEntries = (explorerEntriesByPath[rootPath] ?? []).filter(
    (e) => showHiddenFiles || !e.name.startsWith('.')
  );
  const isRootLoading = explorerLoadingPaths.includes(rootPath);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Read live state from the store to avoid stale closures
      const state = useWorkspaceStore.getState();
      const { explorerEntriesByPath: liveEntries, explorerExpandedPaths: liveExpanded, explorerSelectedPath: liveSelected, showHiddenFiles: liveShowHidden } = state;
      const liveRootEntries = (liveEntries[rootPath] ?? []).filter(
        (entry) => liveShowHidden || !entry.name.startsWith('.')
      );

      // Build liveNodes from live state
      const liveNodes: Array<{ entry: FileExplorerEntry; depth: number }> = [];
      const walkLive = (entries: FileExplorerEntry[], depth: number) => {
        for (const entry of entries) {
          liveNodes.push({ entry, depth });
          if (entry.isDirectory && liveExpanded.includes(entry.path)) {
            const children = (liveEntries[entry.path] ?? []).filter(
              (child) => liveShowHidden || !child.name.startsWith('.')
            );
            walkLive(children, depth + 1);
          }
        }
      };
      walkLive(liveRootEntries, 0);

      // Guard: if the tree is empty (still loading), ignore keyboard events
      if (liveNodes.length === 0) {
        return;
      }

      const currentIndex = liveNodes.findIndex((n) => n.entry.path === liveSelected);

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          if (currentIndex === -1) {
            setExplorerSelectedPath(liveNodes[0].entry.path);
          } else {
            const nextIndex = currentIndex < liveNodes.length - 1 ? currentIndex + 1 : currentIndex;
            setExplorerSelectedPath(liveNodes[nextIndex].entry.path);
          }
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          if (currentIndex === -1) {
            setExplorerSelectedPath(liveNodes[liveNodes.length - 1].entry.path);
          } else {
            const prevIndex = currentIndex > 0 ? currentIndex - 1 : currentIndex;
            setExplorerSelectedPath(liveNodes[prevIndex].entry.path);
          }
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          const targetIndex = currentIndex === -1 ? 0 : currentIndex;
          const node = liveNodes[targetIndex];
          if (node?.entry.isDirectory && !liveExpanded.includes(node.entry.path)) {
            void (async () => {
              if (!Object.prototype.hasOwnProperty.call(liveEntries, node.entry.path)) {
                await onLoadDirectory(node.entry.path);
              }
              toggleExplorerPath(node.entry.path);
            })();
          }
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          const targetIndex = currentIndex === -1 ? 0 : currentIndex;
          const node = liveNodes[targetIndex];
          if (node?.entry.isDirectory && liveExpanded.includes(node.entry.path)) {
            toggleExplorerPath(node.entry.path);
          }
          break;
        }
        case 'Enter': {
          const targetIndex = currentIndex === -1 ? 0 : currentIndex;
          const node = liveNodes[targetIndex];
          if (node?.entry.isDirectory) {
            if (!liveExpanded.includes(node.entry.path)) {
              void (async () => {
                if (!Object.prototype.hasOwnProperty.call(liveEntries, node.entry.path)) {
                  await onLoadDirectory(node.entry.path);
                }
                toggleExplorerPath(node.entry.path);
              })();
            } else {
              toggleExplorerPath(node.entry.path);
            }
          } else {
            void openFileInEditor(node.entry.path);
          }
          break;
        }
        case 'F2': {
          e.preventDefault();
          if (currentIndex >= 0) {
            const node = liveNodes[currentIndex];
            if (node) {
              onStartRenaming(node.entry.path, node.entry.name);
            }
          }
          break;
        }
      }
    },
    [rootPath, onLoadDirectory, toggleExplorerPath, setExplorerSelectedPath, openFileInEditor, onStartRenaming]
  );

  if (isRootLoading && rootEntries.length === 0) {
    return <div className="file-explorer-status">Loading...</div>;
  }

  if (rootError) {
    return <div className="file-explorer-status error">{rootError}</div>;
  }

  if (rootEntries.length === 0) {
    return <div className="file-explorer-status">No files</div>;
  }

  return (
    <div
      className="file-tree"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Inline create input at root level */}
      {creating && creating.parentPath === rootPath ? (
        <CreateInput
          type={creating.type}
          depth={0}
          onCommit={onCommitCreating}
          onCancel={onCancelCreating}
        />
      ) : null}
      {rootEntries.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          onLoadDirectory={onLoadDirectory}
          gitStatusByRelativePath={gitStatusByRelativePath}
          descendantChangePaths={descendantChangePaths}
          workspaceRoot={workspacePath}
          showHiddenFiles={showHiddenFiles}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onContextMenu(e, entry);
          }}
          creating={creating}
          renaming={renaming}
          onStartCreating={onStartCreating}
          onStartRenaming={onStartRenaming}
          onCancelCreating={onCancelCreating}
          onCancelRenaming={onCancelRenaming}
          onCommitCreating={onCommitCreating}
          onCommitRenaming={onCommitRenaming}
        />
      ))}
    </div>
  );
}
