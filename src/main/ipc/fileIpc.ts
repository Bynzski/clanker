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
import type { WorkspaceRegistry } from '../workspaceRegistry';
import { isPathContained } from '../remote/sshEnvironment';

export interface RegisterFileIpcDeps {
  getFileWatcher: () => FileWatcherService;
  /** Explorer watcher service for workspace tree auto-refresh. */
  getExplorerWatcher: () => ExplorerWatcherService;
  getWorkspaceRegistry?: () => WorkspaceRegistry;
}

export function registerFileIpc(deps: RegisterFileIpcDeps): void {
  const fileWatcher = deps.getFileWatcher();
  const explorerWatcher = deps.getExplorerWatcher();
  const resolveWorkspace = (workspaceId?: string, workspacePath?: string) => {
    const reg = deps.getWorkspaceRegistry?.();
    if (!reg) return null;
    if (workspaceId) return reg.getWorkspace(workspaceId);
    // Legacy local callers may omit the ID, but must never resolve to an SSH
    // environment by path alone (the same path can exist on multiple hosts).
    return workspacePath ? reg.getWorkspaceByLocation('local', workspacePath) : null;
  };

  ipcMain.handle(FILE_LIST_DIRECTORY, async (_, request: FileListDirectoryRequest & { workspaceId?: string }) => {
    const ws = resolveWorkspace(request.workspaceId, request.workspacePath);
    if (request.workspaceId && !ws) return { success: false, entries: [], errorCode: 'invalid-path', error: 'Workspace is not registered' };
    if (ws && ws.location.environmentId !== 'local') {
      return ws.environment.listDirectory({ ...request, workspacePath: ws.location.path });
    }

    const nativeRequest: FileListDirectoryRequest = {
      workspacePath: toNativePath(ws?.location.path ?? request.workspacePath, process.platform),
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

  ipcMain.handle(FILE_READ, async (_, request: FileReadRequest & { workspaceId?: string }) => {
    const ws = resolveWorkspace(request.workspaceId, request.workspacePath);
    if (request.workspaceId && !ws) return { success: false, errorCode: 'invalid-path', error: 'Workspace is not registered' };
    if (ws && ws.location.environmentId !== 'local') {
      return ws.environment.readFile({ ...request, workspacePath: ws.location.path });
    }

    const nativeRequest: FileReadRequest = {
      ...request,
      workspacePath: toNativePath(ws?.location.path ?? request.workspacePath, process.platform),
      filePath: toNativePath(request.filePath, process.platform),
    };
    return readFile(nativeRequest);
  });

  ipcMain.handle(FILE_WRITE, async (_, request: FileWriteRequest & { workspaceId?: string }) => {
    const ws = resolveWorkspace(request.workspaceId, request.workspacePath);
    if (request.workspaceId && !ws) return { success: false, errorCode: 'invalid-path', error: 'Workspace is not registered' };
    if (ws && ws.location.environmentId !== 'local') {
      return ws.environment.writeFile({ ...request, workspacePath: ws.location.path });
    }

    const nativeRequest: FileWriteRequest = {
      ...request,
      workspacePath: toNativePath(ws?.location.path ?? request.workspacePath, process.platform),
      filePath: toNativePath(request.filePath, process.platform),
    };
    const result = await writeFile(nativeRequest);
    if (result.success) {
      fileWatcher.markWritten(nativeRequest.filePath);
    }
    return result;
  });

  ipcMain.handle(FILE_CREATE, async (_, request: FileCreateRequest & { workspaceId?: string }) => {
    const ws = resolveWorkspace(request.workspaceId, request.workspacePath);
    if (request.workspaceId && !ws) return { success: false, error: 'Workspace is not registered' };
    if (ws && ws.location.environmentId !== 'local') {
      const scopedRequest = { ...request, workspacePath: ws.location.path };
      return request.type === 'directory'
        ? ws.environment.createDirectory(scopedRequest)
        : ws.environment.createFile(scopedRequest);
    }
    const nativeRequest: FileCreateRequest = {
      ...request,
      workspacePath: toNativePath(ws?.location.path ?? request.workspacePath, process.platform),
      targetPath: toNativePath(request.targetPath, process.platform),
    };
    if (nativeRequest.type === 'directory') {
      return createDirectory(nativeRequest);
    }
    return createFile(nativeRequest);
  });

  ipcMain.handle(FILE_DELETE, async (_, request: FileDeleteRequest & { workspaceId?: string }) => {
    const ws = resolveWorkspace(request.workspaceId, request.workspacePath);
    if (request.workspaceId && !ws) return { success: false, error: 'Workspace is not registered' };
    if (ws && ws.location.environmentId !== 'local') {
      return ws.environment.deleteEntry({ ...request, workspacePath: ws.location.path });
    }

    const nativeRequest: FileDeleteRequest = {
      ...request,
      workspacePath: toNativePath(ws?.location.path ?? request.workspacePath, process.platform),
      targetPath: toNativePath(request.targetPath, process.platform),
    };
    const rewatch = fileWatcher.releaseHandle(nativeRequest.targetPath);
    const result = await deleteEntry(nativeRequest);
    if (!result.success) {
      rewatch?.();
    }
    return result;
  });

  ipcMain.handle(FILE_RENAME, async (_, request: FileRenameRequest & { workspaceId?: string }) => {
    const ws = resolveWorkspace(request.workspaceId, request.workspacePath);
    if (request.workspaceId && !ws) return { success: false, error: 'Workspace is not registered' };
    if (ws && ws.location.environmentId !== 'local') {
      return ws.environment.renameEntry({ ...request, workspacePath: ws.location.path });
    }

    const nativeRequest: FileRenameRequest = {
      ...request,
      workspacePath: toNativePath(ws?.location.path ?? request.workspacePath, process.platform),
      oldPath: toNativePath(request.oldPath, process.platform),
      newPath: toNativePath(request.newPath, process.platform),
    };
    const rewatch = fileWatcher.releaseHandle(nativeRequest.oldPath);
    const result = await renameEntry(nativeRequest);
    if (!result.success) {
      rewatch?.();
    }
    return result;
  });

  ipcMain.handle(REVEAL_IN_FILE_MANAGER, async (_, filePath: string, workspaceId?: string) => {
    if (!filePath || !filePath.trim()) return false;
    const reg = deps.getWorkspaceRegistry?.();
    if (workspaceId && reg) {
      const workspace = reg.getWorkspace(workspaceId);
      if (!workspace || workspace.location.environmentId !== 'local') return false;
    } else if (reg?.getAllWorkspaces().some(
      (w) => w.location.environmentId !== 'local' && isPathContained(w.location.path, filePath)
    )) {
      return false;
    }
    shell.showItemInFolder(path.resolve(toNativePath(filePath, process.platform)));
    return true;
  });

  ipcMain.handle(FILE_WATCH, async (_, request: FileWatchRequest & { workspaceId?: string }) => {
    if (!request?.workspacePath || !request.filePath) {
      return false;
    }

    const ws = resolveWorkspace(request.workspaceId, request.workspacePath);
    if (request.workspaceId && !ws) return false;
    if (ws && ws.location.environmentId !== 'local') return false;

    const nativeRequest: FileWatchRequest = {
      ...request,
      workspacePath: toNativePath(ws?.location.path ?? request.workspacePath, process.platform),
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
    const reg = deps.getWorkspaceRegistry?.();
    if (reg?.getAllWorkspaces().some(
      (w) => w.location.environmentId !== 'local' && (w.location.path === workspacePath || isPathContained(w.location.path, workspacePath))
    )) {
      return;
    }
    explorerWatcher.watchWorkspace(toNativePath(workspacePath, process.platform));
  });

  ipcMain.handle(EXPLORER_STOP_WATCHING, () => {
    explorerWatcher.close();
  });

  // Event channel — registered so the integration test can verify completeness.
  ipcMain.on(EXPLORER_TREE_CHANGED, () => { });
}
