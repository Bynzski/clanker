import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { registerAssistantIpc } from '../../../src/main/ipc/assistantIpc';
import { ASSISTANTS_GET, ASSISTANTS_CONFIGURE, ASSISTANTS_DISCOVER, ASSISTANTS_ADD_PROFILE, ASSISTANTS_LAUNCH, ASSISTANTS_CHANGED } from '../../../src/shared/ipcChannels';
import type { AssistantService } from '../../../src/main/assistants/assistantService';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }));

function fixture() {
  const service = { get: vi.fn(), configure: vi.fn(), discover: vi.fn(), addProfile: vi.fn(), launch: vi.fn() };
  registerAssistantIpc({ getService: () => service as unknown as AssistantService });
  const handler = (channel: string) => vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1];
  return { service, handler };
}

describe('assistant IPC bridge', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([null, {}, { profileId: '../config', workspaceId: 'ws', acknowledgeExternalActivity: 'yes' }, { profileId: 'profile', workspaceId: '', acknowledgeExternalActivity: true }])('rejects a malformed launch request before reaching the service: %j', async (payload) => {
    const { handler, service } = fixture();
    await expect(Promise.resolve().then(() => handler(ASSISTANTS_LAUNCH)({} as never, payload))).rejects.toThrow('Invalid');
    expect(service.launch).not.toHaveBeenCalled();
  });
  it('whitelists opaque references and acknowledgement, never renderer commands or profile homes', async () => {
    const { handler, service } = fixture();
    await handler(ASSISTANTS_LAUNCH)({} as never, { profileId: 'profile-1', workspaceId: 'ws-1', acknowledgeExternalActivity: true, command: 'sh', env: { HERMES_HOME: '/hostile' }, cwd: '/hostile' });
    expect(service.launch).toHaveBeenCalledWith({ profileId: 'profile-1', workspaceId: 'ws-1', acknowledgeExternalActivity: true });
  });
  it('registers the canonical capability and event channels', async () => {
    const { service, handler } = fixture();
    await handler(ASSISTANTS_GET)({} as never);
    await handler(ASSISTANTS_CONFIGURE)({} as never, { enabled: false, pins: [] });
    await handler(ASSISTANTS_DISCOVER)({} as never);
    await handler(ASSISTANTS_ADD_PROFILE)({} as never, 'hermes', 'reviewer');
    expect(service.get).toHaveBeenCalledOnce();
    expect(service.configure).toHaveBeenCalledWith({ enabled: false, pins: [] });
    expect(service.discover).toHaveBeenCalledOnce();
    expect(service.addProfile).toHaveBeenCalledWith('hermes', 'reviewer');
    expect(vi.mocked(ipcMain.on).mock.calls.map(([channel]) => channel)).toContain(ASSISTANTS_CHANGED);
  });
});
