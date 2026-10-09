import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { ProviderContextResult } from '../../../src/main/vcs/types';
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, shell: { openExternal: vi.fn() } }));
vi.mock('../../../src/main/vcs', () => ({ getProviderContext: vi.fn(), getProviderDeepLinks: vi.fn(), getDeepLinkUrl: vi.fn(), getProviderPrLink: vi.fn() }));
vi.mock('../../../src/main/ipc/aiCommitIpc', () => ({ getValidatedWorkspacePath: vi.fn() }));
vi.mock('../../../src/main/credential/credentialService', () => ({ getCredentialRevision: () => 0 }));
import { ipcMain, shell } from 'electron';
import { getProviderContext, getProviderDeepLinks, getDeepLinkUrl, getProviderPrLink } from '../../../src/main/vcs';
import { getValidatedWorkspacePath } from '../../../src/main/ipc/aiCommitIpc';
import { registerVcsIpc } from '../../../src/main/ipc/vcsIpc';
import { GitService } from '../../../src/main/gitService';
import type { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import { VCS_GET_CONTEXT, VCS_GET_PR_INFO, VCS_GET_DEEP_LINKS, VCS_GET_DEEP_LINK, VCS_OPEN_DEEP_LINK } from '../../../src/shared/ipcChannels';
const SHA = 'a'.repeat(40);
const snapshot = { sha: SHA, branch: 'feature/topic', remoteName: 'upstream', remoteUrl: 'https://github.com/owner/repo.git' };
const success: ProviderContextResult = { success: true, deepLinks: [], pullRequest: { exists: false, outcome: 'none' } };
let git: GitService;
let workspace: { id: string; location: { path: string; environmentId: string } } | null;
let main: { id: string; workspaceId: string; environmentId: string; path: string; missing?: boolean };
let isolated: typeof main | null;
let rootRegistered: boolean;
function register() {
  const registry = { getWorkspace: (id: string) => id === 'ws' ? workspace : null,
    resolveCheckoutContext: (id: string, context?: string) => id !== 'ws' || !rootRegistered ? null
      : !context || context === main.id ? main : context === isolated?.id ? isolated : null };
  registerVcsIpc({ getGitService: () => git, getWorkspaceRegistry: () => registry as unknown as WorkspaceRegistry });
}
async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const listener = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1] as (...args: unknown[]) => Promise<unknown>;
  return listener({}, ...args);
}
beforeEach(() => {
  vi.clearAllMocks(); git = new GitService(() => {});
  vi.spyOn(git, 'getVcsSnapshot').mockResolvedValue({ ...snapshot });
  vi.mocked(getProviderContext).mockResolvedValue(success);
  vi.mocked(getValidatedWorkspacePath).mockImplementation((path) => path === '/repo' ? path : null);
  workspace = { id: 'ws', location: { path: '/repo', environmentId: 'local' } };
  main = { id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: '/repo' };
  isolated = { id: 'isolated', workspaceId: 'ws', environmentId: 'local', path: '/repo-worktrees/topic' };
  rootRegistered = true; register();
});
describe('authoritative checkout-scoped VCS IPC', () => {
  it('registers canonical read-only/navigation channels', () => {
    expect(vi.mocked(ipcMain.handle).mock.calls.map(([name]) => name)).toEqual([VCS_GET_CONTEXT, VCS_GET_PR_INFO, VCS_GET_DEEP_LINKS, VCS_GET_DEEP_LINK, VCS_OPEN_DEEP_LINK]);
  });
  it('does not fall back to local paths for unknown workspaces or foreign contexts', async () => {
    expect(await invoke(VCS_GET_CONTEXT, '/repo', 'unknown')).toMatchObject({ success: false });
    expect(await invoke(VCS_GET_CONTEXT, '/repo', 'ws', { checkoutContextId: 'foreign' })).toMatchObject({ success: false });
    expect(await invoke(VCS_GET_CONTEXT, '/repo-worktrees/topic', 'ws', { checkoutContextId: 'isolated' })).toMatchObject({ success: false });
    expect(getValidatedWorkspacePath).not.toHaveBeenCalled(); expect(git.getVcsSnapshot).not.toHaveBeenCalled(); expect(getProviderContext).not.toHaveBeenCalled();
  });
  it('routes an isolated checkout through registered identity, not supplied path', async () => {
    const scopes: unknown[] = [];
    vi.mocked(git.getVcsSnapshot).mockImplementation(async () => { scopes.push(git.getScopedWorkspaceIdentity()); return { ...snapshot }; });
    expect(await invoke(VCS_GET_CONTEXT, '/repo', 'ws', { checkoutContextId: 'isolated' })).toEqual(success);
    expect(scopes).toEqual(Array(2).fill({ workspaceId: 'ws', environmentId: 'local', checkoutContextId: 'isolated', workspacePath: isolated!.path }));
    expect(getProviderContext).toHaveBeenCalledWith('upstream', snapshot.remoteUrl, snapshot.branch, '', expect.objectContaining({ identity: expect.objectContaining({ checkoutPath: isolated!.path, headSha: SHA, checkoutContextId: 'isolated' }) }));
  });
  it('uses SSH environment identity even at an identical local path', async () => {
    workspace!.location.environmentId = 'ssh:host'; main.environmentId = 'ssh:host';
    await invoke(VCS_GET_PR_INFO, '/repo', 'ws');
    expect(getProviderContext).toHaveBeenCalledWith('upstream', snapshot.remoteUrl, snapshot.branch, '', expect.objectContaining({ identity: expect.objectContaining({ environmentId: 'ssh:host' }) }));
    expect(getValidatedWorkspacePath).not.toHaveBeenCalled();
  });
  it.each(['HEAD', 'branch', 'remote', 'closed', 'released', 'replaced'])('rejects a late result after %s changes', async (change) => {
    let complete!: (result: ProviderContextResult) => void;
    vi.mocked(getProviderContext).mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const pending = invoke(VCS_GET_CONTEXT, '/repo', 'ws', { checkoutContextId: 'isolated' });
    await vi.waitFor(() => expect(complete).toBeDefined());
    if (change === 'HEAD') vi.mocked(git.getVcsSnapshot).mockResolvedValue({ ...snapshot, sha: 'b'.repeat(40) });
    if (change === 'branch') vi.mocked(git.getVcsSnapshot).mockResolvedValue({ ...snapshot, branch: 'other' });
    if (change === 'remote') vi.mocked(git.getVcsSnapshot).mockResolvedValue({ ...snapshot, remoteUrl: 'https://github.com/other/repo' });
    if (change === 'closed') workspace = null;
    if (change === 'released') isolated = null;
    if (change === 'replaced') isolated = { ...isolated! };
    complete(success); expect(await pending).toMatchObject({ success: false, problem: { code: 'stale' }, deepLinks: [] });
  });
  it('keeps detached HEAD explicit rather than inventing main', async () => {
    vi.mocked(git.getVcsSnapshot).mockResolvedValue({ ...snapshot, branch: null });
    await invoke(VCS_GET_CONTEXT, '/repo', 'ws');
    expect(getProviderContext).toHaveBeenCalledWith('upstream', snapshot.remoteUrl, '', '', expect.objectContaining({ identity: expect.objectContaining({ branch: null }) }));
  });
  it.each(['repo', 'branches', 'issues', 'releases', 'actions', 'create-pr'])('keeps static %s navigation provider-API-free', async (type) => {
    vi.mocked(getDeepLinkUrl).mockReturnValue('https://github.com/owner/repo');
    expect(await invoke(VCS_OPEN_DEEP_LINK, '/repo', type, 'ws')).toBe(true);
    expect(shell.openExternal).toHaveBeenCalledWith('https://github.com/owner/repo');
    expect(getProviderContext).not.toHaveBeenCalled(); expect(getProviderPrLink).not.toHaveBeenCalled();
  });
  it('keeps PR navigation PR-only, supplying authoritative HEAD', async () => {
    vi.mocked(getProviderPrLink).mockResolvedValue('https://github.com/owner/repo/pull/7');
    expect(await invoke(VCS_GET_DEEP_LINK, '/repo', 'pr', 'ws')).toBe('https://github.com/owner/repo/pull/7');
    expect(getProviderPrLink).toHaveBeenCalledWith(snapshot.remoteUrl, snapshot.branch, expect.objectContaining({ identity: expect.objectContaining({ headSha: SHA }) }));
    expect(getProviderContext).not.toHaveBeenCalled();
  });
  it('allows validated legacy local roots only without any checkout identity', async () => {
    await invoke(VCS_GET_CONTEXT, '/repo'); expect(getValidatedWorkspacePath).toHaveBeenCalled();
    vi.mocked(getProviderDeepLinks).mockReturnValue([]); expect(await invoke(VCS_GET_DEEP_LINKS, '/repo')).toEqual([]);
    expect(await invoke(VCS_GET_CONTEXT, '/bad')).toMatchObject({ success: false });
  });
});
