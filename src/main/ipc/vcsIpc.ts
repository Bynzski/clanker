/**
 * VCS IPC Handlers
 *
 * Registers all VCS-related IPC handlers. Extracted from main.ts per S2.5.
 */

import { ipcMain, shell } from 'electron';
import {
  getProviderContext,
  getProviderDeepLinks,
  getDeepLinkUrl,
  type ProviderContextResult,
  type DeepLink,
} from '../vcs';
import { GitService } from '../gitService';
import { getValidatedWorkspacePath } from './aiCommitIpc';
import {
  VCS_GET_CONTEXT,
  VCS_GET_PR_INFO,
  VCS_GET_DEEP_LINKS,
  VCS_GET_DEEP_LINK,
  VCS_OPEN_DEEP_LINK,
} from '../../shared/ipcChannels';

export interface RegisterVcsIpcDeps {
  getGitService: () => GitService;
}

export function registerVcsIpc(deps: RegisterVcsIpcDeps): void {
  const { getGitService } = deps;
  const gitService = getGitService();

  ipcMain.handle(VCS_GET_CONTEXT, async (_, workspacePath: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return {
        success: false,
        error: 'Invalid workspace path',
      } as ProviderContextResult;
    }

    // Get current branch and remotes
    const [branchState, remotesResult] = await Promise.all([
      gitService.getBranchState(safeWorkspacePath),
      gitService.getRemotes(safeWorkspacePath),
    ]);

    if (!branchState.success || !remotesResult.success || remotesResult.remotes.length === 0) {
      return {
        success: false,
        error: 'Not a git repository or no remotes configured',
      } as ProviderContextResult;
    }

    const currentBranch = branchState.currentBranch || 'main';
    const primaryRemote = remotesResult.remotes[0];

    return getProviderContext(
      primaryRemote.name,
      primaryRemote.fetchUrl,
      currentBranch
    );
  });

  ipcMain.handle(VCS_GET_PR_INFO, async (_, workspacePath: string) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return { success: false, error: 'Invalid workspace path' };
    }

    const [branchState, remotesResult] = await Promise.all([
      gitService.getBranchState(safeWorkspacePath),
      gitService.getRemotes(safeWorkspacePath),
    ]);

    if (!branchState.success || !remotesResult.success || remotesResult.remotes.length === 0) {
      return { success: false, error: 'Not a git repository or no remotes' };
    }

    const currentBranch = branchState.currentBranch || 'main';
    const primaryRemote = remotesResult.remotes[0];

    const contextResult = await getProviderContext(
      primaryRemote.name,
      primaryRemote.fetchUrl,
      currentBranch
    );

    return {
      success: contextResult.success,
      provider: contextResult.provider,
      pullRequest: contextResult.pullRequest,
      deepLinks: contextResult.deepLinks,
      error: contextResult.error,
    };
  });

  ipcMain.handle(VCS_GET_DEEP_LINKS, async (_, workspacePath: string, prNumber?: number) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return [] as DeepLink[];
    }

    const [branchState, remotesResult] = await Promise.all([
      gitService.getBranchState(safeWorkspacePath),
      gitService.getRemotes(safeWorkspacePath),
    ]);

    if (!branchState.success || !remotesResult.success || remotesResult.remotes.length === 0) {
      return [] as DeepLink[];
    }

    const currentBranch = branchState.currentBranch || undefined;
    const primaryRemote = remotesResult.remotes[0];

    const contextResult = await getProviderContext(
      primaryRemote.name,
      primaryRemote.fetchUrl,
      currentBranch || 'main'
    );

    const defaultBranch = contextResult.provider?.defaultBranch;

    return getProviderDeepLinks(primaryRemote.fetchUrl, currentBranch, prNumber, defaultBranch);
  });

  ipcMain.handle(VCS_GET_DEEP_LINK, async (_, workspacePath: string, type: DeepLink['type']) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return null;
    }

    const [branchState, remotesResult] = await Promise.all([
      gitService.getBranchState(safeWorkspacePath),
      gitService.getRemotes(safeWorkspacePath),
    ]);

    if (!branchState.success || !remotesResult.success || remotesResult.remotes.length === 0) {
      return null;
    }

    const currentBranch = branchState.currentBranch || undefined;
    const primaryRemote = remotesResult.remotes[0];

    // First get context to find PR number if it exists
    const contextResult = await getProviderContext(
      primaryRemote.name,
      primaryRemote.fetchUrl,
      currentBranch || 'main'
    );

    const prNumber = contextResult.pullRequest?.exists ? contextResult.pullRequest.number : undefined;
    const defaultBranch = contextResult.provider?.defaultBranch;

    return getDeepLinkUrl(primaryRemote.fetchUrl, type, currentBranch, prNumber, defaultBranch);
  });

  ipcMain.handle(VCS_OPEN_DEEP_LINK, async (_, workspacePath: string, type: DeepLink['type']) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return false;
    }

    const [branchState, remotesResult] = await Promise.all([
      gitService.getBranchState(safeWorkspacePath),
      gitService.getRemotes(safeWorkspacePath),
    ]);

    if (!branchState.success || !remotesResult.success || remotesResult.remotes.length === 0) {
      return false;
    }

    const currentBranch = branchState.currentBranch || undefined;
    const primaryRemote = remotesResult.remotes[0];

    const contextResult = await getProviderContext(
      primaryRemote.name,
      primaryRemote.fetchUrl,
      currentBranch || 'main'
    );

    const prNumber = contextResult.pullRequest?.exists ? contextResult.pullRequest.number : undefined;
    const defaultBranch = contextResult.provider?.defaultBranch;

    const url = getDeepLinkUrl(primaryRemote.fetchUrl, type, currentBranch, prNumber, defaultBranch);
    if (url) {
      void shell.openExternal(url);
      return true;
    }

    return false;
  });
}
