/**
 * Git IPC Handlers
 *
 * Registers all git-related IPC handlers. Extracted from main.ts per S2.4.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { GitService } from '../gitService';
import {
  getValidatedWorkspacePath,
  getInvalidWorkspaceResult,
  refreshGitStatus,
} from './settingsIpc';
import {
  GIT_START_POLLING,
  GIT_STOP_POLLING,
  GIT_GET_BRANCH_STATE,
  GIT_GET_OPERATION_STATE,
  GIT_GET_STASHES,
  GIT_GET_HISTORY,
  GIT_GET_DIFF,
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
}

export function registerGitIpc(deps: RegisterGitIpcDeps): void {
  const { getGitService, getMainWindow } = deps;
  const gitService = getGitService();

  ipcMain.handle(GIT_START_POLLING, (_, workspacePath: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return;
    }
    gitService.startPolling(safeWorkspacePath);
  });

  ipcMain.handle(GIT_STOP_POLLING, () => {
    gitService.stopPolling();
  });

  ipcMain.handle(GIT_GET_BRANCH_STATE, async (_, workspacePath: string) => {
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

  ipcMain.handle(GIT_GET_OPERATION_STATE, async (_, workspacePath: string) => {
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

  ipcMain.handle(GIT_GET_STASHES, async (_, workspacePath: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return [];
    }
    return gitService.listStashes(safeWorkspacePath);
  });

  ipcMain.handle(GIT_GET_HISTORY, async (_, workspacePath: string, limit?: number) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return [];
    }
    return gitService.getHistory(safeWorkspacePath, limit);
  });

  ipcMain.handle(GIT_GET_DIFF, async (
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

  ipcMain.handle(GIT_STAGE, async (_, workspacePath: string, files?: string[]) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.stage(safeWorkspacePath, files);
    await refreshGitStatus(safeWorkspacePath, getMainWindow, gitService);
    return result;
  });

  ipcMain.handle(GIT_UNSTAGE, async (_, workspacePath: string, files?: string[]) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.unstage(safeWorkspacePath, files);
    await refreshGitStatus(safeWorkspacePath, getMainWindow, gitService);
    return result;
  });

  ipcMain.handle(GIT_COMMIT, async (_, workspacePath: string, message: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.commit(safeWorkspacePath, message);
    await refreshGitStatus(safeWorkspacePath, getMainWindow, gitService);
    return result;
  });

  ipcMain.handle(GIT_CREATE_BRANCH, async (_, workspacePath: string, name: string, baseBranch?: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.createBranch(safeWorkspacePath, name, baseBranch);
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath, getMainWindow, gitService);
    }
    return result;
  });

  ipcMain.handle(GIT_SWITCH_BRANCH, async (_, workspacePath: string, name: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.switchBranch(safeWorkspacePath, name);
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath, getMainWindow, gitService);
    }
    return result;
  });

  ipcMain.handle(GIT_DELETE_BRANCH, async (_, workspacePath: string, name: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.deleteBranch(safeWorkspacePath, name);
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath, getMainWindow, gitService);
    }
    return result;
  });

  ipcMain.handle(GIT_FORCE_DELETE_BRANCH, async (_, workspacePath: string, name: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.forceDeleteBranch(safeWorkspacePath, name);
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath, getMainWindow, gitService);
    }
    return result;
  });

  ipcMain.handle(GIT_MERGE_BRANCH, async (_, workspacePath: string, branchName: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.mergeBranch(safeWorkspacePath, branchName);
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath, getMainWindow, gitService);
    }
    return result;
  });

  ipcMain.handle(GIT_ABORT_OPERATION, async (_, workspacePath: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.abortCurrentOperation(safeWorkspacePath);
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath, getMainWindow, gitService);
    }
    return result;
  });

  ipcMain.handle(GIT_STASH, async (_, workspacePath: string, message?: string, includeUntracked?: boolean) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.stashChanges(safeWorkspacePath, message, includeUntracked);
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath, getMainWindow, gitService);
    }
    return result;
  });

  ipcMain.handle(GIT_APPLY_STASH, async (_, workspacePath: string, stashRef: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.applyStash(safeWorkspacePath, stashRef);
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath, getMainWindow, gitService);
    }
    return result;
  });

  ipcMain.handle(GIT_POP_STASH, async (_, workspacePath: string, stashRef: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.popStash(safeWorkspacePath, stashRef);
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath, getMainWindow, gitService);
    }
    return result;
  });

  ipcMain.handle(GIT_DROP_STASH, async (_, workspacePath: string, stashRef: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.dropStash(safeWorkspacePath, stashRef);
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath, getMainWindow, gitService);
    }
    return result;
  });

  ipcMain.handle(GIT_CLEAR_STASHES, async (_, workspacePath: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return getInvalidWorkspaceResult();
    }
    const result = await gitService.clearStashes(safeWorkspacePath);
    if (result.success) {
      await refreshGitStatus(safeWorkspacePath, getMainWindow, gitService);
    }
    return result;
  });

  ipcMain.handle(GIT_REFRESH, async () => {
    const workspacePath = gitService.getCurrentWorkspace();
    if (!workspacePath) {
      return null;
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

  ipcMain.handle(GIT_INIT, async (_, workspacePath: string, defaultBranch?: string) => {
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
      await refreshGitStatus(safeWorkspacePath, getMainWindow, gitService);
    }
    return result;
  });

  ipcMain.handle(GIT_GET_REMOTES, async (_, workspacePath: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return { success: false, remotes: [], provider: 'unknown', error: 'Invalid workspace path' };
    }
    return gitService.getRemotes(safeWorkspacePath);
  });

  ipcMain.handle(GIT_FETCH, async (_, workspacePath: string, remote?: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return { success: false, error: 'Invalid workspace path' };
    }
    return gitService.fetch(safeWorkspacePath, remote);
  });

  ipcMain.handle(GIT_PULL, async (_, workspacePath: string, rebase?: boolean) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return { success: false, error: 'Invalid workspace path' };
    }
    return gitService.pull(safeWorkspacePath, rebase);
  });

  ipcMain.handle(
    GIT_PUSH,
    async (
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
    }
  );

  ipcMain.handle(GIT_ADD_REMOTE, async (_, workspacePath: string, name: string, url: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return { success: false, error: 'Invalid workspace path' };
    }
    if (typeof name !== 'string' || typeof url !== 'string') {
      return { success: false, error: 'Remote name and URL must be strings' };
    }
    return gitService.addRemote(safeWorkspacePath, name, url);
  });

  ipcMain.handle(GIT_REMOVE_REMOTE, async (_, workspacePath: string, name: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return { success: false, error: 'Invalid workspace path' };
    }
    if (typeof name !== 'string') {
      return { success: false, error: 'Remote name must be a string' };
    }
    return gitService.removeRemote(safeWorkspacePath, name);
  });

  ipcMain.handle(GIT_RENAME_REMOTE, async (_, workspacePath: string, oldName: string, newName: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return { success: false, error: 'Invalid workspace path' };
    }
    if (typeof oldName !== 'string' || typeof newName !== 'string') {
      return { success: false, error: 'Remote names must be strings' };
    }
    return gitService.renameRemote(safeWorkspacePath, oldName, newName);
  });

  // Event channel — registered so the integration test can verify completeness.
  // This is one-way: main sends events to renderer (no handler needed).
  ipcMain.on(GIT_STATUS_UPDATE, () => { });
}
