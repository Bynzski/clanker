import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import { EnvironmentManager } from '../../../src/main/environment/environmentManager';
import { SshCommandExecutor } from '../../../src/main/remote/sshCommandExecutor';
import { GitService } from '../../../src/main/gitService';
import { TaskSessionCoordinator } from '../../../src/main/taskSessionCoordinator';
import { WorkspacePersistenceService } from '../../../src/main/workspacePersistence';
import { LOCAL_ENVIRONMENT_ID } from '../../../src/shared/types/environments';

class MemoryStore {
  private data: Record<string, unknown> = {
    sshEnvironments: [
      {
        id: 'dev-vps',
        kind: 'ssh',
        label: 'Dev VPS',
        target: 'jay@vps.internal',
      },
    ],
    workspaceRecipes: [],
    taskSessions: [],
  };

  get<K extends string>(key: K): unknown {
    return this.data[key];
  }

  set(key: string, value: unknown): void {
    this.data[key] = value;
  }
}

describe('Remote Workspace Integration', () => {
  let store: MemoryStore;
  let persistence: WorkspacePersistenceService;
  let mockSshExecutor: SshCommandExecutor;
  let envManager: EnvironmentManager;
  let registry: WorkspaceRegistry;
  let gitService: GitService;
  let coordinator: TaskSessionCoordinator;

  beforeEach(() => {
    store = new MemoryStore();
    persistence = new WorkspacePersistenceService(() => store as never);

    mockSshExecutor = {
      exec: vi.fn(),
      testConnection: vi.fn(async () => ({ success: true })),
    } as unknown as SshCommandExecutor;

    envManager = new EnvironmentManager(() => store as never, mockSshExecutor);

    registry = new WorkspaceRegistry((id) => envManager.getEnvironment(id));

    gitService = new GitService(
      vi.fn(),
      vi.fn(),
      () => [],
      () => registry.getLocalOpenWorkspacePaths(),
      async (workspacePath, args, timeoutMs) => {
        const ws = registry.findWorkspaceByPath(workspacePath);
        if (ws && ws.location.environmentId !== LOCAL_ENVIRONMENT_ID) {
          return ws.environment.execGit(workspacePath, args, timeoutMs);
        }
        const local = await envManager.getEnvironment(LOCAL_ENVIRONMENT_ID);
        return local!.execGit(workspacePath, args, timeoutMs);
      }
    );

    coordinator = new TaskSessionCoordinator(persistence);
  });

  it('coexists with a local workspace having the exact same path', async () => {
    // Mock remote validation
    vi.mocked(mockSshExecutor.exec).mockResolvedValueOnce({
      stdout: '/home/jay/Projects/clanker\n',
      stderr: '',
      exitCode: 0,
    });

    const remoteReg = await registry.registerWorkspace({
      workspaceId: 'ws-remote',
      workspacePath: '/home/jay/Projects/clanker',
      environmentId: 'dev-vps',
    });
    expect(remoteReg.success).toBe(true);

    // Mock local environment validation for test
    const localEnv = await envManager.getEnvironment(LOCAL_ENVIRONMENT_ID);
    vi.spyOn(localEnv!, 'validateWorkspacePath').mockResolvedValueOnce({
      valid: true,
      resolvedPath: '/home/jay/Projects/clanker',
    });

    const localReg = await registry.registerWorkspace({
      workspaceId: 'ws-local',
      workspacePath: '/home/jay/Projects/clanker',
      environmentId: LOCAL_ENVIRONMENT_ID,
    });
    expect(localReg.success).toBe(true);

    expect(registry.getAllWorkspaces().length).toBe(2);

    const localEntry = registry.getWorkspaceByLocation(LOCAL_ENVIRONMENT_ID, '/home/jay/Projects/clanker');
    const remoteEntry = registry.getWorkspaceByLocation('dev-vps', '/home/jay/Projects/clanker');

    expect(localEntry?.workspaceId).toBe('ws-local');
    expect(remoteEntry?.workspaceId).toBe('ws-remote');
    expect(localEntry?.environment.kind).toBe('local');
    expect(remoteEntry?.environment.kind).toBe('ssh');

    // Local open paths only report the local workspace
    expect(registry.getLocalOpenWorkspacePaths()).toEqual(['/home/jay/Projects/clanker']);
  });

  it('routes Git operations through the remote environment instead of local', async () => {
    vi.mocked(mockSshExecutor.exec).mockResolvedValueOnce({
      stdout: '/var/www/remote-repo\n',
      stderr: '',
      exitCode: 0,
    });

    await registry.registerWorkspace({
      workspaceId: 'ws-remote-git',
      workspacePath: '/var/www/remote-repo',
      environmentId: 'dev-vps',
    });

    // Mock git branch command on remote
    vi.mocked(mockSshExecutor.exec).mockResolvedValueOnce({
      stdout: 'feature-remote\t*\nmain\t \n',
      stderr: '',
      exitCode: 0,
    });

    const branchState = await gitService.getBranches('/var/www/remote-repo');
    expect(branchState).toEqual([
      { name: 'feature-remote', isCurrent: true },
      { name: 'main', isCurrent: false },
    ]);

    expect(mockSshExecutor.exec).toHaveBeenCalledWith(
      'jay@vps.internal',
      'git',
      ['branch', '--format=%(refname:short)\t%(HEAD)'],
      expect.objectContaining({ cwd: '/var/www/remote-repo' })
    );
  });

  it('enforces root confinement on remote file operations', async () => {
    vi.mocked(mockSshExecutor.exec).mockResolvedValueOnce({
      stdout: '/var/www/app\n',
      stderr: '',
      exitCode: 0,
    });

    await registry.registerWorkspace({
      workspaceId: 'ws-files',
      workspacePath: '/var/www/app',
      environmentId: 'dev-vps',
    });

    const ws = registry.getWorkspace('ws-files');
    expect(ws).not.toBeNull();

    // Traversal outside root is rejected before any command is sent
    const escapeRead = await ws!.environment.readFile({
      workspacePath: '/var/www/app',
      filePath: '/etc/shadow',
    });
    expect(escapeRead.success).toBe(false);
    expect(escapeRead.errorCode).toBe('invalid-path');

    const escapeWrite = await ws!.environment.writeFile({
      workspacePath: '/var/www/app',
      filePath: '/var/www/other/index.html',
      content: 'evil',
    });
    expect(escapeWrite.success).toBe(false);
    expect(escapeWrite.errorCode).toBe('invalid-path');
  });

  it('spawns remote terminal via ssh -t and isolates task recovery on exit', async () => {
    vi.mocked(mockSshExecutor.exec).mockResolvedValueOnce({
      stdout: '/var/www/app\n',
      stderr: '',
      exitCode: 0,
    });

    await registry.registerWorkspace({
      workspaceId: 'ws-term',
      workspacePath: '/var/www/app',
      environmentId: 'dev-vps',
    });

    const ws = registry.getWorkspace('ws-term')!;
    const terminalConfig = await ws.environment.resolveTerminalSpawn({
      id: 'term-remote-1',
      workingDir: '/var/www/app',
      harness: 'codex',
    });

    expect(terminalConfig.spawnCmd).toBe('ssh');
    expect(terminalConfig.spawnArgs).toContain('-t');
    expect(terminalConfig.spawnArgs).toContain('jay@vps.internal');
    expect(terminalConfig.attentionEnabled).toBe(false);

    // Track task
    coordinator.onTerminalSpawned(
      'term-remote-1',
      '/var/www/app',
      'codex',
      undefined,
      'dev-vps'
    );

    const taskBeforeExit = persistence.getAllTaskSessions().find((t) => t.terminalId === 'term-remote-1');
    expect(taskBeforeExit?.state).toBe('running');
    expect(taskBeforeExit?.environmentId).toBe('dev-vps');

    // On exit, remote terminal does NOT scan local sessions; marks unavailable
    const exitedTask = await coordinator.onTerminalExited('term-remote-1', 'dev-vps');
    expect(exitedTask?.state).toBe('unavailable');
    expect(exitedTask?.stateReason).toContain('Remote session recovery is not supported');
  });

  it('unregisters remote workspace cleanly without affecting local workspaces', async () => {
    const localEnv = await envManager.getEnvironment(LOCAL_ENVIRONMENT_ID);
    vi.spyOn(localEnv!, 'validateWorkspacePath').mockResolvedValueOnce({
      valid: true,
      resolvedPath: '/home/local/repo',
    });

    vi.mocked(mockSshExecutor.exec).mockResolvedValueOnce({
      stdout: '/home/remote/repo\n',
      stderr: '',
      exitCode: 0,
    });

    await registry.registerWorkspace({
      workspaceId: 'local-ws',
      workspacePath: '/home/local/repo',
      environmentId: LOCAL_ENVIRONMENT_ID,
    });

    await registry.registerWorkspace({
      workspaceId: 'remote-ws',
      workspacePath: '/home/remote/repo',
      environmentId: 'dev-vps',
    });

    expect(registry.getAllWorkspaces().length).toBe(2);

    registry.unregisterWorkspace('remote-ws');
    expect(registry.getWorkspace('remote-ws')).toBeNull();
    expect(registry.getWorkspace('local-ws')).not.toBeNull();
    expect(registry.getLocalOpenWorkspacePaths()).toEqual(['/home/local/repo']);
  });
});
