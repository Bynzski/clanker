/**
 * Git IPC Handlers
 *
 * Registers all git-related IPC handlers. Extracted from main.ts per S2.4.
 */

import { ipcMain, BrowserWindow } from 'electron';
import * as path from 'path';
import { GitService, type GitWorkspaceIdentity } from '../gitService';
import type { WorkspaceRegistry } from '../workspaceRegistry';
import { attachCreatedWorktree } from '../worktreeContextAttachment';
import type { GitCreateWorktreeOptions, GitWorktreeCreateResult } from '../../shared/types/git';
import { RemoteWorktreeCoordinator, type RemoteWorktreeRemovalPersistence } from '../remote/remoteWorktreeCoordinator';
import { toNativePath, toPosixPath } from '../../shared/pathNormalize';
import {
  getValidatedWorkspacePath as getValidatedLocalWorkspacePath,
  getInvalidWorkspaceResult,
} from './aiCommitIpc';
import {
  GIT_START_POLLING,
  GIT_STOP_POLLING,
  GIT_GET_BRANCH_STATE,
  GIT_LIST_WORKTREES,
  GIT_CREATE_WORKTREE,
  GIT_INSPECT_WORKTREE,
  GIT_REMOVE_WORKTREE,
  REGISTER_OPEN_WORKSPACE,
  UNREGISTER_OPEN_WORKSPACE,
  GIT_GET_OPERATION_STATE,
  GIT_GET_STASHES,
  GIT_GET_HISTORY,
  GIT_GET_DIFF,
  GIT_GET_FILE_DIFF,
  GIT_STAGE,
  GIT_UNSTAGE,
  GIT_COMMIT,
  GIT_CREATE_BRANCH,
  GIT_SWITCH_BRANCH,
  GIT_DELETE_BRANCH,
  GIT_FORCE_DELETE_BRANCH,
  GIT_MERGE_BRANCH,
  GIT_ABORT_OPERATION,
  GIT_STASH,
  GIT_APPLY_STASH,
  GIT_POP_STASH,
  GIT_DROP_STASH,
  GIT_CLEAR_STASHES,
  GIT_REFRESH,
  GIT_INIT,
  GIT_GET_REMOTES,
  GIT_ADD_REMOTE,
  GIT_REMOVE_REMOTE,
  GIT_RENAME_REMOTE,
  GIT_FETCH,
  GIT_PULL,
  GIT_PUSH,
  GIT_STATUS_UPDATE,
} from '../../shared/ipcChannels';

interface RegisterGitIpcDeps {
  getGitService: () => GitService;
  getMainWindow: () => BrowserWindow | null;
  getWorkspaceRegistry?: () => WorkspaceRegistry;
  /** null means an active remote terminal's directory cannot be verified. */
  getLiveRemoteTerminalPaths?: (environmentId: string) => string[] | null;
  onWorkspaceUnregistered?: (workspaceId: string) => void;
  remoteWorktreeRemovalPersistence?: RemoteWorktreeRemovalPersistence;
}
function getValidatedOpenWorkspacePaths(paths: unknown): string[] | null {
  if (!Array.isArray(paths) || !paths.every((entry) => typeof entry === 'string')) return null;
  const validated = paths.map((entry: string) => {
    if (!entry.trim() || entry.includes('\0')) return null;
    const nativePath = toNativePath(entry, process.platform);
    return path.isAbsolute(nativePath) ? nativePath : null;
  });
  return validated.every((entry): entry is string => entry !== null) ? validated : null;
}

export function registerGitIpc(deps: RegisterGitIpcDeps): void {
  const { getGitService, getMainWindow, getWorkspaceRegistry } = deps;
  const gitService = getGitService();
  const remoteWorktrees = new RemoteWorktreeCoordinator(() => getWorkspaceRegistry?.(), deps.getLiveRemoteTerminalPaths, deps.remoteWorktreeRemovalPersistence);

  // These are the positions of the final workspaceId argument in the bridge.
  // Keeping the positional contract here leaves all legacy local callers intact.
  const workspaceIdPositions: Record<string, number> = {
    [GIT_STOP_POLLING]: 0,
    [GIT_REFRESH]: 0,
    [GIT_START_POLLING]: 1,
    [GIT_GET_BRANCH_STATE]: 1,
    [GIT_LIST_WORKTREES]: 1,
    [GIT_GET_OPERATION_STATE]: 1,
    [GIT_GET_STASHES]: 1,
    [GIT_CLEAR_STASHES]: 1,
    [GIT_ABORT_OPERATION]: 1,
    [GIT_GET_REMOTES]: 1,
    [GIT_GET_HISTORY]: 2,
    [GIT_STAGE]: 2,
    [GIT_UNSTAGE]: 2,
    [GIT_COMMIT]: 2,
    [GIT_SWITCH_BRANCH]: 2,
    [GIT_DELETE_BRANCH]: 2,
    [GIT_FORCE_DELETE_BRANCH]: 2,
    [GIT_MERGE_BRANCH]: 2,
    [GIT_APPLY_STASH]: 2,
    [GIT_POP_STASH]: 2,
    [GIT_DROP_STASH]: 2,
    [GIT_FETCH]: 2,
    [GIT_PULL]: 2,
    [GIT_REMOVE_REMOTE]: 2,
    [GIT_INIT]: 2,
    [GIT_CREATE_WORKTREE]: 3,
    [GIT_GET_DIFF]: 3,
    [GIT_GET_FILE_DIFF]: 3,
    [GIT_CREATE_BRANCH]: 3,
    [GIT_STASH]: 3,
    [GIT_ADD_REMOTE]: 3,
    [GIT_RENAME_REMOTE]: 3,
    [GIT_INSPECT_WORKTREE]: 3,
    [GIT_REMOVE_WORKTREE]: 4,
    [GIT_PUSH]: 5,
  };

  const registerGitHandler = (channel: string, handler: Parameters<typeof ipcMain.handle>[1]): void => {
    const idPosition = workspaceIdPositions[channel];
    if (idPosition === undefined) {
      ipcMain.handle(channel, handler);
      return;
    }
    ipcMain.handle(channel, async (event, ...args) => {
      const workspaceId: unknown = args[idPosition];
      if (workspaceId === undefined) return handler(event, ...args);
      if (typeof workspaceId !== 'string' || !workspaceId.trim()) {
        throw new Error('Invalid workspace identity');
      }
      const ws = getWorkspaceRegistry?.().getWorkspace(workspaceId);
      if (!ws) throw new Error('Workspace identity is no longer registered');
      const identity: GitWorkspaceIdentity = {
        workspacePath: ws.location.path,
        workspaceId: ws.workspaceId,
        environmentId: ws.location.environmentId,
      };
      if (channel === GIT_GET_FILE_DIFF && ws.location.environmentId !== 'local') {
        identity.readFile = (filePath) => {
          if (getWorkspaceRegistry?.().getWorkspace(ws.workspaceId) !== ws) {
            throw new Error('Workspace identity is no longer registered');
          }
          return ws.environment.readFile({
            workspacePath: ws.location.path,
            workspaceId: ws.workspaceId,
            filePath,
          });
        };
      }
      return gitService.withWorkspace(identity, () => handler(event, ...args));
    });
  };

  const resolveWorkspace = (workspaceId?: string) => {
    const id = workspaceId ?? gitService.getScopedWorkspaceIdentity?.()?.workspaceId;
    return id ? getWorkspaceRegistry?.().getWorkspace(id) ?? null : null;
  };

  const getValidatedWorkspacePath = (workspacePath: string | null | undefined): string | null => {
    if (!workspacePath) return null;
    const scoped = gitService.getScopedWorkspaceIdentity?.();
    return scoped?.workspacePath ?? getValidatedLocalWorkspacePath(workspacePath);
  };

  const refreshGitStatus = async (workspacePath: string): Promise<void> => {
    const status = await gitService.getStatus(workspacePath);
    const scoped = gitService.getScopedWorkspaceIdentity?.();
    if (scoped) {
      const registered = resolveWorkspace(scoped.workspaceId);
      if (!registered || registered.location.path !== scoped.workspacePath ||
          registered.location.environmentId !== scoped.environmentId) return;
      status.workspaceId = scoped.workspaceId;
      status.environmentId = scoped.environmentId;
    }
    status.workspacePath = workspacePath;
    getMainWindow()?.webContents.send(GIT_STATUS_UPDATE, status);
  };

  registerGitHandler(GIT_START_POLLING, (_, workspacePath: string, workspaceId?: string) => {
    const ws = resolveWorkspace(workspaceId);
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) return;
    gitService.startPolling(safeWorkspacePath, ws?.workspaceId, ws?.location.environmentId ?? 'local');
  });

  registerGitHandler(GIT_STOP_POLLING, (_, workspaceId?: string) => {
    if (workspaceId && gitService.getCurrentWorkspaceIdentity?.()?.workspaceId !== workspaceId) return;
    gitService.stopPolling();
  });

  registerGitHandler(GIT_GET_BRANCH_STATE, async (_, workspacePath: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return {
        success: false,
        isRepo: false,
        currentBranch: null,
        isDetached: false,
        branches: [],
        error: getInvalidWorkspaceResult().error,
      };
    }
    return gitService.getBranchState(safeWorkspacePath);
  });

  registerGitHandler(GIT_LIST_WORKTREES, async (_, workspacePath: string) => {
    const isRemote = (gitService.getScopedWorkspaceIdentity?.()?.environmentId ?? 'local') !== 'local';
    if (isRemote) {
      try { await remoteWorktrees.reconcile(gitService.getScopedWorkspaceIdentity()!.environmentId); }
      catch (error) { return { success: false, worktrees: [], error: error instanceof Error ? error.message : 'Could not verify remote removal completion' }; }
    }
    const safePath = getValidatedWorkspacePath(workspacePath);
    if (!safePath) return { success: false, worktrees: [], error: getInvalidWorkspaceResult().error };
    const result = await gitService.listWorktrees(safePath);
    return isRemote
      ? result
      : { ...result, worktrees: result.worktrees.map((entry) => ({ ...entry, path: toPosixPath(entry.path) })) };
  });

  registerGitHandler(GIT_CREATE_WORKTREE, async (_, workspacePath: string, baseRef: string, branch: string, _workspaceId?: string, options?: GitCreateWorktreeOptions) => {
    // A workspace id only routes the operation. Attaching the checkout as a worktree context is
    // explicit opt-in, so the legacy New Workspace flows (which open the checkout as a separate
    // workspace, and may pass the id of an open repository workspace) never gain a context.
    const ws = resolveWorkspace();
    const registry = getWorkspaceRegistry?.();
    const attachRequested = typeof options === 'object' && options !== null && options.attachCheckoutContext === true;
    if (attachRequested && (!ws || !registry)) {
      return { success: false, error: 'A registered workspace is required to attach a checkout context' };
    }
    const attach = (created: GitWorktreeCreateResult, listPath: string): Promise<GitWorktreeCreateResult> | GitWorktreeCreateResult =>
      attachRequested && ws && registry
        ? attachCreatedWorktree({ registry, workspace: ws, created, listWorktrees: () => gitService.listWorktrees(listPath) })
        : created;
    if (ws && ws.location.environmentId !== 'local') {
      const recoveryError = remoteWorktrees.getRecoveryError();
      if (recoveryError) return { success: false, error: recoveryError };
      if (!ws.environment.createWorktree) return { success: false, error: 'Worktree creation is unavailable for this environment' };
      return attach(await ws.environment.createWorktree(ws.location.path, baseRef, branch), ws.location.path);
    }
    const safePath = getValidatedWorkspacePath(workspacePath);
    if (!safePath) return getInvalidWorkspaceResult();
    const result = await gitService.createWorktree(safePath, baseRef, branch);
    return attach(result.worktree
      ? { ...result, worktree: { ...result.worktree, path: toPosixPath(result.worktree.path) } }
      : result, safePath);
  });

  registerGitHandler(REGISTER_OPEN_WORKSPACE, async (_, id: string, workspacePath: string, environmentId?: string) => {
    if (typeof id !== 'string' || !id.trim() || typeof workspacePath !== 'string') return getInvalidWorkspaceResult();
    // Damaged evidence cannot establish which host paths are safe to reopen.
    // Match registry defaults: omitted/blank environment IDs remain local.
    if (typeof environmentId === 'string' && environmentId.trim() && environmentId.trim() !== 'local') {
      const recoveryError = remoteWorktrees.getRecoveryError();
      if (recoveryError) return { success: false, error: recoveryError };
    }

    const reg = getWorkspaceRegistry?.();
    if (reg) {
      const result = await reg.registerWorkspace({
        workspaceId: id,
        workspacePath,
        environmentId,
      });
      if (!result.success) {
        return { success: false, error: result.error };
      }
      if (result.location?.environmentId === 'local') {
        const safePath = getValidatedLocalWorkspacePath(result.location.path);
        if (safePath) {
          gitService.registerOpenWorkspace(id, safePath);
        }
      }
      return { success: true, location: result.location, checkoutContext: result.checkoutContext };
    }

    const nativePath = toNativePath(workspacePath, process.platform);
    if (!path.isAbsolute(nativePath)) return getInvalidWorkspaceResult();
    const safePath = getValidatedLocalWorkspacePath(workspacePath);
    return safePath ? gitService.registerOpenWorkspace(id, safePath) : getInvalidWorkspaceResult();
  });

  registerGitHandler(UNREGISTER_OPEN_WORKSPACE, (_, id: string) => {
    if (typeof id !== 'string' || !id.trim()) return { success: false, error: 'Invalid workspace identity' };
    deps.onWorkspaceUnregistered?.(id);
    getWorkspaceRegistry?.()?.unregisterWorkspace(id);
    gitService.unregisterOpenWorkspace(id);
    if (gitService.getCurrentWorkspaceIdentity?.()?.workspaceId === id) {
      gitService.stopPolling();
    }
    return { success: true };
  });

  registerGitHandler(GIT_INSPECT_WORKTREE, async (_, workspacePath: string, worktreePath: string, openWorkspacePaths: string[]) => {
    const ws = resolveWorkspace();
    if (ws && ws.location.environmentId !== 'local') {
      return remoteWorktrees.inspect(ws, worktreePath);
    }
    const safePath = getValidatedWorkspacePath(workspacePath);
    const safeWorktreePath = getValidatedLocalWorkspacePath(worktreePath);
    const safeOpenPaths = getValidatedOpenWorkspacePaths(openWorkspacePaths);
    if (!safePath || !safeWorktreePath || !safeOpenPaths) return getInvalidWorkspaceResult();
    const result = await gitService.inspectWorktree(safePath, safeWorktreePath, safeOpenPaths);
    return result.worktree
      ? { ...result, worktree: { ...result.worktree, path: toPosixPath(result.worktree.path) } }
      : result;
  });

  registerGitHandler(GIT_REMOVE_WORKTREE, async (_, workspacePath: string, worktreePath: string, expectedBranch: string | null, openWorkspacePaths: string[]) => {
    const ws = resolveWorkspace();
    if (ws && ws.location.environmentId !== 'local') {
      return remoteWorktrees.remove(ws, worktreePath, expectedBranch);
    }
    const safePath = getValidatedWorkspacePath(workspacePath);
    const safeWorktreePath = getValidatedLocalWorkspacePath(worktreePath);
    const safeOpenPaths = getValidatedOpenWorkspacePaths(openWorkspacePaths);
    if (!safePath || !safeWorktreePath || !safeOpenPaths || (typeof expectedBranch !== 'string' && expectedBranch !== null)) {
      return getInvalidWorkspaceResult();
    }
    return gitService.removeWorktree(safePath, safeWorktreePath, expectedBranch, safeOpenPaths);
  });
  registerGitHandler(GIT_GET_OPERATION_STATE, async (_, workspacePath: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return {
        success: false,
        isRepo: false,
        inProgress: false,
        mode: 'none',
        conflicts: [],
        message: 'Workspace path is invalid or not a directory',
        error: getInvalidWorkspaceResult().error,
      };
    }
    return gitService.getOperationState(safeWorkspacePath);
  });

  registerGitHandler(GIT_GET_STASHES, async (_, workspacePath: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return [];
    }
    return gitService.listStashes(safeWorkspacePath);
  });

  registerGitHandler(GIT_GET_HISTORY, async (_, workspacePath: string, limit?: number) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return [];
    }
    return gitService.getHistory(safeWorkspacePath, limit);
  });

  registerGitHandler(GIT_GET_DIFF, async (
    _,
    workspacePath: string,
    mode: 'working' | 'staged' | 'commit',
    ref?: string
  ) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return {
        success: false,
        output: '',
        title: 'Diff',
        error: getInvalidWorkspaceResult().error,
      };
    }
    return gitService.getDiff(safeWorkspacePath, mode, ref);
  });

  registerGitHandler(GIT_STAGE, async (_, workspacePath: string, files?: string[]) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.stage(safeWorkspacePath, files);
    await refreshGitStatus(safeWorkspacePath);
    return result;
  });

  registerGitHandler(GIT_UNSTAGE, async (_, workspacePath: string, files?: string[]) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.unstage(safeWorkspacePath, files);
    await refreshGitStatus(safeWorkspacePath);
    return result;
  });

  registerGitHandler(GIT_COMMIT, async (_, workspacePath: string, message: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.commit(safeWorkspacePath, message);
    await refreshGitStatus(safeWorkspacePath);
    return result;
  });

  registerGitHandler(GIT_CREATE_BRANCH, async (_, workspacePath: string, name: string, baseBranch?: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.createBranch(safeWorkspacePath, name, baseBranch);
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath);
    }
    return result;
  });

  registerGitHandler(GIT_SWITCH_BRANCH, async (_, workspacePath: string, name: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.switchBranch(safeWorkspacePath, name);
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath);
    }
    return result;
  });

  registerGitHandler(GIT_DELETE_BRANCH, async (_, workspacePath: string, name: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.deleteBranch(safeWorkspacePath, name);
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath);
    }
    return result;
  });

  registerGitHandler(GIT_FORCE_DELETE_BRANCH, async (_, workspacePath: string, name: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.forceDeleteBranch(safeWorkspacePath, name);
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath);
    }
    return result;
  });

  registerGitHandler(GIT_MERGE_BRANCH, async (_, workspacePath: string, branchName: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.mergeBranch(safeWorkspacePath, branchName);
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath);
    }
    return result;
  });

  registerGitHandler(GIT_ABORT_OPERATION, async (_, workspacePath: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.abortCurrentOperation(safeWorkspacePath);
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath);
    }
    return result;
  });

  registerGitHandler(GIT_STASH, async (_, workspacePath: string, message?: string, includeUntracked?: boolean) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.stashChanges(safeWorkspacePath, message, includeUntracked);
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath);
    }
    return result;
  });

  registerGitHandler(GIT_APPLY_STASH, async (_, workspacePath: string, stashRef: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.applyStash(safeWorkspacePath, stashRef);
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath);
    }
    return result;
  });

  registerGitHandler(GIT_POP_STASH, async (_, workspacePath: string, stashRef: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.popStash(safeWorkspacePath, stashRef);
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath);
    }
    return result;
  });

  registerGitHandler(GIT_DROP_STASH, async (_, workspacePath: string, stashRef: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.dropStash(safeWorkspacePath, stashRef);
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath);
    }
    return result;
  });

  registerGitHandler(GIT_CLEAR_STASHES, async (_, workspacePath: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.clearStashes(safeWorkspacePath);
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath);
    }
    return result;
  });

  registerGitHandler(GIT_REFRESH, async (_, workspaceId?: string) => {
    if (workspaceId && gitService.getCurrentWorkspaceIdentity?.()?.workspaceId !== workspaceId) return null;
    const workspacePath = gitService.getCurrentWorkspace();
    if (!workspacePath) return null;
    const identity = gitService.getCurrentWorkspaceIdentity?.();
    if (identity) {
      const ws = getWorkspaceRegistry?.().getWorkspace(identity.workspaceId);
      if (!ws || ws.location.path !== identity.workspacePath ||
          ws.location.environmentId !== identity.environmentId) {
        gitService.stopPolling();
        throw new Error('Workspace identity is no longer registered');
      }
      return gitService.withWorkspace(identity, async () => {
        const status = await gitService.getStatus(ws.location.path);
        if (gitService.getCurrentWorkspaceIdentity?.()?.workspaceId !== identity.workspaceId ||
            gitService.getCurrentWorkspace() !== identity.workspacePath) return null;
        status.workspacePath = ws.location.path;
        status.workspaceId = ws.workspaceId;
        status.environmentId = ws.location.environmentId;
        return status;
      });
    }
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      gitService.stopPolling();
      return {
        success: false,
        isRepo: false,
        currentBranch: null,
        isDetached: false,
        changes: [],
        error: getInvalidWorkspaceResult().error,
      };
    }
    return gitService.getStatus(safeWorkspacePath);
  });

  registerGitHandler(GIT_INIT, async (_, workspacePath: string, defaultBranch?: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const isAlreadyRepo = await gitService.isRepo(safeWorkspacePath);
    if (isAlreadyRepo) {
      return { success: false, error: 'Already a git repository' };
    }
    const result = await gitService.initRepository(safeWorkspacePath, { defaultBranch });
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath);
    }
    return result;
  });

  registerGitHandler(GIT_GET_REMOTES, async (_, workspacePath: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return { success: false, remotes: [], provider: 'unknown', error: 'Invalid workspace path' };
    }
    return gitService.getRemotes(safeWorkspacePath);
  });

  registerGitHandler(GIT_FETCH, async (_, workspacePath: string, remote?: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return { success: false, error: 'Invalid workspace path' };
    }
    return gitService.fetch(safeWorkspacePath, remote);
  });

  registerGitHandler(GIT_PULL, async (_, workspacePath: string, rebase?: boolean) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return { success: false, error: 'Invalid workspace path' };
    }
    return gitService.pull(safeWorkspacePath, rebase);
  });

  registerGitHandler(GIT_PUSH, async (
    _,
    workspacePath: string,
    remote?: string,
    branch?: string,
    forceWithLease?: boolean,
    setUpstream?: boolean
  ) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return { success: false, error: 'Invalid workspace path' };
    }
    return gitService.push(safeWorkspacePath, remote, branch, forceWithLease, setUpstream);
  });

  registerGitHandler(GIT_ADD_REMOTE, async (_, workspacePath: string, name: string, url: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return { success: false, error: 'Invalid workspace path' };
    }
    if (typeof name !== 'string' || typeof url !== 'string') {
      return { success: false, error: 'Remote name and URL must be strings' };
    }
    return gitService.addRemote(safeWorkspacePath, name, url);
  });

  registerGitHandler(GIT_REMOVE_REMOTE, async (_, workspacePath: string, name: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return { success: false, error: 'Invalid workspace path' };
    }
    if (typeof name !== 'string') {
      return { success: false, error: 'Remote name must be a string' };
    }
    return gitService.removeRemote(safeWorkspacePath, name);
  });

  registerGitHandler(GIT_RENAME_REMOTE, async (_, workspacePath: string, oldName: string, newName: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return { success: false, error: 'Invalid workspace path' };
    }
    if (typeof oldName !== 'string' || typeof newName !== 'string') {
      return { success: false, error: 'Remote names must be strings' };
    }
    return gitService.renameRemote(safeWorkspacePath, oldName, newName);
  });

  registerGitHandler(GIT_GET_FILE_DIFF, async (_, workspacePath: string, filePath: string, mode: 'working' | 'staged') => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return {
        success: false,
        oldContent: '',
        newContent: '',
        oldPath: '',
        newPath: '',
        isBinary: false,
        hasDiff: false,
        error: getInvalidWorkspaceResult().error,
      };
    }
    return gitService.getFileDiff(safeWorkspacePath, filePath, mode);
  });

  // Event channel — registered so the integration test can verify completeness.
  // This is one-way: main sends events to renderer (no handler needed).
  ipcMain.on(GIT_STATUS_UPDATE, () => { });
}
