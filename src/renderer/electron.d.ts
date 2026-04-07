import type { AiCommitSettings, ModelOption } from './types/shared';

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
  browserHide: () => Promise<void>;
  browserSetBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
  browserNavigate: (url: string) => Promise<boolean>;
  browserBack: () => Promise<void>;
  browserForward: () => Promise<void>;
  browserRefresh: () => Promise<void>;
  browserStop: () => Promise<void>;
  openExternal: (url: string) => Promise<boolean>;
  canGoBack: () => Promise<boolean>;
  canGoForward: () => Promise<boolean>;

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
  gitCommit: (workspacePath: string, message: string) => Promise<{ success: boolean; error?: string }>;
  gitGetBranchState: (workspacePath: string) => Promise<GitBranchStateResult>;
  gitGetOperationState: (workspacePath: string) => Promise<GitOperationStateResult>;
  gitGetStashes: (workspacePath: string) => Promise<GitStash[]>;
  gitGetHistory: (workspacePath: string, limit?: number) => Promise<GitHistoryEntry[]>;
  gitGetDiff: (workspacePath: string, mode: 'working' | 'staged' | 'commit', ref?: string) => Promise<GitDiffResult>;
  gitCreateBranch: (workspacePath: string, name: string, baseBranch?: string) => Promise<{ success: boolean; error?: string }>;
  gitSwitchBranch: (workspacePath: string, name: string) => Promise<{ success: boolean; error?: string }>;
  gitDeleteBranch: (workspacePath: string, name: string) => Promise<{ success: boolean; error?: string }>;
  gitMergeBranch: (workspacePath: string, branchName: string) => Promise<{ success: boolean; error?: string }>;
  gitAbortOperation: (workspacePath: string) => Promise<{ success: boolean; error?: string }>;
  gitStash: (workspacePath: string, message?: string, includeUntracked?: boolean) => Promise<{ success: boolean; error?: string }>;
  gitApplyStash: (workspacePath: string, stashRef: string) => Promise<{ success: boolean; error?: string }>;
  gitPopStash: (workspacePath: string, stashRef: string) => Promise<{ success: boolean; error?: string }>;
  gitDropStash: (workspacePath: string, stashRef: string) => Promise<{ success: boolean; error?: string }>;
  gitClearStashes: (workspacePath: string) => Promise<{ success: boolean; error?: string }>;
  gitRefresh: () => Promise<GitStatusResult | null>;
  gitGetRemotes: (workspacePath: string) => Promise<GitRemotesResult>;
  onGitStatusUpdate: (callback: (status: GitStatusResult) => void) => () => void;
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

type VcsProvider = 'github' | 'bitbucket' | 'gitlab' | 'unknown';

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

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
