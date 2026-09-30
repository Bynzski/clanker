import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import type { WorkspaceEnvironment } from '../../../src/main/environment/workspaceEnvironment';
import { LOCAL_ENVIRONMENT_ID } from '../../../src/shared/types/environments';

function createMockEnvironment(id: string, kind: 'local' | 'ssh' = 'ssh'): WorkspaceEnvironment {
  return {
    id,
    kind,
    label: id.toUpperCase(),
    capabilities: {
      watchFiles: kind === 'local',
      worktrees: kind === 'local',
      revealInFileManager: kind === 'local',
      agentAttention: kind === 'local',
      sessionDiscovery: kind === 'local',
      annotationHandoff: kind === 'local',
    },
    validateWorkspacePath: vi.fn(async (path: string) => {
      if (path.includes('nonexistent')) {
        return { valid: false, error: 'Path does not exist' };
      }
      return { valid: true, resolvedPath: path.replace(/\/+$/, '') };
    }),
    listDirectory: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    createFile: vi.fn(),
    createDirectory: vi.fn(),
    deleteEntry: vi.fn(),
    renameEntry: vi.fn(),
    execGit: vi.fn(),
    getHarnessOptions: vi.fn(async () => ({})),
    probeAvailableHarnessIds: vi.fn(async () => []),
    resolveTerminalSpawn: vi.fn(),
  };
}

describe('WorkspaceRegistry', () => {
  let localEnv: WorkspaceEnvironment;
  let remoteEnv: WorkspaceEnvironment;
  let registry: WorkspaceRegistry;

  beforeEach(() => {
    localEnv = createMockEnvironment(LOCAL_ENVIRONMENT_ID, 'local');
    remoteEnv = createMockEnvironment('vps-1', 'ssh');

    registry = new WorkspaceRegistry((envId) => {
      if (envId === LOCAL_ENVIRONMENT_ID) return localEnv;
      if (envId === 'vps-1') return remoteEnv;
      return null;
    });
  });

  it('registers a local workspace and normalizes its location', async () => {
    const result = await registry.registerWorkspace({
      workspaceId: 'ws-local-1',
      workspacePath: '/home/user/project/',
    });

    expect(result.success).toBe(true);
    expect(result.location).toEqual({
      environmentId: LOCAL_ENVIRONMENT_ID,
      path: '/home/user/project',
    });

    const registered = registry.getWorkspace('ws-local-1');
    expect(registered?.location.environmentId).toBe(LOCAL_ENVIRONMENT_ID);
    expect(registered?.environment.kind).toBe('local');
  });

  it('registers a remote workspace with specified environmentId', async () => {
    const result = await registry.registerWorkspace({
      workspaceId: 'ws-remote-1',
      workspacePath: '/var/www/app',
      environmentId: 'vps-1',
    });

    expect(result.success).toBe(true);
    expect(result.location).toEqual({
      environmentId: 'vps-1',
      path: '/var/www/app',
    });

    const registered = registry.getWorkspace('ws-remote-1');
    expect(registered?.location.environmentId).toBe('vps-1');
    expect(registered?.environment.kind).toBe('ssh');
  });

  it('allows same path on local and remote environments simultaneously', async () => {
    await registry.registerWorkspace({
      workspaceId: 'ws-local',
      workspacePath: '/home/user/code',
      environmentId: LOCAL_ENVIRONMENT_ID,
    });

    await registry.registerWorkspace({
      workspaceId: 'ws-remote',
      workspacePath: '/home/user/code',
      environmentId: 'vps-1',
    });

    expect(registry.getAllWorkspaces().length).toBe(2);

    const localWs = registry.getWorkspaceByLocation(LOCAL_ENVIRONMENT_ID, '/home/user/code');
    const remoteWs = registry.getWorkspaceByLocation('vps-1', '/home/user/code');

    expect(localWs?.workspaceId).toBe('ws-local');
    expect(remoteWs?.workspaceId).toBe('ws-remote');
  });

  it('rejects duplicate workspaceId', async () => {
    await registry.registerWorkspace({
      workspaceId: 'ws-1',
      workspacePath: '/home/user/code',
    });

    const dup = await registry.registerWorkspace({
      workspaceId: 'ws-1',
      workspacePath: '/other/path',
    });

    expect(dup.success).toBe(false);
    expect(dup.error).toContain('already registered');
  });

  it.each(['unregister', 'clear'] as const)('cancels pending SSH registration on %s without resurrecting it', async (action) => {
    let finish!: (value: { valid: boolean; resolvedPath: string }) => void;
    vi.mocked(remoteEnv.validateWorkspacePath).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = registry.registerWorkspace({ workspaceId: 'pending', environmentId: 'vps-1', workspacePath: '/repo' });
    await vi.waitFor(() => expect(remoteEnv.validateWorkspacePath).toHaveBeenCalled());
    expect(registry.isEnvironmentInUse('vps-1')).toBe(true);
    expect(await registry.registerWorkspace({ workspaceId: 'pending', environmentId: 'vps-1', workspacePath: '/other' })).toMatchObject({ success: false });
    if (action === 'clear') registry.clear();
    else registry.unregisterWorkspace('pending');
    // A newer request can use the ID; the cancelled request must not replace it.
    expect(await registry.registerWorkspace({ workspaceId: 'pending', environmentId: 'vps-1', workspacePath: '/new' })).toMatchObject({ success: true });
    finish({ valid: true, resolvedPath: '/repo' });
    expect(await pending).toMatchObject({ success: false, error: expect.stringContaining('cancelled') });
    expect(registry.getWorkspace('pending')?.location.path).toBe('/new');
  });

  it('releases a pending environment lock when SSH validation fails', async () => {
    vi.mocked(remoteEnv.validateWorkspacePath).mockRejectedValueOnce(new Error('SSH disconnected'));
    await expect(registry.registerWorkspace({ workspaceId: 'pending', environmentId: 'vps-1', workspacePath: '/repo' })).rejects.toThrow('SSH disconnected');
    expect(registry.isEnvironmentInUse('vps-1')).toBe(false);
  });

  it('rejects invalid or inaccessible paths', async () => {
    const res = await registry.registerWorkspace({
      workspaceId: 'ws-bad',
      workspacePath: '/nonexistent/dir',
      environmentId: 'vps-1',
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Path does not exist');
  });

  it('respects worktree removal protection for local workspaces', async () => {
    const protectedRegistry = new WorkspaceRegistry(
      () => localEnv,
      { isWorktreeBeingRemoved: (p) => p.includes('removing') }
    );

    const res = await protectedRegistry.registerWorkspace({
      workspaceId: 'ws-removing',
      workspacePath: '/home/user/removing-tree',
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('being removed');
  });

  it('unregisters workspace and isolates local paths for worktree safety', async () => {
    await registry.registerWorkspace({
      workspaceId: 'local-1',
      workspacePath: '/home/local/repo',
      environmentId: LOCAL_ENVIRONMENT_ID,
    });
    await registry.registerWorkspace({
      workspaceId: 'remote-1',
      workspacePath: '/home/remote/repo',
      environmentId: 'vps-1',
    });

    expect(registry.getLocalOpenWorkspacePaths()).toEqual(['/home/local/repo']);

    registry.unregisterWorkspace('local-1');
    expect(registry.getWorkspace('local-1')).toBeNull();
    expect(registry.getLocalOpenWorkspacePaths()).toEqual([]);
    expect(registry.getWorkspace('remote-1')).not.toBeNull();
  });
});
