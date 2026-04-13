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

// Global exception handlers for main process
process.on('uncaughtException', (error) => {
  console.error('[clanker-grid] Uncaught exception:', error);
  // Trigger graceful shutdown: PTY cleanup + window close
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
  killAllTerminals();
  // Exit with error code to indicate abnormal termination
  app.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[clanker-grid] Unhandled promise rejection:', reason);
  // Log only, do not crash — keep app running for now
  if (reason instanceof Error) {
    console.error(reason.stack);
  }
});

import Store from 'electron-store';

import { GitService } from './gitService';
import { resolveExistingDirectory } from './security';
import { type AiCommitProvider } from './aiCommit';
import { HARNESS_OPTIONS } from './harnessCatalog';
import { createMainWindow, getPreloadPath } from './windowManager';
import { registerSettingsIpc } from './ipc/settingsIpc';
import { registerWindowIpc } from './ipc/windowIpc';
import { registerAiCommitIpc } from './ipc/aiCommitIpc';
import { registerTerminalIpc, setAppShuttingDown, type Terminal } from './ipc/terminalIpc';
import { registerBrowserIpc } from './ipc/browserIpc';
import { registerGitIpc } from './ipc/gitIpc';
import { registerCredentialIpc } from './ipc/credentialIpc';
import { registerFileIpc } from './ipc/fileIpc';
import { FileWatcherService } from './fileWatcher';
import { ExplorerWatcherService } from './explorerWatcher';
import { registerVcsIpc } from './ipc/vcsIpc';
import { registerAnnotationIpc } from './annotation/annotationIpc';

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
let annotationModeEnabled = false;
let annotationController: ReturnType<typeof import('./annotation/annotationIpc').registerAnnotationIpc> | null = null;

const GRACEFUL_TERMINATION_TIMEOUT_MS = 1000;

const killAllTerminals = () => {
  // Phase 1: Send SIGTERM to all terminals for graceful shutdown
  const terminalPids: Map<string, number> = new Map();
  for (const [id, terminal] of terminals.entries()) {
    try {
      terminalPids.set(id, terminal.pty.pid);
      terminal.pty.kill('SIGTERM');
    } catch (error) {
      console.error('[clanker-grid] failed to send SIGTERM to terminal', id, error);
      // Remove terminal that already exited
      terminals.delete(id);
    }
  }

  // Phase 2: Wait for graceful termination, then send SIGKILL if still running
  if (terminalPids.size > 0) {
    const checkRemaining = () => {
      for (const [id, pid] of terminalPids.entries()) {
        if (!terminals.has(id)) continue; // Already cleaned up by onExit
        try {
          // Check if process is still running by trying to kill with signal 0
          // (signal 0 doesn't kill but checks if process exists)
          process.kill(pid, 0);
          // Process still running - send SIGKILL
          const terminal = terminals.get(id);
          if (terminal) {
            terminal.pty.kill('SIGKILL');
          }
        } catch {
          // Process already terminated (ESRCH) - that's fine
        }
      }
      terminals.clear();
    };

    // Use synchronous busy-wait for shutdown (no async during quit)
    const startTime = Date.now();
    const waitAndKill = () => {
      while (Date.now() - startTime < GRACEFUL_TERMINATION_TIMEOUT_MS) {
        // Brief sleep to allow signal processing
        const sleep = (ms: number) => {
          const end = Date.now() + ms;
          while (Date.now() < end) { /* busy wait */ }
        };
        sleep(50);
      }
      checkRemaining();
    };
    waitAndKill();
  }
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

const fileWatcher = new FileWatcherService({ getMainWindow: () => mainWindow });
fileWatcher.setGitService(gitService);

/** Workspace tree watcher for explorer auto-refresh. Separate from FileWatcherService. */
const explorerWatcher = new ExplorerWatcherService({
  getMainWindow: () => mainWindow,
  getCurrentWorkspace: () => gitService.getCurrentWorkspace(),
});
explorerWatcher.setGitService(gitService);

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
  });

  registerWindowIpc({
    getMainWindow: () => mainWindow,
    getBrowserViews: () => browserViews,
  });

  registerAiCommitIpc({
    getStore: () => store,
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
  registerFileIpc({ getFileWatcher: () => fileWatcher, getExplorerWatcher: () => explorerWatcher });

  registerVcsIpc({
    getGitService: () => gitService,
  });

  // Register annotation IPC handlers
  annotationController = registerAnnotationIpc({
    getBrowserViews: () => browserViews,
    getActiveBrowserWorkspaceId: () => activeBrowserWorkspaceId,
    getMainWindow: () => mainWindow,
    onAnnotationModeChange: (enabled) => {
      annotationModeEnabled = enabled;
    },
  });

  // Create window
  ({ window: mainWindow } = createMainWindow({
    preloadPath,
    gitService,
    fileWatcher,
    explorerWatcher,
    onWindowClosed: cleanupWindowState,
  }));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      ({ window: mainWindow } = createMainWindow({
        preloadPath,
        gitService,
        fileWatcher,
        explorerWatcher,
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
  // Kill all PTY processes synchronously before quit
  // Uses SIGTERM → SIGKILL sequence for unresponsive processes
  killAllTerminals();
  setAppShuttingDown(true);
});

// Export shared state for test access
export { terminals, activeBrowserWorkspaceId, gitService, explorerWatcher, store, killAllTerminals, GRACEFUL_TERMINATION_TIMEOUT_MS, annotationModeEnabled, annotationController };
