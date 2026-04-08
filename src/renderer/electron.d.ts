import type { AiCommitSettings, ModelOption } from './types/shared';
import type {
  DeepLink,
  DeepLinkType,
  ProviderContext,
  PullRequestContext,
  VcsProvider,
} from '../shared/types/vcs';

export type { VcsProvider, ProviderContext, PullRequestContext, DeepLink, DeepLinkType };

interface ElectronAPI {
  // Workspace
  getLastWorkspace: () => Promise<string>;
  openDirectoryDialog: () => Promise<string | null>;
  readDirectory: (path: string) => Promise<{ name: string; isDirectory: boolean }[]>;

  // Settings
  getShowFastfetch: () => Promise<boolean>;
  setShowFastfetch: (show: boolean) => Promise<void>;
  getAiCommitSettings: () => Promise<AiCommitSettings>;
  setAiCommitEnabled: (enabled: boolean) => Promise<void>;
  setAiCommitProvider: (provider: string) => Promise<void>;
  setAiCommitModel: (model: string) => Promise<void>;

  // Terminal
  spawnTerminal: (workingDir: string, harness?: string, model?: string) => Promise<{ id: string; pid: number }>;
  getTerminalBuffer: (id: string) => Promise<string>;
  writeTerminal: (id: string, data: string) => Promise<void>;
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>;
  killTerminal: (id: string) => Promise<void>;
  onTerminalData: (callback: (data: { id: string; data: string }) => void) => () => void;
  onTerminalExit: (callback: (data: { id: string; exitCode: number }) => void) => () => void;

  // Browser (WebContentsView)
  browserHide: (workspaceId: string) => Promise<void>;
  browserSetBounds: (workspaceId: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
  browserNavigate: (workspaceId: string, url: string) => Promise<boolean>;
  browserBack: (workspaceId: string) => Promise<void>;
  browserForward: (workspaceId: string) => Promise<void>;
  browserRefresh: (workspaceId: string) => Promise<void>;
  browserStop: (workspaceId: string) => Promise<void>;
  openExternal: (url: string) => Promise<boolean>;
  canGoBack: (workspaceId: string) => Promise<boolean>;
  canGoForward: (workspaceId: string) => Promise<boolean>;
  browserDisposeWorkspace: (workspaceId: string) => Promise<void>;
  onBrowserUrlUpdated: (callback: (payload: { workspaceId: string; url: string }) => void) => () => void;

  // Window controls
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  isMaximizedWindow: () => Promise<boolean>;

  getHarnessOptions: () => Promise<Record<string, { name: string; command: string; args: string[]; icon: string; env?: Record<string, string> }>>;
  getHarnessModels: (harness: string) => Promise<ModelOption[]>;

  onFitAllPanes: (callback: () => void) => () => void;

  // Git operations - managed by GitService in main process
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
}

interface VcsContextResult {
  success: boolean;
  provider?: ProviderContext;
  pullRequest?: PullRequestContext;
  deepLinks?: DeepLink[];
  error?: string;
}

interface VcsPrInfoResult {
  success: boolean;
  pullRequest?: PullRequestContext;
  error?: string;
}

type GitErrorCode = 'not-a-repo' | 'git-not-found' | 'unknown';

interface GitStatusResult {
  success: boolean;
  isRepo: boolean;
  currentBranch: string | null;
  isDetached: boolean;
  changes: GitStatus[];
  upstream: string | null;
  ahead: number;
  behind: number;
  errorCode?: GitErrorCode;
  error?: string;
}

interface GitBranchStateResult {
  success: boolean;
  isRepo: boolean;
  currentBranch: string | null;
  isDetached: boolean;
  branches: GitBranch[];
  error?: string;
}

interface GitDeleteBranchResult {
  success: boolean;
  error?: string;
  blockedByUnmergedCommits?: boolean;
}

interface GitOperationStateResult {
  success: boolean;
  isRepo: boolean;
  inProgress: boolean;
  mode: 'none' | 'merge' | 'rebase';
  conflicts: string[];
  message: string;
  error?: string;
}

interface GitStash {
  hash: string;
  ref: string;
  message: string;
}

interface GitHistoryEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

interface GitDiffResult {
  success: boolean;
  output: string;
  title: string;
  error?: string;
}

interface GenerateCommitMessageResult {
  success: boolean;
  message?: string;
  error?: string;
}

interface GitStatus {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';
  staged: boolean;
}

interface GitBranch {
  name: string;
  isCurrent: boolean;
}

interface GitRemote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

interface GitRemotesResult {
  success: boolean;
  remotes: GitRemote[];
  provider: VcsProvider;
  error?: string;
}

interface GitRemoteOperationResult {
  success: boolean;
  error?: string;
}

// Credential types - used by renderer for type checking
/* eslint-disable @typescript-eslint/no-unused-vars */
interface CredentialOperationResult {
  success: boolean;
  error?: string;
}

interface SshKeyGenerationResult {
  success: boolean;
  publicKey?: string;
  fingerprint?: string;
  error?: string;
}

interface PublicKeyResult {
  success: boolean;
  publicKey?: string;
  fingerprint?: string;
  error?: string;
}

interface PatResult {
  success: boolean;
  token?: string;
  error?: string;
}

interface SshKeyConfig {
  privateKeyPath: string;
  publicKeyPath: string;
  keyType: string;
  fingerprint: string;
  createdAt: string;
}

interface StoredPat {
  provider: string;
  scope: string[];
  storedAt: string;
  validated: boolean;
}

interface CredentialStatusResult {
  remoteName: string;
  provider: VcsProvider;
  hasSshKey: boolean;
  hasPat: boolean;
  credentialHelper: string | null;
}

interface GlobalCredentialStatusResult {
  defaultSshKeyPath: string;
  hasDefaultSshKey: boolean;
  storedPats: StoredPat[];
  credentialHelpers: Record<string, string>;
}
/* eslint-enable @typescript-eslint/no-unused-vars */

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
