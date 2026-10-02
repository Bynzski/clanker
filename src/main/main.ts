/**
 * Clanker Grid - Main Process Entry Point
 *
 * Thin orchestrator: imports → store init → register IPC calls → create window → lifecycle
 */

import { app, BrowserWindow, shell, type Rectangle } from 'electron';

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
import { EnvironmentManager } from './environment/environmentManager';
import { WorkspaceRegistry } from './workspaceRegistry';
import { registerSshEnvironmentIpc } from './ipc/sshEnvironmentIpc';
import { resolveExistingDirectory } from './security';
import { type StoreSchema } from '../shared/types/store';
import { DEFAULT_THEME_ID } from '../shared/types/theme';
import { KNOWN_HARNESS_IDS } from '../shared/harnessIds';
import { HARNESS_OPTIONS, getAvailableHarnessOptions, discoverHarnessModels } from './harnessCatalog';
import { createMainWindow, getPreloadPath, isWindowAvailable, resolveInitialWindowBackground } from './windowManager';
import { registerSettingsIpc } from './ipc/settingsIpc';
import { registerWindowIpc } from './ipc/windowIpc';
import { registerAiCommitIpc } from './ipc/aiCommitIpc';
import { registerTerminalIpc, setAppShuttingDown, getAppShuttingDown, type Terminal } from './ipc/terminalIpc';
import { registerBrowserIpc, type BrowserIpcController, type BrowserViewsByWorkspace } from './ipc/browserIpc';
import { registerGitIpc } from './ipc/gitIpc';
import { registerCredentialIpc } from './ipc/credentialIpc';
import { registerFileIpc } from './ipc/fileIpc';
import { FileWatcherService } from './fileWatcher';
import { ExplorerWatcherService } from './explorerWatcher';
import { registerRemotePreviewIpc } from './ipc/remotePreviewIpc';
import { RemotePreviewManager } from './remote/remotePreviewManager';
import { REMOTE_PREVIEW_CHANGED } from '../shared/ipcChannels';
import { RemoteFileWatcher } from './remote/remoteFileWatcher';
import { REMOTE_FILES_CHANGED } from '../shared/ipcChannels';
import { registerVcsIpc } from './ipc/vcsIpc';
import { registerAnnotationIpc } from './annotation/annotationIpc';
import { registerSessionIpc } from './ipc/sessionIpc';
import { registerRecipeIpc } from './ipc/recipeIpc';
import { registerTaskSessionIpc } from './ipc/taskSessionIpc';
import { TaskSessionCoordinator } from './taskSessionCoordinator';
import { AgentAttentionBroker } from './agentAttentionBroker';
import { AGENT_ATTENTION_UPDATE, GIT_STATUS_UPDATE } from '../shared/ipcChannels';
import { removeAttentionAdapterFiles } from './agentAttentionAdapters';
import { waitForTerminalCleanup } from './ipc/ptySpawn';



const store = new Store<StoreSchema>({
  defaults: {
    theme: DEFAULT_THEME_ID,
    lastWorkspace: app.getPath('home'),
    baseDirectory: app.getPath('home'),
    aiCommitEnabled: false,
    aiCommitProvider: 'codex',
    aiCommitModel: '',
    harnessDefaults: Object.fromEntries(
      KNOWN_HARNESS_IDS.map(id => [id, { model: '', favorites: [], flags: '', visible: true }])
    ),
    workspaceRecipes: [],
    taskSessions: [],
    sshEnvironments: [],
    remoteWorktreeRemovals: [],
  },
});

// Shared state for IPC modules (exported for test access)
const terminals: Map<string, Terminal> = new Map();
const browserViews: BrowserViewsByWorkspace = new Map();
const activeBrowserTabIdsByWorkspace: Map<string, string> = new Map();
const lastBrowserBoundsByWorkspace: Map<string, Rectangle> = new Map();
let activeBrowserWorkspaceId: string | null = null;
let taskSessionCoordinator: TaskSessionCoordinator | null = null;
let mainWindow: BrowserWindow | null = null;
const agentAttentionBroker = new AgentAttentionBroker((update) => {
  if (isWindowAvailable(mainWindow)) {
    mainWindow.webContents.send(AGENT_ATTENTION_UPDATE, update);
  }
});
let annotationModeEnabled = false;
let annotationController: ReturnType<typeof import('./annotation/annotationIpc').registerAnnotationIpc> | null = null;
let browserIpcController: BrowserIpcController | null = null;

const GRACEFUL_TERMINATION_TIMEOUT_MS = 1000;

const killAllTerminals = () => {
  // Phase 1: Send SIGTERM to all terminals for graceful shutdown
  const terminalPids: Map<string, number> = new Map();
  for (const [id, terminal] of terminals.entries()) {
    agentAttentionBroker.release(id);
    void terminal.releaseResources?.();
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

const cleanupWorkspaceResources = () => {
  void remotePreviewManager.closeWorkspaces();
  remoteFileWatcher.close();
  void annotationController?.dispose();
  browserIpcController?.disposeAll();
  activeBrowserTabIdsByWorkspace.clear();
  lastBrowserBoundsByWorkspace.clear();
  annotationModeEnabled = false;
  killAllTerminals();
  gitService.clearOpenWorkspaces();
  workspaceRegistry.clear();
  activeBrowserWorkspaceId = null;
};

const cleanupWindowState = () => {
  cleanupWorkspaceResources();
  mainWindow = null;
};

const environmentManager = new EnvironmentManager(() => store);
const workspaceRegistry: WorkspaceRegistry = new WorkspaceRegistry(
  (id) => environmentManager.getEnvironment(id),
  { isWorktreeBeingRemoved: (p: string): boolean => gitService.isWorktreeBeingRemoved(p) }
);

const remotePreviewManager = new RemotePreviewManager(workspaceRegistry, (update) => {
  if (isWindowAvailable(mainWindow)) mainWindow.webContents.send(REMOTE_PREVIEW_CHANGED, update);
});

const gitService: GitService = new GitService(
  (status) => {
    if (isWindowAvailable(mainWindow)) {
      mainWindow.webContents.send(GIT_STATUS_UPDATE, status);
    }
  },
  (worktreePath) => shell.trashItem(worktreePath),
  () => [...terminals.values()]
    .map((terminal) => terminal.cwd)
    .filter((cwd): cwd is string => typeof cwd === 'string'),
  () => workspaceRegistry.getLocalOpenWorkspacePaths(),
  async (workspacePath, args, timeoutMs, workspaceId, environmentId) => {
    if (workspaceId !== undefined) {
      const ws = workspaceRegistry.getWorkspace(workspaceId);
      if (!ws || ws.location.path !== workspacePath || ws.location.environmentId !== environmentId) {
        throw new Error('Workspace identity is no longer registered');
      }
      return ws.environment.execGit(ws.location.path, args, timeoutMs);
    }
    // A path alone cannot distinguish an SSH workspace from a local checkout.
    // Legacy callers without an identity always run against the local filesystem.
    const local = await environmentManager.getEnvironment('local');
    if (!local) throw new Error('Local environment is unavailable');
    return local.execGit(workspacePath, args, timeoutMs);
  }
);

const fileWatcher = new FileWatcherService({ getMainWindow: () => mainWindow });
fileWatcher.setGitService(gitService);

/** Workspace tree watcher for explorer auto-refresh. Separate from FileWatcherService. */
const explorerWatcher = new ExplorerWatcherService({
  getMainWindow: () => mainWindow,
  getCurrentWorkspace: () => gitService.getCurrentWorkspace(),
});
explorerWatcher.setGitService(gitService);

const remoteFileWatcher = new RemoteFileWatcher({
  getWorkspaceRegistry: () => workspaceRegistry,
  onChanged: (event) => {
    if (isWindowAvailable(mainWindow)) mainWindow.webContents.send(REMOTE_FILES_CHANGED, event);
  },
});

function getSafeWorkspacePath(workingDir: string, storeInstance: Store<StoreSchema>): string {
  return (
    resolveExistingDirectory(workingDir, storeInstance.get('lastWorkspace'))
    ?? app.getPath('home')
  );
}

/**
 * Pre-warm the model cache by discovering models for all available harnesses.
 * Runs silently in background to populate cache before renderer requests it.
 */
function prewarmModelCache(): void {
  const harnesses = Object.keys(getAvailableHarnessOptions());
  for (const harness of harnesses) {
    discoverHarnessModels(harness).catch(() => {
      // Ignore errors — fallback models are always available
    });
  }
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
  });

  registerAiCommitIpc({
    getStore: () => store,
    getGitService: () => gitService,
    getWorkspaceRegistry: () => workspaceRegistry,
  });

  registerRecipeIpc({
    getStore: () => store,
    getSafeWorkspacePath: (workingDir: string) => getSafeWorkspacePath(workingDir, store),
  });

  const taskSessionPersistence = registerTaskSessionIpc({
    getStore: () => store,
    getTerminals: () => terminals,
    getHarnessOptions: getAvailableHarnessOptions,
    getWorkspaceRegistry: () => workspaceRegistry,
  });
  taskSessionCoordinator = new TaskSessionCoordinator(taskSessionPersistence);

  registerTerminalIpc({
    getTerminals: () => terminals,
    getMainWindow: () => mainWindow,
    getStore: () => store,
    getSafeWorkspacePath: (workingDir: string) => getSafeWorkspacePath(workingDir, store),
    getOpenWorkspacePath: (workspaceId: string) => gitService.getOpenWorkspacePath(workspaceId),
    getWorkspaceRegistry: () => workspaceRegistry,
    getHarnessOptions: () => HARNESS_OPTIONS,
    agentAttentionBroker,
    taskSessionCoordinator,
  });

  registerRemotePreviewIpc(remotePreviewManager);
  browserIpcController = registerBrowserIpc({
    getMainWindow: () => mainWindow,
    getBrowserViews: () => browserViews,
    getActiveBrowserWorkspaceId: () => activeBrowserWorkspaceId,
    setActiveBrowserWorkspaceId: (id) => { activeBrowserWorkspaceId = id; },
    onActiveBrowserTabChanged: (workspaceId, tabId) => {
      if (tabId) {
        activeBrowserTabIdsByWorkspace.set(workspaceId, tabId);
      } else {
        activeBrowserTabIdsByWorkspace.delete(workspaceId);
      }

      if (annotationModeEnabled && annotationController?.getState().workspaceId === workspaceId) {
        void annotationController.disable().finally(() => {
          annotationModeEnabled = false;
        });
      }
    },
  });
  registerGitIpc({
    remoteWorktreeRemovalPersistence: {
      read: () => store.get('remoteWorktreeRemovals') ?? [],
      write: (records) => store.set('remoteWorktreeRemovals', records),
    },
    getGitService: () => gitService,
    getMainWindow: () => mainWindow,
    getWorkspaceRegistry: () => workspaceRegistry,
    onWorkspaceUnregistered: (id) => { remoteFileWatcher.closeWorkspace(id); void remotePreviewManager.closeWorkspace(id); },
    getLiveRemoteTerminalPaths: (environmentId) => {
      const paths: string[] = [];
      const configurations = store.get('sshEnvironments') ?? [];
      if (!configurations.some((entry) => entry.id === environmentId)) return null;
      const resourceId = workspaceRegistry.getWorktreeResourceId(environmentId);
      for (const terminal of terminals.values()) {
        if (!terminal.environmentId || terminal.environmentId === 'local') continue;
        if (!configurations.some((entry) => entry.id === terminal.environmentId)) return null;
        if (workspaceRegistry.getWorktreeResourceId(terminal.environmentId) !== resourceId) continue;
        // The SSH client's local cwd is unrelated to its remote checkout.
        if (!terminal.remoteWorkingDir) return null;
        paths.push(terminal.remoteWorkingDir);
      }
      return paths;
    },
  });

  registerCredentialIpc();
  registerSshEnvironmentIpc({
    getStore: () => store,
    getEnvironmentManager: () => environmentManager,
    getWorkspaceRegistry: () => workspaceRegistry,
  });
  registerFileIpc({
    getFileWatcher: () => fileWatcher,
    getExplorerWatcher: () => explorerWatcher,
    getWorkspaceRegistry: () => workspaceRegistry,
    getRemoteFileWatcher: () => remoteFileWatcher,
  });

  registerVcsIpc({
    getGitService: () => gitService,
    getWorkspaceRegistry: () => workspaceRegistry,
  });

  registerSessionIpc({
    getTerminals: () => terminals,
    getMainWindow: () => mainWindow,
    getSafeWorkspacePath: (workingDir: string) => getSafeWorkspacePath(workingDir, store),
    getIsShuttingDown: getAppShuttingDown,
    getStore: () => store,
    getHarnessOptions: getAvailableHarnessOptions,
    getWorkspaceRegistry: () => workspaceRegistry,
    agentAttentionBroker,
    taskSessionCoordinator,
  });

  // Register annotation IPC handlers
  annotationController = registerAnnotationIpc({
    getBrowserViews: () => browserViews,
    getActiveBrowserWorkspaceId: () => activeBrowserWorkspaceId,
    getMainWindow: () => mainWindow,
    getActiveBrowserTabId: (workspaceId) => activeBrowserTabIdsByWorkspace.get(workspaceId) ?? null,
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
    backgroundColor: resolveInitialWindowBackground(store),
    onWindowClosed: cleanupWindowState,
    onRendererGone: cleanupWorkspaceResources,
  }));

  // Pre-warm model cache in background after startup
  // Schedules after a short delay so it doesn't block window rendering
  setTimeout(prewarmModelCache, 100);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      ({ window: mainWindow } = createMainWindow({
        preloadPath,
        gitService,
        fileWatcher,
        explorerWatcher,
        backgroundColor: resolveInitialWindowBackground(store),
        onWindowClosed: cleanupWindowState,
        onRendererGone: cleanupWorkspaceResources,
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
let quitCleanup: Promise<void> | undefined;
let quitCleanupComplete = false;
app.on('before-quit', (event) => {
  if (quitCleanupComplete) return;
  event.preventDefault();
  if (quitCleanup) return;
  const previewsClosed = remotePreviewManager.close();
  remoteFileWatcher.close();
  setAppShuttingDown(true);
  workspaceRegistry.clear();
  taskSessionCoordinator?.onAppShutdown();
  killAllTerminals();
  agentAttentionBroker.close();
  removeAttentionAdapterFiles();
  // Keep the event loop alive for SSH SIGKILL escalation and host launch-file
  // cleanup. A repeated quit request shares this drain instead of bypassing it.
  quitCleanup = Promise.all([previewsClosed, waitForTerminalCleanup()]).then(() => undefined);
  void quitCleanup.catch((error: unknown) => console.warn('[clanker-grid] shutdown cleanup failed:', error)).finally(() => {
    quitCleanupComplete = true;
    app.quit();
  });
});

// Export shared state for test access
export { resolveInitialWindowBackground };

export { terminals, browserViews, activeBrowserWorkspaceId, activeBrowserTabIdsByWorkspace, lastBrowserBoundsByWorkspace, gitService, explorerWatcher, store, workspaceRegistry, environmentManager, killAllTerminals, GRACEFUL_TERMINATION_TIMEOUT_MS, annotationModeEnabled, annotationController };
