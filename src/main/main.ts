import { app, BrowserWindow, Menu, WebContentsView, ipcMain, shell } from 'electron';

// Disable GPU acceleration for compatibility in some environments
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

import * as path from 'path';
import Store from 'electron-store';
import * as pty from 'node-pty';
import { GitService } from './gitService';
import { resolveExistingDirectory } from './security';
import { type AiCommitProvider } from './aiCommit';
import { HARNESS_OPTIONS } from './harnessCatalog';
import {
  generateSshKey,
  readPublicKey,
  deleteSshKeyPair,
  savePat,
  getPat,
  deletePat,
  getCredentialStatus,
  getGlobalCredentialStatus,
  configureSshForHost,
  checkSshKeyExists,
  type SavePatRequest,
} from './credential';
import type { VcsProvider } from './vcs';
import {
  getProviderContext,
  getProviderDeepLinks,
  getDeepLinkUrl,
  type ProviderContextResult,
  type DeepLink,
} from './vcs';
import { registerSettingsIpc } from './ipc/settingsIpc';
import { registerTerminalIpc } from './ipc/terminalIpc';
import { registerBrowserIpc } from './ipc/browserIpc';

interface Terminal {
  id: string;
  pid: number;
  pty: pty.IPty;
  buffer: string;
}

interface StoreSchema {
  lastWorkspace: string;
  showFastfetch: boolean;
  aiCommitEnabled: boolean;
  aiCommitProvider: AiCommitProvider;
  aiCommitModel: string;
}

const store = new Store<StoreSchema>({
  defaults: {
    lastWorkspace: app.getPath('home'),
    showFastfetch: false,
    aiCommitEnabled: false,
    aiCommitProvider: 'codex',
    aiCommitModel: '',
  },
});

// Git service and terminal state (needed for git handlers, window creation, and IPC)
const terminals: Map<string, Terminal> = new Map();
let mainWindow: BrowserWindow | null = null;

function getValidatedWorkspacePath(workspacePath: string): string | null {
  return resolveExistingDirectory(workspacePath);
}

function getInvalidWorkspaceResult() {
  return { success: false, error: 'Workspace path is invalid or not a directory' };
}

function getSafeWorkspacePath(workingDir: string, storeInstance: Store<StoreSchema>): string {
  return (
    resolveExistingDirectory(workingDir, storeInstance.get('lastWorkspace'))
    ?? app.getPath('home')
  );
}

// ============================================================================
// Git Service - Handles all git operations in the main process
// ============================================================================
const gitService = new GitService((status) => {
  if (mainWindow) {
    mainWindow.webContents.send('git-status-update', status);
  }
});

async function refreshGitStatus(workspacePath: string) {
  const status = await gitService.getStatus(workspacePath);
  if (mainWindow) {
    mainWindow.webContents.send('git-status-update', status);
  }
  return status;
}

function getRendererUrl(query: Record<string, string | undefined>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value.length > 0) {
      searchParams.set(key, value);
    }
  }
  const queryString = searchParams.toString();

  if (process.env.NODE_ENV === 'development') {
    return `http://localhost:1420${queryString ? `/?${queryString}` : '/'}`;
  }

  const fileUrl = path.join(__dirname, '../renderer/index.html');
  return queryString ? `${fileUrl}?${queryString}` : fileUrl;
}

function getIconPath() {
  if (process.env.NODE_ENV === 'development') {
    return path.join(__dirname, '../../build/icon.png');
  }
  return path.join(process.resourcesPath, 'icon.png');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Clanker Grid',
    backgroundColor: '#0d1117',
    icon: getIconPath(),
    show: true,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAutoHideMenuBar(true);
  Menu.setApplicationMenu(null);

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(getRendererUrl({}));
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    browserViews.forEach(({ view }) => {
      view.webContents.close();
    });
    browserViews.clear();
    activeBrowserWorkspaceId = null;
    mainWindow = null;
    terminals.forEach((term) => term.pty.kill());
    terminals.clear();
    gitService.stopPolling();
  });
}

// Settings IPC handlers moved to settingsIpc module (S2.3)
// Git IPC handlers start below

// ============================================================================
// Git IPC Handlers - Delegated to GitService
// ============================================================================

ipcMain.handle('git-start-polling', (_, workspacePath: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return;
  }

  gitService.startPolling(safeWorkspacePath);
});

ipcMain.handle('git-stop-polling', () => {
  gitService.stopPolling();
});

ipcMain.handle('git-get-branch-state', async (_, workspacePath: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return {
      success: false,
      isRepo: false,
      currentBranch: null,
      isDetached: false,
      branches: [],
      error: getInvalidWorkspaceResult().error,
    };
  }

  return gitService.getBranchState(safeWorkspacePath);
});

ipcMain.handle('git-get-operation-state', async (_, workspacePath: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return {
      success: false,
      isRepo: false,
      inProgress: false,
      mode: 'none',
      conflicts: [],
      message: 'Workspace path is invalid or not a directory',
      error: getInvalidWorkspaceResult().error,
    };
  }

  return gitService.getOperationState(safeWorkspacePath);
});

ipcMain.handle('git-get-stashes', async (_, workspacePath: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return [];
  }

  return gitService.listStashes(safeWorkspacePath);
});

ipcMain.handle('git-get-history', async (_, workspacePath: string, limit?: number) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return [];
  }

  return gitService.getHistory(safeWorkspacePath, limit);
});

ipcMain.handle('git-get-diff', async (
  _,
  workspacePath: string,
  mode: 'working' | 'staged' | 'commit',
  ref?: string
) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return {
      success: false,
      output: '',
      title: 'Diff',
      error: getInvalidWorkspaceResult().error,
    };
  }

  return gitService.getDiff(safeWorkspacePath, mode, ref);
});

ipcMain.handle('git-stage', async (_, workspacePath: string, files?: string[]) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return getInvalidWorkspaceResult();
  }

  const result = await gitService.stage(safeWorkspacePath, files);
  // Refresh status after staging
  await refreshGitStatus(safeWorkspacePath);
  return result;
});

ipcMain.handle('git-unstage', async (_, workspacePath: string, files?: string[]) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return getInvalidWorkspaceResult();
  }

  const result = await gitService.unstage(safeWorkspacePath, files);
  // Refresh status after unstaging
  await refreshGitStatus(safeWorkspacePath);
  return result;
});

ipcMain.handle('git-commit', async (_, workspacePath: string, message: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return getInvalidWorkspaceResult();
  }

  const result = await gitService.commit(safeWorkspacePath, message);
  // Refresh status after commit
  await refreshGitStatus(safeWorkspacePath);
  return result;
});

ipcMain.handle('git-create-branch', async (_, workspacePath: string, name: string, baseBranch?: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return getInvalidWorkspaceResult();
  }

  const result = await gitService.createBranch(safeWorkspacePath, name, baseBranch);
  if (result.success) {
    await refreshGitStatus(safeWorkspacePath);
  }
  return result;
});

ipcMain.handle('git-switch-branch', async (_, workspacePath: string, name: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return getInvalidWorkspaceResult();
  }

  const result = await gitService.switchBranch(safeWorkspacePath, name);
  if (result.success) {
    await refreshGitStatus(safeWorkspacePath);
  }
  return result;
});

ipcMain.handle('git-delete-branch', async (_, workspacePath: string, name: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return getInvalidWorkspaceResult();
  }

  const result = await gitService.deleteBranch(safeWorkspacePath, name);
  if (result.success) {
    await refreshGitStatus(safeWorkspacePath);
  }
  return result;
});

ipcMain.handle('git-force-delete-branch', async (_, workspacePath: string, name: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return getInvalidWorkspaceResult();
  }

  const result = await gitService.forceDeleteBranch(safeWorkspacePath, name);
  if (result.success) {
    await refreshGitStatus(safeWorkspacePath);
  }
  return result;
});

ipcMain.handle('git-merge-branch', async (_, workspacePath: string, branchName: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return getInvalidWorkspaceResult();
  }

  const result = await gitService.mergeBranch(safeWorkspacePath, branchName);
  if (result.success) {
    await refreshGitStatus(safeWorkspacePath);
  }
  return result;
});

ipcMain.handle('git-abort-operation', async (_, workspacePath: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return getInvalidWorkspaceResult();
  }

  const result = await gitService.abortCurrentOperation(safeWorkspacePath);
  if (result.success) {
    await refreshGitStatus(safeWorkspacePath);
  }
  return result;
});

ipcMain.handle('git-stash', async (_, workspacePath: string, message?: string, includeUntracked?: boolean) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return getInvalidWorkspaceResult();
  }

  const result = await gitService.stashChanges(safeWorkspacePath, message, includeUntracked);
  if (result.success) {
    await refreshGitStatus(safeWorkspacePath);
  }
  return result;
});

ipcMain.handle('git-apply-stash', async (_, workspacePath: string, stashRef: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return getInvalidWorkspaceResult();
  }

  const result = await gitService.applyStash(safeWorkspacePath, stashRef);
  if (result.success) {
    await refreshGitStatus(safeWorkspacePath);
  }
  return result;
});

ipcMain.handle('git-pop-stash', async (_, workspacePath: string, stashRef: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return getInvalidWorkspaceResult();
  }

  const result = await gitService.popStash(safeWorkspacePath, stashRef);
  if (result.success) {
    await refreshGitStatus(safeWorkspacePath);
  }
  return result;
});

ipcMain.handle('git-drop-stash', async (_, workspacePath: string, stashRef: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return getInvalidWorkspaceResult();
  }

  const result = await gitService.dropStash(safeWorkspacePath, stashRef);
  if (result.success) {
    await refreshGitStatus(safeWorkspacePath);
  }
  return result;
});

ipcMain.handle('git-clear-stashes', async (_, workspacePath: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return getInvalidWorkspaceResult();
  }

  const result = await gitService.clearStashes(safeWorkspacePath);
  if (result.success) {
    await refreshGitStatus(safeWorkspacePath);
  }
  return result;
});

ipcMain.handle('git-refresh', async () => {
  const workspacePath = gitService.getCurrentWorkspace();
  if (!workspacePath) {
    return null;
  }

  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    gitService.stopPolling();
    return {
      success: false,
      isRepo: false,
      currentBranch: null,
      isDetached: false,
      changes: [],
      error: getInvalidWorkspaceResult().error,
    };
  }

  return gitService.getStatus(safeWorkspacePath);
});

ipcMain.handle('git-init', async (_, workspacePath: string, defaultBranch?: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return getInvalidWorkspaceResult();
  }

  // Check if already a repo
  const isAlreadyRepo = await gitService.isRepo(safeWorkspacePath);
  if (isAlreadyRepo) {
    return { success: false, error: 'Already a git repository' };
  }

  const result = await gitService.initRepository(safeWorkspacePath, { defaultBranch });

  // Refresh status after init so UI updates
  if (result.success) {
    await refreshGitStatus(safeWorkspacePath);
  }

  return result;
});

ipcMain.handle('git-get-remotes', async (_, workspacePath: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return { success: false, remotes: [], provider: 'unknown', error: 'Invalid workspace path' };
  }

  return gitService.getRemotes(safeWorkspacePath);
});

ipcMain.handle('git-fetch', async (_, workspacePath: string, remote?: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return { success: false, error: 'Invalid workspace path' };
  }
  return gitService.fetch(safeWorkspacePath, remote);
});

ipcMain.handle('git-pull', async (_, workspacePath: string, rebase?: boolean) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return { success: false, error: 'Invalid workspace path' };
  }
  return gitService.pull(safeWorkspacePath, rebase);
});

ipcMain.handle(
  'git-push',
  async (
    _,
    workspacePath: string,
    remote?: string,
    branch?: string,
    forceWithLease?: boolean,
    setUpstream?: boolean
  ) => {
    const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
    if (!safeWorkspacePath) {
      return { success: false, error: 'Invalid workspace path' };
    }
    return gitService.push(safeWorkspacePath, remote, branch, forceWithLease, setUpstream);
  }
);

ipcMain.handle('git-add-remote', async (_, workspacePath: string, name: string, url: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return { success: false, error: 'Invalid workspace path' };
  }
  if (typeof name !== 'string' || typeof url !== 'string') {
    return { success: false, error: 'Remote name and URL must be strings' };
  }
  return gitService.addRemote(safeWorkspacePath, name, url);
});

ipcMain.handle('git-remove-remote', async (_, workspacePath: string, name: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return { success: false, error: 'Invalid workspace path' };
  }
  if (typeof name !== 'string') {
    return { success: false, error: 'Remote name must be a string' };
  }
  return gitService.removeRemote(safeWorkspacePath, name);
});

ipcMain.handle('git-rename-remote', async (_, workspacePath: string, oldName: string, newName: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return { success: false, error: 'Invalid workspace path' };
  }
  if (typeof oldName !== 'string' || typeof newName !== 'string') {
    return { success: false, error: 'Remote names must be strings' };
  }
  return gitService.renameRemote(safeWorkspacePath, oldName, newName);
});

// Credential management handlers
ipcMain.handle('credential:generate-ssh-key', async () => {
  return generateSshKey();
});

ipcMain.handle('credential:get-public-key', async () => {
  return readPublicKey();
});

ipcMain.handle('credential:delete-ssh-key', async () => {
  return deleteSshKeyPair();
});

ipcMain.handle('credential:check-exists', async () => {
  return { exists: checkSshKeyExists() };
});

ipcMain.handle('credential:save-pat', async (_, request: SavePatRequest) => {
  return savePat(request);
});

ipcMain.handle('credential:get-pat', async (_, provider: VcsProvider) => {
  return getPat(provider);
});

ipcMain.handle('credential:delete-pat', async (_, provider: VcsProvider) => {
  return deletePat(provider);
});

ipcMain.handle('credential:get-status', async (_, remoteName: string, remoteUrl: string, provider: VcsProvider) => {
  return getCredentialStatus(remoteName, remoteUrl, provider);
});

ipcMain.handle('credential:get-global-status', async () => {
  return await getGlobalCredentialStatus();
});

ipcMain.handle('credential:configure-ssh-host', async (_, hostname: string) => {
  return configureSshForHost(hostname);
});

// ============================================================================
// VCS Context IPC Handlers - Provider API integration
// ============================================================================

ipcMain.handle('vcs:get-context', async (_, workspacePath: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return {
      success: false,
      error: 'Invalid workspace path',
    } as ProviderContextResult;
  }

  // Get current branch and remotes
  const [branchState, remotesResult] = await Promise.all([
    gitService.getBranchState(safeWorkspacePath),
    gitService.getRemotes(safeWorkspacePath),
  ]);

  if (!branchState.success || !remotesResult.success || remotesResult.remotes.length === 0) {
    return {
      success: false,
      error: 'Not a git repository or no remotes configured',
    } as ProviderContextResult;
  }

  const currentBranch = branchState.currentBranch || 'main';
  const primaryRemote = remotesResult.remotes[0];

  return getProviderContext(
    primaryRemote.name,
    primaryRemote.fetchUrl,
    currentBranch
  );
});

ipcMain.handle('vcs:get-pr-info', async (_, workspacePath: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return { success: false, error: 'Invalid workspace path' };
  }

  const [branchState, remotesResult] = await Promise.all([
    gitService.getBranchState(safeWorkspacePath),
    gitService.getRemotes(safeWorkspacePath),
  ]);

  if (!branchState.success || !remotesResult.success || remotesResult.remotes.length === 0) {
    return { success: false, error: 'Not a git repository or no remotes' };
  }

  const currentBranch = branchState.currentBranch || 'main';
  const primaryRemote = remotesResult.remotes[0];

  const contextResult = await getProviderContext(
    primaryRemote.name,
    primaryRemote.fetchUrl,
    currentBranch
  );

  return {
    success: contextResult.success,
    provider: contextResult.provider,
    pullRequest: contextResult.pullRequest,
    deepLinks: contextResult.deepLinks,
    error: contextResult.error,
  };
});

ipcMain.handle('vcs:get-deep-links', async (_, workspacePath: string, prNumber?: number) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return [] as DeepLink[];
  }

  const [branchState, remotesResult] = await Promise.all([
    gitService.getBranchState(safeWorkspacePath),
    gitService.getRemotes(safeWorkspacePath),
  ]);

  if (!branchState.success || !remotesResult.success || remotesResult.remotes.length === 0) {
    return [] as DeepLink[];
  }

  const currentBranch = branchState.currentBranch || undefined;
  const primaryRemote = remotesResult.remotes[0];

  const contextResult = await getProviderContext(
    primaryRemote.name,
    primaryRemote.fetchUrl,
    currentBranch || 'main'
  );

  const defaultBranch = contextResult.provider?.defaultBranch;

  return getProviderDeepLinks(primaryRemote.fetchUrl, currentBranch, prNumber, defaultBranch);
});

ipcMain.handle('vcs:get-deep-link', async (_, workspacePath: string, type: DeepLink['type']) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return null;
  }

  const [branchState, remotesResult] = await Promise.all([
    gitService.getBranchState(safeWorkspacePath),
    gitService.getRemotes(safeWorkspacePath),
  ]);

  if (!branchState.success || !remotesResult.success || remotesResult.remotes.length === 0) {
    return null;
  }

  const currentBranch = branchState.currentBranch || undefined;
  const primaryRemote = remotesResult.remotes[0];

  // First get context to find PR number if it exists
  const contextResult = await getProviderContext(
    primaryRemote.name,
    primaryRemote.fetchUrl,
    currentBranch || 'main'
  );

  const prNumber = contextResult.pullRequest?.exists ? contextResult.pullRequest.number : undefined;
  const defaultBranch = contextResult.provider?.defaultBranch;

  return getDeepLinkUrl(primaryRemote.fetchUrl, type, currentBranch, prNumber, defaultBranch);
});

ipcMain.handle('vcs:open-deep-link', async (_, workspacePath: string, type: DeepLink['type']) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return false;
  }

  const [branchState, remotesResult] = await Promise.all([
    gitService.getBranchState(safeWorkspacePath),
    gitService.getRemotes(safeWorkspacePath),
  ]);

  if (!branchState.success || !remotesResult.success || remotesResult.remotes.length === 0) {
    return false;
  }

  const currentBranch = branchState.currentBranch || undefined;
  const primaryRemote = remotesResult.remotes[0];

  const contextResult = await getProviderContext(
    primaryRemote.name,
    primaryRemote.fetchUrl,
    currentBranch || 'main'
  );

  const prNumber = contextResult.pullRequest?.exists ? contextResult.pullRequest.number : undefined;
  const defaultBranch = contextResult.provider?.defaultBranch;

  const url = getDeepLinkUrl(primaryRemote.fetchUrl, type, currentBranch, prNumber, defaultBranch);
  if (url) {
    void shell.openExternal(url);
    return true;
  }

  return false;
});

// App lifecycle
const browserViews = new Map<string, { view: WebContentsView; url: string }>();
let activeBrowserWorkspaceId: string | null = null;

app.whenReady().then(() => {
  // Register settings IPC handlers (extracted per S2.3)
  registerSettingsIpc({
    getStore: () => store,
    getMainWindow: () => mainWindow,
    getGitService: () => gitService,
  });
  // Register terminal IPC handlers (extracted per S2.1)
  registerTerminalIpc({
    getTerminals: () => terminals,
    getMainWindow: () => mainWindow,
    getStore: () => store,
    getSafeWorkspacePath: (workingDir: string) => getSafeWorkspacePath(workingDir, store),
    getHarnessOptions: () => HARNESS_OPTIONS,
  });
  // Register browser IPC handlers (extracted per S2.2)
  registerBrowserIpc({
    getMainWindow: () => mainWindow,
    getBrowserViews: () => browserViews,
    getActiveBrowserWorkspaceId: () => activeBrowserWorkspaceId,
    setActiveBrowserWorkspaceId: (id) => { activeBrowserWorkspaceId = id; },
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
