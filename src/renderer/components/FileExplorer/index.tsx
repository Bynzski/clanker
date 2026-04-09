import { useCallback, useEffect } from 'react';
import { PanelLeftClose } from 'lucide-react';
import type { FileListDirectoryResult } from '../../../shared/types/fileExplorer';
import { useWorkspaceStore } from '../../store/workspaceStore';
import FileTree from './FileTree';
import './FileExplorer.css';

function getDirectoryLoadErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return 'Unable to load directory';
}

export default function FileExplorer() {
  const {
    activeWorkspaceId,
    workspacePath,
    explorerVisible,
    explorerSidebarWidth,
    explorerEntriesByPath,
    explorerLoadingPaths,
    explorerErrorsByPath,
    setExplorerVisible,
    setExplorerDirectoryEntries,
    setExplorerDirectoryLoading,
    setExplorerDirectoryError,
  } = useWorkspaceStore();

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

  if (!explorerVisible || !workspacePath) {
    return null;
  }

  return (
    <aside className="file-explorer" style={{ width: explorerSidebarWidth }}>
      <div className="file-explorer-header">
        <span className="file-explorer-title">Explorer</span>
        <button
          type="button"
          className="file-explorer-close"
          onClick={() => setExplorerVisible(false)}
          title="Close Explorer"
        >
          <PanelLeftClose size={16} strokeWidth={2} />
        </button>
      </div>
      <div className="file-explorer-content">
        <FileTree
          rootPath={workspacePath}
          rootError={explorerErrorsByPath[workspacePath]}
          onLoadDirectory={loadDirectory}
        />
      </div>
    </aside>
  );
}
