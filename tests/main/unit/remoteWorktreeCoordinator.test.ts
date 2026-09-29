import { describe, expect, it, vi } from 'vitest';
import { RemoteWorktreeCoordinator } from '../../../src/main/remote/remoteWorktreeCoordinator';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import type { WorkspaceEnvironment } from '../../../src/main/environment/workspaceEnvironment';
import { remoteRemovalPaths } from '../../../src/main/remote/sshWorktreeRemoval';

async function setup() {
  const worktree = { path: '/srv/task', branch: 'task', isMain: false, isLocked: false, isPrunable: false };
  const environment = {
    id: 'ssh', kind: 'ssh',
    validateWorkspacePath: vi.fn(async (path: string) => ({ valid: true, resolvedPath: path })),
    inspectWorktree: vi.fn().mockResolvedValue({ success: true, worktree, hasChanges: false }),
    removeWorktree: vi.fn().mockResolvedValue({ success: true, recoveryPath: '/recovery/checkout' }),
    waitForWorktreeOperations: vi.fn().mockResolvedValue(undefined),
  };
  const registry = new WorkspaceRegistry(() => environment as unknown as WorkspaceEnvironment);
  await registry.registerWorkspace({ workspaceId: 'source', environmentId: 'ssh', workspacePath: '/srv/repo' });
  const terminals = vi.fn<() => string[] | null>().mockReturnValue([]);
  const coordinator = new RemoteWorktreeCoordinator(() => registry, terminals);
  return { registry, environment, coordinator, terminals, source: registry.getWorkspace('source')!, worktree };
}

describe('remote worktree removal coordination', () => {
  it('uses authoritative identity and reserves all operation paths until completion', async () => {
    const { coordinator, source, registry, environment } = await setup();
    let finish!: (result: { success: boolean }) => void;
    environment.removeWorktree.mockImplementation(() => new Promise((done) => { finish = done; }));
    const pending = coordinator.remove(source, '/srv/task', 'task');
    await vi.waitFor(() => expect(environment.removeWorktree).toHaveBeenCalledTimes(1));
    const args = environment.removeWorktree.mock.calls[0];
    expect(args.slice(0, 4)).toEqual(['/srv/repo', '/srv/task', 'task', ['/srv/repo']]);
    const paths = remoteRemovalPaths('/srv/task', args[4]);
    for (const path of ['/srv/task/src', paths.stagingPath, paths.recoveryDirectory]) {
      expect(await registry.registerWorkspace({ workspaceId: path, workspacePath: path, environmentId: 'ssh' })).toMatchObject({ success: false });
    }
    expect(await registry.registerWorkspace({ workspaceId: 'local', workspacePath: '/srv/task', environmentId: 'local' })).toMatchObject({ success: true });
    expect(await coordinator.remove(source, '/srv/task', 'task')).toMatchObject({ success: false, error: expect.stringContaining('being removed') });
    finish({ success: true });
    expect(await pending).toMatchObject({ success: true });
    expect(registry.isRemotePathReserved('ssh', '/srv/task')).toBe(false);
  });

  it('rejects dirty checkouts, changed branches, and unverifiable terminal activity', async () => {
    const { coordinator, source, registry, environment, terminals, worktree } = await setup();
    environment.inspectWorktree.mockResolvedValueOnce({ success: true, worktree, hasChanges: true });
    expect(await coordinator.remove(source, '/srv/task', 'task')).toMatchObject({ success: false, error: expect.stringContaining('untracked') });
    expect(await coordinator.remove(source, '/srv/task', 'old')).toMatchObject({ success: false, error: expect.stringContaining('branch changed') });
    terminals.mockReturnValue(null);
    expect(await coordinator.remove(source, '/srv/task', 'task')).toMatchObject({ success: false });
    expect(environment.removeWorktree).not.toHaveBeenCalled();
    expect(registry.isRemotePathReserved('ssh', '/srv/task')).toBe(false);
  });

  it('keeps uncertain reservations until the host confirms this operation completed', async () => {
    const { coordinator, source, registry, environment } = await setup();
    environment.removeWorktree.mockResolvedValue({ success: false, uncertain: true, error: 'SSH disconnected' });
    expect(await coordinator.remove(source, '/srv/task', 'task')).toMatchObject({ success: false });
    expect(registry.isRemotePathReserved('ssh', '/srv/task')).toBe(true);
    registry.unregisterWorkspace('source');
    expect(registry.isEnvironmentInUse('ssh')).toBe(true);
    environment.waitForWorktreeOperations.mockRejectedValueOnce(new Error('Operation still running'));
    await expect(coordinator.reconcile('ssh')).rejects.toThrow('still running');
    expect(registry.isRemotePathReserved('ssh', '/srv/task')).toBe(true);
    await coordinator.reconcile('ssh');
    expect(environment.waitForWorktreeOperations).toHaveBeenCalledWith('/srv/repo', environment.removeWorktree.mock.calls[0][4]);
    expect(registry.isRemotePathReserved('ssh', '/srv/task')).toBe(false);
    expect(registry.isEnvironmentInUse('ssh')).toBe(false);
  });

  it('blocks a registration whose alias resolves into a removal started during validation', async () => {
    const { registry, environment } = await setup();
    let finish!: (result: { valid: boolean; resolvedPath: string }) => void;
    environment.validateWorkspacePath.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    const pending = registry.registerWorkspace({ workspaceId: 'alias', environmentId: 'ssh', workspacePath: '/alias' });
    await vi.waitFor(() => expect(environment.validateWorkspacePath).toHaveBeenCalledWith('/alias'));
    const release = registry.reserveRemotePaths('ssh', ['/srv/task'])!;
    finish({ valid: true, resolvedPath: '/srv/task' });
    expect(await pending).toMatchObject({ success: false });
    release();
  });

  it('aborts if source registration closes while preflight inspection is pending', async () => {
    const { coordinator, source, registry, environment, worktree } = await setup();
    let finish!: (result: unknown) => void;
    environment.inspectWorktree.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    const pending = coordinator.remove(source, '/srv/task', 'task');
    registry.unregisterWorkspace('source');
    finish({ success: true, worktree, hasChanges: false });
    expect(await pending).toMatchObject({ success: false });
    expect(environment.removeWorktree).not.toHaveBeenCalled();
    expect(registry.isRemotePathReserved('ssh', '/srv/task')).toBe(false);
  });

  it('protects duplicate saved SSH targets without blocking unrelated hosts at the same path', async () => {
    const { coordinator, source, registry, environment } = await setup();
    Object.assign(environment, { worktreeResourceId: 'ssh:user@host' });
    registry.unregisterWorkspace('source');
    await registry.registerWorkspace({ workspaceId: 'source', environmentId: 'ssh', workspacePath: '/srv/repo' });
    await registry.registerWorkspace({ workspaceId: 'alias', environmentId: 'ssh-alias', workspacePath: '/srv/task' });
    expect(await coordinator.remove(registry.getWorkspace('source')!, '/srv/task', 'task')).toMatchObject({ success: false, error: expect.stringContaining('Close workspace tabs') });
    expect(environment.removeWorktree).not.toHaveBeenCalled();
    registry.unregisterWorkspace('alias');
    const release = registry.reserveRemotePaths('ssh', ['/srv/task'])!;
    expect(await registry.registerWorkspace({ workspaceId: 'alias', environmentId: 'ssh-alias', workspacePath: '/srv/task' })).toMatchObject({ success: false });
    release();
    Object.assign(environment, { worktreeResourceId: 'ssh:other-host' });
    await registry.registerWorkspace({ workspaceId: 'other', environmentId: 'other-ssh', workspacePath: '/srv/task' });
    expect(await coordinator.remove(source, '/srv/task', 'task')).toMatchObject({ success: false }); // Old source identity was closed.
    expect(await coordinator.remove(registry.getWorkspace('source')!, '/srv/task', 'task')).toMatchObject({ success: true });
  });
});
