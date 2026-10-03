import { describe, expect, it, vi } from 'vitest';
import { RemoteWorktreeCoordinator } from '../../../src/main/remote/remoteWorktreeCoordinator';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import type { WorkspaceEnvironment } from '../../../src/main/environment/workspaceEnvironment';
import { remoteRemovalPaths } from '../../../src/main/remote/sshWorktreeRemoval';
import type { RemoteWorktreeRemovalRecord } from '../../../src/shared/types/store';

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
  const saved = (operationId = '12345678-1234-1234-1234-123456789abc'): RemoteWorktreeRemovalRecord => ({
    operationId, environmentId: 'ssh', resourceId: 'ssh:host', workspacePath: '/srv/repo', worktreePath: '/srv/task',
  });

  it('starts with malformed evidence intact, protects other valid records, and fails remote operations closed', async () => {
    const f = await setup();
    const records = [{ operationId: 'damaged' }, saved()] as RemoteWorktreeRemovalRecord[];
    const write = vi.fn();
    const coordinator = new RemoteWorktreeCoordinator(() => f.registry, f.terminals, { read: () => records, write });
    expect(coordinator.getRecoveryError()).toContain('Manual recovery required');
    expect(await coordinator.inspect(f.source, '/srv/other')).toMatchObject({ success: false, error: expect.stringContaining('remoteWorktreeRemovals') });
    expect(await coordinator.remove(f.source, '/srv/other', 'task')).toMatchObject({ success: false, error: expect.stringContaining('host completion journals') });
    await expect(coordinator.reconcile('ssh')).rejects.toThrow('Manual recovery required');
    expect(f.environment.inspectWorktree).not.toHaveBeenCalled();
    expect(f.environment.removeWorktree).not.toHaveBeenCalled();
    expect(f.environment.waitForWorktreeOperations).not.toHaveBeenCalled();
    for (const path of ['/srv/task', ...Object.values(remoteRemovalPaths('/srv/task', saved().operationId))]) {
      expect(f.registry.isRemotePathReserved('ssh', path)).toBe(true);
    }
    expect(write).not.toHaveBeenCalled();
    expect(records[0]).toEqual({ operationId: 'damaged' });
    expect(await f.registry.registerWorkspace({ workspaceId: 'local', environmentId: 'local', workspacePath: '/srv/task' })).toMatchObject({ success: true });
  });

  it.each([false, true])('retains all conflicting operation protections (duplicate ID: %s)', async (duplicate) => {
    const f = await setup();
    const first = saved();
    const second = { ...saved(duplicate ? first.operationId : 'abcdef01-1234-1234-1234-123456789abc'), worktreePath: '/srv/task/child' };
    const records = [first, second];
    const write = vi.fn();
    const coordinator = new RemoteWorktreeCoordinator(() => f.registry, f.terminals, { read: () => records, write });
    await expect(coordinator.reconcile('ssh')).rejects.toThrow('Manual recovery required');
    for (const record of records) {
      for (const path of [record.worktreePath, ...Object.values(remoteRemovalPaths(record.worktreePath, record.operationId))]) {
        expect(f.registry.isRemotePathReserved('ssh', path)).toBe(true);
      }
    }
    expect(write).not.toHaveBeenCalled();
    expect(records).toEqual([first, second]);
    expect(f.environment.waitForWorktreeOperations).not.toHaveBeenCalled();
  });

  it.each([null, {}, 'corrupt'])('does not throw or overwrite a malformed persistence collection: %j', (value) => {
    const registry = new WorkspaceRegistry(() => null);
    const write = vi.fn();
    const coordinator = new RemoteWorktreeCoordinator(() => registry, undefined, {
      read: () => value as unknown as RemoteWorktreeRemovalRecord[], write,
    });
    expect(coordinator.getRecoveryError()).toContain('Manual recovery required');
    expect(write).not.toHaveBeenCalled();
  });

  it('does not throw when persistence cannot be read, and leaves empty persistence usable', () => {
    const registry = new WorkspaceRegistry(() => null);
    const write = vi.fn();
    const damaged = new RemoteWorktreeCoordinator(() => registry, undefined, { read: () => { throw new Error('Read failed'); }, write });
    expect(damaged.getRecoveryError()).toContain('Manual recovery required');
    const empty = new RemoteWorktreeCoordinator(() => registry, undefined, { read: () => [], write });
    expect(empty.getRecoveryError()).toBeUndefined();
    expect(write).not.toHaveBeenCalled();
  });

  it('restores uncertain reservations after restart and requires a verified host journal before releasing them', async () => {
    const f = await setup();
    Object.assign(f.environment, { worktreeResourceId: 'ssh:user@host' });
    f.registry.unregisterWorkspace('source');
    await f.registry.registerWorkspace({ workspaceId: 'source', environmentId: 'ssh', workspacePath: '/srv/repo' });
    let records: RemoteWorktreeRemovalRecord[] = [];
    const persistence = { read: () => records, write: (value: RemoteWorktreeRemovalRecord[]) => { records = structuredClone(value); } };
    const coordinator = new RemoteWorktreeCoordinator(() => f.registry, f.terminals, persistence);
    f.environment.removeWorktree.mockImplementation(async () => {
      expect(records).toHaveLength(1); // Durable before any host dispatch.
      return { success: false, uncertain: true };
    });
    expect(await coordinator.remove(f.registry.getWorkspace('source')!, '/srv/task', 'task')).toMatchObject({ success: false });
    const restarted = new WorkspaceRegistry(() => f.environment as unknown as WorkspaceEnvironment);
    const restored = new RemoteWorktreeCoordinator(() => restarted, f.terminals, persistence);
    expect(restarted.isRemotePathReserved('ssh', '/srv/task/sub')).toBe(true);
    expect(restarted.isEnvironmentInUse('ssh')).toBe(true);
    expect(await restarted.registerWorkspace({ workspaceId: 'blocked', environmentId: 'alias', workspacePath: '/srv/task' })).toMatchObject({ success: false });
    await restarted.registerWorkspace({ workspaceId: 'source', environmentId: 'alias', workspacePath: '/srv/repo' });
    f.environment.waitForWorktreeOperations.mockRejectedValueOnce(new Error('Host outcome unknown'));
    await expect(restored.reconcile('alias')).rejects.toThrow('unknown');
    expect(records).toHaveLength(1);
    expect(restarted.isRemotePathReserved('alias', '/srv/task')).toBe(true);
    await restored.reconcile('alias');
    expect(records).toEqual([]);
    expect(restarted.isRemotePathReserved('ssh', '/srv/task')).toBe(false);
  });

  it('does not dispatch removal if desktop persistence fails and keeps protection if completion cannot be persisted', async () => {
    const f = await setup();
    const write = vi.fn().mockImplementationOnce(() => { throw new Error('Disk full'); });
    const coordinator = new RemoteWorktreeCoordinator(() => f.registry, f.terminals, { read: () => [], write });
    expect(await coordinator.remove(f.source, '/srv/task', 'task')).toMatchObject({ success: false, error: 'Disk full' });
    expect(f.environment.removeWorktree).not.toHaveBeenCalled();
    expect(f.registry.isRemotePathReserved('ssh', '/srv/task')).toBe(false);
    write.mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw new Error('Disk full'); });
    await expect(coordinator.remove(f.source, '/srv/task', 'task')).rejects.toThrow('Disk full');
    expect(f.registry.isRemotePathReserved('ssh', '/srv/task')).toBe(true);
  });

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

  it('treats a registered checkout context root as active, blocking inspection and removal until it is released', async () => {
    const { coordinator, registry, source, environment } = await setup();
    const { checkoutContext } = await registry.registerCheckoutContext({ workspaceId: 'source', path: '/srv/task', kind: 'worktree' });
    const blocked = { success: false, error: expect.stringContaining('Close workspace tabs') };

    // The context is not a workspace tab and is not a terminal, yet it still counts as live use.
    expect(registry.getAllWorkspaces().map((entry) => entry.location.path)).toEqual(['/srv/repo']);
    expect(await coordinator.inspect(source, '/srv/task')).toMatchObject(blocked);
    expect(await coordinator.remove(source, '/srv/task', 'task')).toMatchObject(blocked);
    expect(environment.inspectWorktree).not.toHaveBeenCalled();
    expect(environment.removeWorktree).not.toHaveBeenCalled();

    registry.unregisterCheckoutContext(checkoutContext!.id);
    expect(await coordinator.inspect(source, '/srv/task')).toMatchObject({ success: true });
    expect(await coordinator.remove(source, '/srv/task', 'task')).toMatchObject({ success: true });
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
