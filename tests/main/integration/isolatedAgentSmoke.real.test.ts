/**
 * The local isolated-agent flow, end to end, with nothing between the renderer logic and Git faked
 * except Electron's transport and node-pty:
 *
 *   real renderer store + helpers  ->  window.electronAPI shim  ->  real IPC handlers
 *   ->  real WorkspaceRegistry / GitService  ->  a real Git repository on disk
 *
 * It stands in for a manual smoke test of the same steps; it is not a GUI run.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
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
  clipboard: { writeText: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openExternal: vi.fn() },
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
import { registerTerminalIpc } from '../../../src/main/ipc/terminalIpc';
import { GitService } from '../../../src/main/gitService';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import { LocalEnvironment } from '../../../src/main/environment/localEnvironment';
import * as C from '../../../src/shared/ipcChannels';
import { toPosixPath } from '../../../src/shared/pathNormalize';
import { createMainCheckoutContext } from '../../../src/shared/checkoutContext';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createIsolatedAgent } from '../../../src/renderer/lib/isolatedAgentLaunch';
import { removeWorktreeCheckout } from '../../../src/renderer/lib/worktreeCheckoutRemoval';
import { findManagedWorktreeContext, getAgentWorktreeContext, getUnusedWorktreeContexts } from '../../../src/renderer/lib/worktreeAgents';
import { removeUnmanagedWorktree } from '../../../src/renderer/lib/unmanagedWorktreeRemoval';
import type { GitWorktree } from '../../../src/shared/types/git';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';

const execFileAsync = promisify(execFile);
const call = (channel: string, ...args: unknown[]) => Promise.resolve(handlers.get(channel)!(null, ...args));

let root: string;
let repo: string;
let registry: WorkspaceRegistry;
const terminals = new Map();

const git = (...args: string[]) => execFileAsync('git', args, { cwd: repo });

beforeAll(async () => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-smoke-')));
  repo = path.join(root, 'clanker');
  fs.mkdirSync(repo);
  await git('init', '--initial-branch', 'main');
  await git('config', 'user.name', 'Smoke Test');
  await git('config', 'user.email', 'smoke@example.invalid');
  fs.writeFileSync(path.join(repo, 'README.md'), 'initial\n');
  await git('add', 'README.md');
  await git('commit', '-m', 'Initial commit');
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  handlers.clear();
  terminals.clear();
  mockPtySpawn.mockReset();
  let pid = 100;
  mockPtySpawn.mockImplementation(() => ({ pid: ++pid, write: vi.fn(), onData: vi.fn(), onExit: vi.fn(), kill: vi.fn(), resize: vi.fn() }));
  const local = new LocalEnvironment();
  registry = new WorkspaceRegistry(() => local, { isWorktreeBeingRemoved: (p) => service.isWorktreeBeingRemoved(p) });
  const service: GitService = new GitService(
    () => undefined,
    async () => undefined,
    () => [...terminals.values()].map((terminal) => terminal.cwd as string | undefined).filter((cwd): cwd is string => typeof cwd === 'string'),
    () => registry.getLocalOpenWorkspacePaths(),
  );
  registerGitIpc({ getGitService: () => service, getMainWindow: () => null, getWorkspaceRegistry: () => registry });
  registerTerminalIpc({
    getTerminals: () => terminals,
    getMainWindow: () => null,
    getStore: () => ({ get: (key: string) => (key === 'harnessDefaults' ? {} : false) }) as never,
    getSafeWorkspacePath: (dir) => (fs.existsSync(dir) ? dir : testHome()),
    getHarnessOptions: () => ({}),
    getWorkspaceRegistry: () => registry,
  });

  // The preload bridge, minus Electron: each method is the channel call it makes in production.
  const bridge = {
    registerOpenWorkspace: (id: string, p: string, env?: string) => call(C.REGISTER_OPEN_WORKSPACE, id, p, env),
    spawnTerminal: (...args: unknown[]) => call(C.SPAWN_TERMINAL, ...args),
    killTerminal: (id: string) => call(C.KILL_TERMINAL, id),
    gitGetBranchState: (p: string, id?: string) => call(C.GIT_GET_BRANCH_STATE, p, id),
    gitCreateWorktree: (...args: unknown[]) => call(C.GIT_CREATE_WORKTREE, ...args),
    releaseCheckoutContext: (workspaceId: string, contextId: string) => call(C.RELEASE_CHECKOUT_CONTEXT, workspaceId, contextId),
    gitListWorktrees: (p: string, id?: string) => call(C.GIT_LIST_WORKTREES, p, id),
    gitInspectWorktree: (...args: unknown[]) => call(C.GIT_INSPECT_WORKTREE, ...args),
    gitRemoveWorktree: (...args: unknown[]) => call(C.GIT_REMOVE_WORKTREE, ...args),
  };
  (globalThis as { window?: unknown }).window = { electronAPI: bridge };
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, clear: () => undefined };
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, activeWorkspaceLifecycle: null, terminals: [], panes: [], activeTerminalId: null });
});

const api = () => (globalThis as unknown as { window: { electronAPI: Record<string, (...args: unknown[]) => Promise<any>> } }).window.electronAPI; // eslint-disable-line @typescript-eslint/no-explicit-any
const workspace = () => useWorkspaceStore.getState().getWorkspaceById('ws')!;
const spawnedCwds = () => mockPtySpawn.mock.calls.map((callArgs) => callArgs[2].cwd as string);

/** What App.tsx does when a project is opened, followed by a normal (current-checkout) agent. */
async function openProjectWithNormalAgent() {
  const registration = await api().registerOpenWorkspace('ws', toPosixPath(repo));
  expect(registration.success).toBe(true);
  const canonical = registration.location.path as string;
  const info = await api().spawnTerminal(canonical, undefined, undefined);
  useWorkspaceStore.getState().addWorkspace({
    id: 'ws', name: 'clanker', workspacePath: canonical, environmentId: 'local', harness: '', model: '',
    checkoutContexts: [registration.checkoutContext as CheckoutContext ?? createMainCheckoutContext({ workspaceId: 'ws', path: canonical })],
    terminals: [{ id: info.id, pid: info.pid, workingDir: canonical, workspaceId: 'ws', environmentId: 'local', checkoutContextId: info.checkoutContextId }],
    panes: [], browserVisible: false, browserOverlayCount: 0, browserUrl: 'https://github.com', activeTerminalId: info.id,
    browserPane: null, layoutRoot: null, explorerVisible: false, explorerSidebarWidth: 280, explorerExpandedPaths: [],
    explorerSelectedPath: null, explorerEntriesByPath: {}, explorerLoadingPaths: [], explorerErrorsByPath: {}, showHiddenFiles: true,
    editorPane: null, editorVisible: false, editorTabs: [], activeEditorTabId: null,
    gitChanges: [], gitCurrentBranch: 'main', gitIsRepo: true, gitIsDetached: false,
    runtimeState: { residencyState: 'warm', resourcePolicy: { terminals: 'warm', browser: 'warm', explorer: 'cached', editor: 'warm' } },
  });
  return { canonical, normalAgentId: info.id as string };
}

describe('isolated agent smoke (real renderer logic, real main process, real Git)', () => {
  it('open repo -> normal agent -> isolated agent -> both under one workspace -> close it -> inactive row -> remove', async () => {
    const { canonical, normalAgentId } = await openProjectWithNormalAgent();
    expect(workspace().terminals).toHaveLength(1);

    // Create an isolated agent (a plain shell, as the toolbar's Terminal option would).
    const created = await createIsolatedAgent({ workspaceId: 'ws', harnessId: '', taskBranch: 'smoke-task', visibleHarnessIds: [''] });
    expect(created).toEqual({ ok: true });

    // Both agents live under the one workspace; the isolated shell runs in the new worktree.
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    expect(registry.getAllWorkspaces()).toHaveLength(1);
    expect(workspace().workspacePath).toBe(canonical);
    expect(workspace().terminals).toHaveLength(2);
    const isolated = workspace().terminals.find((terminal) => terminal.id !== normalAgentId)!;
    const context = getAgentWorktreeContext(workspace(), isolated)!;
    expect(context).toMatchObject({ kind: 'worktree', branch: 'smoke-task', workspaceId: 'ws' });
    expect(path.dirname(context.path)).toBe(toPosixPath(path.join(root, 'clanker-worktrees')));
    expect(spawnedCwds()).toEqual([repo, path.normalize(context.path)]);
    expect(getAgentWorktreeContext(workspace(), workspace().terminals.find((terminal) => terminal.id === normalAgentId)!)).toBeNull();
    expect(getUnusedWorktreeContexts(workspace())).toEqual([]);
    expect((await git('branch', '--list', 'smoke-task')).stdout).toContain('smoke-task');

    // While the isolated agent runs, the checkout cannot be released or removed.
    expect(await removeWorktreeCheckout(workspace(), context)).toMatchObject({ success: false, stage: 'release', released: false });
    expect(fs.existsSync(path.join(context.path, 'README.md'))).toBe(true);

    // Close the isolated agent.
    await api().killTerminal(isolated.id);
    useWorkspaceStore.getState().removeTerminal(isolated.id);
    expect(getUnusedWorktreeContexts(workspace()).map((entry) => entry.id)).toEqual([context.id]);

    // Remove the clean, now-inactive checkout.
    expect(await removeWorktreeCheckout(workspace(), context)).toMatchObject({ success: true });
    expect(fs.existsSync(context.path)).toBe(false);
    expect((await git('branch', '--list', 'smoke-task')).stdout).toContain('smoke-task');
    expect(getUnusedWorktreeContexts(workspace())).toEqual([]);
    expect(workspace().checkoutContexts!.map((entry) => entry.kind)).toEqual(['main']);
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    expect(registry.getWorkspace('ws')).not.toBeNull();
    expect(workspace().terminals.map((terminal) => terminal.id)).toEqual([normalAgentId]);
  });

  it('a failed launch leaves a visible inactive checkout that can then be removed', async () => {
    await openProjectWithNormalAgent();
    const realSpawn = api().spawnTerminal;
    api().spawnTerminal = async (...args: unknown[]) => {
      if (args[7]) throw new Error('simulated launch failure');
      return realSpawn(...args);
    };

    const created = await createIsolatedAgent({ workspaceId: 'ws', harnessId: '', taskBranch: 'launch-fails', visibleHarnessIds: [''] });

    expect(created).toMatchObject({ ok: false, checkoutCreated: true, error: expect.stringContaining('simulated launch failure') });
    const [stranded] = getUnusedWorktreeContexts(workspace());
    expect(stranded).toMatchObject({ branch: 'launch-fails' });
    expect(fs.existsSync(path.join(stranded.path, 'README.md'))).toBe(true);

    expect(await removeWorktreeCheckout(workspace(), stranded)).toMatchObject({ success: true });
    expect(fs.existsSync(stranded.path)).toBe(false);
    expect(workspace().terminals).toHaveLength(1);
  });

  it('removal of a dirty inactive checkout is refused, the checkout stays on disk, and the context stays released', async () => {
    await openProjectWithNormalAgent();
    await createIsolatedAgent({ workspaceId: 'ws', harnessId: '', taskBranch: 'dirty-task', visibleHarnessIds: [''] });
    const isolated = workspace().terminals[1];
    const context = getAgentWorktreeContext(workspace(), isolated)!;
    await api().killTerminal(isolated.id);
    useWorkspaceStore.getState().removeTerminal(isolated.id);
    fs.writeFileSync(path.join(context.path, 'wip.txt'), 'unsaved\n');

    const result = await removeWorktreeCheckout(workspace(), context);

    expect(result).toMatchObject({ success: false, stage: 'inspect', released: true, error: expect.stringContaining('uncommitted') });
    expect(fs.existsSync(path.join(context.path, 'wip.txt'))).toBe(true);
    expect((await git('branch', '--list', 'dirty-task')).stdout).toContain('dirty-task');
    expect(getUnusedWorktreeContexts(workspace())).toEqual([]);
    expect(registry.getCheckoutContextsForWorkspace('ws')).toHaveLength(1);
  });
});

describe('Git menu worktree management (real Git, worktrees Clanker did not create)', () => {
  /** A worktree made the way a shell, another tool or the old launcher would: no context, no Clanker. */
  function externalWorktree(name: string, branch = name): string {
    const dirPath = path.join(root, 'external', name);
    execFileSync('git', ['worktree', 'add', '-b', branch, dirPath], { cwd: repo, stdio: 'ignore' });
    return fs.realpathSync.native(dirPath);
  }
  const listing = async (): Promise<GitWorktree[]> =>
    (await api().gitListWorktrees(toPosixPath(repo), 'ws')).worktrees.filter((entry: GitWorktree) => !entry.isMain);
  const entryFor = async (dirPath: string): Promise<GitWorktree> =>
    (await listing()).find((entry) => path.normalize(entry.path) === path.normalize(dirPath))!;
  const hasBranch = async (name: string) => (await git('branch', '--list', name)).stdout.includes(name);

  it('lists an external worktree as unmanaged and an isolated one as managed', async () => {
    await openProjectWithNormalAgent();
    const external = externalWorktree('ext-listed');
    await createIsolatedAgent({ workspaceId: 'ws', harnessId: '', taskBranch: 'managed-one', visibleHarnessIds: [''] });

    // The repository is shared with the other tests, so look only at the two this test made.
    const entries = (await listing()).filter((entry) => entry.branch === 'managed-one' || path.normalize(entry.path) === path.normalize(external));
    const managed = entries.filter((entry) => findManagedWorktreeContext(workspace(), entry.path));
    const unmanaged = entries.filter((entry) => !findManagedWorktreeContext(workspace(), entry.path));

    expect(entries).toHaveLength(2);
    expect(managed.map((entry) => entry.branch)).toEqual(['managed-one']);
    expect(unmanaged.map((entry) => path.normalize(entry.path))).toEqual([path.normalize(external)]);
  });

  it('removes a clean unmanaged worktree through the existing safeguards, keeping its branch', async () => {
    await openProjectWithNormalAgent();
    const external = externalWorktree('ext-clean');

    const result = await removeUnmanagedWorktree(workspace(), await entryFor(external));

    expect(result).toMatchObject({ success: true });
    expect(fs.existsSync(external)).toBe(false);
    expect(await hasBranch('ext-clean')).toBe(true);
    expect((await listing()).some((entry) => path.normalize(entry.path) === path.normalize(external))).toBe(false);
    expect(registry.getWorkspace('ws')).not.toBeNull();
  });

  it.each([
    ['an untracked file', (dir: string) => fs.writeFileSync(path.join(dir, 'notes.txt'), 'wip\n')],
    ['a modified tracked file', (dir: string) => fs.writeFileSync(path.join(dir, 'README.md'), 'changed\n')],
    ['an ignored file', (dir: string) => {
      fs.writeFileSync(path.join(dir, '.gitignore'), 'secret.env\n');
      execFileSync('git', ['add', '.gitignore'], { cwd: dir });
      execFileSync('git', ['commit', '-m', 'ignore secrets'], { cwd: dir, stdio: 'ignore' });
      fs.writeFileSync(path.join(dir, 'secret.env'), 'token\n');
    }],
  ])('refuses an unmanaged worktree with %s, leaving it and its branch alone', async (label, dirty) => {
    await openProjectWithNormalAgent();
    const name = `ext-dirty-${label.replace(/\W+/g, '-')}`;
    const external = externalWorktree(name);
    dirty(external);

    const result = await removeUnmanagedWorktree(workspace(), await entryFor(external));

    expect(result).toMatchObject({ success: false, stage: 'inspect', error: expect.stringContaining('uncommitted') });
    expect(fs.existsSync(path.join(external, '.git'))).toBe(true);
    expect(await hasBranch(name)).toBe(true);
  });

  it('refuses when the branch is not the one inspected, even if everything else is clean', async () => {
    await openProjectWithNormalAgent();
    const external = externalWorktree('ext-switch');
    const entry = await entryFor(external);
    const openPaths = [toPosixPath(repo)];
    const inspection = await api().gitInspectWorktree(toPosixPath(repo), entry.path, openPaths, 'ws');
    expect(inspection).toMatchObject({ success: true, hasChanges: false });

    execFileSync('git', ['switch', '-c', 'switched-meanwhile'], { cwd: external, stdio: 'ignore' });
    const removal = await api().gitRemoveWorktree(toPosixPath(repo), entry.path, inspection.worktree.branch, openPaths, 'ws');

    expect(removal).toMatchObject({ success: false, error: expect.stringContaining('branch changed') });
    expect(fs.existsSync(path.join(external, '.git'))).toBe(true);
  });

  it('refuses a worktree that is open as its own workspace, and does not close that workspace', async () => {
    await openProjectWithNormalAgent();
    const external = externalWorktree('ext-open-as-tab');
    expect((await api().registerOpenWorkspace('legacy-tab', toPosixPath(external))).success).toBe(true);
    useWorkspaceStore.getState().addWorkspace({ ...workspace(), id: 'legacy-tab', workspacePath: toPosixPath(external), isLinkedWorktree: true, terminals: [], activeTerminalId: null });
    useWorkspaceStore.getState().selectWorkspace('ws');

    const result = await removeUnmanagedWorktree(workspace(), await entryFor(external));

    expect(result).toMatchObject({ success: false, stage: 'inspect', error: expect.stringContaining('Close this workspace tab') });
    expect(fs.existsSync(path.join(external, '.git'))).toBe(true);
    expect(useWorkspaceStore.getState().getWorkspaceById('legacy-tab')).not.toBeNull();
    expect(registry.getWorkspace('legacy-tab')).not.toBeNull();
  });

  it('refuses a worktree a live terminal is working in', async () => {
    await openProjectWithNormalAgent();
    const external = externalWorktree('ext-busy');
    await api().spawnTerminal(toPosixPath(external), undefined, undefined);

    const result = await removeUnmanagedWorktree(workspace(), await entryFor(external));

    expect(result).toMatchObject({ success: false, stage: 'inspect' });
    expect(fs.existsSync(path.join(external, '.git'))).toBe(true);
  });

  it('keeps managed and unmanaged lifecycles apart: an attached checkout is never removed directly', async () => {
    await openProjectWithNormalAgent();
    await createIsolatedAgent({ workspaceId: 'ws', harnessId: '', taskBranch: 'managed-two', visibleHarnessIds: [''] });
    const isolated = workspace().terminals[1];
    const context = getAgentWorktreeContext(workspace(), isolated)!;
    const entry = await entryFor(context.path);
    await api().killTerminal(isolated.id);
    useWorkspaceStore.getState().removeTerminal(isolated.id);

    // Even inactive, the direct path refuses; nothing is touched and the context stays attached.
    expect(await removeUnmanagedWorktree(workspace(), entry)).toMatchObject({ success: false, stage: 'validate' });
    expect(fs.existsSync(path.join(context.path, 'README.md'))).toBe(true);
    expect(workspace().checkoutContexts!.map((item) => item.id)).toContain(context.id);

    // The lifecycle path does release, inspect and remove, and the branch stays.
    expect(await removeWorktreeCheckout(workspace(), context)).toMatchObject({ success: true });
    expect(fs.existsSync(context.path)).toBe(false);
    expect(await hasBranch('managed-two')).toBe(true);
  });
});
