import { app, BrowserWindow, Menu, WebContentsView, ipcMain, dialog, shell } from 'electron';

// Disable GPU acceleration for compatibility in some environments
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('disable-setuid-sandbox');

import * as path from 'path';
import * as fs from 'fs';
import * as pty from 'node-pty';
import Store from 'electron-store';

interface Terminal {
  id: string;
  pid: number;
  pty: pty.IPty;
  buffer: string;
}

interface StoreSchema {
  lastWorkspace: string;
}

interface HarnessConfig {
  command: string;
  args: string[];
  name: string;
  icon: string;
  env?: Record<string, string>;
}

export const HARNESS_OPTIONS: Record<string, HarnessConfig> = {
  'codex': {
    name: 'Codex',
    command: 'codex',
    args: ['--yolo'],
    icon: '🧠',
  },
  'opencode': {
    name: 'OpenCode',
    command: 'opencode',
    args: ['--pure'],
    icon: '⚡',
    env: {
      OPENCODE_PERMISSION: JSON.stringify({
        bash: { '*': 'allow' },
        edit: 'allow',
      }),
    },
  },
  'pi': {
    name: 'Pi',
    command: 'pi',
    args: [],
    icon: 'π',
  },
  'claude': {
    name: 'Claude',
    command: 'claude',
    args: [],
    icon: '✨',
  },
};

function isCommandAvailable(command: string): boolean {
  const searchPaths = new Set<string>([
    process.cwd(),
    path.join(process.cwd(), 'node_modules', '.bin'),
    app.getAppPath(),
    path.join(app.getAppPath(), 'node_modules', '.bin'),
    ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean),
  ]);

  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT?.split(';').filter(Boolean) ?? ['.EXE', '.CMD', '.BAT', '.COM'])
    : [''];
  const candidates = path.extname(command) ? [command] : [command, ...extensions.map((ext) => `${command}${ext}`)];

  for (const searchPath of searchPaths) {
    for (const candidate of candidates) {
      const fullPath = path.isAbsolute(candidate) ? candidate : path.join(searchPath, candidate);
      try {
        fs.accessSync(fullPath, fs.constants.X_OK);
        return true;
      } catch {
        // continue searching
      }
    }
  }

  return false;
}

function getAvailableHarnessOptions() {
  return Object.fromEntries(
    Object.entries(HARNESS_OPTIONS).filter(([, config]) => isCommandAvailable(config.command))
  );
}

const store = new Store<StoreSchema>({
  defaults: {
    lastWorkspace: app.getPath('home'),
  },
});

const terminals: Map<string, Terminal> = new Map();
let mainWindow: BrowserWindow | null = null;
let browserView: WebContentsView | null = null;
let currentBrowserUrl = 'https://github.com';

// ============================================================================
// Git Service - Handles all git operations in the main process
// This service manages polling and can be extended for GitHub API integration
// ============================================================================

interface GitStatusEntry {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';
  staged: boolean;
}

interface GitStatusResult {
  success: boolean;
  isRepo: boolean;
  changes: GitStatusEntry[];
  error?: string;
}

class GitService {
  private pollingInterval: NodeJS.Timeout | null = null;
  private currentWorkspacePath: string | null = null;
  private pollIntervalMs = 30000; // 30 seconds

  /**
   * Parse git status --porcelain output into structured data
   */
  private parseGitStatus(statusOutput: string): GitStatusEntry[] {
    const changes: GitStatusEntry[] = [];
    const lines = statusOutput.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      const indexStatus = line[0];
      const workTreeStatus = line[1];
      const filePath = line.slice(3).trim();

      // Determine if staged (has changes in index)
      const staged = indexStatus !== ' ' && indexStatus !== '?';

      // Determine status type
      let status: GitStatusEntry['status'] = 'modified';
      const statusChar = staged ? indexStatus : workTreeStatus;

      switch (statusChar) {
        case 'M':
          status = 'modified';
          break;
        case 'A':
          status = 'added';
          break;
        case 'D':
          status = 'deleted';
          break;
        case 'R':
          status = 'renamed';
          break;
        case '?':
          status = 'untracked';
          break;
        default:
          status = 'modified';
      }

      changes.push({ path: filePath, status, staged });
    }

    return changes;
  }

  /**
   * Get git status for a workspace
   */
  async getStatus(workspacePath: string): Promise<GitStatusResult> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      // Check if it's a git repository
      await execAsync('git rev-parse --git-dir', { cwd: workspacePath });

      // Get porcelain status
      const { stdout } = await execAsync('git status --porcelain', { cwd: workspacePath });
      const changes = this.parseGitStatus(stdout);

      return { success: true, isRepo: true, changes };
    } catch {
      // Not a git repository or git not available
      return { success: false, isRepo: false, changes: [] };
    }
  }

  /**
   * Stage files in the workspace
   */
  async stage(workspacePath: string, files?: string[]): Promise<{ success: boolean; error?: string }> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      if (files && files.length > 0) {
        await execAsync(`git add ${files.map(f => `"${f}"`).join(' ')}`, { cwd: workspacePath });
      } else {
        await execAsync('git add -A', { cwd: workspacePath });
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to stage files' };
    }
  }

  /**
   * Create a commit in the workspace
   */
  async commit(workspacePath: string, message: string): Promise<{ success: boolean; error?: string }> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    if (!message || message.trim().length === 0) {
      return { success: false, error: "Commit message cannot be empty" };
    }

    // Sanitize message to prevent injection
    const sanitizedMessage = message.trim().replace(/"/g, '\\"');

    try {
      await execAsync(`git commit -m "${sanitizedMessage}"`, { cwd: workspacePath });
      return { success: true };
    } catch (error: any) {
      const errorMsg = error.stderr || error.message || '';
      if (errorMsg.includes('nothing to commit')) {
        return { success: false, error: 'Nothing to commit' };
      }
      return { success: false, error: errorMsg || 'Failed to create commit' };
    }
  }

  /**
   * Check if workspace is a git repository
   */
  async isRepo(workspacePath: string): Promise<boolean> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      await execAsync('git rev-parse --git-dir', { cwd: workspacePath });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start polling git status for a workspace
   * Emits 'git-status-update' events to the renderer
   */
  startPolling(workspacePath: string): void {
    // Stop any existing polling
    this.stopPolling();

    this.currentWorkspacePath = workspacePath;

    // Emit initial status immediately
    this.emitStatusUpdate(workspacePath);

    // Then poll at interval
    this.pollingInterval = setInterval(async () => {
      if (this.currentWorkspacePath) {
        await this.emitStatusUpdate(this.currentWorkspacePath);
      }
    }, this.pollIntervalMs);
  }

  /**
   * Stop polling git status
   */
  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.currentWorkspacePath = null;
  }

  /**
   * Force an immediate status refresh
   */
  async refresh(): Promise<GitStatusResult | null> {
    if (!this.currentWorkspacePath) {
      return null;
    }
    return this.getStatus(this.currentWorkspacePath);
  }

  /**
   * Get current workspace path
   */
  getCurrentWorkspace(): string | null {
    return this.currentWorkspacePath;
  }

  /**
   * Emit status update to renderer
   */
  private async emitStatusUpdate(workspacePath: string): Promise<void> {
    if (!mainWindow) return;

    const result = await this.getStatus(workspacePath);
    mainWindow.webContents.send('git-status-update', result);
  }
}

// Singleton instance
const gitService = new GitService();

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
      partition: 'persist:browser',
    },
  });

  browserView.webContents.loadURL(currentBrowserUrl);
  mainWindow.contentView.addChildView(browserView);
  attachBrowserShortcutHandlers(browserView);
  
  // Initially hide it
  browserView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
}

// Show/hide and position browser view
function updateBrowserView(x: number, y: number, width: number, height: number, visible: boolean) {
  if (!mainWindow) return;

  if (!browserView) {
    initBrowserView();
  }

  if (browserView) {
    if (visible && width > 0 && height > 0) {
      browserView.setBounds({ x, y, width, height });
    } else {
      browserView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  }
}

// IPC Handlers
ipcMain.handle('get-last-workspace', () => {
  return store.get('lastWorkspace');
});

ipcMain.handle('set-last-workspace', (_, workspacePath: string) => {
  store.set('lastWorkspace', workspacePath);
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
  const fs = await import('fs');
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
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

ipcMain.handle('spawn-terminal', (_, workingDir: string, harness?: string) => {
  const id = `term-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Use user's default shell, fallback to bash
  const userShell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : 'bash');
  
  // Spawn with interactive flags for better shell experience
  // -i: interactive mode (enables completion, aliases, etc.)
  // --login: load profile files (~/.bash_profile, ~/.zprofile)
  const shellArgs = ['-i'];
  
  const harnessEnv = harness && HARNESS_OPTIONS[harness]?.env ? HARNESS_OPTIONS[harness].env : {};

  const ptyProcess = pty.spawn(userShell, shellArgs, {
    name: 'xterm-256color',
    cwd: workingDir || store.get('lastWorkspace'),
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
    },
  });

  const terminal: Terminal = { id, pid: ptyProcess.pid, pty: ptyProcess, buffer: '' };
  terminals.set(id, terminal);

  // If a harness is specified, write the command after a short delay
  if (harness && HARNESS_OPTIONS[harness]) {
    const config = HARNESS_OPTIONS[harness];
    setTimeout(() => {
      const cmd = `${config.command} ${config.args.join(' ')}\r\n`;
      ptyProcess.write(cmd);
    }, 500);
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

// Browser IPC Handlers
ipcMain.handle('browser-show', (_, x: number, y: number, width: number, height: number) => {
  updateBrowserView(x, y, width, height, true);
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
  currentBrowserUrl = url;
  if (browserView) {
    browserView.webContents.loadURL(url);
  }
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
  shell.openExternal(url);
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

ipcMain.handle('get-browser-url', () => {
  return currentBrowserUrl;
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
  gitService.startPolling(workspacePath);
});

ipcMain.handle('git-stop-polling', () => {
  gitService.stopPolling();
});

ipcMain.handle('git-get-status', async (_, workspacePath: string) => {
  return gitService.getStatus(workspacePath);
});

ipcMain.handle('git-stage', async (_, workspacePath: string, files?: string[]) => {
  const result = await gitService.stage(workspacePath, files);
  // Refresh status after staging
  const status = await gitService.refresh();
  if (mainWindow && status) {
    mainWindow.webContents.send('git-status-update', status);
  }
  return result;
});

ipcMain.handle('git-commit', async (_, workspacePath: string, message: string) => {
  const result = await gitService.commit(workspacePath, message);
  // Refresh status after commit
  const status = await gitService.refresh();
  if (mainWindow && status) {
    mainWindow.webContents.send('git-status-update', status);
  }
  return result;
});

ipcMain.handle('git-is-repo', async (_, workspacePath: string) => {
  return gitService.isRepo(workspacePath);
});

ipcMain.handle('git-refresh', async () => {
  return gitService.refresh();
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
