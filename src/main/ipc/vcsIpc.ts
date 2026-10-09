import { ipcMain, shell } from 'electron';
import { getProviderContext, getProviderDeepLinks, getDeepLinkUrl, getProviderPrLink, type DeepLink } from '../vcs';
import type { GitService } from '../gitService';
import { getValidatedWorkspacePath } from './aiCommitIpc';
import type { WorkspaceRegistry } from '../workspaceRegistry';
import type { VcsRequestIdentity, VcsRequestOptions } from '../../shared/types/vcs';
import { toPosixPath } from '../../shared/pathNormalize';
import { problem } from '../vcs/statusModel';
import { instancePolicyRevision } from '../vcs/instancePolicy';
import { getCredentialRevision } from '../credential/credentialService';
import { VCS_GET_CONTEXT, VCS_GET_PR_INFO, VCS_GET_DEEP_LINKS, VCS_GET_DEEP_LINK, VCS_OPEN_DEEP_LINK } from '../../shared/ipcChannels';

export interface RegisterVcsIpcDeps { getGitService: () => GitService; getWorkspaceRegistry?: () => WorkspaceRegistry }

export function registerVcsIpc(deps: RegisterVcsIpcDeps): void {
  const git = deps.getGitService();
  const generations = new Map<string, { signature: string }>();
  const resolve = (suppliedPath: string, workspaceId?: string, checkoutContextId?: string) => {
    const registry = deps.getWorkspaceRegistry?.();
    if (typeof suppliedPath !== 'string') return null;
    if (workspaceId !== undefined) {
      if (typeof workspaceId !== 'string' || !workspaceId) return null;
      const workspace = registry?.getWorkspace(workspaceId);
      const context = registry?.resolveCheckoutContext(workspaceId, checkoutContextId);
      if (!workspace || !context || context.missing || suppliedPath !== workspace.location.path
        || context.environmentId !== workspace.location.environmentId) return null;
      return { path: context.path, workspace, context,
        live: () => registry?.getWorkspace(workspaceId) === workspace
          && registry.resolveCheckoutContext(workspaceId, context.id) === context && !context.missing,
        read: () => git.withWorkspace({ workspaceId, workspacePath: context.path,
          environmentId: context.environmentId, checkoutContextId: context.id }, () => git.getVcsSnapshot(context.path)) };
    }
    if (checkoutContextId !== undefined) return null;
    const path = getValidatedWorkspacePath(suppliedPath);
    return path ? { path, workspace: null, context: null, live: () => !!getValidatedWorkspacePath(path), read: () => git.getVcsSnapshot(path) } : null;
  };
  const metadata = async (path: string, workspaceId?: string, options: VcsRequestOptions = {}) => {
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || (options.checkoutContextId !== undefined && (typeof options.checkoutContextId !== 'string' || !options.checkoutContextId))
      || (options.refresh !== undefined && typeof options.refresh !== 'boolean')) return null;
    const root = resolve(path, workspaceId, options.checkoutContextId);
    if (!root) return null;
    const snapshot = await root.read();
    if (!snapshot?.remoteName || !snapshot.remoteUrl || !root.live()) return null;
    const identity: VcsRequestIdentity = { workspaceId, environmentId: root.context?.environmentId ?? 'local',
      checkoutContextId: root.context?.id, checkoutPath: toPosixPath(root.path), remoteName: snapshot.remoteName,
      remoteUrl: snapshot.remoteUrl, branch: snapshot.branch, headSha: snapshot.sha };
    const key = JSON.stringify([workspaceId, identity.environmentId, identity.checkoutContextId, root.path]);
    const signature = JSON.stringify(identity);
    const previous = generations.get(key);
    const generation = previous && previous.signature === signature && !options.refresh ? previous : { signature };
    while (generations.size >= 128 && !generations.has(key)) generations.delete(generations.keys().next().value!);
    generations.set(key, generation);
    const revision = getCredentialRevision();
    const policyRevision = instancePolicyRevision();
    const validRevision = () => getCredentialRevision() === revision && instancePolicyRevision() === policyRevision;
    return { identity, root, fresh: async () => {
      if (!root.live() || generations.get(key) !== generation || !validRevision()) return false;
      const latest = await root.read();
      return root.live() && generations.get(key) === generation && validRevision()
        && JSON.stringify(latest) === JSON.stringify(snapshot);
    } };
  };
  const failure = (code: 'unsupported' | 'stale' | 'unknown') => ({ success: false, problem: problem(code), error: problem(code).message, deepLinks: [] });
  const context = async (path: string, workspaceId?: string, options: VcsRequestOptions = {}) => {
    const request = await metadata(path, workspaceId, options);
    if (!request) return failure('unsupported');
    const { identity } = request;
    const result = await getProviderContext(identity.remoteName, identity.remoteUrl, identity.branch ?? '', '', { identity, refresh: options.refresh })
      .catch(() => failure('unknown'));
    return await request.fresh() ? result : failure('stale');
  };
  ipcMain.handle(VCS_GET_CONTEXT, (_, path: string, id?: string, options?: VcsRequestOptions) => context(path, id, options));
  ipcMain.handle(VCS_GET_PR_INFO, (_, path: string, id?: string, options?: VcsRequestOptions) => context(path, id, options));
  ipcMain.handle(VCS_GET_DEEP_LINKS, async (_, path: string, number?: number, id?: string, options?: VcsRequestOptions) => {
    const request = await metadata(path, id, options);
    if (!request) return [];
    const links = getProviderDeepLinks(request.identity.remoteUrl, request.identity.branch ?? undefined, number);
    return await request.fresh() ? links : [];
  });
  const link = async (path: string, type: DeepLink['type'], id?: string, options?: VcsRequestOptions) => {
    const request = await metadata(path, id, options);
    if (!request) return null;
    const { identity } = request;
    const url = type === 'pr' ? await getProviderPrLink(identity.remoteUrl, identity.branch ?? undefined, { identity })
      : getDeepLinkUrl(identity.remoteUrl, type, identity.branch ?? undefined);
    return await request.fresh() ? url : null;
  };
  ipcMain.handle(VCS_GET_DEEP_LINK, (_, path: string, type: DeepLink['type'], id?: string, options?: VcsRequestOptions) => link(path, type, id, options));
  ipcMain.handle(VCS_OPEN_DEEP_LINK, async (_, path: string, type: DeepLink['type'], id?: string, options?: VcsRequestOptions) => {
    const url = await link(path, type, id, options);
    if (!url) return false;
    try { await shell.openExternal(url); return true; } catch { return false; }
  });
}
