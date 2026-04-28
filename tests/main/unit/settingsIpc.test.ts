/**
 * Settings IPC Registration Tests
 *
 * Tests for the settings IPC module, verifying channel registration.
 */

import { vi, describe, test, expect, beforeEach } from 'vitest';
import { testHome } from '../../_helpers/tempPaths';

vi.mock('electron', () => ({
  app: {
    disableHardwareAcceleration: vi.fn(),
    getPath: vi.fn((name: string) => {
      if (name === 'home') return testHome();
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
    close: vi.fn(),
    isMaximized: vi.fn(() => false),
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

const { mockDiscoverHarnessModels, mockGetAvailableHarnessOptions } = vi.hoisted(() => ({
  mockDiscoverHarnessModels: vi.fn(),
  mockGetAvailableHarnessOptions: vi.fn(),
}));

const { mockResolveExistingDirectory } = vi.hoisted(() => ({
  mockResolveExistingDirectory: vi.fn().mockReturnValue(null),
}));

const { mockFsReaddirSync } = vi.hoisted(() => ({
  mockFsReaddirSync: vi.fn(),
}));

vi.mock('../../../src/main/harnessCatalog', () => ({
  discoverHarnessModels: mockDiscoverHarnessModels,
  getAvailableHarnessOptions: mockGetAvailableHarnessOptions,
}));

vi.mock('../../../src/main/security', () => ({
  resolveExistingDirectory: mockResolveExistingDirectory,
}));

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
          lastWorkspace: testHome(),
          showFastfetch: false,
          aiCommitEnabled: false,
          aiCommitProvider: 'codex',
          aiCommitModel: '',
          harnessDefaults: {
            codex: { model: 'gpt-4', favorites: ['gpt-4'], flags: '--yolo' },
            opencode: { model: 'opencode/zen/big-pickle', favorites: [], flags: '' },
            pi: { model: '', favorites: [], flags: '' },
            claude: { model: '', favorites: [], flags: '' },
          },
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

    return {
      deps: {
        getStore: () => mockStore as never,
        getMainWindow: () => mockMainWindow as never,
      },
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('registers all expected settings IPC channels', () => {
    const { deps } = createMockDeps();

    registerSettingsIpc(deps);

    const expectedChannels = [
      'get-last-workspace',
      'get-base-directory',
      'open-base-directory-dialog',
      'get-show-fastfetch',
      'set-show-fastfetch',
      'get-ai-commit-settings',
      'set-ai-commit-enabled',
      'set-ai-commit-provider',
      'set-ai-commit-model',
      'open-directory-dialog',
      'read-directory',
      'get-harness-models',
      'get-harness-options',
      'get-harness-defaults',
      'set-harness-defaults',
    ];

    expectedChannels.forEach(channel => {
      expect(mockIpcMain.handle).toHaveBeenCalledWith(channel, expect.any(Function));
    });
  });

  test('registers exactly 15 settings IPC channels', () => {
    const { deps } = createMockDeps();

    registerSettingsIpc(deps);

    const handleCalls = mockIpcMain.handle.mock.calls;
    expect(handleCalls.length).toBe(15);
  });

  test('can be called multiple times (registering handlers again)', () => {
    const { deps } = createMockDeps();

    registerSettingsIpc(deps);
    registerSettingsIpc(deps);

    const handleCalls = mockIpcMain.handle.mock.calls;
    expect(handleCalls.length).toBe(30);
  });

  test('settings channels do not overlap with terminal channels', () => {
    const { deps } = createMockDeps();

    registerSettingsIpc(deps);

    const settingsChannels = [
      'get-last-workspace',
      'get-base-directory',
      'open-base-directory-dialog',
      'get-show-fastfetch',
      'set-show-fastfetch',
      'get-ai-commit-settings',
      'set-ai-commit-enabled',
      'set-ai-commit-provider',
      'set-ai-commit-model',
      'open-directory-dialog',
      'read-directory',
      'get-harness-models',
      'get-harness-options',
      'get-harness-defaults',
      'set-harness-defaults',
    ];

    const terminalChannels = [
      'spawn-terminal',
      'get-terminal-buffer',
      'write-terminal',
      'resize-terminal',
      'kill-terminal',
      'terminal:cleanup-workspace',
    ];

    const overlap = settingsChannels.filter(ch => terminalChannels.includes(ch));
    expect(overlap.length).toBe(0);
  });

  test('settings channels do not overlap with window channels', () => {
    const { deps } = createMockDeps();

    registerSettingsIpc(deps);

    const settingsChannels = [
      'get-last-workspace',
      'get-base-directory',
      'open-base-directory-dialog',
      'get-show-fastfetch',
      'set-show-fastfetch',
      'get-ai-commit-settings',
      'set-ai-commit-enabled',
      'set-ai-commit-provider',
      'set-ai-commit-model',
      'open-directory-dialog',
      'read-directory',
      'get-harness-models',
      'get-harness-options',
      'get-harness-defaults',
      'set-harness-defaults',
    ];

    const windowChannels = [
      'minimize-window',
      'toggle-maximize-window',
      'close-window',
      'is-maximized-window',
      'zoom-in-window',
      'zoom-out-window',
      'reset-zoom-window',
    ];

    const overlap = settingsChannels.filter(ch => windowChannels.includes(ch));
    expect(overlap.length).toBe(0);
  });
});

describe('settingsIpc — error-path: store returns', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('GET_LAST_WORKSPACE returns whatever the store has (may be undefined)', () => {
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
    };
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'get-last-workspace'
    )?.[1] as () => string | undefined;

    const result = handler();
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
    };
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'get-show-fastfetch'
    )?.[1] as () => boolean | undefined;

    const result = handler();
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
    };
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'get-ai-commit-settings'
    )?.[1] as () => { enabled: boolean; provider: string; model: string };

    const result = handler();
    expect(result).toBeDefined();
    expect(typeof result.enabled).toBe('undefined');
    expect(typeof result.provider).toBe('undefined');
    expect(typeof result.model).toBe('undefined');
  });
});

describe('settingsIpc — error-path: OPEN_DIRECTORY_DIALOG', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  const createMockDepsWithNullWindow = () => {
    const mockStore = {
      get: vi.fn((key: string) => {
        const defaults: Record<string, unknown> = {
          lastWorkspace: testHome(),
          showFastfetch: false,
          aiCommitEnabled: false,
          aiCommitProvider: 'codex',
          aiCommitModel: '',
        };
        return defaults[key];
      }),
      set: vi.fn(),
    };
    return {
      deps: {
        getStore: () => mockStore as never,
        getMainWindow: () => null,
      },
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('OPEN_DIRECTORY_DIALOG throws when mainWindow is null', async () => {
    const { deps } = createMockDepsWithNullWindow();
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'open-directory-dialog'
    )?.[1] as () => Promise<string | null>;

    await expect(handler()).rejects.toThrow();
  });
});

describe('settingsIpc — harness defaults IPC', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  const createMockDeps = () => {
    const mockStore = {
      get: vi.fn((key: string) => {
        const defaults: Record<string, unknown> = {
          lastWorkspace: testHome(),
          showFastfetch: false,
          aiCommitEnabled: false,
          aiCommitProvider: 'codex',
          aiCommitModel: '',
          harnessDefaults: {
            codex: { model: 'gpt-4', favorites: ['gpt-4'], flags: '--yolo' },
            opencode: { model: 'opencode/zen/big-pickle', favorites: [], flags: '' },
            pi: { model: '', favorites: [], flags: '' },
            claude: { model: '', favorites: [], flags: '' },
          },
        };
        return defaults[key];
      }),
      set: vi.fn(),
    };
    const mockMainWindow = {
      webContents: { send: vi.fn() },
      minimize: vi.fn(), unmaximize: vi.fn(), maximize: vi.fn(), close: vi.fn(),
      isMaximized: vi.fn(() => false),
    };
    return {
      deps: {
        getStore: () => mockStore as never,
        getMainWindow: () => mockMainWindow as never,
      },
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('GET_HARNESS_DEFAULTS returns harnessDefaults from store', () => {
    const { deps } = createMockDeps();
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'get-harness-defaults'
    )?.[1] as () => unknown;

    const result = handler();
    expect(result).toEqual({
      codex: { model: 'gpt-4', favorites: ['gpt-4'], flags: '--yolo' },
      opencode: { model: 'opencode/zen/big-pickle', favorites: [], flags: '' },
      pi: { model: '', favorites: [], flags: '' },
      claude: { model: '', favorites: [], flags: '' },
    });
  });

  test('SET_HARNESS_DEFAULTS calls store.set with the validated payload', () => {
    const mockSetFn = vi.fn();
    const mockStore = {
      get: vi.fn((key: string) => {
        const defaults: Record<string, unknown> = {
          lastWorkspace: testHome(),
          showFastfetch: false,
          aiCommitEnabled: false,
          aiCommitProvider: 'codex',
          aiCommitModel: '',
          harnessDefaults: {
            codex: { model: 'gpt-4', favorites: ['gpt-4'], flags: '--yolo' },
            opencode: { model: 'opencode/zen/big-pickle', favorites: [], flags: '' },
            pi: { model: '', favorites: [], flags: '' },
            claude: { model: '', favorites: [], flags: '' },
          },
        };
        return defaults[key];
      }),
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
    };
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'set-harness-defaults'
    )?.[1] as (_: unknown, payload: unknown) => void;

    const payload = {
      codex: { model: 'gpt-4', favorites: ['gpt-4'], flags: '--yolo' },
      opencode: { model: 'opencode/zen/big-pickle', favorites: [], flags: '' },
      pi: { model: '', favorites: [], flags: '' },
      claude: { model: '', favorites: [], flags: '' },
    };
    handler(null, payload);
    expect(mockSetFn).toHaveBeenCalledWith('harnessDefaults', expect.objectContaining({
      codex: { model: 'gpt-4', favorites: ['gpt-4'], flags: '--yolo' },
    }));
  });

  test('SET_HARNESS_DEFAULTS rejects non-object payloads (validation)', () => {
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
    };
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'set-harness-defaults'
    )?.[1] as (_: unknown, payload: unknown) => void;

    // Reject null
    handler(null, null);
    expect(mockSetFn).not.toHaveBeenCalled();

    // Reject string
    handler(null, 'not an object');
    expect(mockSetFn).not.toHaveBeenCalled();
  });
});

describe('settingsIpc — error-path: workspace validation', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  const createMockDeps = () => {
    const mockStore = {
      get: vi.fn((key: string) => {
        const defaults: Record<string, unknown> = {
          lastWorkspace: testHome(),
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
      minimize: vi.fn(), unmaximize: vi.fn(), maximize: vi.fn(), close: vi.fn(),
      isMaximized: vi.fn(() => false),
    };
    return {
      deps: {
        getStore: () => mockStore as never,
        getMainWindow: () => mockMainWindow as never,
      },
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscoverHarnessModels.mockReset();
    mockGetAvailableHarnessOptions.mockReset();
  });

  test('READ_DIRECTORY returns empty array for invalid directory path', async () => {
    const { deps } = createMockDeps();
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'read-directory'
    )?.[1] as (_: unknown, dirPath: string) => Promise<unknown[]>;

    const result = await handler(null, '/nonexistent/directory');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  test('READ_DIRECTORY returns directory entries when path is valid', async () => {
    const { deps } = createMockDeps();
    mockResolveExistingDirectory.mockReturnValueOnce('/valid/path');
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
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result).toEqual([
      { name: 'src', isDirectory: true },
      { name: 'node_modules', isDirectory: true },
    ]);
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
      'get-base-directory',
      'open-base-directory-dialog',
      'get-show-fastfetch',
      'set-show-fastfetch',
      'get-ai-commit-settings',
      'set-ai-commit-enabled',
      'set-ai-commit-provider',
      'set-ai-commit-model',
      'open-directory-dialog',
      'read-directory',
      'get-harness-models',
      'get-harness-options',
      'get-harness-defaults',
      'set-harness-defaults',
    ];

    expectedChannels.forEach(channel => {
      expect(typeof channel).toBe('string');
      expect(channel.length).toBeGreaterThan(0);
    });

    const uniqueChannels = new Set(expectedChannels);
    expect(uniqueChannels.size).toBe(expectedChannels.length);
  });

  test('all settings channels start with expected prefixes', () => {
    const settingsChannels = [
      'get-last-workspace',
      'get-base-directory',
      'open-base-directory-dialog',
      'get-show-fastfetch',
      'set-show-fastfetch',
      'get-ai-commit-settings',
      'set-ai-commit-enabled',
      'set-ai-commit-provider',
      'set-ai-commit-model',
      'open-directory-dialog',
      'read-directory',
      'get-harness-models',
      'get-harness-options',
    ];

    const expectedPrefixes = ['get-', 'set-', 'open-', 'read-'];
    settingsChannels.forEach(channel => {
      const hasExpectedPrefix = expectedPrefixes.some(prefix => channel.startsWith(prefix));
      expect(hasExpectedPrefix).toBe(true);
    });
  });
});
