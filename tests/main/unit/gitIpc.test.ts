/**
 * Git IPC Registration Tests
 *
 * Tests for the git IPC module, verifying channel registration and behavior.
 */

import { vi } from 'vitest';

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
    on: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

// Import after mocking
import { describe, test, expect, beforeEach } from 'vitest';
import { registerGitIpc } from '../../../src/main/ipc/gitIpc';
import { ipcMain } from 'electron';

describe('registerGitIpc', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  // Create a minimal mock GitService
  const createMockGitService = () => ({
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
    getBranchState: vi.fn().mockResolvedValue({
      success: true,
      isRepo: true,
      currentBranch: 'main',
      isDetached: false,
      branches: [],
    }),
    getOperationState: vi.fn().mockResolvedValue({
      success: true,
      isRepo: true,
      inProgress: false,
      mode: 'none',
      conflicts: [],
      message: 'No merge in progress',
    }),
    listStashes: vi.fn().mockResolvedValue([]),
    getHistory: vi.fn().mockResolvedValue([]),
    getDiff: vi.fn().mockResolvedValue({
      success: true,
      output: '',
      title: 'Diff',
    }),
    stage: vi.fn().mockResolvedValue({ success: true }),
    unstage: vi.fn().mockResolvedValue({ success: true }),
    commit: vi.fn().mockResolvedValue({ success: true }),
    createBranch: vi.fn().mockResolvedValue({ success: true }),
    switchBranch: vi.fn().mockResolvedValue({ success: true }),
    deleteBranch: vi.fn().mockResolvedValue({ success: true }),
    forceDeleteBranch: vi.fn().mockResolvedValue({ success: true }),
    mergeBranch: vi.fn().mockResolvedValue({ success: true }),
    abortCurrentOperation: vi.fn().mockResolvedValue({ success: true }),
    stashChanges: vi.fn().mockResolvedValue({ success: true }),
    applyStash: vi.fn().mockResolvedValue({ success: true }),
    popStash: vi.fn().mockResolvedValue({ success: true }),
    dropStash: vi.fn().mockResolvedValue({ success: true }),
    clearStashes: vi.fn().mockResolvedValue({ success: true }),
    getStatus: vi.fn().mockResolvedValue({
      success: true,
      isRepo: true,
      currentBranch: 'main',
      isDetached: false,
      changes: [],
    }),
    isRepo: vi.fn().mockResolvedValue(false),
    initRepository: vi.fn().mockResolvedValue({ success: true }),
    getRemotes: vi.fn().mockResolvedValue({
      success: true,
      remotes: [],
      provider: 'unknown',
    }),
    fetch: vi.fn().mockResolvedValue({ success: true }),
    pull: vi.fn().mockResolvedValue({ success: true }),
    push: vi.fn().mockResolvedValue({ success: true }),
    addRemote: vi.fn().mockResolvedValue({ success: true }),
    removeRemote: vi.fn().mockResolvedValue({ success: true }),
    renameRemote: vi.fn().mockResolvedValue({ success: true }),
    getCurrentWorkspace: vi.fn().mockReturnValue('/test/workspace'),
  });

  const mockMainWindow = {
    webContents: {
      send: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('registers all expected git IPC channels', () => {
    const mockGitService = createMockGitService();

    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const expectedChannels = [
      'git-start-polling',
      'git-stop-polling',
      'git-get-branch-state',
      'git-get-operation-state',
      'git-get-stashes',
      'git-get-history',
      'git-get-diff',
      'git-stage',
      'git-unstage',
      'git-commit',
      'git-create-branch',
      'git-switch-branch',
      'git-delete-branch',
      'git-force-delete-branch',
      'git-merge-branch',
      'git-abort-operation',
      'git-stash',
      'git-apply-stash',
      'git-pop-stash',
      'git-drop-stash',
      'git-clear-stashes',
      'git-refresh',
      'git-init',
      'git-get-remotes',
      'git-fetch',
      'git-pull',
      'git-push',
      'git-add-remote',
      'git-remove-remote',
      'git-rename-remote',
    ];

    expectedChannels.forEach(channel => {
      expect(mockIpcMain.handle).toHaveBeenCalledWith(channel, expect.any(Function));
    });
  });

  test('registers exactly 30 git IPC channels', () => {
    const mockGitService = createMockGitService();

    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handleCalls = mockIpcMain.handle.mock.calls;
    expect(handleCalls.length).toBe(30);
  });

  test('can be called multiple times (registering handlers again)', () => {
    const mockGitService = createMockGitService();

    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handleCalls = mockIpcMain.handle.mock.calls;
    expect(handleCalls.length).toBe(60);
  });

  test('git-stop-polling calls gitService.stopPolling', async () => {
    const mockGitService = createMockGitService();

    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    // Find the git-stop-polling handler
    const stopPollingHandler = mockIpcMain.handle.mock.calls.find(
      ([channel]) => channel === 'git-stop-polling'
    )?.[1] as (...args: unknown[]) => unknown;

    await stopPollingHandler();
    expect(mockGitService.stopPolling).toHaveBeenCalledTimes(1);
  });

  test('git-stage validates workspace path', async () => {
    const mockGitService = createMockGitService();

    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    // Find the git-stage handler
    const stageHandler = mockIpcMain.handle.mock.calls.find(
      ([channel]) => channel === 'git-stage'
    )?.[1] as (...args: unknown[]) => unknown;

    // Test with invalid workspace path (simulate what happens when path doesn't exist)
    const result = await stageHandler(null, '/nonexistent/path');
    expect(result).toEqual({ success: false, error: 'Workspace path is invalid or not a directory' });
  });
});

describe('git IPC channel constants', () => {
  test('git channel names are consistent', () => {
    const expectedChannels = [
      'git-start-polling',
      'git-stop-polling',
      'git-get-branch-state',
      'git-get-operation-state',
      'git-get-stashes',
      'git-get-history',
      'git-get-diff',
      'git-stage',
      'git-unstage',
      'git-commit',
      'git-create-branch',
      'git-switch-branch',
      'git-delete-branch',
      'git-force-delete-branch',
      'git-merge-branch',
      'git-abort-operation',
      'git-stash',
      'git-apply-stash',
      'git-pop-stash',
      'git-drop-stash',
      'git-clear-stashes',
      'git-refresh',
      'git-init',
      'git-get-remotes',
      'git-fetch',
      'git-pull',
      'git-push',
      'git-add-remote',
      'git-remove-remote',
      'git-rename-remote',
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
});
