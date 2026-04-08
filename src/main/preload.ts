import { contextBridge, ipcRenderer } from 'electron';
import type { VcsProvider } from '../shared/types/vcs';

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
  browserHide: (workspaceId: string) => ipcRenderer.invoke('browser-hide', workspaceId),
  browserSetBounds: (workspaceId: string, bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('browser-set-bounds', workspaceId, bounds),
  browserNavigate: (workspaceId: string, url: string) => ipcRenderer.invoke('browser-navigate', workspaceId, url),
  browserBack: (workspaceId: string) => ipcRenderer.invoke('browser-back', workspaceId),
  browserForward: (workspaceId: string) => ipcRenderer.invoke('browser-forward', workspaceId),
  browserRefresh: (workspaceId: string) => ipcRenderer.invoke('browser-refresh', workspaceId),
  browserStop: (workspaceId: string) => ipcRenderer.invoke('browser-stop', workspaceId),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  canGoBack: (workspaceId: string) => ipcRenderer.invoke('can-go-back', workspaceId),
  canGoForward: (workspaceId: string) => ipcRenderer.invoke('can-go-forward', workspaceId),
  browserDisposeWorkspace: (workspaceId: string) => ipcRenderer.invoke('browser-dispose-workspace', workspaceId),
  onBrowserUrlUpdated: (callback: (payload: { workspaceId: string; url: string }) => void) => {
    const handler = (_: any, payload: { workspaceId: string; url: string }) => callback(payload);
    ipcRenderer.on('browser-url-updated', handler);
    return () => ipcRenderer.removeListener('browser-url-updated', handler);
  },
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
  gitUnstage: (workspacePath: string, files?: string[]) => ipcRenderer.invoke('git-unstage', workspacePath, files),
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
  gitForceDeleteBranch: (workspacePath: string, name: string) =>
    ipcRenderer.invoke('git-force-delete-branch', workspacePath, name),
  gitMergeBranch: (workspacePath: string, branchName: string) => ipcRenderer.invoke('git-merge-branch', workspacePath, branchName),
  gitAbortOperation: (workspacePath: string) => ipcRenderer.invoke('git-abort-operation', workspacePath),
  gitStash: (workspacePath: string, message?: string, includeUntracked?: boolean) =>
    ipcRenderer.invoke('git-stash', workspacePath, message, includeUntracked),
  gitApplyStash: (workspacePath: string, stashRef: string) => ipcRenderer.invoke('git-apply-stash', workspacePath, stashRef),
  gitPopStash: (workspacePath: string, stashRef: string) => ipcRenderer.invoke('git-pop-stash', workspacePath, stashRef),
  gitDropStash: (workspacePath: string, stashRef: string) => ipcRenderer.invoke('git-drop-stash', workspacePath, stashRef),
  gitClearStashes: (workspacePath: string) => ipcRenderer.invoke('git-clear-stashes', workspacePath),
  gitRefresh: () => ipcRenderer.invoke('git-refresh'),
  gitInit: (workspacePath: string, defaultBranch?: string) =>
    ipcRenderer.invoke('git-init', workspacePath, defaultBranch),
  gitGetRemotes: (workspacePath: string) => ipcRenderer.invoke('git-get-remotes', workspacePath),
  gitAddRemote: (workspacePath: string, name: string, url: string) =>
    ipcRenderer.invoke('git-add-remote', workspacePath, name, url),
  gitRemoveRemote: (workspacePath: string, name: string) =>
    ipcRenderer.invoke('git-remove-remote', workspacePath, name),
  gitRenameRemote: (workspacePath: string, oldName: string, newName: string) =>
    ipcRenderer.invoke('git-rename-remote', workspacePath, oldName, newName),
  gitFetch: (workspacePath: string, remote?: string) => ipcRenderer.invoke('git-fetch', workspacePath, remote),
  gitPull: (workspacePath: string, rebase?: boolean) => ipcRenderer.invoke('git-pull', workspacePath, rebase),
  gitPush: (
    workspacePath: string,
    remote?: string,
    branch?: string,
    forceWithLease?: boolean,
    setUpstream?: boolean
  ) => ipcRenderer.invoke('git-push', workspacePath, remote, branch, forceWithLease, setUpstream),
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

  // Credential management
  credentialGenerateSshKey: () => ipcRenderer.invoke('credential:generate-ssh-key'),
  credentialGetPublicKey: () => ipcRenderer.invoke('credential:get-public-key'),
  credentialDeleteSshKey: () => ipcRenderer.invoke('credential:delete-ssh-key'),
  credentialCheckExists: () => ipcRenderer.invoke('credential:check-exists'),
  credentialSavePat: (provider: VcsProvider, token: string, scope?: string[]) =>
    ipcRenderer.invoke('credential:save-pat', { provider, token, scope }),
  credentialGetPat: (provider: VcsProvider) => ipcRenderer.invoke('credential:get-pat', provider),
  credentialDeletePat: (provider: VcsProvider) => ipcRenderer.invoke('credential:delete-pat', provider),
  credentialGetStatus: (remoteName: string, remoteUrl: string, provider: VcsProvider) =>
    ipcRenderer.invoke('credential:get-status', remoteName, remoteUrl, provider),
  credentialGetGlobalStatus: () => ipcRenderer.invoke('credential:get-global-status'),
  credentialConfigureSshHost: (hostname: string) => ipcRenderer.invoke('credential:configure-ssh-host', hostname),

  // VCS Provider Context
  vcsGetContext: (workspacePath: string) => ipcRenderer.invoke('vcs:get-context', workspacePath),
  vcsGetPrInfo: (workspacePath: string) => ipcRenderer.invoke('vcs:get-pr-info', workspacePath),
  vcsGetDeepLinks: (workspacePath: string, prNumber?: number) => ipcRenderer.invoke('vcs:get-deep-links', workspacePath, prNumber),
  vcsGetDeepLink: (workspacePath: string, type: string) => ipcRenderer.invoke('vcs:get-deep-link', workspacePath, type),
  vcsOpenDeepLink: (workspacePath: string, type: string) => ipcRenderer.invoke('vcs:open-deep-link', workspacePath, type),
});
