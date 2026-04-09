import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from 'lucide-react';
import type { FileExplorerEntry, FileListDirectoryResult } from '../../../shared/types/fileExplorer';
import { useWorkspaceStore } from '../../store/workspaceStore';

interface FileTreeProps {
  rootPath: string;
  rootError?: string | null;
  onLoadDirectory: (directoryPath: string) => Promise<FileListDirectoryResult>;
}

interface TreeNodeProps {
  entry: FileExplorerEntry;
  depth: number;
  onLoadDirectory: (directoryPath: string) => Promise<FileListDirectoryResult>;
}

function TreeNode({ entry, depth, onLoadDirectory }: TreeNodeProps) {
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
  const childEntries = explorerEntriesByPath[entry.path] ?? [];
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

  return (
    <>
      <button
        type="button"
        className={`tree-node ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => void handleClick()}
      >
        <span className="tree-node-indicator">
          {entry.isDirectory ? (
            isExpanded ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />
          ) : null}
        </span>
        <span className="tree-node-icon">
          {entry.isDirectory ? (
            isExpanded ? <FolderOpen size={16} strokeWidth={2} /> : <Folder size={16} strokeWidth={2} />
          ) : (
            <File size={16} strokeWidth={2} />
          )}
        </span>
        <span className="tree-node-name">{entry.name}</span>
      </button>
      {entry.isDirectory && isExpanded ? (
        <>
          {isLoading ? <div className="tree-node-status" style={{ paddingLeft: depth * 16 + 40 }}>Loading...</div> : null}
          {!isLoading && error ? <div className="tree-node-status error" style={{ paddingLeft: depth * 16 + 40 }}>{error}</div> : null}
          {!isLoading && !error ? childEntries.map((childEntry) => (
            <TreeNode
              key={childEntry.path}
              entry={childEntry}
              depth={depth + 1}
              onLoadDirectory={onLoadDirectory}
            />
          )) : null}
        </>
      ) : null}
    </>
  );
}

export default function FileTree({ rootPath, rootError, onLoadDirectory }: FileTreeProps) {
  const {
    explorerEntriesByPath,
    explorerLoadingPaths,
  } = useWorkspaceStore();

  const rootEntries = explorerEntriesByPath[rootPath] ?? [];
  const isRootLoading = explorerLoadingPaths.includes(rootPath);

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
    <div className="file-tree">
      {rootEntries.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          onLoadDirectory={onLoadDirectory}
        />
      ))}
    </div>
  );
}
