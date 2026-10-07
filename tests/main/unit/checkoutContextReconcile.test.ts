/**
 * Reconciling a workspace's worktree checkout contexts with Git: the real WorkspaceRegistry and
 * the real release check, with Git's worktree listing as the only stub. A worktree that is gone is
 * dropped when nothing was launched into it, and only marked missing while something was.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import { releaseCheckoutContext, type TerminalUsage } from '../../../src/main/checkoutContextRelease';
import { reconcileCheckoutContexts } from '../../../src/main/checkoutContextReconcile';
import type { WorkspaceEnvironment } from '../../../src/main/environment/workspaceEnvironment';
import type { GitWorktree, GitWorktreeListResult } from '../../../src/shared/types/git';
import { mainCheckoutContextId } from '../../../src/shared/checkoutContext';
import { toPosixPath } from '../../../src/shared/pathNormalize';

const localEnvironment = {
  id: 'local', kind: 'local',
  validateWorkspacePath: async (dir: string) => ({ valid: true, resolvedPath: dir }),
} as unknown as WorkspaceEnvironment;

describe('reconcileCheckoutContexts (local)', () => {
  let root: string;
  let main: string;
  let registry: WorkspaceRegistry;
  let terminals: Map<string, TerminalUsage>;
  let listing: GitWorktreeListResult;
  const dirs: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const entry = (dir: string, branch: string | null, extra: Partial<GitWorktree> = {}): GitWorktree =>
    ({ path: dir, branch, isMain: false, isLocked: false, isPrunable: false, ...extra });
  const run = (list = vi.fn(async () => listing)) => reconcileCheckoutContexts({
    registry,
    workspace: registry.getWorkspace('ws')!,
    listWorktrees: list,
    release: (checkoutContextId) => releaseCheckoutContext({ registry, terminals: terminals.values(), workspaceId: 'ws', checkoutContextId }),
  });

  beforeEach(async () => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-reconcile-')));
    main = path.join(root, 'project');
    fs.mkdirSync(main);
    for (const name of ['present', 'removedInUse', 'removedUnused', 'prunable']) {
      dirs[name] = path.join(root, 'project-worktrees', name);
      fs.mkdirSync(dirs[name], { recursive: true });
    }
    registry = new WorkspaceRegistry(() => localEnvironment);
    await registry.registerWorkspace({ workspaceId: 'ws', workspacePath: toPosixPath(main) });
    for (const name of Object.keys(dirs)) {
      const result = await registry.registerCheckoutContext({ workspaceId: 'ws', path: toPosixPath(dirs[name]), kind: 'worktree', branch: name });
      ids[name] = result.checkoutContext!.id;
    }
    // Gone from disk: removed with `git worktree remove` (unlisted) or deleted under Git (prunable).
    for (const name of ['removedInUse', 'removedUnused', 'prunable']) fs.rmSync(dirs[name], { recursive: true, force: true });
    terminals = new Map<string, TerminalUsage>([
      ['agent-gone', { checkoutContextId: ids.removedInUse, environmentId: 'local', cwd: dirs.removedInUse }],
      ['agent-pruned', { checkoutContextId: ids.prunable, environmentId: 'local', cwd: dirs.prunable }],
      ['agent-main', { checkoutContextId: mainCheckoutContextId('ws'), environmentId: 'local', cwd: main }],
    ]);
    listing = { success: true, worktrees: [
      { ...entry(main, 'main'), isMain: true },
      entry(dirs.present, 'renamed-by-agent'),
      entry(dirs.prunable, 'prunable', { isPrunable: true }),
    ] };
  });

  it('retains a gone checkout when a main-bound shell was cd-ed into its now missing directory', async () => {
    terminals.set('cd-ed-shell', { checkoutContextId: mainCheckoutContextId('ws'), environmentId: 'local', cwd: dirs.removedUnused });
    const result = await run();
    expect(result.dropped).not.toContain(ids.removedUnused);
    expect(registry.getCheckoutContext(ids.removedUnused)).toMatchObject({ missing: true });
  });

  it('refreshes a present checkout\'s branch in place and keeps the registered object', async () => {
    const before = registry.getCheckoutContext(ids.present);
    const result = await run();

    expect(result.success).toBe(true);
    expect(registry.getCheckoutContext(ids.present)).toBe(before);
    expect(registry.getCheckoutContext(ids.present)).toMatchObject({ branch: 'renamed-by-agent', missing: false });
    expect(result.contexts?.find((context) => context.id === ids.present)).toMatchObject({ branch: 'renamed-by-agent', missing: false });
  });

  it('drops a gone checkout nothing was launched into, and only marks one an agent is still bound to', async () => {
    const result = await run();

    expect(result.dropped).toEqual([ids.removedUnused]);
    expect(registry.getCheckoutContext(ids.removedUnused)).toBeNull();
    for (const name of ['removedInUse', 'prunable']) {
      expect(registry.getCheckoutContext(ids[name])).toMatchObject({ missing: true });
      expect(result.contexts?.find((context) => context.id === ids[name])).toMatchObject({ missing: true });
    }
    expect(registry.getCheckoutContext(mainCheckoutContextId('ws'))).toMatchObject({ kind: 'main' });
    expect(result.contexts?.some((context) => context.kind === 'main')).toBe(false);
  });

  it('drops a marked checkout once its last agent is gone', async () => {
    await run();
    terminals.delete('agent-gone');
    const result = await run();

    expect(result.dropped).toEqual([ids.removedInUse]);
    expect(registry.getCheckoutContext(ids.removedInUse)).toBeNull();
    expect(registry.getCheckoutContext(ids.prunable)).toMatchObject({ missing: true });
  });

  it('clears the mark when Git lists the checkout as usable again', async () => {
    await run();
    fs.mkdirSync(dirs.removedInUse, { recursive: true });
    listing = { ...listing, worktrees: [...listing.worktrees, entry(dirs.removedInUse, 'back')] };
    await run();

    expect(registry.getCheckoutContext(ids.removedInUse)).toMatchObject({ missing: false, branch: 'back' });
  });

  it('changes nothing when Git cannot list the worktrees', async () => {
    listing = { success: false, worktrees: [], error: 'not a git repository' };
    const result = await run();

    expect(result).toMatchObject({ success: false, error: 'not a git repository' });
    for (const name of Object.keys(dirs)) {
      expect(registry.getCheckoutContext(ids[name])).not.toBeNull();
      expect(registry.getCheckoutContext(ids[name])?.missing).toBeUndefined();
    }
  });

  it('does not ask Git anything for a workspace without worktree checkouts', async () => {
    for (const id of Object.values(ids)) registry.unregisterCheckoutContext(id);
    const list = vi.fn(async () => listing);
    const result = await run(list);

    expect(result).toEqual({ success: true, contexts: [], dropped: [] });
    expect(list).not.toHaveBeenCalled();
  });

  it('applies nothing if the workspace closed while Git was listing', async () => {
    const result = await run(vi.fn(async () => { registry.unregisterWorkspace('ws'); return listing; }));

    expect(result.success).toBe(false);
    expect(registry.getCheckoutContext(ids.removedUnused)).toBeNull(); // closing dropped every context; nothing was re-added
  });
});
