import { createTerminalPreviewSignal } from './remote/terminalPreviewSignal';
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
import { createMainWindow, getPreloadPath, isWindowAvailable, resolveInitialTheme, resolveInitialWindowBackground } from './windowManager';
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
import { registerUsageIpc } from './ipc/usageIpc';
import { registerAccountIpc } from './ipc/accountIpc';
import { HarnessAccountService } from './accounts/harnessAccountService';
import { AccountHomeStore } from './accounts/accountHomes';
import { createElectronAccountStorage } from './accounts/electronAccountStorage';
import { LocalEnvironment } from './environment/localEnvironment';
import { clearSessionCache } from './sessionHistory';
import { HARNESS_ACCOUNTS_AUTH_STATE } from '../shared/ipcChannels';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { HarnessUsageService } from './usage/harnessUsageService';
import { registerRecipeIpc } from './ipc/recipeIpc';
import { KeybindingOverridesService } from './keybindingOverrides';
import { purgeLegacyTaskSessions, seedWorkspaceNavigationMode } from './storeMigrations';
import { existsSync } from 'node:fs';
import { AgentAttentionBroker } from './agentAttentionBroker';
import { AGENT_ATTENTION_UPDATE, GIT_STATUS_UPDATE } from '../shared/ipcChannels';
import { removeAttentionAdapterFiles } from './agentAttentionAdapters';
import { waitForTerminalCleanup } from './ipc/ptySpawn';
import { HermesAssistantService } from './assistants/hermesAssistantService';
import { registerAssistantIpc } from './ipc/assistantIpc';
import { ASSISTANTS_CHANGED, ASSISTANTS_PTY_DATA } from '../shared/ipcChannels';
import { assistantBrowserOwners, resolveBrowserOwnerKind } from './browserOwner';



// Must be read before the store is constructed: construction writes the defaults to disk.
const storeFileExistedBeforeOpen = existsSync(nodePath.join(app.getPath('userData'), 'config.json'));

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
    sshEnvironments: [],
    remoteWorktreeRemovals: [],
    assistantSettings: { enabled: false, autoStart: false },
  },
});

// Workspace Tasks (#43) were removed. Drop any records persisted by older
// builds instead of leaving an ever-growing dead store on disk.
purgeLegacyTaskSessions(store);
seedWorkspaceNavigationMode(store, storeFileExistedBeforeOpen);

const keybindingOverrides = new KeybindingOverridesService(() => store);

// Shared state for IPC modules (exported for test access)
const terminals: Map<string, Terminal> = new Map();
const browserViews: BrowserViewsByWorkspace = new Map();
const activeBrowserTabIdsByWorkspace: Map<string, string> = new Map();
const lastBrowserBoundsByWorkspace: Map<string, Rectangle> = new Map();
let activeBrowserWorkspaceId: string | null = null;
let mainWindow: BrowserWindow | null = null;
const agentAttentionBroker = new AgentAttentionBroker((update) => {
  if (isWindowAvailable(mainWindow)) {
    mainWindow.webContents.send(AGENT_ATTENTION_UPDATE, update);
  }
});
let annotationModeEnabled = false;
let annotationController: ReturnType<typeof import('./annotation/annotationIpc').registerAnnotationIpc> | null = null;
let browserIpcController: BrowserIpcController | null = null;
let assistantService: HermesAssistantService | undefined;

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
  assistantService?.reset();
  // Pending sign-ins must not outlive the window that started them.
  void harnessAccountService.cancelAllAuth();
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
const accountLocalEnvironment = new LocalEnvironment();
const workspaceRegistry: WorkspaceRegistry = new WorkspaceRegistry(
  (id) => environmentManager.getEnvironment(id),
  { isWorktreeBeingRemoved: (p: string): boolean => gitService.isWorktreeBeingRemoved(p) }
);

// Account metadata lives in its own store (never the renderer-writable settings map); managed
// homes live under the app's own data directory, apart from every provider-native home.
const harnessAccountService = new HarnessAccountService({
  storage: createElectronAccountStorage(),
  homes: new AccountHomeStore(nodePath.join(app.getPath('userData'), 'harness-accounts'), {
    protectedPaths: [nodePath.join(nodeOs.homedir(), '.codex'), nodePath.join(nodeOs.homedir(), '.claude')],
  }),
  getLocalEnvironment: () => accountLocalEnvironment,
  openExternal: (url) => { void shell.openExternal(url); },
  onAuthState: (event) => {
    if (isWindowAvailable(mainWindow)) mainWindow.webContents.send(HARNESS_ACCOUNTS_AUTH_STATE, event);
  },
  clientVersion: () => app.getVersion(),
});
// Cached discovery results carry account provenance, so any change to the account set drops them.
harnessAccountService.onAccountsChanged(() => clearSessionCache());

const harnessUsageService = new HarnessUsageService(workspaceRegistry, { clientVersion: () => app.getVersion(), accounts: harnessAccountService });

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
    keybindingOverrides,
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

  registerTerminalIpc({
    getTerminals: () => terminals,
    getMainWindow: () => mainWindow,
    getStore: () => store,
    getSafeWorkspacePath: (workingDir: string) => getSafeWorkspacePath(workingDir, store),
    getOpenWorkspacePath: (workspaceId: string) => gitService.getOpenWorkspacePath(workspaceId),
    getWorkspaceRegistry: () => workspaceRegistry,
    getHarnessOptions: () => HARNESS_OPTIONS,
    agentAttentionBroker,
    createRemoteOutputObserver: (workspaceId) => createTerminalPreviewSignal((endpoint) => remotePreviewManager.discovery.hint(workspaceId, endpoint)),
    getHarnessAccountService: () => harnessAccountService,
  });

  assistantService = new HermesAssistantService({
    readSettings: () => store.get('assistantSettings'),
    writeSettings: (settings) => store.set('assistantSettings', settings),
    isShuttingDown: getAppShuttingDown,
    // The same authority behind the toolbar's Hermes launcher: a missing CLI makes Assistants dormant.
    isHermesAvailable: () => Boolean(getAvailableHarnessOptions().hermes),
    onChanged: (snapshot) => {
      // Deliberately disabled (or unavailable) Assistants own no native Browser views: dispose them all.
      if (!snapshot.settings.enabled || !snapshot.available) {
        for (const owner of assistantBrowserOwners(browserViews.keys())) browserIpcController?.disposeWorkspace(owner);
      }
      if (isWindowAvailable(mainWindow)) mainWindow.webContents.send(ASSISTANTS_CHANGED, snapshot);
    },
    onPtyData: (assistantId, data) => {
      if (isWindowAvailable(mainWindow)) mainWindow.webContents.send(ASSISTANTS_PTY_DATA, { assistantId, data });
    },
  });
  // Opted-in users only: a disabled configuration performs no Hermes probing or spawning at startup.
  assistantService.start();
  registerAssistantIpc({ getService: () => assistantService! });

  registerRemotePreviewIpc(remotePreviewManager);
  browserIpcController = registerBrowserIpc({
    onBrowserNavigation: (id, url, code) => remotePreviewManager.reportBrowserNavigation(id, url, code),
    getWorkspaceEnvironmentKind: (id) => resolveBrowserOwnerKind(id, {
      hasAssistant: (assistantId) => assistantService?.hasAssistant(assistantId) ?? false,
      getWorkspaceKind: (workspaceId) => workspaceRegistry.getWorkspace(workspaceId)?.environment.kind ?? null,
    }),
    getMainWindow: () => mainWindow,
    getKeybindingOverrides: () => keybindingOverrides.get(),
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
    onWorkspaceUnregistered: (id) => { browserIpcController?.disposeWorkspace(id); remoteFileWatcher.closeWorkspace(id); void remotePreviewManager.closeWorkspace(id); },
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

  registerUsageIpc({ getUsageService: () => harnessUsageService });
  registerAccountIpc({ getAccountService: () => harnessAccountService });

  registerSessionIpc({
    getTerminals: () => terminals,
    getMainWindow: () => mainWindow,
    getSafeWorkspacePath: (workingDir: string) => getSafeWorkspacePath(workingDir, store),
    getIsShuttingDown: getAppShuttingDown,
    getStore: () => store,
    getHarnessOptions: getAvailableHarnessOptions,
    getWorkspaceRegistry: () => workspaceRegistry,
    agentAttentionBroker,
    createRemoteOutputObserver: (workspaceId) => createTerminalPreviewSignal((endpoint) => remotePreviewManager.discovery.hint(workspaceId, endpoint)),
    getHarnessAccountService: () => harnessAccountService,
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
    theme: resolveInitialTheme(store),
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
        theme: resolveInitialTheme(store),
        onWindowClosed: cleanupWindowState,
        onRendererGone: cleanupWorkspaceResources,
      }));
    }
  });
});

if (process.env.NODE_ENV === 'development') {
  app.on('child-process-gone', (_event, details) => {
    console.error(`[diag] child process gone type=${details.type} name=${details.name ?? ''} reason=${details?.reason} exitCode=${details?.exitCode}`);
  });
}

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
  const assistantsStopped = assistantService?.shutdown() ?? Promise.resolve();
  harnessUsageService.dispose();
  const accountsClosed = harnessAccountService.dispose();
  workspaceRegistry.clear();
  killAllTerminals();
  agentAttentionBroker.close();
  removeAttentionAdapterFiles();
  // Keep the event loop alive for SSH SIGKILL escalation and host launch-file
  // cleanup. A repeated quit request shares this drain instead of bypassing it.
  quitCleanup = Promise.all([previewsClosed, waitForTerminalCleanup(), accountsClosed, assistantsStopped]).then(() => undefined);
  void quitCleanup.catch((error: unknown) => console.warn('[clanker-grid] shutdown cleanup failed:', error)).finally(() => {
    quitCleanupComplete = true;
    app.quit();
  });
});

// Export shared state for test access
export { resolveInitialWindowBackground };

export { terminals, browserViews, activeBrowserWorkspaceId, activeBrowserTabIdsByWorkspace, lastBrowserBoundsByWorkspace, gitService, explorerWatcher, store, workspaceRegistry, environmentManager, killAllTerminals, GRACEFUL_TERMINATION_TIMEOUT_MS, annotationModeEnabled, annotationController };
