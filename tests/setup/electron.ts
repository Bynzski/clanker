import { vi } from 'vitest';
import type { FileListDirectoryResult } from '../../src/shared/types/fileExplorer';

export type ElectronApiMock = {
  [K in keyof Window['electronAPI']]: ReturnType<typeof vi.fn>;
};

const createAsyncMock = <T>(result: T) => vi.fn().mockResolvedValue(result);
const defaultFileListDirectoryResult: FileListDirectoryResult = { success: true, entries: [] };

export function createElectronApiMock(overrides: Partial<ElectronApiMock> = {}): ElectronApiMock {
  return {
    getLastWorkspace: createAsyncMock(''),
    openDirectoryDialog: createAsyncMock(null),
    readDirectory: createAsyncMock([]),
    fileListDirectory: createAsyncMock(defaultFileListDirectoryResult),
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
    cleanupWorkspaceTerminals: createAsyncMock(0),
    onTerminalData: vi.fn(() => () => undefined),
    onTerminalExit: vi.fn(() => () => undefined),
    writeClipboard: createAsyncMock(undefined),
    resolveDroppedFilePath: vi.fn(() => ''),
    browserHide: createAsyncMock(undefined),
    browserSetBounds: createAsyncMock(undefined),
    browserNavigate: createAsyncMock(true),
    browserBack: createAsyncMock(undefined),
    browserForward: createAsyncMock(undefined),
    browserRefresh: createAsyncMock(undefined),
    browserStop: createAsyncMock(undefined),
    browserDisposeWorkspace: createAsyncMock(undefined),
    openExternal: createAsyncMock(true),
    revealInFileManager: createAsyncMock(true),
    canGoBack: createAsyncMock(false),
    canGoForward: createAsyncMock(false),
    minimizeWindow: createAsyncMock(undefined),
    toggleMaximizeWindow: createAsyncMock(undefined),
    closeWindow: createAsyncMock(undefined),
    isMaximizedWindow: createAsyncMock(false),
    zoomInWindow: createAsyncMock(undefined),
    zoomOutWindow: createAsyncMock(undefined),
    resetZoomWindow: createAsyncMock(undefined),
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
    gitGetFileDiff: createAsyncMock({
      success: true,
      oldContent: '',
      newContent: '',
      oldPath: '',
      newPath: '',
      isBinary: false,
      hasDiff: false,
    }),
    gitCreateBranch: createAsyncMock({ success: true }),
    gitSwitchBranch: createAsyncMock({ success: true }),
    gitDeleteBranch: createAsyncMock({ success: true }),
    gitForceDeleteBranch: createAsyncMock({ success: true }),
    gitMergeBranch: createAsyncMock({ success: true }),
    gitAbortOperation: createAsyncMock({ success: true }),
    gitStash: createAsyncMock({ success: true }),
    gitApplyStash: createAsyncMock({ success: true }),
    gitPopStash: createAsyncMock({ success: true }),
    gitDropStash: createAsyncMock({ success: true }),
    gitClearStashes: createAsyncMock({ success: true }),
    gitRefresh: createAsyncMock(null),
    gitInit: createAsyncMock({ success: true }),
    gitGetRemotes: createAsyncMock({ success: true, remotes: [], provider: 'unknown' }),
    gitAddRemote: createAsyncMock({ success: true }),
    gitRemoveRemote: createAsyncMock({ success: true }),
    gitRenameRemote: createAsyncMock({ success: true }),
    gitFetch: createAsyncMock({ success: true }),
    gitPull: createAsyncMock({ success: true }),
    gitPush: createAsyncMock({ success: true }),
    onGitStatusUpdate: vi.fn(() => () => undefined),

    // Credential management
    credentialGenerateSshKey: createAsyncMock({ success: true, publicKey: 'ssh-ed25519 AAAA...', fingerprint: 'SHA256:...' }),
    credentialGetPublicKey: createAsyncMock({ success: true, publicKey: 'ssh-ed25519 AAAA...' }),
    credentialDeleteSshKey: createAsyncMock({ success: true }),
    credentialCheckExists: createAsyncMock({ exists: false }),
    credentialSavePat: createAsyncMock({ success: true }),
    credentialGetPat: createAsyncMock({ success: false, error: 'No token stored' }),
    credentialDeletePat: createAsyncMock({ success: true }),
    credentialGetStatus: createAsyncMock({ remoteName: 'origin', provider: 'github', hasSshKey: false, hasPat: false, credentialHelper: null }),
    credentialGetGlobalStatus: createAsyncMock({ defaultSshKeyPath: '', hasDefaultSshKey: false, storedPats: [], credentialHelpers: {} }),
    credentialConfigureSshHost: createAsyncMock({ success: true }),

    // VCS Provider Context
    vcsGetContext: createAsyncMock({ success: false, error: 'Not implemented in mock' }),
    vcsGetPrInfo: createAsyncMock({ success: false, error: 'Not implemented in mock' }),
    vcsGetDeepLinks: createAsyncMock([]),
    vcsGetDeepLink: createAsyncMock(null),
    vcsOpenDeepLink: createAsyncMock(true),

    // Editor
    editorReadFile: createAsyncMock({ success: true, content: '' }),
    editorWriteFile: createAsyncMock({ success: true }),
    editorWatchFile: createAsyncMock(undefined),
    editorUnwatchFile: createAsyncMock(undefined),
    onFileChanged: vi.fn(() => () => undefined),

    // File Operations
    fileCreate: createAsyncMock({ success: true }),
    fileDelete: createAsyncMock({ success: true }),
    fileRename: createAsyncMock({ success: true }),

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
