import { app, BrowserWindow, Menu, WebContentsView, ipcMain, dialog, shell } from 'electron';

// Disable GPU acceleration for compatibility in some environments
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as pty from 'node-pty';
import Store from 'electron-store';
import {
  buildHarnessSpawnArgs,
} from './harnessLaunch';
import {
  AI_COMMIT_COMMANDS,
  buildAiCommitArgs,
  buildCommitPrompt,
  getAiCommitTimeoutMs,
  normalizeCommitMessageOutput,
  type AiCommitProvider,
} from './aiCommit';
import {
  discoverHarnessModels,
  getAvailableHarnessOptions,
  HARNESS_OPTIONS,
} from './harnessCatalog';
import { GitService, type GitStatusEntry } from './gitService';
import {
  normalizeAppBrowserUrl,
  normalizeExternalUrl,
  resolveExistingDirectory,
} from './security';

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

function runCommandWithInput(
  command: string,
  args: string[],
  input: string,
  timeoutMs = 30000,
  extraEnv?: Record<string, string>,
  cwd?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...extraEnv,
      } as { [key: string]: string },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      stdout += String(data);
    });

    child.stderr.on('data', (data) => {
      stderr += String(data);
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(Object.assign(error, { stdout, stderr }));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const error = new Error(`Command failed with exit code ${code ?? 'unknown'}`);
        reject(Object.assign(error, { stdout, stderr, code }));
        return;
      }

      resolve(stdout || stderr);
    });

    child.stdin.end(input.endsWith('\n') ? input : `${input}\n`);
  });
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

function formatCommitChangeSummary(changes: GitStatusEntry[]): string[] {
  return changes.map((change) => `${change.staged ? 'staged' : 'unstaged'} ${change.status}: ${change.path}`);
}

const terminals: Map<string, Terminal> = new Map();
let mainWindow: BrowserWindow | null = null;
let browserView: WebContentsView | null = null;
let currentBrowserUrl = 'https://github.com';

function getValidatedWorkspacePath(workspacePath: string): string | null {
  return resolveExistingDirectory(workspacePath);
}

function getSafeWorkspacePath(workingDir: string): string {
  return (
    resolveExistingDirectory(workingDir, store.get('lastWorkspace'))
    ?? app.getPath('home')
  );
}

function getInvalidWorkspaceResult() {
  return { success: false, error: 'Workspace path is invalid or not a directory' };
}

// ============================================================================
// Git Service - Handles all git operations in the main process
// This service manages polling and can be extended for GitHub API integration
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

async function resolveAiCommitModel(provider: AiCommitProvider, configuredModel: string): Promise<string | null> {
  const models = await discoverHarnessModels(provider);
  if (configuredModel && models.some((model) => model.id === configuredModel)) {
    return configuredModel;
  }

  return models[0]?.id ?? null;
}

async function generateAiCommitMessage(workspacePath: string): Promise<{ success: boolean; message?: string; error?: string }> {
  const enabled = store.get('aiCommitEnabled');
  if (!enabled) {
    return { success: false, error: 'AI commit message generation is disabled' };
  }

  const provider = store.get('aiCommitProvider');
  const providerConfig = AI_COMMIT_COMMANDS[provider];
  if (!providerConfig) {
    return { success: false, error: 'Unsupported AI commit provider' };
  }

  const context = await gitService.getCommitPromptContext(workspacePath);
  if (!context.success) {
    return { success: false, error: context.error || 'Unable to build commit context' };
  }

  const model = await resolveAiCommitModel(provider, store.get('aiCommitModel'));
  if (!model) {
    return { success: false, error: `No models available for ${provider}` };
  }

  const prompt = buildCommitPrompt({
    workspacePath,
    branchName: context.currentBranch,
    isDetached: context.isDetached,
    changeSummary: formatCommitChangeSummary(context.changes),
    diffMode: context.diffMode,
    diffSummary: context.diffSummary,
  });

  const args = buildAiCommitArgs(provider, model);
  const output = await runCommandWithInput(
    providerConfig.command,
    args,
    prompt,
    getAiCommitTimeoutMs(provider),
    undefined,
    workspacePath
  );
  const message = normalizeCommitMessageOutput(output);

  if (!message) {
    return { success: false, error: 'AI model returned an empty commit message' };
  }

  return { success: true, message };
}

function emitFitAllPanesShortcut() {
  mainWindow?.webContents.send('fit-all-panes');
}

function attachBrowserShortcutHandlers(view: WebContentsView) {
  view.webContents.on('before-input-event', (_event, input) => {
    if (
      (input.control || input.meta) &&
      input.shift &&
      input.key.toLowerCase() === 'f'
    ) {
      emitFitAllPanesShortcut();
    }
  });
}

function attachBrowserSecurityHandlers(view: WebContentsView) {
  view.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = normalizeExternalUrl(url);
    if (externalUrl) {
      void shell.openExternal(externalUrl);
    }
    return { action: 'deny' };
  });

  view.webContents.on('will-navigate', (event, url) => {
    if (!normalizeAppBrowserUrl(url)) {
      event.preventDefault();
    }
  });
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
    browserView?.webContents.close();
    browserView = null;
    mainWindow = null;
    terminals.forEach((term) => term.pty.kill());
    terminals.clear();
    gitService.stopPolling();
  });
}

// Initialize browser view (hidden by default)
function initBrowserView() {
  if (browserView || !mainWindow) return;

  browserView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      partition: 'persist:browser',
    },
  });

  attachBrowserSecurityHandlers(browserView);
  void browserView.webContents.loadURL(currentBrowserUrl);
  mainWindow.contentView.addChildView(browserView);
  attachBrowserShortcutHandlers(browserView);
  
  // Initially hide it
  browserView.setVisible(false);
  browserView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
}

// Show/hide and position browser view
function updateBrowserView(x: number, y: number, width: number, height: number, visible: boolean) {
  if (!mainWindow) return;

  if (!browserView) {
    initBrowserView();
  }

  if (browserView) {
    browserView.setVisible(visible);
    if (visible && width > 0 && height > 0) {
      browserView.setBounds({ x, y, width, height });
    }
  }
}

// IPC Handlers
ipcMain.handle('get-last-workspace', () => {
  return store.get('lastWorkspace');
});

ipcMain.handle('get-show-fastfetch', () => {
  return store.get('showFastfetch');
});

ipcMain.handle('set-show-fastfetch', (_, showFastfetch: boolean) => {
  store.set('showFastfetch', showFastfetch);
});

ipcMain.handle('get-ai-commit-settings', () => {
  return {
    enabled: store.get('aiCommitEnabled'),
    provider: store.get('aiCommitProvider'),
    model: store.get('aiCommitModel'),
  };
});

ipcMain.handle('set-ai-commit-enabled', (_, enabled: boolean) => {
  store.set('aiCommitEnabled', enabled);
});

ipcMain.handle('set-ai-commit-provider', (_, provider: AiCommitProvider) => {
  store.set('aiCommitProvider', provider);
});

ipcMain.handle('set-ai-commit-model', (_, model: string) => {
  store.set('aiCommitModel', model);
});

ipcMain.handle('generate-commit-message', async (_, workspacePath: string) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return getInvalidWorkspaceResult();
  }

  return generateAiCommitMessage(safeWorkspacePath);
});

ipcMain.handle('open-directory-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Select Workspace Directory',
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const selectedPath = result.filePaths[0];
    store.set('lastWorkspace', selectedPath);
    return selectedPath;
  }
  return null;
});

ipcMain.handle('read-directory', async (_, dirPath: string) => {
  const safeDirectoryPath = resolveExistingDirectory(dirPath);
  if (!safeDirectoryPath) {
    return [];
  }

  try {
    const entries = fs.readdirSync(safeDirectoryPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
      }));
  } catch {
    return [];
  }
});

ipcMain.handle('get-harness-models', async (_, harness: string) => {
  return discoverHarnessModels(harness);
});

ipcMain.handle('spawn-terminal', (_, workingDir: string, harness?: string, model?: string) => {
  const id = `term-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const cwd = getSafeWorkspacePath(workingDir);
  
  // Use user's default shell, fallback to bash
  const userShell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : 'bash');
  
  // Spawn with interactive flags for better shell experience
  // -i: interactive mode (enables completion, aliases, etc.)
  // --login: load profile files (~/.bash_profile, ~/.zprofile)
  const shellArgs = ['-i'];
  
  const harnessEnv = harness && HARNESS_OPTIONS[harness]?.env ? HARNESS_OPTIONS[harness].env : {};

  const ptyProcess = harness && HARNESS_OPTIONS[harness]
    ? pty.spawn(
        HARNESS_OPTIONS[harness].command,
        buildHarnessSpawnArgs(HARNESS_OPTIONS[harness], model),
        {
          name: 'xterm-256color',
          cwd,
          env: {
            ...process.env as { [key: string]: string },
            ...harnessEnv,
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
            TERM_PROGRAM: 'clanker-grid',
            FORCE_COLOR: '1',
            ...(store.get('showFastfetch') ? {} : { CLANKER_GRID: '1' }),
          },
        }
      )
    : pty.spawn(userShell, shellArgs, {
        name: 'xterm-256color',
        cwd,
        env: {
          ...process.env as { [key: string]: string },
          ...harnessEnv,
          // Ensure proper terminal settings
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          // Helpful for shells that detect terminal
          TERM_PROGRAM: 'clanker-grid',
          // Enable true color
          FORCE_COLOR: '1',
          // Disable fastfetch in app terminals (if setting is off)
          ...(store.get('showFastfetch') ? {} : { CLANKER_GRID: '1' }),
        },
      });

  const terminal: Terminal = { id, pid: ptyProcess.pid, pty: ptyProcess, buffer: '' };
  terminals.set(id, terminal);

  if (harness && HARNESS_OPTIONS[harness]) {
    const config = HARNESS_OPTIONS[harness];
    const launchArgs = buildHarnessSpawnArgs(config, model);
    console.info('[clanker-grid] harness launch', {
      harness,
      command: config.command,
      args: launchArgs,
      model: model ?? null,
    });
    if (mainWindow) {
      const visibleLaunch = `[clanker-grid] ${config.command} ${launchArgs.join(' ')}\r\n`;
      mainWindow.webContents.send('terminal-data', { id, data: visibleLaunch });
      terminal.buffer += visibleLaunch;
    }
  }

  ptyProcess.onData((data) => {
    terminal.buffer += data;
    if (mainWindow) {
      mainWindow.webContents.send('terminal-data', { id, data });
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    terminals.delete(id);
    if (mainWindow) {
      mainWindow.webContents.send('terminal-exit', { id, exitCode });
    }
  });

  return { id, pid: ptyProcess.pid };
});

ipcMain.handle('get-terminal-buffer', (_, id: string) => {
  return terminals.get(id)?.buffer ?? '';
});

ipcMain.handle('write-terminal', (_, { id, data }: { id: string; data: string }) => {
  const terminal = terminals.get(id);
  if (terminal) {
    terminal.pty.write(data);
  }
});

ipcMain.handle('resize-terminal', (_, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
  const terminal = terminals.get(id);
  if (terminal) {
    terminal.pty.resize(cols, rows);
  }
});

ipcMain.handle('kill-terminal', (_, id: string) => {
  const terminal = terminals.get(id);
  if (terminal) {
    terminal.pty.kill();
    terminals.delete(id);
  }
});

// Browser view with viewport coordinates
ipcMain.handle('browser-set-bounds', (_, viewportBounds: { x: number; y: number; width: number; height: number }) => {
  // viewportBounds are already relative to window content area (from getBoundingClientRect)
  // WebContentsView.setBounds uses content coordinates, so these should work directly
  updateBrowserView(
    viewportBounds.x,
    viewportBounds.y,
    viewportBounds.width,
    viewportBounds.height,
    true
  );
});

ipcMain.handle('browser-hide', () => {
  updateBrowserView(0, 0, 0, 0, false);
});

ipcMain.handle('browser-navigate', (_, url: string) => {
  const safeUrl = normalizeAppBrowserUrl(url);
  if (!safeUrl) {
    return false;
  }

  currentBrowserUrl = safeUrl;
  if (browserView) {
    void browserView.webContents.loadURL(safeUrl);
  }
  return true;
});

ipcMain.handle('browser-back', () => {
  if (browserView && browserView.webContents.navigationHistory.canGoBack()) {
    browserView.webContents.navigationHistory.goBack();
  }
});

ipcMain.handle('browser-forward', () => {
  if (browserView && browserView.webContents.navigationHistory.canGoForward()) {
    browserView.webContents.navigationHistory.goForward();
  }
});

ipcMain.handle('browser-refresh', () => {
  if (browserView) {
    browserView.webContents.reload();
  }
});

ipcMain.handle('browser-stop', () => {
  if (browserView) {
    browserView.webContents.stop();
  }
});

ipcMain.handle('open-external', (_, url: string) => {
  const safeUrl = normalizeExternalUrl(url);
  if (!safeUrl) {
    return false;
  }

  void shell.openExternal(safeUrl);
  return true;
});

ipcMain.handle('minimize-window', () => {
  mainWindow?.minimize();
});

ipcMain.handle('toggle-maximize-window', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.handle('close-window', () => {
  mainWindow?.close();
});

ipcMain.handle('is-maximized-window', () => {
  return mainWindow?.isMaximized() ?? false;
});

ipcMain.handle('get-harness-options', () => {
  return getAvailableHarnessOptions();
});

ipcMain.handle('can-go-back', () => {
  return browserView?.webContents.navigationHistory.canGoBack() ?? false;
});

ipcMain.handle('can-go-forward', () => {
  return browserView?.webContents.navigationHistory.canGoForward() ?? false;
});

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

ipcMain.handle('git-push', async (_, workspacePath: string, remote?: string, branch?: string, forceWithLease?: boolean) => {
  const safeWorkspacePath = getValidatedWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return { success: false, error: 'Invalid workspace path' };
  }
  return gitService.push(safeWorkspacePath, remote, branch, forceWithLease);
});

// App lifecycle
app.whenReady().then(() => {
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
