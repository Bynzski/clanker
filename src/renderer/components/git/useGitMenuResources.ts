import { useCallback } from 'react';
import type { GitBranchStateResult, GitOperationStateResult, GitHistoryEntry, GitStash, GitRemotesResult } from '../../../shared/types/git';
import type { ProviderContextResult } from '../../../shared/types/vcs';
import { useGitMenuResource } from './useGitMenuResource';
import type { gitManagementScope } from './gitManagementScope';

export type GitMenuPage = 'changes' | 'history' | 'overview' | 'branches' | 'worktrees' | 'stashes' | 'remotes' | 'merge';
export function useGitMenuResources(scope: ReturnType<typeof gitManagementScope>, workspacePath: string,
  workspaceId: string | undefined, isCurrent: () => boolean) {
  const branch = useGitMenuResource<GitBranchStateResult>(isCurrent);
  const operation = useGitMenuResource<GitOperationStateResult>(isCurrent);
  const history = useGitMenuResource<GitHistoryEntry[]>(isCurrent);
  const stash = useGitMenuResource<GitStash[]>(isCurrent);
  const remote = useGitMenuResource<GitRemotesResult>(isCurrent);
  const provider = useGitMenuResource<ProviderContextResult>(isCurrent);
  const { load: loadBranches, invalidate: invalidateBranches } = branch;
  const { load: loadOperation, invalidate: invalidateOperation } = operation;
  const { load: loadHistory, invalidate: invalidateHistory } = history;
  const { load: loadStashes, invalidate: invalidateStashes } = stash;
  const { load: loadRemotes, invalidate: invalidateRemotes } = remote;
  const { load: loadProvider, invalidate: invalidateProvider } = provider;
  const readBranches = useCallback((force = false) => loadBranches(async () => {
    const data = await window.electronAPI.gitGetBranchState(scope.path, workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : []));
    if (!data.success) throw new Error(data.error || 'Unable to load branch state');
    return { data };
  }, force), [loadBranches, scope.path, scope.checkoutContextId, workspaceId]);
  const readOperation = useCallback((force = false) => loadOperation(async () => {
    const data = await window.electronAPI.gitGetOperationState(scope.path, workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : []));
    if (!data.success) throw new Error(data.error || data.message || 'Unable to load operation state');
    return { data };
  }, force), [loadOperation, scope.path, scope.checkoutContextId, workspaceId]);
  const readHistory = useCallback((force = false, limit = 10) => loadHistory(async () => ({
    data: await window.electronAPI.gitGetHistory(scope.path, limit, workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : [])),
  }), force), [loadHistory, scope.path, scope.checkoutContextId, workspaceId]);
  const readStashes = useCallback((force = false) => loadStashes(async () => ({
    data: await window.electronAPI.gitGetStashes(scope.path, workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : [])),
  }), force), [loadStashes, scope.path, scope.checkoutContextId, workspaceId]);
  const readRemotes = useCallback((force = false) => loadRemotes(async () => {
    const data = await window.electronAPI.gitGetRemotes(workspacePath, workspaceId);
    if (!data.success) throw new Error(data.error || 'Unable to load remotes');
    return { data };
  }, force), [loadRemotes, workspacePath, workspaceId]);
  const readProvider = useCallback((force = false) => loadProvider(async () => {
    const options = scope.checkoutContextId || force ? { checkoutContextId: scope.checkoutContextId, refresh: force } : undefined;
    const data = options ? await window.electronAPI.vcsGetContext(workspacePath, workspaceId, options)
      : await window.electronAPI.vcsGetContext(workspacePath, workspaceId);
    if (!data.success && !['found', 'none'].includes(data.pullRequest?.outcome ?? '')) throw new Error(data.error || 'Provider context unavailable');
    return { data, error: data.error ?? (data.success ? undefined : 'Provider context unavailable') };
  }, force), [loadProvider, workspacePath, workspaceId, scope.checkoutContextId]);
  const close = useCallback(() => {
    invalidateBranches(); invalidateOperation(); invalidateHistory(); invalidateStashes(); invalidateRemotes(); invalidateProvider();
  }, [invalidateBranches, invalidateOperation, invalidateHistory, invalidateStashes, invalidateRemotes, invalidateProvider]);
  return { branch, operation, history, stash, remote, provider, readBranches, readOperation, readHistory, readStashes, readRemotes, readProvider, close };
}
