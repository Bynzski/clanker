import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ObservedWorktreeService } from '../../../src/main/observedWorktree';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import { GitService } from '../../../src/main/gitService';
import { adoptListedWorktree } from '../../../src/main/worktreeContextAttachment';
import type { WorkspaceEnvironment } from '../../../src/main/environment/workspaceEnvironment';
import type { AgentAttentionSnapshot } from '../../../src/shared/types/agentAttention';
import { snapshot } from '../../_helpers/attentionSnapshots';

let root: string, repo: string, worktree: string;
// Tests explicitly confirm the fixture's known descriptor; production callers get it from inspection.
class ConfirmedFixture extends ObservedWorktreeService {
  override attach(id: unknown, revision: unknown, expected = { path: worktree, branch: 'agent-branch' }) {
    return super.attach(id, revision, expected);
  }
}
let registry: WorkspaceRegistry, service: ConfirmedFixture;
let report: AgentAttentionSnapshot;
let terminal: { workspaceId: string; environmentId: string } | undefined;
let list: ReturnType<typeof vi.fn<() => ReturnType<GitService['listWorktrees']>>>;
let validate: ReturnType<typeof vi.fn<WorkspaceEnvironment['validateWorkspacePath']>>;
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
async function setup(environmentId = 'local') {
  validate = vi.fn(async directory => ({ valid: fs.existsSync(directory), resolvedPath: fs.existsSync(directory) ? fs.realpathSync.native(directory) : undefined }));
  // Only the two environment operations exercised here are substituted; both use real disk/Git.
  const environment = { validateWorkspacePath: validate, execGit: async (cwd: string, args: string[]) => ({ stdout: git(cwd, ...args), stderr: '' }) } as unknown as WorkspaceEnvironment;
  registry = new WorkspaceRegistry(() => environment);
  await registry.registerWorkspace({ workspaceId: 'ws', workspacePath: repo, environmentId });
  terminal = { workspaceId: 'ws', environmentId };
  report = snapshot('agent', 'running', 3, { sessionId: 'S', location: { path: worktree, checkoutContextId: null }, locationProvenance: { state: 'current', sessionId: 'S' } });
  const gitService = new GitService(() => undefined);
  list = vi.fn(() => gitService.listWorktrees(repo));
  service = new ConfirmedFixture({ registry, getTerminal: () => terminal, snapshot: () => report, listWorktrees: list });
}
beforeEach(async () => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-observed-')));
  repo = path.join(root, 'repo with spaces'); worktree = path.join(root, 'agent checkout');
  fs.mkdirSync(repo); git(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.claude/\n'); git(repo, 'add', '.');
  git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
  git(repo, 'worktree', 'add', '-qb', 'agent-branch', worktree);
  await setup();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('observed checkout discovery and confirmed attachment (real Git)', () => {
  it.each(['local', 'ssh-fixture'])('discovers and confirms a sibling through its %s environment without rebinding or rewriting evidence', async environmentId => {
    await setup(environmentId);
    fs.mkdirSync(path.join(worktree, 'src')); report.location!.path = path.join(worktree, 'src');
    const original = structuredClone(report);
    expect(await service.inspect('agent', 3)).toMatchObject({ success: true, candidate: { path: worktree, branch: 'agent-branch', locked: false } });
    expect(registry.getCheckoutContextsForWorkspace('ws')).toHaveLength(1);
    const attached = await service.attach('agent', 3);
    expect(attached).toMatchObject({ success: true, checkoutContext: { path: worktree, workspaceId: 'ws', environmentId, kind: 'worktree', branch: 'agent-branch' } });
    expect(report).toEqual(original); expect(terminal).toEqual({ workspaceId: 'ws', environmentId });
    expect((await service.attach('agent', 3)).checkoutContext?.id).toBe(attached.checkoutContext?.id);
    expect(registry.getCheckoutContextsForWorkspace('ws')).toHaveLength(2);
  });
  it('finds a nested worktree even when the old observation resolved to main', async () => {
    const nested = path.join(repo, '.claude', 'worktrees', 'native');
    git(repo, 'worktree', 'add', '-qb', 'nested', nested);
    report.location = { path: nested, checkoutContextId: 'ws::main' };
    expect(await service.inspect('agent', 3)).toMatchObject({ candidate: { path: nested, branch: 'nested' } });
    expect((await service.attach('agent', 3, { path: nested, branch: 'nested' })).checkoutContext?.path).toBe(nested);
    expect(report.location.checkoutContextId).toBe('ws::main');
  });
  it('does not reinterpret an already registered observation', async () => {
    const attached = await service.attach('agent', 3);
    report = { ...report, revision: 4, location: { path: worktree, checkoutContextId: attached.checkoutContext!.id } };
    expect(await service.inspect('agent', 4)).toEqual({ success: true });
  });
  it.each(['scratch', 'unrelated-repository', 'ordinary-subdirectory'])('does not adopt %s', async kind => {
    const directory = kind === 'ordinary-subdirectory' ? path.join(repo, 'src') : path.join(root, kind);
    fs.mkdirSync(directory);
    if (kind === 'unrelated-repository') git(directory, 'init', '-q');
    report.location!.path = directory;
    expect(await service.inspect('agent', 3)).toEqual({ success: true });
    expect(await service.attach('agent', 3)).toEqual({ success: true });
    expect(registry.getCheckoutContextsForWorkspace('ws')).toHaveLength(1);
  });
  it('describes native locks but never unlocks or registers them', async () => {
    git(repo, 'worktree', 'lock', '--reason', 'live harness', worktree);
    expect(await service.inspect('agent', 3)).toMatchObject({ candidate: { locked: true, lockReason: 'live harness' } });
    expect(await service.attach('agent', 3)).toMatchObject({ success: false, error: expect.stringMatching(/will not unlock/) });
    expect(git(repo, 'worktree', 'list', '--porcelain')).toContain('locked live harness');
    expect(registry.getCheckoutContextsForWorkspace('ws')).toHaveLength(1);
  });
  it('does not accept a stale Git entry replaced by an unrelated real repository', async () => {
    fs.renameSync(worktree, path.join(root, 'preserved'));
    fs.mkdirSync(worktree); git(worktree, 'init', '-q');
    expect(await service.attach('agent', 3)).toMatchObject({ success: false, error: expect.stringMatching(/identity changed/) });
    expect(registry.getCheckoutContextsForWorkspace('ws')).toHaveLength(1);
  });
  it('also hardens the shared explicit-adoption route against a replaced real repository', async () => {
    fs.renameSync(worktree, path.join(root, 'preserved'));
    fs.mkdirSync(worktree); git(worktree, 'init', '-q');
    expect(await adoptListedWorktree({ registry, workspace: registry.getWorkspace('ws')!, worktreePath: worktree, listWorktrees: list }))
      .toMatchObject({ success: false, error: expect.stringMatching(/identity changed/) });
    expect(registry.getCheckoutContextsForWorkspace('ws')).toHaveLength(1);
  });
  it('fails closed on a listed directory replaced by a symlink', async () => {
    fs.renameSync(worktree, path.join(root, 'preserved'));
    fs.symlinkSync(path.join(root, 'preserved'), worktree, 'dir');
    expect(await service.attach('agent', 3)).toMatchObject({ success: false });
    expect(registry.getCheckoutContextsForWorkspace('ws')).toHaveLength(1);
  });
  it.each(['last-reported', 'unavailable'] as const)('refuses %s evidence', async state => {
    report.locationProvenance!.state = state;
    expect(await service.attach('agent', 3)).toMatchObject({ success: false });
    expect(list).not.toHaveBeenCalled();
  });
  it('refuses stale revisions, unknown provenance and mismatched native roots/environments', async () => {
    expect(await service.attach('agent', 2)).toMatchObject({ success: false });
    report.locationProvenance = null;
    expect(await service.attach('agent', 3)).toMatchObject({ success: false });
    report.locationProvenance = { state: 'current', sessionId: 'other' };
    expect(await service.attach('agent', 3)).toMatchObject({ success: false });
    report.locationProvenance.sessionId = 'S'; terminal!.environmentId = 'other';
    expect(await service.attach('agent', 3)).toMatchObject({ success: false });
    expect(list).not.toHaveBeenCalled();
  });
  it.each(['location', 'session', 'terminal', 'workspace'])('rejects a %s change during discovery', async kind => {
    list.mockImplementationOnce(async () => {
      if (kind === 'location') report = { ...report, revision: 4, location: { path: repo, checkoutContextId: 'ws::main' } };
      if (kind === 'session') report = { ...report, sessionId: 'other' };
      if (kind === 'terminal') terminal = { ...terminal! };
      if (kind === 'workspace') registry.unregisterWorkspace('ws');
      return { success: true, worktrees: [] };
    });
    expect(await service.attach('agent', 3)).toMatchObject({ success: false, error: expect.stringMatching(/changed/) });
  });
  it('does not publish a root when native evidence changes during registration validation', async () => {
    const original = validate.getMockImplementation()!;
    const register = registry.registerCheckoutContext.bind(registry);
    let registering = false;
    vi.spyOn(registry, 'registerCheckoutContext').mockImplementation(input => { registering = true; return register(input); });
    validate.mockImplementation(async directory => {
      if (registering) report = { ...report, revision: 4 };
      return original(directory);
    });
    expect(await service.attach('agent', 3)).toMatchObject({ success: false });
    expect(registry.getCheckoutContextsForWorkspace('ws')).toHaveLength(1);
  });
  it('does not publish a root when Git locks it during final validation', async () => {
    const original = list.getMockImplementation()!;
    list.mockImplementation(async () => { if (list.mock.calls.length === 3) git(repo, 'worktree', 'lock', worktree); return original(); });
    expect(await service.attach('agent', 3)).toMatchObject({ success: false });
    expect(registry.getCheckoutContextsForWorkspace('ws')).toHaveLength(1);
  });
  it('honors SSH removal/recovery reservations without granting a context', async () => {
    await setup('ssh-fixture');
    const release = registry.reserveRemotePaths('ssh-fixture', [worktree]);
    expect(await service.attach('agent', 3)).toMatchObject({ success: false, error: expect.stringMatching(/being removed|recovery/) });
    expect(registry.getCheckoutContextsForWorkspace('ws')).toHaveLength(1);
    release?.();
  });
  it('bounds discovery concurrency and refuses duplicate confirmed attachments', async () => {
    let resolve!: (value: { success: boolean; worktrees: [] }) => void;
    const waiting = new Promise<{ success: boolean; worktrees: [] }>(done => { resolve = done; });
    list.mockReturnValue(waiting);
    const many = new ObservedWorktreeService({ registry, getTerminal: () => terminal,
      snapshot: id => ({ ...report, terminalId: id }), listWorktrees: list });
    const pending = Array.from({ length: 16 }, (_, index) => many.inspect(`agent-${index}`, 3));
    expect(await many.inspect('overflow', 3)).toMatchObject({ success: false, error: expect.stringMatching(/busy/) });
    const attaching = service.attach('agent', 3);
    expect(await service.attach('agent', 3)).toMatchObject({ success: false, error: expect.stringMatching(/busy/) });
    resolve({ success: true, worktrees: [] }); await Promise.all([...pending, attaching]);
  });
  it('fails safely on a listing error and coalesces concurrent inspection', async () => {
    list.mockResolvedValueOnce({ success: false, worktrees: [], error: 'SSH unavailable' });
    const a = service.inspect('agent', 3), b = service.inspect('agent', 3);
    expect(a).toBe(b); expect(await a).toMatchObject({ success: false, error: 'SSH unavailable' });
    expect(registry.getCheckoutContextsForWorkspace('ws')[0].missing).toBeUndefined();
    expect(list).toHaveBeenCalledTimes(1);
  });
});
