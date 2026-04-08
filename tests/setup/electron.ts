import { vi } from 'vitest';

export type ElectronApiMock = {
  [K in keyof Window['electronAPI']]: ReturnType<typeof vi.fn>;
};

const createAsyncMock = <T>(result: T) => vi.fn().mockResolvedValue(result);

export function createElectronApiMock(overrides: Partial<ElectronApiMock> = {}): ElectronApiMock {
  return {
    getLastWorkspace: createAsyncMock(''),
    openDirectoryDialog: createAsyncMock(null),
    readDirectory: createAsyncMock([]),
    getShowFastfetch: createAsyncMock(false),
    setShowFastfetch: createAsyncMock(undefined),
    getAiCommitSettings: createAsyncMock({ enabled: false, provider: 'codex', model: '' }),
    setAiCommitEnabled: createAsyncMock(undefined),
    setAiCommitProvider: createAsyncMock(undefined),
    setAiCommitModel: createAsyncMock(undefined),
    spawnTerminal: createAsyncMock({ id: 'terminal-1', pid: 1001 }),
    getTerminalBuffer: createAsyncMock(''),
    writeTerminal: createAsyncMock(undefined),
    resizeTerminal: createAsyncMock(undefined),
    killTerminal: createAsyncMock(undefined),
    onTerminalData: vi.fn(() => () => undefined),
    onTerminalExit: vi.fn(() => () => undefined),
    browserHide: createAsyncMock(undefined),
    browserSetBounds: createAsyncMock(undefined),
    browserNavigate: createAsyncMock(true),
    browserBack: createAsyncMock(undefined),
    browserForward: createAsyncMock(undefined),
    browserRefresh: createAsyncMock(undefined),
    browserStop: createAsyncMock(undefined),
    browserDisposeWorkspace: createAsyncMock(undefined),
    openExternal: createAsyncMock(true),
    canGoBack: createAsyncMock(false),
    canGoForward: createAsyncMock(false),
    minimizeWindow: createAsyncMock(undefined),
    toggleMaximizeWindow: createAsyncMock(undefined),
    closeWindow: createAsyncMock(undefined),
    isMaximizedWindow: createAsyncMock(false),
    getHarnessOptions: createAsyncMock({}),
    getHarnessModels: createAsyncMock([]),
    onFitAllPanes: vi.fn(() => () => undefined),
    onBrowserUrlUpdated: vi.fn(() => () => undefined),
    gitStartPolling: createAsyncMock(undefined),
    gitStopPolling: createAsyncMock(undefined),
    generateCommitMessage: createAsyncMock({ success: true, message: 'chore: test fixture' }),
    gitStage: createAsyncMock({ success: true }),
    gitUnstage: createAsyncMock({ success: true }),
    gitCommit: createAsyncMock({ success: true }),
    gitGetBranchState: createAsyncMock({ success: true, isRepo: false, currentBranch: null, isDetached: false, branches: [] }),
    gitGetOperationState: createAsyncMock({ success: true, isRepo: false, inProgress: false, mode: 'none', conflicts: [], message: 'Not a git repository' }),
    gitGetStashes: createAsyncMock([]),
    gitGetHistory: createAsyncMock([]),
    gitGetDiff: createAsyncMock({ success: true, output: '', title: 'Working tree diff' }),
    gitCreateBranch: createAsyncMock({ success: true }),
    gitSwitchBranch: createAsyncMock({ success: true }),
    gitDeleteBranch: createAsyncMock({ success: true }),
    gitMergeBranch: createAsyncMock({ success: true }),
    gitAbortOperation: createAsyncMock({ success: true }),
    gitStash: createAsyncMock({ success: true }),
    gitApplyStash: createAsyncMock({ success: true }),
    gitPopStash: createAsyncMock({ success: true }),
    gitDropStash: createAsyncMock({ success: true }),
    gitClearStashes: createAsyncMock({ success: true }),
    gitRefresh: createAsyncMock(null),
    gitGetRemotes: createAsyncMock({ success: true, remotes: [], provider: 'unknown' }),
    gitFetch: createAsyncMock({ success: true }),
    gitPull: createAsyncMock({ success: true }),
    gitPush: createAsyncMock({ success: true }),
    onGitStatusUpdate: vi.fn(() => () => undefined),
    ...overrides,
  };
}

export function installElectronApiMock(overrides: Partial<ElectronApiMock> = {}): ElectronApiMock {
  const electronApi = createElectronApiMock(overrides);

  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'electronAPI', {
      value: electronApi,
      configurable: true,
      writable: true,
    });
    return electronApi;
  }

  vi.stubGlobal('window', { electronAPI: electronApi } as unknown as Window & typeof globalThis);
  return electronApi;
}
