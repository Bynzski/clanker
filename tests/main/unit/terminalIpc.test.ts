/**
 * Terminal IPC Registration Tests
 *
 * Tests for the terminal IPC module, verifying channel registration and
 * handler error-path behavior.
 *
 * Coverage areas:
 * - Registration of all terminal IPC channels
 * - GET_TERMINAL_BUFFER returns empty string for missing terminal
 * - WRITE_TERMINAL returns a defined result for missing terminal (no-op)
 * - RESIZE_TERMINAL returns a defined result for missing terminal (no-op)
 * - KILL_TERMINAL returns a defined result for missing terminal (no-op)
 * - TERMINAL_CLEANUP_WORKSPACE returns killed count for missing/invalid IDs
 * - WRITE_CLIPBOARD calls clipboard.writeText and returns a defined result
 * - SPAWN_TERMINAL validates workspace path and tolerates null main window
 */

// Dormant command-startup coverage; production disables recipe execution.
const { recipeAvailability } = vi.hoisted(() => ({ recipeAvailability: { enabled: true } }));
vi.mock('../../../src/shared/recipeAvailability', () => ({
  get WORKSPACE_RECIPES_ENABLED() { return recipeAvailability.enabled; },
  RECIPES_DISABLED_MESSAGE: 'Workspace recipes are temporarily unavailable.',
}));

import { describe, test, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { testHome, testHarnessWrapper } from '../../_helpers/tempPaths';

// ---------------------------------------------------------------------------
// Mock factories — must use vi.hoisted() so references are available when
// vi.mock factory functions run (Vitest hoists vi.mock calls to the top of the
// file before any runtime code executes).
// ---------------------------------------------------------------------------

const { mockHandle, mockOn } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockOn: vi.fn(),
}));

const { mockPtySpawn } = vi.hoisted(() => ({
  mockPtySpawn: vi.fn(),
}));

// Declare mockClipboardWriteText inside vi.hoisted so it is available when
// vi.mock factories run (Vitest hoists vi.hoisted() calls alongside vi.mock).
const { mockClipboardWriteText } = vi.hoisted(() => ({
  mockClipboardWriteText: vi.fn(),
}));

vi.mock('node-pty', () => ({
  spawn: mockPtySpawn,
}));

vi.mock('electron', () => ({
  app: {
    disableHardwareAcceleration: vi.fn(),
    getPath: vi.fn((name: string) => {
      if (name === 'home') return testHome();
      return `/mock/${name}`;
    }),
    commandLine: { appendSwitch: vi.fn() },
    whenReady: vi.fn(() => new Promise<never>(() => { /* prevent init */ })),
    on: vi.fn(),
    quit: vi.fn(),
  },
  BrowserWindow: vi.fn(() => ({
    setMenuBarVisibility: vi.fn(),
    setAutoHideMenuBar: vi.fn(),
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn(),
    minimize: vi.fn(),
    unmaximize: vi.fn(),
    maximize: vi.fn(),
    isMaximized: vi.fn(() => false),
    close: vi.fn(),
    webContents: { send: vi.fn() },
    contentView: { addChildView: vi.fn() },
  })),
  Menu: Object.assign(vi.fn(), { setApplicationMenu: vi.fn() }),
  WebContentsView: vi.fn(() => ({
    setVisible: vi.fn(),
    setBounds: vi.fn(),
    webContents: {
      loadURL: vi.fn(),
      close: vi.fn(),
      reload: vi.fn(),
      stop: vi.fn(),
      on: vi.fn(),
      navigationHistory: {
        canGoBack: vi.fn(() => false),
        canGoForward: vi.fn(() => false),
        goBack: vi.fn(),
        goForward: vi.fn(),
      },
    },
  })),
  ipcMain: { handle: mockHandle, on: mockOn },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openExternal: vi.fn() },
  clipboard: { writeText: mockClipboardWriteText },
}));

import { ipcMain } from 'electron';
import { AgentAttentionBroker } from '../../../src/main/agentAttentionBroker';
import { createAgentLocationResolver } from '../../../src/main/agentLocation';
import { REMOTE_ATTENTION_PREFIX } from '../../../src/main/remote/remoteAttentionTransport';
import { registerTerminalIpc } from '../../../src/main/ipc/terminalIpc';
import { withCheckoutContexts } from '../../_helpers/checkoutContexts';
import { RECIPE_COMMAND_WAIT, SPAWN_TERMINAL, TERMINAL_READY, RESIZE_TERMINAL, TERMINAL_DATA } from '../../../src/shared/ipcChannels';
import { parseMsvcrtArgv, ptyCommandLine } from '../../_helpers/windowsCommandLine';

type MockIpcMain = typeof ipcMain & {
  handle: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Registration tests
// ---------------------------------------------------------------------------

describe('registerTerminalIpc — registration', () => {
  beforeEach(() => {
    mockHandle.mockClear();
    mockOn.mockClear();
  });

  test('registers all expected terminal IPC channels', () => {
    const mockTerminals = new Map();
    const mockMainWindow = { webContents: { send: vi.fn() } };
    const mockStore = { get: vi.fn().mockReturnValue(false) };
    const mockGetSafeWorkspacePath = vi.fn().mockReturnValue('/test/workspace');
    const mockGetHarnessOptions = vi.fn().mockReturnValue({});

    registerTerminalIpc({
      getTerminals: () => mockTerminals,
      getMainWindow: () => mockMainWindow as never,
      getStore: () => mockStore as never,
      getSafeWorkspacePath: mockGetSafeWorkspacePath,
      getHarnessOptions: mockGetHarnessOptions,
      ensureHarnessWrapperScript: vi.fn().mockReturnValue(testHarnessWrapper()),
    });

    const expectedChannels = [
      'spawn-terminal',
      'get-terminal-buffer',
      'write-terminal',
      'resize-terminal',
      'kill-terminal',
      'terminal:cleanup-workspace',
      'release-checkout-context',
    ];

    expectedChannels.forEach(channel => {
      expect(mockHandle).toHaveBeenCalledWith(channel, expect.any(Function));
    });
  });

  test('registers terminal IPC handle channels including annotation handoff', () => {
    const mockTerminals = new Map();
    const mockMainWindow = { webContents: { send: vi.fn() } };
    const mockStore = { get: vi.fn().mockReturnValue(false) };
    registerTerminalIpc({
      getTerminals: () => mockTerminals,
      getMainWindow: () => mockMainWindow as never,
      getStore: () => mockStore as never,
      getSafeWorkspacePath: vi.fn().mockReturnValue('/test/workspace'),
      getHarnessOptions: vi.fn().mockReturnValue({}),
      ensureHarnessWrapperScript: vi.fn().mockReturnValue(testHarnessWrapper()),
    });

    expect(mockHandle.mock.calls.length).toBe(13);
  });

  test('registers 3 event IPC channels (terminal-data, terminal-exit, terminal-resized)', () => {
    const mockTerminals = new Map();
    const mockMainWindow = { webContents: { send: vi.fn() } };
    const mockStore = { get: vi.fn().mockReturnValue(false) };
    registerTerminalIpc({
      getTerminals: () => mockTerminals,
      getMainWindow: () => mockMainWindow as never,
      getStore: () => mockStore as never,
      getSafeWorkspacePath: vi.fn().mockReturnValue('/test/workspace'),
      getHarnessOptions: vi.fn().mockReturnValue({}),
      ensureHarnessWrapperScript: vi.fn().mockReturnValue(testHarnessWrapper()),
    });

    expect(mockOn.mock.calls.length).toBe(3);
    expect(mockOn.mock.calls.map((c: unknown[]) => c[0])).toContain('terminal-data');
    expect(mockOn.mock.calls.map((c: unknown[]) => c[0])).toContain('terminal-exit');
    expect(mockOn.mock.calls.map((c: unknown[]) => c[0])).toContain('terminal-resized');
  });

  test('can be called multiple times (registering handlers again)', () => {
    const mockTerminals = new Map();
    const mockMainWindow = { webContents: { send: vi.fn() } };
    const mockStore = { get: vi.fn().mockReturnValue(false) };
    const opts = {
      getTerminals: () => mockTerminals,
      getMainWindow: () => mockMainWindow as never,
      getStore: () => mockStore as never,
      getSafeWorkspacePath: vi.fn().mockReturnValue('/test/workspace'),
      getHarnessOptions: vi.fn().mockReturnValue({}),
      ensureHarnessWrapperScript: vi.fn().mockReturnValue(testHarnessWrapper()),
    };
    registerTerminalIpc(opts);
    registerTerminalIpc(opts);
    expect(mockHandle.mock.calls.length).toBe(26);
  });
});

describe('terminal IPC channel constants', () => {
  test('terminal channel names are consistent', () => {
    const expectedChannels = [
      'spawn-terminal',
      'get-terminal-buffer',
      'write-terminal',
      'resize-terminal',
      'kill-terminal',
      'terminal:cleanup-workspace',
    ];
    expectedChannels.forEach(channel => {
      expect(typeof channel).toBe('string');
      expect(channel.length).toBeGreaterThan(0);
    });
    const uniqueChannels = new Set(expectedChannels);
    expect(uniqueChannels.size).toBe(expectedChannels.length);
  });
});

// ---------------------------------------------------------------------------
// Error-path tests
// ---------------------------------------------------------------------------

/**
 * Terminal IPC — Error-Path Tests
 *
 * Verifies every non-spawn terminal handler returns a defined value (not
 * undefined or a thrown error) for missing-terminal and malformed-payload cases.
 */

describe('terminalIpc — error-path: handler returns', () => {
  const mockIpcMain = ipcMain as MockIpcMain;

  const createMockDeps = () => {
    const terminals = new Map();
    const mainWindow = { webContents: { send: vi.fn() } };
    const store = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'harnessDefaults') {
          return {
            codex:    { model: '', favorites: [], flags: '' },
            opencode: { model: '', favorites: [], flags: '' },
            pi:       { model: '', favorites: [], flags: '' },
            claude:   { model: '', favorites: [], flags: '' },
          };
        }
        return false;
      }),
    };
    const opts = {
      getTerminals: () => terminals,
      getMainWindow: () => mainWindow as never,
      getStore: () => store as never,
      getSafeWorkspacePath: vi.fn().mockReturnValue('/test/workspace'),
      getHarnessOptions: vi.fn().mockReturnValue({}),
      ensureHarnessWrapperScript: vi.fn().mockReturnValue(testHarnessWrapper()),
    };
    return { terminals, opts, mainWindow };
  };

  beforeEach(() => {
    mockHandle.mockClear();
    mockOn.mockClear();
    mockClipboardWriteText.mockClear();
    mockPtySpawn.mockClear();
  });
  test('routes remote attention from PTY data and releases credentials and files on exit or spawn failure', async () => {
    const { opts } = createMockDeps();
    const updates = vi.fn();
    const broker = new AgentAttentionBroker(updates);
    const releaseAttention = vi.fn().mockResolvedValue(undefined);
    let token = '';
    const resolveTerminalSpawn = vi.fn(async (request: { attentionToken: string }) => {
      token = request.attentionToken;
      return { spawnCmd: 'ssh', spawnArgs: ['-t', 'host', 'true'], env: {},
        harnessId: 'opencode', attentionEnabled: true, releaseAttention };
    });
    const registered = { workspaceId: 'remote', location: { path: '/srv/project', environmentId: 'host' },
      environment: { capabilities: { agentAttention: true }, resolveTerminalSpawn } };
    opts.getStore = vi.fn().mockReturnValue({ get: () => ({ opencode: { attentionEnabled: true } }) }) as never;
    let onData!: (data: string) => void;
    let onExit!: (result: { exitCode: number }) => void;
    mockPtySpawn.mockReturnValue({ pid: 1234, write: vi.fn(),
      onData: (callback: typeof onData) => { onData = callback; },
      onExit: (callback: typeof onExit) => { onExit = callback; } });
    registerTerminalIpc({ ...opts, agentAttentionBroker: broker,
      getWorkspaceRegistry: () => withCheckoutContexts({ getWorkspace: () => registered }) } as never);
    const handler = mockIpcMain.handle.mock.calls.find((call) => call[0] === SPAWN_TERMINAL)?.[1];
    try {
      const result = await handler(null, '/srv/project', 'opencode', undefined, undefined, undefined, 'remote', 'host');
      expect(result.attentionEnabled).toBe(true);
      const raw = JSON.stringify({ version: 1, token, harness: 'opencode', event: 'turn_started', scope: 'root', sessionId: 'session-a', turnId: '1' });
      onData('ordinary output' + REMOTE_ATTENTION_PREFIX + Buffer.from(raw).toString('base64') + '\x07');
      expect(updates).toHaveBeenCalledWith(expect.objectContaining({ terminalId: result.id, snapshot: expect.objectContaining({ runtime: expect.objectContaining({ status: 'running' }) }) }));
      expect(opts.getTerminals().get(result.id)?.startupBuffer).toEqual(['ordinary output']);
      onExit({ exitCode: 0 });
      expect(releaseAttention).toHaveBeenCalledTimes(1);
      expect(broker.handoffState(result.id)).toBe('unavailable');
      broker.receiveRemote(result.id, raw);
      // The start, then the PTY exit's retirement tombstone; the retired credential adds nothing.
      expect(updates).toHaveBeenCalledTimes(2);
      expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({ terminalId: result.id, snapshot: null }));
      mockPtySpawn.mockImplementationOnce(() => { throw new Error('spawn failed'); });
      await expect(handler(null, '/srv/project', 'opencode', undefined, undefined, undefined, 'remote', 'host')).rejects.toThrow('spawn failed');
      expect(releaseAttention).toHaveBeenCalledTimes(2);
    } finally { broker.close(); }
  });

  test('uses the registered SSH workspace and stored harness flags for a remote terminal', async () => {
    const { opts } = createMockDeps();
    const resolveTerminalSpawn = vi.fn().mockResolvedValue({
      spawnCmd: 'ssh', spawnArgs: ['-t', 'dev-vps', 'sh -c true'],
      cwd: process.cwd(), env: {}, harnessId: 'codex', attentionEnabled: false,
    });
    const validateWorkspacePath = vi.fn(async (dir: string) => ({
      valid: true, resolvedPath: dir === '/srv/project/link' ? '/etc' : dir,
    }));
    const registered = {
      workspaceId: 'remote-tab',
      location: { path: '/srv/project', environmentId: 'dev-vps' },
      environment: { resolveTerminalSpawn, validateWorkspacePath, capabilities: { sessionDiscovery: true } },
    };
    opts.getStore = vi.fn().mockReturnValue({
      get: (key: string) => key === 'harnessDefaults'
        ? { codex: { flags: '--sandbox workspace-write', model: 'ignored-local-model' } }
        : false,
    }) as never;
    const deps = { ...opts, getWorkspaceRegistry: () => withCheckoutContexts({
      getWorkspace: (id: string) => id === 'remote-tab' ? registered : null,
    }) };
    mockPtySpawn.mockReturnValue({
      pid: 1234, write: vi.fn(), onData: vi.fn(), onExit: vi.fn(),
    });
    registerTerminalIpc(deps as never);
    const handler = mockIpcMain.handle.mock.calls.find((call) => call[0] === SPAWN_TERMINAL)?.[1];
    await handler(null, '/srv/project/src', 'codex', undefined, undefined, undefined, 'remote-tab', 'dev-vps');
    expect(resolveTerminalSpawn).toHaveBeenCalledWith(expect.objectContaining({
      workingDir: '/srv/project/src', flags: '--sandbox workspace-write', harness: 'codex',
      model: undefined,
    }));
    expect(mockPtySpawn).toHaveBeenCalledWith('ssh', ['-t', 'dev-vps', 'sh -c true'], expect.any(Object));
    expect(validateWorkspacePath).toHaveBeenCalledWith('/srv/project/src');
    expect([...opts.getTerminals().values()]).toEqual([expect.objectContaining({
      environmentId: 'dev-vps', workspaceId: 'remote-tab', remoteWorkingDir: '/srv/project/src', cwd: process.cwd(),
    })]);
    await expect(handler(null, '/srv/project/link', 'codex', undefined, undefined, undefined,
      'remote-tab', 'dev-vps')).rejects.toThrow('Terminal directory is outside the registered workspace');
    await expect(handler(null, '/srv/other', 'codex', undefined, undefined, undefined,
      'remote-tab', 'dev-vps')).rejects.toThrow('Terminal directory is outside the registered workspace');
    expect(resolveTerminalSpawn).toHaveBeenCalledTimes(1);
  });


  test('does not spawn a pending remote terminal after its directory becomes reserved', async () => {
    const { opts } = createMockDeps();
    let finish!: (result: unknown) => void;
    const reserved = vi.fn().mockReturnValue(false);
    const registered = { workspaceId: 'remote', location: { path: '/srv/task', environmentId: 'ssh' },
      environment: { resolveTerminalSpawn: vi.fn(() => new Promise((done) => { finish = done; })) } };
    registerTerminalIpc({ ...opts, getWorkspaceRegistry: () => withCheckoutContexts({
      getWorkspace: () => registered, isRemotePathReserved: reserved,
    }) } as never);
    const handler = mockIpcMain.handle.mock.calls.find((call) => call[0] === SPAWN_TERMINAL)?.[1];
    const pending = handler(null, '/srv/task', undefined, undefined, undefined, undefined, 'remote', 'ssh');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    reserved.mockReturnValue(true);
    finish({ spawnCmd: 'ssh', spawnArgs: [], cwd: process.cwd(), env: {} });
    await expect(pending).rejects.toThrow('being removed');
    expect(mockPtySpawn).not.toHaveBeenCalled();
  });

  test('an ordinary Hermes harness launch never touches the Hermes Assistant service (no probing, sockets or service code)', async () => {
    const { opts } = createMockDeps();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not be called'));
    const socketSpy = vi.fn();
    vi.stubGlobal('WebSocket', socketSpy);
    try {
      registerTerminalIpc({
        ...opts,
        getHarnessOptions: () => ({ hermes: { name: 'Hermes', command: 'hermes', args: ['--tui'], icon: '' } }),
        getStore: () => ({ get: () => ({ hermes: { flags: '', model: '' } }) }) as never,
      });
      mockPtySpawn.mockReturnValue({ pid: 1234, write: vi.fn(), onData: vi.fn(), onExit: vi.fn(), kill: vi.fn() });
      const handler = mockIpcMain.handle.mock.calls.find((call) => call[0] === SPAWN_TERMINAL)?.[1];
      const result = await handler(null, process.cwd(), 'hermes');
      expect(result.harnessId).toBe('hermes');
      const [, args] = mockPtySpawn.mock.calls[mockPtySpawn.mock.calls.length - 1];
      expect(args).toEqual(['hermes', '--tui']);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(socketSpy).not.toHaveBeenCalled();
      expect(fs.readFileSync(path.join(process.cwd(), 'src/main/ipc/terminalIpc.ts'), 'utf8')).not.toMatch(/hermesAssistantService|assistants\/hermesBackend/);
    } finally { vi.unstubAllGlobals(); fetchSpy.mockRestore(); }
  });

  test('an ordinary launch with an explicit worktree context still runs in and is tagged with that context, through the Windows planner', async () => {
    const { opts, terminals } = createMockDeps();
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-ctx-win-')));
    try {
      const workspace = path.join(base, 'workspace');
      const worktree = path.join(base, 'worktree');
      fs.mkdirSync(workspace); fs.mkdirSync(worktree);
      const linked = { id: 'ws::wt', workspaceId: 'ws', environmentId: 'local', path: worktree.replace(/\\/g, '/'), kind: 'worktree' as const };
      const registered = { workspaceId: 'ws', location: { environmentId: 'local', path: workspace.replace(/\\/g, '/') } };
      registerTerminalIpc({
        ...opts,
        getSafeWorkspacePath: (dir: string) => dir,
        ensureHarnessWrapperScript: () => null,
        harnessSpawnOverrides: { platform: 'win32', env: { Path: 'C:\\Tools', PATHEXT: '.EXE;.CMD', ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, fileExists: (file: string) => file.toLowerCase() === 'c:\\tools\\codex.exe' },
        getWorkspaceRegistry: () => withCheckoutContexts({ getWorkspace: () => registered }, [linked]) as never,
        getHarnessOptions: () => ({ codex: { name: 'Codex', command: 'codex', args: [], icon: '' } }),
        getStore: () => ({ get: () => ({ codex: { flags: '', model: '' } }) }) as never,
      });
      mockPtySpawn.mockReturnValue({ pid: 1234, write: vi.fn(), onData: vi.fn(), onExit: vi.fn(), kill: vi.fn() });
      const handler = mockIpcMain.handle.mock.calls.find((call) => call[0] === SPAWN_TERMINAL)?.[1];
      const result = await handler(null, worktree, 'codex', undefined, undefined, undefined, 'ws', 'local', 'ws::wt');
      expect(result.checkoutContextId).toBe('ws::wt');
      expect(terminals.get(result.id)).toMatchObject({ checkoutContextId: 'ws::wt' });
      const [file, args, options] = mockPtySpawn.mock.calls[mockPtySpawn.mock.calls.length - 1];
      expect(file.toLowerCase()).toBe('c:\\tools\\codex.exe');
      expect(args).toEqual([]);
      expect(options.cwd).toBe(worktree);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });

  test('a local launch records its resolved workspace, so a location its agent reports resolves to that workspace\'s context', async () => {
    const { opts, terminals } = createMockDeps();
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-ctx-loc-')));
    try {
      const workspace = path.join(base, 'workspace');
      const worktree = path.join(base, 'workspace-worktrees', 'wt-1');
      fs.mkdirSync(workspace); fs.mkdirSync(worktree, { recursive: true });
      const posix = (value: string) => value.replace(/\\/g, '/');
      const main = { id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: posix(workspace), kind: 'main' as const };
      const linked = { id: 'ws::wt', workspaceId: 'ws', environmentId: 'local', path: posix(worktree), kind: 'worktree' as const };
      const registered = { workspaceId: 'ws', location: { environmentId: 'local', path: posix(workspace) } };
      registerTerminalIpc({
        ...opts,
        getSafeWorkspacePath: (dir: string) => dir,
        getWorkspaceRegistry: () => withCheckoutContexts({ getWorkspace: (id: string) => (id === 'ws' ? registered : null) }, [linked]) as never,
      });
      mockPtySpawn.mockReturnValue({ pid: 1234, write: vi.fn(), onData: vi.fn(), onExit: vi.fn(), kill: vi.fn() });
      const handler = mockIpcMain.handle.mock.calls.find((call) => call[0] === SPAWN_TERMINAL)?.[1];
      const result = await handler(null, posix(worktree), undefined, undefined, undefined, undefined, 'ws', 'local', 'ws::wt');

      expect(terminals.get(result.id)).toMatchObject({ workspaceId: 'ws', checkoutContextId: 'ws::wt' });
      const resolve = createAgentLocationResolver({
        getTerminal: (id) => terminals.get(id),
        getCheckoutContexts: (workspaceId) => (workspaceId === 'ws' ? [main, linked] : []),
      });
      expect(resolve(result.id, 'local', worktree)).toEqual({ path: posix(worktree), checkoutContextId: 'ws::wt' });
      expect(resolve(result.id, 'local', workspace)).toEqual({ path: posix(workspace), checkoutContextId: 'ws::main' });
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });

  describe('Windows PTY argument serialization through the real terminal spawn path', () => {
    const COMSPEC = 'C:\\Windows\\System32\\cmd.exe';
    const windowsFor = (installed: string[]) => ({
      platform: 'win32' as const,
      env: { Path: 'C:\\Tools;C:\\npm', PATHEXT: '.EXE;.CMD', ComSpec: COMSPEC },
      fileExists: (file: string) => installed.some((known) => known.toLowerCase() === file.toLowerCase()),
    });
    const NASTY = ['plain', 'My Projects', 'R&D', 'Tom & Jerry (v2)', '100% done (final)', 'a^b!c,d;e'];
    // A normal Hermes harness terminal whose argv carries the workspace path, so path metacharacters reach the planner.
    const setup = (installed: string[], dirName: string) => {
      const { opts, terminals } = createMockDeps();
      const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-win-term-')));
      const workspace = path.join(base, dirName);
      fs.mkdirSync(workspace);
      const registered = { workspaceId: 'win-owner', location: { environmentId: 'local', path: workspace.replace(/\\/g, '/') } };
      const broker = { register: vi.fn().mockResolvedValue({}), release: vi.fn() };
      registerTerminalIpc({
        ...opts,
        getSafeWorkspacePath: (dir: string) => dir,
        agentAttentionBroker: broker as never,
        ensureHarnessWrapperScript: () => null,
        harnessSpawnOverrides: windowsFor(installed),
        getWorkspaceRegistry: () => withCheckoutContexts({ getWorkspace: () => registered }) as never,
        getHarnessOptions: () => ({ hermes: { name: 'Hermes', command: 'hermes', args: ['-p', 'reviewer', '--tui', '--in', workspace], icon: '' } }),
        getStore: () => ({ get: () => ({ hermes: { flags: '', model: '' } }) }) as never,
      });
      mockPtySpawn.mockReturnValue({ pid: 1234, write: vi.fn(), onData: vi.fn(), onExit: vi.fn(), kill: vi.fn() });
      const handler = mockIpcMain.handle.mock.calls.find((call) => call[0] === SPAWN_TERMINAL)?.[1];
      const launch = () => handler(null, workspace, 'hermes', undefined, undefined, undefined, 'win-owner', 'local');
      return { launch, broker, terminals, workspace, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
    };

    test.each(NASTY)('launches a real executable directly with intact argv for a workspace named %j', async (dirName) => {
      const { launch, workspace, cleanup } = setup(['C:\\Tools\\hermes.exe'], dirName);
      try {
        await launch();
        const [file, args] = mockPtySpawn.mock.calls[mockPtySpawn.mock.calls.length - 1];
        expect(file.toLowerCase()).toBe('c:\\tools\\hermes.exe');
        expect(parseMsvcrtArgv(ptyCommandLine(file, args)).slice(1)).toEqual(['-p', 'reviewer', '--tui', '--in', workspace]);
      } finally { cleanup(); }
    });

    test.each(NASTY.filter((name) => !name.includes('%')))('routes an npm .cmd shim through cmd.exe as one verbatim, escaped line for a workspace named %j', async (dirName) => {
      const { launch, cleanup } = setup(['C:\\npm\\hermes.cmd'], dirName);
      try {
        await launch();
        const [file, args] = mockPtySpawn.mock.calls[mockPtySpawn.mock.calls.length - 1];
        expect(file).toBe(COMSPEC);
        expect(typeof args).toBe('string');
        expect((args as string).startsWith('/d /s /c ""C:\\npm\\hermes.CMD" ')).toBe(true);
        const live = (args as string).slice('/d /s /c '.length).slice(1, -1).replace(/^"[^"]*"/, '').replace(/\^./g, '');
        expect(live).not.toMatch(/[&|<>()!"%,;]/);
        expect(live.trim().split(' ')).toHaveLength(5);
      } finally { cleanup(); }
    });

    test('fails closed and releases attention state when a .cmd shim would have to carry %', async () => {
      const { launch, broker, terminals, cleanup } = setup(['C:\\npm\\hermes.cmd'], '100% done');
      try {
        await expect(launch()).rejects.toThrow(/cannot be passed safely/);
        expect(mockPtySpawn).not.toHaveBeenCalled();
        expect(terminals.size).toBe(0);
        expect(broker.release).toHaveBeenCalledOnce();
      } finally { cleanup(); }
    });

    test('fails closed when the command cannot be resolved instead of falling back to cmd /c', async () => {
      const { launch, broker, cleanup } = setup([], 'R&D');
      try {
        await expect(launch()).rejects.toThrow(/hermes is not installed/);
        expect(mockPtySpawn).not.toHaveBeenCalled();
        expect(broker.release).toHaveBeenCalledOnce();
      } finally { cleanup(); }
    });

    test('ordinary harness launches use the same planner and keep .cmd shim resolution', async () => {
      const { opts } = createMockDeps();
      registerTerminalIpc({
        ...opts,
        ensureHarnessWrapperScript: () => null,
        harnessSpawnOverrides: windowsFor(['C:\\npm\\codex.cmd']),
        getHarnessOptions: () => ({ codex: { name: 'Codex', command: 'codex', args: [], icon: '' } }),
        getStore: () => ({ get: () => ({ codex: { flags: '--sandbox workspace-write', model: 'gpt-5' } }) }) as never,
      });
      mockPtySpawn.mockReturnValue({ pid: 1234, write: vi.fn(), onData: vi.fn(), onExit: vi.fn(), kill: vi.fn() });
      const handler = mockIpcMain.handle.mock.calls.find((call) => call[0] === SPAWN_TERMINAL)?.[1];
      await handler(null, '/test/workspace', 'codex');
      const [file, args] = mockPtySpawn.mock.calls[mockPtySpawn.mock.calls.length - 1];
      expect(file).toBe(COMSPEC);
      expect(args).toMatch(/^\/d \/s \/c ""C:\\npm\\codex\.CMD"/);
      expect(args).toContain('gpt-5');
      expect(args).toContain('workspace-write');
    });
  });

  test('records no durable task-session state for local or SSH harness launches', async () => {
    const { opts } = createMockDeps();
    const storeSet = vi.fn();
    const resolveTerminalSpawn = vi.fn().mockResolvedValue({
      spawnCmd: 'ssh', spawnArgs: ['-t', 'dev-vps', 'sh -c true'],
      cwd: process.cwd(), env: {}, harnessId: 'codex', attentionEnabled: false,
    });
    const registered = {
      workspaceId: 'remote-tab',
      location: { path: '/srv/project', environmentId: 'dev-vps' },
      environment: {
        resolveTerminalSpawn,
        validateWorkspacePath: vi.fn(async (dir: string) => ({ valid: true, resolvedPath: dir })),
      },
    };
    registerTerminalIpc({
      ...opts,
      getStore: vi.fn().mockReturnValue({
        get: (key: string) => (key === 'harnessDefaults' ? { codex: { model: '', favorites: [], flags: '' } } : false),
        set: storeSet,
      }) as never,
      getHarnessOptions: vi.fn().mockReturnValue({ codex: { name: 'Codex', command: 'codex', args: [], icon: '' } }),
      getWorkspaceRegistry: () => withCheckoutContexts({
        getWorkspace: (id: string) => (id === 'remote-tab' ? registered : null),
        getWorkspaceByLocation: () => null,
      }),
    } as never);
    mockPtySpawn.mockReturnValue({ pid: 1234, write: vi.fn(), onData: vi.fn(), onExit: vi.fn() });
    const handler = mockIpcMain.handle.mock.calls.find((call) => call[0] === SPAWN_TERMINAL)?.[1];

    await handler(null, '/test/workspace', 'codex');
    await handler(null, '/srv/project', 'codex', undefined, undefined, undefined, 'remote-tab', 'dev-vps');

    expect(mockPtySpawn).toHaveBeenCalledTimes(2);
    expect(storeSet.mock.calls.map(([key]) => key)).not.toContain('taskSessions');
  });

  test('disabled recipe commands and wait calls fail before PTY creation', async () => {
    recipeAvailability.enabled = false;
    try {
      const { opts } = createMockDeps();
      registerTerminalIpc(opts);
      const handler = (channel: string) => mockIpcMain.handle.mock.calls.find((call) => call[0] === channel)?.[1];
      await expect(handler(SPAWN_TERMINAL)(null, process.cwd(), undefined, undefined, 'npm run dev', true)).rejects.toThrow('temporarily unavailable');
      await expect(handler(RECIPE_COMMAND_WAIT)(null, 'stale')).rejects.toThrow('temporarily unavailable');
      expect(mockPtySpawn).not.toHaveBeenCalled();
    } finally { recipeAvailability.enabled = true; }
  });

  test('a recipe command is written only at TERMINAL_READY and its PTY exit marker is reported', async () => {
    const { opts } = createMockDeps();
    let emitData: ((data: string) => void) | undefined;
    const write = vi.fn();
    mockPtySpawn.mockReturnValue({
      pid: 1234, write,
      onData: vi.fn((callback: (data: string) => void) => { emitData = callback; }),
      onExit: vi.fn(),
    });
    registerTerminalIpc(opts);
    const handler = (channel: string) => mockIpcMain.handle.mock.calls.find((call) => call[0] === channel)?.[1];
    const spawned = await handler(SPAWN_TERMINAL)(null, process.cwd(), undefined, undefined, 'missing-command', true);
    expect(write).not.toHaveBeenCalled();
    const pending = handler(RECIPE_COMMAND_WAIT)(null, spawned.id);
    handler(TERMINAL_READY)(null, spawned.id);
    expect(write).toHaveBeenCalledOnce();
    const marker = String(write.mock.calls[0][0]).match(/CLANKER_RECIPE_[a-f0-9]+_/g)?.[0];
    expect(marker).toBeDefined();
    emitData?.(`${marker}127\r\n`);
    expect(await pending).toMatchObject({ status: 'failed', error: 'Command exited immediately with code 127' });
  });

  test('GET_TERMINAL_BUFFER returns empty string for missing terminal ID', async () => {
    const { opts } = createMockDeps();
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'get-terminal-buffer'
    )?.[1] as (_: unknown, id: string) => string;

    const result = await handler(null, 'nonexistent-term-123');
    expect(result).toBe('');
    expect(typeof result).toBe('string');
  });

  test('sends an edited annotation only to a ready terminal in its workspace', () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-handoff-'));
    try {
      const { terminals, opts } = createMockDeps();
      const write = vi.fn();
      const broker = { canHandoff: vi.fn().mockReturnValue(true), markSubmitted: vi.fn(), handoffState: vi.fn().mockReturnValue('unverified') };
      terminals.set('term-agent', { id: 'term-agent', cwd: workspacePath, harnessId: 'codex', pty: { write } });
      registerTerminalIpc({ ...opts, getOpenWorkspacePath: () => workspacePath, agentAttentionBroker: broker as never });
      const handler = mockIpcMain.handle.mock.calls.find((call) => call[0] === 'send-annotation-to-agent')?.[1] as (
        _: unknown, payload: unknown,
      ) => { success: boolean; error?: string };

      expect(handler(null, { workspaceId: 'workspace-1', terminalId: 'term-agent', message: 'URL: https://example.com\nNote: Fix this' }))
        .toEqual({ success: true });
      expect(write).toHaveBeenCalledWith('\x1b[200~URL: https://example.com\nNote: Fix this\x1b[201~\r');
      expect(broker.markSubmitted).toHaveBeenCalledWith('term-agent');
      const statuses = mockIpcMain.handle.mock.calls.find((call) => call[0] === 'get-agent-handoff-statuses')?.[1] as () => Record<string, string>;
      expect(statuses()).toEqual({ 'term-agent': 'unverified' });
      expect(handler(null, { workspaceId: 'workspace-1', terminalId: 'term-agent', message: 'unsafe\x1b[201~' }).success).toBe(false);
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  test('rejects closed, shell-fallback, and mismatched annotation targets', () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-handoff-'));
    const otherPath = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-other-'));
    try {
      const { terminals, opts } = createMockDeps();
      const write = vi.fn();
      const broker = { canHandoff: vi.fn().mockReturnValue(true), markSubmitted: vi.fn() };
      registerTerminalIpc({ ...opts, getOpenWorkspacePath: () => workspacePath, agentAttentionBroker: broker as never });
      const handler = mockIpcMain.handle.mock.calls.find((call) => call[0] === 'send-annotation-to-agent')?.[1] as (
        _: unknown, payload: unknown,
      ) => { success: boolean; error?: string };
      const payload = { workspaceId: 'workspace-1', terminalId: 'term-agent', message: 'Review annotation' };

      expect(handler(null, payload).success).toBe(false);
      terminals.set('term-agent', { id: 'term-agent', cwd: otherPath, harnessId: 'codex', pty: { write } });
      expect(handler(null, payload).success).toBe(false);
      terminals.set('term-agent', { id: 'term-agent', cwd: workspacePath, harnessId: 'codex', pty: { write } });
      broker.canHandoff.mockReturnValue(false);
      expect(handler(null, payload).success).toBe(false);
      broker.canHandoff.mockReturnValue(true);
      fs.rmSync(workspacePath, { recursive: true, force: true });
      expect(handler(null, payload).success).toBe(false);
      expect(write).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(workspacePath, { recursive: true, force: true });
      fs.rmSync(otherPath, { recursive: true, force: true });
    }
  });

  describe('remote annotation handoff', () => {
    const ROOT = '/srv/app';
    function setup(overrides: Record<string, unknown> = {}, workspace: Record<string, unknown> | null = { workspaceId: 'ws-ssh', location: { environmentId: 'ssh-1', path: ROOT } }) {
      const { terminals, opts } = createMockDeps();
      const write = vi.fn();
      const broker = { canHandoff: vi.fn().mockReturnValue(true), markSubmitted: vi.fn() };
      terminals.set('term-agent', {
        id: 'term-agent', cwd: '/home/desktop/other', harnessId: 'codex', workspaceId: 'ws-ssh', environmentId: 'ssh-1',
        remoteWorkingDir: `${ROOT}/pkg`, pty: { write }, ...overrides,
      });
      const getOpenWorkspacePath = vi.fn().mockReturnValue(null);
      registerTerminalIpc({
        ...opts, getOpenWorkspacePath, agentAttentionBroker: broker as never,
        getWorkspaceRegistry: () => withCheckoutContexts({ getWorkspace: (id: string) => (workspace && id === workspace.workspaceId ? workspace : null) }) as never,
      });
      const handler = mockIpcMain.handle.mock.calls.find((call) => call[0] === 'send-annotation-to-agent')?.[1] as (
        _: unknown, payload: unknown,
      ) => { success: boolean; error?: string };
      const send = (message = 'Review annotation', workspaceId = 'ws-ssh') => handler(null, { workspaceId, terminalId: 'term-agent', message });
      return { terminals, write, broker, send, getOpenWorkspacePath };
    }

    test('delivers the same bracketed-paste payload to an eligible remote agent and marks it submitted', () => {
      const { write, broker, send, getOpenWorkspacePath } = setup();
      expect(send('URL: https://example.com\nNote: Fix this')).toEqual({ success: true });
      expect(write).toHaveBeenCalledWith('\x1b[200~URL: https://example.com\nNote: Fix this\x1b[201~\r');
      expect(broker.markSubmitted).toHaveBeenCalledWith('term-agent');
      expect(getOpenWorkspacePath).not.toHaveBeenCalled();
    });

    test('accepts the workspace root itself as the remote directory', () => {
      const { write, send } = setup({ remoteWorkingDir: ROOT });
      expect(send().success).toBe(true);
      expect(write).toHaveBeenCalledTimes(1);
    });

    test.each([
      ['wrong workspace ID', { workspaceId: 'ws-other' }],
      ['wrong environment ID', { environmentId: 'ssh-2' }],
      ['local environment ID on the terminal', { environmentId: 'local' }],
      ['missing environment ID', { environmentId: undefined }],
      ['remote directory outside the root', { remoteWorkingDir: '/srv/app-sibling' }],
      ['traversal out of the root', { remoteWorkingDir: `${ROOT}/../etc` }],
      ['missing remote directory', { remoteWorkingDir: undefined }],
      ['relative remote directory', { remoteWorkingDir: 'pkg' }],
      ['generic remote shell without a harness', { harnessId: undefined }],
    ])('fails closed for %s', (_name, overrides) => {
      const { write, broker, send } = setup(overrides);
      expect(send().success).toBe(false);
      expect(write).not.toHaveBeenCalled();
      expect(broker.markSubmitted).not.toHaveBeenCalled();
    });

    test('fails when the broker says the agent is busy or unregistered, or the terminal is closed or unregistered workspace', () => {
      const { write, broker, send, terminals } = setup();
      broker.canHandoff.mockReturnValue(false);
      expect(send().success).toBe(false);
      broker.canHandoff.mockReturnValue(true);
      expect(send('x', 'ws-unregistered').success).toBe(false);
      terminals.delete('term-agent');
      expect(send().success).toBe(false);
      expect(write).not.toHaveBeenCalled();
    });

    test('a same-path local terminal cannot receive a remote workspace handoff, nor the reverse', () => {
      const local = setup({ environmentId: 'local', workspaceId: undefined, cwd: ROOT, remoteWorkingDir: undefined });
      expect(local.send().success).toBe(false);
      expect(local.write).not.toHaveBeenCalled();
      const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-handoff-'));
      try {
        const { terminals, opts } = createMockDeps();
        const write = vi.fn();
        terminals.set('term-agent', { id: 'term-agent', cwd: workspacePath, harnessId: 'codex', workspaceId: 'ws-ssh', environmentId: 'ssh-1', remoteWorkingDir: workspacePath, pty: { write } });
        const broker = { canHandoff: vi.fn().mockReturnValue(true), markSubmitted: vi.fn() };
        mockIpcMain.handle.mockClear();
        registerTerminalIpc({
          ...opts, getOpenWorkspacePath: () => workspacePath, agentAttentionBroker: broker as never,
          getWorkspaceRegistry: () => withCheckoutContexts({ getWorkspace: () => ({ workspaceId: 'ws-local', location: { environmentId: 'local', path: workspacePath } }) }) as never,
        });
        const handler = mockIpcMain.handle.mock.calls.find((call) => call[0] === 'send-annotation-to-agent')?.[1] as (_: unknown, payload: unknown) => { success: boolean };
        expect(handler(null, { workspaceId: 'ws-local', terminalId: 'term-agent', message: 'x' }).success).toBe(false);
        expect(write).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(workspacePath, { recursive: true, force: true });
      }
    });

    test('keeps size, shape and control-character protections', () => {
      const { write, send } = setup();
      expect(send('a'.repeat(32 * 1024 + 1)).success).toBe(false);
      expect(send('unsafe\x1b[201~').success).toBe(false);
      expect(send('bell\x07').success).toBe(false);
      expect(send('').success).toBe(false);
      expect(write).not.toHaveBeenCalled();
      expect(send('a'.repeat(32 * 1024)).success).toBe(true);
    });
  });

  test('GET_TERMINAL_BUFFER returns empty string when terminals map is empty', async () => {
    const { opts } = createMockDeps();
    opts.getTerminals = vi.fn().mockReturnValue(new Map());
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'get-terminal-buffer'
    )?.[1] as (_: unknown, id: string) => string;

    const result = await handler(null, 'any-id');
    expect(result).toBe('');
  });

  test('WRITE_TERMINAL does not throw for missing terminal (no-op)', async () => {
    const { opts } = createMockDeps();
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'write-terminal'
    )?.[1] as (_: unknown, payload: { id: string; data: string }) => { success: boolean; error?: string };

    const result = await handler(null, { id: 'nonexistent', data: 'hello' });
    expect(result).toEqual({ success: true });
  });

  test('WRITE_TERMINAL does not throw for null payload (returns error result)', async () => {
    const { opts } = createMockDeps();
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'write-terminal'
    )?.[1] as (_: unknown, payload: { id: string; data: string } | null) => { success: boolean; error?: string };

    const result = await handler(null, null);
    expect(result).toEqual({ success: false, error: 'Invalid payload' });
  });

  test('WRITE_TERMINAL calls pty.write when terminal exists', async () => {
    const { terminals, opts } = createMockDeps();
    const mockPty = { write: vi.fn(), kill: vi.fn(), resize: vi.fn(), pause: vi.fn(), resume: vi.fn() };
    terminals.set('existing-term', { id: 'existing-term', pid: 42, pty: mockPty });
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'write-terminal'
    )?.[1] as (_: unknown, payload: { id: string; data: string } | null) => { success: boolean; error?: string };

    const result = await handler(null, { id: 'existing-term', data: 'hello world' });
    expect(result).toEqual({ success: true });
    expect(mockPty.write).toHaveBeenCalledWith('hello world');
  });

  test('startup-paused terminals stay paused through initial resize; READY drains once before resuming', async () => {
    const { terminals, opts, mainWindow } = createMockDeps();
    const order: string[] = [];
    const mockPty = { write: vi.fn(), kill: vi.fn(), resize: vi.fn(), pause: vi.fn(), resume: vi.fn(() => { order.push('resume'); }) };
    const terminal = { id: 'paused', pid: 99, pty: mockPty, startupBuffer: ['prefix', 'suffix'], startupBufferReady: false, startupPaused: true };
    terminals.set('paused', terminal);
    mainWindow.webContents.send.mockImplementation((channel: string, payload: { data: string }) => {
      if (channel === TERMINAL_DATA) order.push(payload.data);
    });
    registerTerminalIpc(opts);
    const handler = (channel: string) => mockIpcMain.handle.mock.calls.find((call) => call[0] === channel)![1];
    handler(RESIZE_TERMINAL)(null, { id: 'paused', cols: 120, rows: 40 });
    expect(mockPty.resume).not.toHaveBeenCalled();
    handler(TERMINAL_READY)(null, 'paused');
    handler(TERMINAL_READY)(null, 'paused');
    expect(order).toEqual(['prefix', 'suffix', 'resume']);
    expect(mockPty.resume).toHaveBeenCalledOnce();
    expect(terminal.startupBuffer).toEqual([]);
    expect(terminal.startupPaused).toBe(false);
  });

  test('RESIZE_TERMINAL calls pty.resize when terminal exists', async () => {
    const { terminals, opts } = createMockDeps();
    const mockPty = { write: vi.fn(), kill: vi.fn(), resize: vi.fn(), pause: vi.fn(), resume: vi.fn() };
    terminals.set('resizable-term', { id: 'resizable-term', pid: 99, pty: mockPty });
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'resize-terminal'
    )?.[1] as (_: unknown, payload: { id: string; cols: number; rows: number }) => { success: boolean; error?: string };

    const result = await handler(null, { id: 'resizable-term', cols: 120, rows: 40 });
    expect(result).toEqual({ success: true });
    expect(mockPty.resize).toHaveBeenCalledWith(120, 40);
  });

  test('KILL_TERMINAL calls pty.kill and deletes terminal when it exists', async () => {
    const { terminals, opts } = createMockDeps();
    const mockPty = { write: vi.fn(), kill: vi.fn(), resize: vi.fn(), pause: vi.fn(), resume: vi.fn() };
    terminals.set('killable-term', { id: 'killable-term', pid: 77, pty: mockPty });
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'kill-terminal'
    )?.[1] as (_: unknown, id: string) => { success: boolean; error?: string };

    const result = await handler(null, 'killable-term');
    expect(result).toEqual({ success: true });
    expect(mockPty.kill).toHaveBeenCalledTimes(1);
    expect(terminals.has('killable-term')).toBe(false);
  });

  test('RESIZE_TERMINAL does not throw for missing terminal (no-op)', async () => {
    const { opts } = createMockDeps();
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'resize-terminal'
    )?.[1] as (_: unknown, payload: { id: string; cols: number; rows: number }) => { success: boolean; error?: string };

    const result = await handler(null, { id: 'nonexistent', cols: 80, rows: 24 });
    expect(result).toEqual({ success: true });
  });

  test('RESIZE_TERMINAL does not throw for null payload (returns error result)', async () => {
    const { opts } = createMockDeps();
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'resize-terminal'
    )?.[1] as (_: unknown, payload: unknown) => { success: boolean; error?: string };

    const result = await handler(null, null);
    expect(result).toEqual({ success: false, error: 'Invalid payload' });
  });

  test('KILL_TERMINAL does not throw for missing terminal (no-op)', async () => {
    const { opts } = createMockDeps();
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'kill-terminal'
    )?.[1] as (_: unknown, id: string) => { success: boolean; error?: string };

    const result = await handler(null, 'nonexistent-term');
    expect(result).toEqual({ success: true });
  });

  test('TERMINAL_CLEANUP_WORKSPACE returns killed count (0) for empty ID list', async () => {
    const { opts } = createMockDeps();
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'terminal:cleanup-workspace'
    )?.[1] as (_: unknown, ids: string[]) => number;

    const result = await handler(null, []);
    expect(result).toBe(0);
    expect(typeof result).toBe('number');
  });

  test('TERMINAL_CLEANUP_WORKSPACE returns 0 for all nonexistent IDs', async () => {
    const { opts } = createMockDeps();
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'terminal:cleanup-workspace'
    )?.[1] as (_: unknown, ids: string[]) => number;

    const result = await handler(null, ['id-1', 'id-2', 'id-3']);
    expect(result).toBe(0);
  });

  test('TERMINAL_CLEANUP_WORKSPACE returns correct killed count for partial matches', async () => {
    const { terminals, opts } = createMockDeps();
    const mockPty = { write: vi.fn(), kill: vi.fn(), resize: vi.fn(), pause: vi.fn(), resume: vi.fn() };
    terminals.set('term-1', { id: 'term-1', pid: 100, pty: mockPty });
    terminals.set('term-2', { id: 'term-2', pid: 101, pty: mockPty });
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'terminal:cleanup-workspace'
    )?.[1] as (_: unknown, ids: string[]) => number;

    const result = await handler(null, ['term-1', 'nonexistent', 'term-2']);
    expect(result).toBe(2);
    expect(mockPty.kill).toHaveBeenCalledTimes(2);
    expect(terminals.size).toBe(0);
  });

  test('WRITE_CLIPBOARD calls clipboard.writeText and returns undefined', async () => {
    const { opts } = createMockDeps();
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'write-clipboard'
    )?.[1] as (_: unknown, text: string) => { success: boolean; error?: string };

    const result = await handler(null, 'clipboard text');
    expect(mockClipboardWriteText).toHaveBeenCalledWith('clipboard text');
    expect(result).toEqual({ success: true });
  });

  test('WRITE_CLIPBOARD does not throw for empty string', async () => {
    const { opts } = createMockDeps();
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'write-clipboard'
    )?.[1] as (_: unknown, text: string) => { success: boolean; error?: string };

    const result = await handler(null, '');
    expect(mockClipboardWriteText).toHaveBeenCalledWith('');
    expect(result).toEqual({ success: true });
  });

  test('SPAWN_TERMINAL does not throw when getSafeWorkspacePath returns empty string', async () => {
    const { opts } = createMockDeps();
    opts.getSafeWorkspacePath = vi.fn().mockReturnValue('');
    mockPtySpawn.mockReturnValue({ pid: 123, onData: vi.fn(), onExit: vi.fn() });
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'spawn-terminal'
    )?.[1] as (_: unknown, workingDir: string) => { id: string; pid: number };

    const result = await handler(null, '/some/path');
    expect(result).toBeDefined();
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('pid');
  });

  test('SPAWN_TERMINAL uses wrapper-script execution for harness launches', async () => {
    const { opts } = createMockDeps();
    const broker = { register: vi.fn().mockResolvedValue({ CLANKER_ATTENTION_TOKEN: 'test-token' }), release: vi.fn() };
    const ensureWrapper = vi.fn().mockReturnValue(testHarnessWrapper());
    opts.ensureHarnessWrapperScript = ensureWrapper;
    opts.getHarnessOptions = vi.fn().mockReturnValue({
      codex: {
        name: 'Codex',
        command: 'codex',
        args: [],
        icon: '🧠',
      },
    });
    opts.getStore = vi.fn().mockReturnValue({
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'harnessDefaults') {
          return { codex: { model: '', favorites: [], flags: '--yolo' } };
        }
        return false;
      }),
    }) as never;
    mockPtySpawn.mockReturnValue({ pid: 456, onData: vi.fn(), onExit: vi.fn() });
    registerTerminalIpc({ ...opts, agentAttentionBroker: broker as never });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'spawn-terminal'
    )?.[1] as (_: unknown, workingDir: string, harness?: string, model?: string) => { id: string; pid: number };

    const result = await handler(null, '/test/workspace', 'codex', 'gpt-5.4-mini');

    expect(result).toBeDefined();
    expect(broker.register).toHaveBeenCalledWith(result.id, 'codex', { authority: 'full', quality: 'hook' });
    expect(ensureWrapper).toHaveBeenCalledTimes(1);
    expect(mockPtySpawn).toHaveBeenCalledWith(
      testHarnessWrapper(),
      ['codex', '--model', 'gpt-5.4-mini', '--yolo'],
      expect.objectContaining({
        cwd: '/test/workspace',
        env: expect.objectContaining({
          CLANKER_GRID_FALLBACK_SHELL: expect.any(String),
          CLANKER_ATTENTION_TOKEN: 'test-token',
          CLANKER_ATTENTION_COMMAND: expect.any(String),
          TERM: 'xterm-256color',
        }),
      })
    );
  });

  test('SPAWN_TERMINAL preserves shell-sensitive harness args as argv entries', async () => {
    const { opts } = createMockDeps();
    opts.ensureHarnessWrapperScript = vi.fn().mockReturnValue(testHarnessWrapper());
    opts.getHarnessOptions = vi.fn().mockReturnValue({
      pi: {
        name: 'Pi',
        command: 'pi',
        args: [],
        icon: 'π',
      },
    });
    opts.getStore = vi.fn().mockReturnValue({
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'harnessDefaults') {
          return { pi: { model: '', favorites: [], flags: '' } };
        }
        return false;
      }),
    }) as never;
    mockPtySpawn.mockReturnValue({ pid: 457, onData: vi.fn(), onExit: vi.fn() });
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'spawn-terminal'
    )?.[1] as (_: unknown, workingDir: string, harness?: string, model?: string) => { id: string; pid: number };

    await handler(null, '/test/workspace', 'pi', 'sonnet:high thinking');

    expect(mockPtySpawn).toHaveBeenCalledWith(
      testHarnessWrapper(),
      ['pi', '--model', 'sonnet:high thinking'],
      expect.any(Object)
    );
  });

  test('SPAWN_TERMINAL enables Hermes YOLO mode from configured extra flags', async () => {
    const { opts } = createMockDeps();
    opts.ensureHarnessWrapperScript = vi.fn().mockReturnValue(testHarnessWrapper());
    opts.getHarnessOptions = vi.fn().mockReturnValue({
      hermes: { name: 'Hermes', command: 'hermes', args: ['--tui'], icon: '☿', modelArg: '-m' },
    });
    opts.getStore = vi.fn().mockReturnValue({
      get: vi.fn().mockImplementation((key: string) => key === 'harnessDefaults'
        ? { hermes: { model: 'anthropic/default', favorites: [], flags: '--yolo --reasoning low' } }
        : false),
    }) as never;
    mockPtySpawn.mockReturnValue({ pid: 459, onData: vi.fn(), onExit: vi.fn() });
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'spawn-terminal'
    )?.[1] as (_: unknown, workingDir: string, harness?: string, model?: string) => Promise<{ harnessId?: string }>;

    const result = await handler(null, '/test/workspace', 'hermes', 'openrouter/custom-model');
    expect(result.harnessId).toBe('hermes');
    expect(mockPtySpawn).toHaveBeenCalledWith(
      testHarnessWrapper(),
      ['hermes', '-m', 'openrouter/custom-model', '--tui', '--yolo', '--reasoning', 'low'],
      expect.objectContaining({
        cwd: '/test/workspace',
        env: expect.objectContaining({ HERMES_YOLO_MODE: '1' }),
      })
    );
  });

  test('SPAWN_TERMINAL falls back to harnessDefaults model when renderer omits one', async () => {
    const { opts } = createMockDeps();
    opts.ensureHarnessWrapperScript = vi.fn().mockReturnValue(testHarnessWrapper());
    opts.getHarnessOptions = vi.fn().mockReturnValue({
      claude: {
        name: 'Claude',
        command: 'claude',
        args: [],
        icon: '✨',
      },
    });
    opts.getStore = vi.fn().mockReturnValue({
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'harnessDefaults') {
          return { claude: { model: 'sonnet', favorites: [], flags: '' } };
        }
        return false;
      }),
    }) as never;
    mockPtySpawn.mockReturnValue({ pid: 460, onData: vi.fn(), onExit: vi.fn() });
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'spawn-terminal'
    )?.[1] as (_: unknown, workingDir: string, harness?: string, model?: string) => { id: string; pid: number };

    await handler(null, '/test/workspace', 'claude');

    expect(mockPtySpawn).toHaveBeenCalledWith(
      testHarnessWrapper(),
      ['claude', '--model', 'sonnet'],
      expect.any(Object)
    );
  });

  test('SPAWN_TERMINAL prefers explicit model over harnessDefaults model', async () => {
    const { opts } = createMockDeps();
    opts.ensureHarnessWrapperScript = vi.fn().mockReturnValue(testHarnessWrapper());
    opts.getHarnessOptions = vi.fn().mockReturnValue({
      claude: {
        name: 'Claude',
        command: 'claude',
        args: [],
        icon: '✨',
      },
    });
    opts.getStore = vi.fn().mockReturnValue({
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'harnessDefaults') {
          return { claude: { model: 'sonnet', favorites: [], flags: '' } };
        }
        return false;
      }),
    }) as never;
    mockPtySpawn.mockReturnValue({ pid: 461, onData: vi.fn(), onExit: vi.fn() });
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'spawn-terminal'
    )?.[1] as (_: unknown, workingDir: string, harness?: string, model?: string) => { id: string; pid: number };

    await handler(null, '/test/workspace', 'claude', 'opus');

    expect(mockPtySpawn).toHaveBeenCalledWith(
      testHarnessWrapper(),
      ['claude', '--model', 'opus'],
      expect.any(Object)
    );
  });

  test('SPAWN_TERMINAL does not throw when getHarnessOptions returns undefined', async () => {
    const { opts } = createMockDeps();
    // Return an object without the specific harness key so getHarnessOptions()[harness]
    // returns undefined rather than the function throwing on `()['harness']`
    opts.getHarnessOptions = vi.fn().mockReturnValue({});
    mockPtySpawn.mockReturnValue({ pid: 456, onData: vi.fn(), onExit: vi.fn() });
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'spawn-terminal'
    )?.[1] as (_: unknown, workingDir: string, harness?: string) => { id: string; pid: number };

    const result = await handler(null, '/test/workspace', 'codex');
    expect(result).toBeDefined();
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('pid');
  });

  test('SPAWN_TERMINAL keeps non-harness shell terminals on the existing spawn path', async () => {
    const { opts } = createMockDeps();
    mockPtySpawn.mockReturnValue({ pid: 788, onData: vi.fn(), onExit: vi.fn() });
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'spawn-terminal'
    )?.[1] as (_: unknown, workingDir: string) => { id: string; pid: number };

    await handler(null, '/test/workspace');

    expect(opts.ensureHarnessWrapperScript).not.toHaveBeenCalled();
    expect(mockPtySpawn).toHaveBeenCalledWith(
      process.platform === 'win32' ? 'powershell.exe' : expect.any(String),
      process.platform === 'win32' ? [] : ['-i'],
      expect.objectContaining({ cwd: '/test/workspace' })
    );
  });

  test('SPAWN_TERMINAL does not throw when main window is null', async () => {
    const { opts } = createMockDeps();
    (opts as { getMainWindow: () => { webContents: { send: ReturnType<typeof vi.fn> } } | null }).getMainWindow = vi.fn().mockReturnValue(null);
    mockPtySpawn.mockReturnValue({ pid: 789, onData: vi.fn(), onExit: vi.fn() });
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'spawn-terminal'
    )?.[1] as (_: unknown, workingDir: string) => { id: string; pid: number };

    const result = await handler(null, '/test/workspace');
    expect(result).toBeDefined();
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('pid');
  });

  test('SPAWN_TERMINAL does not throw when store returns undefined values', async () => {
    const { opts } = createMockDeps();
    const storeWithUndefined = { get: vi.fn().mockReturnValue(undefined) };
    (opts as { getStore: () => { get: (key: string) => unknown } }).getStore = vi.fn().mockReturnValue(storeWithUndefined);
    mockPtySpawn.mockReturnValue({ pid: 999, onData: vi.fn(), onExit: vi.fn() });
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'spawn-terminal'
    )?.[1] as (_: unknown, workingDir: string) => { id: string; pid: number };

    const result = await handler(null, '/test/workspace');
    expect(result).toBeDefined();
  });
});
