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
