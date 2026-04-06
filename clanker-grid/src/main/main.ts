import { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell } from 'electron';

// Disable GPU acceleration for compatibility in some environments
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('disable-setuid-sandbox');

import * as path from 'path';
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
}

export const HARNESS_OPTIONS: Record<string, HarnessConfig> = {
  'codex': {
    name: 'Codex',
    command: 'codex',
    args: [],
    icon: '🧠',
  },
  'opencode': {
    name: 'OpenCode',
    command: 'npx',
    args: ['-y', 'opencode'],
    icon: '⚡',
  },
  'pi': {
    name: 'Pi',
    command: 'npx',
    args: ['-y', '@mariozechner/pi-coding-agent'],
    icon: 'π',
  },
};

const store = new Store<StoreSchema>({
  defaults: {
    lastWorkspace: app.getPath('home'),
  },
});

const terminals: Map<string, Terminal> = new Map();
let mainWindow: BrowserWindow | null = null;
let browserView: WebContentsView | null = null;
let currentBrowserUrl = 'https://example.com';

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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

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
  });
}

// Initialize browser view (hidden by default)
function initBrowserView() {
  if (browserView || !mainWindow) return;

  browserView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      partition: 'browser',
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
  
  const ptyProcess = pty.spawn(userShell, shellArgs, {
    name: 'xterm-256color',
    cwd: workingDir || store.get('lastWorkspace'),
    env: {
      ...process.env as { [key: string]: string },
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
  if (browserView && browserView.webContents.canGoBack()) {
    browserView.webContents.goBack();
  }
});

ipcMain.handle('browser-forward', () => {
  if (browserView && browserView.webContents.canGoForward()) {
    browserView.webContents.goForward();
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

ipcMain.handle('get-harness-options', () => {
  return HARNESS_OPTIONS;
});

ipcMain.handle('get-browser-url', () => {
  return currentBrowserUrl;
});

ipcMain.handle('can-go-back', () => {
  return browserView?.webContents.canGoBack() ?? false;
});

ipcMain.handle('can-go-forward', () => {
  return browserView?.webContents.canGoForward() ?? false;
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
