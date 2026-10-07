export type FileReadErrorCode = 'file-too-large' | 'binary-file' | 'invalid-path' | 'not-found' | 'read-error' | 'unknown';

export interface FileReadRequest {
  checkoutContextId?: string;
  workspacePath: string;
  workspaceId?: string;
  filePath: string;
}

export interface FileReadResult {
  success: boolean;
  content?: string;
  errorCode?: FileReadErrorCode;
  error?: string;
}

export interface FileWriteRequest {
  checkoutContextId?: string;
  workspacePath: string;
  filePath: string;
  workspaceId?: string;
  content: string;
}

export interface FileWriteResult {
  success: boolean;
  errorCode?: 'invalid-path' | 'write-error' | 'unknown';
  error?: string;
}

export interface FileChangedEvent {
  filePath: string;
  deleted: boolean;
}

export interface FileWatchRequest {
  checkoutContextId?: string;
  workspacePath: string;
  filePath: string;
  workspaceId?: string;
}
