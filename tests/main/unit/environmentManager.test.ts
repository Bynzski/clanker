import { describe, expect, it, vi } from 'vitest';
import type Store from 'electron-store';
import type { StoreSchema } from '../../../src/shared/types/store';
import { EnvironmentManager } from '../../../src/main/environment/environmentManager';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import type { SshCommandExecutor } from '../../../src/main/remote/sshCommandExecutor';

function fixture() {
  const configs = [{ id: 'a', kind: 'ssh', label: 'A', target: 'alias-a' }, { id: 'b', kind: 'ssh', label: 'B', target: 'alias-b' }];
  const store = { get: () => configs } as unknown as Store<StoreSchema>;
  const resolveIdentity = vi.fn().mockResolvedValue('ssh:resolved-endpoint');
  const executor = { exec: vi.fn().mockResolvedValue({ stdout: '/repo', stderr: '', exitCode: 0 }) } as unknown as SshCommandExecutor;
  return { manager: new EnvironmentManager(() => store, executor, resolveIdentity), resolveIdentity, configs };
}
describe('environment resource resolution', () => {
  it('owns monotonic SSH incarnations across reconfiguration/deletion/recreation; local stays stable', async () => {
    const f = fixture();
    expect(f.manager.getEnvironmentGeneration('a')).toBe(0);
    const first = await f.manager.getEnvironment('a');
    f.manager.invalidateSshEnvironment('a');
    f.configs.splice(0, 1);
    f.manager.invalidateSshEnvironment('a');
    f.configs.push({ id: 'a', kind: 'ssh', label: 'New A', target: 'new-a' });
    f.manager.invalidateSshEnvironment('a');
    expect(f.manager.getEnvironmentGeneration('a')).toBe(3);
    expect(await f.manager.getEnvironment('a')).not.toBe(first);
    expect(f.manager.getEnvironmentGeneration('local')).toBe(0);
    // A main-process restart creates a new manager AND a fresh renderer store.
    expect(fixture().manager.getEnvironmentGeneration('a')).toBe(0);
  });
  it('protects same-host aliases while preserving environment-scoped workspace identity', async () => {
    const f = fixture();
    const registry = new WorkspaceRegistry(id => f.manager.getEnvironment(id));
    await registry.registerWorkspace({ workspaceId: 'a', environmentId: 'a', workspacePath: '/repo' });
    const release = registry.reserveRemotePaths('a', ['/repo/task'])!;
    expect(await registry.registerWorkspace({ workspaceId: 'b', environmentId: 'b', workspacePath: '/repo/task' })).toMatchObject({ success: false });
    release();
    expect(await registry.registerWorkspace({ workspaceId: 'b', environmentId: 'b', workspacePath: '/repo' })).toMatchObject({ success: true });
    expect(registry.getWorkspaceByLocation('a', '/repo')?.workspaceId).toBe('a');
    expect(registry.getWorkspaceByLocation('b', '/repo')?.workspaceId).toBe('b');
  });
  it('shares concurrent resolution and does not cache an invalidated configuration', async () => {
    const f = fixture();
    let finish!: (value: string) => void;
    f.resolveIdentity.mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; }));
    const first = f.manager.getEnvironment('a');
    const second = f.manager.getEnvironment('a');
    expect(f.resolveIdentity).toHaveBeenCalledTimes(1);
    f.manager.invalidateSshEnvironment('a');
    f.configs[0].target = 'new-alias';
    const newer = await f.manager.getEnvironment('a');
    finish('ssh:old-endpoint');
    expect(await first).toBe(await second);
    expect(await f.manager.getEnvironment('a')).toBe(newer);
    expect(f.resolveIdentity).toHaveBeenLastCalledWith('new-alias');
  });

  it('does not move a restored reservation to a different host when external SSH configuration changes', async () => {
    const f = fixture();
    const registry = new WorkspaceRegistry(id => f.manager.getEnvironment(id));
    const release = registry.reserveRemotePaths('a', ['/repo/task'], 'ssh:old-host')!;
    f.resolveIdentity.mockResolvedValueOnce('ssh:new-host');
    await registry.registerWorkspace({ workspaceId: 'a', environmentId: 'a', workspacePath: '/repo' });
    f.resolveIdentity.mockResolvedValueOnce('ssh:old-host');
    expect(await registry.registerWorkspace({ workspaceId: 'b', environmentId: 'b', workspacePath: '/repo/task' })).toMatchObject({ success: false });
    expect(registry.isRemotePathReserved('a', '/repo/task')).toBe(true);
    expect(registry.isEnvironmentInUse('a')).toBe(true);
    release();
  });
});
