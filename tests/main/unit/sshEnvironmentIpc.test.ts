import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import { EnvironmentManager } from '../../../src/main/environment/environmentManager';
import { SshCommandExecutor } from '../../../src/main/remote/sshCommandExecutor';
import { registerSshEnvironmentIpc } from '../../../src/main/ipc/sshEnvironmentIpc';
import {
  SSH_ENVIRONMENT_DELETE, SSH_ENVIRONMENT_SAVE, SSH_GET_HOME_DIRECTORY, SSH_LIST_DIRECTORIES,
  SSH_CREATE_DIRECTORY,
} from '../../../src/shared/ipcChannels';
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
    expect(save(null, { ...existing, defaultWorkspaceRoot: '/srv/repos' })).toMatchObject({ success: false, error: expect.stringContaining('using it') });
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

describe('pre-workspace SSH browse IPC', () => {
  it('only accepts saved SSH IDs and forwards bounded read-only Python calls', async () => {
    vi.clearAllMocks();
    const store = new MemoryStore();
    const exec = vi.fn()
      .mockResolvedValueOnce({ stdout: '{"homePath":"/home/dev","initialPath":"/home/dev/workspaces"}' })
      .mockResolvedValueOnce({ stdout: '{"path":"/home/dev/workspaces","parentPath":"/home/dev","directories":[]}' })
      .mockResolvedValueOnce({ stdout: '{"path":"/home/dev/workspaces/project"}' });
    const manager = new EnvironmentManager(() => store as never, { exec } as unknown as SshCommandExecutor);
    registerSshEnvironmentIpc({
      getStore: () => store as never,
      getEnvironmentManager: () => manager,
      getWorkspaceRegistry: () => new WorkspaceRegistry(async () => null),
    });
    const handlers = vi.mocked(ipcMain.handle).mock.calls;
    const getHome = handlers.find(([channel]) => channel === SSH_GET_HOME_DIRECTORY)![1] as
      (_event: unknown, id: unknown) => Promise<unknown>;
    const list = handlers.find(([channel]) => channel === SSH_LIST_DIRECTORIES)![1] as
      (_event: unknown, id: unknown, path: unknown) => Promise<unknown>;
    const create = handlers.find(([channel]) => channel === SSH_CREATE_DIRECTORY)![1] as
      (_event: unknown, id: unknown, parent: unknown, name: unknown) => Promise<unknown>;
    for (const id of ['local', 'unknown', '', 'dev-vps; touch /tmp/injected', null, {}]) {
      await expect(getHome(null, id)).rejects.toThrow('Unknown SSH environment');
      await expect(list(null, id, '/tmp')).rejects.toThrow('Unknown SSH environment');
      await expect(create(null, id, '/tmp', 'new')).rejects.toThrow('Unknown SSH environment');
    }
    expect(exec).not.toHaveBeenCalled();
    expect(await getHome(null, existing.id)).toEqual({
      homePath: '/home/dev', initialPath: '/home/dev/workspaces',
    });
    await expect(list(null, existing.id, null)).rejects.toThrow('Invalid remote directory path');
    expect(await list(null, existing.id, '/home/dev/workspaces')).toEqual({
      path: '/home/dev/workspaces', parentPath: '/home/dev', directories: [],
    });
    await expect(create(null, existing.id, null, 'project')).rejects.toThrow('Invalid directory creation request');
    await expect(create(null, existing.id, '/home/dev/workspaces', null)).rejects.toThrow('Invalid directory creation request');
    expect(await create(null, existing.id, '/home/dev/workspaces', 'project')).toEqual({
      path: '/home/dev/workspaces/project',
    });
    expect(exec).toHaveBeenCalledTimes(3);
    expect(exec).toHaveBeenNthCalledWith(1, existing.target, 'python3',
      ['-c', expect.any(String)], { timeoutMs: 12000, maxBuffer: 128 * 1024 });
    expect(exec).toHaveBeenNthCalledWith(2, existing.target, 'python3',
      ['-c', expect.any(String), '/home/dev/workspaces'], { timeoutMs: 12000, maxBuffer: 128 * 1024 });
    expect(exec).toHaveBeenNthCalledWith(3, existing.target, 'python3',
      ['-c', expect.any(String), '/home/dev/workspaces', 'project'], { timeoutMs: 12000, maxBuffer: 128 * 1024 });
  });
});
