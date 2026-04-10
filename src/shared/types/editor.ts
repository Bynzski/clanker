export type FileReadErrorCode = 'file-too-large' | 'binary-file' | 'invalid-path' | 'not-found' | 'read-error' | 'unknown';

export interface FileReadRequest {
  workspacePath: string;
  filePath: string;
}

export interface FileReadResult {
  success: boolean;
  content?: string;
  errorCode?: FileReadErrorCode;
  error?: string;
}

export interface FileWriteRequest {
  workspacePath: string;
  filePath: string;
  content: string;
}

export interface FileWriteResult {
  success: boolean;
  errorCode?: 'invalid-path' | 'write-error' | 'unknown';
  error?: string;
}