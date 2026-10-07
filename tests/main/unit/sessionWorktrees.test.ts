import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitWorktreeListResult } from '../../../src/shared/types/git';
import type { HarnessSession } from '../../../src/shared/types/session';
import type { RegisteredWorkspace, WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import { worktreeDirectoryName } from '../../../src/main/worktreePaths';
import { WorktreeProvenance } from '../../../src/main/worktreeProvenance';
import {
  collectSessionCheckoutPlan, discoverSessionsWithCheckouts, findRegisteredContext, matchSessionCheckoutRoot,
  recordListedWorktrees, routeSessionResume, sessionScanScopes, MAX_LOCAL_SESSION_SCANS, type SessionCheckoutPlan,
} from '../../../src/main/sessionWorktrees';

const workspaceAt = (workspacePath: string, environmentId = 'local') =>
  ({ workspaceId: 'ws', location: { environmentId, path: workspacePath } }) as unknown as RegisteredWorkspace;
const registryWith = (contexts: Array<Record<string, unknown>> = []) => ({
  getCheckoutContextsForWorkspace: () => contexts,
}) as unknown as WorkspaceRegistry;
const entry = (p: string, branch: string | null, extra: Partial<GitWorktreeListResult['worktrees'][number]> = {}) =>
  ({ path: p, branch, isMain: false, isLocked: false, isPrunable: false, ...extra });
const listing = (...worktrees: GitWorktreeListResult['worktrees']) => async (): Promise<GitWorktreeListResult> => ({ success: true, worktrees });
const session = (id: string, cwd: string, timestamp = 1): HarnessSession => ({ id, harness: 'claude', title: id, cwd, timestamp });
const generated = (branch: string) => `/p/app-worktrees/${worktreeDirectoryName(branch)}`;
const memory = () => {
  let stored: unknown = [];
  return new WorktreeProvenance({ read: () => stored, write: (records) => { stored = JSON.parse(JSON.stringify(records)); } });
};

async function planFor(options: {
  workspacePath?: string; worktrees?: GitWorktreeListResult['worktrees']; branches?: string[]; contexts?: Array<Record<string, unknown>>;
  provenance?: WorktreeProvenance; environmentId?: string; realDisk?: boolean; windows?: boolean;
}): Promise<SessionCheckoutPlan> {
  return collectSessionCheckoutPlan({
    registry: registryWith(options.contexts), workspace: workspaceAt(options.workspacePath ?? '/p/app', options.environmentId),
    listWorktrees: listing(...(options.worktrees ?? [entry('/p/app', 'main', { isMain: true })])),
    listBranches: async () => options.branches ?? [],
    provenance: options.provenance,
    // Fake local paths: only the symlink test below touches the real disk.
    directoryPresent: options.realDisk ? undefined : () => true,
    windows: options.windows,
  });
}
const remote = { environmentId: 'ssh-a' };

describe('worktree provenance for history', () => {
  it('classifies listed, registered and generated checkouts, recovering the real branch of a removed generated one', async () => {
    const plan = await planFor({
      worktrees: [entry('/p/app', 'main', { isMain: true }), entry(generated('feature/live'), 'feature/live'), entry('/p/app-gone', 'gone', { isPrunable: true })],
      contexts: [{ kind: 'worktree', path: '/p/app-extra', branch: 'extra' }, { kind: 'main', path: '/p/app' }],
      branches: ['main', 'feature/live', 'feature/foo'],
    });
    const byPath = new Map(plan.roots.map((root) => [root.path, root]));
    expect(byPath.get(generated('feature/live'))).toMatchObject({ kind: 'listed', exists: true, branch: 'feature/live' });
    expect(byPath.get('/p/app-gone')).toMatchObject({ kind: 'listed', exists: false });
    expect(byPath.get('/p/app-extra')).toMatchObject({ kind: 'registered', exists: true, branch: 'extra' });
    // Removed, Git forgot it, but its branch survives: the generated name proves the checkout and its branch.
    expect(matchSessionCheckoutRoot(plan, `${generated('feature/foo')}/src`)).toMatchObject({ kind: 'generated', exists: false, branch: 'feature/foo' });
    expect(plan.container).toBe('/p/app-worktrees');
  });

  it('excludes stranger directories under the container, look-alike siblings and other repositories', async () => {
    const plan = await planFor({ branches: ['main', 'feature/foo'] });
    expect(matchSessionCheckoutRoot(plan, '/p/app-worktrees/random-folder/src')).toBeNull();
    expect(matchSessionCheckoutRoot(plan, '/p/app-worktrees/feature-foo')).toBeNull(); // readable part without the hash
    expect(matchSessionCheckoutRoot(plan, `/p/app-worktrees-other/${worktreeDirectoryName('feature/foo')}`)).toBeNull();
    expect(matchSessionCheckoutRoot(plan, `/p/other-worktrees/${worktreeDirectoryName('feature/foo')}`)).toBeNull();
    expect(matchSessionCheckoutRoot(plan, '/p/app-other')).toBeNull();
    const kept = discoverSessionsWithCheckouts({
      plan, scanWorkspacePath: '/p/app',
      discover: async () => [
        session('removed-generated', `${generated('feature/foo')}/x`), session('stranger', '/p/app-worktrees/random-folder/x'),
        session('elsewhere', '/p/other/x'), session('main', '/p/app/x'),
      ],
    });
    expect((await kept).map((item) => item.id).sort()).toEqual(['main', 'removed-generated']);
  });

  it('keeps an adopted sibling worktree attributable after Git forgets it, with its branch', async () => {
    const provenance = memory();
    const sibling = '/p/app-feature-x';
    await planFor({ worktrees: [entry('/p/app', 'main', { isMain: true }), entry(sibling, 'feature/x')], provenance });
    // Removed: Git no longer lists it and the branch name is not a local branch any more.
    const later = await planFor({ provenance, branches: ['main'] });
    expect(later.roots).toContainEqual({ path: sibling, branch: 'feature/x', exists: false, kind: 'remembered' });
    expect(sessionScanScopes(later)).toContain(sibling);
    // A fresh memory (a different app profile) cannot attribute it: provenance is the only record.
    const stranger = await planFor({ provenance: memory(), branches: ['main'] });
    expect(matchSessionCheckoutRoot(stranger, `${sibling}/x`)).toBeNull();
  });

  it('remembers a generated checkout whose branch was later deleted, and labels it by branch', async () => {
    const provenance = memory();
    const path1 = generated('feature/gone');
    recordListedWorktrees(provenance, 'local', { success: true, worktrees: [entry('/p/app', 'main', { isMain: true }), entry(path1, 'feature/gone')] });
    const plan = await planFor({ provenance, branches: ['main'] });
    expect(matchSessionCheckoutRoot(plan, path1)).toMatchObject({ branch: 'feature/gone', exists: false, kind: 'remembered' });
    // Not remembered and no branch: unrecoverable, so excluded rather than guessed from the directory name.
    const unknown = await planFor({ branches: ['main'] });
    expect(matchSessionCheckoutRoot(unknown, generated('feature/never-seen'))).toBeNull();
  });

  it('scopes provenance to the environment', async () => {
    const provenance = memory();
    recordListedWorktrees(provenance, 'ssh-a', { success: true, worktrees: [entry('/p/app', 'main', { isMain: true }), entry('/p/app-sib', 'sib')] });
    const otherHost = await planFor({ provenance, branches: [], environmentId: 'ssh-b' });
    expect(otherHost.roots.some((root) => root.path === '/p/app-sib')).toBe(false);
    const sameHost = await planFor({ provenance, branches: [], ...remote });
    expect(sameHost.roots.some((root) => root.path === '/p/app-sib')).toBe(true);
  });
});

describe('which checkout the workspace belongs to', () => {
  it('includes worktrees for a package directory inside the main checkout', async () => {
    const plan = await planFor({ workspacePath: '/p/app/packages/web', worktrees: [entry('/p/app', 'main', { isMain: true }), entry(generated('feat'), 'feat')] });
    expect(plan.roots.map((root) => root.path)).toContain(generated('feat'));
    expect(plan.mainPath).toBe('/p/app');
  });

  it('includes worktrees for a workspace equal to the main checkout', async () => {
    const plan = await planFor({ worktrees: [entry('/p/app', 'main', { isMain: true }), entry(generated('feat'), 'feat')] });
    expect(plan.roots.map((root) => root.path)).toContain(generated('feat'));
  });

  it('adds nothing for a workspace inside a linked worktree, including a subdirectory of it', async () => {
    const worktrees = [entry('/p/app', 'main', { isMain: true }), entry(generated('feat'), 'feat'), entry(generated('other'), 'other')];
    expect((await planFor({ workspacePath: generated('feat'), worktrees })).roots).toEqual([]);
    expect((await planFor({ workspacePath: `${generated('feat')}/packages/app`, worktrees })).roots).toEqual([]);
  });

  it('prefers the most specific listed worktree when one is nested in another', async () => {
    const plan = await planFor({
      workspacePath: '/p/app/.wt/inner/pkg',
      worktrees: [entry('/p/app', 'main', { isMain: true }), entry('/p/app/.wt/inner', 'inner')],
    });
    expect(plan.roots).toEqual([]);
  });

  it('falls back to registered contexts when Git cannot list', async () => {
    const plan = await collectSessionCheckoutPlan({
      registry: registryWith([{ kind: 'worktree', path: '/p/app-x', branch: 'x', missing: true }]), workspace: workspaceAt('/p/app'),
      listWorktrees: async () => ({ success: false, worktrees: [], error: 'no git' }),
    });
    expect(plan.roots).toEqual([{ path: '/p/app-x', branch: 'x', exists: false, kind: 'registered' }]);
    expect(plan.container).toBeNull();
  });

  describe('with the real disk', () => {
    let disk: string;
    afterEach(() => fs.rmSync(disk, { recursive: true, force: true }));
    it('treats a local checkout whose directory vanished (not yet reconciled) as removed', async () => {
      disk = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'plan-disk-')));
      const main = path.join(disk, 'app'); const kept = path.join(disk, 'kept'); const vanished = path.join(disk, 'vanished');
      fs.mkdirSync(main); fs.mkdirSync(kept);
      const plan = await planFor({
        workspacePath: main, realDisk: true,
        worktrees: [entry(main, 'main', { isMain: true }), entry(kept, 'kept'), entry(vanished, 'vanished')],
        contexts: [{ kind: 'worktree', path: vanished, branch: 'vanished' }],
      });
      const exists = Object.fromEntries(plan.roots.filter((root) => root.kind !== 'generated').map((root) => [path.basename(root.path), root.exists]));
      expect(exists).toEqual({ kept: true, vanished: false });
      expect(routeSessionResume(plan, vanished).kind).toBe('gone');
    });
  });

  describe('with symlinks', () => {
    let root: string;
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
    it('compares local paths symlink-resolved', async () => {
      root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'plan-links-')));
      const main = path.join(root, 'app'); const worktree = path.join(root, 'app-worktrees', 'feat'); const link = path.join(root, 'link');
      fs.mkdirSync(path.join(main, 'packages'), { recursive: true }); fs.mkdirSync(worktree, { recursive: true });
      fs.symlinkSync(path.join(main, 'packages'), link);
      const plan = await planFor({
        workspacePath: link, worktrees: [entry(main, 'main', { isMain: true }), entry(worktree, 'feat')], realDisk: true,
      });
      expect(plan.roots.map((item) => item.path)).toContain(worktree.replace(/\\/g, '/'));
      // A session recorded through the symlink still lands in the worktree it resolves to.
      const wtLink = path.join(root, 'wt-link');
      fs.symlinkSync(worktree, wtLink);
      expect(matchSessionCheckoutRoot(plan, wtLink.replace(/\\/g, '/'))?.path).toBe(worktree.replace(/\\/g, '/'));
    });
  });
});

describe('bounded scans never drop provenance', () => {
  const many = (count: number) => Array.from({ length: count }, (_, index) => `feature/branch-${index}`);

  it('classifies every generated worktree of a 40-worktree repository and keeps the container scope', async () => {
    const branches = many(40);
    const plan = await planFor({
      worktrees: [entry('/p/app', 'main', { isMain: true }), ...branches.slice(0, 20).map((branch) => entry(generated(branch), branch))],
      branches: ['main', ...branches],
    });
    // Live and removed worktrees alike classify; the container is first and covers all of them in one scope.
    expect(plan.roots.filter((root) => /branch-\d+/.test(root.branch ?? ''))).toHaveLength(40);
    expect(sessionScanScopes(plan)).toEqual(['/p/app-worktrees']);
    expect(matchSessionCheckoutRoot(plan, `${generated('feature/branch-39')}/src`)).toMatchObject({ branch: 'feature/branch-39', exists: false });
    const discover = vi.fn(async (scanPath: string) => scanPath === '/p/app-worktrees' ? [session('old', `${generated('feature/branch-39')}/src`)] : []);
    const sessions = await discoverSessionsWithCheckouts({ plan, scanWorkspacePath: '/p/app', discover });
    expect(discover).toHaveBeenCalledTimes(2);
    expect(sessions).toEqual([expect.objectContaining({ id: 'old', checkout: { branch: 'feature/branch-39', path: generated('feature/branch-39'), exists: false } })]);
  });

  it('replaces too many separate scans with one bounded broad scan instead of dropping roots', async () => {
    const siblings = Array.from({ length: MAX_LOCAL_SESSION_SCANS + 8 }, (_, index) => entry(`/p/sibling-${index}`, `s${index}`));
    const plan = await planFor({ worktrees: [entry('/p/app', 'main', { isMain: true }), ...siblings] });
    expect(sessionScanScopes(plan)[0]).toBe('/p/app-worktrees');
    expect(sessionScanScopes(plan).length).toBeGreaterThan(MAX_LOCAL_SESSION_SCANS);
    const discover = vi.fn(async (scanPath: string) => scanPath === ''
      ? [session('last', '/p/sibling-19/x'), session('stranger', '/p/not-a-worktree/x'), session('main', '/p/app/y')] : []);
    const sessions = await discoverSessionsWithCheckouts({ plan, scanWorkspacePath: '/p/app', discover });
    expect(discover).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenCalledWith('');
    expect(sessions.map((item) => item.id).sort()).toEqual(['last', 'main']);
  });

  it('covers a nested root with its parent scope and drops scopes inside the workspace', async () => {
    const plan = await planFor({
      worktrees: [entry('/p/app', 'main', { isMain: true }), entry('/p/app/.wt/in-repo', 'in'), entry('/p/app-worktrees/wt', 'wt'), entry('/p/sib', 'sib')],
    });
    expect(sessionScanScopes(plan)).toEqual(['/p/app-worktrees', '/p/sib']);
  });
});

describe('matching and routing', () => {
  it('routes live worktree, main, removed worktree and outside sessions', async () => {
    const plan = await planFor({
      worktrees: [entry('/p/app', 'main', { isMain: true }), entry(generated('live'), 'live')], branches: ['main', 'live', 'old'],
    });
    const route = (cwd: string) => routeSessionResume(plan, cwd).kind;
    expect(route(`${generated('live')}/src`)).toBe('worktree');
    expect(route('/p/app/src')).toBe('main');
    expect(route(generated('old'))).toBe('gone');
    expect(route('/p/app-worktrees/random-folder')).toBe('outside');
    expect(route('/p/app/../other')).toBe('outside');
    expect(route('/elsewhere')).toBe('outside');
  });

  it('finds a registered context by path identity', async () => {
    const ctx = { id: 'c', kind: 'worktree', path: generated('x') };
    const plan = await planFor({});
    const registry = registryWith([ctx]);
    expect(findRegisteredContext(registry, workspaceAt('/p/app'), plan, generated('x'))).toBe(ctx);
    expect(findRegisteredContext(registry, workspaceAt('/p/app'), plan, generated('y'))).toBeNull();
  });
});

describe('discoverSessionsWithCheckouts', () => {
  it('merges, dedupes, tags and survives a failing extra scan', async () => {
    const plan = await planFor({
      worktrees: [entry('/p/app', 'main', { isMain: true }), entry('/p/bad', 'bad'), entry(generated('feat'), 'feat')], branches: ['main', 'feat'],
    });
    const scans: string[] = [];
    const onScanError = vi.fn();
    const result = await discoverSessionsWithCheckouts({
      plan, scanWorkspacePath: '/p/app', onScanError,
      discover: async (scanPath) => {
        scans.push(scanPath);
        if (scanPath === '/p/app') return [session('main', '/p/app', 5)];
        if (scanPath === '/p/bad') throw new Error('boom');
        return [session('a', `${generated('feat')}/x`, 9)];
      },
    });
    expect(scans).toEqual(['/p/app', '/p/app-worktrees', '/p/bad']);
    expect(onScanError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
    expect(result.map((item) => item.id)).toEqual(['a', 'main']);
    expect(result[0].checkout).toEqual({ branch: 'feat', path: generated('feat'), exists: true });
    expect(result[1].checkout).toBeUndefined();
  });
});

describe('environment-aware path identity (independent of the machine running the tests)', () => {
  // `windows: true` stands for a Windows desktop; a remote host is still POSIX and case-sensitive.
  it('keeps remote paths that differ only by case distinct, even from a Windows desktop', async () => {
    const plan = await planFor({
      environmentId: 'ssh-a', windows: true, workspacePath: '/srv/App',
      worktrees: [entry('/srv/App', 'main', { isMain: true }), entry('/srv/app-wt', 'lower'), entry('/srv/App-wt', 'upper')],
    });
    expect(plan.roots.filter((root) => root.kind === 'listed').map((root) => root.path).sort()).toEqual(['/srv/App-wt', '/srv/app-wt']);
    expect(plan.container).toBe('/srv/App-worktrees');
    const inLower = matchSessionCheckoutRoot(plan, '/srv/app-wt/src');
    const inUpper = matchSessionCheckoutRoot(plan, '/srv/App-wt/src');
    expect(inLower).toMatchObject({ path: '/srv/app-wt', branch: 'lower' });
    expect(inUpper).toMatchObject({ path: '/srv/App-wt', branch: 'upper' });
    const sessions = await discoverSessionsWithCheckouts({
      plan, scanWorkspacePath: '/srv/App',
      discover: async () => [session('lower', '/srv/app-wt/x'), session('upper', '/srv/App-wt/x'), session('other-case-workspace', '/srv/app/x'), session('main', '/srv/App/x')],
    });
    expect(sessions.map((item) => [item.id, item.checkout?.branch ?? null]).sort()).toEqual([['lower', 'lower'], ['main', null], ['upper', 'upper']]);
    // A workspace at /srv/app is a different place from /srv/App: its root does not contain the other's files.
    expect(routeSessionResume(plan, '/srv/app/x').kind).toBe('outside');
  });

  it('does not dedupe remote worktrees or generated names that differ only by case', async () => {
    const plan = await planFor({
      environmentId: 'ssh-a', windows: true, workspacePath: '/srv/App',
      worktrees: [entry('/srv/App', 'main', { isMain: true })], branches: ['main', 'Feature', 'feature'],
    });
    const generatedPaths = plan.roots.filter((root) => root.kind === 'generated').map((root) => root.branch);
    expect(generatedPaths).toEqual(expect.arrayContaining(['Feature', 'feature']));
  });

  it('folds case only for a local path on a Windows desktop', async () => {
    const plan = await planFor({
      environmentId: 'local', windows: true, workspacePath: 'C:/Repo',
      worktrees: [entry('C:/Repo', 'main', { isMain: true }), entry('C:/repo-wt', 'wt')],
    });
    expect(matchSessionCheckoutRoot(plan, 'c:/REPO-WT/src')).toMatchObject({ branch: 'wt' });
    expect(routeSessionResume(plan, 'c:/repo/src').kind).toBe('main');
    const posix = await planFor({
      environmentId: 'local', windows: false, workspacePath: '/p/Repo',
      worktrees: [entry('/p/Repo', 'main', { isMain: true }), entry('/p/repo-wt', 'wt')],
    });
    expect(matchSessionCheckoutRoot(posix, '/p/REPO-WT/src')).toBeNull();
    expect(routeSessionResume(posix, '/p/repo/src').kind).toBe('outside');
  });
});

describe('generated-name inference comes only from current Git branches', () => {
  it('keeps a remembered adopted sibling attributable but never invents a generated path from its deleted branch', async () => {
    const provenance = memory();
    const sibling = '/p/app-feature';
    await planFor({ worktrees: [entry('/p/app', 'main', { isMain: true }), entry(sibling, 'feature/x')], provenance, branches: ['main', 'feature/x'] });
    // Worktree and branch are both deleted; only the remembered exact path remains.
    const later = await planFor({ provenance, branches: ['main'] });
    // (The only other root is the generated name of the live `main` branch; nothing derives from `feature/x`.)
    expect(later.roots.filter((root) => root.branch !== 'main')).toEqual([{ path: sibling, branch: 'feature/x', exists: false, kind: 'remembered' }]);
    expect(matchSessionCheckoutRoot(later, `${sibling}/src`)).toMatchObject({ branch: 'feature/x', kind: 'remembered' });
    // That generated checkout never existed: a session there is not provenance.
    expect(matchSessionCheckoutRoot(later, `${generated('feature/x')}/src`)).toBeNull();
    const kept = await discoverSessionsWithCheckouts({
      plan: later, scanWorkspacePath: '/p/app',
      discover: async () => [session('sibling', `${sibling}/src`), session('invented', `${generated('feature/x')}/src`)],
    });
    expect(kept.map((item) => item.id)).toEqual(['sibling']);
  });

  it('still lets an existing branch prove a legacy generated worktree, and a listed one needs no inference', async () => {
    const plan = await planFor({
      worktrees: [entry('/p/app', 'main', { isMain: true }), entry(generated('listed'), 'listed')], branches: ['main', 'listed', 'legacy'],
    });
    expect(matchSessionCheckoutRoot(plan, generated('legacy'))).toMatchObject({ kind: 'generated', branch: 'legacy' });
    expect(plan.roots.filter((root) => root.path === generated('listed'))).toEqual([expect.objectContaining({ kind: 'listed' })]);
  });
});
