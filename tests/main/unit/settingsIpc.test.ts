/**
 * Settings IPC Registration Tests
 *
 * Tests for the settings IPC module, verifying channel registration.
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

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    stdin: { end: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  })),
}));

// Import after mocking
import { ipcMain } from 'electron';
import { registerSettingsIpc } from '../../../src/main/ipc/settingsIpc';

describe('registerSettingsIpc', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  const createMockDeps = () => {
    const mockStore = {
      get: vi.fn((key: string) => {
        const defaults: Record<string, unknown> = {
          lastWorkspace: '/home/test',
          showFastfetch: false,
          aiCommitEnabled: false,
          aiCommitProvider: 'codex',
          aiCommitModel: '',
        };
        return defaults[key];
      }),
      set: vi.fn(),
    };

    const mockMainWindow = {
      webContents: {
        send: vi.fn(),
      },
      minimize: vi.fn(),
      unmaximize: vi.fn(),
      maximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn(() => false),
    };

    const mockGitService = {
      getStatus: vi.fn().mockResolvedValue({ success: true, changes: [] }),
      getCommitPromptContext: vi.fn().mockResolvedValue({
        success: true,
        currentBranch: 'main',
        isDetached: false,
        changes: [],
        diffMode: 'working' as const,
        diffSummary: '',
      }),
    };

    return {
      deps: {
        getStore: () => mockStore as never,
        getMainWindow: () => mockMainWindow as never,
        getGitService: () => mockGitService as never,
      },
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('registers all expected settings IPC channels', () => {
    const { deps } = createMockDeps();

    registerSettingsIpc(deps);

    // Verify all expected channels are registered
    const expectedChannels = [
      'get-last-workspace',
      'get-show-fastfetch',
      'set-show-fastfetch',
      'get-ai-commit-settings',
      'set-ai-commit-enabled',
      'set-ai-commit-provider',
      'set-ai-commit-model',
      'generate-commit-message',
      'open-directory-dialog',
      'read-directory',
      'get-harness-models',
      'get-harness-options',
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

  test('registers exactly 19 settings IPC channels', () => {
    const { deps } = createMockDeps();

    registerSettingsIpc(deps);

    // Count how many times handle was called
    const handleCalls = mockIpcMain.handle.mock.calls;
    expect(handleCalls.length).toBe(19);
  });

  test('can be called multiple times (registering handlers again)', () => {
    const { deps } = createMockDeps();

    // Register twice
    registerSettingsIpc(deps);
    registerSettingsIpc(deps);

    // Handlers should be registered again (may overwrite previous)
    const handleCalls = mockIpcMain.handle.mock.calls;
    expect(handleCalls.length).toBe(38);
  });

  test('settings channels do not overlap with terminal channels', () => {
    const { deps } = createMockDeps();

    registerSettingsIpc(deps);

    const settingsChannels = [
      'get-last-workspace',
      'get-show-fastfetch',
      'set-show-fastfetch',
      'get-ai-commit-settings',
      'set-ai-commit-enabled',
      'set-ai-commit-provider',
      'set-ai-commit-model',
      'generate-commit-message',
      'open-directory-dialog',
      'read-directory',
      'get-harness-models',
      'get-harness-options',
      'minimize-window',
      'toggle-maximize-window',
      'close-window',
      'is-maximized-window',
      'zoom-in-window',
      'zoom-out-window',
      'reset-zoom-window',
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
    const overlap = settingsChannels.filter(ch => terminalChannels.includes(ch));
    expect(overlap.length).toBe(0);
  });

  test('settings channels do not overlap with browser channels', () => {
    const { deps } = createMockDeps();

    registerSettingsIpc(deps);

    const settingsChannels = [
      'get-last-workspace',
      'get-show-fastfetch',
      'set-show-fastfetch',
      'get-ai-commit-settings',
      'set-ai-commit-enabled',
      'set-ai-commit-provider',
      'set-ai-commit-model',
      'generate-commit-message',
      'open-directory-dialog',
      'read-directory',
      'get-harness-models',
      'get-harness-options',
      'minimize-window',
      'toggle-maximize-window',
      'close-window',
      'is-maximized-window',
      'zoom-in-window',
      'zoom-out-window',
      'reset-zoom-window',
    ];

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

    // Verify no overlap
    const overlap = settingsChannels.filter(ch => browserChannels.includes(ch));
    expect(overlap.length).toBe(0);
  });
});

describe('settings IPC channel constants', () => {
  test('settings channel names are consistent', () => {
    const expectedChannels = [
      'get-last-workspace',
      'get-show-fastfetch',
      'set-show-fastfetch',
      'get-ai-commit-settings',
      'set-ai-commit-enabled',
      'set-ai-commit-provider',
      'set-ai-commit-model',
      'generate-commit-message',
      'open-directory-dialog',
      'read-directory',
      'get-harness-models',
      'get-harness-options',
      'minimize-window',
      'toggle-maximize-window',
      'close-window',
      'is-maximized-window',
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

  test('all settings channels start with expected prefixes', () => {
    const settingsChannels = [
      'get-last-workspace',
      'get-show-fastfetch',
      'set-show-fastfetch',
      'get-ai-commit-settings',
      'set-ai-commit-enabled',
      'set-ai-commit-provider',
      'set-ai-commit-model',
      'generate-commit-message',
      'open-directory-dialog',
      'read-directory',
      'get-harness-models',
      'get-harness-options',
      'minimize-window',
      'toggle-maximize-window',
      'close-window',
      'is-maximized-window',
    ];

    // These channels should all be settings-related or window-related
    const expectedPrefixes = ['get-', 'set-', 'generate-', 'open-', 'read-', 'minimize-', 'toggle-', 'close-', 'is-'];
    settingsChannels.forEach(channel => {
      const hasExpectedPrefix = expectedPrefixes.some(prefix => channel.startsWith(prefix));
      expect(hasExpectedPrefix).toBe(true);
    });
  });
});
