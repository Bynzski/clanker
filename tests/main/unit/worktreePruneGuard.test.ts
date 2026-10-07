import { describe, expect, it } from 'vitest';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import { guardWorktreePrune } from '../../../src/main/worktreePruneGuard';
import type { WorkspaceEnvironment } from '../../../src/main/environment/workspaceEnvironment';
import type { TerminalUsage } from '../../../src/main/checkoutContextRelease';

const entry = { path: '/p/app-worktrees/gone', branch: 'gone', isMain: false, isLocked: false, isPrunable: true };
const environment = (id: string) => ({ id, kind: id === 'local' ? 'local' : 'ssh',
  validateWorkspacePath: async (dir: string) => ({ valid: true, resolvedPath: dir }),
}) as unknown as WorkspaceEnvironment;
const setup = async (environmentId = 'local') => {
  const registry = new WorkspaceRegistry((id) => environment(id));
  await registry.registerWorkspace({ workspaceId: 'ws', workspacePath: '/p/app', environmentId });
  return registry;
};

describe('main-owned repository-wide prune guard', () => {
  it('permits unused stale metadata and a terminal in the main checkout', async () => {
    const registry = await setup();
    expect(guardWorktreePrune(registry, 'local', [entry], [{ cwd: '/p/app' }])).toBeNull();
    const result = await registry.registerCheckoutContext({ workspaceId: 'ws', path: entry.path, kind: 'worktree' });
    expect(result.success).toBe(true);
    expect(guardWorktreePrune(registry, 'local', [entry], [])).toBeNull();
  });

  it.each<TerminalUsage>([
    { cwd: `${entry.path}/subdir` },
    { cwd: entry.path, resourceKind: 'service' },
    {},
  ])('blocks a live terminal, pending service or unverifiable directory: %j', async (usage) => {
    expect(guardWorktreePrune(await setup(), 'local', [entry], [usage])).toContain('Cannot prune');
  });

  it('blocks a launch binding even after its terminal reports another directory', async () => {
    const registry = await setup();
    const context = (await registry.registerCheckoutContext({ workspaceId: 'ws', path: entry.path, kind: 'worktree' })).checkoutContext!;
    expect(guardWorktreePrune(registry, 'local', [entry], [{ checkoutContextId: context.id, cwd: '/elsewhere' }])).toContain('Cannot prune');
  });

  it('blocks another open workspace inside a stale root', async () => {
    const registry = await setup();
    await registry.registerWorkspace({ workspaceId: 'other', workspacePath: `${entry.path}/subdir` });
    expect(guardWorktreePrune(registry, 'local', [entry], [])).toContain('workspace');
  });

  it('includes equivalent SSH hosts, but not unrelated hosts or desktop paths', async () => {
    const registry = await setup('ssh');
    registry.restoreRemotePaths('ssh', ['/reserved'], 'host');
    registry.restoreRemotePaths('alias', ['/reserved-alias'], 'host');
    expect(guardWorktreePrune(registry, 'ssh', [entry], [{ environmentId: 'alias', remoteWorkingDir: entry.path }])).toContain('Cannot prune');
    expect(guardWorktreePrune(registry, 'ssh', [entry], [{ environmentId: 'unrelated', remoteWorkingDir: entry.path }, { environmentId: 'local', cwd: entry.path }])).toBeNull();
  });
});
