import type { FileListDirectoryRequest, FileListDirectoryResult, ExplorerTreeChangedEvent } from '../../shared/types/fileExplorer';
import type { FileReadRequest, FileWriteRequest, FileChangedEvent, FileWatchRequest, FileReadResult, FileWriteResult } from '../../shared/types/editor';
import type { FileCreateRequest, FileDeleteRequest, FileRenameRequest, FileOperationResult } from '../../shared/types/fileOperations';
import type {
  DeepLink,
  DeepLinkType,
  ProviderContext,
  PullRequestContext,
  VcsProvider,
  VcsContextResult,
  VcsPrInfoResult,
} from '../../shared/types/vcs';
import type {
  GitStatusResult,
  GitBranchStateResult,
  GitDeleteBranchResult,
  GitOperationStateResult,
  GitStash,
  GitHistoryEntry,
  GitDiffResult,
  FileDiffResult,
  GenerateCommitMessageResult,
  GitRemotesResult,
  GitRemoteOperationResult,
  GitInitResult,
} from '../../shared/types/git';
import type {
  CredentialOperationResult,
  SshKeyGenerationResult,
  PublicKeyResult,
  PatResult,
  SshKeyConfig,
  StoredPat,
  CredentialStatusResult,
  GlobalCredentialStatusResult,
} from '../../shared/types/credentials';
import type { AiCommitSettings, ModelOption } from '../types/shared';
import type { HarnessDefaultsMap } from '../../shared/types/store';
import type { HarnessSession } from '../../shared/types/session';
import type { BrowserHistoryEntry } from '../../shared/types/browserHistory';

export type { VcsProvider, ProviderContext, PullRequestContext, DeepLink, DeepLinkType };
export type {
  GitStatusResult,
  GitBranchStateResult,
  GitDeleteBranchResult,
  GitOperationStateResult,
  GitStash,
  GitHistoryEntry,
  GitDiffResult,
  FileDiffResult,
  GenerateCommitMessageResult,
  GitRemotesResult,
  GitRemoteOperationResult,
  GitInitResult,
};
export type {
  CredentialOperationResult,
  SshKeyGenerationResult,
  PublicKeyResult,
  PatResult,
  SshKeyConfig,
  StoredPat,
  CredentialStatusResult,
  GlobalCredentialStatusResult,
};

interface ElectronAPI {
  // App
  getAppVersion: () => Promise<string>;

  // Workspace
  getLastWorkspace: () => Promise<string>;
  getBaseDirectory: () => Promise<string>;
  openBaseDirectoryDialog: () => Promise<string | null>;
  openDirectoryDialog: () => Promise<string | null>;
  readDirectory: (path: string) => Promise<{ name: string; isDirectory: boolean }[]>;
  fileListDirectory: (request: FileListDirectoryRequest) => Promise<FileListDirectoryResult>;

  // Settings
  getAiCommitSettings: () => Promise<AiCommitSettings>;
  setAiCommitEnabled: (enabled: boolean) => Promise<void>;
  setAiCommitProvider: (provider: string) => Promise<void>;
  setAiCommitModel: (model: string) => Promise<void>;

  // Terminal
  spawnTerminal: (workingDir: string, harness?: string, model?: string) => Promise<{ id: string; pid: number }>;
  getTerminalBuffer: (id: string) => Promise<string>;
  writeTerminal: (id: string, data: string) => Promise<{ success: boolean; error?: string }>;
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<{ success: boolean; error?: string }>;
  killTerminal: (id: string) => Promise<{ success: boolean; error?: string }>;
  cleanupWorkspaceTerminals: (ids: string[]) => Promise<number>;
  onTerminalData: (callback: (data: { id: string; data: string }) => void) => () => void;
  onTerminalExit: (callback: (data: { id: string; exitCode: number }) => void) => () => void;
  /** Phase 1 resize confirmation: main sends confirmed PTY geometry after resize. */
  onTerminalResized: (callback: (data: { id: string; cols: number; rows: number }) => void) => () => void;
  /** Phase 1 startup fix: renderer signals xterm is ready to receive data. Triggers flush of startup buffer. */
  terminalReady: (id: string) => Promise<{ success: boolean; error?: string }>;

  // Clipboard
  writeClipboard: (text: string) => Promise<{ success: boolean; error?: string }>;
  resolveDroppedFilePath: (file: File, uriList?: string) => string;

  // Browser (WebContentsView)
  browserHide: (workspaceId: string) => Promise<void>;
  /**
   * Phase 1: optional `tabId` is recorded as the active tab for the workspace
   * before bounds are applied. Phase 2 will route bounds to the named tab view.
   */
  browserSetBounds: (
    workspaceId: string,
    bounds: { x: number; y: number; width: number; height: number },
    tabId?: string,
  ) => Promise<void>;
  /**
   * Phase 1: optional `tabId` updates the per-tab url record; navigation is
   * applied to the underlying single view. Phase 2 will route navigation to
   * the named tab view.
   */
  browserNavigate: (workspaceId: string, url: string, tabId?: string) => Promise<boolean>;
  browserBack: (workspaceId: string) => Promise<void>;
  browserForward: (workspaceId: string) => Promise<void>;
  browserRefresh: (workspaceId: string) => Promise<void>;
  browserStop: (workspaceId: string) => Promise<void>;
  browserCreateTab: (workspaceId: string, tabId: string) => Promise<{ url: string; title: string }>;
  browserCloseTab: (workspaceId: string, tabId: string) => Promise<boolean>;
  browserSwitchTab: (
    workspaceId: string,
    tabId: string,
  ) => Promise<{ url: string; title?: string } | null>;
  browserGetTabs: (
    workspaceId: string,
  ) => Promise<Array<{ tabId: string; url: string; title?: string }>>;
  browserTabNavigate: (workspaceId: string, tabId: string, url: string) => Promise<boolean>;
  browserHistoryGet: (prefix?: string) => Promise<BrowserHistoryEntry[]>;
  browserHistoryAdd: (url: string, title?: string) => Promise<boolean>;
  browserHistoryClear: () => Promise<boolean>;
  openExternal: (url: string) => Promise<boolean>;
  revealInFileManager: (filePath: string) => Promise<boolean>;
  canGoBack: (workspaceId: string) => Promise<boolean>;
  canGoForward: (workspaceId: string) => Promise<boolean>;
  browserDisposeWorkspace: (workspaceId: string) => Promise<void>;
  onBrowserUrlUpdated: (
    callback: (payload: {
      workspaceId: string;
      tabId?: string;
      url: string;
      title?: string;
      canGoBack?: boolean;
      canGoForward?: boolean;
    }) => void,
  ) => () => void;

  // Window controls
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  isMaximizedWindow: () => Promise<boolean>;
  zoomInWindow: () => Promise<void>;
  zoomOutWindow: () => Promise<void>;
  resetZoomWindow: () => Promise<void>;
  getWindowZoomFactor: () => number;

  getHarnessOptions: () => Promise<Record<string, { name: string; command: string; args: string[]; icon: string; env?: Record<string, string> }>>;
  getHarnessModels: (harness: string) => Promise<ModelOption[]>;
  getHarnessDefaults: () => Promise<HarnessDefaultsMap>;
  setHarnessDefaults: (defaults: HarnessDefaultsMap) => Promise<void>;

  onFitAllPanes: (callback: () => void) => () => void;

  // Git operations
  gitStartPolling: (workspacePath: string) => Promise<void>;
  gitStopPolling: () => Promise<void>;
  generateCommitMessage: (workspacePath: string) => Promise<GenerateCommitMessageResult>;
  gitStage: (workspacePath: string, files?: string[]) => Promise<{ success: boolean; error?: string }>;
  gitUnstage: (workspacePath: string, files?: string[]) => Promise<{ success: boolean; error?: string }>;
  gitCommit: (workspacePath: string, message: string) => Promise<{ success: boolean; error?: string }>;
  gitGetBranchState: (workspacePath: string) => Promise<GitBranchStateResult>;
  gitGetOperationState: (workspacePath: string) => Promise<GitOperationStateResult>;
  gitGetStashes: (workspacePath: string) => Promise<GitStash[]>;
  gitGetHistory: (workspacePath: string, limit?: number) => Promise<GitHistoryEntry[]>;
  gitGetDiff: (workspacePath: string, mode: 'working' | 'staged' | 'commit', ref?: string) => Promise<GitDiffResult>;
  gitGetFileDiff: (
    workspacePath: string,
    filePath: string,
    mode: 'working' | 'staged'
  ) => Promise<FileDiffResult>;
  gitCreateBranch: (workspacePath: string, name: string, baseBranch?: string) => Promise<{ success: boolean; error?: string }>;
  gitSwitchBranch: (workspacePath: string, name: string) => Promise<{ success: boolean; error?: string }>;
  gitDeleteBranch: (workspacePath: string, name: string) => Promise<GitDeleteBranchResult>;
  gitForceDeleteBranch: (workspacePath: string, name: string) => Promise<GitDeleteBranchResult>;
  gitMergeBranch: (workspacePath: string, branchName: string) => Promise<{ success: boolean; error?: string }>;
  gitAbortOperation: (workspacePath: string) => Promise<{ success: boolean; error?: string }>;
  gitStash: (workspacePath: string, message?: string, includeUntracked?: boolean) => Promise<{ success: boolean; error?: string }>;
  gitApplyStash: (workspacePath: string, stashRef: string) => Promise<{ success: boolean; error?: string }>;
  gitPopStash: (workspacePath: string, stashRef: string) => Promise<{ success: boolean; error?: string }>;
  gitDropStash: (workspacePath: string, stashRef: string) => Promise<{ success: boolean; error?: string }>;
  gitClearStashes: (workspacePath: string) => Promise<{ success: boolean; error?: string }>;
  gitRefresh: () => Promise<GitStatusResult | null>;
  gitInit: (workspacePath: string, defaultBranch?: string) => Promise<GitInitResult>;
  gitGetRemotes: (workspacePath: string) => Promise<GitRemotesResult>;
  gitAddRemote: (workspacePath: string, name: string, url: string) => Promise<GitRemoteOperationResult>;
  gitRemoveRemote: (workspacePath: string, name: string) => Promise<GitRemoteOperationResult>;
  gitRenameRemote: (workspacePath: string, oldName: string, newName: string) => Promise<GitRemoteOperationResult>;
  gitFetch: (workspacePath: string, remote?: string) => Promise<{ success: boolean; error?: string }>;
  gitPull: (workspacePath: string, rebase?: boolean) => Promise<{ success: boolean; error?: string }>;
  gitPush: (
    workspacePath: string,
    remote?: string,
    branch?: string,
    forceWithLease?: boolean,
    setUpstream?: boolean
  ) => Promise<{ success: boolean; error?: string }>;
  onGitStatusUpdate: (callback: (status: GitStatusResult) => void) => () => void;

  // Credential management
  credentialGenerateSshKey: () => Promise<SshKeyGenerationResult>;
  credentialGetPublicKey: () => Promise<PublicKeyResult>;
  credentialDeleteSshKey: () => Promise<CredentialOperationResult>;
  credentialCheckExists: () => Promise<{ exists: boolean }>;
  credentialSavePat: (provider: string, token: string, scope?: string[]) => Promise<CredentialOperationResult>;
  credentialGetPat: (provider: string) => Promise<PatResult>;
  credentialDeletePat: (provider: string) => Promise<CredentialOperationResult>;
  credentialGetStatus: (remoteName: string, remoteUrl: string, provider: string) => Promise<CredentialStatusResult>;
  credentialGetGlobalStatus: () => Promise<GlobalCredentialStatusResult>;
  credentialConfigureSshHost: (hostname: string) => Promise<CredentialOperationResult>;

  // VCS Provider Context
  vcsGetContext: (workspacePath: string) => Promise<VcsContextResult>;
  vcsGetPrInfo: (workspacePath: string) => Promise<VcsPrInfoResult>;
  vcsGetDeepLinks: (workspacePath: string, prNumber?: number) => Promise<DeepLink[]>;
  vcsGetDeepLink: (workspacePath: string, type: string) => Promise<string | null>;
  vcsOpenDeepLink: (workspacePath: string, type: string) => Promise<boolean>;

  // Editor
  editorReadFile: (request: FileReadRequest) => Promise<FileReadResult>;
  editorWriteFile: (request: FileWriteRequest) => Promise<FileWriteResult>;
  editorWatchFile: (request: FileWatchRequest) => Promise<boolean>;
  editorUnwatchFile: (request: FileWatchRequest) => Promise<boolean>;
  onFileChanged: (callback: (event: FileChangedEvent) => void) => () => void;

  // File Operations
  fileCreate: (request: FileCreateRequest) => Promise<FileOperationResult>;
  fileDelete: (request: FileDeleteRequest) => Promise<FileOperationResult>;
  fileRename: (request: FileRenameRequest) => Promise<FileOperationResult>;

  // Explorer tree auto-refresh
  onExplorerTreeChanged: (callback: (event: ExplorerTreeChangedEvent) => void) => () => void;
  /** Start watching a workspace tree. Triggers EXPLORER_TREE_CHANGED events on file changes. */
  explorerStartWatching: (workspacePath: string) => Promise<void>;
  /** Stop watching the current workspace tree. */
  explorerStopWatching: () => Promise<void>;

  // Session history
  discoverSessions: (workspacePath: string) => Promise<HarnessSession[]>;
  invokeSession: (session: HarnessSession, fork?: boolean) => Promise<{ id: string; pid: number }>;

  // Browser annotation
  annotationEnable: (workspaceId: string) => Promise<{ success: boolean; error?: string }>;
  annotationDisable: () => Promise<{ success: boolean }>;
  annotationGetState: () => Promise<{
    enabled: boolean;
    initialized: boolean;
    workspaceId: string | null;
    copyTriggered?: boolean;
  }>;
    annotationCapture: () => Promise<{
      success: boolean;
      annotation?: {
        url: string;
        title: string;
        tagName: string;
        selector: string;
        fallbackSelectors: string[];
        id: string | null;
        className: string | null;
        text: string | null;
        role: string | null;
        accessibleName: string | null;
        attributes: Record<string, string>;
        bounds: { x: number; y: number; width: number; height: number };
        uiRegion: string | null;
        elementRoleInContext: string | null;
        nearbyText: string[];
        ancestorContext: string | null;
        note: string;
        timestamp: string;
      };
      error?: string;
    }>;
  annotationExport: (annotation: {
    url: string;
    title: string;
    tagName: string;
    selector: string;
    fallbackSelectors: string[];
    id: string | null;
    className: string | null;
    text: string | null;
    role: string | null;
    accessibleName: string | null;
    attributes: Record<string, string>;
    bounds: { x: number; y: number; width: number; height: number };
    uiRegion: string | null;
    elementRoleInContext: string | null;
    nearbyText: string[];
    ancestorContext: string | null;
    note: string;
    timestamp: string;
  }) => Promise<{ success: boolean }>;
  annotationTriggerCopy: () => Promise<{ success: boolean; error?: string }>;
  annotationCheckEscaped: () => Promise<boolean>;
  onAnnotationEscape: (callback: (payload: { workspaceId: string }) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
