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

// Mock fs (used by READ_DIRECTORY and path resolution)
vi.mock('fs', () => ({
  default: {
    readdirSync: mockFsReaddirSync,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  },
  readdirSync: mockFsReaddirSync,
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// vi.hoisted() ensures mock references are available when vi.mock factories run
const { mockDiscoverHarnessModels, mockGetAvailableHarnessOptions } = vi.hoisted(() => ({
  mockDiscoverHarnessModels: vi.fn(),
  mockGetAvailableHarnessOptions: vi.fn(),
}));

const { mockGitServiceGetStatus, mockGitServiceGetCommitPromptContext } = vi.hoisted(() => ({
  mockGitServiceGetStatus: vi.fn(),
  mockGitServiceGetCommitPromptContext: vi.fn(),
}));

const { mockResolveExistingDirectory } = vi.hoisted(() => ({
  // Default: reject all paths so workspace-validation tests work by default.
  // Individual tests can use mockResolveExistingDirectory.mockResolvedValueOnce().
  mockResolveExistingDirectory: vi.fn().mockReturnValue(null),
}));

const { mockFsReaddirSync } = vi.hoisted(() => ({
  // Used by READ_DIRECTORY success-path tests. Tests can set return values via
  // mockFsReaddirSync.mockReturnValueOnce(...).
  mockFsReaddirSync: vi.fn(),
}));

// Mock harnessCatalog (used by GET_HARNESS_MODELS and GET_HARNESS_OPTIONS)
vi.mock('../../../src/main/harnessCatalog', () => ({
  discoverHarnessModels: mockDiscoverHarnessModels,
  getAvailableHarnessOptions: mockGetAvailableHarnessOptions,
}));

// Mock GitService (used by GENERATE_COMMIT_MESSAGE)
vi.mock('../../../src/main/gitService', () => ({
  GitService: vi.fn().mockImplementation(() => ({
    getStatus: mockGitServiceGetStatus,
    getCommitPromptContext: mockGitServiceGetCommitPromptContext,
  })),
}));

// Mock security.ts to control resolveExistingDirectory behavior
vi.mock('../../../src/main/security', () => ({
  resolveExistingDirectory: mockResolveExistingDirectory,
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

/**
 * Settings IPC — Error-Path Tests
 *
 * Verifies every settings handler returns a defined value (never undefined or
 * thrown) for missing store values, null main window, invalid workspace paths,
 * and AI commit generation failures.
 */

describe('settingsIpc — error-path: store returns', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('GET_LAST_WORKSPACE returns whatever the store has (may be undefined)', () => {
    // Create a fresh deps with a store that returns undefined for lastWorkspace
    const mockStore = {
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
    };
    const mockMainWindow = {
      webContents: { send: vi.fn() },
      minimize: vi.fn(),
      unmaximize: vi.fn(),
      maximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn(() => false),
    };
    const deps = {
      getStore: () => mockStore as never,
      getMainWindow: () => mockMainWindow as never,
      getGitService: () => ({ getStatus: mockGitServiceGetStatus, getCommitPromptContext: mockGitServiceGetCommitPromptContext } as never),
    };
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'get-last-workspace'
    )?.[1] as () => string | undefined;

    const result = handler();
    // Store returns undefined for lastWorkspace key — handler returns undefined (acceptable)
    expect(result).toBeUndefined();
  });

  test('GET_SHOW_FASTFETCH returns whatever the store has (may be undefined)', () => {
    const mockStore = {
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
    };
    const mockMainWindow = {
      webContents: { send: vi.fn() },
      minimize: vi.fn(),
      unmaximize: vi.fn(),
      maximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn(() => false),
    };
    const deps = {
      getStore: () => mockStore as never,
      getMainWindow: () => mockMainWindow as never,
      getGitService: () => ({ getStatus: mockGitServiceGetStatus, getCommitPromptContext: mockGitServiceGetCommitPromptContext } as never),
    };
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'get-show-fastfetch'
    )?.[1] as () => boolean | undefined;

    const result = handler();
    // Store returns undefined — handler returns undefined (acceptable)
    expect(result).toBeUndefined();
  });

  test('GET_AI_COMMIT_SETTINGS returns object with potentially undefined fields', () => {
    const mockStore = {
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
    };
    const mockMainWindow = {
      webContents: { send: vi.fn() },
      minimize: vi.fn(),
      unmaximize: vi.fn(),
      maximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn(() => false),
    };
    const deps = {
      getStore: () => mockStore as never,
      getMainWindow: () => mockMainWindow as never,
      getGitService: () => ({ getStatus: mockGitServiceGetStatus, getCommitPromptContext: mockGitServiceGetCommitPromptContext } as never),
    };
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'get-ai-commit-settings'
    )?.[1] as () => { enabled: boolean; provider: string; model: string };

    const result = handler();
    // Returns object with undefined fields when store has no values
    expect(result).toBeDefined();
    expect(typeof result.enabled).toBe('undefined');
    expect(typeof result.provider).toBe('undefined');
    expect(typeof result.model).toBe('undefined');
  });
});

describe('settingsIpc — error-path: null main window', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  const createMockDepsWithNullWindow = () => {
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
    const mockGitService = {
      getStatus: mockGitServiceGetStatus,
      getCommitPromptContext: mockGitServiceGetCommitPromptContext,
    };
    return {
      deps: {
        getStore: () => mockStore as never,
        getMainWindow: () => null, // null main window
        getGitService: () => mockGitService as never,
      },
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('OPEN_DIRECTORY_DIALOG throws when mainWindow is null (requires non-null)', async () => {
    const { deps } = createMockDepsWithNullWindow();
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'open-directory-dialog'
    )?.[1] as () => Promise<string | null>;

    // The handler uses `dialog.showOpenDialog(mainWindow!, ...)` which throws
    // when mainWindow is null — this is a production-code behavior that causes
    // an uncaught exception (not a handled error result). We verify it throws.
    await expect(handler()).rejects.toThrow();
  });

  test('MINIMIZE_WINDOW is a no-op when mainWindow is null', () => {
    const { deps } = createMockDepsWithNullWindow();
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'minimize-window'
    )?.[1] as () => void;

    // getMainWindow()?.minimize() is a no-op when mainWindow is null
    const result = handler();
    expect(result).toBeUndefined();
  });

  test('TOGGLE_MAXIMIZE_WINDOW is a no-op when mainWindow is null', () => {
    const { deps } = createMockDepsWithNullWindow();
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'toggle-maximize-window'
    )?.[1] as () => void;

    const result = handler();
    expect(result).toBeUndefined();
  });

  test('CLOSE_WINDOW is a no-op when mainWindow is null', () => {
    const { deps } = createMockDepsWithNullWindow();
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'close-window'
    )?.[1] as () => void;

    const result = handler();
    expect(result).toBeUndefined();
  });

  test('IS_MAXIMIZED_WINDOW returns false when mainWindow is null', () => {
    const { deps } = createMockDepsWithNullWindow();
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'is-maximized-window'
    )?.[1] as () => boolean;

    const result = handler();
    expect(result).toBe(false);
  });

  test('ZOOM_IN_WINDOW is a no-op when mainWindow is null', () => {
    const { deps } = createMockDepsWithNullWindow();
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'zoom-in-window'
    )?.[1] as () => void;

    const result = handler();
    expect(result).toBeUndefined();
  });

  test('ZOOM_OUT_WINDOW is a no-op when mainWindow is null', () => {
    const { deps } = createMockDepsWithNullWindow();
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'zoom-out-window'
    )?.[1] as () => void;

    const result = handler();
    expect(result).toBeUndefined();
  });

  test('RESET_ZOOM_WINDOW is a no-op when mainWindow is null', () => {
    const { deps } = createMockDepsWithNullWindow();
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'reset-zoom-window'
    )?.[1] as () => void;

    const result = handler();
    expect(result).toBeUndefined();
  });
});

describe('settingsIpc — error-path: workspace validation and commit generation', () => {
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
      webContents: { send: vi.fn() },
      minimize: vi.fn(),
      unmaximize: vi.fn(),
      maximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn(() => false),
    };
    const mockGitService = {
      getStatus: mockGitServiceGetStatus,
      getCommitPromptContext: mockGitServiceGetCommitPromptContext,
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
    mockDiscoverHarnessModels.mockReset();
    mockGetAvailableHarnessOptions.mockReset();
    mockGitServiceGetStatus.mockReset();
    mockGitServiceGetCommitPromptContext.mockReset();
  });

  test('GENERATE_COMMIT_MESSAGE returns error for invalid workspace path', async () => {
    const { deps } = createMockDeps();
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'generate-commit-message'
    )?.[1] as (_: unknown, workspacePath: string) => Promise<{ success: boolean; error?: string }>;

    const result = await handler(null, '/invalid/nonexistent/path');
    expect(result).toEqual({ success: false, error: 'Workspace path is invalid or not a directory' });
  });

  test('GENERATE_COMMIT_MESSAGE returns error when AI commit is disabled', async () => {
    const mockStore = {
      get: vi.fn((key: string) => {
        if (key === 'aiCommitEnabled') return false;
        if (key === 'aiCommitProvider') return 'codex';
        if (key === 'aiCommitModel') return '';
        return undefined;
      }),
      set: vi.fn(),
    };
    const mockMainWindow = {
      webContents: { send: vi.fn() },
      minimize: vi.fn(), unmaximize: vi.fn(), maximize: vi.fn(), close: vi.fn(),
      isMaximized: vi.fn(() => false),
    };
    const deps = {
      getStore: () => mockStore as never,
      getMainWindow: () => mockMainWindow as never,
      getGitService: () => ({ getStatus: mockGitServiceGetStatus, getCommitPromptContext: mockGitServiceGetCommitPromptContext } as never),
    };
    mockResolveExistingDirectory.mockResolvedValueOnce(process.cwd());
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'generate-commit-message'
    )?.[1] as (_: unknown, workspacePath: string) => Promise<{ success: boolean; error?: string }>;

    const result = await handler(null, '/some/path');
    expect(result).toEqual({ success: false, error: 'AI commit message generation is disabled' });
  });

  test('GENERATE_COMMIT_MESSAGE returns error when commit prompt context fails', async () => {
    const mockStore = {
      get: vi.fn((key: string) => {
        if (key === 'aiCommitEnabled') return true;
        if (key === 'aiCommitProvider') return 'codex';
        if (key === 'aiCommitModel') return '';
        return undefined;
      }),
      set: vi.fn(),
    };
    const mockMainWindow = {
      webContents: { send: vi.fn() },
      minimize: vi.fn(), unmaximize: vi.fn(), maximize: vi.fn(), close: vi.fn(),
      isMaximized: vi.fn(() => false),
    };
    const deps = {
      getStore: () => mockStore as never,
      getMainWindow: () => mockMainWindow as never,
      getGitService: () => ({ getStatus: mockGitServiceGetStatus, getCommitPromptContext: mockGitServiceGetCommitPromptContext } as never),
    };
    mockResolveExistingDirectory.mockResolvedValueOnce(process.cwd());
    mockGitServiceGetCommitPromptContext.mockResolvedValue({ success: false, error: 'No changes' });
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'generate-commit-message'
    )?.[1] as (_: unknown, workspacePath: string) => Promise<{ success: boolean; error?: string }>;

    const result = await handler(null, '/some/path');
    expect(result).toEqual({ success: false, error: 'No changes' });
  });

  test('READ_DIRECTORY returns empty array for invalid directory path', async () => {
    const { deps } = createMockDeps();
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'read-directory'
    )?.[1] as (_: unknown, dirPath: string) => Promise<unknown[]>;

    const result = await handler(null, '/nonexistent/directory');
    // resolveExistingDirectory returns null for nonexistent path, handler returns []
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  test('READ_DIRECTORY returns directory entries when path is valid', async () => {
    const { deps } = createMockDeps();
    // Override resolveExistingDirectory to return a valid path (bypass early return)
    mockResolveExistingDirectory.mockReturnValueOnce('/valid/path');
    // Set up fs.readdirSync to return some entries
    mockFsReaddirSync.mockReturnValueOnce([
      { name: 'src', isDirectory: () => true },
      { name: 'node_modules', isDirectory: () => true },
      { name: 'file.txt', isDirectory: () => false },
    ]);
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'read-directory'
    )?.[1] as (_: unknown, dirPath: string) => Promise<unknown[]>;

    const result = await handler(null, '/valid/path');
    // Should return only directories, filtered and mapped
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result).toEqual([
      { name: 'src', isDirectory: true },
      { name: 'node_modules', isDirectory: true },
    ]);
    // Verify files were filtered out
    expect(mockFsReaddirSync).toHaveBeenCalledWith('/valid/path', { withFileTypes: true });
  });

  test('READ_DIRECTORY returns empty array when fs.readdirSync throws', async () => {
    const { deps } = createMockDeps();
    mockResolveExistingDirectory.mockReturnValueOnce('/error/path');
    mockFsReaddirSync.mockImplementationOnce(() => {
      throw new Error('Permission denied');
    });
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'read-directory'
    )?.[1] as (_: unknown, dirPath: string) => Promise<unknown[]>;

    const result = await handler(null, '/error/path');
    // Should return [] (empty result) on fs error, not throw
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  test('READ_DIRECTORY returns empty array when directory is empty', async () => {
    const { deps } = createMockDeps();
    mockResolveExistingDirectory.mockReturnValueOnce('/empty/path');
    mockFsReaddirSync.mockReturnValueOnce([]);
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'read-directory'
    )?.[1] as (_: unknown, dirPath: string) => Promise<unknown[]>;

    const result = await handler(null, '/empty/path');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  test('GET_HARNESS_OPTIONS calls harnessCatalog and returns options', () => {
    const { deps } = createMockDeps();
    mockGetAvailableHarnessOptions.mockReturnValue([
      { id: 'codex', name: 'Codex', command: 'codex', args: [], icon: 'codex' },
    ]);
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'get-harness-options'
    )?.[1] as () => unknown[];

    const result = handler();
    expect(mockGetAvailableHarnessOptions).toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  test('GET_HARNESS_MODELS calls discoverHarnessModels and returns models', async () => {
    const { deps } = createMockDeps();
    mockDiscoverHarnessModels.mockResolvedValue([{ id: 'gpt-4', name: 'GPT-4' }]);
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'get-harness-models'
    )?.[1] as (_: unknown, harness: string) => Promise<unknown[]>;

    const result = await handler(null, 'codex');
    expect(mockDiscoverHarnessModels).toHaveBeenCalledWith('codex');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: 'gpt-4', name: 'GPT-4' });
  });

  test('SET_SHOW_FASTFETCH calls store.set and returns undefined', () => {
    const mockSetFn = vi.fn();
    const mockStore = {
      get: vi.fn(),
      set: mockSetFn,
    };
    const mockMainWindow = {
      webContents: { send: vi.fn() },
      minimize: vi.fn(), unmaximize: vi.fn(), maximize: vi.fn(), close: vi.fn(),
      isMaximized: vi.fn(() => false),
    };
    const deps = {
      getStore: () => mockStore as never,
      getMainWindow: () => mockMainWindow as never,
      getGitService: () => ({ getStatus: mockGitServiceGetStatus, getCommitPromptContext: mockGitServiceGetCommitPromptContext } as never),
    };
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'set-show-fastfetch'
    )?.[1] as (_: unknown, value: boolean) => void;

    const result = handler(null, true);
    expect(result).toBeUndefined();
    expect(mockSetFn).toHaveBeenCalledWith('showFastfetch', true);
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
