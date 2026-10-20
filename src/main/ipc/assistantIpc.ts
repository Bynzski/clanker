import { ipcMain } from 'electron';
import type { HermesAssistantService } from '../assistants/hermesAssistantService';
import {
  ASSISTANTS_PRESENTATION, ASSISTANTS_UPDATE_PRESENTATION, ASSISTANTS_AVATAR,
  ASSISTANTS_DEFAULT_ROUTINES, ASSISTANTS_DEFAULT_ROUTINE_RUNS,
  ASSISTANTS_DETAILS, ASSISTANTS_ROUTINE_RUNS, ASSISTANTS_GET, ASSISTANTS_CONFIGURE, ASSISTANTS_REFRESH, ASSISTANTS_OPEN, ASSISTANTS_REFRESH_SESSION,
  ASSISTANTS_PTY_WRITE, ASSISTANTS_PTY_RESIZE, ASSISTANTS_CHANGED, ASSISTANTS_PTY_DATA,
} from '../../shared/ipcChannels';

/**
 * Narrow, typed bridge. There is deliberately no generic renderer→Hermes RPC or URL/token channel:
 * the renderer names a Assistant by its opaque id and main resolves profile, session and credentials.
 */
export function registerAssistantIpc(deps: { getService(): HermesAssistantService }): void {
  ipcMain.handle(ASSISTANTS_PRESENTATION, (_event, id: unknown) => deps.getService().readPresentation(id));
  ipcMain.handle(ASSISTANTS_UPDATE_PRESENTATION, (_event, id: unknown, value: unknown) => deps.getService().updatePresentation(id, value));
  ipcMain.handle(ASSISTANTS_AVATAR, (_event, id: unknown) => deps.getService().readAvatar(id));
  ipcMain.handle(ASSISTANTS_DEFAULT_ROUTINES, () => deps.getService().readDefaultRoutines());
  ipcMain.handle(ASSISTANTS_DEFAULT_ROUTINE_RUNS, (_event, jobId: unknown) => deps.getService().readDefaultRoutineRuns(jobId));
  ipcMain.handle(ASSISTANTS_DETAILS, (_event, id: unknown) => deps.getService().readDetails(id));
  ipcMain.handle(ASSISTANTS_ROUTINE_RUNS, (_event, id: unknown, jobId: unknown) => deps.getService().readRoutineRuns(id, jobId));
  ipcMain.handle(ASSISTANTS_GET, () => deps.getService().get());
  ipcMain.handle(ASSISTANTS_CONFIGURE, (_event, settings: unknown) => deps.getService().configure(settings));
  ipcMain.handle(ASSISTANTS_REFRESH, () => deps.getService().refresh());
  ipcMain.handle(ASSISTANTS_OPEN, (_event, assistantId: unknown) => deps.getService().openSurface(assistantId));
  ipcMain.handle(ASSISTANTS_REFRESH_SESSION, (_event, assistantId: unknown) => deps.getService().refreshSurface(assistantId));
  ipcMain.handle(ASSISTANTS_PTY_WRITE, (_event, assistantId: unknown, data: unknown) => { deps.getService().writePty(assistantId, data); });
  ipcMain.handle(ASSISTANTS_PTY_RESIZE, (_event, assistantId: unknown, cols: unknown, rows: unknown) => { deps.getService().resizePty(assistantId, cols, rows); });
  ipcMain.on(ASSISTANTS_CHANGED, () => { /* main → renderer notification */ });
  ipcMain.on(ASSISTANTS_PTY_DATA, () => { /* main → renderer notification */ });
}
