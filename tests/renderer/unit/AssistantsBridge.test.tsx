import { beforeEach, expect, it, vi } from 'vitest';
import type { ElectronAPI } from '../../../src/renderer/electron';
import { ASSISTANTS_GET, ASSISTANTS_CONFIGURE, ASSISTANTS_DISCOVER, ASSISTANTS_ADD_PROFILE, ASSISTANTS_LAUNCH, ASSISTANTS_CHANGED } from '../../../src/shared/ipcChannels';

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn().mockResolvedValue(undefined), on: vi.fn(), removeListener: vi.fn() },
  webFrame: {}, webUtils: {},
}));
vi.mock('electron', () => electron);
beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

it('bridges only canonical Assistants channels and releases the exact changed listener', async () => {
  await import('../../../src/main/preload');
  const api = electron.contextBridge.exposeInMainWorld.mock.calls[0][1] as ElectronAPI;
  expect(api.getAssistants).toBeTypeOf('function');
  await api.getAssistants();
  await api.configureAssistants({ enabled: true, pins: [] });
  await api.discoverAssistants();
  await api.addAssistantProfile('hermes', 'research');
  const request = { profileId: 'opaque', workspaceId: 'owner', acknowledgeExternalActivity: true };
  await api.launchAssistant(request);
  expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
    [ASSISTANTS_GET], [ASSISTANTS_CONFIGURE, { enabled: true, pins: [] }],
    [ASSISTANTS_DISCOVER], [ASSISTANTS_ADD_PROFILE, 'hermes', 'research'], [ASSISTANTS_LAUNCH, request],
  ]);
  const callback = vi.fn();
  const unsubscribe = api.onAssistantsChanged(callback);
  const [channel, handler] = electron.ipcRenderer.on.mock.calls[0];
  expect(channel).toBe(ASSISTANTS_CHANGED);
  const snapshot = { settings: { enabled: false, pins: [] }, profiles: [], launches: [], externalActivity: 'unknown' };
  handler({}, snapshot);
  expect(callback).toHaveBeenCalledWith(snapshot);
  unsubscribe();
  expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(ASSISTANTS_CHANGED, handler);
});
