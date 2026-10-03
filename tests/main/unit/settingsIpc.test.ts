/**
 * Settings IPC Registration Tests
 *
 * Tests for the settings IPC module, verifying channel registration.
 */

import { vi, describe, test, expect, beforeEach } from 'vitest';
import { SET_THEME } from '../../../src/shared/ipcChannels';
import { KeybindingOverridesService } from '../../../src/main/keybindingOverrides';
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

import { dialog, ipcMain } from 'electron';
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
          aiCommitEnabled: false,
          aiCommitProvider: 'codex',
          aiCommitModel: '',
          harnessDefaults: {
            codex: { model: 'gpt-4', favorites: ['gpt-4'], flags: '--yolo' },
            opencode: { model: 'opencode/zen/big-pickle', favorites: [], flags: '' },
            pi: { model: '', favorites: [], flags: '' },
            claude: { model: '', favorites: [], flags: '' },
          },
          theme: 'dark',
        };
        return defaults[key];
      }),
      set: vi.fn(),
      delete: vi.fn(),
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
      setBackgroundColor: vi.fn(),
    };

    return {
      deps: {
        getStore: () => mockStore as never,
        getMainWindow: () => mockMainWindow as never,
        keybindingOverrides: new KeybindingOverridesService(() => mockStore as never, 'other'),
      },
      mockStore,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('registers all expected settings IPC channels', () => {
    const { deps } = createMockDeps();

    registerSettingsIpc(deps);

    const expectedChannels = [
      'get-app-version',
      'get-last-workspace',
      'get-base-directory',
      'open-base-directory-dialog',
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
      'get-theme',
      'set-theme',
      'get-workspace-navigation-mode',
      'set-workspace-navigation-mode',
      'get-workspace-sidebar-width',
      'set-workspace-sidebar-width',
      'get-keybinding-overrides',
      'set-keybinding-overrides',
    ];

    expectedChannels.forEach(channel => {
      expect(mockIpcMain.handle).toHaveBeenCalledWith(channel, expect.any(Function));
    });
  });

  test('registers exactly 23 settings IPC channels', () => {
    const { deps } = createMockDeps();

    registerSettingsIpc(deps);

    const handleCalls = mockIpcMain.handle.mock.calls;
    expect(handleCalls.length).toBe(23);
  });

  test('can be called multiple times (registering handlers again)', () => {
    const { deps } = createMockDeps();

    registerSettingsIpc(deps);
    registerSettingsIpc(deps);

    const handleCalls = mockIpcMain.handle.mock.calls;
    expect(handleCalls.length).toBe(46);
  });

  test('OPEN_DIRECTORY_DIALOG allows creating directories from the picker', async () => {
    const { deps } = createMockDeps();
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] });
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'open-directory-dialog'
    )?.[1] as () => Promise<string | null>;

    await handler();

    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Workspace Directory',
      })
    );
  });

  test('OPEN_BASE_DIRECTORY_DIALOG allows creating directories from the picker', async () => {
    const { deps } = createMockDeps();
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] });
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'open-base-directory-dialog'
    )?.[1] as () => Promise<string | null>;

    await handler();

    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Base Directory',
      })
    );
  });

  describe('keybinding overrides', () => {
    const handler = (channel: string) =>
      mockIpcMain.handle.mock.calls.find((call) => call[0] === channel)?.[1] as (e: unknown, ...a: unknown[]) => unknown;
    const custom = { code: 'KeyK', primary: true, ctrl: false, shift: false, alt: false };

    test('GET validates untrusted stored data', () => {
      const { deps, mockStore } = createMockDeps();
      mockStore.get.mockImplementation((key: string) => key === 'keybindingOverrides'
        ? { 'editor.save': custom, 'evil.cmd': custom, 'zoom.in': { code: 'KeyK' } }
        : undefined);
      registerSettingsIpc(deps);
      expect(handler('get-keybinding-overrides')({})).toEqual({ 'editor.save': custom });
    });

    test('SET persists only validated overrides and serves them from cache', () => {
      const { deps, mockStore } = createMockDeps();
      registerSettingsIpc(deps);
      const result = handler('set-keybinding-overrides')({}, { 'editor.save': custom, 'evil.cmd': custom });
      expect(result).toEqual({ success: true, overrides: { 'editor.save': custom } });
      expect(mockStore.set).toHaveBeenCalledWith('keybindingOverrides', { 'editor.save': custom });
      mockStore.get.mockClear();
      expect(handler('get-keybinding-overrides')({})).toEqual({ 'editor.save': custom });
      expect(mockStore.get).not.toHaveBeenCalled();
    });

    test('SET with no overrides removes the stored key', () => {
      const { deps, mockStore } = createMockDeps();
      registerSettingsIpc(deps);
      expect(handler('set-keybinding-overrides')({}, {})).toEqual({ success: true, overrides: {} });
      expect(mockStore.delete).toHaveBeenCalledWith('keybindingOverrides');
    });

    test('GET fails closed on well-formed but conflicting stored data and resets it', () => {
      const { deps, mockStore } = createMockDeps();
      mockStore.get.mockImplementation((key: string) => key === 'keybindingOverrides'
        ? { 'view.toggleExplorer': { ...custom, code: 'KeyS' } } // collides with Save's default in the editor context
        : undefined);
      registerSettingsIpc(deps);
      expect(handler('get-keybinding-overrides')({})).toEqual({});
      expect(mockStore.delete).toHaveBeenCalledWith('keybindingOverrides');
      expect(deps.keybindingOverrides.get()).toEqual({});
    });

    test('GET never activates stored plain-key bindings', () => {
      const { deps, mockStore } = createMockDeps();
      mockStore.get.mockImplementation((key: string) => key === 'keybindingOverrides'
        ? { 'editor.save': { ...custom, primary: false } }
        : undefined);
      registerSettingsIpc(deps);
      expect(handler('get-keybinding-overrides')({})).toEqual({});
    });

    test('SET rejects plain-key bindings', () => {
      const { deps } = createMockDeps();
      registerSettingsIpc(deps);
      expect(handler('set-keybinding-overrides')({}, { 'editor.save': { ...custom, primary: false } }))
        .toEqual({ success: true, overrides: {} });
    });

    test('SET rejects ambiguous configurations', () => {
      const { deps, mockStore } = createMockDeps();
      registerSettingsIpc(deps);
      const result = handler('set-keybinding-overrides')({}, { 'view.toggleExplorer': { ...custom, code: 'KeyS' } });
      expect(result).toMatchObject({ success: false });
      expect(mockStore.set).not.toHaveBeenCalled();
    });

    test('SET accepts an explicit unbind that resolves the conflict', () => {
      const { deps } = createMockDeps();
      registerSettingsIpc(deps);
      const result = handler('set-keybinding-overrides')({}, {
        'view.toggleExplorer': { ...custom, code: 'KeyS' },
        'editor.save': null,
      });
      expect(result).toMatchObject({ success: true });
    });
  });

  test('settings channels do not overlap with terminal channels', () => {
    const { deps } = createMockDeps();

    registerSettingsIpc(deps);

    const settingsChannels = [
      'get-app-version',
      'get-last-workspace',
      'get-base-directory',
      'open-base-directory-dialog',
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
      'get-app-version',
      'get-last-workspace',
      'get-base-directory',
      'open-base-directory-dialog',
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

  test('GET_HARNESS_DEFAULTS returns normalized harnessDefaults from store', () => {
    const { deps } = createMockDeps();
    registerSettingsIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'get-harness-defaults'
    )?.[1] as () => unknown;

    const result = handler();
    expect(result).toEqual({
      codex: { model: 'gpt-4', favorites: ['gpt-4'], flags: '--yolo', visible: true, attentionEnabled: false, usageVisible: true },
      opencode: { model: 'opencode/zen/big-pickle', favorites: [], flags: '', visible: true, attentionEnabled: false, usageVisible: true },
      pi: { model: '', favorites: [], flags: '', visible: true, attentionEnabled: false, usageVisible: true },
      omp: { model: '', favorites: [], flags: '', visible: true, attentionEnabled: false, usageVisible: true },
      claude: { model: '', favorites: [], flags: '', visible: true, attentionEnabled: false, usageVisible: true },
      hermes: { model: '', favorites: [], flags: '', visible: true, attentionEnabled: false, usageVisible: true },
      agy: { model: '', favorites: [], flags: '', visible: true, attentionEnabled: false, usageVisible: true },
    });
  });

  test('SET_HARNESS_DEFAULTS calls store.set with the validated payload', () => {
    const mockSetFn = vi.fn();
    const mockStore = {
      get: vi.fn((key: string) => {
        const defaults: Record<string, unknown> = {
          lastWorkspace: testHome(),
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
      codex: { model: 'gpt-4', favorites: ['gpt-4'], flags: '--yolo', visible: true, attentionEnabled: false, usageVisible: true },
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

});

describe('settings IPC channel constants', () => {
  test('settings channel names are consistent', () => {
    const expectedChannels = [
      'get-last-workspace',
      'get-base-directory',
      'open-base-directory-dialog',
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
      'get-app-version',
      'get-last-workspace',
      'get-base-directory',
      'open-base-directory-dialog',
      'get-ai-commit-settings',
      'set-ai-commit-enabled',
      'set-ai-commit-provider',
      'set-ai-commit-model',
      'open-directory-dialog',
      'read-directory',
      'get-harness-models',
      'get-harness-options',
      'get-theme',
      'set-theme',
    ];

    const expectedPrefixes = ['get-', 'set-', 'open-', 'read-'];
    settingsChannels.forEach(channel => {
      const hasExpectedPrefix = expectedPrefixes.some(prefix => channel.startsWith(prefix));
      expect(hasExpectedPrefix).toBe(true);
    });
  });
});

describe('GET_THEME and SET_THEME handlers', () => {
  const mockIpcMain = ipcMain as unknown as {
    handle: { mock: { calls: Array<[string, (...args: unknown[]) => unknown]> } };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('GET_THEME returns persisted valid theme', async () => {
    const mockStore = {
      get: vi.fn().mockReturnValue('light'),
      set: vi.fn(),
    };
    const deps = {
      getStore: () => mockStore as never,
      getMainWindow: () => null,
    };
    registerSettingsIpc(deps);
    const handler = mockIpcMain.handle.mock.calls.find((c) => c[0] === 'get-theme')?.[1] as (() => Promise<string>) | undefined;
    expect(handler).toBeDefined();
    if (!handler) throw new Error('get-theme handler not found');

    const result = await handler();
    expect(result).toBe('light');
    expect(mockStore.set).not.toHaveBeenCalled();
  });

  test('GET_THEME returns and normalizes missing theme to dark', async () => {
    const mockStore = {
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
    };
    const deps = {
      getStore: () => mockStore as never,
      getMainWindow: () => null,
    };
    registerSettingsIpc(deps);
    const handler = mockIpcMain.handle.mock.calls.find((c) => c[0] === 'get-theme')?.[1] as (() => Promise<string>) | undefined;
    expect(handler).toBeDefined();
    if (!handler) throw new Error('get-theme handler not found');
    const result = await handler();
    expect(result).toBe('dark');
    expect(mockStore.set).toHaveBeenCalledWith('theme', 'dark');
  });

  test('GET_THEME normalizes corrupt theme to dark and repairs store', async () => {
    const mockStore = {
      get: vi.fn().mockReturnValue('solarized-neon-invalid'),
      set: vi.fn(),
    };
    const deps = {
      getStore: () => mockStore as never,
      getMainWindow: () => null,
    };
    registerSettingsIpc(deps);
    const handler = mockIpcMain.handle.mock.calls.find((c) => c[0] === 'get-theme')?.[1] as (() => Promise<string>) | undefined;
    expect(handler).toBeDefined();
    if (!handler) throw new Error('get-theme handler not found');
    const result = await handler();
    expect(result).toBe('dark');
    expect(mockStore.set).toHaveBeenCalledWith('theme', 'dark');
  });

  test('SET_THEME persists valid theme and updates window background', async () => {
    const mockStore = {
      get: vi.fn(),
      set: vi.fn(),
    };
    const mockWindow = {
      isDestroyed: () => false,
      setBackgroundColor: vi.fn(),
    };
    const deps = {
      getStore: () => mockStore as never,
      getMainWindow: () => mockWindow as never,
    };
    registerSettingsIpc(deps);
    const handler = mockIpcMain.handle.mock.calls.find((c) => c[0] === 'set-theme')?.[1] as ((_event: unknown, theme: unknown) => Promise<void>) | undefined;
    expect(handler).toBeDefined();
    if (!handler) throw new Error('set-theme handler not found');
    await handler({}, 'light');
    expect(mockStore.set).toHaveBeenCalledWith('theme', 'light');
    expect(mockWindow.setBackgroundColor).toHaveBeenCalledWith('#f3f4f6');

    await handler({}, 'slate');
    expect(mockStore.set).toHaveBeenCalledWith('theme', 'slate');
    expect(mockWindow.setBackgroundColor).toHaveBeenCalledWith('#22272e');

    await handler({}, 'dark');
    expect(mockStore.set).toHaveBeenCalledWith('theme', 'dark');
    expect(mockWindow.setBackgroundColor).toHaveBeenCalledWith('#121212');
  });

  test('SET_THEME commits rapid ordered requests synchronously, with the last identity winning', () => {
    let persisted: unknown;
    const store = { get: vi.fn(), set: vi.fn((_key: string, value: unknown) => { persisted = value; }) };
    const window = { isDestroyed: () => false, setBackgroundColor: vi.fn() };
    registerSettingsIpc({ getStore: () => store as never, getMainWindow: () => window as never });
    const handler = mockIpcMain.handle.mock.calls.find(([channel]) => channel === SET_THEME)![1];
    for (const theme of ['dark', 'light', 'dark']) expect(handler({}, theme)).toBeUndefined();
    expect(store.set.mock.calls.map(([, theme]) => theme)).toEqual(['dark', 'light', 'dark']);
    expect(persisted).toBe('dark');
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith('#121212');
  });

  test('SET_THEME rejects invalid values safely without persisting', async () => {
    const mockStore = {
      get: vi.fn(),
      set: vi.fn(),
    };
    const mockWindow = {
      isDestroyed: () => false,
      setBackgroundColor: vi.fn(),
    };
    const deps = {
      getStore: () => mockStore as never,
      getMainWindow: () => mockWindow as never,
    };
    registerSettingsIpc(deps);
    const handler = mockIpcMain.handle.mock.calls.find((c) => c[0] === 'set-theme')?.[1] as ((_event: unknown, theme: unknown) => Promise<void>) | undefined;
    expect(handler).toBeDefined();
    if (!handler) throw new Error('set-theme handler not found');
    await handler({}, 'garbage-theme');
    await handler({}, null);
    await handler({}, 123);

    expect(mockStore.set).not.toHaveBeenCalled();
    expect(mockWindow.setBackgroundColor).not.toHaveBeenCalled();
  });
});

describe('workspace navigation mode handlers', () => {
  const mockIpcMain = ipcMain as unknown as {
    handle: { mock: { calls: Array<[string, (...args: unknown[]) => unknown]> } };
  };

  function setup(stored: unknown) {
    vi.clearAllMocks();
    const store = { get: vi.fn().mockReturnValue(stored), set: vi.fn() };
    registerSettingsIpc({ getStore: () => store as never, getMainWindow: () => null });
    const find = (name: string) => mockIpcMain.handle.mock.calls.find((c) => c[0] === name)![1];
    return { store, get: find('get-workspace-navigation-mode'), set: find('set-workspace-navigation-mode') };
  }

  test.each(['tabs', 'sidebar'])('GET returns persisted %s without rewriting', (mode) => {
    const { store, get } = setup(mode);
    expect(get()).toBe(mode);
    expect(store.set).not.toHaveBeenCalled();
  });

  test.each([undefined, 'rail', 42])('GET defaults %s to sidebar and repairs the store', (raw) => {
    const { store, get } = setup(raw);
    expect(get()).toBe('sidebar');
    expect(store.set).toHaveBeenCalledWith('workspaceNavigationMode', 'sidebar');
  });

  test('SET persists valid values and rejects invalid ones', () => {
    const { store, set } = setup('tabs');
    set({}, 'sidebar');
    expect(store.set).toHaveBeenCalledWith('workspaceNavigationMode', 'sidebar');
    store.set.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    set({}, 'garbage');
    expect(store.set).not.toHaveBeenCalled();
  });
});

describe('workspace sidebar width handlers', () => {
  const mockIpcMain = ipcMain as unknown as {
    handle: { mock: { calls: Array<[string, (...args: unknown[]) => unknown]> } };
  };

  function setup(stored: unknown) {
    vi.clearAllMocks();
    const store = { get: vi.fn().mockReturnValue(stored), set: vi.fn() };
    registerSettingsIpc({ getStore: () => store as never, getMainWindow: () => null });
    const find = (name: string) => mockIpcMain.handle.mock.calls.find((c) => c[0] === name)![1];
    return { store, get: find('get-workspace-sidebar-width'), set: find('set-workspace-sidebar-width'), getExpanded: find('get-workspace-sidebar-expanded-width') };
  }

  test.each([320, 44])('GET returns a valid persisted width (%s) without rewriting', (width) => {
    const { store, get } = setup(width);
    expect(get()).toBe(width);
    expect(store.set).not.toHaveBeenCalled();
  });

  test.each([[undefined, 280], ['wide', 280], [Number.NaN, 280], [10, 44], [150, 180], [9000, 500]])(
    'GET normalizes %s to %s and repairs the store',
    (raw, expected) => {
      const { store, get } = setup(raw);
      expect(get()).toBe(expected);
      expect(store.set).toHaveBeenCalledWith('workspaceSidebarWidth', expected);
    },
  );

  test('SET remembers the expanded width but not the rail, and GET expanded survives a collapse', () => {
    const { store, set, getExpanded } = setup(44);
    set({}, 360);
    expect(store.set).toHaveBeenCalledWith('workspaceSidebarExpandedWidth', 360);
    store.set.mockClear();
    set({}, 44);
    expect(store.set).toHaveBeenCalledTimes(1);
    expect(store.set).toHaveBeenCalledWith('workspaceSidebarWidth', 44);
    store.get.mockImplementation((key: string) => (key === 'workspaceSidebarExpandedWidth' ? 360 : 44));
    expect(getExpanded()).toBe(360);
    store.get.mockImplementation(() => undefined);
    expect(getExpanded()).toBe(280);
  });

  test.each([['wide'], [Number.NaN], [10], [undefined]])('GET expanded never returns the rail or junk (%s)', (rawExpanded) => {
    const { store, getExpanded } = setup(44);
    store.get.mockImplementation((key: string) => (key === 'workspaceSidebarExpandedWidth' ? rawExpanded : 44));
    expect(getExpanded()).toBe(280);
  });

  test('GET expanded falls back to a customised current width when none was remembered yet', () => {
    const { store, getExpanded } = setup(360);
    store.get.mockImplementation((key: string) => (key === 'workspaceSidebarWidth' ? 360 : undefined));
    expect(getExpanded()).toBe(360);
    expect(store.set).toHaveBeenCalledWith('workspaceSidebarExpandedWidth', 360);
  });

  test('GET expanded seeds the fallback so it survives a collapse and restart', () => {
    const data: Record<string, unknown> = { workspaceSidebarWidth: 400 };
    const { store, get, set, getExpanded } = setup(undefined);
    store.get.mockImplementation((key: string) => data[key]);
    store.set.mockImplementation((key: string, value: unknown) => { data[key] = value; });
    expect(getExpanded()).toBe(400);
    expect(data.workspaceSidebarExpandedWidth).toBe(400);
    set({}, 44); // user collapses; only the rail is saved as the current width
    expect(data.workspaceSidebarWidth).toBe(44);
    expect(get()).toBe(44);
    expect(getExpanded()).toBe(400); // after "restart"
  });

  test('GET expanded repairs a corrupt expanded value from the current width, never storing the rail', () => {
    const data: Record<string, unknown> = { workspaceSidebarWidth: 320, workspaceSidebarExpandedWidth: 'junk' };
    const { store, getExpanded } = setup(undefined);
    store.get.mockImplementation((key: string) => data[key]);
    store.set.mockImplementation((key: string, value: unknown) => { data[key] = value; });
    expect(getExpanded()).toBe(320);
    expect(data.workspaceSidebarExpandedWidth).toBe(320);
    data.workspaceSidebarWidth = 44;
    data.workspaceSidebarExpandedWidth = 10;
    expect(getExpanded()).toBe(280);
    expect(data.workspaceSidebarExpandedWidth).toBe(10);
  });

  test('SET clamps numeric widths and rejects non-numeric ones', () => {
    const { store, set } = setup(280);
    set({}, 9999);
    expect(store.set).toHaveBeenCalledWith('workspaceSidebarWidth', 500);
    store.set.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    set({}, '300');
    set({}, Number.NaN);
    expect(store.set).not.toHaveBeenCalled();
  });
});
