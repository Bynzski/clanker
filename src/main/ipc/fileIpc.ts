import { ipcMain, shell } from 'electron';
import * as path from 'node:path';
import { FILE_LIST_DIRECTORY, FILE_READ, FILE_WRITE, FILE_CREATE, FILE_DELETE, FILE_RENAME, REVEAL_IN_FILE_MANAGER, FILE_WATCH, FILE_UNWATCH, FILE_CHANGED, EXPLORER_TREE_CHANGED, EXPLORER_START_WATCHING, EXPLORER_STOP_WATCHING } from '../../shared/ipcChannels';
import type { FileListDirectoryRequest } from '../../shared/types/fileExplorer';
import type { FileReadRequest, FileWriteRequest, FileWatchRequest } from '../../shared/types/editor';
import type { FileCreateRequest, FileDeleteRequest, FileRenameRequest } from '../../shared/types/fileOperations';
import { listDirectory, readFile, writeFile, createFile, createDirectory, deleteEntry, renameEntry, resolveAndValidateWatchPath } from '../fileService';
import { toNativePath, toPosixPath } from '../../shared/pathNormalize';
import type { FileWatcherService } from '../fileWatcher';
import type { ExplorerWatcherService } from '../explorerWatcher';

export interface RegisterFileIpcDeps {
  getFileWatcher: () => FileWatcherService;
  /** Explorer watcher service for workspace tree auto-refresh. */
  getExplorerWatcher: () => ExplorerWatcherService;
}

export function registerFileIpc(deps: RegisterFileIpcDeps): void {
  const fileWatcher = deps.getFileWatcher();
  const explorerWatcher = deps.getExplorerWatcher();
  ipcMain.handle(FILE_LIST_DIRECTORY, async (_, request: FileListDirectoryRequest) => {
    const nativeRequest: FileListDirectoryRequest = {
      ...request,
      workspacePath: toNativePath(request.workspacePath, process.platform),
      directoryPath: toNativePath(request.directoryPath, process.platform),
    };
    const result = await listDirectory(nativeRequest);
    if (!result.success) {
      return result;
    }
    return {
      ...result,
      entries: result.entries.map((entry) => ({
        ...entry,
        path: toPosixPath(entry.path),
      })),
    };
  });

  ipcMain.handle(FILE_READ, async (_, request: FileReadRequest) => {
    const nativeRequest: FileReadRequest = {
      ...request,
      workspacePath: toNativePath(request.workspacePath, process.platform),
      filePath: toNativePath(request.filePath, process.platform),
    };
    return readFile(nativeRequest);
  });

  ipcMain.handle(FILE_WRITE, async (_, request: FileWriteRequest) => {
    const nativeRequest: FileWriteRequest = {
      ...request,
      workspacePath: toNativePath(request.workspacePath, process.platform),
      filePath: toNativePath(request.filePath, process.platform),
    };
    const result = await writeFile(nativeRequest);
    if (result.success) {
      fileWatcher.markWritten(nativeRequest.filePath);
    }
    return result;
  });

  ipcMain.handle(FILE_CREATE, async (_, request: FileCreateRequest) => {
    const nativeRequest: FileCreateRequest = {
      ...request,
      workspacePath: toNativePath(request.workspacePath, process.platform),
      targetPath: toNativePath(request.targetPath, process.platform),
    };
    if (nativeRequest.type === 'directory') {
      return createDirectory(nativeRequest);
    }
    return createFile(nativeRequest);
  });

  ipcMain.handle(FILE_DELETE, async (_, request: FileDeleteRequest) => {
    const nativeRequest: FileDeleteRequest = {
      ...request,
      workspacePath: toNativePath(request.workspacePath, process.platform),
      targetPath: toNativePath(request.targetPath, process.platform),
    };

    const rewatch = fileWatcher.releaseHandle(path.resolve(nativeRequest.targetPath));
    const result = await deleteEntry(nativeRequest);
    if (!result.success) {
      rewatch?.();
    }
    return result;
  });

  ipcMain.handle(FILE_RENAME, async (_, request: FileRenameRequest) => {
    const nativeRequest: FileRenameRequest = {
      ...request,
      workspacePath: toNativePath(request.workspacePath, process.platform),
      oldPath: toNativePath(request.oldPath, process.platform),
      newPath: toNativePath(request.newPath, process.platform),
    };

    const rewatch = fileWatcher.releaseHandle(path.resolve(nativeRequest.oldPath));
    const result = await renameEntry(nativeRequest);
    if (!result.success) {
      rewatch?.();
    }
    return result;
  });

  ipcMain.handle(REVEAL_IN_FILE_MANAGER, async (_, filePath: string) => {
    if (!filePath || !filePath.trim()) {
      return false;
    }

    shell.showItemInFolder(path.resolve(toNativePath(filePath, process.platform)));
    return true;
  });

  ipcMain.handle(FILE_WATCH, async (_, request: FileWatchRequest) => {
    if (!request?.workspacePath || !request.filePath) {
      return false;
    }

    const nativeRequest: FileWatchRequest = {
      ...request,
      workspacePath: toNativePath(request.workspacePath, process.platform),
      filePath: toNativePath(request.filePath, process.platform),
    };

    const validated = await resolveAndValidateWatchPath(nativeRequest.workspacePath, nativeRequest.filePath);
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
    fileWatcher.unwatchFile(path.resolve(toNativePath(request.filePath, process.platform)));
    return true;
  });

  // Event channel — registered so the integration test can verify completeness.
  // This is one-way: main sends events to renderer (no handler needed).
  ipcMain.on(FILE_CHANGED, () => { });

  ipcMain.handle(EXPLORER_START_WATCHING, (_, workspacePath: string) => {
    explorerWatcher.watchWorkspace(toNativePath(workspacePath, process.platform));
  });

  ipcMain.handle(EXPLORER_STOP_WATCHING, () => {
    explorerWatcher.close();
  });

  // Event channel — registered so the integration test can verify completeness.
  ipcMain.on(EXPLORER_TREE_CHANGED, () => { });
}
