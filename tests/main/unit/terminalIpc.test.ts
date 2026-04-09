/**
 * Terminal IPC Registration Tests
 *
 * Tests for the terminal IPC module, verifying channel registration.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

// vi.hoisted() allows sharing mock references between the vi.mock factory
// and test code without hoisting conflicts.
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

import { registerTerminalIpc } from '../../../src/main/ipc/terminalIpc';

describe('registerTerminalIpc', () => {
  beforeEach(() => {
    mockHandle.mockClear();
    mockOn.mockClear();
  });

  test('registers all expected terminal IPC channels', () => {
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

  test('registers exactly 6 terminal IPC handle channels', () => {
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

    expect(mockHandle.mock.calls.length).toBe(6);
  });

  test('registers 2 event IPC channels (terminal-data, terminal-exit)', () => {
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

    expect(mockOn.mock.calls.length).toBe(2);
    expect(mockOn.mock.calls.map((c: unknown[]) => c[0])).toContain('terminal-data');
    expect(mockOn.mock.calls.map((c: unknown[]) => c[0])).toContain('terminal-exit');
  });

  test('can be called multiple times (registering handlers again)', () => {
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

    registerTerminalIpc({
      getTerminals: () => mockTerminals,
      getMainWindow: () => mockMainWindow as never,
      getStore: () => mockStore as never,
      getSafeWorkspacePath: mockGetSafeWorkspacePath,
      getHarnessOptions: mockGetHarnessOptions,
    });

    expect(mockHandle.mock.calls.length).toBe(12);
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
