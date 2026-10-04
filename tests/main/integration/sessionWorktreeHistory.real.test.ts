/**
 * Issue #100 end to end on a real Git repository: real GitService, WorkspaceRegistry, Git and session IPC,
 * real Claude/Pi history parsing from an isolated HOME. Only Electron and node-pty are replaced.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { testHome } from '../../_helpers/tempPaths';

const { handlers, mockPtySpawn } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  mockPtySpawn: vi.fn(),
}));
vi.mock('node-pty', () => ({ spawn: mockPtySpawn }));
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => testHome()), on: vi.fn(), quit: vi.fn() },
  BrowserWindow: vi.fn(),
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => { handlers.set(channel, fn); }, on: vi.fn() },
  clipboard: { writeText: vi.fn() }, dialog: { showOpenDialog: vi.fn() }, shell: { openExternal: vi.fn() },
}));
vi.mock('../../../src/main/ipc/settingsIpc', async () => {
  const { resolveExistingDirectory } = await import('../../../src/main/security');
  const { toNativePath } = await import('../../../src/shared/pathNormalize');
  return {
    getValidatedWorkspacePath: (value: string) => (value ? resolveExistingDirectory(toNativePath(value, process.platform)) : null),
    getInvalidWorkspaceResult: () => ({ success: false, error: 'Workspace path is invalid or not a directory' }),
    refreshGitStatus: vi.fn(),
  };
});

import { registerGitIpc } from '../../../src/main/ipc/gitIpc';
import { registerSessionIpc } from '../../../src/main/ipc/sessionIpc';
import { GitService } from '../../../src/main/gitService';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import { LocalEnvironment } from '../../../src/main/environment/localEnvironment';
import { WorktreeProvenance } from '../../../src/main/worktreeProvenance';
import { releaseCheckoutContext } from '../../../src/main/checkoutContextRelease';
import { clearSessionCache } from '../../../src/main/sessionHistory';
import { toPosixPath } from '../../../src/shared/pathNormalize';
import { GIT_CREATE_WORKTREE, REGISTER_OPEN_WORKSPACE, RECONCILE_CHECKOUT_CONTEXTS, SESSION_DISCOVER, SESSION_INVOKE } from '../../../src/shared/ipcChannels';
import type { GitWorktreeCreateResult } from '../../../src/shared/types/git';
import type { HarnessSession } from '../../../src/shared/types/session';

const execFileAsync = promisify(execFile);
const call = <T>(channel: string, ...args: unknown[]): Promise<T> => Promise.resolve(handlers.get(channel)!(null, ...args) as T);

let root: string;
let repo: string;
let home: string;
let savedHome: string | undefined;
let savedProfile: string | undefined;
let service: GitService;
let registry: WorkspaceRegistry;
let provenance: WorktreeProvenance;
let gitIpc: ReturnType<typeof registerGitIpc>;
let stored: unknown;
const git = (...args: string[]) => execFileAsync('git', args, { cwd: repo });

beforeAll(async () => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-sessions-real-')));
  repo = path.join(root, 'clanker');
  home = path.join(root, 'home');
  fs.mkdirSync(repo); fs.mkdirSync(home);
  savedHome = process.env.HOME;
  savedProfile = process.env.USERPROFILE;
  process.env.HOME = home; // os.homedir() on POSIX: every harness store below lives in this isolated home
  process.env.USERPROFILE = home; // ... and on Windows
  await git('init', '--initial-branch', 'main');
  await git('config', 'user.name', 'Sessions Test');
  await git('config', 'user.email', 'sessions@example.invalid');
  fs.writeFileSync(path.join(repo, 'README.md'), 'initial\n');
  await git('add', 'README.md');
  await git('commit', '-m', 'Initial commit');
});
afterAll(() => {
  if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
  if (savedProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedProfile;
  fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  handlers.clear();
  clearSessionCache();
  mockPtySpawn.mockReset();
  mockPtySpawn.mockReturnValue({ pid: 99, write: vi.fn(), onData: vi.fn(), onExit: vi.fn(), kill: vi.fn(), resize: vi.fn() });
  const local = new LocalEnvironment();
  registry = new WorkspaceRegistry(() => local, { isWorktreeBeingRemoved: (p) => service.isWorktreeBeingRemoved(p) });
  service = new GitService(() => undefined, async () => undefined, () => [], () => registry.getLocalOpenWorkspacePaths());
  stored = [];
  provenance = new WorktreeProvenance({ read: () => stored, write: (records) => { stored = JSON.parse(JSON.stringify(records)); } });
  gitIpc = registerGitIpc({
    getGitService: () => service, getMainWindow: () => null, getWorkspaceRegistry: () => registry, worktreeProvenance: provenance,
    // Exactly as main.ts wires it: the release check over main's own terminal table (none here).
    releaseCheckoutContext: (workspaceId, checkoutContextId) => releaseCheckoutContext({ registry, terminals: [].values(), workspaceId, checkoutContextId }),
  });
  const scoped = <T>(workspaceId: string, run: (workspacePath: string) => Promise<T>): Promise<T> => {
    const ws = registry.getWorkspace(workspaceId)!;
    return service.withWorkspace({ workspacePath: ws.location.path, workspaceId, environmentId: 'local' }, () => run(ws.location.path));
  };
  registerSessionIpc({
    getTerminals: () => new Map(), getMainWindow: () => null, getSafeWorkspacePath: (dir) => dir, getIsShuttingDown: () => false,
    getStore: () => ({ get: () => ({}) }) as never,
    getHarnessOptions: () => ({ claude: { name: 'Claude', command: 'claude', args: [], icon: '' }, pi: { name: 'Pi', command: 'pi', args: [], icon: '' } }),
    getWorkspaceRegistry: () => registry,
    listWorktrees: (id) => scoped(id, (p) => service.listWorktrees(p)),
    listBranches: (id) => scoped(id, async (p) => (await service.getBranches(p)).map((b) => b.name)),
    worktreeProvenance: provenance,
    recreateWorktree: (id, branch) => gitIpc.createWorktreeForSession(id, branch),
    ensureHarnessWrapperScript: () => null,
    harnessSpawnOverrides: { platform: 'linux', fileExists: () => true },
  });
});

const encodeClaude = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, '-');
function claudeSession(id: string, cwd: string) {
  const dir = path.join(home, '.claude', 'projects', encodeClaude(cwd));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), `${JSON.stringify({ type: 'user', cwd, sessionId: id, timestamp: new Date().toISOString(), message: { role: 'user', content: `claude ${id}` } })}\n`);
}
function piSession(id: string, cwd: string) {
  const dir = path.join(home, '.pi', 'agent', 'sessions', `--${encodeClaude(cwd)}--`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `2026-10-01T00-00-00-000Z_${id}.jsonl`), `${JSON.stringify({ type: 'session', version: 3, id, timestamp: '2026-10-01T00:00:00.000Z', cwd })}\n`);
}
const open = () => call<{ success: boolean }>(REGISTER_OPEN_WORKSPACE, 'ws', toPosixPath(repo));
const discover = () => call<HarnessSession[]>(SESSION_DISCOVER, 'ws');
const byId = (sessions: HarnessSession[], id: string) => sessions.find((entry) => entry.id === id);
const spawnOptions = () => mockPtySpawn.mock.calls[mockPtySpawn.mock.calls.length - 1][2] as { cwd: string };
const piHarnessSession = (id: string, cwd: string): HarnessSession => ({ id, harness: 'pi', title: 'Pi', cwd: toPosixPath(cwd), timestamp: 0 });
const claudeHarnessSession = (id: string, cwd: string): HarnessSession => ({ id, harness: 'claude', title: 'Claude', cwd: toPosixPath(cwd), timestamp: 0 });

describe('isolated-agent conversations on a real repository (issue #100)', () => {
  it('lists, labels and resumes conversations through the whole worktree lifecycle', async () => {
    await open();
    const created = await call<GitWorktreeCreateResult>(GIT_CREATE_WORKTREE, toPosixPath(repo), 'main', 'feature/foo', 'ws', { attachCheckoutContext: true });
    expect(created.success).toBe(true);
    const worktree = created.worktree!.path;
    fs.mkdirSync(path.join(worktree, 'src'));
    const container = path.join(root, 'clanker-worktrees');
    expect(toPosixPath(worktree)).toBe(toPosixPath(path.join(container, path.basename(worktree))));
    claudeSession('11111111-1111-4111-8111-111111111111', path.join(worktree, 'src'));
    piSession('pi-live', worktree);
    claudeSession('22222222-2222-4222-8222-222222222222', repo); // an ordinary main-checkout conversation
    claudeSession('33333333-3333-4333-8333-333333333333', path.join(container, 'random-folder')); // not a worktree of this repository
    claudeSession('44444444-4444-4444-8444-444444444444', path.join(root, 'clanker-other')); // another repository

    // 1. Live: discovered with the real branch; resumes into its registered context, confined to it.
    let sessions = await discover();
    expect(sessions.map((entry) => entry.id).sort()).toEqual(['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'pi-live']);
    expect(byId(sessions, '11111111-1111-4111-8111-111111111111')?.checkout).toEqual({ branch: 'feature/foo', path: toPosixPath(worktree), exists: true });
    const live = await call<{ checkoutContextId?: string; checkoutContext?: { id: string; branch?: string } }>(SESSION_INVOKE, 'ws', claudeHarnessSession('11111111-1111-4111-8111-111111111111', path.join(worktree, 'src')));
    expect(live.checkoutContext).toMatchObject({ id: created.checkoutContext!.id, branch: 'feature/foo' });
    expect(live.checkoutContextId).toBe(created.checkoutContext!.id);
    expect(spawnOptions().cwd).toBe(path.join(worktree, 'src'));

    // 2. Removed (Git forgets it, the branch remains): still listed, labelled with the real branch.
    await git('worktree', 'remove', '--force', worktree);
    await call(RECONCILE_CHECKOUT_CONTEXTS, 'ws');
    clearSessionCache();
    sessions = await discover();
    expect(byId(sessions, '11111111-1111-4111-8111-111111111111')?.checkout).toEqual({ branch: 'feature/foo', path: toPosixPath(worktree), exists: false });
    expect(byId(sessions, '33333333-3333-4333-8333-333333333333')).toBeUndefined();
    expect(byId(sessions, '44444444-4444-4444-8444-444444444444')).toBeUndefined();

    // 3a. Claude (proven to resume from elsewhere) resumes in the main checkout and says so; the removed path is never the cwd.
    mockPtySpawn.mockClear();
    const fallback = await call<{ resumeNotice?: string; checkoutContextId?: string; workingDir?: string }>(SESSION_INVOKE, 'ws', claudeHarnessSession('11111111-1111-4111-8111-111111111111', path.join(worktree, 'src')));
    expect(fallback.resumeNotice).toMatch(/feature\/foo.*was removed.*main checkout/);
    expect(fallback.checkoutContextId).toBe('ws::main');
    expect(spawnOptions().cwd).toBe(repo);
    expect(fs.existsSync(worktree)).toBe(false);

    // 3b. Pi only resumes where it started: main offers, creates nothing until confirmed, then recreates at the same path.
    mockPtySpawn.mockClear();
    const offer = await call<{ recreateOffer?: { branch: string; path: string } }>(SESSION_INVOKE, 'ws', piHarnessSession('pi-live', worktree));
    expect(offer).toEqual({ recreateOffer: { branch: 'feature/foo', path: toPosixPath(worktree) } });
    expect(fs.existsSync(worktree)).toBe(false);
    expect(mockPtySpawn).not.toHaveBeenCalled();
    const recreated = await call<{ checkoutContextId?: string; checkoutContext?: { branch?: string }; resumeNotice?: string }>(SESSION_INVOKE, 'ws', piHarnessSession('pi-live', worktree), false, { recreateCheckout: true });
    expect(fs.existsSync(path.join(worktree, 'README.md'))).toBe(true);
    expect(recreated.checkoutContext).toMatchObject({ branch: 'feature/foo' });
    expect(recreated.resumeNotice).toMatch(/Recreated the worktree for feature\/foo/);
    expect(registry.getCheckoutContext(recreated.checkoutContextId!)?.path).toBe(toPosixPath(worktree));
    expect(spawnOptions().cwd).toBe(worktree);
  });

  it('keeps attributing a removed worktree after its branch is deleted, and says precisely why Pi cannot resume it', async () => {
    await open();
    const created = await call<GitWorktreeCreateResult>(GIT_CREATE_WORKTREE, toPosixPath(repo), 'main', 'feature/gone', 'ws', { attachCheckoutContext: true });
    const worktree = created.worktree!.path;
    claudeSession('55555555-5555-4555-8555-555555555555', worktree);
    piSession('pi-gone', worktree);
    await discover(); // main observes the listing (and remembers the worktree)
    await git('worktree', 'remove', '--force', worktree);
    await git('branch', '-D', 'feature/gone');
    await call(RECONCILE_CHECKOUT_CONTEXTS, 'ws');
    clearSessionCache();
    const sessions = await discover();
    // The branch name survives only in main's own memory, which is exactly what labels it now.
    expect(byId(sessions, '55555555-5555-4555-8555-555555555555')?.checkout).toEqual({ branch: 'feature/gone', path: toPosixPath(worktree), exists: false });
    await expect(call(SESSION_INVOKE, 'ws', piHarnessSession('pi-gone', worktree))).rejects.toThrow(/branch "feature\/gone" no longer exists.*Pi can only resume in the directory it started in/);
    expect(mockPtySpawn).not.toHaveBeenCalled();
  });

  it('adopts a worktree made outside Clanker on resume and keeps it attributable after removal', async () => {
    await open();
    const sibling = path.join(root, 'clanker-sibling');
    await git('worktree', 'add', '-b', 'sib', sibling);
    claudeSession('66666666-6666-4666-8666-666666666666', sibling);
    const sessions = await discover();
    expect(byId(sessions, '66666666-6666-4666-8666-666666666666')?.checkout).toEqual({ branch: 'sib', path: toPosixPath(fs.realpathSync.native(sibling)), exists: true });
    const resumed = await call<{ checkoutContext?: { branch?: string; kind?: string } }>(SESSION_INVOKE, 'ws', claudeHarnessSession('66666666-6666-4666-8666-666666666666', sibling));
    expect(resumed.checkoutContext).toMatchObject({ kind: 'worktree', branch: 'sib' });
    expect(spawnOptions().cwd).toBe(fs.realpathSync.native(sibling));
    // Remove it: Git forgets it, the adopted-sibling branch stays attributable through main's memory.
    await git('worktree', 'remove', '--force', sibling);
    clearSessionCache();
    const later = await discover();
    expect(byId(later, '66666666-6666-4666-8666-666666666666')?.checkout).toMatchObject({ branch: 'sib', exists: false });
  });
});
