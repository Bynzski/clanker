export interface FileCreateRequest {
  workspacePath: string;
  targetPath: string;
  type: 'file' | 'directory';
}

export interface FileDeleteRequest {
  workspacePath: string;
  targetPath: string;
}

export interface FileRenameRequest {
  workspacePath: string;
  oldPath: string;
  newPath: string;
}

export type FileOperationErrorCode = 'FILE_IN_USE';

export interface FileOperationResult {
  success: boolean;
  error?: string;
  errorCode?: FileOperationErrorCode;
}
