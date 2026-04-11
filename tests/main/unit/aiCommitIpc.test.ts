/**
 * AI Commit IPC Registration Tests
 *
 * Tests for the AI commit IPC module, verifying channel registration and error handling.
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

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    stdin: { end: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  })),
}));

const { mockGitServiceGetStatus, mockGitServiceGetCommitPromptContext } = vi.hoisted(() => ({
  mockGitServiceGetStatus: vi.fn(),
  mockGitServiceGetCommitPromptContext: vi.fn(),
}));

const { mockResolveExistingDirectory } = vi.hoisted(() => ({
  mockResolveExistingDirectory: vi.fn().mockReturnValue(null),
}));

const { mockDiscoverHarnessModels } = vi.hoisted(() => ({
  mockDiscoverHarnessModels: vi.fn(),
}));

vi.mock('../../../src/main/harnessCatalog', () => ({
  discoverHarnessModels: mockDiscoverHarnessModels,
  getAvailableHarnessOptions: vi.fn(),
}));

vi.mock('../../../src/main/gitService', () => ({
  GitService: vi.fn().mockImplementation(() => ({
    getStatus: mockGitServiceGetStatus,
    getCommitPromptContext: mockGitServiceGetCommitPromptContext,
  })),
}));

vi.mock('../../../src/main/security', () => ({
  resolveExistingDirectory: mockResolveExistingDirectory,
}));

import { ipcMain } from 'electron';
import { registerAiCommitIpc } from '../../../src/main/ipc/aiCommitIpc';

describe('registerAiCommitIpc', () => {
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
        getGitService: () => mockGitService as never,
      },
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('registers GENERATE_COMMIT_MESSAGE channel', () => {
    const { deps } = createMockDeps();

    registerAiCommitIpc(deps);

    expect(mockIpcMain.handle).toHaveBeenCalledWith('generate-commit-message', expect.any(Function));
  });

  test('registers exactly 1 AI commit IPC channel', () => {
    const { deps } = createMockDeps();

    registerAiCommitIpc(deps);

    const handleCalls = mockIpcMain.handle.mock.calls;
    expect(handleCalls.length).toBe(1);
  });
});

describe('registerAiCommitIpc — error-path: workspace validation and commit generation', () => {
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
    const mockGitService = {
      getStatus: mockGitServiceGetStatus,
      getCommitPromptContext: mockGitServiceGetCommitPromptContext,
    };
    return {
      deps: {
        getStore: () => mockStore as never,
        getGitService: () => mockGitService as never,
      },
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscoverHarnessModels.mockReset();
    mockGitServiceGetStatus.mockReset();
    mockGitServiceGetCommitPromptContext.mockReset();
  });

  test('GENERATE_COMMIT_MESSAGE returns error for invalid workspace path', async () => {
    const { deps } = createMockDeps();
    registerAiCommitIpc(deps);

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
    const deps = {
      getStore: () => mockStore as never,
      getGitService: () => ({ getStatus: mockGitServiceGetStatus, getCommitPromptContext: mockGitServiceGetCommitPromptContext } as never),
    };
    mockResolveExistingDirectory.mockResolvedValueOnce(process.cwd());
    registerAiCommitIpc(deps);

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
    const deps = {
      getStore: () => mockStore as never,
      getGitService: () => ({ getStatus: mockGitServiceGetStatus, getCommitPromptContext: mockGitServiceGetCommitPromptContext } as never),
    };
    mockResolveExistingDirectory.mockResolvedValueOnce(process.cwd());
    mockGitServiceGetCommitPromptContext.mockResolvedValue({ success: false, error: 'No changes' });
    registerAiCommitIpc(deps);

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'generate-commit-message'
    )?.[1] as (_: unknown, workspacePath: string) => Promise<{ success: boolean; error?: string }>;

    const result = await handler(null, '/some/path');
    expect(result).toEqual({ success: false, error: 'No changes' });
  });
});
