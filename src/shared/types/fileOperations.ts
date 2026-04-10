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

export interface FileOperationResult {
  success: boolean;
  error?: string;
}
