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

import { describe, test, expect, beforeEach, vi } from 'vitest';
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
import { registerTerminalIpc } from '../../../src/main/ipc/terminalIpc';

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
    ];

    expectedChannels.forEach(channel => {
      expect(mockHandle).toHaveBeenCalledWith(channel, expect.any(Function));
    });
  });

  test('registers exactly 7 terminal IPC handle channels (6 handlers + write-clipboard)', () => {
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

    expect(mockHandle.mock.calls.length).toBe(8);
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
    expect(mockHandle.mock.calls.length).toBe(16);
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
    return { terminals, opts };
  };

  beforeEach(() => {
    mockHandle.mockClear();
    mockOn.mockClear();
    mockClipboardWriteText.mockClear();
    mockPtySpawn.mockClear();
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
    registerTerminalIpc(opts);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'spawn-terminal'
    )?.[1] as (_: unknown, workingDir: string, harness?: string, model?: string) => { id: string; pid: number };

    const result = await handler(null, '/test/workspace', 'codex', 'gpt-5.4-mini');

    expect(result).toBeDefined();
    expect(ensureWrapper).toHaveBeenCalledTimes(1);
    expect(mockPtySpawn).toHaveBeenCalledWith(
      testHarnessWrapper(),
      ['codex', '--model', 'gpt-5.4-mini', '--yolo'],
      expect.objectContaining({
        cwd: '/test/workspace',
        env: expect.objectContaining({
          CLANKER_GRID_FALLBACK_SHELL: expect.any(String),
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
      expect.any(String),
      ['-i'],
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

  test('SPAWN_TERMINAL does not throw when store returns undefined for showFastfetch', async () => {
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
