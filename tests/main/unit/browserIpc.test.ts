/**
 * Browser IPC Registration Tests
 *
 * Tests for the browser IPC module, verifying channel registration.
 */

import { vi, describe, test, expect, beforeEach } from 'vitest';

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
    },
    contentView: {
      addChildView: vi.fn(),
    },
  })),
  Menu: Object.assign(vi.fn(), {
    setApplicationMenu: vi.fn(),
  }),
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
  ipcMain: {
    handle: vi.fn(),
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

  test('registers exactly 11 browser IPC channels', () => {
    const { deps } = createMockDeps();

    registerBrowserIpc(deps);

    // Count how many times handle was called
    const handleCalls = mockIpcMain.handle.mock.calls;
    expect(handleCalls.length).toBe(11);
  });

  test('can be called multiple times (registering handlers again)', () => {
    const { deps } = createMockDeps();

    // Register twice
    registerBrowserIpc(deps);
    registerBrowserIpc(deps);

    // Handlers should be registered again
    const handleCalls = mockIpcMain.handle.mock.calls;
    expect(handleCalls.length).toBe(22);
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
