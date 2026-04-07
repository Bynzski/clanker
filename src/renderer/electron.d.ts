interface ElectronAPI {
  // Workspace
  getLastWorkspace: () => Promise<string>;
  setLastWorkspace: (path: string) => Promise<void>;
  openDirectoryDialog: () => Promise<string | null>;
  readDirectory: (path: string) => Promise<{ name: string; isDirectory: boolean }[]>;

  // Settings
  getShowFastfetch: () => Promise<boolean>;
  setShowFastfetch: (show: boolean) => Promise<void>;

  // Terminal
  spawnTerminal: (workingDir: string, harness?: string, model?: string) => Promise<{ id: string; pid: number }>;
  getTerminalBuffer: (id: string) => Promise<string>;
  writeTerminal: (id: string, data: string) => Promise<void>;
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>;
  killTerminal: (id: string) => Promise<void>;
  onTerminalData: (callback: (data: { id: string; data: string }) => void) => () => void;
  onTerminalExit: (callback: (data: { id: string; exitCode: number }) => void) => () => void;

  // Browser (WebContentsView)
  browserShow: (x: number, y: number, width: number, height: number) => Promise<void>;
  browserHide: () => Promise<void>;
  browserSetBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
  browserNavigate: (url: string) => Promise<void>;
  browserBack: () => Promise<void>;
  browserForward: () => Promise<void>;
  browserRefresh: () => Promise<void>;
  browserStop: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  getBrowserUrl: () => Promise<string>;
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
  gitGetStatus: (workspacePath: string) => Promise<GitStatusResult>;
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
  gitIsRepo: (workspacePath: string) => Promise<boolean>;
  gitRefresh: () => Promise<GitStatusResult | null>;
  onGitStatusUpdate: (callback: (status: GitStatusResult) => void) => () => void;
}

interface GitStatusResult {
  success: boolean;
  isRepo: boolean;
  currentBranch: string | null;
  isDetached: boolean;
  changes: GitStatus[];
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

interface ModelOption {
  id: string;
  label: string;
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

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
