/**
 * Git IPC Registration Tests
 *
 * Tests for the git IPC module, verifying channel registration and behavior.
 */

import { vi, type Mock } from 'vitest';
import { testHome } from '../../_helpers/tempPaths';

// Mock electron module
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
import { GitService, type GitStatusResult } from '../../../src/main/gitService';
import { WorkspaceRegistry } from '../../../src/main/workspaceRegistry';
import type { RemoteWorktreeRemovalPersistence } from '../../../src/main/remote/remoteWorktreeCoordinator';
import { remoteRemovalPaths } from '../../../src/main/remote/sshWorktreeRemoval';
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
    listWorktrees: vi.fn().mockResolvedValue({ success: true, worktrees: [] }),
    createWorktree: vi.fn().mockResolvedValue({ success: true, worktree: { path: 'C:\\tasks\\one', branch: 'one', isMain: false, isLocked: false, isPrunable: false } }),
    inspectWorktree: vi.fn().mockResolvedValue({ success: true, worktree: { path: 'C:\\tasks\\one', branch: 'one', isMain: false, isLocked: false, isPrunable: false }, hasChanges: false }),
    removeWorktree: vi.fn().mockResolvedValue({ success: true }),
    registerOpenWorkspace: vi.fn().mockReturnValue({ success: true }),
    unregisterOpenWorkspace: vi.fn(),
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
      'git-list-worktrees',
      'git-create-worktree',
      'git-inspect-worktree',
      'git-remove-worktree',
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

  test('registers exactly 39 git IPC handlers', () => {
    const mockGitService = createMockGitService();

    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => mockMainWindow as never,
    });

    const handleCalls = mockIpcMain.handle.mock.calls;
    expect(handleCalls.length).toBe(39);
  });

  test('validates worktree paths and returns POSIX paths across IPC', async () => {
    const service = createMockGitService();
    registerGitIpc({ getGitService: () => service as never, getMainWindow: () => mockMainWindow as never });
    const handler = (channel: string) => mockIpcMain.handle.mock.calls.find((call) => call[0] === channel)?.[1] as (...args: unknown[]) => Promise<unknown>;

    expect(await handler('git-create-worktree')(null, '/bad', 'main', 'one')).toEqual(expect.objectContaining({ success: false }));
    expect(service.createWorktree).not.toHaveBeenCalled();

    const validPath = process.cwd();
    expect(await handler('git-create-worktree')(null, validPath, 'main', 'one')).toEqual(expect.objectContaining({
      worktree: expect.objectContaining({ path: 'C:/tasks/one' }),
    }));
    expect(service.createWorktree).toHaveBeenCalledWith(validPath, 'main', 'one');
    expect(await handler('register-open-workspace')(null, 'tab-1', validPath)).toEqual({ success: true });
    expect(service.registerOpenWorkspace).toHaveBeenCalledWith('tab-1', validPath);
    expect(await handler('register-open-workspace')(null, '', validPath)).toEqual(expect.objectContaining({ success: false }));
    expect(await handler('register-open-workspace')(null, 'tab-2', 'relative/path')).toEqual(expect.objectContaining({ success: false }));
    expect(await handler('unregister-open-workspace')(null, 'tab-1')).toEqual({ success: true });
    expect(service.unregisterOpenWorkspace).toHaveBeenCalledWith('tab-1');
    expect(await handler('git-inspect-worktree')(null, validPath, validPath, [validPath])).toEqual(expect.objectContaining({
      worktree: expect.objectContaining({ path: 'C:/tasks/one' }),
    }));
    expect(service.inspectWorktree).toHaveBeenCalledWith(validPath, validPath, [validPath]);
    await handler('git-remove-worktree')(null, validPath, validPath, 'one', [validPath]);
    expect(service.removeWorktree).toHaveBeenCalledWith(validPath, validPath, 'one', [validPath]);
    const missingOpenPath = `${validPath}/deleted-workspace`;
    expect(await handler('git-inspect-worktree')(null, validPath, validPath, [missingOpenPath])).toEqual(expect.objectContaining({ success: true }));
    expect(service.inspectWorktree).toHaveBeenLastCalledWith(validPath, validPath, [expect.stringContaining('deleted-workspace')]);
    expect(await handler('git-remove-worktree')(null, validPath, validPath, 'one', [missingOpenPath])).toEqual(expect.objectContaining({ success: true }));
    expect(service.removeWorktree).toHaveBeenLastCalledWith(validPath, validPath, 'one', [expect.stringContaining('deleted-workspace')]);
    expect(await handler('git-remove-worktree')(null, validPath, validPath, 'one', ['relative/deleted-workspace'])).toEqual(expect.objectContaining({ success: false }));
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
    expect(handleCalls.length).toBe(78);
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

describe('Git IPC workspace identity routing', () => {
  const ipc = ipcMain as typeof ipcMain & { handle: Mock };
  const workspacePath = '/shared/workspace';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setup(getLiveRemoteTerminalPaths?: (environmentId: string) => string[] | null, remoteWorktreeRemovalPersistence?: RemoteWorktreeRemovalPersistence) {
    const statuses: GitStatusResult[] = [];
    const mainWindow = { webContents: { send: vi.fn() } };
    const makeEnvironment = (id: string) => ({
      id,
      validateWorkspacePath: vi.fn(async (workspacePath: string) => ({ valid: true, resolvedPath: workspacePath })),
      readFile: vi.fn(async () => ({ success: true, content: `${id} working tree` })),
      execGit: vi.fn(async (_cwd: string, args: string[]) => ({
        stdout: args[0] === 'status'
          ? `# branch.head ${id}\n`
          : args[0] === 'show' ? `${id} HEAD` : '',
        stderr: '',
      })),
    });
    const local = makeEnvironment('local');
    const remote = makeEnvironment('ssh');
    const registry = new WorkspaceRegistry((id) =>
      id === 'local' ? local as never : id === 'ssh' ? remote as never : null);
    const executions: Array<{ workspaceId?: string; environmentId?: string; command: string }> = [];
    const service = new GitService(
      (status) => statuses.push(status),
      undefined, undefined, undefined,
      async (cwd, args, _timeout, workspaceId, environmentId) => {
        executions.push({ workspaceId, environmentId, command: args[0] });
        const registered = workspaceId ? registry.getWorkspace(workspaceId) : null;
        if (workspaceId && (!registered || registered.location.path !== cwd ||
            registered.location.environmentId !== environmentId)) {
          throw new Error('Workspace identity is no longer registered');
        }
        return (registered?.environment ?? local).execGit(cwd, args);
      }
    );
    registerGitIpc({
      getGitService: () => service,
      getMainWindow: () => mainWindow as never,
      getWorkspaceRegistry: () => registry,
      getLiveRemoteTerminalPaths,
      remoteWorktreeRemovalPersistence,
    });
    const handle = (channel: string) =>
      ipc.handle.mock.calls.find(([name]) => name === channel)?.[1] as (...args: unknown[]) => Promise<unknown>;
    return { local, remote, registry, service, statuses, executions, mainWindow, handle };
  }

  test('legacy path-only history remains local', async () => {
    const { local, remote, handle } = setup();
    await handle('git-get-history')(null, process.cwd(), 4);
    expect(local.execGit).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['log', '-n4']));
    expect(remote.execGit).not.toHaveBeenCalled();
  });

  const savedRemoval = {
    operationId: '12345678-1234-1234-1234-123456789abc', environmentId: 'ssh', resourceId: 'ssh:host',
    workspacePath: '/srv/repo', worktreePath: '/srv/task',
  };

  test.each([
    ['damaged ID with plausible host paths', [{ ...savedRemoval, operationId: 'invalid' }]],
    ['null collection', null],
    ['object collection', {}],
    ['unreadable persistence', new Error('Read failed')],
    ['duplicate records', [savedRemoval, savedRemoval]],
    ['conflicting reservations', [savedRemoval, { ...savedRemoval, operationId: 'abcdef01-1234-1234-1234-123456789abc' }]],
  ])('blocks SSH registration before validation while preserving local access: %s', async (_label, evidence) => {
    const write = vi.fn();
    const read = () => {
      if (evidence instanceof Error) throw evidence;
      return evidence as ReturnType<RemoteWorktreeRemovalPersistence['read']>;
    };
    const { remote, local, registry, handle } = setup(undefined, { read, write });
    for (const environmentId of ['ssh', ' ssh ']) {
      expect(await handle('register-open-workspace')(null, 'blocked', '/srv/task', environmentId))
        .toMatchObject({ success: false, error: expect.stringContaining('Manual recovery required') });
      expect(registry.getWorkspace('blocked')).toBeNull();
    }
    expect(remote.validateWorkspacePath).not.toHaveBeenCalled();
    expect(remote.execGit).not.toHaveBeenCalled();
    for (const [index, environmentId] of [undefined, 'local', '', '  ', ' local '].entries()) {
      const id = `local-${index}`;
      expect(await handle('register-open-workspace')(null, id, process.cwd(), environmentId)).toMatchObject({ success: true });
      expect(registry.getWorkspace(id)?.location.environmentId).toBe('local');
    }
    await handle('git-get-history')(null, process.cwd(), 4, 'local-0');
    expect(local.execGit).toHaveBeenCalledWith(registry.getWorkspace('local-0')!.location.path, expect.arrayContaining(['log', '-n4']));
    expect(write).not.toHaveBeenCalled();
    if (Array.isArray(evidence) && evidence[0]?.operationId === savedRemoval.operationId) {
      for (const record of evidence) {
        for (const path of [record.worktreePath, ...Object.values(remoteRemovalPaths(record.worktreePath, record.operationId))]) {
          expect(registry.isRemotePathReserved('ssh', path)).toBe(true);
        }
      }
    }
  });

  test.each([{ evidence: [] }, { evidence: [savedRemoval] }])('keeps healthy persistence registration scoped to reserved paths: %j', async ({ evidence }) => {
    const write = vi.fn();
    const { remote, registry, handle } = setup(undefined, { read: () => evidence, write });
    expect(await handle('register-open-workspace')(null, 'safe', workspacePath, 'ssh')).toMatchObject({ success: true });
    expect(registry.getWorkspace('safe')?.location.environmentId).toBe('ssh');
    expect(remote.validateWorkspacePath).toHaveBeenCalledExactlyOnceWith(workspacePath);
    const result = await handle('register-open-workspace')(null, 'task', savedRemoval.worktreePath, 'ssh');
    expect(result).toMatchObject(evidence.length
      ? { success: false, error: expect.stringContaining('awaiting completion verification') }
      : { success: true });
    expect(registry.getWorkspace('task') !== null).toBe(evidence.length === 0);
    expect(write).not.toHaveBeenCalled();
  });

  test('registers Git IPC despite damaged removal state, blocks remote worktrees, and keeps local Git usable', async () => {
    const write = vi.fn();
    const { remote, local, registry, handle } = setup(undefined, { read: () => [null] as unknown as ReturnType<RemoteWorktreeRemovalPersistence['read']>, write });
    await registry.registerWorkspace({ workspaceId: 'ssh-tab', environmentId: 'ssh', workspacePath });
    const createWorktree = vi.fn();
    Object.assign(remote, { createWorktree });
    for (const [channel, args] of [
      ['git-list-worktrees', [workspacePath, 'ssh-tab']],
      ['git-create-worktree', [workspacePath, 'HEAD', 'task', 'ssh-tab']],
      ['git-inspect-worktree', [workspacePath, '/srv/task', [], 'ssh-tab']],
      ['git-remove-worktree', [workspacePath, '/srv/task', 'task', [], 'ssh-tab']],
      ['git-prune-worktrees', [workspacePath, 'ssh-tab']],
      ['git-unlock-worktree', [workspacePath, '/srv/task', 'ssh-tab']],
    ] as const) {
      expect(await handle(channel)(null, ...args)).toMatchObject({ success: false, error: expect.stringContaining('Manual recovery required') });
    }
    expect(createWorktree).not.toHaveBeenCalled();
    expect(remote.execGit).not.toHaveBeenCalled();
    await handle('git-get-history')(null, process.cwd(), 4);
    expect(local.execGit).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['log', '-n4']));
    expect(write).not.toHaveBeenCalled();
  });

  test('discovers remote worktrees through the registered identity and keeps mutations disabled', async () => {
    const { local, remote, handle } = setup();
    await handle('register-open-workspace')(null, 'ssh-tab', workspacePath, 'ssh');
    remote.execGit.mockResolvedValueOnce({ stdout: 'worktree /srv/repo\0branch refs/heads/main\0\0worktree /srv/Repo-task\0branch refs/heads/task\0locked reason\0\0', stderr: '' });
    const result = await handle('git-list-worktrees')(null, '/forged/local/path', 'ssh-tab');
    expect(result).toMatchObject({ success: true, worktrees: [
      { path: '/srv/repo', isMain: true, branch: 'main' },
      { path: '/srv/Repo-task', isMain: false, branch: 'task', isLocked: true },
    ] });
    expect(remote.execGit).toHaveBeenCalledWith(workspacePath, ['worktree', 'list', '--porcelain', '-z']);
    expect(local.execGit).not.toHaveBeenCalled();
    expect(await handle('git-create-worktree')(null, workspacePath, 'main', 'task', 'ssh-tab')).toMatchObject({ success: false });
    expect(await handle('git-inspect-worktree')(null, workspacePath, '/srv/Repo-task', [], 'ssh-tab')).toMatchObject({ success: false });
    expect(await handle('git-remove-worktree')(null, workspacePath, '/srv/Repo-task', 'task', [], 'ssh-tab')).toMatchObject({ success: false });
    expect(remote.execGit).toHaveBeenCalledTimes(1);
    await expect(handle('git-list-worktrees')(null, workspacePath, 'unregistered')).rejects.toThrow('no longer registered');
  });

  describe('worktree prune and unlock on SSH', () => {
    const MAIN = 'worktree /srv/repo\0branch refs/heads/main\0\0';
    const STALE = 'worktree /srv/Repo-gone\0branch refs/heads/gone\0prunable gitdir file points to non-existent location\0\0';
    const LOCKED = 'worktree /srv/Repo-task\0branch refs/heads/task\0locked reason\0\0';
    const OPEN = 'worktree /srv/Repo-open\0branch refs/heads/open\0\0';

    const wire = (remote: ReturnType<typeof setup>['remote'], lists: string[]) => {
      const queue = [...lists];
      remote.execGit.mockImplementation(async (_cwd: string, args: string[]) =>
        ({ stdout: args[0] === 'worktree' && args[1] === 'list' ? queue.shift() ?? '' : '', stderr: '' }));
    };
    const mutations = (remote: ReturnType<typeof setup>['remote']) =>
      remote.execGit.mock.calls.filter(([, args]) => args[0] === 'worktree' && args[1] !== 'list');

    test('prune runs on the registered host from the workspace root, never from a forged path', async () => {
      const { local, remote, handle } = setup();
      await handle('register-open-workspace')(null, 'ssh-tab', workspacePath, 'ssh');
      wire(remote, [MAIN + STALE, MAIN]);
      const result = await handle('git-prune-worktrees')(null, '/forged/local/path', 'ssh-tab');
      expect(result).toEqual({ success: true, pruned: ['/srv/Repo-gone'] });
      expect(mutations(remote).map(([cwd, args]) => [cwd, args])).toEqual([[workspacePath, ['worktree', 'prune', '--expire', 'now']]]);
      expect(local.execGit).not.toHaveBeenCalled();
    });

    test('prune with nothing stale runs no mutation', async () => {
      const { remote, handle } = setup();
      await handle('register-open-workspace')(null, 'ssh-tab', workspacePath, 'ssh');
      wire(remote, [MAIN + OPEN]);
      expect(await handle('git-prune-worktrees')(null, workspacePath, 'ssh-tab')).toEqual({ success: true, pruned: [] });
      expect(mutations(remote)).toHaveLength(0);
    });

    test('unlock validates the target against the host list and unlocks Git\'s listed path', async () => {
      const { remote, handle } = setup();
      await handle('register-open-workspace')(null, 'ssh-tab', workspacePath, 'ssh');
      wire(remote, [MAIN + LOCKED]);
      expect(await handle('git-unlock-worktree')(null, workspacePath, '/srv/Repo-task', 'ssh-tab')).toEqual({ success: true });
      expect(mutations(remote).map(([cwd, args]) => [cwd, args])).toEqual([[workspacePath, ['worktree', 'unlock', '/srv/Repo-task']]]);
    });

    test.each([
      ['the main checkout', '/srv/repo'],
      ['an unlisted path', '/srv/elsewhere'],
      ['a path that only normalizes to a listed one', '/srv/other/../Repo-task'],
      ['an unlocked linked worktree', '/srv/Repo-open'],
    ])('unlock refuses %s without running Git', async (_label, target) => {
      const { remote, handle } = setup();
      await handle('register-open-workspace')(null, 'ssh-tab', workspacePath, 'ssh');
      wire(remote, [MAIN + LOCKED + OPEN]);
      expect(await handle('git-unlock-worktree')(null, workspacePath, target, 'ssh-tab')).toMatchObject({ success: false });
      expect(mutations(remote)).toHaveLength(0);
    });

    test('an unregistered workspace identity is rejected before any host command', async () => {
      const { remote, handle } = setup();
      await expect(handle('git-prune-worktrees')(null, workspacePath, 'nope')).rejects.toThrow('no longer registered');
      await expect(handle('git-unlock-worktree')(null, workspacePath, '/srv/x', 'nope')).rejects.toThrow('no longer registered');
      expect(remote.execGit).not.toHaveBeenCalled();
    });
  });

  test.each(['relative/path', '/srv/../escape'])('rejects malformed remote worktree path %s',async (worktreePath) => {
    const { remote, handle } = setup();
    await handle('register-open-workspace')(null, 'ssh-tab', workspacePath, 'ssh');
    remote.execGit.mockResolvedValueOnce({ stdout: `worktree ${worktreePath}\0branch refs/heads/main\0\0`, stderr: '' });
    expect(await handle('git-list-worktrees')(null, workspacePath, 'ssh-tab')).toMatchObject({ success: false, worktrees: [], error: expect.stringContaining('invalid remote worktree path') });
  });

  test('creates on the registered SSH environment without invoking local worktree code', async () => {
    const { local, remote, registry, service, handle } = setup();
    const createWorktree = vi.fn().mockResolvedValue({ success: true, worktree: { path: '/srv/Repo-worktrees/task', branch: 'task', isMain: false, isLocked: false, isPrunable: false } });
    Object.assign(remote, { createWorktree });
    const localCreate = vi.spyOn(service, 'createWorktree');
    await handle('register-open-workspace')(null, 'ssh-tab', workspacePath, 'ssh');
    expect(await handle('git-create-worktree')(null, '/forged/local/path', 'HEAD', 'task', 'ssh-tab')).toMatchObject({ success: true, worktree: { path: '/srv/Repo-worktrees/task' } });
    expect(createWorktree).toHaveBeenCalledWith(workspacePath, 'HEAD', 'task');
    expect(localCreate).not.toHaveBeenCalled();
    expect(local.execGit).not.toHaveBeenCalled();
    await registry.unregisterWorkspace('ssh-tab');
    await expect(handle('git-create-worktree')(null, workspacePath, 'HEAD', 'other', 'ssh-tab')).rejects.toThrow('no longer registered');
    expect(createWorktree).toHaveBeenCalledTimes(1);
  });

  const sshTask = { path: '/srv/Repo-worktrees/task', branch: 'task', isMain: false, isLocked: false, isPrunable: false };
  const sshListing = (...extra: string[]) => ({
    stdout: `worktree ${workspacePath}\0branch refs/heads/main\0\0${extra.join('')}`,
    stderr: '',
  });
  const sshListed = `worktree ${sshTask.path}\0branch refs/heads/task\0\0`;
  const attach = { attachCheckoutContext: true };

  test('passing the id of an open repository workspace without opting in attaches no context (legacy New Workspace flow)', async () => {
    const { registry, remote, handle } = setup();
    Object.assign(remote, { createWorktree: vi.fn().mockResolvedValue({ success: true, worktree: { ...sshTask } }) });
    await handle('register-open-workspace')(null, 'ssh-tab', workspacePath, 'ssh');
    remote.execGit.mockClear();

    for (const options of [undefined, {}, { attachCheckoutContext: false }, { attachCheckoutContext: 'yes' }, null]) {
      const result = await handle('git-create-worktree')(null, workspacePath, 'HEAD', 'task', 'ssh-tab', options);
      expect(result).toEqual({ success: true, worktree: sshTask });
    }
    expect(registry.getCheckoutContextsForWorkspace('ssh-tab')).toHaveLength(1);
    expect(remote.execGit).not.toHaveBeenCalled();
  });

  test('asking to attach without a registered workspace fails before anything is created', async () => {
    const { service, handle } = setup();
    const localCreate = vi.spyOn(service, 'createWorktree');
    expect(await handle('git-create-worktree')(null, process.cwd(), 'main', 'task', undefined, attach))
      .toMatchObject({ success: false, error: expect.stringContaining('registered workspace is required') });
    expect(localCreate).not.toHaveBeenCalled();
  });

  describe('workspace-scoped worktree creation attaches a checkout context', () => {
    async function sshWorkspace(listing: { stdout: string; stderr: string } | Error = sshListing(sshListed)) {
      const f = setup();
      const createWorktree = vi.fn().mockResolvedValue({ success: true, worktree: { ...sshTask } });
      Object.assign(f.remote, { createWorktree });
      if (listing instanceof Error) f.remote.execGit.mockRejectedValue(listing);
      else f.remote.execGit.mockResolvedValue(listing);
      await f.handle('register-open-workspace')(null, 'ssh-tab', workspacePath, 'ssh');
      return { ...f, createWorktree };
    }

    test('SSH: registers an independently validated context under the existing workspace without widening its root', async () => {
      const { registry, remote, handle } = await sshWorkspace();
      remote.validateWorkspacePath.mockClear();

      const result = await handle('git-create-worktree')(null, workspacePath, 'HEAD', 'task', 'ssh-tab', attach);

      expect(result).toMatchObject({
        success: true,
        worktree: { path: sshTask.path, branch: 'task' },
        checkoutContext: {
          workspaceId: 'ssh-tab', environmentId: 'ssh', path: sshTask.path, kind: 'worktree',
          branch: 'task', mainCheckoutPath: workspacePath,
        },
      });
      // The worktree root went through the environment's own validation, not the workspace's.
      expect(remote.validateWorkspacePath).toHaveBeenCalledExactlyOnceWith(sshTask.path);
      // One workspace, root unchanged; two contexts; the sibling is not reachable from the main one.
      expect(registry.getAllWorkspaces().map((entry) => entry.location.path)).toEqual([workspacePath]);
      expect(registry.getCheckoutContextsForWorkspace('ssh-tab').map((entry) => entry.path)).toEqual([workspacePath, sshTask.path]);
      expect(registry.resolveCheckoutContext('ssh-tab')?.path).toBe(workspacePath);
      const returned = (result as { checkoutContext: { id: string } }).checkoutContext;
      expect(registry.getCheckoutContext(returned.id)).toMatchObject({ path: sshTask.path });
    });

    test('SSH: derives branch and main checkout from Git metadata, not from the create result or arguments', async () => {
      const listing = sshListing(`worktree ${sshTask.path}\0branch refs/heads/from-git\0\0`);
      const { handle } = await sshWorkspace(listing);
      const result = await handle('git-create-worktree')(null, '/forged/path', 'HEAD', 'task', 'ssh-tab', attach);
      expect(result).toMatchObject({ checkoutContext: { branch: 'from-git', mainCheckoutPath: workspacePath, path: sshTask.path } });
    });

    test.each([
      ['Git does not list the created path as a linked worktree', sshListing(`worktree /srv/elsewhere\0branch refs/heads/task\0\0`)],
      ['Git lists it only as the main worktree', { stdout: `worktree ${sshTask.path}\0branch refs/heads/task\0\0`, stderr: '' }],
      ['Git cannot list worktrees', new Error('ssh dropped')],
    ])('SSH: keeps the created checkout and reports a partial result when %s', async (_label, listing) => {
      const { registry, createWorktree, handle } = await sshWorkspace(listing);
      const result = await handle('git-create-worktree')(null, workspacePath, 'HEAD', 'task', 'ssh-tab', attach);

      expect(result).toMatchObject({
        success: false, created: true, worktree: { path: sshTask.path, branch: 'task' },
        error: expect.stringContaining('could not be attached'),
      });
      expect(result).not.toHaveProperty('checkoutContext');
      expect(createWorktree).toHaveBeenCalledTimes(1);
      expect(registry.getCheckoutContextsForWorkspace('ssh-tab')).toHaveLength(1);
    });

    test('SSH: a root that became reserved for removal is not attached, and nothing is deleted', async () => {
      const { registry, remote, handle } = await sshWorkspace();
      const removeWorktree = vi.fn();
      Object.assign(remote, { removeWorktree });
      registry.reserveRemotePaths('ssh', [sshTask.path]);

      const result = await handle('git-create-worktree')(null, workspacePath, 'HEAD', 'task', 'ssh-tab', attach);

      expect(result).toMatchObject({ success: false, created: true, worktree: { path: sshTask.path } });
      expect(registry.getCheckoutContextsForWorkspace('ssh-tab')).toHaveLength(1);
      expect(removeWorktree).not.toHaveBeenCalled();
    });

    test('SSH: a workspace closed while the create was in flight gets no context', async () => {
      const { registry, createWorktree, handle } = await sshWorkspace();
      createWorktree.mockImplementationOnce(async () => {
        registry.unregisterWorkspace('ssh-tab');
        return { success: true, worktree: { ...sshTask } };
      });
      const result = await handle('git-create-worktree')(null, workspacePath, 'HEAD', 'task', 'ssh-tab', attach);
      expect(result).toMatchObject({ success: false, created: true });
      expect(registry.getAllCheckoutContexts()).toEqual([]);
    });

    test('a failed create attaches nothing and is not reported as created', async () => {
      const { registry, createWorktree, handle } = await sshWorkspace();
      createWorktree.mockResolvedValueOnce({ success: false, error: 'branch exists' });
      const result = await handle('git-create-worktree')(null, workspacePath, 'HEAD', 'task', 'ssh-tab', attach);
      expect(result).toEqual({ success: false, error: 'branch exists' });
      expect(registry.getCheckoutContextsForWorkspace('ssh-tab')).toHaveLength(1);
    });

    test('contexts attach only to the workspace named by the call, never to another workspace', async () => {
      const { registry, remote, handle } = await sshWorkspace();
      await handle('register-open-workspace')(null, 'other-tab', '/srv/other', 'ssh');
      remote.execGit.mockResolvedValue({ stdout: `worktree /srv/other\0branch refs/heads/main\0\0${sshListed}`, stderr: '' });

      const result = await handle('git-create-worktree')(null, workspacePath, 'HEAD', 'task', 'ssh-tab', attach) as { checkoutContext?: { id: string } };

      expect(registry.getCheckoutContextsForWorkspace('other-tab')).toHaveLength(1);
      expect(registry.resolveCheckoutContext('other-tab', result.checkoutContext?.id)).toBeNull();
    });
  });

  test('inspects using authoritative same-host workspace and terminal activity', async () => {
    const terminalPaths = vi.fn().mockReturnValue(['/srv/other/src']);
    const { remote, local, handle } = setup(terminalPaths);
    const inspectWorktree = vi.fn().mockResolvedValue({ success: true, hasChanges: false, worktree: { path: '/srv/task', branch: 'task', isMain: false, isLocked: false, isPrunable: false } });
    Object.assign(remote, { inspectWorktree });
    await handle('register-open-workspace')(null, 'source', workspacePath, 'ssh');
    await handle('register-open-workspace')(null, 'same-host', '/srv/other', 'ssh');
    await handle('register-open-workspace')(null, 'local-tab', '/srv/local', 'local');
    expect(await handle('git-inspect-worktree')(null, '/forged', '/srv/task', ['/untrusted'], 'source')).toMatchObject({ success: true });
    expect(inspectWorktree).toHaveBeenCalledWith(workspacePath, '/srv/task', [workspacePath, '/srv/other', '/srv/other/src'].sort());
    expect(terminalPaths).toHaveBeenCalledWith('ssh');
    expect(local.execGit).not.toHaveBeenCalled();
    expect(await handle('git-remove-worktree')(null, workspacePath, '/srv/task', 'task', [], 'source')).toMatchObject({ success: false });
  });

  test('refuses unverifiable terminals and invalidates inspection when activity changes in flight', async () => {
    const terminalPaths = vi.fn<() => string[] | null>().mockReturnValue(null);
    const { remote, handle } = setup(terminalPaths);
    let resolve!: (result: { success: boolean }) => void;
    const inspectWorktree = vi.fn().mockImplementation(() => new Promise((done) => { resolve = done; }));
    Object.assign(remote, { inspectWorktree });
    await handle('register-open-workspace')(null, 'source', workspacePath, 'ssh');
    expect(await handle('git-inspect-worktree')(null, workspacePath, '/srv/task', [], 'source')).toMatchObject({ success: false, error: expect.stringContaining('could not be verified') });
    expect(inspectWorktree).not.toHaveBeenCalled();
    terminalPaths.mockReturnValue([]);
    const pending = handle('git-inspect-worktree')(null, workspacePath, '/srv/task', [], 'source');
    terminalPaths.mockReturnValue(['/srv/task']);
    resolve({ success: true });
    expect(await pending).toMatchObject({ success: false, error: expect.stringContaining('changed during inspection') });
  });

  test('routes removal through the registered host and reconciles uncertain completion on refresh', async () => {
    const { remote, local, registry, handle } = setup();
    const worktree = { path: '/srv/task', branch: 'task', isMain: false, isLocked: false, isPrunable: false };
    const inspectWorktree = vi.fn().mockResolvedValue({ success: true, worktree, hasChanges: false });
    const removeWorktree = vi.fn().mockResolvedValue({ success: false, uncertain: true, error: 'SSH disconnected' });
    const waitForWorktreeOperations = vi.fn().mockResolvedValue(undefined);
    Object.assign(remote, { inspectWorktree, removeWorktree, waitForWorktreeOperations });
    await handle('register-open-workspace')(null, 'source', workspacePath, 'ssh');
    expect(await handle('git-remove-worktree')(null, '/forged', '/srv/task', 'task', ['/untrusted'], 'source')).toMatchObject({ success: false });
    expect(removeWorktree).toHaveBeenCalledWith(workspacePath, '/srv/task', 'task', [workspacePath], expect.any(String));
    expect(registry.isRemotePathReserved('ssh', '/srv/task')).toBe(true);
    expect(await handle('git-list-worktrees')(null, '/forged', 'source')).toMatchObject({ success: true });
    expect(waitForWorktreeOperations).toHaveBeenCalledWith(workspacePath, removeWorktree.mock.calls[0][4]);
    expect(registry.isRemotePathReserved('ssh', '/srv/task')).toBe(false);
    expect(local.execGit).not.toHaveBeenCalled();
  });

  test('same-path operations retain their environment across overlapping Git commands', async () => {
    const { local, remote, handle, executions, mainWindow } = setup();
    expect(await handle('register-open-workspace')(null, 'local-tab', workspacePath, 'local'))
      .toEqual({
        success: true,
        location: { environmentId: 'local', path: workspacePath },
        checkoutContext: { id: 'local-tab::main', workspaceId: 'local-tab', environmentId: 'local', path: workspacePath, kind: 'main' },
      });
    expect(await handle('register-open-workspace')(null, 'ssh-tab', workspacePath, 'ssh'))
      .toEqual({
        success: true,
        location: { environmentId: 'ssh', path: workspacePath },
        checkoutContext: { id: 'ssh-tab::main', workspaceId: 'ssh-tab', environmentId: 'ssh', path: workspacePath, kind: 'main' },
      });

    let releaseRemote!: () => void;
    const delayed = new Promise<void>((resolve) => { releaseRemote = resolve; });
    remote.execGit.mockImplementationOnce(async () => {
      await delayed;
      return { stdout: '', stderr: '' };
    });
    const remoteHistory = handle('git-get-history')(null, workspacePath, 4, 'ssh-tab');
    await Promise.resolve();
    await handle('git-get-history')(null, workspacePath, 4, 'local-tab');
    releaseRemote();
    await remoteHistory;

    expect(executions.filter(({ command }) => command === 'log')).toEqual([
      { workspaceId: 'ssh-tab', environmentId: 'ssh', command: 'log' },
      { workspaceId: 'local-tab', environmentId: 'local', command: 'log' },
    ]);
    expect(remote.execGit).toHaveBeenCalledTimes(1);
    expect(local.execGit).toHaveBeenCalledTimes(1);
    await handle('git-get-history')(null, '/caller/path/does/not/exist', 4, 'ssh-tab');
    expect(remote.execGit).toHaveBeenLastCalledWith(workspacePath, expect.arrayContaining(['log', '-n4']));

    const diff = await handle('git-get-file-diff')(null, workspacePath, 'tracked.txt', 'working', 'ssh-tab');
    expect(diff).toEqual(expect.objectContaining({
      success: true, oldContent: 'ssh HEAD', newContent: 'ssh working tree',
    }));
    expect(remote.readFile).toHaveBeenCalledWith({
      workspacePath, workspaceId: 'ssh-tab', filePath: `${workspacePath}/tracked.txt`,
    });
    expect(local.readFile).not.toHaveBeenCalled();

    expect(await handle('git-stage')(null, workspacePath, ['tracked.txt'], 'ssh-tab')).toEqual({ success: true });
    expect(mainWindow.webContents.send).toHaveBeenLastCalledWith('git-status-update',
      expect.objectContaining({ workspaceId: 'ssh-tab', environmentId: 'ssh', workspacePath, currentBranch: 'ssh' }));
    expect(await handle('git-push')(null, workspacePath, 'origin', 'main', false, true, 'ssh-tab')).toEqual({ success: true });
    expect(remote.execGit).toHaveBeenCalledWith(workspacePath, ['push', '--set-upstream', 'origin', 'main']);
    expect(await handle('git-list-worktrees')(null, workspacePath, 'ssh-tab')).toEqual(expect.objectContaining({ success: true }));
    expect(await handle('git-create-worktree')(null, workspacePath, 'main', 'task', 'ssh-tab')).toEqual(expect.objectContaining({ success: false }));
    await expect(handle('git-get-branch-state')(null, workspacePath, 'stale-tab'))
      .rejects.toThrow('Workspace identity is no longer registered');
    await expect(handle('git-get-history')(null, workspacePath, 4, 'stale-tab'))
      .rejects.toThrow('Workspace identity is no longer registered');
  });

  test('rapid same-path polling switch discards stale status without stopping the other workspace', async () => {
    const { local, remote, handle, statuses, service, mainWindow } = setup();
    await handle('register-open-workspace')(null, 'local-tab', workspacePath, 'local');
    await handle('register-open-workspace')(null, 'ssh-tab', workspacePath, 'ssh');
    let releaseLocal!: () => void;
    const delayed = new Promise<void>((resolve) => { releaseLocal = resolve; });
    local.execGit.mockImplementationOnce(async () => {
      await delayed;
      return { stdout: '# branch.head local\n', stderr: '' };
    });
    try {
      await handle('git-start-polling')(null, workspacePath, 'local-tab');
      await handle('git-start-polling')(null, workspacePath, 'ssh-tab');
      releaseLocal();
      await service.drain();
      expect(statuses.map(({ workspaceId, environmentId, currentBranch }) =>
        ({ workspaceId, environmentId, currentBranch }))).toEqual([
        { workspaceId: 'ssh-tab', environmentId: 'ssh', currentBranch: 'ssh' },
      ]);
      expect(await handle('git-refresh')(null, 'ssh-tab')).toEqual(expect.objectContaining({
        workspaceId: 'ssh-tab', environmentId: 'ssh', currentBranch: 'ssh',
      }));
      expect(await handle('git-refresh')(null, 'local-tab')).toBeNull();
      await handle('git-stop-polling')(null, 'local-tab');
      expect(service.getCurrentWorkspaceIdentity()?.workspaceId).toBe('ssh-tab');
      await handle('git-stage')(null, workspacePath, ['local.txt'], 'local-tab');
      expect(local.execGit).toHaveBeenCalledWith(workspacePath, ['add', '--', 'local.txt']);
      expect(remote.execGit).not.toHaveBeenCalledWith(workspacePath, ['add', '--', 'local.txt']);
      expect(mainWindow.webContents.send).toHaveBeenLastCalledWith('git-status-update',
        expect.objectContaining({ workspaceId: 'local-tab', environmentId: 'local', currentBranch: 'local' }));
      expect(service.getCurrentWorkspaceIdentity()?.workspaceId).toBe('ssh-tab');
      await handle('unregister-open-workspace')(null, 'local-tab');
      expect(service.getCurrentWorkspaceIdentity()?.workspaceId).toBe('ssh-tab');
      await handle('unregister-open-workspace')(null, 'ssh-tab');
      expect(service.getCurrentWorkspace()).toBeNull();
      await expect(handle('git-get-history')(null, workspacePath, 4, 'ssh-tab'))
        .rejects.toThrow('Workspace identity is no longer registered');
    } finally {
      releaseLocal();
      service.stopPolling();
      await service.drain();
    }
  });
});
