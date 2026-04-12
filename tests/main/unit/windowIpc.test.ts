/**
 * Window IPC Registration Tests
 *
 * Tests for the window IPC module, verifying channel registration.
 */

import { vi, describe, test, expect, beforeEach } from 'vitest';

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
      setZoomLevel: vi.fn(),
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

import { ipcMain } from 'electron';
import { registerWindowIpc, clampZoomLevel } from '../../../src/main/ipc/windowIpc';

describe('registerWindowIpc', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  const createMockDeps = () => {
    const mockMainWindow = {
      webContents: {
        send: vi.fn(),
        getZoomLevel: vi.fn(() => 0),
        setZoomLevel: vi.fn(),
      },
      minimize: vi.fn(),
      unmaximize: vi.fn(),
      maximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn(() => false),
    };
    const mockBrowserView = {
      webContents: {
        getZoomLevel: vi.fn(() => 1.5),
        setZoomLevel: vi.fn(),
      },
    };
    const mockBrowserViews = new Map<string, { view: typeof mockBrowserView }>([
      ['browser-1', { view: mockBrowserView }],
    ]);

    return {
      deps: {
        getMainWindow: () => mockMainWindow as never,
        getBrowserViews: () => mockBrowserViews as never,
      },
      mockMainWindow,
      mockBrowserView,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('registers all expected window IPC channels', () => {
    const { deps } = createMockDeps();

    registerWindowIpc(deps);

    const expectedChannels = [
      'minimize-window',
      'toggle-maximize-window',
      'close-window',
      'is-maximized-window',
      'zoom-in-window',
      'zoom-out-window',
      'reset-zoom-window',
    ];

    expectedChannels.forEach(channel => {
      expect(mockIpcMain.handle).toHaveBeenCalledWith(channel, expect.any(Function));
    });
  });

  test('registers exactly 7 window IPC channels', () => {
    const { deps } = createMockDeps();

    registerWindowIpc(deps);

    const handleCalls = mockIpcMain.handle.mock.calls;
    expect(handleCalls.length).toBe(7);
  });

  test('can be called multiple times (registering handlers again)', () => {
    const { deps } = createMockDeps();

    registerWindowIpc(deps);
    registerWindowIpc(deps);

    const handleCalls = mockIpcMain.handle.mock.calls;
    expect(handleCalls.length).toBe(14);
  });

  test('window channels do not overlap with settings channels', () => {
    const { deps } = createMockDeps();

    registerWindowIpc(deps);

    const windowChannels = [
      'minimize-window',
      'toggle-maximize-window',
      'close-window',
      'is-maximized-window',
      'zoom-in-window',
      'zoom-out-window',
      'reset-zoom-window',
    ];

    const settingsChannels = [
      'get-last-workspace',
      'get-show-fastfetch',
      'set-show-fastfetch',
      'get-ai-commit-settings',
      'set-ai-commit-enabled',
      'set-ai-commit-provider',
      'set-ai-commit-model',
    ];

    const overlap = windowChannels.filter(ch => settingsChannels.includes(ch));
    expect(overlap.length).toBe(0);
  });
});

describe('registerWindowIpc — error-path: null main window', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  const createMockDepsWithNullWindow = () => {
    return {
      deps: {
        getMainWindow: () => null,
      },
    };
  };

  const createMockDeps = () => {
    const mockMainWindow = {
      webContents: {
        send: vi.fn(),
        getZoomLevel: vi.fn(() => 0),
        setZoomLevel: vi.fn(),
      },
      minimize: vi.fn(),
      unmaximize: vi.fn(),
      maximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn(() => false),
    };
    const mockBrowserView = {
      webContents: {
        getZoomLevel: vi.fn(() => 1.5),
        setZoomLevel: vi.fn(),
      },
    };
    const mockBrowserViews = new Map<string, { view: typeof mockBrowserView }>([
      ['browser-1', { view: mockBrowserView }],
    ]);

    return {
      deps: {
        getMainWindow: () => mockMainWindow as never,
        getBrowserViews: () => mockBrowserViews as never,
      },
      mockMainWindow,
      mockBrowserView,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('MINIMIZE_WINDOW is a no-op when mainWindow is null', () => {
    const { deps } = createMockDepsWithNullWindow();
    registerWindowIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'minimize-window'
    )?.[1] as () => void;

    const result = handler();
    expect(result).toBeUndefined();
  });

  test('TOGGLE_MAXIMIZE_WINDOW is a no-op when mainWindow is null', () => {
    const { deps } = createMockDepsWithNullWindow();
    registerWindowIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'toggle-maximize-window'
    )?.[1] as () => void;

    const result = handler();
    expect(result).toBeUndefined();
  });

  test('CLOSE_WINDOW is a no-op when mainWindow is null', () => {
    const { deps } = createMockDepsWithNullWindow();
    registerWindowIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'close-window'
    )?.[1] as () => void;

    const result = handler();
    expect(result).toBeUndefined();
  });

  test('IS_MAXIMIZED_WINDOW returns false when mainWindow is null', () => {
    const { deps } = createMockDepsWithNullWindow();
    registerWindowIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'is-maximized-window'
    )?.[1] as () => boolean;

    const result = handler();
    expect(result).toBe(false);
  });

  test('ZOOM_IN_WINDOW is a no-op when mainWindow is null', () => {
    const { deps } = createMockDepsWithNullWindow();
    registerWindowIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'zoom-in-window'
    )?.[1] as () => void;

    const result = handler();
    expect(result).toBeUndefined();
  });

  test('ZOOM_OUT_WINDOW is a no-op when mainWindow is null', () => {
    const { deps } = createMockDepsWithNullWindow();
    registerWindowIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'zoom-out-window'
    )?.[1] as () => void;

    const result = handler();
    expect(result).toBeUndefined();
  });

  test('RESET_ZOOM_WINDOW is a no-op when mainWindow is null', () => {
    const { deps } = createMockDepsWithNullWindow();
    registerWindowIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'reset-zoom-window'
    )?.[1] as () => void;

    const result = handler();
    expect(result).toBeUndefined();
  });

  test('ZOOM_IN_WINDOW propagates zoom delta to browser views', () => {
    const { deps, mockBrowserView, mockMainWindow } = createMockDeps();
    registerWindowIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'zoom-in-window'
    )?.[1] as () => void;

    handler();

    expect(mockMainWindow.webContents.setZoomLevel).toHaveBeenCalledWith(0.5);
    expect(mockBrowserView.webContents.setZoomLevel).toHaveBeenCalledWith(2);
  });

  test('RESET_ZOOM_WINDOW preserves browser view page zoom offset', () => {
    const { deps, mockBrowserView, mockMainWindow } = createMockDeps();
    mockMainWindow.webContents.getZoomLevel = vi.fn(() => 1.5);
    mockMainWindow.webContents.setZoomLevel = vi.fn();
    mockBrowserView.webContents.getZoomLevel = vi.fn(() => 3);
    mockBrowserView.webContents.setZoomLevel = vi.fn();

    registerWindowIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'reset-zoom-window'
    )?.[1] as () => void;

    handler();

    expect(mockMainWindow.webContents.setZoomLevel).toHaveBeenCalledWith(0);
    expect(mockBrowserView.webContents.setZoomLevel).toHaveBeenCalledWith(1.5);
  });
});

describe('window IPC helpers', () => {
  test('clampZoomLevel constrains zoom level between -5 and 5', () => {
    expect(clampZoomLevel(-10)).toBe(-5);
    expect(clampZoomLevel(-5)).toBe(-5);
    expect(clampZoomLevel(0)).toBe(0);
    expect(clampZoomLevel(5)).toBe(5);
    expect(clampZoomLevel(10)).toBe(5);
  });
});
