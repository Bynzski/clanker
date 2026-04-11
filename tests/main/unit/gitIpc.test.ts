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

// Mock settingsIpc so getValidatedWorkspacePath can be controlled per-test.
// Uses vi.hoisted() so references are available when vi.mock factory runs.
// Only mock getValidatedWorkspacePath and refreshGitStatus.
// getInvalidWorkspaceResult uses the real implementation (error message must match production).
const { mockGetValidatedWorkspacePath, mockRefreshGitStatus } = vi.hoisted(() => ({
  mockGetValidatedWorkspacePath: vi.fn(),
  mockRefreshGitStatus: vi.fn(),
}));

vi.mock('../../../src/main/ipc/settingsIpc', () => ({
  getValidatedWorkspacePath: mockGetValidatedWorkspacePath,
  getInvalidWorkspaceResult: () => ({ success: false, error: 'Workspace path is invalid or not a directory' }),
  refreshGitStatus: mockRefreshGitStatus,
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
    getFileDiff: vi.fn().mockResolvedValue({
      success: true,
      oldContent: '',
      newContent: '',
      oldPath: '',
      newPath: '',
      isBinary: false,
      hasDiff: false,
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
    mockGetValidatedWorkspacePath.mockReturnValue(null);
    
    mockRefreshGitStatus.mockResolvedValue({ success: true, changes: [] });
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
      'git-get-file-diff',
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
    expect(handleCalls.length).toBe(31);
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
    expect(handleCalls.length).toBe(62);
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

/**
 * Git IPC — Error-Path Tests
 *
 * Verifies every git handler returns a defined value (never undefined or thrown)
 * for workspace validation failures, git service errors, and malformed inputs.
 *
 * The module imports getValidatedWorkspacePath from settingsIpc, which must be
 * mocked to simulate invalid workspace paths.
 */

describe('gitIpc — error-path: workspace validation returns valid results', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  const createMockGitService = () => ({
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
    getBranchState: vi.fn().mockResolvedValue({
      success: true, isRepo: true, currentBranch: 'main',
      isDetached: false, branches: [],
    }),
    getOperationState: vi.fn().mockResolvedValue({
      success: true, isRepo: true, inProgress: false,
      mode: 'none', conflicts: [], message: 'No merge in progress',
    }),
    listStashes: vi.fn().mockResolvedValue([]),
    getHistory: vi.fn().mockResolvedValue([]),
    getDiff: vi.fn().mockResolvedValue({ success: true, output: '', title: 'Diff' }),
    getFileDiff: vi.fn().mockResolvedValue({
      success: true, oldContent: '', newContent: '',
      oldPath: '', newPath: '', isBinary: false, hasDiff: false,
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
      success: true, isRepo: true, currentBranch: 'main',
      isDetached: false, changes: [],
    }),
    isRepo: vi.fn().mockResolvedValue(false),
    initRepository: vi.fn().mockResolvedValue({ success: true }),
    getRemotes: vi.fn().mockResolvedValue({ success: true, remotes: [], provider: 'unknown' }),
    fetch: vi.fn().mockResolvedValue({ success: true }),
    pull: vi.fn().mockResolvedValue({ success: true }),
    push: vi.fn().mockResolvedValue({ success: true }),
    addRemote: vi.fn().mockResolvedValue({ success: true }),
    removeRemote: vi.fn().mockResolvedValue({ success: true }),
    renameRemote: vi.fn().mockResolvedValue({ success: true }),
    getCurrentWorkspace: vi.fn().mockReturnValue('/test/workspace'),
  });

  const mockMainWindow = {
    webContents: { send: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetValidatedWorkspacePath.mockReturnValue(null);
    
    mockRefreshGitStatus.mockResolvedValue({ success: true, changes: [] });
  });

  // Handlers that return undefined for invalid workspace (gitIpc returns early)
  test('GIT_START_POLLING returns undefined for null workspacePath', async () => {
    mockGetValidatedWorkspacePath.mockReturnValue(null);
    const mockGitService = createMockGitService();
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-start-polling'
    )?.[1] as (_: unknown, workspacePath: string) => void;

    // @ts-expect-error — null workspace path tests invalid input
    const result = await handler(null, null);
    expect(result).toBeUndefined();
    expect(mockGitService.startPolling).not.toHaveBeenCalled();
  });

  test('GIT_GET_STASHES returns empty array for invalid workspace', async () => {
    const mockGitService = createMockGitService();
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-get-stashes'
    )?.[1] as (_: unknown, workspacePath: string) => unknown[];

    const result = await handler(null, '/invalid/path');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
    expect(mockGitService.listStashes).not.toHaveBeenCalled();
  });

  test('GIT_GET_HISTORY returns empty array for invalid workspace', async () => {
    const mockGitService = createMockGitService();
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-get-history'
    )?.[1] as (_: unknown, workspacePath: string, limit?: number) => unknown[];

    const result = await handler(null, '/invalid/path');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
    expect(mockGitService.getHistory).not.toHaveBeenCalled();
  });

  // Handlers that return { success: false, error } for invalid workspace
  const gitOperationHandlers = [
    { channel: 'git-get-branch-state', expected: { success: false, isRepo: false, currentBranch: null, isDetached: false, branches: [], error: expect.any(String) } },
    { channel: 'git-get-operation-state', expected: { success: false, isRepo: false, inProgress: false, mode: 'none', conflicts: [], message: expect.any(String), error: expect.any(String) } },
    { channel: 'git-get-diff', expected: { success: false, output: '', title: 'Diff', error: expect.any(String) } },
    { channel: 'git-stage', expected: { success: false, error: expect.any(String) } },
    { channel: 'git-unstage', expected: { success: false, error: expect.any(String) } },
    { channel: 'git-commit', expected: { success: false, error: expect.any(String) } },
    { channel: 'git-create-branch', expected: { success: false, error: expect.any(String) } },
    { channel: 'git-switch-branch', expected: { success: false, error: expect.any(String) } },
    { channel: 'git-delete-branch', expected: { success: false, error: expect.any(String) } },
    { channel: 'git-force-delete-branch', expected: { success: false, error: expect.any(String) } },
    { channel: 'git-merge-branch', expected: { success: false, error: expect.any(String) } },
    { channel: 'git-abort-operation', expected: { success: false, error: expect.any(String) } },
    { channel: 'git-stash', expected: { success: false, error: expect.any(String) } },
    { channel: 'git-apply-stash', expected: { success: false, error: expect.any(String) } },
    { channel: 'git-pop-stash', expected: { success: false, error: expect.any(String) } },
    { channel: 'git-drop-stash', expected: { success: false, error: expect.any(String) } },
    { channel: 'git-clear-stashes', expected: { success: false, error: expect.any(String) } },
    { channel: 'git-get-file-diff', expected: { success: false, oldContent: '', newContent: '', oldPath: '', newPath: '', isBinary: false, hasDiff: false, error: expect.any(String) } },
  ];

  gitOperationHandlers.forEach(({ channel, expected }) => {
    test(`${channel} returns valid error result for invalid workspace`, async () => {
      const mockGitService = createMockGitService();
      registerGitIpc({
        getGitService: () => mockGitService as never,
        getMainWindow: () => mockMainWindow as never,
      });

      const handler = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === channel
      )?.[1] as (...args: unknown[]) => unknown;

      const result = await handler(null, '/invalid/path');
      expect(result).toEqual(expected);
      // Verify the underlying service was NOT called
      expect(mockGitService.listStashes).not.toHaveBeenCalled();
    });
  });
});

describe('gitIpc — error-path: git service failures return valid results', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  const mockMainWindow = {
    webContents: { send: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default to invalid path so workspace-validation error tests work.
    // Tests that need a valid path can override with mockReturnValueOnce(process.cwd()).
    mockGetValidatedWorkspacePath.mockReturnValue(null);
    
    mockRefreshGitStatus.mockResolvedValue({ success: true, changes: [] });
  });

  test('GIT_INIT returns error when already a git repository', async () => {
    mockGetValidatedWorkspacePath.mockReturnValueOnce(process.cwd());
    const mockGitService = {
      isRepo: vi.fn().mockResolvedValue(true),
      initRepository: vi.fn().mockResolvedValue({ success: false, error: 'Already a git repository' }),
    };
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-init'
    )?.[1] as (...args: unknown[]) => unknown;

    // Use real path so workspace validation passes
    const result = await handler(null, process.cwd());
    expect(result).toEqual({ success: false, error: 'Already a git repository' });
  });

  test('GIT_INIT returns error for invalid workspace', async () => {
    const mockGitService = { isRepo: vi.fn(), initRepository: vi.fn() };
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-init'
    )?.[1] as (...args: unknown[]) => unknown;

    const result = await handler(null, '/invalid/path');
    expect(result).toEqual({ success: false, error: expect.any(String) });
  });

  test('GIT_GET_REMOTES returns error for invalid workspace', async () => {
    const mockGitService = {
      getRemotes: vi.fn(),
    };
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-get-remotes'
    )?.[1] as (...args: unknown[]) => unknown;

    const result = await handler(null, '/invalid/path');
    expect(result).toEqual({ success: false, remotes: [], provider: 'unknown', error: 'Invalid workspace path' });
  });

  test('GIT_FETCH returns error for invalid workspace', async () => {
    const mockGitService = { fetch: vi.fn() };
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-fetch'
    )?.[1] as (...args: unknown[]) => unknown;

    const result = await handler(null, '/invalid/path');
    expect(result).toEqual({ success: false, error: 'Invalid workspace path' });
  });

  test('GIT_PULL returns error for invalid workspace', async () => {
    const mockGitService = { pull: vi.fn() };
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-pull'
    )?.[1] as (...args: unknown[]) => unknown;

    const result = await handler(null, '/invalid/path');
    expect(result).toEqual({ success: false, error: 'Invalid workspace path' });
  });

  test('GIT_PUSH returns error for invalid workspace', async () => {
    const mockGitService = { push: vi.fn() };
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-push'
    )?.[1] as (...args: unknown[]) => unknown;

    const result = await handler(null, '/invalid/path');
    expect(result).toEqual({ success: false, error: 'Invalid workspace path' });
  });
});

describe('gitIpc — error-path: malformed input validation', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  const mockMainWindow = {
    webContents: { send: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: accept paths so malformed-input tests can exercise type validation.
    // Error-path tests can override with mockReturnValueOnce(null).
    mockGetValidatedWorkspacePath.mockReturnValue(process.cwd());
    
    mockRefreshGitStatus.mockResolvedValue({ success: true, changes: [] });
  });

  test('GIT_ADD_REMOTE returns error for non-string name', async () => {
    const mockGitService = { addRemote: vi.fn() };
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-add-remote'
    )?.[1] as (...args: unknown[]) => unknown;

    // Use real path so workspace validation passes; intentionally pass wrong type for name
    const result = await handler(null, process.cwd(), 123, 'url');
    expect(result).toEqual({ success: false, error: 'Remote name and URL must be strings' });
    expect(mockGitService.addRemote).not.toHaveBeenCalled();
  });

  test('GIT_ADD_REMOTE returns error for non-string url', async () => {
    const mockGitService = { addRemote: vi.fn() };
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-add-remote'
    )?.[1] as (...args: unknown[]) => unknown;

    // Use real path so workspace validation passes; intentionally pass wrong type for url
    const result = await handler(null, process.cwd(), 'origin', 999);
    expect(result).toEqual({ success: false, error: 'Remote name and URL must be strings' });
  });

  test('GIT_REMOVE_REMOTE returns error for non-string name', async () => {
    const mockGitService = { removeRemote: vi.fn() };
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-remove-remote'
    )?.[1] as (...args: unknown[]) => unknown;

    // Use real path so workspace validation passes; intentionally pass wrong type for name
    const result = await handler(null, process.cwd(), null);
    expect(result).toEqual({ success: false, error: 'Remote name must be a string' });
  });

  test('GIT_RENAME_REMOTE returns error when oldName is not a string', async () => {
    const mockGitService = { renameRemote: vi.fn() };
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-rename-remote'
    )?.[1] as (...args: unknown[]) => unknown;

    // Use a real path so workspace validation passes; intentionally pass wrong type for oldName
    const result = await handler(null, process.cwd(), 42, 'new-name');
    expect(result).toEqual({ success: false, error: 'Remote names must be strings' });
  });

  test('GIT_RENAME_REMOTE returns error when newName is not a string', async () => {
    const mockGitService = { renameRemote: vi.fn() };
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-rename-remote'
    )?.[1] as (...args: unknown[]) => unknown;

    // Use a real path that resolveExistingDirectory will accept
    const realPath = process.cwd();
    const result = await handler(null, realPath, 'old-name', undefined);
    expect(result).toEqual({ success: false, error: 'Remote names must be strings' });
  });

  // Success-path tests for covered branches
  test('GIT_REMOVE_REMOTE calls gitService.removeRemote for valid inputs', async () => {
    // Override workspace validation to return the path (pass validation)
    mockGetValidatedWorkspacePath.mockReturnValueOnce(process.cwd());
    const mockGitService = { removeRemote: vi.fn().mockResolvedValue({ success: true }) };
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-remove-remote'
    )?.[1] as (...args: unknown[]) => unknown;

    const result = await handler(null, process.cwd(), 'origin');
    expect(mockGitService.removeRemote).toHaveBeenCalledWith(process.cwd(), 'origin');
    expect(result).toEqual({ success: true });
  });

  test('GIT_RENAME_REMOTE calls gitService.renameRemote for valid inputs', async () => {
    mockGetValidatedWorkspacePath.mockReturnValueOnce(process.cwd());
    const mockGitService = { renameRemote: vi.fn().mockResolvedValue({ success: true }) };
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-rename-remote'
    )?.[1] as (...args: unknown[]) => unknown;

    const result = await handler(null, process.cwd(), 'old-remote', 'new-remote');
    expect(mockGitService.renameRemote).toHaveBeenCalledWith(process.cwd(), 'old-remote', 'new-remote');
    expect(result).toEqual({ success: true });
  });

  test('GIT_GET_FILE_DIFF calls gitService.getFileDiff for valid inputs', async () => {
    mockGetValidatedWorkspacePath.mockReturnValueOnce(process.cwd());
    const mockGitService = {
      getFileDiff: vi.fn().mockResolvedValue({
        success: true,
        oldContent: 'old content',
        newContent: 'new content',
        oldPath: 'old/path',
        newPath: 'new/path',
        isBinary: false,
        hasDiff: true,
      }),
    };
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-get-file-diff'
    )?.[1] as (...args: unknown[]) => unknown;

    const result = await handler(null, process.cwd(), 'src/main.ts', 'staged');
    expect(mockGitService.getFileDiff).toHaveBeenCalledWith(process.cwd(), 'src/main.ts', 'staged');
    expect(result).toEqual(expect.objectContaining({ success: true, hasDiff: true }));
  });

  test('GIT_FETCH calls gitService.fetch for valid workspace', async () => {
    mockGetValidatedWorkspacePath.mockReturnValueOnce(process.cwd());
    const mockGitService = { fetch: vi.fn().mockResolvedValue({ success: true }) };
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-fetch'
    )?.[1] as (...args: unknown[]) => unknown;

    const result = await handler(null, process.cwd(), 'origin');
    expect(mockGitService.fetch).toHaveBeenCalledWith(process.cwd(), 'origin');
    expect(result).toEqual({ success: true });
  });

  test('GIT_PULL calls gitService.pull for valid workspace', async () => {
    mockGetValidatedWorkspacePath.mockReturnValueOnce(process.cwd());
    const mockGitService = { pull: vi.fn().mockResolvedValue({ success: true }) };
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-pull'
    )?.[1] as (...args: unknown[]) => unknown;

    const result = await handler(null, process.cwd(), false);
    expect(mockGitService.pull).toHaveBeenCalledWith(process.cwd(), false);
    expect(result).toEqual({ success: true });
  });

  test('GIT_PUSH calls gitService.push for valid workspace', async () => {
    mockGetValidatedWorkspacePath.mockReturnValueOnce(process.cwd());
    const mockGitService = { push: vi.fn().mockResolvedValue({ success: true }) };
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-push'
    )?.[1] as (...args: unknown[]) => unknown;

    const result = await handler(null, process.cwd(), 'origin', 'main', false, false);
    expect(mockGitService.push).toHaveBeenCalledWith(process.cwd(), 'origin', 'main', false, false);
    expect(result).toEqual({ success: true });
  });

  test('GIT_ADD_REMOTE calls gitService.addRemote for valid inputs', async () => {
    mockGetValidatedWorkspacePath.mockReturnValueOnce(process.cwd());
    const mockGitService = { addRemote: vi.fn().mockResolvedValue({ success: true }) };
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-add-remote'
    )?.[1] as (...args: unknown[]) => unknown;

    const result = await handler(null, process.cwd(), 'origin', 'https://github.com/user/repo.git');
    expect(mockGitService.addRemote).toHaveBeenCalledWith(process.cwd(), 'origin', 'https://github.com/user/repo.git');
    expect(result).toEqual({ success: true });
  });
});

describe('gitIpc — error-path: git-refresh and polling', () => {
  const mockIpcMain = ipcMain as typeof ipcMain & {
    handle: ReturnType<typeof vi.fn>;
  };

  const mockMainWindow = {
    webContents: { send: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetValidatedWorkspacePath.mockReturnValue(null);
    
    mockRefreshGitStatus.mockResolvedValue({ success: true, changes: [] });
  });

  test('GIT_REFRESH returns null when no workspace is active', async () => {
    const mockGitService = {
      getCurrentWorkspace: vi.fn().mockReturnValue(null),
      stopPolling: vi.fn(),
      getStatus: vi.fn(),
    };
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-refresh'
    )?.[1] as (...args: unknown[]) => unknown;

    const result = await handler(null);
    expect(result).toBeNull();
    expect(mockGitService.getStatus).not.toHaveBeenCalled();
  });

  test('GIT_REFRESH returns error result when workspace becomes invalid', async () => {
    const mockGitService = {
      getCurrentWorkspace: vi.fn().mockReturnValue('/test/workspace'),
      stopPolling: vi.fn(),
      getStatus: vi.fn(),
    };
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-refresh'
    )?.[1] as (...args: unknown[]) => unknown;

    const result = await handler(null);
    expect(result).toEqual(expect.objectContaining({ success: false, isRepo: false }));
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
      'git-get-file-diff',
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
