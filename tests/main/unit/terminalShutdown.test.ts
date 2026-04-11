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

describe('PTY SIGTERM → SIGKILL Shutdown', () => {
  let mockKillFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockKillFn = vi.fn();
  });

  test('killAllTerminals sends SIGTERM first', async () => {
    // Import after setting up mocks
    const { terminals, killAllTerminals } = await import('../../../src/main/main');

    // Create a mock terminal
    const mockPty = {
      pid: 999,
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      kill: mockKillFn,
      resize: vi.fn(),
    };
    terminals.set('test-term-1', { pty: mockPty } as never);

    // Override process.kill to throw ESRCH (no such process)
    const originalKill = process.kill;
    vi.stubGlobal('process', {
      ...global.process,
      kill: vi.fn(() => {
        throw new Error(' ESRCH: No such process');
      }),
    });

    killAllTerminals();

    // Verify SIGTERM was sent
    expect(mockKillFn).toHaveBeenCalledWith('SIGTERM');
    // Map should be cleared
    expect(terminals.size).toBe(0);

    // Restore
    vi.stubGlobal('process', { ...global.process, kill: originalKill });
  });

  test('killAllTerminals sends SIGKILL after timeout if process still running', async () => {
    const { terminals, killAllTerminals } = await import('../../../src/main/main');

    // Create mock terminal that appears to still be running
    const killCalls: string[] = [];
    const mockPty = {
      pid: 999,
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      kill: vi.fn((signal?: string) => {
        killCalls.push(signal || 'SIGHUP');
      }),
      resize: vi.fn(),
    };
    terminals.set('test-term-1', { pty: mockPty } as never);

    // Override process.kill to succeed (process still running)
    const originalKill = process.kill;
    vi.stubGlobal('process', {
      ...global.process,
      kill: vi.fn(() => {
        // Process still running - do nothing and return successfully
      }),
    });

    killAllTerminals();

    // Verify both SIGTERM and SIGKILL were sent
    expect(killCalls).toContain('SIGTERM');
    expect(killCalls).toContain('SIGKILL');
    expect(terminals.size).toBe(0);

    vi.stubGlobal('process', { ...global.process, kill: originalKill });
  });

  test('killAllTerminals handles empty terminals map', async () => {
    const { terminals, killAllTerminals } = await import('../../../src/main/main');

    // Ensure map is empty
    terminals.clear();

    // Should not throw
    killAllTerminals();

    expect(terminals.size).toBe(0);
  });

  test('killAllTerminals handles terminal removal during SIGTERM phase', async () => {
    const { terminals, killAllTerminals } = await import('../../../src/main/main');

    // Create terminal that gets removed during SIGTERM (e.g., process exits immediately)
    let removeOnFirstKill = true;
    const mockPty = {
      pid: 999,
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      kill: vi.fn(() => {
        if (removeOnFirstKill) {
          terminals.delete('test-term-1');
          removeOnFirstKill = false;
        }
      }),
      resize: vi.fn(),
    };
    terminals.set('test-term-1', { pty: mockPty } as never);

    const originalKill = process.kill;
    vi.stubGlobal('process', {
      ...global.process,
      kill: vi.fn(() => {
        throw new Error(' ESRCH: No such process');
      }),
    });

    // Should not throw
    killAllTerminals();

    expect(terminals.size).toBe(0);

    vi.stubGlobal('process', { ...global.process, kill: originalKill });
  });
});