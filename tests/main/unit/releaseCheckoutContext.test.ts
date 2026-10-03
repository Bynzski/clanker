/**
 * Releasing a worktree checkout context: the contract main enforces, exercised through the real
 * RELEASE_CHECKOUT_CONTEXT handler and the real WorkspaceRegistry. Terminals are entries in the
 * same table main keeps, so "in use" is judged exactly as production judges it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { testHome } from '../../_helpers/tempPaths';

const { mockHandle } = vi.hoisted(() => ({ mockHandle: vi.fn() }));
vi.mock('node-pty', () => ({ spawn: vi.fn() }));
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => testHome()), on: vi.fn(), quit: vi.fn() },
  BrowserWindow: vi.fn(),
  ipcMain: { handle: mockHandle, on: vi.fn() },
  clipboard: { writeText: vi.fn() },
}));

import { registerTerminalIpc } from '../../../src/main/ipc/terminalIpc';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import { RemoteWorktreeCoordinator } from '../../../src/main/remote/remoteWorktreeCoordinator';
import type { WorkspaceEnvironment } from '../../../src/main/environment/workspaceEnvironment';
import { RELEASE_CHECKOUT_CONTEXT } from '../../../src/shared/ipcChannels';
import { mainCheckoutContextId } from '../../../src/shared/checkoutContext';
import type { ReleaseCheckoutContextResult } from '../../../src/shared/types/checkoutContext';
import { toPosixPath } from '../../../src/shared/pathNormalize';

type FakeTerminal = { id: string; checkoutContextId?: string; environmentId?: string; cwd?: string; remoteWorkingDir?: string };

describe('RELEASE_CHECKOUT_CONTEXT (local)', () => {
  let root: string;
  let main: string;
  let wtA: string;
  let wtB: string;
  let registry: WorkspaceRegistry;
  let terminals: Map<string, FakeTerminal>;
  let ids: { a: string; b: string };

  const localEnvironment = {
    id: 'local', kind: 'local',
    validateWorkspacePath: async (dir: string) => ({ valid: true, resolvedPath: dir }),
  } as unknown as WorkspaceEnvironment;

  const release = (workspaceId: unknown, contextId: unknown) =>
    Promise.resolve(mockHandle.mock.calls.find((call) => call[0] === RELEASE_CHECKOUT_CONTEXT)![1](null, workspaceId, contextId)) as Promise<ReleaseCheckoutContextResult>;
  const addTerminal = (id: string, fields: Partial<FakeTerminal>) => terminals.set(id, { id, environmentId: 'local', ...fields });

  beforeEach(async () => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-release-')));
    main = path.join(root, 'project');
    wtA = path.join(root, 'project-worktrees', 'a');
    wtB = path.join(root, 'project-worktrees', 'b');
    for (const dir of [main, wtA, wtB]) fs.mkdirSync(dir, { recursive: true });

    registry = new WorkspaceRegistry(() => localEnvironment);
    await registry.registerWorkspace({ workspaceId: 'ws', workspacePath: toPosixPath(main) });
    await registry.registerWorkspace({ workspaceId: 'other', workspacePath: toPosixPath(path.join(root, 'elsewhere')) });
    ids = {
      a: (await registry.registerCheckoutContext({ workspaceId: 'ws', path: toPosixPath(wtA), kind: 'worktree' })).checkoutContext!.id,
      b: (await registry.registerCheckoutContext({ workspaceId: 'ws', path: toPosixPath(wtB), kind: 'worktree' })).checkoutContext!.id,
    };
    terminals = new Map();
    mockHandle.mockClear();
    registerTerminalIpc({
      getTerminals: () => terminals as never,
      getMainWindow: () => null,
      getStore: () => ({ get: () => ({}) }) as never,
      getSafeWorkspacePath: (dir) => dir,
      getHarnessOptions: () => ({}),
      getWorkspaceRegistry: () => registry,
    });
  });

  it('releases a worktree context nothing is using', async () => {
    expect(await release('ws', ids.a)).toEqual({ success: true });
    expect(registry.getCheckoutContext(ids.a)).toBeNull();
    expect(registry.resolveCheckoutContext('ws', ids.a)).toBeNull();
  });

  it('keeps the workspace open, its main context intact, and its other contexts registered', async () => {
    await release('ws', ids.a);

    expect(registry.getWorkspace('ws')).not.toBeNull();
    expect(registry.resolveCheckoutContext('ws')).toMatchObject({ id: mainCheckoutContextId('ws'), path: toPosixPath(main) });
    expect(registry.getCheckoutContext(ids.b)).not.toBeNull();
    expect(registry.getCheckoutContextsForWorkspace('ws').map((entry) => entry.id)).toEqual([mainCheckoutContextId('ws'), ids.b]);
    expect(registry.getLocalOpenWorkspacePaths()).not.toContain(toPosixPath(wtA));
    expect(registry.getAllWorkspaces()).toHaveLength(2);
    // Releasing touches nothing on disk.
    expect(fs.existsSync(wtA)).toBe(true);
  });

  it('never releases the main context, and leaves it registered', async () => {
    const result = await release('ws', mainCheckoutContextId('ws'));
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('worktree') });
    expect(registry.resolveCheckoutContext('ws')).not.toBeNull();
  });

  it('does not let another workspace release this workspace\'s context, indistinguishably from an unknown one', async () => {
    const foreign = await release('other', ids.a);
    const unknown = await release('ws', 'ws::nope');

    expect(foreign).toEqual({ success: false, error: 'Checkout context is not registered for this workspace' });
    expect(unknown).toEqual(foreign);
    expect(registry.getCheckoutContext(ids.a)).not.toBeNull();
  });

  it.each([
    ['an unregistered workspace', ['nope', 'x']],
    ['blank ids', ['', ' ']],
    ['non-string ids', [42, { id: 'x' }]],
    ['missing arguments', [undefined, undefined]],
  ])('rejects %s without changing anything', async (_label, [workspaceId, contextId]) => {
    expect(await release(workspaceId, contextId)).toMatchObject({ success: false });
    expect(registry.getCheckoutContextsForWorkspace('ws')).toHaveLength(3);
  });

  describe('active terminals', () => {
    it('one terminal launched into the context blocks release', async () => {
      addTerminal('t1', { checkoutContextId: ids.a, cwd: wtA });
      const result = await release('ws', ids.a);

      expect(result).toMatchObject({ success: false, activeTerminals: 1, error: expect.stringContaining('1 running terminal is still using') });
      expect(registry.getCheckoutContext(ids.a)).not.toBeNull();
    });

    it('several terminals sharing the context block release, and all must go', async () => {
      addTerminal('t1', { checkoutContextId: ids.a, cwd: wtA });
      addTerminal('t2', { checkoutContextId: ids.a, cwd: path.join(wtA, 'src') });
      addTerminal('t3', { checkoutContextId: ids.a, cwd: wtA });

      expect(await release('ws', ids.a)).toMatchObject({ success: false, activeTerminals: 3 });
      terminals.delete('t1'); terminals.delete('t2');
      expect(await release('ws', ids.a)).toMatchObject({ success: false, activeTerminals: 1 });
      terminals.delete('t3');
      expect(await release('ws', ids.a)).toEqual({ success: true });
    });

    it('terminals on other contexts do not block it', async () => {
      fs.mkdirSync(path.join(main, 'src'), { recursive: true });
      addTerminal('on-main', { checkoutContextId: mainCheckoutContextId('ws'), cwd: main });
      addTerminal('on-main-subdir', { checkoutContextId: mainCheckoutContextId('ws'), cwd: path.join(main, 'src') });
      addTerminal('on-b', { checkoutContextId: ids.b, cwd: wtB });
      addTerminal('foreign', { checkoutContextId: 'other::main', cwd: path.join(root, 'elsewhere') });

      expect(await release('ws', ids.a)).toEqual({ success: true });
      // ...and the busy neighbour is still protected.
      expect(await release('ws', ids.b)).toMatchObject({ success: false, activeTerminals: 1 });
    });

    it('a terminal that was not launched into the context but sits inside its root still blocks', async () => {
      addTerminal('cd-ed', { checkoutContextId: mainCheckoutContextId('ws'), cwd: path.join(wtA, 'nested') });
      fs.mkdirSync(path.join(wtA, 'nested'));
      expect(await release('ws', ids.a)).toMatchObject({ success: false, activeTerminals: 1 });

      terminals.clear();
      addTerminal('unbound', { cwd: wtA });
      expect(await release('ws', ids.a)).toMatchObject({ success: false, activeTerminals: 1 });
    });

    it('a local terminal whose directory is unknown blocks (fail closed)', async () => {
      addTerminal('mystery', {});
      expect(await release('ws', ids.a)).toMatchObject({ success: false });
    });

    it('an SSH terminal at the same path string does not block a local context', async () => {
      addTerminal('ssh', { environmentId: 'vps', remoteWorkingDir: toPosixPath(wtA) });
      expect(await release('ws', ids.a)).toEqual({ success: true });
    });

    it('a terminal that has exited (gone from the table) no longer blocks', async () => {
      addTerminal('t1', { checkoutContextId: ids.a, cwd: wtA });
      expect(await release('ws', ids.a)).toMatchObject({ success: false });
      terminals.delete('t1');
      expect(await release('ws', ids.a)).toEqual({ success: true });
    });
  });

  it('is not repeatable: a second release of the same context fails', async () => {
    expect(await release('ws', ids.a)).toEqual({ success: true });
    expect(await release('ws', ids.a)).toMatchObject({ success: false });
  });
});

describe('RELEASE_CHECKOUT_CONTEXT (SSH) and the remote removal lifecycle', () => {
  const REPO = '/srv/repo';
  const TASK = '/srv/repo-worktrees/task';
  let registry: WorkspaceRegistry;
  let terminals: Map<string, FakeTerminal>;
  type FakeSshEnvironment = Record<'validateWorkspacePath' | 'inspectWorktree' | 'removeWorktree' | 'waitForWorktreeOperations', ReturnType<typeof vi.fn>>
    & { id: string; kind: string; worktreeResourceId: string };
  let environment: FakeSshEnvironment;
  let coordinator: RemoteWorktreeCoordinator;
  let contextId: string;

  const release = (workspaceId: unknown, id: unknown) =>
    Promise.resolve(mockHandle.mock.calls.find((call) => call[0] === RELEASE_CHECKOUT_CONTEXT)![1](null, workspaceId, id)) as Promise<ReleaseCheckoutContextResult>;
  const addTerminal = (id: string, fields: Partial<FakeTerminal>) => terminals.set(id, { id, environmentId: 'ssh', ...fields });

  beforeEach(async () => {
    const worktree = { path: TASK, branch: 'task', isMain: false, isLocked: false, isPrunable: false };
    environment = {
      id: 'ssh', kind: 'ssh', worktreeResourceId: 'ssh:host',
      validateWorkspacePath: vi.fn(async (dir: string) => ({ valid: true, resolvedPath: dir })),
      inspectWorktree: vi.fn().mockResolvedValue({ success: true, worktree, hasChanges: false }),
      removeWorktree: vi.fn().mockResolvedValue({ success: true, recoveryPath: '/recovery/task' }),
      waitForWorktreeOperations: vi.fn().mockResolvedValue(undefined),
    };
    registry = new WorkspaceRegistry(() => environment as unknown as WorkspaceEnvironment);
    await registry.registerWorkspace({ workspaceId: 'ws', workspacePath: REPO, environmentId: 'ssh' });
    contextId = (await registry.registerCheckoutContext({ workspaceId: 'ws', path: TASK, kind: 'worktree' })).checkoutContext!.id;
    terminals = new Map();
    // The same shape main.ts feeds the coordinator: remote directories of live terminals.
    coordinator = new RemoteWorktreeCoordinator(() => registry, () => [...terminals.values()]
      .filter((entry) => entry.environmentId && entry.environmentId !== 'local').map((entry) => entry.remoteWorkingDir!));
    mockHandle.mockClear();
    registerTerminalIpc({
      getTerminals: () => terminals as never, getMainWindow: () => null,
      getStore: () => ({ get: () => ({}) }) as never, getSafeWorkspacePath: (dir) => dir,
      getHarnessOptions: () => ({}), getWorkspaceRegistry: () => registry,
    });
  });

  it('an active SSH terminal in the context blocks release, whether launched into it or merely inside its root', async () => {
    addTerminal('bound', { checkoutContextId: contextId, remoteWorkingDir: TASK });
    expect(await release('ws', contextId)).toMatchObject({ success: false, activeTerminals: 1 });

    terminals.clear();
    addTerminal('inside', { remoteWorkingDir: `${TASK}/src` });
    expect(await release('ws', contextId)).toMatchObject({ success: false, activeTerminals: 1 });
    expect(registry.getCheckoutContext(contextId)).not.toBeNull();
  });

  it('an SSH terminal whose remote directory is unknown on the same host blocks (fail closed)', async () => {
    addTerminal('unknown', {});
    expect(await release('ws', contextId)).toMatchObject({ success: false, activeTerminals: 1 });
  });

  it('a terminal on an equivalent saved target for the same host counts; one on another host or the main root does not', async () => {
    // A second saved environment id resolving to the same host shares the resource id.
    await registry.registerWorkspace({ workspaceId: 'alias', workspacePath: '/srv/other', environmentId: 'ssh-alias' });
    addTerminal('alias-term', { environmentId: 'ssh-alias', remoteWorkingDir: TASK });
    expect(await release('ws', contextId)).toMatchObject({ success: false, activeTerminals: 1 });

    terminals.clear();
    addTerminal('main-root', { checkoutContextId: mainCheckoutContextId('ws'), remoteWorkingDir: REPO });
    addTerminal('sibling-dir', { remoteWorkingDir: '/srv/repo-worktrees/task-two' });
    addTerminal('other-host', { environmentId: 'other-host', remoteWorkingDir: TASK });
    expect(await release('ws', contextId)).toEqual({ success: true });
  });

  it('a foreign workspace and the main context cannot release; the workspace keeps its remote root', async () => {
    expect(await release('ws', mainCheckoutContextId('ws'))).toMatchObject({ success: false });
    await registry.registerWorkspace({ workspaceId: 'other', workspacePath: '/srv/other', environmentId: 'ssh' });
    expect(await release('other', contextId)).toMatchObject({ success: false });
    expect(registry.getWorkspace('ws')?.location.path).toBe(REPO);
  });

  it('active-context protection ends exactly at release: blocked before, inspectable and removable after', async () => {
    const workspace = registry.getWorkspace('ws')!;
    const blocked = { success: false, error: expect.stringContaining('Close workspace tabs') };
    expect(await coordinator.inspect(workspace, TASK)).toMatchObject(blocked);
    expect(await coordinator.remove(workspace, TASK, 'task')).toMatchObject(blocked);
    expect(environment.inspectWorktree).not.toHaveBeenCalled();

    expect(await release('ws', contextId)).toEqual({ success: true });

    expect(await coordinator.inspect(workspace, TASK)).toMatchObject({ success: true, hasChanges: false });
    expect(await coordinator.remove(workspace, TASK, 'task')).toMatchObject({ success: true, recoveryPath: '/recovery/task' });
    expect(environment.removeWorktree).toHaveBeenCalledTimes(1);
  });

  it('keeps the existing guards after release: a dirty checkout or changed branch is not removed', async () => {
    await release('ws', contextId);
    const workspace = registry.getWorkspace('ws')!;

    environment.inspectWorktree.mockResolvedValue({ success: true, hasChanges: true, worktree: { path: TASK, branch: 'task', isMain: false, isLocked: false, isPrunable: false } });
    expect(await coordinator.remove(workspace, TASK, 'task')).toMatchObject({ success: false, error: expect.stringContaining('uncommitted') });

    environment.inspectWorktree.mockResolvedValue({ success: true, hasChanges: false, worktree: { path: TASK, branch: 'switched', isMain: false, isLocked: false, isPrunable: false } });
    expect(await coordinator.remove(workspace, TASK, 'task')).toMatchObject({ success: false, error: expect.stringContaining('branch changed') });
    expect(environment.removeWorktree).not.toHaveBeenCalled();
  });

  it('an interrupted removal after release stays fail-closed: the path stays reserved and is not re-registered', async () => {
    await release('ws', contextId);
    const workspace = registry.getWorkspace('ws')!;
    environment.removeWorktree.mockResolvedValue({ success: false, uncertain: true, error: 'connection lost' });

    expect(await coordinator.remove(workspace, TASK, 'task')).toMatchObject({ success: false });

    expect(registry.isRemotePathReserved('ssh', TASK)).toBe(true);
    expect(registry.getCheckoutContextsForWorkspace('ws').map((entry) => entry.id)).toEqual([mainCheckoutContextId('ws')]);
    // The reservation also refuses attaching the checkout again until the host verifies completion.
    expect(await registry.registerCheckoutContext({ workspaceId: 'ws', path: TASK, kind: 'worktree' })).toMatchObject({ success: false });
  });
});
