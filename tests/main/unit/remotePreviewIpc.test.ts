import { beforeEach, expect, it, vi } from 'vitest';
const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
vi.mock('electron', () => ({ ipcMain: { on: vi.fn(), handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler) } }));
import { registerRemotePreviewIpc } from '../../../src/main/ipc/remotePreviewIpc';
import { REMOTE_PREVIEW_GET, REMOTE_PREVIEW_WATCH, REMOTE_PREVIEW_STOP } from '../../../src/shared/ipcChannels';
import type { RemotePreviewManager } from '../../../src/main/remote/remotePreviewManager';
const manager = { snapshot: vi.fn().mockReturnValue({ workspaceId: 'ws', services: [], forwards: [] }), stop: vi.fn().mockResolvedValue(undefined),
  discovery: { setConsumer: vi.fn().mockReturnValue(true), refresh: vi.fn() } };
beforeEach(() => { vi.clearAllMocks(); registerRemotePreviewIpc(manager as unknown as RemotePreviewManager); });
it('validates consumer requests and refreshes only an accepted active lease', () => {
  const watch = handlers.get(REMOTE_PREVIEW_WATCH)!;
  for (const request of [null, {}, { workspaceId: 'ws', consumerId: 'token', enabled: 'yes' }, { workspaceId: 'ws', consumerId: 'token', enabled: true, refresh: 1 }]) expect(watch({}, request)).toBeNull();
  expect(manager.discovery.setConsumer).not.toHaveBeenCalled();
  expect(watch({}, { workspaceId: 'ws', consumerId: 'browser', enabled: true, refresh: true })).toEqual(expect.objectContaining({ services: [] }));
  expect(manager.discovery.refresh).toHaveBeenCalledExactlyOnceWith('ws');
  manager.discovery.setConsumer.mockReturnValueOnce(false);
  expect(watch({}, { workspaceId: 'gone', consumerId: 'browser', enabled: true })).toBeNull();
});
it('validates selected-service cleanup and returns a multi-service snapshot', async () => {
  expect(handlers.get(REMOTE_PREVIEW_GET)!({}, null)).toBeNull();
  expect(handlers.get(REMOTE_PREVIEW_GET)!({}, { workspaceId: 'ws' })).toEqual(expect.objectContaining({ forwards: [] }));
  expect(await handlers.get(REMOTE_PREVIEW_STOP)!({}, { workspaceId: 'ws', serviceId: 3 })).toBe(false);
  expect(await handlers.get(REMOTE_PREVIEW_STOP)!({}, { workspaceId: 'ws', serviceId: 'selected' })).toBe(true);
  expect(manager.stop).toHaveBeenCalledExactlyOnceWith('ws', 'selected');
});
