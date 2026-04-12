export interface FileExplorerEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: number;
}

export interface FileListDirectoryRequest {
  workspacePath: string;
  directoryPath: string;
}

export type FileListDirectoryErrorCode = 'invalid-path' | 'permission-denied' | 'unknown';

export interface FileListDirectoryResult {
  success: boolean;
  entries: FileExplorerEntry[];
  errorCode?: FileListDirectoryErrorCode;
  error?: string;
}

/**
 * Payload emitted by ExplorerWatcherService when a file or directory is
 * created, deleted, or renamed inside the workspace tree.
 * The renderer uses this to re-fetch the affected parent directory.
 */
export interface ExplorerTreeChangedEvent {
  directoryPath: string;
}
