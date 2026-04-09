/**
 * Clanker Grid - Main Process Entry Point
 *
 * Thin orchestrator: imports → store init → register IPC calls → create window → lifecycle
 */

import { app, BrowserWindow, WebContentsView } from 'electron';

// Disable GPU acceleration for compatibility in some environments
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

import Store from 'electron-store';

import { GitService } from './gitService';
import { resolveExistingDirectory } from './security';
import { type AiCommitProvider } from './aiCommit';
import { HARNESS_OPTIONS } from './harnessCatalog';
import { createMainWindow, getPreloadPath } from './windowManager';
import { registerSettingsIpc } from './ipc/settingsIpc';
import { registerTerminalIpc, setAppShuttingDown, type Terminal } from './ipc/terminalIpc';
import { registerBrowserIpc } from './ipc/browserIpc';
import { registerGitIpc } from './ipc/gitIpc';
import { registerCredentialIpc } from './ipc/credentialIpc';
import { registerFileIpc } from './ipc/fileIpc';
import { registerVcsIpc } from './ipc/vcsIpc';

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

// Shared state for IPC modules (exported for test access)
interface BrowserViewEntry {
  view: WebContentsView;
  url: string;
}

const terminals: Map<string, Terminal> = new Map();
const browserViews: Map<string, BrowserViewEntry> = new Map();
let activeBrowserWorkspaceId: string | null = null;
let mainWindow: BrowserWindow | null = null;

const killAllTerminals = () => {
  for (const terminal of terminals.values()) {
    try {
      terminal.pty.kill();
    } catch (error) {
      console.error('[clanker-grid] failed to kill terminal on cleanup', error);
    }
  }
  terminals.clear();
};

const cleanupWindowState = () => {
  killAllTerminals();
  activeBrowserWorkspaceId = null;
  mainWindow = null;
};

const gitService = new GitService((status) => {
  if (mainWindow) {
    mainWindow.webContents.send('git-status-update', status);
  }
});

function getSafeWorkspacePath(workingDir: string, storeInstance: Store<StoreSchema>): string {
  return (
    resolveExistingDirectory(workingDir, storeInstance.get('lastWorkspace'))
    ?? app.getPath('home')
  );
}

// App lifecycle
app.whenReady().then(() => {
  const preloadPath = getPreloadPath();

  // Register IPC handlers
  registerSettingsIpc({
    getStore: () => store,
    getMainWindow: () => mainWindow,
    getGitService: () => gitService,
  });

  registerTerminalIpc({
    getTerminals: () => terminals,
    getMainWindow: () => mainWindow,
    getStore: () => store,
    getSafeWorkspacePath: (workingDir: string) => getSafeWorkspacePath(workingDir, store),
    getHarnessOptions: () => HARNESS_OPTIONS,
  });

  registerBrowserIpc({
    getMainWindow: () => mainWindow,
    getBrowserViews: () => browserViews,
    getActiveBrowserWorkspaceId: () => activeBrowserWorkspaceId,
    setActiveBrowserWorkspaceId: (id) => { activeBrowserWorkspaceId = id; },
  });

  registerGitIpc({
    getGitService: () => gitService,
    getMainWindow: () => mainWindow,
  });

  registerCredentialIpc();
  registerFileIpc();

  registerVcsIpc({
    getGitService: () => gitService,
  });

  // Create window
  ({ window: mainWindow } = createMainWindow({
    preloadPath,
    gitService,
    browserViews,
    onWindowClosed: cleanupWindowState,
  }));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      ({ window: mainWindow } = createMainWindow({
        preloadPath,
        gitService,
        browserViews,
        onWindowClosed: cleanupWindowState,
      }));
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Set shutdown flag BEFORE any window teardown begins
// This prevents late PTY callbacks from sending to dead windows
app.on('before-quit', () => {
  setAppShuttingDown(true);
});

// Export shared state for test access
export { terminals, browserViews, activeBrowserWorkspaceId, gitService, store };
