import { beforeEach, describe, expect, it, vi } from 'vitest';
const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, request: unknown) => unknown>() }));
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, callback: (event: unknown, request: unknown) => unknown) => handlers.set(channel, callback), on: vi.fn() } }));
vi.mock('../../../src/main/recipePreview', () => ({ probeRecipePreview: vi.fn() }));
import { probeRecipePreview } from '../../../src/main/recipePreview';
import { registerWorkspaceServiceIpc } from '../../../src/main/ipc/workspaceServiceIpc';
import type { WorkspaceServiceManager } from '../../../src/main/services/workspaceServiceManager';
import { WORKSPACE_SERVICE_SETTINGS_SAVE, WORKSPACE_SERVICE_DISCOVER, WORKSPACE_SERVICE_START, WORKSPACE_SERVICE_STOP, WORKSPACE_SERVICE_GET, WORKSPACE_SERVICE_PREVIEW_PROBE } from '../../../src/shared/ipcChannels';

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
  it('probes only the live main-owned service URL, ignoring renderer URL overrides', async () => {
    manager.snapshot.mockReturnValue({ services: [{ id: 'service', workspaceId: 'ws', status: 'running', previewUrl: 'http://127.0.0.1:5173/' }] });
    vi.mocked(probeRecipePreview).mockResolvedValue({ status: 'ready', host: '127.0.0.1', port: 5173 });
    const probe = handlers.get(WORKSPACE_SERVICE_PREVIEW_PROBE)!;
    expect(await probe(null, { workspaceId: 'ws', serviceId: 'service', url: 'http://attacker.invalid/' })).toMatchObject({ status: 'ready' });
    expect(probeRecipePreview).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:5173/', true);
    vi.mocked(probeRecipePreview).mockClear();
    expect(await probe(null, { workspaceId: 'other', serviceId: 'service' })).toEqual({ status: 'unavailable' });
    expect(await probe(null, { workspaceId: 'ws', serviceId: 'unknown' })).toEqual({ status: 'unavailable' });
    expect(await probe(null, null)).toEqual({ status: 'invalid' });
    expect(probeRecipePreview).not.toHaveBeenCalled();
  });
  it('rejects a probe completion after the service stops or its authoritative URL changes', async () => {
    const service = { id: 'service', workspaceId: 'ws', status: 'running', previewUrl: 'http://127.0.0.1:5173/' };
    manager.snapshot.mockImplementation(() => ({ services: [service] }));
    let finish!: (value: { status: 'ready'; host: string; port: number }) => void;
    vi.mocked(probeRecipePreview).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const probe = handlers.get(WORKSPACE_SERVICE_PREVIEW_PROBE)!;
    const pending = probe(null, { workspaceId: 'ws', serviceId: 'service' });
    service.previewUrl = 'http://127.0.0.1:5174/';
    finish({ status: 'ready', host: '127.0.0.1', port: 5173 });
    expect(await pending).toEqual({ status: 'unavailable' });
    service.status = 'stopped';
    vi.mocked(probeRecipePreview).mockClear();
    expect(await probe(null, { workspaceId: 'ws', serviceId: 'service' })).toEqual({ status: 'unavailable' });
    expect(probeRecipePreview).not.toHaveBeenCalled();
  });
  it('requires workspace-scoped stop and returns main-owned runtime snapshots', () => {
    expect(handlers.get(WORKSPACE_SERVICE_STOP)!(null, { serviceId: 's' })).toMatchObject({ success: false });
    handlers.get(WORKSPACE_SERVICE_STOP)!(null, { workspaceId: 'ws', serviceId: 's' });
    expect(manager.stop).toHaveBeenCalledExactlyOnceWith('ws', 's');
    handlers.get(WORKSPACE_SERVICE_GET)!(null, null);
    expect(manager.snapshot).toHaveBeenCalledOnce();
  });
});
