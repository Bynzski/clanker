import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { fileURLToPath } from 'node:url';
import type { FileListDirectoryRequest } from '../shared/types/fileExplorer';
import type { FileReadRequest, FileWriteRequest, FileChangedEvent, FileWatchRequest } from '../shared/types/editor';
import type { FileCreateRequest, FileDeleteRequest, FileRenameRequest } from '../shared/types/fileOperations';
import type { ExplorerTreeChangedEvent } from '../shared/types/fileExplorer';
import type { HarnessDefaultsMap } from '../shared/types/store';
import type { VcsProvider } from '../shared/types/vcs';
import type { GitStatusResult } from '../shared/types/git';
import type { HarnessSession } from '../shared/types/session';
import {
  GET_LAST_WORKSPACE,
  OPEN_DIRECTORY_DIALOG,
  READ_DIRECTORY,
  FILE_LIST_DIRECTORY,
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
  GET_SHOW_FASTFETCH,
  SET_SHOW_FASTFETCH,
  GET_AI_COMMIT_SETTINGS,
  SET_AI_COMMIT_ENABLED,
  SET_AI_COMMIT_PROVIDER,
  SET_AI_COMMIT_MODEL,
  SPAWN_TERMINAL,
  GET_TERMINAL_BUFFER,
  WRITE_TERMINAL,
  RESIZE_TERMINAL,
  KILL_TERMINAL,
  TERMINAL_CLEANUP_WORKSPACE,
  TERMINAL_DATA,
  TERMINAL_EXIT,
  TERMINAL_RESIZED,
  TERMINAL_READY,
  WRITE_CLIPBOARD,
  BROWSER_HIDE,
  BROWSER_SET_BOUNDS,
  BROWSER_NAVIGATE,
  BROWSER_BACK,
  BROWSER_FORWARD,
  BROWSER_REFRESH,
  BROWSER_STOP,
  OPEN_EXTERNAL,
  CAN_GO_BACK,
  CAN_GO_FORWARD,
  BROWSER_DISPOSE_WORKSPACE,
  BROWSER_URL_UPDATED,
  FIT_ALL_PANES,
  MINIMIZE_WINDOW,
  TOGGLE_MAXIMIZE_WINDOW,
  CLOSE_WINDOW,
  IS_MAXIMIZED_WINDOW,
  ZOOM_IN_WINDOW,
  ZOOM_OUT_WINDOW,
  RESET_ZOOM_WINDOW,
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
  ANNOTATION_TRIGGER_COPY,
  SESSION_DISCOVER,
  SESSION_INVOKE,
} from '../shared/ipcChannels';

contextBridge.exposeInMainWorld('electronAPI', {
  // Workspace
  getLastWorkspace: () => ipcRenderer.invoke(GET_LAST_WORKSPACE),
  openDirectoryDialog: () => ipcRenderer.invoke(OPEN_DIRECTORY_DIALOG),
  readDirectory: (path: string) => ipcRenderer.invoke(READ_DIRECTORY, path),
  fileListDirectory: (request: FileListDirectoryRequest) =>
    ipcRenderer.invoke(FILE_LIST_DIRECTORY, request),

  // Settings
  getShowFastfetch: () => ipcRenderer.invoke(GET_SHOW_FASTFETCH),
  setShowFastfetch: (show: boolean) => ipcRenderer.invoke(SET_SHOW_FASTFETCH, show),
  getAiCommitSettings: () => ipcRenderer.invoke(GET_AI_COMMIT_SETTINGS),
  setAiCommitEnabled: (enabled: boolean) => ipcRenderer.invoke(SET_AI_COMMIT_ENABLED, enabled),
  setAiCommitProvider: (provider: string) => ipcRenderer.invoke(SET_AI_COMMIT_PROVIDER, provider),
  setAiCommitModel: (model: string) => ipcRenderer.invoke(SET_AI_COMMIT_MODEL, model),

  // Terminal
  spawnTerminal: (workingDir: string, harness?: string, model?: string) =>
    ipcRenderer.invoke(SPAWN_TERMINAL, workingDir, harness, model),
  getTerminalBuffer: (id: string) => ipcRenderer.invoke(GET_TERMINAL_BUFFER, id),
  writeTerminal: (id: string, data: string) => ipcRenderer.invoke(WRITE_TERMINAL, { id, data }),
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
  browserHide: (workspaceId: string) => ipcRenderer.invoke(BROWSER_HIDE, workspaceId),
  browserSetBounds: (workspaceId: string, bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke(BROWSER_SET_BOUNDS, workspaceId, bounds),
  browserNavigate: (workspaceId: string, url: string) => ipcRenderer.invoke(BROWSER_NAVIGATE, workspaceId, url),
  browserBack: (workspaceId: string) => ipcRenderer.invoke(BROWSER_BACK, workspaceId),
  browserForward: (workspaceId: string) => ipcRenderer.invoke(BROWSER_FORWARD, workspaceId),
  browserRefresh: (workspaceId: string) => ipcRenderer.invoke(BROWSER_REFRESH, workspaceId),
  browserStop: (workspaceId: string) => ipcRenderer.invoke(BROWSER_STOP, workspaceId),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL, url),
  revealInFileManager: (filePath: string) => ipcRenderer.invoke(REVEAL_IN_FILE_MANAGER, filePath),
  canGoBack: (workspaceId: string) => ipcRenderer.invoke(CAN_GO_BACK, workspaceId),
  canGoForward: (workspaceId: string) => ipcRenderer.invoke(CAN_GO_FORWARD, workspaceId),
  browserDisposeWorkspace: (workspaceId: string) => ipcRenderer.invoke(BROWSER_DISPOSE_WORKSPACE, workspaceId),
  onBrowserUrlUpdated: (callback: (payload: { workspaceId: string; url: string }) => void) => {
    const handler = (_event: IpcRendererEvent, payload: { workspaceId: string; url: string }) => callback(payload);
    ipcRenderer.on(BROWSER_URL_UPDATED, handler);
    return () => ipcRenderer.removeListener(BROWSER_URL_UPDATED, handler);
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

  // Harness
  getHarnessOptions: () => ipcRenderer.invoke(GET_HARNESS_OPTIONS),
  getHarnessModels: (harness: string) => ipcRenderer.invoke(GET_HARNESS_MODELS, harness),
  getHarnessDefaults: () => ipcRenderer.invoke(GET_HARNESS_DEFAULTS),
  setHarnessDefaults: (defaults: HarnessDefaultsMap) =>
    ipcRenderer.invoke(SET_HARNESS_DEFAULTS, defaults),

  // Git operations - managed by GitService in main process
  gitStartPolling: (workspacePath: string) => ipcRenderer.invoke(GIT_START_POLLING, workspacePath),
  gitStopPolling: () => ipcRenderer.invoke(GIT_STOP_POLLING),
  generateCommitMessage: (workspacePath: string) => ipcRenderer.invoke(GENERATE_COMMIT_MESSAGE, workspacePath),
  gitStage: (workspacePath: string, files?: string[]) => ipcRenderer.invoke(GIT_STAGE, workspacePath, files),
  gitUnstage: (workspacePath: string, files?: string[]) => ipcRenderer.invoke(GIT_UNSTAGE, workspacePath, files),
  gitCommit: (workspacePath: string, message: string) => ipcRenderer.invoke(GIT_COMMIT, workspacePath, message),
  gitGetBranchState: (workspacePath: string) => ipcRenderer.invoke(GIT_GET_BRANCH_STATE, workspacePath),
  gitGetOperationState: (workspacePath: string) => ipcRenderer.invoke(GIT_GET_OPERATION_STATE, workspacePath),
  gitGetStashes: (workspacePath: string) => ipcRenderer.invoke(GIT_GET_STASHES, workspacePath),
  gitGetHistory: (workspacePath: string, limit?: number) => ipcRenderer.invoke(GIT_GET_HISTORY, workspacePath, limit),
  gitGetDiff: (
    workspacePath: string,
    mode: 'working' | 'staged' | 'commit',
    ref?: string
  ) => ipcRenderer.invoke(GIT_GET_DIFF, workspacePath, mode, ref),
  gitGetFileDiff: (
    workspacePath: string,
    filePath: string,
    mode: 'working' | 'staged'
  ) => ipcRenderer.invoke(GIT_GET_FILE_DIFF, workspacePath, filePath, mode),
  gitCreateBranch: (workspacePath: string, name: string, baseBranch?: string) =>
    ipcRenderer.invoke(GIT_CREATE_BRANCH, workspacePath, name, baseBranch),
  gitSwitchBranch: (workspacePath: string, name: string) => ipcRenderer.invoke(GIT_SWITCH_BRANCH, workspacePath, name),
  gitDeleteBranch: (workspacePath: string, name: string) => ipcRenderer.invoke(GIT_DELETE_BRANCH, workspacePath, name),
  gitForceDeleteBranch: (workspacePath: string, name: string) =>
    ipcRenderer.invoke(GIT_FORCE_DELETE_BRANCH, workspacePath, name),
  gitMergeBranch: (workspacePath: string, branchName: string) => ipcRenderer.invoke(GIT_MERGE_BRANCH, workspacePath, branchName),
  gitAbortOperation: (workspacePath: string) => ipcRenderer.invoke(GIT_ABORT_OPERATION, workspacePath),
  gitStash: (workspacePath: string, message?: string, includeUntracked?: boolean) =>
    ipcRenderer.invoke(GIT_STASH, workspacePath, message, includeUntracked),
  gitApplyStash: (workspacePath: string, stashRef: string) => ipcRenderer.invoke(GIT_APPLY_STASH, workspacePath, stashRef),
  gitPopStash: (workspacePath: string, stashRef: string) => ipcRenderer.invoke(GIT_POP_STASH, workspacePath, stashRef),
  gitDropStash: (workspacePath: string, stashRef: string) => ipcRenderer.invoke(GIT_DROP_STASH, workspacePath, stashRef),
  gitClearStashes: (workspacePath: string) => ipcRenderer.invoke(GIT_CLEAR_STASHES, workspacePath),
  gitRefresh: () => ipcRenderer.invoke(GIT_REFRESH),
  gitInit: (workspacePath: string, defaultBranch?: string) =>
    ipcRenderer.invoke(GIT_INIT, workspacePath, defaultBranch),
  gitGetRemotes: (workspacePath: string) => ipcRenderer.invoke(GIT_GET_REMOTES, workspacePath),
  gitAddRemote: (workspacePath: string, name: string, url: string) =>
    ipcRenderer.invoke(GIT_ADD_REMOTE, workspacePath, name, url),
  gitRemoveRemote: (workspacePath: string, name: string) =>
    ipcRenderer.invoke(GIT_REMOVE_REMOTE, workspacePath, name),
  gitRenameRemote: (workspacePath: string, oldName: string, newName: string) =>
    ipcRenderer.invoke(GIT_RENAME_REMOTE, workspacePath, oldName, newName),
  gitFetch: (workspacePath: string, remote?: string) => ipcRenderer.invoke(GIT_FETCH, workspacePath, remote),
  gitPull: (workspacePath: string, rebase?: boolean) => ipcRenderer.invoke(GIT_PULL, workspacePath, rebase),
  gitPush: (
    workspacePath: string,
    remote?: string,
    branch?: string,
    forceWithLease?: boolean,
    setUpstream?: boolean
  ) => ipcRenderer.invoke(GIT_PUSH, workspacePath, remote, branch, forceWithLease, setUpstream),
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
  vcsGetContext: (workspacePath: string) => ipcRenderer.invoke(VCS_GET_CONTEXT, workspacePath),
  vcsGetPrInfo: (workspacePath: string) => ipcRenderer.invoke(VCS_GET_PR_INFO, workspacePath),
  vcsGetDeepLinks: (workspacePath: string, prNumber?: number) => ipcRenderer.invoke(VCS_GET_DEEP_LINKS, workspacePath, prNumber),
  vcsGetDeepLink: (workspacePath: string, type: string) => ipcRenderer.invoke(VCS_GET_DEEP_LINK, workspacePath, type),
  vcsOpenDeepLink: (workspacePath: string, type: string) => ipcRenderer.invoke(VCS_OPEN_DEEP_LINK, workspacePath, type),

  // Editor
  editorReadFile: (request: FileReadRequest) => ipcRenderer.invoke(FILE_READ, request),
  editorWriteFile: (request: FileWriteRequest) => ipcRenderer.invoke(FILE_WRITE, request),
  editorWatchFile: (request: FileWatchRequest) => ipcRenderer.invoke(FILE_WATCH, request),
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
  explorerStartWatching: (workspacePath: string) =>
    ipcRenderer.invoke(EXPLORER_START_WATCHING, workspacePath),
  explorerStopWatching: () =>
    ipcRenderer.invoke(EXPLORER_STOP_WATCHING),

  // Session history
  discoverSessions: (workspacePath: string) =>
    ipcRenderer.invoke(SESSION_DISCOVER, workspacePath),
  invokeSession: (session: HarnessSession, fork?: boolean) =>
    ipcRenderer.invoke(SESSION_INVOKE, session, fork),

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
  // Annotation — trigger copy handles the full capture → format → clipboard pipeline
  annotationTriggerCopy: () => ipcRenderer.invoke(ANNOTATION_TRIGGER_COPY),
});
