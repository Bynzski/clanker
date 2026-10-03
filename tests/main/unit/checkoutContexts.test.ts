import { describe, expect, it, vi } from 'vitest';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import type { WorkspaceEnvironment } from '../../../src/main/environment/workspaceEnvironment';
import { LOCAL_ENVIRONMENT_ID } from '../../../src/shared/types/environments';
import { mainCheckoutContextId } from '../../../src/shared/checkoutContext';

function createEnvironment(id: string, resolve?: (path: string) => string) {
  return {
    id,
    kind: id === LOCAL_ENVIRONMENT_ID ? 'local' : 'ssh',
    validateWorkspacePath: vi.fn(async (path: string) => (
      path.includes('missing')
        ? { valid: false, error: 'Path does not exist' }
        : { valid: true, resolvedPath: resolve ? resolve(path) : path }
    )),
  } as unknown as WorkspaceEnvironment & { validateWorkspacePath: ReturnType<typeof vi.fn> };
}

function createRegistry(options?: { isWorktreeBeingRemoved?: (path: string) => boolean; resolve?: (path: string) => string }) {
  const local = createEnvironment(LOCAL_ENVIRONMENT_ID, options?.resolve);
  const remote = createEnvironment('vps', options?.resolve);
  const registry = new WorkspaceRegistry(
    (id) => (id === LOCAL_ENVIRONMENT_ID ? local : id === 'vps' ? remote : null),
    options?.isWorktreeBeingRemoved ? { isWorktreeBeingRemoved: options.isWorktreeBeingRemoved } : undefined,
  );
  return { registry, local, remote };
}

describe('WorkspaceRegistry checkout contexts', () => {
  describe('main context', () => {
    it('gives every newly registered workspace a main checkout context at its canonical root', async () => {
      const { registry } = createRegistry();
      const result = await registry.registerWorkspace({ workspaceId: 'ws-1', workspacePath: '/home/user/project/' });

      expect(result.checkoutContext).toEqual({
        id: mainCheckoutContextId('ws-1'),
        workspaceId: 'ws-1',
        environmentId: LOCAL_ENVIRONMENT_ID,
        path: '/home/user/project',
        kind: 'main',
      });
      expect(registry.getCheckoutContext(mainCheckoutContextId('ws-1'))).toMatchObject({ path: '/home/user/project' });
      expect(registry.getCheckoutContextsForWorkspace('ws-1')).toHaveLength(1);
    });

    it('resolves "no context requested" to the main checkout, for local and SSH', async () => {
      const { registry } = createRegistry();
      await registry.registerWorkspace({ workspaceId: 'local-ws', workspacePath: '/work/app' });
      await registry.registerWorkspace({ workspaceId: 'ssh-ws', workspacePath: '/srv/app', environmentId: 'vps' });

      expect(registry.resolveCheckoutContext('local-ws')).toMatchObject({ environmentId: 'local', path: '/work/app', kind: 'main' });
      expect(registry.resolveCheckoutContext('ssh-ws')).toMatchObject({ environmentId: 'vps', path: '/srv/app', kind: 'main' });
    });

    it('does not create a context for a failed registration', async () => {
      const { registry } = createRegistry();
      await registry.registerWorkspace({ workspaceId: 'ws-bad', workspacePath: '/missing/dir' });
      expect(registry.getAllCheckoutContexts()).toEqual([]);
      expect(registry.resolveCheckoutContext('ws-bad')).toBeNull();
    });

    it('cannot be unregistered independently of its workspace', async () => {
      const { registry } = createRegistry();
      await registry.registerWorkspace({ workspaceId: 'ws-1', workspacePath: '/work/app' });
      expect(registry.unregisterCheckoutContext(mainCheckoutContextId('ws-1'))).toBe(false);
      expect(registry.resolveCheckoutContext('ws-1')).not.toBeNull();
    });
  });

  describe('registering a worktree context', () => {
    it('validates the worktree root itself, without widening the workspace root', async () => {
      const { registry, remote } = createRegistry();
      await registry.registerWorkspace({ workspaceId: 'ws-1', workspacePath: '/projects/clanker', environmentId: 'vps' });

      const result = await registry.registerCheckoutContext({
        workspaceId: 'ws-1',
        path: '/projects/clanker-worktrees/issue-90',
        kind: 'worktree',
        branch: 'issue-90',
        mainCheckoutPath: '/projects/clanker/',
      });

      expect(result.success).toBe(true);
      expect(remote.validateWorkspacePath).toHaveBeenCalledWith('/projects/clanker-worktrees/issue-90');
      expect(result.checkoutContext).toMatchObject({
        workspaceId: 'ws-1',
        environmentId: 'vps',
        path: '/projects/clanker-worktrees/issue-90',
        kind: 'worktree',
        branch: 'issue-90',
        mainCheckoutPath: '/projects/clanker',
      });
      // The workspace itself is untouched: its root did not grow to cover the sibling.
      expect(registry.getWorkspace('ws-1')?.location.path).toBe('/projects/clanker');
      expect(registry.resolveCheckoutContext('ws-1')?.path).toBe('/projects/clanker');
    });

    it('stores the canonical path reported by the environment, not the requested one', async () => {
      const { registry } = createRegistry({ resolve: (path) => path.replace('/link', '/real') });
      await registry.registerWorkspace({ workspaceId: 'ws-1', workspacePath: '/work/app' });
      const result = await registry.registerCheckoutContext({ workspaceId: 'ws-1', path: '/work/link/wt', kind: 'worktree' });
      expect(result.checkoutContext?.path).toBe('/work/real/wt');
    });

    it('is idempotent for the same root and distinct for different roots', async () => {
      const { registry } = createRegistry();
      await registry.registerWorkspace({ workspaceId: 'ws-1', workspacePath: '/work/app' });
      const first = await registry.registerCheckoutContext({ workspaceId: 'ws-1', path: '/work/app-wt/a', kind: 'worktree' });
      const again = await registry.registerCheckoutContext({ workspaceId: 'ws-1', path: '/work/app-wt/a/', kind: 'worktree' });
      const other = await registry.registerCheckoutContext({ workspaceId: 'ws-1', path: '/work/app-wt/b', kind: 'worktree' });

      expect(again.checkoutContext?.id).toBe(first.checkoutContext?.id);
      expect(other.checkoutContext?.id).not.toBe(first.checkoutContext?.id);
      expect(registry.getCheckoutContextsForWorkspace('ws-1')).toHaveLength(3);
    });

    it.each([
      ['an unregistered workspace', { workspaceId: 'nope', path: '/work/wt', kind: 'worktree' as const }],
      ['a blank path', { workspaceId: 'ws-1', path: '  ', kind: 'worktree' as const }],
      ['an invalid directory', { workspaceId: 'ws-1', path: '/missing/wt', kind: 'worktree' as const }],
      ['a second main context', { workspaceId: 'ws-1', path: '/work/wt', kind: 'main' as const }],
      ['an unknown kind', { workspaceId: 'ws-1', path: '/work/wt', kind: 'sibling' as never }],
    ])('rejects %s', async (_label, input) => {
      const { registry } = createRegistry();
      await registry.registerWorkspace({ workspaceId: 'ws-1', workspacePath: '/work/app' });
      expect(await registry.registerCheckoutContext(input)).toMatchObject({ success: false });
      expect(registry.getCheckoutContextsForWorkspace('ws-1')).toHaveLength(1);
    });

    it('refuses a local root whose worktree is being removed', async () => {
      const { registry } = createRegistry({ isWorktreeBeingRemoved: (path) => path === '/work/app-wt/gone' });
      await registry.registerWorkspace({ workspaceId: 'ws-1', workspacePath: '/work/app' });
      expect(await registry.registerCheckoutContext({ workspaceId: 'ws-1', path: '/work/app-wt/gone', kind: 'worktree' }))
        .toMatchObject({ success: false, error: 'This worktree is being removed' });
    });

    it('refuses an SSH root reserved by a remote removal, including one reserved while validating', async () => {
      const { registry, remote } = createRegistry();
      await registry.registerWorkspace({ workspaceId: 'ws-1', workspacePath: '/srv/app', environmentId: 'vps' });

      const release = registry.reserveRemotePaths('vps', ['/srv/app-wt/gone'])!;
      expect(await registry.registerCheckoutContext({ workspaceId: 'ws-1', path: '/srv/app-wt/gone', kind: 'worktree' }))
        .toMatchObject({ success: false, error: expect.stringContaining('being removed') });
      release();

      remote.validateWorkspacePath.mockImplementationOnce(async (path: string) => {
        registry.reserveRemotePaths('vps', [path]);
        return { valid: true, resolvedPath: path };
      });
      expect(await registry.registerCheckoutContext({ workspaceId: 'ws-1', path: '/srv/app-wt/racing', kind: 'worktree' }))
        .toMatchObject({ success: false });
      expect(registry.getCheckoutContextsForWorkspace('ws-1')).toHaveLength(1);
    });

    it('does not register a context if its workspace closes during validation', async () => {
      const { registry, local } = createRegistry();
      await registry.registerWorkspace({ workspaceId: 'ws-1', workspacePath: '/work/app' });
      local.validateWorkspacePath.mockImplementationOnce(async (path: string) => {
        registry.unregisterWorkspace('ws-1');
        return { valid: true, resolvedPath: path };
      });
      expect(await registry.registerCheckoutContext({ workspaceId: 'ws-1', path: '/work/app-wt/a', kind: 'worktree' }))
        .toMatchObject({ success: false });
      expect(registry.getAllCheckoutContexts()).toEqual([]);
    });
  });

  describe('resolution', () => {
    it('never resolves a context through a different workspace', async () => {
      const { registry } = createRegistry();
      await registry.registerWorkspace({ workspaceId: 'ws-a', workspacePath: '/work/a' });
      await registry.registerWorkspace({ workspaceId: 'ws-b', workspacePath: '/work/b' });
      const { checkoutContext } = await registry.registerCheckoutContext({ workspaceId: 'ws-a', path: '/work/a-wt/x', kind: 'worktree' });

      expect(registry.resolveCheckoutContext('ws-a', checkoutContext!.id)).toBe(checkoutContext ? registry.getCheckoutContext(checkoutContext.id) : null);
      expect(registry.resolveCheckoutContext('ws-b', checkoutContext!.id)).toBeNull();
      expect(registry.resolveCheckoutContext('ws-b', mainCheckoutContextId('ws-a'))).toBeNull();
      expect(registry.resolveCheckoutContext('ws-a', 'ws-a::made-up')).toBeNull();
    });
  });

  describe('lifecycle and cleanup', () => {
    it('drops every context of a workspace when it is unregistered, and only that workspace\'s', async () => {
      const { registry } = createRegistry();
      await registry.registerWorkspace({ workspaceId: 'ws-a', workspacePath: '/work/a' });
      await registry.registerWorkspace({ workspaceId: 'ws-b', workspacePath: '/work/b' });
      const { checkoutContext } = await registry.registerCheckoutContext({ workspaceId: 'ws-a', path: '/work/a-wt/x', kind: 'worktree' });

      registry.unregisterWorkspace('ws-a');

      expect(registry.getCheckoutContext(checkoutContext!.id)).toBeNull();
      expect(registry.getCheckoutContext(mainCheckoutContextId('ws-a'))).toBeNull();
      expect(registry.resolveCheckoutContext('ws-a')).toBeNull();
      expect(registry.getCheckoutContextsForWorkspace('ws-b')).toHaveLength(1);
    });

    it('drops a single worktree context without closing its workspace', async () => {
      const { registry } = createRegistry();
      await registry.registerWorkspace({ workspaceId: 'ws-a', workspacePath: '/work/a' });
      const { checkoutContext } = await registry.registerCheckoutContext({ workspaceId: 'ws-a', path: '/work/a-wt/x', kind: 'worktree' });
      expect(registry.unregisterCheckoutContext(checkoutContext!.id)).toBe(true);
      expect(registry.getCheckoutContext(checkoutContext!.id)).toBeNull();
      expect(registry.getWorkspace('ws-a')).not.toBeNull();
      expect(registry.resolveCheckoutContext('ws-a')).not.toBeNull();
    });

    it('clear() drops all contexts', async () => {
      const { registry } = createRegistry();
      await registry.registerWorkspace({ workspaceId: 'ws-a', workspacePath: '/work/a' });
      await registry.registerCheckoutContext({ workspaceId: 'ws-a', path: '/work/a-wt/x', kind: 'worktree' });
      registry.clear();
      expect(registry.getAllCheckoutContexts()).toEqual([]);
    });

    it('lets a workspace id be reused without inheriting the old workspace\'s contexts', async () => {
      const { registry } = createRegistry();
      await registry.registerWorkspace({ workspaceId: 'ws-a', workspacePath: '/work/a' });
      const { checkoutContext } = await registry.registerCheckoutContext({ workspaceId: 'ws-a', path: '/work/a-wt/x', kind: 'worktree' });
      registry.unregisterWorkspace('ws-a');
      await registry.registerWorkspace({ workspaceId: 'ws-a', workspacePath: '/work/other' });

      expect(registry.resolveCheckoutContext('ws-a')?.path).toBe('/work/other');
      expect(registry.resolveCheckoutContext('ws-a', checkoutContext!.id)).toBeNull();
    });
  });

  describe('removal safeguards see context roots', () => {
    it('reports local worktree-context roots among the open paths used to block worktree removal', async () => {
      const { registry } = createRegistry();
      await registry.registerWorkspace({ workspaceId: 'ws-a', workspacePath: '/work/a' });
      await registry.registerCheckoutContext({ workspaceId: 'ws-a', path: '/work/a-wt/x', kind: 'worktree' });
      await registry.registerWorkspace({ workspaceId: 'ws-remote', workspacePath: '/srv/r', environmentId: 'vps' });

      expect(registry.getLocalOpenWorkspacePaths().sort()).toEqual(['/work/a', '/work/a-wt/x']);

      registry.unregisterWorkspace('ws-a');
      expect(registry.getLocalOpenWorkspacePaths()).toEqual([]);
    });
  });
});
