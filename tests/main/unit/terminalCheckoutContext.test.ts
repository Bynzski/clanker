/**
 * Terminal launches resolve their execution root through checkout context identity, against the
 * real WorkspaceRegistry (not a double) so the workspace -> context -> validated root seam is
 * what is exercised.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { testHome } from '../../_helpers/tempPaths';

const { mockHandle, mockOn, mockPtySpawn } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockOn: vi.fn(),
  mockPtySpawn: vi.fn(),
}));

vi.mock('node-pty', () => ({ spawn: mockPtySpawn }));
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => testHome()), on: vi.fn(), quit: vi.fn() },
  BrowserWindow: vi.fn(),
  ipcMain: { handle: mockHandle, on: mockOn },
  clipboard: { writeText: vi.fn() },
}));

import { registerTerminalIpc } from '../../../src/main/ipc/terminalIpc';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import type { WorkspaceEnvironment } from '../../../src/main/environment/workspaceEnvironment';
import { SPAWN_TERMINAL } from '../../../src/shared/ipcChannels';
import { mainCheckoutContextId } from '../../../src/shared/checkoutContext';
import { toPosixPath } from '../../../src/shared/pathNormalize';

type SpawnHandler = (
  event: null,
  workingDir: string,
  harness?: string,
  model?: string,
  initialCommand?: string,
  recipeCommand?: boolean,
  workspaceId?: string,
  environmentId?: string,
  checkoutContextId?: string,
) => Promise<{ id: string; pid: number; checkoutContextId?: string }>;

function ptyStub() {
  mockPtySpawn.mockReturnValue({ pid: 4321, write: vi.fn(), onData: vi.fn(), onExit: vi.fn(), kill: vi.fn(), resize: vi.fn() });
}

function install(registry: WorkspaceRegistry, getSafeWorkspacePath: (dir: string) => string = (dir) => dir) {
  const terminals = new Map();
  mockHandle.mockClear();
  registerTerminalIpc({
    getTerminals: () => terminals,
    getMainWindow: () => null,
    getStore: () => ({ get: (key: string) => (key === 'harnessDefaults' ? {} : false) }) as never,
    getSafeWorkspacePath,
    getHarnessOptions: () => ({}),
    getWorkspaceRegistry: () => registry,
  });
  const spawn = mockHandle.mock.calls.find((call) => call[0] === SPAWN_TERMINAL)?.[1] as SpawnHandler;
  return { spawn, terminals };
}

describe('remote terminals are confined to their checkout context root', () => {
  const resolveTerminalSpawn = vi.fn();
  const remoteEnvironment = {
    id: 'vps',
    kind: 'ssh',
    capabilities: { agentAttention: false },
    // A realpath-style validator: symlinks escape to /etc.
    validateWorkspacePath: vi.fn(async (dir: string) => ({ valid: true, resolvedPath: dir.endsWith('/escape') ? '/etc' : dir })),
    resolveTerminalSpawn,
  } as unknown as WorkspaceEnvironment;

  async function setup() {
    const registry = new WorkspaceRegistry((id) => (id === 'vps' ? remoteEnvironment : null));
    // The workspace is /projects/clanker; its sibling worktree lives under /projects/clanker-worktrees.
    await registry.registerWorkspace({ workspaceId: 'ws', workspacePath: '/projects/clanker', environmentId: 'vps' });
    const wt = await registry.registerCheckoutContext({ workspaceId: 'ws', path: '/projects/clanker-worktrees/issue-90', kind: 'worktree' });
    return { registry, worktreeId: wt.checkoutContext!.id, ...install(registry) };
  }

  beforeEach(() => {
    mockPtySpawn.mockReset();
    resolveTerminalSpawn.mockReset();
    resolveTerminalSpawn.mockResolvedValue({ spawnCmd: 'ssh', spawnArgs: [], cwd: process.cwd(), env: {} });
    ptyStub();
  });

  test('a launch with no context binds to the workspace main checkout and reports it', async () => {
    const { spawn, terminals } = await setup();
    const result = await spawn(null, '/projects/clanker/src', undefined, undefined, undefined, undefined, 'ws', 'vps');

    expect(result.checkoutContextId).toBe(mainCheckoutContextId('ws'));
    expect(terminals.get(result.id)).toMatchObject({
      workspaceId: 'ws',
      checkoutContextId: mainCheckoutContextId('ws'),
      remoteWorkingDir: '/projects/clanker/src',
    });
    expect(resolveTerminalSpawn).toHaveBeenCalledWith(expect.objectContaining({ workingDir: '/projects/clanker/src' }));
  });

  test('a launch naming a worktree context runs in that context\'s root, which is not under the workspace root', async () => {
    const { spawn, terminals, worktreeId } = await setup();
    const result = await spawn(null, '/projects/clanker-worktrees/issue-90', undefined, undefined, undefined, undefined, 'ws', 'vps', worktreeId);

    expect(result.checkoutContextId).toBe(worktreeId);
    expect(terminals.get(result.id)).toMatchObject({ checkoutContextId: worktreeId, remoteWorkingDir: '/projects/clanker-worktrees/issue-90' });
    expect(resolveTerminalSpawn).toHaveBeenCalledWith(expect.objectContaining({ workingDir: '/projects/clanker-worktrees/issue-90' }));
  });

  test('subdirectories of the context root are allowed', async () => {
    const { spawn, worktreeId } = await setup();
    await expect(spawn(null, '/projects/clanker-worktrees/issue-90/src/deep', undefined, undefined, undefined, undefined, 'ws', 'vps', worktreeId))
      .resolves.toMatchObject({ checkoutContextId: worktreeId });
  });

  test.each([
    ['the worktree root when launching the main checkout', '/projects/clanker-worktrees/issue-90', undefined],
    ['the main root when launching a worktree context', '/projects/clanker', 'worktree'],
    ['a sibling worktree of the same project', '/projects/clanker-worktrees/issue-91', 'worktree'],
    ['the parent of the context root', '/projects/clanker-worktrees', 'worktree'],
    ['the shared parent of the project', '/projects', undefined],
    ['a prefix-sharing sibling of the main root', '/projects/clanker-other', undefined],
    ['a traversal out of the context root', '/projects/clanker-worktrees/issue-90/../issue-91', 'worktree'],
    ['a symlink that resolves outside the context root', '/projects/clanker-worktrees/issue-90/escape', 'worktree'],
  ])('rejects %s', async (_label, workingDir, which) => {
    const { spawn, worktreeId } = await setup();
    const contextId = which === 'worktree' ? worktreeId : undefined;

    await expect(spawn(null, workingDir, undefined, undefined, undefined, undefined, 'ws', 'vps', contextId))
      .rejects.toThrow('Terminal directory is outside the registered workspace');
    expect(resolveTerminalSpawn).not.toHaveBeenCalled();
    expect(mockPtySpawn).not.toHaveBeenCalled();
  });

  test('rejects an unknown context, another workspace\'s context, and a non-string id', async () => {
    const { registry, spawn } = await setup();
    await registry.registerWorkspace({ workspaceId: 'other', workspacePath: '/projects/other', environmentId: 'vps' });

    for (const id of ['ws::made-up', mainCheckoutContextId('other')]) {
      await expect(spawn(null, '/projects/clanker', undefined, undefined, undefined, undefined, 'ws', 'vps', id))
        .rejects.toThrow('Checkout context is not registered for this workspace');
    }
    await expect(spawn(null, '/projects/clanker', undefined, undefined, undefined, undefined, 'ws', 'vps', 42 as never))
      .rejects.toThrow('Invalid checkout context');
    expect(mockPtySpawn).not.toHaveBeenCalled();
  });

  test('rejects a context that is only reachable without its workspace', async () => {
    const { spawn, worktreeId } = await setup();
    await expect(spawn(null, '/projects/clanker-worktrees/issue-90', undefined, undefined, undefined, undefined, undefined, 'vps', worktreeId))
      .rejects.toThrow();
    expect(mockPtySpawn).not.toHaveBeenCalled();
  });

  test('rejects a launch whose context is closed or its root reserved while the SSH launch is resolving', async () => {
    const { registry, spawn, worktreeId } = await setup();
    let finish!: () => void;
    resolveTerminalSpawn.mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => resolve({ spawnCmd: 'ssh', spawnArgs: [], cwd: process.cwd(), env: {} });
    }));

    const pending = spawn(null, '/projects/clanker-worktrees/issue-90', undefined, undefined, undefined, undefined, 'ws', 'vps', worktreeId);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    registry.unregisterCheckoutContext(worktreeId);
    finish();

    await expect(pending).rejects.toThrow('Remote workspace was closed or is being removed');
    expect(mockPtySpawn).not.toHaveBeenCalled();
  });

  test('closing the workspace invalidates its contexts for new launches', async () => {
    const { registry, spawn, worktreeId } = await setup();
    registry.unregisterWorkspace('ws');

    await expect(spawn(null, '/projects/clanker', undefined, undefined, undefined, undefined, 'ws', 'vps'))
      .rejects.toThrow('Workspace is not registered or not accessible');
    await expect(spawn(null, '/projects/clanker-worktrees/issue-90', undefined, undefined, undefined, undefined, 'ws', 'vps', worktreeId))
      .rejects.toThrow('Workspace is not registered or not accessible');
    expect(mockPtySpawn).not.toHaveBeenCalled();
  });
});

describe('local terminals resolve through checkout context identity', () => {
  let root: string;
  let main: string;
  let worktree: string;

  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-ckt-')));
    main = path.join(root, 'project');
    worktree = path.join(root, 'project-worktrees', 'task');
    fs.mkdirSync(main, { recursive: true });
    fs.mkdirSync(path.join(main, 'src'));
    fs.mkdirSync(worktree, { recursive: true });
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  const localEnvironment = {
    id: 'local',
    kind: 'local',
    validateWorkspacePath: vi.fn(async (dir: string) => ({ valid: true, resolvedPath: dir })),
  } as unknown as WorkspaceEnvironment;
  // Stands in for main.ts's resolver: usable directories as given, anything else the default.
  const safePath = (dir: string) => (fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? dir : testHome());

  async function setup() {
    const registry = new WorkspaceRegistry(() => localEnvironment);
    await registry.registerWorkspace({ workspaceId: 'ws', workspacePath: toPosixPath(main) });
    const wt = await registry.registerCheckoutContext({ workspaceId: 'ws', path: toPosixPath(worktree), kind: 'worktree' });
    return { registry, worktreeId: wt.checkoutContext!.id, ...install(registry, safePath) };
  }

  beforeEach(() => {
    mockPtySpawn.mockReset();
    ptyStub();
  });

  test('an existing-style launch (path only) is unchanged in directory and is bound to the main checkout', async () => {
    const { spawn, terminals } = await setup();
    const result = await spawn(null, toPosixPath(main));

    expect(mockPtySpawn).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ cwd: main }));
    expect(result.checkoutContextId).toBe(mainCheckoutContextId('ws'));
    expect(terminals.get(result.id)).toMatchObject({ cwd: main, checkoutContextId: mainCheckoutContextId('ws') });
  });

  test('a path-only launch in an unregistered directory stays unbound and still uses the safe path', async () => {
    const { spawn, terminals } = await setup();
    const result = await spawn(null, toPosixPath(path.join(main, 'src')));

    expect(mockPtySpawn).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ cwd: path.join(main, 'src') }));
    expect(result.checkoutContextId).toBeUndefined();
    expect(terminals.get(result.id)?.checkoutContextId).toBeUndefined();
  });

  test('a launch naming a worktree context runs in that worktree and records the context', async () => {
    const { spawn, terminals, worktreeId } = await setup();
    const result = await spawn(null, toPosixPath(worktree), undefined, undefined, undefined, undefined, 'ws', 'local', worktreeId);

    expect(mockPtySpawn).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ cwd: worktree }));
    expect(result.checkoutContextId).toBe(worktreeId);
    expect(terminals.get(result.id)).toMatchObject({ checkoutContextId: worktreeId });
  });

  test.each([
    ['the main checkout', () => main],
    ['a missing directory (which the safe-path resolver would silently replace)', () => path.join(worktree, 'missing')],
  ])('a launch naming a worktree context cannot land in %s', async (_label, dir) => {
    const { spawn, worktreeId } = await setup();
    await expect(spawn(null, toPosixPath(dir()), undefined, undefined, undefined, undefined, 'ws', 'local', worktreeId))
      .rejects.toThrow('Terminal directory is outside the registered workspace');
    expect(mockPtySpawn).not.toHaveBeenCalled();
  });

  test('rejects an unregistered context id', async () => {
    const { spawn } = await setup();
    await expect(spawn(null, toPosixPath(main), undefined, undefined, undefined, undefined, 'ws', 'local', 'ws::nope'))
      .rejects.toThrow('Checkout context is not registered for this workspace');
  });

  test('closing the workspace invalidates the context for new launches', async () => {
    const { registry, spawn, worktreeId } = await setup();
    registry.unregisterWorkspace('ws');

    await expect(spawn(null, toPosixPath(worktree), undefined, undefined, undefined, undefined, 'ws', 'local', worktreeId))
      .rejects.toThrow('Workspace is not registered or not accessible');
    // Path-only launches no longer resolve a workspace, so nothing binds to the closed one.
    const result = await spawn(null, toPosixPath(main));
    expect(result.checkoutContextId).toBeUndefined();
  });
});
