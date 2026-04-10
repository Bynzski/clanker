import { ipcMain } from 'electron';
import { FILE_LIST_DIRECTORY, FILE_READ, FILE_WRITE } from '../../shared/ipcChannels';
import type { FileListDirectoryRequest } from '../../shared/types/fileExplorer';
import type { FileReadRequest, FileWriteRequest } from '../../shared/types/editor';
import { listDirectory, readFile, writeFile } from '../fileService';

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
}
