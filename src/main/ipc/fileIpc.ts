import { ipcMain } from 'electron';
import { FILE_LIST_DIRECTORY } from '../../shared/ipcChannels';
import type { FileListDirectoryRequest } from '../../shared/types/fileExplorer';
import { listDirectory } from '../fileService';

export function registerFileIpc(): void {
  ipcMain.handle(FILE_LIST_DIRECTORY, async (_, request: FileListDirectoryRequest) => {
    return listDirectory(request);
  });
}
