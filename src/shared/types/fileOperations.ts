export interface FileCreateRequest {
  workspacePath: string;
  workspaceId?: string;
  targetPath: string;
  type: 'file' | 'directory';
}

export interface FileDeleteRequest {
  workspacePath: string;
  workspaceId?: string;
  targetPath: string;
}

export interface FileRenameRequest {
  workspacePath: string;
  oldPath: string;
  workspaceId?: string;
  newPath: string;
}

export type FileOperationErrorCode = 'FILE_IN_USE';

export interface FileOperationResult {
  success: boolean;
  error?: string;
  errorCode?: FileOperationErrorCode;
}
