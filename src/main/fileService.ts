import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  FileExplorerEntry,
  FileListDirectoryRequest,
  FileListDirectoryResult,
} from '../shared/types/fileExplorer';
import type {
  FileReadRequest,
  FileReadResult,
  FileWriteRequest,
  FileWriteResult,
  FileReadErrorCode,
} from '../shared/types/editor';
import { resolveExistingDirectory } from './security';

function compareEntries(a: FileExplorerEntry, b: FileExplorerEntry): number {
  if (a.isDirectory !== b.isDirectory) {
    return a.isDirectory ? -1 : 1;
  }

  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

async function resolveNearestExistingDirectoryPath(targetPath: string): Promise<string | null> {
  let currentPath = path.resolve(targetPath);

  while (true) {
    try {
      const resolvedPath = await fs.realpath(currentPath);
      const stats = await fs.stat(resolvedPath);
      return stats.isDirectory() ? resolvedPath : null;
    } catch (error) {
      const err = error as NodeJS.ErrnoException | undefined;
      if (err?.code !== 'ENOENT') {
        return null;
      }
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return null;
    }
    currentPath = parentPath;
  }
}

function toDirectoryError(error: unknown): Pick<FileListDirectoryResult, 'errorCode' | 'error'> {
  if ((error as NodeJS.ErrnoException | undefined)?.code === 'EACCES' || (error as NodeJS.ErrnoException | undefined)?.code === 'EPERM') {
    return {
      errorCode: 'permission-denied',
      error: 'Permission denied while listing directory',
    };
  }

  return {
    errorCode: 'unknown',
    error: 'Unable to list directory',
  };
}

async function resolveValidatedDirectory(
  workspacePath: string,
  directoryPath: string
): Promise<{ targetDirectory: string } | null> {
  const safeWorkspacePath = resolveExistingDirectory(workspacePath);
  if (!safeWorkspacePath) {
    return null;
  }

  try {
    const workspaceRoot = await fs.realpath(safeWorkspacePath);
    const requestedPath = path.resolve(directoryPath);
    const resolvedDirectory = await fs.realpath(requestedPath);
    const directoryStats = await fs.stat(resolvedDirectory);

    if (!directoryStats.isDirectory() || !isPathInsideRoot(workspaceRoot, resolvedDirectory)) {
      return null;
    }

    return { targetDirectory: resolvedDirectory };
  } catch {
    return null;
  }
}

export async function listDirectory(
  request: FileListDirectoryRequest
): Promise<FileListDirectoryResult> {
  const resolved = await resolveValidatedDirectory(request.workspacePath, request.directoryPath);
  if (!resolved) {
    return {
      success: false,
      entries: [],
      errorCode: 'invalid-path',
      error: 'Directory path is invalid for this workspace',
    };
  }

  try {
    const directoryEntries = await fs.readdir(resolved.targetDirectory, { withFileTypes: true });
    const entries = await Promise.all(
      directoryEntries.map(async (entry) => {
        const fullPath = path.join(resolved.targetDirectory, entry.name);

        try {
          const stats = await fs.stat(fullPath);
          return {
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            size: stats.size,
            modified: stats.mtimeMs,
          } satisfies FileExplorerEntry;
        } catch {
          return null;
        }
      })
    );

    return {
      success: true,
      entries: entries.filter((entry): entry is FileExplorerEntry => entry !== null).sort(compareEntries),
    };
  } catch (error) {
    return {
      success: false,
      entries: [],
      ...toDirectoryError(error),
    };
  }
}

const MAX_FILE_SIZE = 1_048_576; // 1 MB
const BINARY_DETECTION_BYTES = 8192;

type FileReadError = { errorCode: FileReadErrorCode; error: string };
type FileReadSuccess = { filePath: string };

async function resolveAndValidateFilePath(
  workspacePath: string,
  filePath: string
): Promise<FileReadSuccess | FileReadError> {
  const safeWorkspacePath = resolveExistingDirectory(workspacePath);
  if (!safeWorkspacePath) {
    return { errorCode: 'invalid-path', error: 'Invalid workspace path' };
  }

  try {
    const workspaceRoot = await fs.realpath(safeWorkspacePath);
    const requestedPath = path.resolve(filePath);
    const resolvedPath = await fs.realpath(requestedPath);

    if (!isPathInsideRoot(workspaceRoot, resolvedPath)) {
      return { errorCode: 'invalid-path', error: 'File path is outside workspace' };
    }

    const stats = await fs.stat(resolvedPath);
    if (!stats.isFile()) {
      return { errorCode: 'invalid-path', error: 'Path is not a file' };
    }

    return { filePath: resolvedPath };
  } catch (error) {
    const err = error as NodeJS.ErrnoException | undefined;
    if (err?.code === 'ENOENT') {
      return { errorCode: 'not-found', error: 'File not found' };
    }
    return { errorCode: 'unknown', error: 'Failed to resolve file path' };
  }
}

export async function readFile(request: FileReadRequest): Promise<FileReadResult> {
  const validation = await resolveAndValidateFilePath(request.workspacePath, request.filePath);
  if ('errorCode' in validation) {
    return { success: false, errorCode: validation.errorCode, error: validation.error };
  }

  const filePath = validation.filePath;

  try {
    const stats = await fs.stat(filePath);

    if (stats.size > MAX_FILE_SIZE) {
      return {
        success: false,
        errorCode: 'file-too-large',
        error: 'File exceeds 1 MB size limit',
      };
    }

    // Binary detection: read first 8192 bytes and check for null bytes
    const previewBuffer = Buffer.alloc(BINARY_DETECTION_BYTES);
    const { createReadStream } = await import('fs');
    const previewStream = createReadStream(filePath, { start: 0, end: BINARY_DETECTION_BYTES - 1 });

    let bytesRead = 0;
    await new Promise<void>((resolve, reject) => {
      previewStream.on('data', (chunk: Buffer) => {
        chunk.copy(previewBuffer, bytesRead);
        bytesRead += chunk.length;
      });
      previewStream.on('end', () => resolve());
      previewStream.on('error', reject);
    });

    // Check for null bytes in the preview
    const previewSlice = previewBuffer.slice(0, bytesRead);
    const hasNullByte = previewSlice.some((byte) => byte === 0);
    if (hasNullByte) {
      return {
        success: false,
        errorCode: 'binary-file',
        error: 'File is binary and cannot be displayed',
      };
    }

    // Read full content
    const content = await fs.readFile(filePath, 'utf-8');
    return { success: true, content };
  } catch (error) {
    const err = error as NodeJS.ErrnoException | undefined;
    if (err?.code === 'ENOENT') {
      return { success: false, errorCode: 'not-found', error: 'File not found' };
    }
    if (err?.code === 'EACCES' || err?.code === 'EPERM') {
      return { success: false, errorCode: 'read-error', error: 'Permission denied reading file' };
    }
    return { success: false, errorCode: 'unknown', error: 'Failed to read file' };
  }
}

type FileWriteError = { errorCode: 'invalid-path' | 'unknown'; error: string };
type FileWriteSuccess = { filePath: string };

async function resolveAndValidateWritePath(
  workspacePath: string,
  filePath: string
): Promise<FileWriteSuccess | FileWriteError> {
  const safeWorkspacePath = resolveExistingDirectory(workspacePath);
  if (!safeWorkspacePath) {
    return { errorCode: 'invalid-path', error: 'Invalid workspace path' };
  }

  try {
    const workspaceRoot = await fs.realpath(safeWorkspacePath);
    const requestedPath = path.resolve(filePath);

    // Security check: ensure the path is inside the workspace
    if (!isPathInsideRoot(workspaceRoot, requestedPath)) {
      return { errorCode: 'invalid-path', error: 'File path is outside workspace' };
    }

    // Check if file exists and is a file
    try {
      const resolvedPath = await fs.realpath(requestedPath);
      
      // Additional security: check the resolved path is also inside workspace
      if (!isPathInsideRoot(workspaceRoot, resolvedPath)) {
        return { errorCode: 'invalid-path', error: 'File path is outside workspace (symlink traversal)' };
      }
      
      const fileStats = await fs.stat(resolvedPath);
      if (!fileStats.isFile()) {
        return { errorCode: 'invalid-path', error: 'Path is not a file' };
      }
      return { filePath: resolvedPath };
    } catch {
      // File doesn't exist - for write, this is okay
      // Check if parent directory exists (or can be created)
      const parentDir = path.dirname(requestedPath);
      try {
        const parentStats = await fs.stat(parentDir);
        if (!parentStats.isDirectory()) {
          return { errorCode: 'invalid-path', error: 'Parent path is not a directory' };
        }
        const resolvedParentDir = await fs.realpath(parentDir);
        if (!isPathInsideRoot(workspaceRoot, resolvedParentDir)) {
          return { errorCode: 'invalid-path', error: 'Parent directory is outside workspace' };
        }
        return { filePath: requestedPath };
      } catch {
        // Parent doesn't exist - for writes, we'll create it.
        // Validate the nearest existing ancestor with realpath to prevent symlink escape.
        const resolvedAncestor = await resolveNearestExistingDirectoryPath(parentDir);
        if (!resolvedAncestor || !isPathInsideRoot(workspaceRoot, resolvedAncestor)) {
          return { errorCode: 'invalid-path', error: 'Parent directory is outside workspace' };
        }
        return { filePath: requestedPath };
      }
    }
  } catch {
    return { errorCode: 'unknown', error: 'Failed to resolve file path' };
  }
}

export async function writeFile(request: FileWriteRequest): Promise<FileWriteResult> {
  const validation = await resolveAndValidateWritePath(request.workspacePath, request.filePath);
  if ('errorCode' in validation) {
    return { success: false, errorCode: validation.errorCode, error: validation.error };
  }

  try {
    const fileDir = path.dirname(validation.filePath);

    // Ensure parent directory exists (for new files in new directories)
    await fs.mkdir(fileDir, { recursive: true });

    // Atomic write: write to temp file in same directory, then rename
    const tempPath = path.join(fileDir, `.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`);
    await fs.writeFile(tempPath, request.content, 'utf-8');
    await fs.rename(tempPath, validation.filePath);

    return { success: true };
  } catch {
    return { success: false, errorCode: 'write-error', error: 'Failed to write file' };
  }
}
