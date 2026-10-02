import { ipcMain } from 'electron';
import { REMOTE_PREVIEW_WATCH, REMOTE_PREVIEW_GET, REMOTE_PREVIEW_START, REMOTE_PREVIEW_STOP, REMOTE_PREVIEW_CHANGED } from '../../shared/ipcChannels';
import type { RemotePreviewManager } from '../remote/remotePreviewManager';
import type { RemotePreviewRequest } from '../../shared/types/remotePreview';

export function registerRemotePreviewIpc(manager: RemotePreviewManager): void {
  ipcMain.on(REMOTE_PREVIEW_CHANGED, () => { });
  ipcMain.handle(REMOTE_PREVIEW_GET, (_, request: unknown) => {
    if (!request || typeof request !== 'object' || !('workspaceId' in request) || typeof request.workspaceId !== 'string') return null;
    return manager.snapshot(request.workspaceId);
  });
  ipcMain.handle(REMOTE_PREVIEW_WATCH, (_, request: unknown) => {
    if (!request || typeof request !== 'object' || !('workspaceId' in request) || typeof request.workspaceId !== 'string'
      || !('consumerId' in request) || typeof request.consumerId !== 'string' || !('enabled' in request) || typeof request.enabled !== 'boolean'
      || ('refresh' in request && typeof request.refresh !== 'boolean')) return null;
    if (!manager.discovery.setConsumer(request.workspaceId, request.consumerId, request.enabled)) return null;
    if (request.enabled && 'refresh' in request && request.refresh) manager.discovery.refresh(request.workspaceId);
    return manager.snapshot(request.workspaceId);
  });
  ipcMain.handle(REMOTE_PREVIEW_START, (_, request: RemotePreviewRequest) => manager.start(request));
  ipcMain.handle(REMOTE_PREVIEW_STOP, async (_, request: unknown) => {
    if (!request || typeof request !== 'object' || !('workspaceId' in request) || typeof request.workspaceId !== 'string') return false;
    const serviceId = 'serviceId' in request ? request.serviceId : undefined;
    if (serviceId !== undefined && (typeof serviceId !== 'string' || serviceId.length > 256)) return false;
    await manager.stop(request.workspaceId, serviceId);
    return true;
  });
}
