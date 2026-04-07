import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Workspace
  getLastWorkspace: () => ipcRenderer.invoke('get-last-workspace'),
  openDirectoryDialog: () => ipcRenderer.invoke('open-directory-dialog'),
  readDirectory: (path: string) => ipcRenderer.invoke('read-directory', path),

  // Settings
  getShowFastfetch: () => ipcRenderer.invoke('get-show-fastfetch'),
  setShowFastfetch: (show: boolean) => ipcRenderer.invoke('set-show-fastfetch', show),
  getAiCommitSettings: () => ipcRenderer.invoke('get-ai-commit-settings'),
  setAiCommitEnabled: (enabled: boolean) => ipcRenderer.invoke('set-ai-commit-enabled', enabled),
  setAiCommitProvider: (provider: string) => ipcRenderer.invoke('set-ai-commit-provider', provider),
  setAiCommitModel: (model: string) => ipcRenderer.invoke('set-ai-commit-model', model),

  // Terminal
  spawnTerminal: (workingDir: string, harness?: string, model?: string) =>
    ipcRenderer.invoke('spawn-terminal', workingDir, harness, model),
  getTerminalBuffer: (id: string) => ipcRenderer.invoke('get-terminal-buffer', id),
  writeTerminal: (id: string, data: string) => ipcRenderer.invoke('write-terminal', { id, data }),
  resizeTerminal: (id: string, cols: number, rows: number) =>
    ipcRenderer.invoke('resize-terminal', { id, cols, rows }),
  killTerminal: (id: string) => ipcRenderer.invoke('kill-terminal', id),
  onTerminalData: (callback: (data: { id: string; data: string }) => void) => {
    const handler = (_: any, data: { id: string; data: string }) => callback(data);
    ipcRenderer.on('terminal-data', handler);
    return () => ipcRenderer.removeListener('terminal-data', handler);
  },
  onTerminalExit: (callback: (data: { id: string; exitCode: number }) => void) => {
    const handler = (_: any, data: { id: string; exitCode: number }) => callback(data);
    ipcRenderer.on('terminal-exit', handler);
    return () => ipcRenderer.removeListener('terminal-exit', handler);
  },

  // Browser (using WebContentsView)
  browserHide: () => ipcRenderer.invoke('browser-hide'),
  browserSetBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('browser-set-bounds', bounds),
  browserNavigate: (url: string) => ipcRenderer.invoke('browser-navigate', url),
  browserBack: () => ipcRenderer.invoke('browser-back'),
  browserForward: () => ipcRenderer.invoke('browser-forward'),
  browserRefresh: () => ipcRenderer.invoke('browser-refresh'),
  browserStop: () => ipcRenderer.invoke('browser-stop'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  canGoBack: () => ipcRenderer.invoke('can-go-back'),
  canGoForward: () => ipcRenderer.invoke('can-go-forward'),
  onFitAllPanes: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('fit-all-panes', handler);
    return () => ipcRenderer.removeListener('fit-all-panes', handler);
  },

  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('toggle-maximize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  isMaximizedWindow: () => ipcRenderer.invoke('is-maximized-window'),

  // Harness
  getHarnessOptions: () => ipcRenderer.invoke('get-harness-options'),
  getHarnessModels: (harness: string) => ipcRenderer.invoke('get-harness-models', harness),

  // Git operations - managed by GitService in main process
  gitStartPolling: (workspacePath: string) => ipcRenderer.invoke('git-start-polling', workspacePath),
  gitStopPolling: () => ipcRenderer.invoke('git-stop-polling'),
  generateCommitMessage: (workspacePath: string) => ipcRenderer.invoke('generate-commit-message', workspacePath),
  gitStage: (workspacePath: string, files?: string[]) => ipcRenderer.invoke('git-stage', workspacePath, files),
  gitCommit: (workspacePath: string, message: string) => ipcRenderer.invoke('git-commit', workspacePath, message),
  gitGetBranchState: (workspacePath: string) => ipcRenderer.invoke('git-get-branch-state', workspacePath),
  gitGetOperationState: (workspacePath: string) => ipcRenderer.invoke('git-get-operation-state', workspacePath),
  gitGetStashes: (workspacePath: string) => ipcRenderer.invoke('git-get-stashes', workspacePath),
  gitGetHistory: (workspacePath: string, limit?: number) => ipcRenderer.invoke('git-get-history', workspacePath, limit),
  gitGetDiff: (
    workspacePath: string,
    mode: 'working' | 'staged' | 'commit',
    ref?: string
  ) => ipcRenderer.invoke('git-get-diff', workspacePath, mode, ref),
  gitCreateBranch: (workspacePath: string, name: string, baseBranch?: string) =>
    ipcRenderer.invoke('git-create-branch', workspacePath, name, baseBranch),
  gitSwitchBranch: (workspacePath: string, name: string) => ipcRenderer.invoke('git-switch-branch', workspacePath, name),
  gitDeleteBranch: (workspacePath: string, name: string) => ipcRenderer.invoke('git-delete-branch', workspacePath, name),
  gitMergeBranch: (workspacePath: string, branchName: string) => ipcRenderer.invoke('git-merge-branch', workspacePath, branchName),
  gitAbortOperation: (workspacePath: string) => ipcRenderer.invoke('git-abort-operation', workspacePath),
  gitStash: (workspacePath: string, message?: string, includeUntracked?: boolean) =>
    ipcRenderer.invoke('git-stash', workspacePath, message, includeUntracked),
  gitApplyStash: (workspacePath: string, stashRef: string) => ipcRenderer.invoke('git-apply-stash', workspacePath, stashRef),
  gitPopStash: (workspacePath: string, stashRef: string) => ipcRenderer.invoke('git-pop-stash', workspacePath, stashRef),
  gitDropStash: (workspacePath: string, stashRef: string) => ipcRenderer.invoke('git-drop-stash', workspacePath, stashRef),
  gitClearStashes: (workspacePath: string) => ipcRenderer.invoke('git-clear-stashes', workspacePath),
  gitRefresh: () => ipcRenderer.invoke('git-refresh'),
  gitGetRemotes: (workspacePath: string) => ipcRenderer.invoke('git-get-remotes', workspacePath),
  onGitStatusUpdate: (callback: (status: {
    success: boolean;
    isRepo: boolean;
    currentBranch: string | null;
    isDetached: boolean;
    changes: Array<{ path: string; status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed'; staged: boolean }>;
    upstream: string | null;
    ahead: number;
    behind: number;
    errorCode?: 'not-a-repo' | 'git-not-found' | 'unknown';
    error?: string;
  }) => void) => {
    const handler = (_: any, status: any) => callback(status);
    ipcRenderer.on('git-status-update', handler);
    return () => ipcRenderer.removeListener('git-status-update', handler);
  },
});
