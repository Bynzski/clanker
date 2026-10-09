import { beforeEach, describe, expect, it, vi } from 'vitest';
const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, request: unknown) => unknown>() }));
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, callback: (event: unknown, request: unknown) => unknown) => handlers.set(channel, callback), on: vi.fn() } }));
import { registerWorkspaceServiceIpc } from '../../../src/main/ipc/workspaceServiceIpc';
import type { WorkspaceServiceManager } from '../../../src/main/services/workspaceServiceManager';
import { WORKSPACE_SERVICE_SETTINGS_SAVE, WORKSPACE_SERVICE_DISCOVER, WORKSPACE_SERVICE_START, WORKSPACE_SERVICE_STOP, WORKSPACE_SERVICE_GET } from '../../../src/shared/ipcChannels';

describe('workspace service IPC boundary', () => {
  const manager = { saveSettings: vi.fn(), discover: vi.fn(), start: vi.fn(), stop: vi.fn(), snapshot: vi.fn() };
  beforeEach(() => { vi.clearAllMocks(); handlers.clear(); registerWorkspaceServiceIpc(manager as unknown as WorkspaceServiceManager); });
  it.each([null, [], {}, { workspaceId: '/repo', terminalId: 42 }, { workspaceId: 'ws', terminalId: '' }, { workspaceId: 'ws\n', terminalId: 'a' }, { workspaceId: 'w'.repeat(257), terminalId: 'a' }])('rejects malformed discovery %j before any filesystem lookup', (request) => {
    expect(handlers.get(WORKSPACE_SERVICE_DISCOVER)!(null, request)).toMatchObject({ success: false });
    expect(manager.discover).not.toHaveBeenCalled();
  });
  it.each([{}, { workspaceId: 'ws', terminalId: 'a', command: 'npm run dev' }, { workspaceId: 'ws', terminalId: 'a', checkoutContextId: 'ctx', command: 'npm\nrun dev' }])('rejects malformed start %j before spawning', (request) => {
    expect(handlers.get(WORKSPACE_SERVICE_START)!(null, request)).toMatchObject({ success: false });
    expect(manager.start).not.toHaveBeenCalled();
  });
  it('passes identity and bounded confirmation only, never renderer-selected argv/environment', () => {
    handlers.get(WORKSPACE_SERVICE_START)!(null, { workspaceId: 'ws', terminalId: 'a', checkoutContextId: 'ctx', command: 'npm run dev', cwd: '/repo', args: ['evil'], env: { TOKEN: 'evil' } });
    expect(manager.start).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'ws', terminalId: 'a', checkoutContextId: 'ctx', cwd: '/repo', command: 'npm run dev' });
    handlers.get(WORKSPACE_SERVICE_DISCOVER)!(null, { workspaceId: 'ws', terminalId: 'a' });
    expect(manager.discover).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'ws', terminalId: 'a' });
  });
  it('accepts bounded project configuration only through the validated settings route', () => {
    const request = { workspaceId: 'ws', terminalId: 'a', checkoutContextId: 'ctx', cwd: '/repo', command: 'npm run dev', settingsRevision: 'a'.repeat(64), environment: { PORT: '8788' } };
    handlers.get(WORKSPACE_SERVICE_SETTINGS_SAVE)!(null, request);
    expect(manager.saveSettings).toHaveBeenCalledExactlyOnceWith(request);
    for (const environment of [{ PATH: '/evil' }, { CLANKER_MCP_TOKEN: 'secret' }, { PORT: 42 }, { PORT: '1\n2' }, null]) {
      expect(handlers.get(WORKSPACE_SERVICE_SETTINGS_SAVE)!(null, { ...request, environment })).toMatchObject({ success: false });
    }
    expect(handlers.get(WORKSPACE_SERVICE_SETTINGS_SAVE)!(null, { ...request, settingsRevision: undefined })).toMatchObject({ success: false });
    expect(manager.saveSettings).toHaveBeenCalledTimes(1);
  });
  it('requires workspace-scoped stop and returns main-owned runtime snapshots', () => {
    expect(handlers.get(WORKSPACE_SERVICE_STOP)!(null, { serviceId: 's' })).toMatchObject({ success: false });
    handlers.get(WORKSPACE_SERVICE_STOP)!(null, { workspaceId: 'ws', serviceId: 's' });
    expect(manager.stop).toHaveBeenCalledExactlyOnceWith('ws', 's');
    handlers.get(WORKSPACE_SERVICE_GET)!(null, null);
    expect(manager.snapshot).toHaveBeenCalledOnce();
  });
});
