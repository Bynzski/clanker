import { ipcMain, shell } from 'electron';
import * as path from 'node:path';
import { FILE_LIST_DIRECTORY, FILE_READ, FILE_WRITE, FILE_CREATE, FILE_DELETE, FILE_RENAME, REVEAL_IN_FILE_MANAGER } from '../../shared/ipcChannels';
import type { FileListDirectoryRequest } from '../../shared/types/fileExplorer';
import type { FileReadRequest, FileWriteRequest } from '../../shared/types/editor';
import type { FileCreateRequest, FileDeleteRequest, FileRenameRequest } from '../../shared/types/fileOperations';
import { listDirectory, readFile, writeFile, createFile, createDirectory, deleteEntry, renameEntry } from '../fileService';

export function registerFileIpc(): void {
  ipcMain.handle(FILE_LIST_DIRECTORY, async (_, request: FileListDirectoryRequest) => {
    return listDirectory(request);
  });

  ipcMain.handle(FILE_READ, async (_, request: FileReadRequest) => {
    return readFile(request);
  });

  ipcMain.handle(FILE_WRITE, async (_, request: FileWriteRequest) => {
    return writeFile(request);
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
}
