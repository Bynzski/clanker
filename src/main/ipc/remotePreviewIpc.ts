import { ipcMain } from 'electron';
import { REMOTE_PREVIEW_GET, REMOTE_PREVIEW_START, REMOTE_PREVIEW_STOP, REMOTE_PREVIEW_CHANGED } from '../../shared/ipcChannels';
import type { RemotePreviewManager } from '../remote/remotePreviewManager';
import type { RemotePreviewRequest } from '../../shared/types/remotePreview';

export function registerRemotePreviewIpc(manager: RemotePreviewManager): void {
  ipcMain.on(REMOTE_PREVIEW_CHANGED, () => { });
  ipcMain.handle(REMOTE_PREVIEW_GET, (_, request: unknown) => {
    if (!request || typeof request !== 'object' || !('workspaceId' in request) || typeof request.workspaceId !== 'string') return null;
    return manager.get(request.workspaceId);
  });
  ipcMain.handle(REMOTE_PREVIEW_START, (_, request: RemotePreviewRequest) => manager.start(request));
  ipcMain.handle(REMOTE_PREVIEW_STOP, async (_, request: unknown) => {
    if (!request || typeof request !== 'object' || !('workspaceId' in request) || typeof request.workspaceId !== 'string') return false;
    await manager.stop(request.workspaceId);
    return true;
  });
}
