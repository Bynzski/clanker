import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { registerAssistantIpc } from '../../../src/main/ipc/assistantIpc';
import * as channels from '../../../src/shared/ipcChannels';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }));

function fixture() {
  vi.mocked(ipcMain.handle).mockReset();
  vi.mocked(ipcMain.on).mockReset();
  const service = { readPresentation: vi.fn(), updatePresentation: vi.fn(), readAvatar: vi.fn(), readDefaultRoutines: vi.fn(), readDefaultRoutineRuns: vi.fn(), readDetails: vi.fn(), readRoutineRuns: vi.fn(), get: vi.fn(), configure: vi.fn(), refresh: vi.fn(), openSurface: vi.fn(), refreshSurface: vi.fn(), writePty: vi.fn(), resizePty: vi.fn() };
  registerAssistantIpc({ getService: () => service as never });
  const handler = (channel: string) => vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1] as (...args: unknown[]) => unknown;
  return { service, handler };
}

describe('Assistants IPC', () => {
  beforeEach(() => vi.clearAllMocks());
  it('exposes exactly the narrow Assistant surface and no generic Hermes RPC, URL or token channel', () => {
    fixture();
    const handled = vi.mocked(ipcMain.handle).mock.calls.map(([name]) => name).sort();
    expect(handled).toEqual([
      channels.ASSISTANTS_PRESENTATION, channels.ASSISTANTS_UPDATE_PRESENTATION, channels.ASSISTANTS_AVATAR,
      channels.ASSISTANTS_DEFAULT_ROUTINES, channels.ASSISTANTS_DEFAULT_ROUTINE_RUNS,
      channels.ASSISTANTS_GET, channels.ASSISTANTS_CONFIGURE, channels.ASSISTANTS_REFRESH, channels.ASSISTANTS_OPEN,
      channels.ASSISTANTS_REFRESH_SESSION,
      channels.ASSISTANTS_PTY_WRITE, channels.ASSISTANTS_PTY_RESIZE, channels.ASSISTANTS_DETAILS, channels.ASSISTANTS_ROUTINE_RUNS,
    ].sort());
    expect((Object.values(channels).filter((value) => typeof value === 'string') as string[]).filter((value) => value.startsWith('assistants:')).sort())
      .toEqual([...handled, channels.ASSISTANTS_CHANGED, channels.ASSISTANTS_PTY_DATA].sort());
    expect(Object.keys(channels).some((key) => /ASSISTANTS_(LAUNCH|ADD_PROFILE|DISCOVER|RPC|TOKEN|URL)/.test(key))).toBe(false);
  });
  it('delegates with renderer values untouched so main validates them', () => {
    const { service, handler } = fixture();
    handler(channels.ASSISTANTS_PRESENTATION)({}, 'hermes:fred');
    handler(channels.ASSISTANTS_AVATAR)({}, 'hermes:fred');
    const cosmetics = { title: 'Fred', tagline: 'Cosmetic', editToken: 'opaque' };
    handler(channels.ASSISTANTS_UPDATE_PRESENTATION)({}, 'hermes:fred', cosmetics);
    expect(service.readPresentation).toHaveBeenCalledWith('hermes:fred');
    expect(service.readAvatar).toHaveBeenCalledWith('hermes:fred');
    expect(service.updatePresentation).toHaveBeenCalledWith('hermes:fred', cosmetics);
    handler(channels.ASSISTANTS_DEFAULT_ROUTINES)({}, 'ignored-profile');
    handler(channels.ASSISTANTS_DEFAULT_ROUTINE_RUNS)({}, 'job_1', 'ignored-profile');
    expect(service.readDefaultRoutines).toHaveBeenCalledWith();
    expect(service.readDefaultRoutineRuns).toHaveBeenCalledWith('job_1');
    handler(channels.ASSISTANTS_CONFIGURE)({}, { enabled: true, autoStart: false });
    handler(channels.ASSISTANTS_OPEN)({}, 'hermes:fred');
    handler(channels.ASSISTANTS_REFRESH_SESSION)({}, 'hermes:fred');
    handler(channels.ASSISTANTS_PTY_WRITE)({}, 'hermes:fred', 'x');
    handler(channels.ASSISTANTS_PTY_RESIZE)({}, 'hermes:fred', 80, 24);
    expect(service.configure).toHaveBeenCalledWith({ enabled: true, autoStart: false });
    expect(service.openSurface).toHaveBeenCalledWith('hermes:fred');
    expect(service.refreshSurface).toHaveBeenCalledWith('hermes:fred');
    expect(service.writePty).toHaveBeenCalledWith('hermes:fred', 'x');
    expect(service.resizePty).toHaveBeenCalledWith('hermes:fred', 80, 24);
  });
});
