/**
 * Debug test - check what gitIpc.ts actually returns
 */
import { vi, describe, test, expect, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { registerGitIpc } from '../../../src/main/ipc/gitIpc';

vi.mock('electron', () => ({
  app: {
    disableHardwareAcceleration: vi.fn(),
    getPath: vi.fn((name: string) => {
      if (name === 'home') return '/home/test';
      return `/mock/${name}`;
    }),
    commandLine: { appendSwitch: vi.fn() },
    whenReady: vi.fn(() => new Promise<never>(() => {})),
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
    webContents: { send: vi.fn() },
    contentView: { addChildView: vi.fn() },
  })),
  Menu: Object.assign(vi.fn(), { setApplicationMenu: vi.fn() }),
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
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

const { mockGetValidatedWorkspacePath, mockGetInvalidWorkspaceResult, mockRefreshGitStatus } = vi.hoisted(() => ({
  mockGetValidatedWorkspacePath: vi.fn(),
  mockGetInvalidWorkspaceResult: vi.fn(() => ({ success: false, error: 'Invalid workspace path' })),
  mockRefreshGitStatus: vi.fn(),
}));

vi.mock('../../../src/main/ipc/aiCommitIpc', () => ({
  getValidatedWorkspacePath: mockGetValidatedWorkspacePath,
  getInvalidWorkspaceResult: mockGetInvalidWorkspaceResult,
  refreshGitStatus: mockRefreshGitStatus,
}));

const mockIpcMain = ipcMain as typeof ipcMain & { handle: ReturnType<typeof vi.fn> };

describe('debug coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetValidatedWorkspacePath.mockImplementation((path: string) => {
      // Return the path if it's truthy (simulates valid directory)
      return path ? path : null;
    });
    mockGetInvalidWorkspaceResult.mockReturnValue({ success: false, error: 'Invalid workspace path' });
    mockRefreshGitStatus.mockResolvedValue({ success: true, changes: [] });
  });
  
  test('GIT_REMOVE_REMOTE - returns correct result', async () => {
    const removeRemoteFn = vi.fn().mockResolvedValue({ success: true });
    const mockGitService = {
      removeRemote: removeRemoteFn,
    };
    
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => null as never,
    });
    
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-remove-remote'
    )?.[1] as (...args: unknown[]) => unknown;
    
    const result = await handler(null, '/valid/path', 'origin');
    
    // Inspect result type
    expect(result).toEqual({ success: true });
    expect(typeof result).toBe('object');
    expect(removeRemoteFn).toHaveBeenCalledWith('/valid/path', 'origin');
  });
  
  test('GIT_RENAME_REMOTE - returns correct result', async () => {
    const renameRemoteFn = vi.fn().mockResolvedValue({ success: true });
    const mockGitService = {
      renameRemote: renameRemoteFn,
    };
    
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => null as never,
    });
    
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-rename-remote'
    )?.[1] as (...args: unknown[]) => unknown;
    
    const result = await handler(null, '/valid/path', 'old', 'new');
    
    expect(result).toEqual({ success: true });
    expect(renameRemoteFn).toHaveBeenCalledWith('/valid/path', 'old', 'new');
  });
  
  test('GIT_GET_FILE_DIFF - returns correct result', async () => {
    const getFileDiffFn = vi.fn().mockResolvedValue({
      success: true,
      oldContent: 'old',
      newContent: 'new',
      oldPath: 'a',
      newPath: 'b',
      isBinary: false,
      hasDiff: true,
    });
    const mockGitService = {
      getFileDiff: getFileDiffFn,
    };
    
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => null as never,
    });
    
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-get-file-diff'
    )?.[1] as (...args: unknown[]) => unknown;
    
    const result = await handler(null, '/valid/path', 'file.ts', 'staged');
    
    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(getFileDiffFn).toHaveBeenCalledWith('/valid/path', 'file.ts', 'staged');
  });
  
  test('GIT_FETCH - returns correct result', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ success: true });
    const mockGitService = {
      fetch: fetchFn,
    };
    
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => null as never,
    });
    
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-fetch'
    )?.[1] as (...args: unknown[]) => unknown;
    
    const result = await handler(null, '/valid/path', 'origin');
    
    expect(result).toEqual({ success: true });
    expect(fetchFn).toHaveBeenCalled();
  });
  
  test('GIT_PULL - returns correct result', async () => {
    const pullFn = vi.fn().mockResolvedValue({ success: true });
    const mockGitService = {
      pull: pullFn,
    };
    
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => null as never,
    });
    
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-pull'
    )?.[1] as (...args: unknown[]) => unknown;
    
    const result = await handler(null, '/valid/path', false);
    
    expect(result).toEqual({ success: true });
    expect(pullFn).toHaveBeenCalled();
  });
  
  test('GIT_PUSH - returns correct result', async () => {
    const pushFn = vi.fn().mockResolvedValue({ success: true });
    const mockGitService = {
      push: pushFn,
    };
    
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => null as never,
    });
    
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-push'
    )?.[1] as (...args: unknown[]) => unknown;
    
    const result = await handler(null, '/valid/path', 'origin', 'main', false, false);
    
    expect(result).toEqual({ success: true });
    expect(pushFn).toHaveBeenCalled();
  });
  
  test('GIT_ADD_REMOTE - returns correct result', async () => {
    const addRemoteFn = vi.fn().mockResolvedValue({ success: true });
    const mockGitService = {
      addRemote: addRemoteFn,
    };
    
    registerGitIpc({
      getGitService: () => mockGitService as never,
      getMainWindow: () => null as never,
    });
    
    const handler = mockIpcMain.handle.mock.calls.find(
      (call) => call[0] === 'git-add-remote'
    )?.[1] as (...args: unknown[]) => unknown;
    
    const result = await handler(null, '/valid/path', 'origin', 'https://github.com/user/repo.git');
    
    expect(result).toEqual({ success: true });
    expect(addRemoteFn).toHaveBeenCalled();
  });
});
