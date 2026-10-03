import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { fileURLToPath } from 'node:url';
import type { FileListDirectoryRequest } from '../shared/types/fileExplorer';
import type { FileReadRequest, FileWriteRequest, FileChangedEvent, FileWatchRequest } from '../shared/types/editor';
import type { FileCreateRequest, FileDeleteRequest, FileRenameRequest } from '../shared/types/fileOperations';
import type { ExplorerTreeChangedEvent } from '../shared/types/fileExplorer';
import type { HarnessDefaultsMap } from '../shared/types/store';
import type { KeybindingOverrides, BrowserKeybindingCommandPayload } from '../shared/keybindings';
import type { VcsProvider } from '../shared/types/vcs';
import type { GitCreateWorktreeOptions, GitStatusResult } from '../shared/types/git';
import type { HarnessSession } from '../shared/types/session';
import type { HarnessUsageRequest } from '../shared/types/harnessUsage';
import type { HarnessAccountAuthEvent } from '../shared/types/harnessAccounts';
import type { AgentAttentionUpdate } from '../shared/types/agentAttention';
import type { RemotePreviewRequest, RemotePreviewUpdate, RemotePreviewWatchRequest } from '../shared/types/remotePreview';
import type { RemoteFileWatchRequest, RemoteFilesChangedEvent } from '../shared/types/remoteFileWatch';
import type { ThemeId } from '../shared/types/theme';
import type { AssistantPtyData, AssistantSettings, AssistantSnapshot } from '../shared/types/assistants';
import type { WorkspaceNavigationMode } from '../shared/types/workspaceNavigation';
import {
  ASSISTANTS_GET,
  ASSISTANTS_CONFIGURE,
  ASSISTANTS_REFRESH,
  ASSISTANTS_OPEN,
  ASSISTANTS_PTY_WRITE,
  ASSISTANTS_PTY_RESIZE,
  ASSISTANTS_PTY_CLOSE,
  ASSISTANTS_CHANGED,
  ASSISTANTS_PTY_DATA,
  GET_APP_VERSION,
  GET_LAST_WORKSPACE,
  GET_BASE_DIRECTORY,
  OPEN_BASE_DIRECTORY_DIALOG,
  OPEN_DIRECTORY_DIALOG,
  READ_DIRECTORY,
  FILE_LIST_DIRECTORY,
  REMOTE_FILES_WATCH,
  REMOTE_FILES_CHANGED,
  FILE_READ,
  FILE_WRITE,
  FILE_CHANGED,
  FILE_WATCH,
  FILE_UNWATCH,
  FILE_CREATE,
  FILE_DELETE,
  FILE_RENAME,
  EXPLORER_TREE_CHANGED,
  EXPLORER_START_WATCHING,
  EXPLORER_STOP_WATCHING,
  REVEAL_IN_FILE_MANAGER,
  GET_AI_COMMIT_SETTINGS,
  SET_AI_COMMIT_ENABLED,
  GET_KEYBINDING_OVERRIDES,
  SET_KEYBINDING_OVERRIDES,
  BROWSER_KEYBINDING_COMMAND,
  SET_AI_COMMIT_PROVIDER,
  SET_AI_COMMIT_MODEL,
  GET_THEME,
  SET_THEME,
  GET_WORKSPACE_NAVIGATION_MODE,
  SET_WORKSPACE_NAVIGATION_MODE,
  GET_WORKSPACE_SIDEBAR_WIDTH,
  SET_WORKSPACE_SIDEBAR_WIDTH,
  GET_WORKSPACE_SIDEBAR_EXPANDED_WIDTH,
  SPAWN_TERMINAL,
  GET_TERMINAL_BUFFER,
  WRITE_TERMINAL,
  SEND_ANNOTATION_TO_AGENT,
  GET_AGENT_HANDOFF_STATUSES,
  RESIZE_TERMINAL,
  KILL_TERMINAL,
  TERMINAL_CLEANUP_WORKSPACE,
  TERMINAL_DATA,
  TERMINAL_EXIT,
  AGENT_ATTENTION_UPDATE,
  HARNESS_ACCOUNTS_LIST,
  HARNESS_ACCOUNTS_SELECT,
  HARNESS_ACCOUNTS_ADD_START,
  HARNESS_ACCOUNTS_RECONNECT,
  HARNESS_ACCOUNTS_AUTH_CANCEL,
  HARNESS_ACCOUNTS_REMOVE,
  HARNESS_ACCOUNTS_RENAME,
  HARNESS_ACCOUNTS_AUTH_STATE,
  TERMINAL_RESIZED,
  TERMINAL_READY,
  RECIPE_COMMAND_WAIT,
  WRITE_CLIPBOARD,
  REMOTE_PREVIEW_WATCH,
  REMOTE_PREVIEW_GET,
  REMOTE_PREVIEW_START,
  REMOTE_PREVIEW_STOP,
  REMOTE_PREVIEW_CHANGED,
  BROWSER_HIDE,
  BROWSER_SET_BOUNDS,
  BROWSER_NAVIGATE,
  RECIPE_PREVIEW_PROBE,
  BROWSER_BACK,
  BROWSER_FORWARD,
  BROWSER_REFRESH,
  BROWSER_STOP,
  OPEN_EXTERNAL,
  CAN_GO_BACK,
  CAN_GO_FORWARD,
  BROWSER_DISPOSE_WORKSPACE,
  BROWSER_URL_UPDATED,
  BROWSER_CREATE_TAB,
  BROWSER_CLOSE_TAB,
  BROWSER_SWITCH_TAB,
  BROWSER_ACTIVATE,
  BROWSER_MOVE_TAB,
  BROWSER_GET_TABS,
  BROWSER_TAB_NAVIGATE,
  BROWSER_HISTORY_ADD,
  BROWSER_HISTORY_GET,
  BROWSER_HISTORY_CLEAR,
  FIT_ALL_PANES,
  MINIMIZE_WINDOW,
  TOGGLE_MAXIMIZE_WINDOW,
  CLOSE_WINDOW,
  IS_MAXIMIZED_WINDOW,
  ZOOM_IN_WINDOW,
  ZOOM_OUT_WINDOW,
  RESET_ZOOM_WINDOW,
  WINDOW_READY_TO_SHOW,
  GET_HARNESS_OPTIONS,
  GET_HARNESS_MODELS,
  GET_HARNESS_DEFAULTS,
  SET_HARNESS_DEFAULTS,
  GIT_START_POLLING,
  GIT_STOP_POLLING,
  GENERATE_COMMIT_MESSAGE,
  GIT_STAGE,
  GIT_UNSTAGE,
  GIT_COMMIT,
  GIT_GET_BRANCH_STATE,
  GIT_LIST_WORKTREES,
  GIT_CREATE_WORKTREE,
  GIT_INSPECT_WORKTREE,
  GIT_REMOVE_WORKTREE,
  GIT_PRUNE_WORKTREES,
  GIT_UNLOCK_WORKTREE,
  REGISTER_OPEN_WORKSPACE,
  UNREGISTER_OPEN_WORKSPACE,
  RELEASE_CHECKOUT_CONTEXT,
  ADOPT_WORKTREE_CHECKOUT_CONTEXT,
  GIT_GET_OPERATION_STATE,
  GIT_GET_STASHES,
  GIT_GET_HISTORY,
  GIT_GET_DIFF,
  GIT_GET_FILE_DIFF,
  GIT_CREATE_BRANCH,
  GIT_SWITCH_BRANCH,
  GIT_DELETE_BRANCH,
  GIT_FORCE_DELETE_BRANCH,
  GIT_MERGE_BRANCH,
  GIT_ABORT_OPERATION,
  GIT_STASH,
  GIT_APPLY_STASH,
  GIT_POP_STASH,
  GIT_DROP_STASH,
  GIT_CLEAR_STASHES,
  GIT_REFRESH,
  GIT_INIT,
  GIT_GET_REMOTES,
  GIT_ADD_REMOTE,
  GIT_REMOVE_REMOTE,
  GIT_RENAME_REMOTE,
  GIT_FETCH,
  GIT_PULL,
  GIT_PUSH,
  GIT_STATUS_UPDATE,
  CREDENTIAL_GENERATE_SSH_KEY,
  CREDENTIAL_GET_PUBLIC_KEY,
  CREDENTIAL_DELETE_SSH_KEY,
  CREDENTIAL_CHECK_EXISTS,
  CREDENTIAL_SAVE_PAT,
  CREDENTIAL_GET_PAT,
  CREDENTIAL_DELETE_PAT,
  CREDENTIAL_GET_STATUS,
  CREDENTIAL_GET_GLOBAL_STATUS,
  CREDENTIAL_CONFIGURE_SSH_HOST,
  VCS_GET_CONTEXT,
  VCS_GET_PR_INFO,
  VCS_GET_DEEP_LINKS,
  VCS_GET_DEEP_LINK,
  VCS_OPEN_DEEP_LINK,
  ANNOTATION_ENABLE,
  ANNOTATION_DISABLE,
  ANNOTATION_CAPTURE,
  ANNOTATION_GET_STATE,
  ANNOTATION_EXPORT,
  ANNOTATION_CHECK_ESCAPED,
  ANNOTATION_ESCAPE,
  ANNOTATION_STATE_CHANGED,
  ANNOTATION_TRIGGER_COPY,
  ANNOTATION_PREPARE_SEND,
  SESSION_DISCOVER,
  SESSION_INVOKE,
  HARNESS_USAGE_GET,
  RECIPE_GET_ALL,
  RECIPE_SAVE,
  RECIPE_DELETE,
  SSH_ENVIRONMENT_LIST,
  SSH_ENVIRONMENT_SAVE,
  SSH_ENVIRONMENT_DELETE,
  SSH_ENVIRONMENT_TEST,
  SSH_GET_HOME_DIRECTORY,
  SSH_LIST_DIRECTORIES,
  SSH_CREATE_DIRECTORY,
  GET_ENVIRONMENT_HARNESS_OPTIONS,
  GET_ENVIRONMENT_HARNESS_MODELS,
} from '../shared/ipcChannels';

contextBridge.exposeInMainWorld('electronAPI', {
  // Optional native-profile roster; settings do not contain native credentials.
  getAssistants: () => ipcRenderer.invoke(ASSISTANTS_GET),
  configureAssistants: (settings: AssistantSettings) => ipcRenderer.invoke(ASSISTANTS_CONFIGURE, settings),
  refreshAssistants: () => ipcRenderer.invoke(ASSISTANTS_REFRESH),
  openAssistant: (botId: string) => ipcRenderer.invoke(ASSISTANTS_OPEN, botId),
  writeAssistantPty: (botId: string, data: string) => ipcRenderer.invoke(ASSISTANTS_PTY_WRITE, botId, data),
  resizeAssistantPty: (botId: string, cols: number, rows: number) => ipcRenderer.invoke(ASSISTANTS_PTY_RESIZE, botId, cols, rows),
  closeAssistantPty: (botId: string) => ipcRenderer.invoke(ASSISTANTS_PTY_CLOSE, botId),
  onAssistantPtyData: (callback: (payload: AssistantPtyData) => void) => {
    const handler = (_event: IpcRendererEvent, payload: AssistantPtyData) => callback(payload);
    ipcRenderer.on(ASSISTANTS_PTY_DATA, handler);
    return () => ipcRenderer.removeListener(ASSISTANTS_PTY_DATA, handler);
  },
  onAssistantsChanged: (callback: (snapshot: AssistantSnapshot) => void) => {
    const handler = (_event: IpcRendererEvent, snapshot: AssistantSnapshot) => callback(snapshot);
    ipcRenderer.on(ASSISTANTS_CHANGED, handler);
    return () => ipcRenderer.removeListener(ASSISTANTS_CHANGED, handler);
  },
  // App
  getAppVersion: () => ipcRenderer.invoke(GET_APP_VERSION),

  // Workspace
  getLastWorkspace: () => ipcRenderer.invoke(GET_LAST_WORKSPACE),
  getBaseDirectory: () => ipcRenderer.invoke(GET_BASE_DIRECTORY),
  openBaseDirectoryDialog: () => ipcRenderer.invoke(OPEN_BASE_DIRECTORY_DIALOG),
  openDirectoryDialog: () => ipcRenderer.invoke(OPEN_DIRECTORY_DIALOG),
  readDirectory: (path: string) => ipcRenderer.invoke(READ_DIRECTORY, path),
  fileListDirectory: (request: FileListDirectoryRequest) =>
    ipcRenderer.invoke(FILE_LIST_DIRECTORY, request),

  // Settings
  getAiCommitSettings: () => ipcRenderer.invoke(GET_AI_COMMIT_SETTINGS),
  setAiCommitEnabled: (enabled: boolean) => ipcRenderer.invoke(SET_AI_COMMIT_ENABLED, enabled),
  setAiCommitProvider: (provider: string) => ipcRenderer.invoke(SET_AI_COMMIT_PROVIDER, provider),
  setAiCommitModel: (model: string) => ipcRenderer.invoke(SET_AI_COMMIT_MODEL, model),
  getTheme: () => ipcRenderer.invoke(GET_THEME),
  setTheme: (theme: ThemeId) => ipcRenderer.invoke(SET_THEME, theme),
  getWorkspaceNavigationMode: () => ipcRenderer.invoke(GET_WORKSPACE_NAVIGATION_MODE),
  setWorkspaceNavigationMode: (mode: WorkspaceNavigationMode) => ipcRenderer.invoke(SET_WORKSPACE_NAVIGATION_MODE, mode),
  getWorkspaceSidebarWidth: () => ipcRenderer.invoke(GET_WORKSPACE_SIDEBAR_WIDTH),
  setWorkspaceSidebarWidth: (width: number) => ipcRenderer.invoke(SET_WORKSPACE_SIDEBAR_WIDTH, width),
  getWorkspaceSidebarExpandedWidth: () => ipcRenderer.invoke(GET_WORKSPACE_SIDEBAR_EXPANDED_WIDTH),
  getKeybindingOverrides: () => ipcRenderer.invoke(GET_KEYBINDING_OVERRIDES),
  setKeybindingOverrides: (overrides: KeybindingOverrides) => ipcRenderer.invoke(SET_KEYBINDING_OVERRIDES, overrides),

  // Terminal
  spawnTerminal: (workingDir: string, harness?: string, model?: string, initialCommand?: string, recipeCommand?: boolean, workspaceId?: string, environmentId?: string, checkoutContextId?: string) =>
    ipcRenderer.invoke(SPAWN_TERMINAL, workingDir, harness, model, initialCommand, recipeCommand, workspaceId, environmentId, checkoutContextId),
  waitRecipeCommand: (id: string) => ipcRenderer.invoke(RECIPE_COMMAND_WAIT, id),
  getTerminalBuffer: (id: string) => ipcRenderer.invoke(GET_TERMINAL_BUFFER, id),
  writeTerminal: (id: string, data: string) => ipcRenderer.invoke(WRITE_TERMINAL, { id, data }),
  getAgentHandoffStatuses: () => ipcRenderer.invoke(GET_AGENT_HANDOFF_STATUSES),
  sendAnnotationToAgent: (workspaceId: string, terminalId: string, message: string) =>
    ipcRenderer.invoke(SEND_ANNOTATION_TO_AGENT, { workspaceId, terminalId, message }),
  resizeTerminal: (id: string, cols: number, rows: number) =>
    ipcRenderer.invoke(RESIZE_TERMINAL, { id, cols, rows }),
  killTerminal: (id: string) => ipcRenderer.invoke(KILL_TERMINAL, id),
  cleanupWorkspaceTerminals: (ids: string[]) => ipcRenderer.invoke(TERMINAL_CLEANUP_WORKSPACE, ids),
  onTerminalData: (callback: (data: { id: string; data: string }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { id: string; data: string }) => callback(data);
    ipcRenderer.on(TERMINAL_DATA, handler);
    return () => ipcRenderer.removeListener(TERMINAL_DATA, handler);
  },
  onTerminalExit: (callback: (data: { id: string; exitCode: number }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { id: string; exitCode: number }) => callback(data);
    ipcRenderer.on(TERMINAL_EXIT, handler);
    return () => ipcRenderer.removeListener(TERMINAL_EXIT, handler);
  },
  onAgentAttentionUpdate: (callback: (data: AgentAttentionUpdate) => void) => {
    const handler = (_event: IpcRendererEvent, data: AgentAttentionUpdate) => callback(data);
    ipcRenderer.on(AGENT_ATTENTION_UPDATE, handler);
    return () => ipcRenderer.removeListener(AGENT_ATTENTION_UPDATE, handler);
  },
  onTerminalResized: (callback: (data: { id: string; cols: number; rows: number }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { id: string; cols: number; rows: number }) => callback(data);
    ipcRenderer.on(TERMINAL_RESIZED, handler);
    return () => ipcRenderer.removeListener(TERMINAL_RESIZED, handler);
  },
  terminalReady: (id: string) => ipcRenderer.invoke(TERMINAL_READY, id),

  // Clipboard
  writeClipboard: (text: string) => ipcRenderer.invoke(WRITE_CLIPBOARD, text),
  resolveDroppedFilePath: (file: Parameters<typeof webUtils.getPathForFile>[0], uriList?: string) => {
    const directPath = webUtils.getPathForFile(file);
    if (directPath) {
      return directPath;
    }

    if (!uriList) {
      return '';
    }

    const lines = uriList.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const firstUri = lines.find((line) => !line.startsWith('#'));
    if (!firstUri) {
      return '';
    }

    try {
      const url = new URL(firstUri);
      if (url.protocol === 'file:') {
        return fileURLToPath(url);
      }
    } catch {
      return '';
    }

    return '';
  },

  // Browser (using WebContentsView)
  remotePreviewWatch: (request: RemotePreviewWatchRequest) => ipcRenderer.invoke(REMOTE_PREVIEW_WATCH, request),
  remotePreviewGet: (request: { workspaceId: string }) => ipcRenderer.invoke(REMOTE_PREVIEW_GET, request),
  remotePreviewStart: (request: RemotePreviewRequest) => ipcRenderer.invoke(REMOTE_PREVIEW_START, request),
  remotePreviewStop: (request: { workspaceId: string; serviceId?: string }) => ipcRenderer.invoke(REMOTE_PREVIEW_STOP, request),
  onRemotePreviewChanged: (callback: (update: RemotePreviewUpdate) => void) => {
    const handler = (_: IpcRendererEvent, update: RemotePreviewUpdate) => callback(update);
    ipcRenderer.on(REMOTE_PREVIEW_CHANGED, handler);
    return () => ipcRenderer.removeListener(REMOTE_PREVIEW_CHANGED, handler);
  },
  browserHide: (workspaceId: string) => ipcRenderer.invoke(BROWSER_HIDE, workspaceId),
  browserSetBounds: (
    workspaceId: string,
    bounds: { x: number; y: number; width: number; height: number },
    tabId?: string,
  ) => ipcRenderer.invoke(BROWSER_SET_BOUNDS, workspaceId, bounds, tabId),
  browserNavigate: (workspaceId: string, url: string, tabId?: string, awaitLoad?: boolean) =>
    ipcRenderer.invoke(BROWSER_NAVIGATE, workspaceId, url, tabId, awaitLoad),
  probeRecipePreview: (url: string, waitForReady: boolean) =>
    ipcRenderer.invoke(RECIPE_PREVIEW_PROBE, url, waitForReady),
  browserBack: (workspaceId: string) => ipcRenderer.invoke(BROWSER_BACK, workspaceId),
  browserForward: (workspaceId: string) => ipcRenderer.invoke(BROWSER_FORWARD, workspaceId),
  browserRefresh: (workspaceId: string) => ipcRenderer.invoke(BROWSER_REFRESH, workspaceId),
  browserStop: (workspaceId: string) => ipcRenderer.invoke(BROWSER_STOP, workspaceId),
  browserCreateTab: (workspaceId: string, tabId: string) =>
    ipcRenderer.invoke(BROWSER_CREATE_TAB, workspaceId, tabId),
  browserCloseTab: (workspaceId: string, tabId: string) =>
    ipcRenderer.invoke(BROWSER_CLOSE_TAB, workspaceId, tabId),
  browserSwitchTab: (workspaceId: string, tabId: string) =>
    ipcRenderer.invoke(BROWSER_SWITCH_TAB, workspaceId, tabId),
  browserActivate: (workspaceId: string, tabId?: string) =>
    ipcRenderer.invoke(BROWSER_ACTIVATE, workspaceId, tabId),
  browserMoveTab: (workspaceId: string, tabId: string, targetTabId: string, activeTabId: string) =>
    ipcRenderer.invoke(BROWSER_MOVE_TAB, workspaceId, tabId, targetTabId, activeTabId),
  browserGetTabs: (workspaceId: string) =>
    ipcRenderer.invoke(BROWSER_GET_TABS, workspaceId),
  browserTabNavigate: (workspaceId: string, tabId: string, url: string) =>
    ipcRenderer.invoke(BROWSER_TAB_NAVIGATE, workspaceId, tabId, url),
  browserHistoryGet: (prefix?: string) => ipcRenderer.invoke(BROWSER_HISTORY_GET, prefix),
  browserHistoryAdd: (url: string, title?: string) => ipcRenderer.invoke(BROWSER_HISTORY_ADD, url, title),
  browserHistoryClear: () => ipcRenderer.invoke(BROWSER_HISTORY_CLEAR),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL, url),
  revealInFileManager: (filePath: string, workspaceId?: string) => ipcRenderer.invoke(REVEAL_IN_FILE_MANAGER, filePath, workspaceId),
  canGoBack: (workspaceId: string) => ipcRenderer.invoke(CAN_GO_BACK, workspaceId),
  canGoForward: (workspaceId: string) => ipcRenderer.invoke(CAN_GO_FORWARD, workspaceId),
  browserDisposeWorkspace: (workspaceId: string) => ipcRenderer.invoke(BROWSER_DISPOSE_WORKSPACE, workspaceId),
  onBrowserUrlUpdated: (
    callback: (payload: {
      workspaceId: string;
      tabId?: string;
      url: string;
      title?: string;
      canGoBack?: boolean;
      canGoForward?: boolean;
    }) => void,
  ) => {
    const handler = (
      _event: IpcRendererEvent,
      payload: {
        workspaceId: string;
        tabId?: string;
        url: string;
        title?: string;
        canGoBack?: boolean;
        canGoForward?: boolean;
      },
    ) => callback(payload);
    ipcRenderer.on(BROWSER_URL_UPDATED, handler);
    return () => ipcRenderer.removeListener(BROWSER_URL_UPDATED, handler);
  },
  onBrowserKeybindingCommand: (callback: (payload: BrowserKeybindingCommandPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: BrowserKeybindingCommandPayload) => callback(payload);
    ipcRenderer.on(BROWSER_KEYBINDING_COMMAND, handler);
    return () => ipcRenderer.removeListener(BROWSER_KEYBINDING_COMMAND, handler);
  },
  onFitAllPanes: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on(FIT_ALL_PANES, handler);
    return () => ipcRenderer.removeListener(FIT_ALL_PANES, handler);
  },

  // Window controls
  minimizeWindow: () => ipcRenderer.invoke(MINIMIZE_WINDOW),
  toggleMaximizeWindow: () => ipcRenderer.invoke(TOGGLE_MAXIMIZE_WINDOW),
  closeWindow: () => ipcRenderer.invoke(CLOSE_WINDOW),
  isMaximizedWindow: () => ipcRenderer.invoke(IS_MAXIMIZED_WINDOW),
  zoomInWindow: () => ipcRenderer.invoke(ZOOM_IN_WINDOW),
  zoomOutWindow: () => ipcRenderer.invoke(ZOOM_OUT_WINDOW),
  resetZoomWindow: () => ipcRenderer.invoke(RESET_ZOOM_WINDOW),
  windowReadyToShow: () => ipcRenderer.invoke(WINDOW_READY_TO_SHOW),
  getWindowZoomFactor: () => webFrame.getZoomFactor(),

  // Harness
  getHarnessOptions: () => ipcRenderer.invoke(GET_HARNESS_OPTIONS),
  getHarnessModels: (harness: string, refresh?: boolean) => ipcRenderer.invoke(GET_HARNESS_MODELS, harness, refresh),
  getHarnessDefaults: () => ipcRenderer.invoke(GET_HARNESS_DEFAULTS),
  setHarnessDefaults: (defaults: HarnessDefaultsMap) =>
    ipcRenderer.invoke(SET_HARNESS_DEFAULTS, defaults),

  // Git operations - managed by GitService in main process
  gitStartPolling: (workspacePath: string, workspaceId?: string) => ipcRenderer.invoke(GIT_START_POLLING, workspacePath, workspaceId),
  gitStopPolling: (workspaceId?: string) => ipcRenderer.invoke(GIT_STOP_POLLING, workspaceId),
  generateCommitMessage: (workspacePath: string, workspaceId?: string) => ipcRenderer.invoke(GENERATE_COMMIT_MESSAGE, workspacePath, workspaceId),
  gitStage: (workspacePath: string, files?: string[], workspaceId?: string) => ipcRenderer.invoke(GIT_STAGE, workspacePath, files, workspaceId),
  gitUnstage: (workspacePath: string, files?: string[], workspaceId?: string) => ipcRenderer.invoke(GIT_UNSTAGE, workspacePath, files, workspaceId),
  gitCommit: (workspacePath: string, message: string, workspaceId?: string) => ipcRenderer.invoke(GIT_COMMIT, workspacePath, message, workspaceId),
  gitGetBranchState: (workspacePath: string, workspaceId?: string) => ipcRenderer.invoke(GIT_GET_BRANCH_STATE, workspacePath, workspaceId),
  gitListWorktrees: (workspacePath: string, workspaceId?: string) => ipcRenderer.invoke(GIT_LIST_WORKTREES, workspacePath, workspaceId),
  gitCreateWorktree: (workspacePath: string, baseRef: string, branch: string, workspaceId?: string, options?: GitCreateWorktreeOptions) =>
    ipcRenderer.invoke(GIT_CREATE_WORKTREE, workspacePath, baseRef, branch, workspaceId, options),
  registerOpenWorkspace: (id: string, workspacePath: string, environmentId?: string) =>
    ipcRenderer.invoke(REGISTER_OPEN_WORKSPACE, id, workspacePath, environmentId),
  unregisterOpenWorkspace: (id: string) =>
    ipcRenderer.invoke(UNREGISTER_OPEN_WORKSPACE, id),
  adoptWorktreeCheckoutContext: (workspaceId: string, worktreePath: string) =>
    ipcRenderer.invoke(ADOPT_WORKTREE_CHECKOUT_CONTEXT, workspaceId, worktreePath),
  releaseCheckoutContext: (workspaceId: string, checkoutContextId: string) =>
    ipcRenderer.invoke(RELEASE_CHECKOUT_CONTEXT, workspaceId, checkoutContextId),
  gitInspectWorktree: (workspacePath: string, worktreePath: string, openWorkspacePaths: string[], workspaceId?: string) =>
    ipcRenderer.invoke(GIT_INSPECT_WORKTREE, workspacePath, worktreePath, openWorkspacePaths, workspaceId),
  gitRemoveWorktree: (workspacePath: string, worktreePath: string, expectedBranch: string | null, openWorkspacePaths: string[], workspaceId?: string) =>
    ipcRenderer.invoke(GIT_REMOVE_WORKTREE, workspacePath, worktreePath, expectedBranch, openWorkspacePaths, workspaceId),
  gitPruneWorktrees: (workspacePath: string, workspaceId?: string) => ipcRenderer.invoke(GIT_PRUNE_WORKTREES, workspacePath, workspaceId),
  gitUnlockWorktree: (workspacePath: string, worktreePath: string, workspaceId?: string) => ipcRenderer.invoke(GIT_UNLOCK_WORKTREE, workspacePath, worktreePath, workspaceId),
  gitGetOperationState: (workspacePath: string, workspaceId?: string) => ipcRenderer.invoke(GIT_GET_OPERATION_STATE, workspacePath, workspaceId),
  gitGetStashes: (workspacePath: string, workspaceId?: string) => ipcRenderer.invoke(GIT_GET_STASHES, workspacePath, workspaceId),
  gitGetHistory: (workspacePath: string, limit?: number, workspaceId?: string) => ipcRenderer.invoke(GIT_GET_HISTORY, workspacePath, limit, workspaceId),
  gitGetDiff: (
    workspacePath: string,
    mode: 'working' | 'staged' | 'commit',
    ref?: string,
    workspaceId?: string
  ) => ipcRenderer.invoke(GIT_GET_DIFF, workspacePath, mode, ref, workspaceId),
  gitGetFileDiff: (
    workspacePath: string,
    filePath: string,
    mode: 'working' | 'staged',
    workspaceId?: string
  ) => ipcRenderer.invoke(GIT_GET_FILE_DIFF, workspacePath, filePath, mode, workspaceId),
  gitCreateBranch: (workspacePath: string, name: string, baseBranch?: string, workspaceId?: string) =>
    ipcRenderer.invoke(GIT_CREATE_BRANCH, workspacePath, name, baseBranch, workspaceId),
  gitSwitchBranch: (workspacePath: string, name: string, workspaceId?: string) => ipcRenderer.invoke(GIT_SWITCH_BRANCH, workspacePath, name, workspaceId),
  gitDeleteBranch: (workspacePath: string, name: string, workspaceId?: string) => ipcRenderer.invoke(GIT_DELETE_BRANCH, workspacePath, name, workspaceId),
  gitForceDeleteBranch: (workspacePath: string, name: string, workspaceId?: string) =>
    ipcRenderer.invoke(GIT_FORCE_DELETE_BRANCH, workspacePath, name, workspaceId),
  gitMergeBranch: (workspacePath: string, branchName: string, workspaceId?: string) => ipcRenderer.invoke(GIT_MERGE_BRANCH, workspacePath, branchName, workspaceId),
  gitAbortOperation: (workspacePath: string, workspaceId?: string) => ipcRenderer.invoke(GIT_ABORT_OPERATION, workspacePath, workspaceId),
  gitStash: (workspacePath: string, message?: string, includeUntracked?: boolean, workspaceId?: string) =>
    ipcRenderer.invoke(GIT_STASH, workspacePath, message, includeUntracked, workspaceId),
  gitApplyStash: (workspacePath: string, stashRef: string, workspaceId?: string) => ipcRenderer.invoke(GIT_APPLY_STASH, workspacePath, stashRef, workspaceId),
  gitPopStash: (workspacePath: string, stashRef: string, workspaceId?: string) => ipcRenderer.invoke(GIT_POP_STASH, workspacePath, stashRef, workspaceId),
  gitDropStash: (workspacePath: string, stashRef: string, workspaceId?: string) => ipcRenderer.invoke(GIT_DROP_STASH, workspacePath, stashRef, workspaceId),
  gitClearStashes: (workspacePath: string, workspaceId?: string) => ipcRenderer.invoke(GIT_CLEAR_STASHES, workspacePath, workspaceId),
  gitRefresh: (workspaceId?: string) => ipcRenderer.invoke(GIT_REFRESH, workspaceId),
  gitInit: (workspacePath: string, defaultBranch?: string, workspaceId?: string) =>
    ipcRenderer.invoke(GIT_INIT, workspacePath, defaultBranch, workspaceId),
  gitGetRemotes: (workspacePath: string, workspaceId?: string) => ipcRenderer.invoke(GIT_GET_REMOTES, workspacePath, workspaceId),
  gitAddRemote: (workspacePath: string, name: string, url: string, workspaceId?: string) =>
    ipcRenderer.invoke(GIT_ADD_REMOTE, workspacePath, name, url, workspaceId),
  gitRemoveRemote: (workspacePath: string, name: string, workspaceId?: string) =>
    ipcRenderer.invoke(GIT_REMOVE_REMOTE, workspacePath, name, workspaceId),
  gitRenameRemote: (workspacePath: string, oldName: string, newName: string, workspaceId?: string) =>
    ipcRenderer.invoke(GIT_RENAME_REMOTE, workspacePath, oldName, newName, workspaceId),
  gitFetch: (workspacePath: string, remote?: string, workspaceId?: string) => ipcRenderer.invoke(GIT_FETCH, workspacePath, remote, workspaceId),
  gitPull: (workspacePath: string, rebase?: boolean, workspaceId?: string) => ipcRenderer.invoke(GIT_PULL, workspacePath, rebase, workspaceId),
  gitPush: (
    workspacePath: string,
    remote?: string,
    branch?: string,
    forceWithLease?: boolean,
    setUpstream?: boolean,
    workspaceId?: string
  ) => ipcRenderer.invoke(GIT_PUSH, workspacePath, remote, branch, forceWithLease, setUpstream, workspaceId),
  onGitStatusUpdate: (callback: (status: GitStatusResult) => void) => {
    const handler = (_event: IpcRendererEvent, status: GitStatusResult) => callback(status);
    ipcRenderer.on(GIT_STATUS_UPDATE, handler);
    return () => ipcRenderer.removeListener(GIT_STATUS_UPDATE, handler);
  },

  // Credential management
  credentialGenerateSshKey: () => ipcRenderer.invoke(CREDENTIAL_GENERATE_SSH_KEY),
  credentialGetPublicKey: () => ipcRenderer.invoke(CREDENTIAL_GET_PUBLIC_KEY),
  credentialDeleteSshKey: () => ipcRenderer.invoke(CREDENTIAL_DELETE_SSH_KEY),
  credentialCheckExists: () => ipcRenderer.invoke(CREDENTIAL_CHECK_EXISTS),
  credentialSavePat: (provider: VcsProvider, token: string, scope?: string[]) =>
    ipcRenderer.invoke(CREDENTIAL_SAVE_PAT, { provider, token, scope }),
  credentialGetPat: (provider: VcsProvider) => ipcRenderer.invoke(CREDENTIAL_GET_PAT, provider),
  credentialDeletePat: (provider: VcsProvider) => ipcRenderer.invoke(CREDENTIAL_DELETE_PAT, provider),
  credentialGetStatus: (remoteName: string, remoteUrl: string, provider: VcsProvider) =>
    ipcRenderer.invoke(CREDENTIAL_GET_STATUS, remoteName, remoteUrl, provider),
  credentialGetGlobalStatus: () => ipcRenderer.invoke(CREDENTIAL_GET_GLOBAL_STATUS),
  credentialConfigureSshHost: (hostname: string) => ipcRenderer.invoke(CREDENTIAL_CONFIGURE_SSH_HOST, hostname),

  // VCS Provider Context
  vcsGetContext: (workspacePath: string, workspaceId?: string) => ipcRenderer.invoke(VCS_GET_CONTEXT, workspacePath, workspaceId),
  vcsGetPrInfo: (workspacePath: string, workspaceId?: string) => ipcRenderer.invoke(VCS_GET_PR_INFO, workspacePath, workspaceId),
  vcsGetDeepLinks: (workspacePath: string, prNumber?: number, workspaceId?: string) => ipcRenderer.invoke(VCS_GET_DEEP_LINKS, workspacePath, prNumber, workspaceId),
  vcsGetDeepLink: (workspacePath: string, type: string, workspaceId?: string) => ipcRenderer.invoke(VCS_GET_DEEP_LINK, workspacePath, type, workspaceId),
  vcsOpenDeepLink: (workspacePath: string, type: string, workspaceId?: string) => ipcRenderer.invoke(VCS_OPEN_DEEP_LINK, workspacePath, type, workspaceId),

  // Editor
  editorReadFile: (request: FileReadRequest) => ipcRenderer.invoke(FILE_READ, request),
  editorWriteFile: (request: FileWriteRequest) => ipcRenderer.invoke(FILE_WRITE, request),
  editorWatchFile: (request: FileWatchRequest) => ipcRenderer.invoke(FILE_WATCH, request),
  remoteFilesWatch: (request: RemoteFileWatchRequest | null) => ipcRenderer.invoke(REMOTE_FILES_WATCH, request),
  onRemoteFilesChanged: (callback: (event: RemoteFilesChangedEvent) => void) => {
    const listener = (_: IpcRendererEvent, event: RemoteFilesChangedEvent) => callback(event);
    ipcRenderer.on(REMOTE_FILES_CHANGED, listener);
    return () => ipcRenderer.removeListener(REMOTE_FILES_CHANGED, listener);
  },
  editorUnwatchFile: (request: FileWatchRequest) => ipcRenderer.invoke(FILE_UNWATCH, request),
  onFileChanged: (callback: (event: FileChangedEvent) => void) => {
    const handler = (_event: IpcRendererEvent, payload: FileChangedEvent) => callback(payload);
    ipcRenderer.on(FILE_CHANGED, handler);
    return () => ipcRenderer.removeListener(FILE_CHANGED, handler);
  },

  // File Operations
  fileCreate: (request: FileCreateRequest) => ipcRenderer.invoke(FILE_CREATE, request),
  fileDelete: (request: FileDeleteRequest) => ipcRenderer.invoke(FILE_DELETE, request),
  fileRename: (request: FileRenameRequest) => ipcRenderer.invoke(FILE_RENAME, request),

  // Explorer tree auto-refresh
  onExplorerTreeChanged: (callback: (event: ExplorerTreeChangedEvent) => void) => {
    const handler = (_event: IpcRendererEvent, payload: ExplorerTreeChangedEvent) => callback(payload);
    ipcRenderer.on(EXPLORER_TREE_CHANGED, handler);
    return () => ipcRenderer.removeListener(EXPLORER_TREE_CHANGED, handler);
  },
  explorerStartWatching: (workspaceId: string) =>
    ipcRenderer.invoke(EXPLORER_START_WATCHING, workspaceId),
  explorerStopWatching: () =>
    ipcRenderer.invoke(EXPLORER_STOP_WATCHING),

  // Session history
  discoverSessions: (workspaceId: string) =>
    ipcRenderer.invoke(SESSION_DISCOVER, workspaceId),
  invokeSession: (workspaceId: string, session: HarnessSession, fork?: boolean) =>
    ipcRenderer.invoke(SESSION_INVOKE, workspaceId, session, fork),

  // Harness usage (workspaceId is the only reference; main resolves the environment)
  getHarnessUsage: (workspaceId: string, request?: HarnessUsageRequest) =>
    ipcRenderer.invoke(HARNESS_USAGE_GET, workspaceId, request),

  // Harness accounts. Plain strings only: main resolves identity, paths and environments itself.
  listHarnessAccounts: (environmentId: string, harness: string) =>
    ipcRenderer.invoke(HARNESS_ACCOUNTS_LIST, environmentId, harness),
  selectHarnessAccount: (environmentId: string, harness: string, accountId: string) =>
    ipcRenderer.invoke(HARNESS_ACCOUNTS_SELECT, environmentId, harness, accountId),
  startHarnessAccountAdd: (environmentId: string, harness: string, label?: string) =>
    ipcRenderer.invoke(HARNESS_ACCOUNTS_ADD_START, environmentId, harness, label),
  reconnectHarnessAccount: (environmentId: string, harness: string, accountId: string) =>
    ipcRenderer.invoke(HARNESS_ACCOUNTS_RECONNECT, environmentId, harness, accountId),
  cancelHarnessAccountAuth: (flowId: string) =>
    ipcRenderer.invoke(HARNESS_ACCOUNTS_AUTH_CANCEL, flowId),
  removeHarnessAccount: (environmentId: string, harness: string, accountId: string) =>
    ipcRenderer.invoke(HARNESS_ACCOUNTS_REMOVE, environmentId, harness, accountId),
  renameHarnessAccount: (environmentId: string, harness: string, accountId: string, label: string) =>
    ipcRenderer.invoke(HARNESS_ACCOUNTS_RENAME, environmentId, harness, accountId, label),
  onHarnessAccountAuthState: (callback: (event: HarnessAccountAuthEvent) => void) => {
    const handler = (_event: IpcRendererEvent, data: HarnessAccountAuthEvent) => callback(data);
    ipcRenderer.on(HARNESS_ACCOUNTS_AUTH_STATE, handler);
    return () => ipcRenderer.removeListener(HARNESS_ACCOUNTS_AUTH_STATE, handler);
  },

  // Workspace Recipes
  recipeGetAll: (workspacePath?: string) =>
    ipcRenderer.invoke(RECIPE_GET_ALL, workspacePath),
  recipeSave: (recipe: unknown) =>
    ipcRenderer.invoke(RECIPE_SAVE, recipe),
  recipeDelete: (recipeId: string) =>
    ipcRenderer.invoke(RECIPE_DELETE, recipeId),

  // Browser annotation
  annotationEnable: (workspaceId: string) => ipcRenderer.invoke(ANNOTATION_ENABLE, workspaceId),
  annotationDisable: () => ipcRenderer.invoke(ANNOTATION_DISABLE),
  annotationGetState: () => ipcRenderer.invoke(ANNOTATION_GET_STATE),
  annotationCapture: () => ipcRenderer.invoke(ANNOTATION_CAPTURE),
  annotationExport: (annotation: {
    url: string;
    title: string;
    tagName: string;
    selector: string;
    fallbackSelectors: string[];
    id: string | null;
    className: string | null;
    text: string | null;
    role: string | null;
    accessibleName: string | null;
    attributes: Record<string, string>;
    bounds: { x: number; y: number; width: number; height: number };
    uiRegion: string | null;
    elementRoleInContext: string | null;
    nearbyText: string[];
    ancestorContext: string | null;
    note: string;
    timestamp: string;
  }) => ipcRenderer.invoke(ANNOTATION_EXPORT, annotation),
  annotationCheckEscaped: () => ipcRenderer.invoke(ANNOTATION_CHECK_ESCAPED),
  onAnnotationEscape: (callback: (payload: { workspaceId: string }) => void) => {
    const handler = (_event: IpcRendererEvent, payload: { workspaceId: string }) => callback(payload);
    ipcRenderer.on(ANNOTATION_ESCAPE, handler);
    return () => ipcRenderer.removeListener(ANNOTATION_ESCAPE, handler);
  },
  onAnnotationStateChanged: (callback: (payload: {
    enabled: boolean;
    initialized: boolean;
    workspaceId: string | null;
  }) => void) => {
    const handler = (_event: IpcRendererEvent, payload: {
      enabled: boolean;
      initialized: boolean;
      workspaceId: string | null;
    }) => callback(payload);
    ipcRenderer.on(ANNOTATION_STATE_CHANGED, handler);
    return () => ipcRenderer.removeListener(ANNOTATION_STATE_CHANGED, handler);
  },
  // Annotation — trigger copy handles the full capture → format → clipboard pipeline
  annotationTriggerCopy: () => ipcRenderer.invoke(ANNOTATION_TRIGGER_COPY),
  annotationPrepareSend: () => ipcRenderer.invoke(ANNOTATION_PREPARE_SEND),

  // SSH Environments
  sshEnvironmentList: () => ipcRenderer.invoke(SSH_ENVIRONMENT_LIST),
  sshEnvironmentSave: (config: unknown) => ipcRenderer.invoke(SSH_ENVIRONMENT_SAVE, config),
  sshEnvironmentDelete: (id: string) => ipcRenderer.invoke(SSH_ENVIRONMENT_DELETE, id),
  sshEnvironmentTest: (target: string) => ipcRenderer.invoke(SSH_ENVIRONMENT_TEST, target),
  sshGetHomeDirectory: (environmentId: string) => ipcRenderer.invoke(SSH_GET_HOME_DIRECTORY, environmentId),
  sshListDirectories: (environmentId: string, directoryPath: string) => ipcRenderer.invoke(SSH_LIST_DIRECTORIES, environmentId, directoryPath),
  sshCreateDirectory: (environmentId: string, parentPath: string, name: string) =>
    ipcRenderer.invoke(SSH_CREATE_DIRECTORY, environmentId, parentPath, name),
  getEnvironmentHarnessOptions: (environmentId: string) => ipcRenderer.invoke(GET_ENVIRONMENT_HARNESS_OPTIONS, environmentId),
  getEnvironmentHarnessModels: (environmentId: string, harnessId: string) => ipcRenderer.invoke(GET_ENVIRONMENT_HARNESS_MODELS, environmentId, harnessId),
});
