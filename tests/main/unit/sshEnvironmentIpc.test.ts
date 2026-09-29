import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import { registerSshEnvironmentIpc } from '../../../src/main/ipc/sshEnvironmentIpc';
import { SSH_ENVIRONMENT_DELETE, SSH_ENVIRONMENT_SAVE } from '../../../src/shared/ipcChannels';
import { ipcMain } from 'electron';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

const existing = { id: 'dev-vps', kind: 'ssh' as const, label: 'Dev VPS', target: 'user@old-host' };

class MemoryStore {
  private data = { sshEnvironments: [existing] };
  get(key: string): unknown { return this.data[key as keyof typeof this.data]; }
  set(key: string, value: unknown): void { (this.data as Record<string, unknown>)[key] = value; }
}

describe('SSH environment lifecycle', () => {
  let store: MemoryStore;
  let registry: WorkspaceRegistry;
  let invalidate: Mock;
  let save: (_event: unknown, config: unknown) => { success: boolean; error?: string };
  let remove: (_event: unknown, id: unknown) => { success: boolean; error?: string };

  beforeEach(async () => {
    vi.clearAllMocks();
    store = new MemoryStore();
    invalidate = vi.fn();
    registry = new WorkspaceRegistry(async () => ({
      validateWorkspacePath: async (path: string) => ({ valid: true, resolvedPath: path }),
    } as never));
    registerSshEnvironmentIpc({
      getStore: () => store as never,
      getEnvironmentManager: () => ({ invalidateSshEnvironment: invalidate }) as never,
      getWorkspaceRegistry: () => registry,
    });
    const handlers = vi.mocked(ipcMain.handle).mock.calls;
    save = handlers.find(([channel]) => channel === SSH_ENVIRONMENT_SAVE)![1] as typeof save;
    remove = handlers.find(([channel]) => channel === SSH_ENVIRONMENT_DELETE)![1] as typeof remove;
    expect((await registry.registerWorkspace({ workspaceId: 'open-remote', workspacePath: '/workspace', environmentId: existing.id })).success).toBe(true);
  });

  it('refuses editing and deleting an environment that owns an open workspace without mutating persistence or cache', () => {
    expect(save(null, { ...existing, label: 'Changed', target: 'user@new-host' })).toMatchObject({ success: false, error: expect.stringContaining('using it') });
    expect(save(null, { ...existing, id: ` ${existing.id} `, target: 'user@new-host' })).toMatchObject({ success: false, error: expect.stringContaining('using it') });
    expect(remove(null, existing.id)).toMatchObject({ success: false, error: expect.stringContaining('using it') });
    expect(remove(null, ` ${existing.id} `)).toMatchObject({ success: false, error: expect.stringContaining('using it') });
    expect(store.get('sshEnvironments')).toEqual([existing]);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('allows other environments and permits editing/deleting after the last workspace closes', () => {
    expect(save(null, { id: 'other-vps', kind: 'ssh', label: 'Other', target: 'user@other-host' }).success).toBe(true);
    expect(remove(null, 'other-vps').success).toBe(true);
    registry.unregisterWorkspace('open-remote');
    expect(save(null, { ...existing, target: 'user@new-host' }).success).toBe(true);
    expect(remove(null, existing.id).success).toBe(true);
    expect(store.get('sshEnvironments')).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith(existing.id);
  });
});
