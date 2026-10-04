import { ipcMain } from 'electron';
import type { HermesAssistantService } from '../assistants/hermesAssistantService';
import {
  ASSISTANTS_GET, ASSISTANTS_CONFIGURE, ASSISTANTS_REFRESH, ASSISTANTS_OPEN,
  ASSISTANTS_PTY_WRITE, ASSISTANTS_PTY_RESIZE, ASSISTANTS_CHANGED, ASSISTANTS_PTY_DATA,
} from '../../shared/ipcChannels';

/**
 * Narrow, typed bridge. There is deliberately no generic renderer→Hermes RPC or URL/token channel:
 * the renderer names a Assistant by its opaque id and main resolves profile, session and credentials.
 */
export function registerAssistantIpc(deps: { getService(): HermesAssistantService }): void {
  ipcMain.handle(ASSISTANTS_GET, () => deps.getService().get());
  ipcMain.handle(ASSISTANTS_CONFIGURE, (_event, settings: unknown) => deps.getService().configure(settings));
  ipcMain.handle(ASSISTANTS_REFRESH, () => deps.getService().refresh());
  ipcMain.handle(ASSISTANTS_OPEN, (_event, assistantId: unknown) => deps.getService().openSurface(assistantId));
  ipcMain.handle(ASSISTANTS_PTY_WRITE, (_event, assistantId: unknown, data: unknown) => { deps.getService().writePty(assistantId, data); });
  ipcMain.handle(ASSISTANTS_PTY_RESIZE, (_event, assistantId: unknown, cols: unknown, rows: unknown) => { deps.getService().resizePty(assistantId, cols, rows); });
  ipcMain.on(ASSISTANTS_CHANGED, () => { /* main → renderer notification */ });
  ipcMain.on(ASSISTANTS_PTY_DATA, () => { /* main → renderer notification */ });
}
