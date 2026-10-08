import { ipcMain } from 'electron';
import { WORKSPACE_SERVICE_SETTINGS_SAVE, WORKSPACE_SERVICE_DISCOVER, WORKSPACE_SERVICE_START, WORKSPACE_SERVICE_STOP, WORKSPACE_SERVICE_GET, WORKSPACE_SERVICE_CHANGED } from '../../shared/ipcChannels';
import type { WorkspaceServiceManager } from '../services/workspaceServiceManager';
import { validateDevServiceEnvironment } from '../../shared/devServiceEnvironment';

export function registerWorkspaceServiceIpc(manager: WorkspaceServiceManager): void {
  const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
  const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
  const invalid = () => ({ success: false, error: 'Invalid dev service request' });
  // Push-only; inbound messages cannot change service state.
  ipcMain.on(WORKSPACE_SERVICE_CHANGED, () => {});
  ipcMain.handle(WORKSPACE_SERVICE_GET, () => manager.snapshot());
  ipcMain.handle(WORKSPACE_SERVICE_DISCOVER, (_event, request: unknown) => {
    if (!record(request) || !text(request.workspaceId) || !text(request.terminalId)) return invalid();
    return manager.discover({ workspaceId: request.workspaceId, terminalId: request.terminalId });
  });
  ipcMain.handle(WORKSPACE_SERVICE_START, (_event, request: unknown) => {
    if (!record(request) || !text(request.workspaceId) || !text(request.terminalId) || !text(request.checkoutContextId) || !text(request.command)
      || typeof request.cwd !== 'string' || request.cwd.length > 4096 || !request.cwd || /[\u0000-\u001f\u007f]/.test(request.cwd)) return invalid();
    if (request.settingsRevision !== undefined && (typeof request.settingsRevision !== 'string' || !/^[a-f0-9]{64}$/.test(request.settingsRevision))) return invalid();
    return manager.start({ workspaceId: request.workspaceId, terminalId: request.terminalId, checkoutContextId: request.checkoutContextId, cwd: request.cwd, command: request.command,
      ...(request.settingsRevision !== undefined ? { settingsRevision: request.settingsRevision } : {}) });
  });
  ipcMain.handle(WORKSPACE_SERVICE_SETTINGS_SAVE, (_event, request: unknown) => {
    if (!record(request) || !text(request.workspaceId) || !text(request.terminalId) || !text(request.checkoutContextId) || !text(request.command)
      || typeof request.cwd !== 'string' || !request.cwd || request.cwd.length > 4096 || /[\u0000-\u001f\u007f]/.test(request.cwd)
      || typeof request.settingsRevision !== 'string' || !/^[a-f0-9]{64}$/.test(request.settingsRevision)) return invalid();
    try {
      const environment = validateDevServiceEnvironment(request.environment);
      return manager.saveSettings({ workspaceId: request.workspaceId, terminalId: request.terminalId, checkoutContextId: request.checkoutContextId,
        cwd: request.cwd, command: request.command, settingsRevision: request.settingsRevision, environment });
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Invalid dev server settings' }; }
  });
  ipcMain.handle(WORKSPACE_SERVICE_STOP, (_event, request: unknown) => {
    if (!record(request) || !text(request.workspaceId) || !text(request.serviceId)) return invalid();
    return manager.stop(request.workspaceId, request.serviceId);
  });
}
