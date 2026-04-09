import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  FileExplorerEntry,
  FileListDirectoryRequest,
  FileListDirectoryResult,
} from '../shared/types/fileExplorer';
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
