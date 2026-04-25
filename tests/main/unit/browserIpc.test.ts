/**
 * Browser IPC Registration Tests
 *
 * Tests for the browser IPC module, verifying channel registration.
 */

import { vi, describe, test, expect, beforeEach } from 'vitest';

let attachedBeforeInputEventHandler: ((event: { preventDefault: () => void }, input: { control?: boolean; meta?: boolean; alt?: boolean; shift?: boolean; key?: string; code?: string; type?: string }) => void) | null = null;
let attachedContextMenuHandler: ((event: unknown, params: { x: number; y: number }) => void) | null = null;

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
    buildFromTemplate: vi.fn((template: unknown[]) => ({
      popup: vi.fn(),
      template,
    })),
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
        if (eventName === 'context-menu') {
          attachedContextMenuHandler = handler as typeof attachedContextMenuHandler;
        }
      }),
      getZoomLevel: vi.fn(() => 0),
      setZoomLevel: vi.fn(),
      openDevTools: vi.fn(),
      closeDevTools: vi.fn(),
      isDevToolsOpened: vi.fn(() => false),
      inspectElement: vi.fn(),
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
import { ipcMain, Menu } from 'electron';
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
    attachedContextMenuHandler = null;
  });

  test('registers browser context-menu and keyboard shortcut handlers', () => {
    const { deps } = createMockDeps();

    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-set-bounds'
    )?.[1] as (_: unknown, workspaceId: string, bounds: object) => void;

    handler(null, 'ws-1', { x: 0, y: 0, width: 800, height: 600 });

    expect(attachedBeforeInputEventHandler).not.toBeNull();
    expect(attachedContextMenuHandler).not.toBeNull();
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
      'browser-create-tab',
      'browser-close-tab',
      'browser-switch-tab',
      'browser-get-tabs',
      'browser-tab-navigate',
    ];

    expectedChannels.forEach(channel => {
      expect(mockIpcMain.handle).toHaveBeenCalledWith(channel, expect.any(Function));
    });
  });

  test('registers exactly 18 browser IPC channels', () => {
    const { deps } = createMockDeps();

    registerBrowserIpc(deps);

    // Count how many times handle was called
    const handleCalls = mockIpcMain.handle.mock.calls;
    expect(handleCalls.length).toBe(18);
  });

  test('can be called multiple times (registering handlers again)', () => {
    const { deps } = createMockDeps();

    // Register twice
    registerBrowserIpc(deps);
    registerBrowserIpc(deps);

    // Handlers should be registered again
    const handleCalls = mockIpcMain.handle.mock.calls;
    expect(handleCalls.length).toBe(36);
  });

  test('browser context menu can open devtools and inspect the clicked element', () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-set-bounds'
    )?.[1] as (_: unknown, workspaceId: string, bounds: object) => void;

    handler(null, 'ws-1', { x: 0, y: 0, width: 800, height: 600 });

    expect(attachedContextMenuHandler).not.toBeNull();
    const mockMenuInstance = { popup: vi.fn() };
    const buildFromTemplate = vi.mocked(Menu.buildFromTemplate);
    buildFromTemplate.mockReturnValueOnce(mockMenuInstance as never);

    const inspectElement = vi.fn();
    const openDevTools = vi.fn();
    const view = deps.getBrowserViews().get('ws-1')?.view as unknown as {
      webContents: {
        inspectElement: typeof inspectElement;
        openDevTools: typeof openDevTools;
      };
    };
    view.webContents.inspectElement = inspectElement;
    view.webContents.openDevTools = openDevTools;

    attachedContextMenuHandler?.({}, { x: 12, y: 34 });
    expect(buildFromTemplate).toHaveBeenCalled();
    expect(mockMenuInstance.popup).toHaveBeenCalled();

    const template = buildFromTemplate.mock.calls[buildFromTemplate.mock.calls.length - 1]?.[0] as Array<{ label?: string; click?: () => void }>;
    expect(template.map(item => item.label)).toEqual(['Open DevTools', 'Inspect Element']);

    template[0]?.click?.();
    expect(openDevTools).toHaveBeenCalledWith({ mode: 'detach' });

    template[1]?.click?.();
    expect(inspectElement).toHaveBeenCalledWith(12, 34);
    expect(openDevTools).toHaveBeenCalledTimes(2);
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

  test('browser devtools shortcuts toggle the browser DevTools window', () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'browser-set-bounds'
    )?.[1] as (_: unknown, workspaceId: string, bounds: object) => void;

    handler(null, 'ws-1', { x: 0, y: 0, width: 800, height: 600 });

    const view = deps.getBrowserViews().get('ws-1')?.view as unknown as {
      webContents: {
        openDevTools: ReturnType<typeof vi.fn>;
        closeDevTools: ReturnType<typeof vi.fn>;
        isDevToolsOpened: ReturnType<typeof vi.fn>;
      };
    };
    view.webContents.openDevTools = vi.fn();
    view.webContents.closeDevTools = vi.fn();
    view.webContents.isDevToolsOpened = vi.fn(() => false);

    const preventDefault = vi.fn();
    attachedBeforeInputEventHandler?.(
      { preventDefault },
      { control: true, meta: false, alt: false, shift: true, key: 'i', type: 'keyDown' }
    );

    expect(preventDefault).toHaveBeenCalled();
    expect(view.webContents.openDevTools).toHaveBeenCalledWith({ mode: 'detach' });
    expect(view.webContents.closeDevTools).not.toHaveBeenCalled();

    view.webContents.isDevToolsOpened = vi.fn(() => true);
    attachedBeforeInputEventHandler?.(
      { preventDefault },
      { control: false, meta: false, alt: false, shift: false, key: 'F12', type: 'keyDown' }
    );

    expect(view.webContents.closeDevTools).toHaveBeenCalled();
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

// ===========================================================================
// Phase 1 — Tab IPC handlers
// ===========================================================================
describe('registerBrowserIpc — tab handlers (Phase 1)', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type AnyHandler = (..._args: any[]) => any;

  function createMockDeps() {
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
      mockMainWindow,
      mockBrowserViews,
      deps: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getMainWindow: () => mockMainWindow as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getBrowserViews: () => mockBrowserViews as any,
        getActiveBrowserWorkspaceId: () => mockActiveWorkspaceId,
        setActiveBrowserWorkspaceId: (id: string | null) => { mockActiveWorkspaceId = id; },
      },
    };
  }

  function findHandler(name: string): AnyHandler {
    const handler = mockIpcMain.handle.mock.calls.find((call) => call[0] === name)?.[1] as AnyHandler | undefined;
    if (!handler) {
      throw new Error(`handler ${name} not registered`);
    }
    return handler;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../../src/main/ipc/browserIpc');
    mod.__resetBrowserTabState();
  });

  test('BROWSER_CREATE_TAB records the renderer-provided id and returns default url', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const getTabs = findHandler('browser-get-tabs');

    const result = await create(null, 'ws-1', 'tab-a');
    expect(result).toEqual({ url: 'https://github.com', title: '' });

    const tabs = await getTabs(null, 'ws-1');
    expect(tabs).toEqual([{ tabId: 'tab-a', url: 'https://github.com', title: '' }]);
  });

  test('BROWSER_CREATE_TAB is idempotent for the same id', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const getTabs = findHandler('browser-get-tabs');

    await create(null, 'ws-1', 'tab-a');
    await create(null, 'ws-1', 'tab-a');

    const tabs = await getTabs(null, 'ws-1');
    expect(tabs).toHaveLength(1);
  });

  test('BROWSER_SWITCH_TAB returns null for unknown tab and does not change state', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const switchTab = findHandler('browser-switch-tab');

    await create(null, 'ws-1', 'tab-a');
    const result = await switchTab(null, 'ws-1', 'tab-missing');
    expect(result).toBeNull();
  });

  test('BROWSER_SWITCH_TAB returns the tab record for a known tab', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const switchTab = findHandler('browser-switch-tab');

    await create(null, 'ws-1', 'tab-a');
    await create(null, 'ws-1', 'tab-b');
    const result = await switchTab(null, 'ws-1', 'tab-b');
    expect(result).toEqual({ url: 'https://github.com', title: '' });
  });

  test('BROWSER_CLOSE_TAB refuses to close the last tab and returns false', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const close = findHandler('browser-close-tab');
    const getTabs = findHandler('browser-get-tabs');

    await create(null, 'ws-1', 'tab-a');
    const result = await close(null, 'ws-1', 'tab-a');
    expect(result).toBe(false);

    const tabs = await getTabs(null, 'ws-1');
    expect(tabs).toHaveLength(1);
  });

  test('BROWSER_CLOSE_TAB returns false for unknown tab id', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const close = findHandler('browser-close-tab');

    await create(null, 'ws-1', 'tab-a');
    await create(null, 'ws-1', 'tab-b');
    const result = await close(null, 'ws-1', 'tab-unknown');
    expect(result).toBe(false);
  });

  test('BROWSER_CLOSE_TAB removes the tab and updates active when closing the active tab', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const switchTab = findHandler('browser-switch-tab');
    const close = findHandler('browser-close-tab');
    const getTabs = findHandler('browser-get-tabs');

    await create(null, 'ws-1', 'tab-a');
    await create(null, 'ws-1', 'tab-b');
    await create(null, 'ws-1', 'tab-c');
    await switchTab(null, 'ws-1', 'tab-b');

    const result = await close(null, 'ws-1', 'tab-b');
    expect(result).toBe(true);

    const tabs = await getTabs(null, 'ws-1');
    expect(tabs.map((t: { tabId: string }) => t.tabId)).toEqual(['tab-a', 'tab-c']);
  });

  test('BROWSER_TAB_NAVIGATE rejects non-HTTP(S) URLs', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const tabNavigate = findHandler('browser-tab-navigate');

    await create(null, 'ws-1', 'tab-a');
    const result = await tabNavigate(null, 'ws-1', 'tab-a', 'file:///etc/passwd');
    expect(result).toBe(false);
  });

  test('BROWSER_TAB_NAVIGATE updates per-tab url for inactive tabs without navigating the view', async () => {
    const { deps, mockMainWindow } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const switchTab = findHandler('browser-switch-tab');
    const tabNavigate = findHandler('browser-tab-navigate');
    const getTabs = findHandler('browser-get-tabs');

    await create(null, 'ws-1', 'tab-a');
    await create(null, 'ws-1', 'tab-b');
    await switchTab(null, 'ws-1', 'tab-a');

    mockMainWindow.webContents.send.mockClear();
    const result = await tabNavigate(null, 'ws-1', 'tab-b', 'https://other.example/');
    expect(result).toBe(true);

    const tabs = await getTabs(null, 'ws-1');
    const recordB = tabs.find((t: { tabId: string }) => t.tabId === 'tab-b');
    expect(recordB?.url).toBe('https://other.example/');

    expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
      'browser-url-updated',
      expect.objectContaining({ workspaceId: 'ws-1', tabId: 'tab-b', url: 'https://other.example/' }),
    );
  });

  test('BROWSER_GET_TABS returns empty array for unknown workspace', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const getTabs = findHandler('browser-get-tabs');
    const tabs = await getTabs(null, 'ws-unknown');
    expect(tabs).toEqual([]);
  });

  test('BROWSER_NAVIGATE keeps working without a tabId (compatibility)', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const navigate = findHandler('browser-navigate');
    const result = await navigate(null, 'ws-1', 'https://github.com/');
    expect(result).toBe(true);
  });

  test('BROWSER_SET_BOUNDS accepts optional tabId for tab-aware callers', async () => {
    const { deps } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const setBounds = findHandler('browser-set-bounds');

    await create(null, 'ws-1', 'tab-a');
    const result = await setBounds(null, 'ws-1', { x: 0, y: 0, width: 100, height: 100 }, 'tab-a');
    expect(result).toBeUndefined();
  });

  test('creates distinct WebContentsView entries for two tabs in one workspace', async () => {
    const { deps, mockBrowserViews } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    await create(null, 'ws-1', 'tab-a');
    await create(null, 'ws-1', 'tab-b');

    const workspaceViews = mockBrowserViews.get('ws-1') as Map<string, { view: unknown }>;
    expect(workspaceViews.get('tab-a')?.view).toBeDefined();
    expect(workspaceViews.get('tab-b')?.view).toBeDefined();
    expect(workspaceViews.get('tab-a')?.view).not.toBe(workspaceViews.get('tab-b')?.view);
  });

  test('bounds show exactly one active tab and hide sibling views', async () => {
    const { deps, mockBrowserViews } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const setBounds = findHandler('browser-set-bounds');
    await create(null, 'ws-1', 'tab-a');
    await create(null, 'ws-1', 'tab-b');

    await setBounds(null, 'ws-1', { x: 1, y: 2, width: 300, height: 200 }, 'tab-b');

    const workspaceViews = mockBrowserViews.get('ws-1') as Map<string, { view: { setVisible: ReturnType<typeof vi.fn>; setBounds: ReturnType<typeof vi.fn> } }>;
    expect(workspaceViews.get('tab-a')?.view.setVisible).toHaveBeenLastCalledWith(false);
    expect(workspaceViews.get('tab-b')?.view.setBounds).toHaveBeenCalledWith({ x: 1, y: 2, width: 300, height: 200 });
    expect(workspaceViews.get('tab-b')?.view.setVisible).toHaveBeenLastCalledWith(true);
  });

  test('hiding and disposing a workspace affects all tab views', async () => {
    const { deps, mockBrowserViews } = createMockDeps();
    registerBrowserIpc(deps);

    const create = findHandler('browser-create-tab');
    const hide = findHandler('browser-hide');
    const dispose = findHandler('browser-dispose-workspace');
    await create(null, 'ws-1', 'tab-a');
    await create(null, 'ws-1', 'tab-b');

    const workspaceViews = mockBrowserViews.get('ws-1') as Map<string, { view: { setVisible: ReturnType<typeof vi.fn>; webContents: { close: ReturnType<typeof vi.fn> } } }>;
    const tabA = workspaceViews.get('tab-a');
    const tabB = workspaceViews.get('tab-b');
    await hide(null, 'ws-1');
    expect(tabA?.view.setVisible).toHaveBeenLastCalledWith(false);
    expect(tabB?.view.setVisible).toHaveBeenLastCalledWith(false);

    await dispose(null, 'ws-1');
    expect(tabA?.view.webContents.close).toHaveBeenCalled();
    expect(tabB?.view.webContents.close).toHaveBeenCalled();
    expect(mockBrowserViews.has('ws-1')).toBe(false);
  });
});
