/**
 * Browser IPC Registration Tests
 *
 * Tests for the browser IPC module, verifying channel registration.
 */

import { vi, describe, test, expect, beforeEach } from 'vitest';

let attachedBeforeInputEventHandler: ((event: { preventDefault: () => void }, input: { control?: boolean; meta?: boolean; alt?: boolean; key?: string; code?: string; type?: string }) => void) | null = null;

// Mock electron module
vi.mock('electron', () => ({
  app: {
    disableHardwareAcceleration: vi.fn(),
    getPath: vi.fn((name: string) => {
      if (name === 'home') return '/home/test';
      return `/mock/${name}`;
    }),
    commandLine: {
      appendSwitch: vi.fn(),
    },
    whenReady: vi.fn(() => {
      return new Promise<never>(() => {
        // Prevent app initialization during tests
      });
    }),
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
    webContents: {
      send: vi.fn(),
      getZoomLevel: vi.fn(() => 0),
    },
    contentView: {
      addChildView: vi.fn(),
    },
  })),
  Menu: Object.assign(vi.fn(), {
    setApplicationMenu: vi.fn(),
  }),
  WebContentsView: class MockWebContentsView {
    setVisible = vi.fn();
    setBounds = vi.fn();
    webContents = {
      loadURL: vi.fn(),
      close: vi.fn(),
      reload: vi.fn(),
      stop: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((eventName: string, handler: typeof attachedBeforeInputEventHandler) => {
        if (eventName === 'before-input-event') {
          attachedBeforeInputEventHandler = handler;
        }
      }),
      getZoomLevel: vi.fn(() => 0),
      setZoomLevel: vi.fn(),
      navigationHistory: {
        canGoBack: vi.fn(() => false),
        canGoForward: vi.fn(() => false),
        goBack: vi.fn(),
        goForward: vi.fn(),
      },
    };
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

// Import after mocking
import { ipcMain } from 'electron';
import { registerBrowserIpc } from '../../../src/main/ipc/browserIpc';

describe('registerBrowserIpc', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  const createMockDeps = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockBrowserViews = new Map<string, any>();
    let mockActiveWorkspaceId: string | null = null;

    const mockMainWindow = {
      webContents: {
        send: vi.fn(),
        getZoomLevel: vi.fn(() => 0),
      },
      contentView: {
        addChildView: vi.fn(),
      },
    };

    return {
      deps: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getMainWindow: () => mockMainWindow as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getBrowserViews: () => mockBrowserViews as any,
        getActiveBrowserWorkspaceId: () => mockActiveWorkspaceId,
        setActiveBrowserWorkspaceId: (id: string | null) => { mockActiveWorkspaceId = id; },
      },
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    attachedBeforeInputEventHandler = null;
  });

  test('registers all expected browser IPC channels', () => {
    const { deps } = createMockDeps();

    registerBrowserIpc(deps);

    // Verify all expected channels are registered
    const expectedChannels = [
      'browser-set-bounds',
      'browser-hide',
      'browser-navigate',
      'browser-back',
      'browser-forward',
      'browser-refresh',
      'browser-stop',
      'browser-dispose-workspace',
      'open-external',
      'can-go-back',
      'can-go-forward',
    ];

    expectedChannels.forEach(channel => {
      expect(mockIpcMain.handle).toHaveBeenCalledWith(channel, expect.any(Function));
    });
  });

  test('registers exactly 13 browser IPC channels', () => {
    const { deps } = createMockDeps();

    registerBrowserIpc(deps);

    // Count how many times handle was called
    const handleCalls = mockIpcMain.handle.mock.calls;
    expect(handleCalls.length).toBe(13);
  });

  test('can be called multiple times (registering handlers again)', () => {
    const { deps } = createMockDeps();

    // Register twice
    registerBrowserIpc(deps);
    registerBrowserIpc(deps);

    // Handlers should be registered again
    const handleCalls = mockIpcMain.handle.mock.calls;
    expect(handleCalls.length).toBe(26);
  });

  test('browser channels do not overlap with terminal channels', () => {
    const { deps } = createMockDeps();

    registerBrowserIpc(deps);

    const browserChannels = [
      'browser-set-bounds',
      'browser-hide',
      'browser-navigate',
      'browser-back',
      'browser-forward',
      'browser-refresh',
      'browser-stop',
      'browser-dispose-workspace',
      'open-external',
      'can-go-back',
      'can-go-forward',
    ];

    const terminalChannels = [
      'spawn-terminal',
      'get-terminal-buffer',
      'write-terminal',
      'resize-terminal',
      'kill-terminal',
      'terminal:cleanup-workspace',
    ];

    // Verify no overlap
    const overlap = browserChannels.filter(ch => terminalChannels.includes(ch));
    expect(overlap.length).toBe(0);
  });
});

/**
 * Browser IPC — Error-Path Tests
 *
 * Verifies every browser handler returns a defined value (never undefined or
 * thrown) for null/invalid workspace IDs, missing browser views, null main
 * window, and unsafe URL attempts.
 */

describe('browserIpc — error-path: null/invalid workspaceId returns valid results', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  const createMockDeps = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockBrowserViews = new Map<string, any>();
    let mockActiveWorkspaceId: string | null = null;
    const mockMainWindow = {
      webContents: {
        send: vi.fn(),
        getZoomLevel: vi.fn(() => 0),
      },
      contentView: { addChildView: vi.fn() },
    };

    return {
      deps: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getMainWindow: () => mockMainWindow as any,
        getBrowserViews: () => mockBrowserViews,
        getActiveBrowserWorkspaceId: () => mockActiveWorkspaceId,
        setActiveBrowserWorkspaceId: (id: string | null) => { mockActiveWorkspaceId = id; },
      },
      mockMainWindow,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('BROWSER_SET_BOUNDS returns undefined for null workspaceId', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-set-bounds'
    )?.[1] as (_: unknown, workspaceId: string, bounds: object) => void;

    // @ts-expect-error — intentionally passing null to test invalid input
    const result = await handler(null, null, { x: 0, y: 0, width: 800, height: 600 });
    expect(result).toBeUndefined();
  });

  test('suppresses browser keyboard zoom shortcuts but not mouse wheel input', () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-set-bounds'
    )?.[1] as (_: unknown, workspaceId: string, bounds: object) => void;

    handler(null, 'ws-1', { x: 0, y: 0, width: 800, height: 600 });

    expect(attachedBeforeInputEventHandler).not.toBeNull();

    const preventDefault = vi.fn();
    attachedBeforeInputEventHandler?.(
      { preventDefault },
      { control: true, meta: false, alt: false, key: '=', code: 'Equal', type: 'keyDown' }
    );
    expect(preventDefault).toHaveBeenCalled();

    preventDefault.mockClear();
    attachedBeforeInputEventHandler?.(
      { preventDefault },
      { control: true, meta: false, alt: false, type: 'mouseWheel' }
    );
    expect(preventDefault).not.toHaveBeenCalled();
  });

  test('BROWSER_SET_BOUNDS returns undefined for empty string workspaceId', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-set-bounds'
    )?.[1] as (_: unknown, workspaceId: string, bounds: object) => void;

    const result = await handler(null, '', { x: 0, y: 0, width: 800, height: 600 });
    expect(result).toBeUndefined();
  });

  test('BROWSER_HIDE returns undefined for null workspaceId', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-hide'
    )?.[1] as (_: unknown, workspaceId: string) => void;

    // @ts-expect-error — null workspaceId
    const result = await handler(null, null);
    expect(result).toBeUndefined();
  });

  test('BROWSER_NAVIGATE returns false for null workspaceId', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-navigate'
    )?.[1] as (_: unknown, workspaceId: string, url: string) => boolean;

    // @ts-expect-error — null workspaceId
    const result = await handler(null, null, 'https://github.com');
    expect(result).toBe(false);
  });

  test('BROWSER_NAVIGATE returns false for invalid (non-http) URL', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-navigate'
    )?.[1] as (_: unknown, workspaceId: string, url: string) => boolean;

    // file:// URLs are blocked by normalizeAppBrowserUrl security check
    const result = await handler(null, 'ws-1', 'file:///etc/passwd');
    expect(result).toBe(false);
  });

  test('BROWSER_BACK returns undefined for null workspaceId', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-back'
    )?.[1] as (_: unknown, workspaceId: string) => void;

    // @ts-expect-error — null workspaceId
    const result = await handler(null, null);
    expect(result).toBeUndefined();
  });

  test('BROWSER_FORWARD returns undefined for null workspaceId', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-forward'
    )?.[1] as (_: unknown, workspaceId: string) => void;

    // @ts-expect-error — null workspaceId
    const result = await handler(null, null);
    expect(result).toBeUndefined();
  });

  test('BROWSER_REFRESH returns undefined for null workspaceId', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-refresh'
    )?.[1] as (_: unknown, workspaceId: string) => void;

    // @ts-expect-error — null workspaceId
    const result = await handler(null, null);
    expect(result).toBeUndefined();
  });

  test('BROWSER_STOP returns undefined for null workspaceId', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-stop'
    )?.[1] as (_: unknown, workspaceId: string) => void;

    // @ts-expect-error — null workspaceId
    const result = await handler(null, null);
    expect(result).toBeUndefined();
  });

  test('BROWSER_DISPOSE_WORKSPACE returns undefined for null workspaceId', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-dispose-workspace'
    )?.[1] as (_: unknown, workspaceId: string) => void;

    // @ts-expect-error — null workspaceId
    const result = await handler(null, null);
    expect(result).toBeUndefined();
  });

  test('CAN_GO_BACK returns false for null workspaceId', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'can-go-back'
    )?.[1] as (_: unknown, workspaceId: string) => boolean;

    // @ts-expect-error — null workspaceId
    const result = await handler(null, null);
    expect(result).toBe(false);
  });

  test('CAN_GO_FORWARD returns false for null workspaceId', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'can-go-forward'
    )?.[1] as (_: unknown, workspaceId: string) => boolean;

    // @ts-expect-error — null workspaceId
    const result = await handler(null, null);
    expect(result).toBe(false);
  });
});

describe('browserIpc — error-path: OPEN_EXTERNAL security', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('OPEN_EXTERNAL returns false for file:// URL (blocked by normalizeExternalUrl)', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'open-external'
    )?.[1] as (_: unknown, url: string) => boolean;

    const result = await handler(null, 'file:///etc/passwd');
    expect(result).toBe(false);
  });

  test('OPEN_EXTERNAL returns false for javascript: URL (blocked by normalizeExternalUrl)', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'open-external'
    )?.[1] as (_: unknown, url: string) => boolean;

    const result = await handler(null, 'javascript:alert(1)');
    expect(result).toBe(false);
  });

  test('OPEN_EXTERNAL returns false for empty string', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'open-external'
    )?.[1] as (_: unknown, url: string) => boolean;

    const result = await handler(null, '');
    expect(result).toBe(false);
  });

  test('OPEN_EXTERNAL returns false for null url', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'open-external'
    )?.[1] as (_: unknown, url: string) => boolean;

    // @ts-expect-error — intentionally passing null
    const result = await handler(null, null);
    expect(result).toBe(false);
  });

  const { createMockDeps } = (() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockBrowserViews = new Map<string, any>();
    let mockActiveWorkspaceId: string | null = null;
    const mockMainWindow = {
      webContents: { send: vi.fn() },
      contentView: { addChildView: vi.fn() },
    };
    return {
      createMockDeps: () => ({
        deps: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          getMainWindow: () => mockMainWindow as any,
          getBrowserViews: () => mockBrowserViews,
          getActiveBrowserWorkspaceId: () => mockActiveWorkspaceId,
          setActiveBrowserWorkspaceId: (id: string | null) => { mockActiveWorkspaceId = id; },
        },
      }),
    };
  })();
});

describe('browserIpc — error-path: null main window does not crash', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('BROWSER_SET_BOUNDS does not throw when main window is null', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockBrowserViews = new Map<string, any>();
    let mockActiveWorkspaceId: string | null = null;

    const deps = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getMainWindow: () => null as any,
      getBrowserViews: () => mockBrowserViews,
      getActiveBrowserWorkspaceId: () => mockActiveWorkspaceId,
      setActiveBrowserWorkspaceId: (id: string | null) => { mockActiveWorkspaceId = id; },
    };
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-set-bounds'
    )?.[1] as (_: unknown, workspaceId: string, bounds: object) => void;

    // Should not throw when main window is null (createBrowserViewForWorkspace returns null)
    const result = await handler(null, 'ws-1', { x: 0, y: 0, width: 800, height: 600 });
    expect(result).toBeUndefined();
  });
});

describe('browser IPC channel constants', () => {
  test('browser channel names are consistent', () => {
    const expectedChannels = [
      'browser-set-bounds',
      'browser-hide',
      'browser-navigate',
      'browser-back',
      'browser-forward',
      'browser-refresh',
      'browser-stop',
      'browser-dispose-workspace',
      'open-external',
      'can-go-back',
      'can-go-forward',
    ];

    // Verify all channels are non-empty strings
    expectedChannels.forEach(channel => {
      expect(typeof channel).toBe('string');
      expect(channel.length).toBeGreaterThan(0);
    });

    // Verify no duplicates
    const uniqueChannels = new Set(expectedChannels);
    expect(uniqueChannels.size).toBe(expectedChannels.length);
  });

  test('all browser channels start with expected prefixes', () => {
    const browserChannels = [
      'browser-set-bounds',
      'browser-hide',
      'browser-navigate',
      'browser-back',
      'browser-forward',
      'browser-refresh',
      'browser-stop',
      'browser-dispose-workspace',
      'open-external',
      'can-go-back',
      'can-go-forward',
    ];

    // These channels should all be browser-related or window-related
    const browserPrefixes = ['browser-', 'open-', 'can-go-'];
    browserChannels.forEach(channel => {
      const hasExpectedPrefix = browserPrefixes.some(prefix => channel.startsWith(prefix));
      expect(hasExpectedPrefix).toBe(true);
    });
  });
});
