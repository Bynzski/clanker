import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HARNESS_ACCOUNTS_CHANGED, SSH_ENVIRONMENT_INVALIDATED } from '../../../src/shared/ipcChannels';
import type { ElectronAPI } from '../../../src/renderer/electron';

const bridge = vi.hoisted(() => ({
  exposed: undefined as unknown,
  on: vi.fn(), removeListener: vi.fn(), invoke: vi.fn(), send: vi.fn(),
}));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (_name: string, api: unknown) => { bridge.exposed = api; } },
  ipcRenderer: { on: bridge.on, removeListener: bridge.removeListener, invoke: bridge.invoke, send: bridge.send },
}));
import '../../../src/main/preload';

beforeEach(() => { bridge.on.mockClear(); bridge.removeListener.mockClear(); });
describe('Usage preload event bridge', () => {
  it.each([
    ['onHarnessAccountsChanged', HARNESS_ACCOUNTS_CHANGED, { type: 'selected', environmentId: 'local', harness: 'codex', accountId: 'a' }],
    ['onSshEnvironmentInvalidated', SSH_ENVIRONMENT_INVALIDATED, { environmentId: 'ssh-1', environmentGeneration: 8 }],
  ] as const)('%s forwards payload and removes the exact registered handler', (method, channel, payload) => {
    const api = bridge.exposed as ElectronAPI;
    const callback = vi.fn();
    const dispose = api[method](callback);
    expect(bridge.on).toHaveBeenCalledExactlyOnceWith(channel, expect.any(Function));
    const handler = bridge.on.mock.calls[0][1] as (event: unknown, data: unknown) => void;
    handler({ sender: 'not exposed' }, payload);
    expect(callback).toHaveBeenCalledExactlyOnceWith(payload);
    dispose();
    expect(bridge.removeListener).toHaveBeenCalledExactlyOnceWith(channel, handler);
  });
});
