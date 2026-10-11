import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { BrowserWindow } from 'electron';
import { GitService, type GitCommandExecutor } from '../../../src/main/gitService';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import { registerGitIpc } from '../../../src/main/ipc/gitIpc';
import type { WorkspaceEnvironment } from '../../../src/main/environment/workspaceEnvironment';
import { LOCAL_ENVIRONMENT_ID } from '../../../src/shared/types/environments';
import type {
  FileDiffResult,
  GitBranchStateResult,
  GitHistoryEntry,
  GitStatusResult,
  GitWorktreeListResult,
} from '../../../src/shared/types/git';

const execFileAsync = promisify(execFile);

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
const mockHandle = vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
  handlers.set(channel, handler);
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => mockHandle(channel, handler),
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(),
}));

describe('Checkout-aware Git IPC with real Git repository', () => {
  let tmpDir: string;
  let repoPath: string;
  let worktreeAPath: string;
  let worktreeBPath: string;
  let registry: WorkspaceRegistry;
  let gitService: GitService;
  let emittedStatuses: GitStatusResult[];

  beforeEach(async () => {
    emittedStatuses = [];
    handlers.clear();
    mockHandle.mockClear();

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-real-git-'));
    repoPath = path.join(tmpDir, 'main-repo');
    const worktreesDir = path.join(tmpDir, 'worktrees');
    worktreeAPath = path.join(worktreesDir, 'worktree-a');
    worktreeBPath = path.join(worktreesDir, 'worktree-b');

    fs.mkdirSync(repoPath, { recursive: true });
    fs.mkdirSync(worktreesDir, { recursive: true });

    // Initialize real git repo
    await execFileAsync('git', ['init', '--initial-branch', 'main'], { cwd: repoPath });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repoPath });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath });

    fs.writeFileSync(path.join(repoPath, 'README.md'), '# Main Repo\n');
    await execFileAsync('git', ['add', 'README.md'], { cwd: repoPath });
    await execFileAsync('git', ['commit', '-m', 'Initial commit on main'], { cwd: repoPath });

    // Create two linked worktrees
    await execFileAsync('git', ['worktree', 'add', '-b', 'feature-a', worktreeAPath, 'main'], { cwd: repoPath });
    await execFileAsync('git', ['worktree', 'add', '-b', 'feature-b', worktreeBPath, 'main'], { cwd: repoPath });

    // Dirty worktree A: modified file
    fs.writeFileSync(path.join(worktreeAPath, 'file-a.txt'), 'content A v1\n');
    await execFileAsync('git', ['add', 'file-a.txt'], { cwd: worktreeAPath });
    await execFileAsync('git', ['commit', '-m', 'Add file-a on feature-a'], { cwd: worktreeAPath });
    fs.writeFileSync(path.join(worktreeAPath, 'file-a.txt'), 'content A modified\n');

    // Dirty worktree B: untracked file
    fs.writeFileSync(path.join(worktreeBPath, 'file-b.txt'), 'untracked B\n');

    const localEnv = {
      validateWorkspacePath: async (p: string) => ({ valid: fs.existsSync(p), resolvedPath: p }),
      execGit: async (cwd: string, args: string[], timeoutMs?: number) => {
        const { stdout, stderr } = await execFileAsync('git', args, {
          cwd,
          timeout: timeoutMs ?? 15000,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        return { stdout, stderr };
      },
      readFile: async ({ filePath }: { filePath: string }) => {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          return { success: true, content };
        } catch (error) {
          return { success: false, error: String(error) };
        }
      },
    };

    registry = new WorkspaceRegistry(async (envId) => (envId === LOCAL_ENVIRONMENT_ID ? localEnv as unknown as WorkspaceEnvironment : null));

    const executor: GitCommandExecutor = async (workspacePath, args, timeoutMs, workspaceId, environmentId, checkoutContextId) => {
      if (workspaceId !== undefined) {
        const ws = registry.getWorkspace(workspaceId);
        const context = checkoutContextId ? registry.resolveCheckoutContext(workspaceId, checkoutContextId) : null;
        const root = checkoutContextId ? context?.path : ws?.location.path;
        if (!ws || root !== workspacePath || ws.location.environmentId !== environmentId || context?.missing) {
          throw new Error('Workspace identity is no longer registered');
        }
        return ws.environment.execGit(root, args, timeoutMs);
      }
      return localEnv.execGit(workspacePath, args, timeoutMs);
    };

    gitService = new GitService(
      (status) => emittedStatuses.push(status),
      async () => {},
      () => [],
      () => registry.getLocalOpenWorkspacePaths(),
      executor
    );

    registerGitIpc({
      getGitService: () => gitService,
      getMainWindow: () => ({ webContents: { send: (_channel: string, payload: unknown) => emittedStatuses.push(payload as GitStatusResult) } } as unknown as BrowserWindow),
      getWorkspaceRegistry: () => registry,
    });
  });

  afterEach(() => {
    gitService.stopPolling();
    registry.clear();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`Channel ${channel} not registered`);
    return handler(null, ...args);
  };

  it('selects main checkout when no checkoutContextId is supplied', async () => {
    const ws = await registry.registerWorkspace({ workspaceId: 'ws-1', workspacePath: repoPath });
    expect(ws.success).toBe(true);

    const branchState = await invoke('git-get-branch-state', repoPath, 'ws-1') as GitBranchStateResult;
    expect(branchState.success).toBe(true);
    expect(branchState.currentBranch).toBe('main');

    gitService.startPolling(repoPath, 'ws-1', 'local');
    const status = await invoke('git-refresh', 'ws-1') as GitStatusResult;
    expect(status.success).toBe(true);
    expect(status.currentBranch).toBe('main');
    expect(status.workspacePath).toBe(repoPath);
    expect(status.changes).toEqual([]);
  });

  it('selects worktree A and B accurately, with isolated status, diffs, staging and commits', async () => {
    await registry.registerWorkspace({ workspaceId: 'ws-1', workspacePath: repoPath });
    const regA = await registry.registerCheckoutContext({
      workspaceId: 'ws-1',
      path: worktreeAPath,
      kind: 'worktree',
      branch: 'feature-a',
    });
    const regB = await registry.registerCheckoutContext({
      workspaceId: 'ws-1',
      path: worktreeBPath,
      kind: 'worktree',
      branch: 'feature-b',
    });
    const ctxA = regA.checkoutContext!;
    const ctxB = regB.checkoutContext!;

    // 1. Branch state for A targets A
    const branchA = await invoke('git-get-branch-state', worktreeAPath, 'ws-1', ctxA.id) as GitBranchStateResult;
    expect(branchA.currentBranch).toBe('feature-a');

    // 2. Branch state for B targets B
    const branchB = await invoke('git-get-branch-state', worktreeBPath, 'ws-1', ctxB.id) as GitBranchStateResult;
    expect(branchB.currentBranch).toBe('feature-b');

    // 3. Status of A shows file-a.txt modified
    gitService.startPolling(worktreeAPath, 'ws-1', 'local', ctxA.id);
    const statusA = await invoke('git-refresh', 'ws-1', ctxA.id) as GitStatusResult;
    expect(statusA.currentBranch).toBe('feature-a');
    expect(statusA.workspacePath).toBe(worktreeAPath);
    expect(statusA.checkoutContextId).toBe(ctxA.id);
    expect(statusA.changes).toEqual([
      expect.objectContaining({ path: 'file-a.txt', status: 'modified', staged: false }),
    ]);

    // 4. Status of B shows file-b.txt untracked
    gitService.startPolling(worktreeBPath, 'ws-1', 'local', ctxB.id);
    const statusB = await invoke('git-refresh', 'ws-1', ctxB.id) as GitStatusResult;
    expect(statusB.currentBranch).toBe('feature-b');
    expect(statusB.workspacePath).toBe(worktreeBPath);
    expect(statusB.checkoutContextId).toBe(ctxB.id);
    expect(statusB.changes).toEqual([
      expect.objectContaining({ path: 'file-b.txt', status: 'untracked', staged: false }),
    ]);

    // 5. File diff on A inspects file-a.txt in worktree A
    const diffA = await invoke('git-get-file-diff', worktreeAPath, 'file-a.txt', 'working', 'ws-1', ctxA.id) as FileDiffResult;
    expect(diffA.success).toBe(true);
    expect(diffA.oldContent).toContain('content A v1');
    expect(diffA.newContent).toContain('content A modified');

    // 6. Staging on A stages file-a.txt in A only; B remains unstaged
    const stageA = await invoke('git-stage', worktreeAPath, ['file-a.txt'], 'ws-1', ctxA.id) as { success: boolean };
    expect(stageA.success).toBe(true);

    gitService.startPolling(worktreeAPath, 'ws-1', 'local', ctxA.id);
    const statusAAfterStage = await invoke('git-refresh', 'ws-1', ctxA.id) as GitStatusResult;
    expect(statusAAfterStage.changes).toEqual([
      expect.objectContaining({ path: 'file-a.txt', staged: true }),
    ]);

    gitService.startPolling(worktreeBPath, 'ws-1', 'local', ctxB.id);
    const statusBAfterStage = await invoke('git-refresh', 'ws-1', ctxB.id) as GitStatusResult;
    expect(statusBAfterStage.changes).toEqual([
      expect.objectContaining({ path: 'file-b.txt', staged: false }),
    ]);

    // 7. Committing on A commits to feature-a; feature-b and main logs do not have it
    const commitA = await invoke('git-commit', worktreeAPath, 'Commit on feature-a', 'ws-1', ctxA.id) as { success: boolean };
    expect(commitA.success).toBe(true);

    const historyA = await invoke('git-get-history', worktreeAPath, 5, 'ws-1', ctxA.id) as GitHistoryEntry[];
    expect(historyA[0].subject).toBe('Commit on feature-a');

    const historyMain = await invoke('git-get-history', repoPath, 5, 'ws-1') as GitHistoryEntry[];
    expect(historyMain.map((h) => h.subject)).not.toContain('Commit on feature-a');

    const historyB = await invoke('git-get-history', worktreeBPath, 5, 'ws-1', ctxB.id) as GitHistoryEntry[];
    expect(historyB.map((h) => h.subject)).not.toContain('Commit on feature-a');

    // 8. B's untracked file is still intact
    expect(fs.existsSync(path.join(worktreeBPath, 'file-b.txt'))).toBe(true);
  });

  it('fails closed when given unknown, missing, foreign or removed checkout context IDs', async () => {
    await registry.registerWorkspace({ workspaceId: 'ws-1', workspacePath: repoPath });
    await registry.registerWorkspace({ workspaceId: 'ws-2', workspacePath: worktreeBPath });

    const regA = await registry.registerCheckoutContext({
      workspaceId: 'ws-1',
      path: worktreeAPath,
      kind: 'worktree',
      branch: 'feature-a',
    });
    const regB = await registry.registerCheckoutContext({
      workspaceId: 'ws-2',
      path: worktreeBPath,
      kind: 'worktree',
      branch: 'feature-b',
    });

    const ctxA = regA.checkoutContext!;
    const ctxB = regB.checkoutContext!;

    // 1. Unknown context ID
    await expect(invoke('git-get-branch-state', worktreeAPath, 'ws-1', 'unknown-context-id'))
      .rejects.toThrow('Checkout context is not registered for this workspace');

    // 2. Foreign context ID (belongs to ws-2, passed with ws-1)
    await expect(invoke('git-stage', worktreeAPath, ['file-a.txt'], 'ws-1', ctxB.id))
      .rejects.toThrow('Checkout context is not registered for this workspace');

    // 3. Missing context ID (marked missing in registry)
    registry.describeCheckoutContext(ctxA.id, { missing: true });
    await expect(invoke('git-refresh', 'ws-1', ctxA.id))
      .rejects.toThrow('The selected checkout is missing or has been removed');

    // 4. Removed context ID (unregistered from registry)
    registry.unregisterCheckoutContext(ctxA.id);
    await expect(invoke('git-commit', worktreeAPath, 'msg', 'ws-1', ctxA.id))
      .rejects.toThrow('Checkout context is not registered for this workspace');
  });

  it('runs repository-wide operations against the repository root even when checkoutContextId is supplied', async () => {
    await registry.registerWorkspace({ workspaceId: 'ws-1', workspacePath: repoPath });
    const regA = await registry.registerCheckoutContext({
      workspaceId: 'ws-1',
      path: worktreeAPath,
      kind: 'worktree',
      branch: 'feature-a',
    });
    const ctxA = regA.checkoutContext!;

    // git-list-worktrees should return the worktrees of the repository
    const listResult = await invoke('git-list-worktrees', worktreeAPath, 'ws-1', ctxA.id) as GitWorktreeListResult;
    expect(listResult.success).toBe(true);
    expect(listResult.worktrees.length).toBeGreaterThanOrEqual(2);
    expect(listResult.worktrees.some((w) => w.branch === 'main')).toBe(true);
    expect(listResult.worktrees.some((w) => w.branch === 'feature-a')).toBe(true);
  });

  const git = async (cwd: string, ...args: string[]) => (await execFileAsync('git', args, { cwd })).stdout.trim();
  const registerA = async () => {
    await registry.registerWorkspace({ workspaceId: 'ws-1', workspacePath: repoPath });
    return (await registry.registerCheckoutContext({ workspaceId: 'ws-1', path: worktreeAPath, kind: 'worktree' })).checkoutContext!;
  };

  it('creates branches only in the selected checkout, including legacy main callers and failures', async () => {
    const a = await registerA();
    const before = await Promise.all([repoPath, worktreeAPath, worktreeBPath].map(p => git(p, 'status', '--porcelain')));
    expect(await invoke('git-create-branch', repoPath, 'new-a', undefined, 'ws-1', a.id)).toMatchObject({ success: true });
    expect(await git(worktreeAPath, 'branch', '--show-current')).toBe('new-a');
    expect(await git(repoPath, 'branch', '--show-current')).toBe('main');
    expect(await git(worktreeBPath, 'branch', '--show-current')).toBe('feature-b');
    expect(await invoke('git-create-branch', repoPath, 'feature-b', undefined, 'ws-1', a.id)).toMatchObject({ success: false });
    expect(await git(worktreeAPath, 'branch', '--show-current')).toBe('new-a');
    expect(await invoke('git-create-branch', repoPath, 'new-main', undefined, 'ws-1')).toMatchObject({ success: true });
    expect(await git(repoPath, 'branch', '--show-current')).toBe('new-main');
    expect(await git(worktreeBPath, 'branch', '--show-current')).toBe('feature-b');
    expect(await Promise.all([repoPath, worktreeAPath, worktreeBPath].map(p => git(p, 'status', '--porcelain')))).toEqual(before);
  });

  it('switches A in place and reconciles branch metadata without changing its identity or other checkouts', async () => {
    const a = await registerA();
    await git(repoPath, 'branch', 'switch-target', 'feature-a');
    expect(await invoke('git-switch-branch', repoPath, 'switch-target', 'ws-1', a.id)).toMatchObject({ success: true });
    await invoke('reconcile-checkout-contexts', 'ws-1');
    expect(registry.resolveCheckoutContext('ws-1', a.id)).toMatchObject({ id: a.id, path: worktreeAPath, branch: 'switch-target' });
    expect(await invoke('git-get-branch-state', repoPath, 'ws-1', a.id)).toMatchObject({ currentBranch: 'switch-target' });
    expect(await git(repoPath, 'branch', '--show-current')).toBe('main');
    expect(await git(worktreeBPath, 'branch', '--show-current')).toBe('feature-b');
    expect(fs.readFileSync(path.join(worktreeAPath, 'file-a.txt'), 'utf8')).toBe('content A modified\n');
  });

  it('publishes A with its upstream and default pushes A or main without substituting another branch', async () => {
    const a = await registerA();
    const bare = path.join(tmpDir, 'remote.git');
    await git(tmpDir, 'init', '--bare', bare);
    await git(repoPath, 'remote', 'add', 'origin', bare);
    expect(await invoke('git-push', repoPath, 'origin', 'feature-a', false, true, 'ws-1', a.id)).toMatchObject({ success: true });
    expect(await git(worktreeAPath, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/feature-a');
    await git(worktreeAPath, 'commit', '--allow-empty', '-m', 'A push');
    expect(await invoke('git-push', repoPath, undefined, undefined, undefined, undefined, 'ws-1', a.id)).toMatchObject({ success: true });
    expect(await git(bare, 'rev-parse', 'feature-a')).toBe(await git(worktreeAPath, 'rev-parse', 'HEAD'));
    await expect(git(bare, 'rev-parse', '--verify', 'main')).rejects.toThrow();
    await git(repoPath, 'push', '--set-upstream', 'origin', 'main');
    await git(repoPath, 'commit', '--allow-empty', '-m', 'Main push');
    expect(await invoke('git-push', repoPath, undefined, undefined, undefined, undefined, 'ws-1')).toMatchObject({ success: true });
    expect(await git(bare, 'rev-parse', 'main')).toBe(await git(repoPath, 'rev-parse', 'HEAD'));
    await expect(git(bare, 'rev-parse', '--verify', 'feature-b')).rejects.toThrow();
    await git(bare, 'update-ref', 'refs/heads/feature-a', await git(bare, 'rev-parse', 'main'));
    expect(await invoke('git-push', repoPath, undefined, undefined, undefined, undefined, 'ws-1', a.id))
      .toMatchObject({ success: false, error: 'Push rejected — fetch and merge or rebase first. Run "Fetch & Pull" to update.' });
    expect(await git(worktreeBPath, 'branch', '--show-current')).toBe('feature-b');
    expect(await git(repoPath, 'branch', '--show-current')).toBe('main');
  });

  it('fetches at the repository root but pulls in A', async () => {
    const a = await registerA();
    const bare = path.join(tmpDir, 'remote.git');
    await git(tmpDir, 'init', '--bare', bare);
    await git(repoPath, 'remote', 'add', 'origin', bare);
    await git(worktreeAPath, 'push', '-u', 'origin', 'feature-a');
    const clone = path.join(tmpDir, 'clone');
    await git(tmpDir, 'clone', '--branch', 'feature-a', bare, clone);
    await git(clone, 'config', 'user.name', 'Test');
    await git(clone, 'config', 'user.email', 'test@example.com');
    await git(clone, 'commit', '--allow-empty', '-m', 'Remote advancement');
    await git(clone, 'push');
    const mainHead = await git(repoPath, 'rev-parse', 'HEAD');
    const bHead = await git(worktreeBPath, 'rev-parse', 'HEAD');
    const exec = vi.spyOn(registry.getWorkspace('ws-1')!.environment, 'execGit');
    expect(await invoke('git-fetch', worktreeAPath, undefined, 'ws-1', a.id)).toMatchObject({ success: true });
    expect(exec.mock.calls[0][0]).toBe(repoPath);
    expect(await invoke('git-pull', repoPath, false, 'ws-1', a.id)).toMatchObject({ success: true });
    expect(await git(worktreeAPath, 'rev-parse', 'HEAD')).toBe(await git(clone, 'rev-parse', 'HEAD'));
    expect(await git(repoPath, 'rev-parse', 'HEAD')).toBe(mainHead);
    expect(await git(worktreeBPath, 'rev-parse', 'HEAD')).toBe(bHead);
  });

  it('rejects invalid, foreign, missing, released and physically removed origins before repository mutations', async () => {
    const a = await registerA();
    await registry.registerWorkspace({ workspaceId: 'other', workspacePath: worktreeBPath });
    const foreign = registry.resolveCheckoutContext('other')!;
    const remove = (id: string) => invoke('git-remove-remote', worktreeAPath, 'origin', 'ws-1', id);
    const exec = vi.spyOn(registry.getWorkspace('ws-1')!.environment, 'execGit');
    await expect(remove('unknown')).rejects.toThrow('not registered');
    await expect(remove(foreign.id)).rejects.toThrow('not registered');
    registry.describeCheckoutContext(a.id, { missing: true });
    await expect(remove(a.id)).rejects.toThrow('missing');
    registry.describeCheckoutContext(a.id, { missing: false });
    fs.rmSync(worktreeAPath, { recursive: true, force: true });
    await expect(remove(a.id)).rejects.toThrow('missing');
    registry.unregisterCheckoutContext(a.id);
    await expect(remove(a.id)).rejects.toThrow('not registered');
    expect(exec).not.toHaveBeenCalled();
  });

  it('blocks removal reservations and origins released during repository-wide validation', async () => {
    const a = await registerA();
    const env = registry.getWorkspace('ws-1')!.environment;
    const exec = vi.spyOn(env, 'execGit');
    const removal = vi.spyOn(gitService, 'isWorktreeBeingRemoved').mockReturnValue(true);
    await expect(invoke('git-fetch', repoPath, undefined, 'ws-1', a.id)).rejects.toThrow('being removed');
    removal.mockRestore();
    vi.spyOn(env, 'validateWorkspacePath').mockImplementation(async p => {
      registry.unregisterCheckoutContext(a.id);
      return { valid: true, resolvedPath: p };
    });
    await expect(invoke('git-fetch', repoPath, undefined, 'ws-1', a.id)).rejects.toThrow('no longer registered');
    expect(exec).not.toHaveBeenCalled();
  });

  it('keeps one poller through main → A → B → main and rejects older stops/refreshes', async () => {
    const a = await registerA();
    const b = (await registry.registerCheckoutContext({ workspaceId: 'ws-1', path: worktreeBPath, kind: 'worktree' })).checkoutContext!;
    await invoke('git-start-polling', repoPath, 'ws-1');
    await invoke('git-start-polling', repoPath, 'ws-1', a.id);
    await invoke('git-stop-polling', 'ws-1');
    expect(gitService.getCurrentWorkspaceIdentity()?.checkoutContextId).toBe(a.id);
    expect(await invoke('git-refresh', 'ws-1')).toBeNull();
    expect(await invoke('git-refresh')).toBeNull();
    await invoke('git-stop-polling');
    expect(gitService.getCurrentWorkspaceIdentity()?.checkoutContextId).toBe(a.id);
    const old = invoke('git-refresh', 'ws-1', a.id);
    await invoke('git-start-polling', repoPath, 'ws-1', b.id);
    await invoke('git-stop-polling', 'ws-1', a.id);
    expect(await old).toBeNull();
    expect(gitService.getCurrentWorkspaceIdentity()?.checkoutContextId).toBe(b.id);
    expect(await invoke('git-refresh', 'ws-1', b.id)).toMatchObject({ currentBranch: 'feature-b', checkoutContextId: b.id });
    await invoke('git-start-polling', repoPath, 'ws-1');
    await invoke('git-stop-polling', 'ws-1', b.id);
    expect(await invoke('git-refresh', 'ws-1')).toMatchObject({ currentBranch: 'main', workspacePath: repoPath });
    await invoke('git-stop-polling', 'ws-1');
    expect(gitService.getCurrentWorkspaceIdentity()).toBeNull();
  });

  it('routes remote SSH checkout operations through the registered remote environment without local execution', async () => {
    const remoteExecGit = vi.fn().mockResolvedValue({ stdout: 'status on remote\n', stderr: '' });
    const remoteReadFile = vi.fn().mockResolvedValue({ success: true, content: 'remote content' });

    const remoteEnv = {
      validateWorkspacePath: async (p: string) => ({ valid: true, resolvedPath: p }),
      execGit: remoteExecGit,
      readFile: remoteReadFile,
    };

    const sshRegistry = new WorkspaceRegistry(async (envId) => (envId === 'ssh-srv' ? remoteEnv as unknown as WorkspaceEnvironment : null));
    await sshRegistry.registerWorkspace({
      workspaceId: 'ssh-ws',
      workspacePath: '/remote/repo',
      environmentId: 'ssh-srv',
    });
    const regRemote = await sshRegistry.registerCheckoutContext({
      workspaceId: 'ssh-ws',
      path: '/remote/worktrees/feat',
      kind: 'worktree',
      branch: 'remote-feat',
    });
    const remoteCtx = regRemote.checkoutContext!;

    const sshService = new GitService(
      () => {},
      async () => {},
      () => [],
      () => [],
      async (_workspacePath, args, timeoutMs, workspaceId, _environmentId, checkoutContextId) => {
        const ws = sshRegistry.getWorkspace(workspaceId!);
        const context = checkoutContextId ? sshRegistry.resolveCheckoutContext(workspaceId!, checkoutContextId) : null;
        const root = checkoutContextId ? context?.path : ws?.location.path;
        return ws!.environment.execGit(root!, args, timeoutMs);
      }
    );

    registerGitIpc({
      getGitService: () => sshService,
      getMainWindow: () => null,
      getWorkspaceRegistry: () => sshRegistry,
    });

    const sshInvoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!(null, ...args);

    // Stage in remote worktree
    await sshInvoke('git-stage', '/remote/worktrees/feat', ['remote.ts'], 'ssh-ws', remoteCtx.id);
    expect(remoteExecGit).toHaveBeenCalledWith('/remote/worktrees/feat', ['add', '--', 'remote.ts'], 15000);

    // Commit in remote worktree
    await sshInvoke('git-commit', '/remote/worktrees/feat', 'remote commit', 'ssh-ws', remoteCtx.id);
    expect(remoteExecGit).toHaveBeenCalledWith('/remote/worktrees/feat', ['commit', '-m', 'remote commit'], 120000);

    await sshInvoke('git-push', '/remote/repo', undefined, undefined, undefined, undefined, 'ssh-ws', remoteCtx.id);
    expect(remoteExecGit).toHaveBeenCalledWith('/remote/worktrees/feat', ['push'], 60000);
    await sshInvoke('git-fetch', '/remote/worktrees/feat', undefined, 'ssh-ws', remoteCtx.id);
    expect(remoteExecGit).toHaveBeenCalledWith('/remote/repo', ['fetch', '--prune'], 60000);

    // File diff on remote worktree uses remoteReadFile on the worktree root
    const diff = await sshInvoke('git-get-file-diff', '/remote/worktrees/feat', 'remote.ts', 'working', 'ssh-ws', remoteCtx.id);
    expect(diff).toMatchObject({ success: true, newContent: 'remote content' });
    expect(remoteReadFile).toHaveBeenCalledWith({
      workspacePath: '/remote/worktrees/feat',
      workspaceId: 'ssh-ws',
      filePath: '/remote/worktrees/feat/remote.ts',
    });
  });
});
