import { ipcMain } from 'electron';
import type { AssistantService } from '../assistants/assistantService';
import type { AssistantLaunchRequest } from '../../shared/types/assistants';
import { ASSISTANTS_GET, ASSISTANTS_CONFIGURE, ASSISTANTS_DISCOVER, ASSISTANTS_ADD_PROFILE, ASSISTANTS_LAUNCH, ASSISTANTS_CHANGED } from '../../shared/ipcChannels';

export function registerAssistantIpc(deps: { getService(): AssistantService }): void {
  ipcMain.handle(ASSISTANTS_GET, () => deps.getService().get());
  ipcMain.handle(ASSISTANTS_CONFIGURE, (_event, settings: unknown) => deps.getService().configure(settings));
  ipcMain.handle(ASSISTANTS_DISCOVER, (_event, options?: unknown) => deps.getService().discover(
    options && typeof options === 'object' && (options as { ifUnchecked?: unknown }).ifUnchecked === true ? { ifUnchecked: true } : undefined,
  ));
  ipcMain.handle(ASSISTANTS_ADD_PROFILE, (_event, harnessId: string, profileName: string) => deps.getService().addProfile(harnessId, profileName));
  ipcMain.handle(ASSISTANTS_LAUNCH, (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid assistant launch request');
    const request = value as Partial<AssistantLaunchRequest>;
    const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 256 && /^[A-Za-z0-9_-]+$/.test(id);
    if (!validId(request.profileId) || !validId(request.workspaceId) || typeof request.acknowledgeExternalActivity !== 'boolean') throw new Error('Invalid assistant launch request');
    return deps.getService().launch({ profileId: request.profileId, workspaceId: request.workspaceId, acknowledgeExternalActivity: request.acknowledgeExternalActivity });
  });
  ipcMain.on(ASSISTANTS_CHANGED, () => { /* main → renderer notification */ });
}
