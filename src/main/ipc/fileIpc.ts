import { ipcMain, shell } from 'electron';
import * as path from 'node:path';
import { FILE_LIST_DIRECTORY, FILE_READ, FILE_WRITE, FILE_CREATE, FILE_DELETE, FILE_RENAME, REVEAL_IN_FILE_MANAGER, FILE_WATCH, FILE_UNWATCH, FILE_CHANGED } from '../../shared/ipcChannels';
import type { FileListDirectoryRequest } from '../../shared/types/fileExplorer';
import type { FileReadRequest, FileWriteRequest, FileWatchRequest } from '../../shared/types/editor';
import type { FileCreateRequest, FileDeleteRequest, FileRenameRequest } from '../../shared/types/fileOperations';
import { listDirectory, readFile, writeFile, createFile, createDirectory, deleteEntry, renameEntry, resolveAndValidateWatchPath } from '../fileService';
import type { FileWatcherService } from '../fileWatcher';

interface RegisterFileIpcDeps {
  getFileWatcher: () => FileWatcherService;
}

export function registerFileIpc(deps: RegisterFileIpcDeps): void {
  const fileWatcher = deps.getFileWatcher();
  ipcMain.handle(FILE_LIST_DIRECTORY, async (_, request: FileListDirectoryRequest) => {
    return listDirectory(request);
  });

  ipcMain.handle(FILE_READ, async (_, request: FileReadRequest) => {
    return readFile(request);
  });

  ipcMain.handle(FILE_WRITE, async (_, request: FileWriteRequest) => {
    const result = await writeFile(request);
    if (result.success) {
      fileWatcher.markWritten(request.filePath);
    }
    return result;
  });

  ipcMain.handle(FILE_CREATE, async (_, request: FileCreateRequest) => {
    if (request.type === 'directory') {
      return createDirectory(request);
    }
    return createFile(request);
  });

  ipcMain.handle(FILE_DELETE, async (_, request: FileDeleteRequest) => {
    return deleteEntry(request);
  });

  ipcMain.handle(FILE_RENAME, async (_, request: FileRenameRequest) => {
    return renameEntry(request);
  });

  ipcMain.handle(REVEAL_IN_FILE_MANAGER, async (_, filePath: string) => {
    if (!filePath || !filePath.trim()) {
      return false;
    }

    shell.showItemInFolder(path.resolve(filePath));
    return true;
  });

  ipcMain.handle(FILE_WATCH, async (_, request: FileWatchRequest) => {
    if (!request?.workspacePath || !request.filePath) {
      return false;
    }

    const validated = await resolveAndValidateWatchPath(request.workspacePath, request.filePath);
    if (!validated.success) {
      return false;
    }

    fileWatcher.watchFile(validated.filePath);
    return true;
  });

  ipcMain.handle(FILE_UNWATCH, (_, request: FileWatchRequest) => {
    // Unwatching does not expose filesystem information; accept the request even if the
    // workspace path is stale, but normalize to avoid duplicate registrations.
    if (!request?.filePath) {
      return false;
    }
    fileWatcher.unwatchFile(path.resolve(request.filePath));
    return true;
  });

  // Event channel — registered so the integration test can verify completeness.
  // This is one-way: main sends events to renderer (no handler needed).
  ipcMain.on(FILE_CHANGED, () => { });
}
