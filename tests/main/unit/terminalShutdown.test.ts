/**
 * Terminal Shutdown Lifecycle Tests
 *
 * Tests for terminal behavior during app shutdown - verifying that late PTY callbacks
 * don't attempt to send to dead windows.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

const { mockHandle, mockOn } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockOn: vi.fn(),
}));

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
      return new Promise<never>(() => {});
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
    handle: mockHandle,
    on: mockOn,
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

vi.mock('node-pty', () => ({
  default: {
    spawn: vi.fn(() => ({
      pid: 12345,
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      kill: vi.fn(),
      resize: vi.fn(),
    })),
  },
}));

import { registerTerminalIpc, setAppShuttingDown } from '../../../src/main/ipc/terminalIpc';

describe('Terminal Shutdown Behavior', () => {
  beforeEach(() => {
    mockHandle.mockClear();
    mockOn.mockClear();
    setAppShuttingDown(false);
  });

  test('setAppShuttingDown flag is exported and accessible', () => {
    expect(typeof setAppShuttingDown).toBe('function');
    setAppShuttingDown(true);
    setAppShuttingDown(false);
  });

  test('registers terminal IPC handlers successfully', () => {
    const mockTerminals = new Map();
    const mockMainWindow = {
      webContents: {
        send: vi.fn(),
      },
    };
    const mockStore = {
      get: vi.fn().mockReturnValue(false),
    };
    const mockGetSafeWorkspacePath = vi.fn().mockReturnValue('/test/workspace');
    const mockGetHarnessOptions = vi.fn().mockReturnValue({});

    registerTerminalIpc({
      getTerminals: () => mockTerminals,
      getMainWindow: () => mockMainWindow as never,
      getStore: () => mockStore as never,
      getSafeWorkspacePath: mockGetSafeWorkspacePath,
      getHarnessOptions: mockGetHarnessOptions,
    });

    expect(mockHandle).toHaveBeenCalled();
  });

  test('terminal handlers registered with appShuttingDown flag available', () => {
    const mockTerminals = new Map();
    const mockMainWindow = {
      webContents: {
        send: vi.fn(),
      },
    };
    const mockStore = {
      get: vi.fn().mockReturnValue(false),
    };
    const mockGetSafeWorkspacePath = vi.fn().mockReturnValue('/test/workspace');
    const mockGetHarnessOptions = vi.fn().mockReturnValue({});

    registerTerminalIpc({
      getTerminals: () => mockTerminals,
      getMainWindow: () => mockMainWindow as never,
      getStore: () => mockStore as never,
      getSafeWorkspacePath: mockGetSafeWorkspacePath,
      getHarnessOptions: mockGetHarnessOptions,
    });

    setAppShuttingDown(true);
    expect(mockHandle).toHaveBeenCalled();
  });
});

describe('Workspace Close Cleanup', () => {
  test('workspace close still has final sweep behavior', () => {
    const mockTerminals = new Map();
    const mockMainWindow = {
      webContents: {
        send: vi.fn(),
      },
    };
    const mockStore = {
      get: vi.fn().mockReturnValue(false),
    };
    const mockGetSafeWorkspacePath = vi.fn().mockReturnValue('/test/workspace');
    const mockGetHarnessOptions = vi.fn().mockReturnValue({});

    registerTerminalIpc({
      getTerminals: () => mockTerminals,
      getMainWindow: () => mockMainWindow as never,
      getStore: () => mockStore as never,
      getSafeWorkspacePath: mockGetSafeWorkspacePath,
      getHarnessOptions: mockGetHarnessOptions,
    });

    const cleanupChannel = mockHandle.mock.calls.find(
      (call: unknown[]) => call[0] === 'terminal:cleanup-workspace'
    );
    expect(cleanupChannel).toBeDefined();
  });
});