import type { RemotePreviewRequest, RemotePreviewWatchRequest, RemotePreviewResult, RemotePreviewUpdate } from '../shared/types/remotePreview';
import type { SshEnvironmentConfig, WorkspaceLocation } from '../../shared/types/environments';
import type { AdoptWorktreeCheckoutContextResult, CheckoutContext, ReconcileCheckoutContextsResult, ReleaseCheckoutContextResult } from '../../shared/types/checkoutContext';
import type { RemoteDirectoryListing } from '../shared/types/environments';
import type { RemoteFileWatchRequest, RemoteFilesChangedEvent } from '../shared/types/remoteFileWatch';
import type { WorkspaceRecipe, RecipePreviewProbeResult } from '../../shared/types/recipes';
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
  GitWorktreeListResult,
  GitWorktreeCreateResult,
  GitCreateWorktreeOptions,
  GitWorktreeInspectionResult,
  GitWorktreeRemoveResult,
  GitWorktreePruneResult,
  GitWorktreeUnlockResult,
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
import type { HarnessSession, SessionInvokeOptions, SessionInvokeResult } from '../../shared/types/session';
import type { SessionDiscoveryResult } from '../shared/types/session';
import type { HarnessUsageRequest, HarnessUsageResponse } from '../../shared/types/harnessUsage';
import type { HarnessAccountAuthEvent, HarnessAccountAuthStart, HarnessAccountList } from '../../shared/types/harnessAccounts';
import type { BrowserHistoryEntry } from '../../shared/types/browserHistory';
import type { AgentAttentionChange, AgentAttentionSnapshot } from '../../shared/types/agentAttention';
import type { AgentCheckoutTransitionEvent } from '../../shared/types/checkoutTransition';
import type { ThemeId } from '../../shared/types/theme';
import type { WorkspaceNavigationMode } from '../../shared/types/workspaceNavigation';
import type { KeybindingOverrides, BrowserKeybindingCommandPayload } from '../../shared/keybindings';

export type { VcsProvider, ProviderContext, PullRequestContext, DeepLink, DeepLinkType };
export type { ThemeId };
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
  GitWorktreeListResult,
  GitWorktreeCreateResult,
  GitWorktreeInspectionResult,
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

import type { AssistantOpenResult, AssistantPtyData, AssistantSettings, AssistantSnapshot } from '../shared/types/assistants';

export interface ElectronAPI {
  workspaceServiceSaveSettings: (request: import('../shared/types/workspaceServices').DevServiceSettingsRequest) => Promise<import('../shared/types/workspaceServices').DevServiceDiscoveryResult>;
  workspaceServiceDiscover: (request: import('../shared/types/workspaceServices').DevServiceTarget) => Promise<import('../shared/types/workspaceServices').DevServiceDiscoveryResult>;
  workspaceServiceStart: (request: import('../shared/types/workspaceServices').DevServiceStartRequest) => Promise<import('../shared/types/workspaceServices').WorkspaceServiceResult>;
  workspaceServiceStop: (request: { workspaceId: string; serviceId: string }) => Promise<import('../shared/types/workspaceServices').WorkspaceServiceResult>;
  workspaceServiceGet: () => Promise<import('../shared/types/workspaceServices').WorkspaceServicesUpdate>;
  onWorkspaceServicesChanged: (callback: (update: import('../shared/types/workspaceServices').WorkspaceServicesUpdate) => void) => () => void;
  getAssistants: () => Promise<AssistantSnapshot>;
  configureAssistants: (settings: AssistantSettings) => Promise<AssistantSnapshot>;
  refreshAssistants: () => Promise<AssistantSnapshot>;
  openAssistant: (assistantId: string) => Promise<AssistantOpenResult>;
  writeAssistantPty: (assistantId: string, data: string) => Promise<void>;
  resizeAssistantPty: (assistantId: string, cols: number, rows: number) => Promise<void>;
  onAssistantPtyData: (callback: (payload: AssistantPtyData) => void) => () => void;
  onAssistantsChanged: (callback: (snapshot: AssistantSnapshot) => void) => () => void;
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
  getTheme: () => Promise<ThemeId>;
  setTheme: (theme: ThemeId) => Promise<void>;
  getWorkspaceNavigationMode: () => Promise<WorkspaceNavigationMode>;
  setWorkspaceNavigationMode: (mode: WorkspaceNavigationMode) => Promise<void>;
  getWorkspaceSidebarWidth: () => Promise<number>;
  /** The width Expand restores; survives collapsing and restarts. */
  getWorkspaceSidebarExpandedWidth: () => Promise<number>;
  setWorkspaceSidebarWidth: (width: number) => Promise<void>;
  getKeybindingOverrides: () => Promise<KeybindingOverrides>;
  setKeybindingOverrides: (overrides: KeybindingOverrides) => Promise<{ success: true; overrides: KeybindingOverrides } | { success: false; error: string }>;

  // Terminal
  spawnTerminal: (workingDir: string, harness?: string, model?: string, initialCommand?: string, recipeCommand?: boolean, workspaceId?: string, environmentId?: string, checkoutContextId?: string) => Promise<{ id: string; pid: number; harnessId?: string; attentionEnabled?: boolean; checkoutContextId?: string }>;
  waitRecipeCommand: (id: string) => Promise<{ status: 'success' | 'started' | 'failed'; error?: string }>;
  getTerminalBuffer: (id: string) => Promise<string>;
  writeTerminal: (id: string, data: string) => Promise<{ success: boolean; error?: string }>;
  sendAnnotationToAgent: (workspaceId: string, terminalId: string, message: string) => Promise<{ success: boolean; error?: string }>;
  getAgentHandoffStatuses: () => Promise<Record<string, 'unverified' | 'ready' | 'running' | 'needs_input' | 'unavailable'>>;
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<{ success: boolean; error?: string }>;
  killTerminal: (id: string) => Promise<{ success: boolean; error?: string }>;
  cleanupWorkspaceTerminals: (ids: string[]) => Promise<number>;
  onTerminalData: (callback: (data: { id: string; data: string }) => void) => () => void;
  onTerminalExit: (callback: (data: { id: string; exitCode: number }) => void) => () => void;
  getAgentAttentionSnapshots: () => Promise<AgentAttentionSnapshot[]>;
  onAgentAttentionChanged: (callback: (data: AgentAttentionChange) => void) => () => void;
  onAgentCheckoutTransition: (callback: (data: AgentCheckoutTransitionEvent) => void) => () => void;
  /** Phase 1 resize confirmation: main sends confirmed PTY geometry after resize. */
  onTerminalResized: (callback: (data: { id: string; cols: number; rows: number }) => void) => () => void;
  /** Phase 1 startup fix: renderer signals xterm is ready to receive data. Triggers flush of startup buffer. */
  terminalReady: (id: string) => Promise<{ success: boolean; error?: string }>;

  // Clipboard
  writeClipboard: (text: string) => Promise<{ success: boolean; error?: string }>;
  resolveDroppedFilePath: (file: File, uriList?: string) => string;

  // Browser (WebContentsView)
  remotePreviewWatch: (request: RemotePreviewWatchRequest) => Promise<RemotePreviewUpdate | null>;
  remotePreviewGet: (request: { workspaceId: string }) => Promise<RemotePreviewUpdate | null>;
  remotePreviewStart: (request: RemotePreviewRequest) => Promise<RemotePreviewResult>;
  remotePreviewStop: (request: { workspaceId: string; serviceId?: string }) => Promise<boolean>;
  onRemotePreviewChanged: (callback: (update: RemotePreviewUpdate) => void) => () => void;
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
  browserNavigate: (workspaceId: string, url: string, tabId?: string, awaitLoad?: boolean) => Promise<boolean>;
  probeRecipePreview: (url: string, waitForReady: boolean) => Promise<RecipePreviewProbeResult>;
  browserBack: (workspaceId: string) => Promise<void>;
  browserForward: (workspaceId: string) => Promise<void>;
  browserRefresh: (workspaceId: string) => Promise<void>;
  browserStop: (workspaceId: string) => Promise<void>;
  browserCreateTab: (workspaceId: string, tabId: string) => Promise<{ url: string; title: string }>;
  browserCloseTab: (workspaceId: string, tabId: string) => Promise<boolean>;
  browserActivate: (workspaceId: string, tabId?: string) => Promise<boolean>;
  browserSwitchTab: (
    workspaceId: string,
    tabId: string,
  ) => Promise<{ url: string; title?: string } | null>;
  browserMoveTab: (
    workspaceId: string,
    tabId: string,
    targetTabId: string,
    activeTabId: string,
  ) => Promise<boolean>;
  browserGetTabs: (
    workspaceId: string,
  ) => Promise<Array<{ tabId: string; url: string; title?: string }>>;
  browserTabNavigate: (workspaceId: string, tabId: string, url: string) => Promise<boolean>;
  browserHistoryGet: (prefix?: string) => Promise<BrowserHistoryEntry[]>;
  browserHistoryAdd: (url: string, title?: string) => Promise<boolean>;
  browserHistoryClear: () => Promise<boolean>;
  openExternal: (url: string) => Promise<boolean>;
  revealInFileManager: (filePath: string, workspaceId?: string) => Promise<boolean>;
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
  windowReadyToShow: () => Promise<void>;
  getWindowZoomFactor: () => number;

  getHarnessOptions: () => Promise<Record<string, { name: string; command: string; args: string[]; icon: string; env?: Record<string, string> }>>;
  getHarnessModels: (harness: string, refresh?: boolean) => Promise<ModelOption[]>;
  getHarnessDefaults: () => Promise<HarnessDefaultsMap>;
  setHarnessDefaults: (defaults: HarnessDefaultsMap) => Promise<void>;

  onFitAllPanes: (callback: () => void) => () => void;
  onBrowserKeybindingCommand: (callback: (payload: BrowserKeybindingCommandPayload) => void) => () => void;

  // Git operations
  gitStartPolling: (workspacePath: string, workspaceId?: string) => Promise<void>;
  gitStopPolling: (workspaceId?: string) => Promise<void>;
  generateCommitMessage: (workspacePath: string, workspaceId?: string) => Promise<GenerateCommitMessageResult>;
  gitStage: (workspacePath: string, files?: string[], workspaceId?: string) => Promise<{ success: boolean; error?: string }>;
  gitUnstage: (workspacePath: string, files?: string[], workspaceId?: string) => Promise<{ success: boolean; error?: string }>;
  gitCommit: (workspacePath: string, message: string, workspaceId?: string) => Promise<{ success: boolean; error?: string }>;
  gitGetBranchState: (workspacePath: string, workspaceId?: string) => Promise<GitBranchStateResult>;
  gitListWorktrees: (workspacePath: string, workspaceId?: string) => Promise<GitWorktreeListResult>;
  gitCreateWorktree: (workspacePath: string, baseRef: string, branch: string, workspaceId?: string, options?: GitCreateWorktreeOptions) => Promise<GitWorktreeCreateResult>;
  registerOpenWorkspace: (id: string, workspacePath: string, environmentId?: string) => Promise<{ success: boolean; location?: WorkspaceLocation; checkoutContext?: CheckoutContext; error?: string }>;
  unregisterOpenWorkspace: (id: string) => Promise<{ success: boolean; error?: string }>;
  /** Main decides: only a worktree context of that workspace with no live terminals is released. */
  adoptWorktreeCheckoutContext: (workspaceId: string, worktreePath: string) => Promise<AdoptWorktreeCheckoutContextResult>;
  releaseCheckoutContext: (workspaceId: string, checkoutContextId: string) => Promise<ReleaseCheckoutContextResult>;
  /** Main reconciles the workspace's worktree contexts with Git: branch refreshed, gone ones dropped or marked missing. */
  reconcileCheckoutContexts: (workspaceId: string) => Promise<ReconcileCheckoutContextsResult>;
  gitInspectWorktree: (workspacePath: string, worktreePath: string, openWorkspacePaths: string[], workspaceId?: string) => Promise<GitWorktreeInspectionResult>;
  gitRemoveWorktree: (workspacePath: string, worktreePath: string, expectedBranch: string | null, openWorkspacePaths: string[], workspaceId?: string) => Promise<GitWorktreeRemoveResult>;
  gitPruneWorktrees: (workspacePath: string, workspaceId?: string) => Promise<GitWorktreePruneResult>;
  gitUnlockWorktree: (workspacePath: string, worktreePath: string, workspaceId?: string) => Promise<GitWorktreeUnlockResult>;
  gitGetOperationState: (workspacePath: string, workspaceId?: string) => Promise<GitOperationStateResult>;
  gitGetStashes: (workspacePath: string, workspaceId?: string) => Promise<GitStash[]>;
  gitGetHistory: (workspacePath: string, limit?: number, workspaceId?: string) => Promise<GitHistoryEntry[]>;
  gitGetDiff: (workspacePath: string, mode: 'working' | 'staged' | 'commit', ref?: string, workspaceId?: string) => Promise<GitDiffResult>;
  gitGetFileDiff: (
    workspacePath: string,
    filePath: string,
    mode: 'working' | 'staged',
    workspaceId?: string
  ) => Promise<FileDiffResult>;
  gitCreateBranch: (workspacePath: string, name: string, baseBranch?: string, workspaceId?: string) => Promise<{ success: boolean; error?: string }>;
  gitSwitchBranch: (workspacePath: string, name: string, workspaceId?: string) => Promise<{ success: boolean; error?: string }>;
  gitDeleteBranch: (workspacePath: string, name: string, workspaceId?: string) => Promise<GitDeleteBranchResult>;
  gitForceDeleteBranch: (workspacePath: string, name: string, workspaceId?: string) => Promise<GitDeleteBranchResult>;
  gitMergeBranch: (workspacePath: string, branchName: string, workspaceId?: string) => Promise<{ success: boolean; error?: string }>;
  gitAbortOperation: (workspacePath: string, workspaceId?: string) => Promise<{ success: boolean; error?: string }>;
  gitStash: (workspacePath: string, message?: string, includeUntracked?: boolean, workspaceId?: string) => Promise<{ success: boolean; error?: string }>;
  gitApplyStash: (workspacePath: string, stashRef: string, workspaceId?: string) => Promise<{ success: boolean; error?: string }>;
  gitPopStash: (workspacePath: string, stashRef: string, workspaceId?: string) => Promise<{ success: boolean; error?: string }>;
  gitDropStash: (workspacePath: string, stashRef: string, workspaceId?: string) => Promise<{ success: boolean; error?: string }>;
  gitClearStashes: (workspacePath: string, workspaceId?: string) => Promise<{ success: boolean; error?: string }>;
  gitRefresh: (workspaceId?: string) => Promise<GitStatusResult | null>;
  gitInit: (workspacePath: string, defaultBranch?: string, workspaceId?: string) => Promise<GitInitResult>;
  gitGetRemotes: (workspacePath: string, workspaceId?: string) => Promise<GitRemotesResult>;
  gitAddRemote: (workspacePath: string, name: string, url: string, workspaceId?: string) => Promise<GitRemoteOperationResult>;
  gitRemoveRemote: (workspacePath: string, name: string, workspaceId?: string) => Promise<GitRemoteOperationResult>;
  gitRenameRemote: (workspacePath: string, oldName: string, newName: string, workspaceId?: string) => Promise<GitRemoteOperationResult>;
  gitFetch: (workspacePath: string, remote?: string, workspaceId?: string) => Promise<{ success: boolean; error?: string }>;
  gitPull: (workspacePath: string, rebase?: boolean, workspaceId?: string) => Promise<{ success: boolean; error?: string }>;
  gitPush: (
    workspacePath: string,
    remote?: string,
    branch?: string,
    forceWithLease?: boolean,
    setUpstream?: boolean,
    workspaceId?: string
  ) => Promise<{ success: boolean; error?: string }>;
  onGitStatusUpdate: (callback: (status: GitStatusResult) => void) => () => void;

  // Credential management
  credentialGenerateSshKey: () => Promise<SshKeyGenerationResult>;
  credentialGetPublicKey: () => Promise<PublicKeyResult>;
  credentialDeleteSshKey: () => Promise<CredentialOperationResult>;
  credentialCheckExists: () => Promise<{ exists: boolean }>;
  credentialSavePat: (provider: string, token: string, scope?: string[]) => Promise<CredentialOperationResult>;
  credentialDeletePat: (provider: string) => Promise<CredentialOperationResult>;
  credentialGetStatus: (remoteName: string, remoteUrl: string, provider: string) => Promise<CredentialStatusResult>;
  credentialGetGlobalStatus: () => Promise<GlobalCredentialStatusResult>;
  credentialConfigureSshHost: (hostname: string) => Promise<CredentialOperationResult>;

  // VCS Provider Context
  vcsGetContext: (workspacePath: string, workspaceId?: string) => Promise<VcsContextResult>;
  vcsGetPrInfo: (workspacePath: string, workspaceId?: string) => Promise<VcsPrInfoResult>;
  vcsGetDeepLinks: (workspacePath: string, prNumber?: number, workspaceId?: string) => Promise<DeepLink[]>;
  vcsGetDeepLink: (workspacePath: string, type: string, workspaceId?: string) => Promise<string | null>;
  vcsOpenDeepLink: (workspacePath: string, type: string, workspaceId?: string) => Promise<boolean>;

  // Editor
  editorReadFile: (request: FileReadRequest) => Promise<FileReadResult>;
  editorWriteFile: (request: FileWriteRequest) => Promise<FileWriteResult>;
  editorWatchFile: (request: FileWatchRequest) => Promise<boolean>;
  remoteFilesWatch: (request: RemoteFileWatchRequest | null) => Promise<boolean>;
  onRemoteFilesChanged: (callback: (event: RemoteFilesChangedEvent) => void) => () => void;
  editorUnwatchFile: (request: FileWatchRequest) => Promise<boolean>;
  onFileChanged: (callback: (event: FileChangedEvent) => void) => () => void;

  // File Operations
  fileCreate: (request: FileCreateRequest) => Promise<FileOperationResult>;
  fileDelete: (request: FileDeleteRequest) => Promise<FileOperationResult>;
  fileRename: (request: FileRenameRequest) => Promise<FileOperationResult>;

  // Explorer tree auto-refresh
  onExplorerTreeChanged: (callback: (event: ExplorerTreeChangedEvent) => void) => () => void;
  /** Start watching a workspace tree. Triggers EXPLORER_TREE_CHANGED events on file changes. */
  explorerStartWatching: (workspaceId: string, checkoutContextId?: string) => Promise<void>;
  /** Stop watching the current workspace tree. */
  explorerStopWatching: () => Promise<void>;

  // Session history
  discoverSessions: (workspaceId: string) => Promise<HarnessSession[]>;
  discoverSessionHistory: (workspaceId: string, forceRefresh?: boolean) => Promise<SessionDiscoveryResult>;
  getHarnessUsage: (workspaceId: string, request?: HarnessUsageRequest) => Promise<HarnessUsageResponse>;
  listHarnessAccounts: (environmentId: string, harness: string) => Promise<HarnessAccountList>;
  selectHarnessAccount: (environmentId: string, harness: string, accountId: string) => Promise<HarnessAccountList>;
  startHarnessAccountAdd: (environmentId: string, harness: string, label?: string) => Promise<HarnessAccountAuthStart>;
  reconnectHarnessAccount: (environmentId: string, harness: string, accountId: string) => Promise<HarnessAccountAuthStart>;
  cancelHarnessAccountAuth: (flowId: string) => Promise<void>;
  removeHarnessAccount: (environmentId: string, harness: string, accountId: string) => Promise<HarnessAccountList>;
  renameHarnessAccount: (environmentId: string, harness: string, accountId: string, label: string) => Promise<HarnessAccountList>;
  onHarnessAccountAuthState: (callback: (event: HarnessAccountAuthEvent) => void) => () => void;
  invokeSession: (workspaceId: string, session: HarnessSession, fork?: boolean, options?: SessionInvokeOptions) => Promise<SessionInvokeResult>;

  // Workspace Recipes
  recipeGetAll: (workspacePath?: string) => Promise<WorkspaceRecipe[]>;
  recipeSave: (recipe: WorkspaceRecipe) => Promise<WorkspaceRecipe>;
  recipeDelete: (recipeId: string) => Promise<boolean>;

  // Browser annotation
  annotationEnable: (workspaceId: string) => Promise<{ success: boolean; error?: string }>;
  annotationDisable: () => Promise<{ success: boolean }>;
  annotationGetState: () => Promise<{
    enabled: boolean;
    initialized: boolean;
    workspaceId: string | null;
    actions: Array<{ type: 'copy' | 'send'; success: boolean; message?: string; error?: string }>;
    overflowed: boolean;
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
  annotationPrepareSend: () => Promise<{ success: boolean; message?: string; error?: string }>;
  annotationCheckEscaped: () => Promise<boolean>;
  onAnnotationEscape: (callback: (payload: { workspaceId: string }) => void) => () => void;
  onAnnotationStateChanged: (callback: (payload: {
    enabled: boolean;
    initialized: boolean;
    workspaceId: string | null;
  }) => void) => () => void;

  // SSH Environments
  sshEnvironmentList: () => Promise<SshEnvironmentConfig[]>;
  sshEnvironmentSave: (config: unknown) => Promise<{ success: boolean; config?: SshEnvironmentConfig; error?: string }>;
  sshEnvironmentDelete: (id: string) => Promise<{ success: boolean; error?: string }>;
  sshEnvironmentTest: (target: string) => Promise<{ success: boolean; error?: string }>;
  sshGetHomeDirectory: (environmentId: string) => Promise<{ homePath: string; initialPath: string }>;
  sshListDirectories: (environmentId: string, directoryPath: string) => Promise<RemoteDirectoryListing>;
  sshCreateDirectory: (environmentId: string, parentPath: string, name: string) => Promise<{ path: string }>;
  getEnvironmentHarnessOptions: (environmentId: string) => Promise<Record<string, unknown>>;
  getEnvironmentHarnessModels: (environmentId: string, harnessId: string) => Promise<Array<{ id: string; label: string }>>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
