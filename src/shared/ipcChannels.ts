/**
 * IPC Channel Name Constants
 *
 * Canonical source of truth for all IPC channel names used between main and renderer.
 * Using constants prevents silent failures from typos.
 *
 * Note: These are string channels registered with ipcMain.handle() in the main process
 * and invoked via ipcRenderer.invoke() in the preload bridge.
 */

/* ============================================================================
 * Settings
 * ============================================================================ */

export const GET_LAST_WORKSPACE = 'get-last-workspace';
export const GET_SHOW_FASTFETCH = 'get-show-fastfetch';
export const SET_SHOW_FASTFETCH = 'set-show-fastfetch';
export const GET_AI_COMMIT_SETTINGS = 'get-ai-commit-settings';
export const SET_AI_COMMIT_ENABLED = 'set-ai-commit-enabled';
export const SET_AI_COMMIT_PROVIDER = 'set-ai-commit-provider';
export const SET_AI_COMMIT_MODEL = 'set-ai-commit-model';
export const GENERATE_COMMIT_MESSAGE = 'generate-commit-message';
export const OPEN_DIRECTORY_DIALOG = 'open-directory-dialog';
export const READ_DIRECTORY = 'read-directory';
export const GET_HARNESS_OPTIONS = 'get-harness-options';
export const GET_HARNESS_MODELS = 'get-harness-models';

/* ============================================================================
 * Terminal
 * ============================================================================ */

export const SPAWN_TERMINAL = 'spawn-terminal';
export const GET_TERMINAL_BUFFER = 'get-terminal-buffer';
export const WRITE_TERMINAL = 'write-terminal';
export const RESIZE_TERMINAL = 'resize-terminal';
export const KILL_TERMINAL = 'kill-terminal';
export const TERMINAL_CLEANUP_WORKSPACE = 'terminal:cleanup-workspace';
export const TERMINAL_DATA = 'terminal-data';
export const TERMINAL_EXIT = 'terminal-exit';
export const WRITE_CLIPBOARD = 'write-clipboard';

/* ============================================================================
 * Browser
 * ============================================================================ */

export const BROWSER_SET_BOUNDS = 'browser-set-bounds';
export const BROWSER_HIDE = 'browser-hide';
export const BROWSER_NAVIGATE = 'browser-navigate';
export const BROWSER_BACK = 'browser-back';
export const BROWSER_FORWARD = 'browser-forward';
export const BROWSER_REFRESH = 'browser-refresh';
export const BROWSER_STOP = 'browser-stop';
export const BROWSER_DISPOSE_WORKSPACE = 'browser-dispose-workspace';
export const OPEN_EXTERNAL = 'open-external';
export const CAN_GO_BACK = 'can-go-back';
export const CAN_GO_FORWARD = 'can-go-forward';
export const BROWSER_URL_UPDATED = 'browser-url-updated';
export const FIT_ALL_PANES = 'fit-all-panes';

/* ============================================================================
 * Git
 * ============================================================================ */

export const GIT_START_POLLING = 'git-start-polling';
export const GIT_STOP_POLLING = 'git-stop-polling';
export const GIT_GET_BRANCH_STATE = 'git-get-branch-state';
export const GIT_GET_OPERATION_STATE = 'git-get-operation-state';
export const GIT_GET_STASHES = 'git-get-stashes';
export const GIT_GET_HISTORY = 'git-get-history';
export const GIT_GET_DIFF = 'git-get-diff';
export const GIT_STAGE = 'git-stage';
export const GIT_UNSTAGE = 'git-unstage';
export const GIT_COMMIT = 'git-commit';
export const GIT_CREATE_BRANCH = 'git-create-branch';
export const GIT_SWITCH_BRANCH = 'git-switch-branch';
export const GIT_DELETE_BRANCH = 'git-delete-branch';
export const GIT_FORCE_DELETE_BRANCH = 'git-force-delete-branch';
export const GIT_MERGE_BRANCH = 'git-merge-branch';
export const GIT_ABORT_OPERATION = 'git-abort-operation';
export const GIT_STASH = 'git-stash';
export const GIT_APPLY_STASH = 'git-apply-stash';
export const GIT_POP_STASH = 'git-pop-stash';
export const GIT_DROP_STASH = 'git-drop-stash';
export const GIT_CLEAR_STASHES = 'git-clear-stashes';
export const GIT_REFRESH = 'git-refresh';
export const GIT_INIT = 'git-init';
export const GIT_GET_REMOTES = 'git-get-remotes';
export const GIT_ADD_REMOTE = 'git-add-remote';
export const GIT_REMOVE_REMOTE = 'git-remove-remote';
export const GIT_RENAME_REMOTE = 'git-rename-remote';
export const GIT_FETCH = 'git-fetch';
export const GIT_PULL = 'git-pull';
export const GIT_PUSH = 'git-push';
export const GIT_STATUS_UPDATE = 'git-status-update';

/* ============================================================================
 * Window controls
 * ============================================================================ */

export const MINIMIZE_WINDOW = 'minimize-window';
export const TOGGLE_MAXIMIZE_WINDOW = 'toggle-maximize-window';
export const CLOSE_WINDOW = 'close-window';
export const IS_MAXIMIZED_WINDOW = 'is-maximized-window';

/* ============================================================================
 * Credentials
 * ============================================================================ */

export const CREDENTIAL_GENERATE_SSH_KEY = 'credential:generate-ssh-key';
export const CREDENTIAL_GET_PUBLIC_KEY = 'credential:get-public-key';
export const CREDENTIAL_DELETE_SSH_KEY = 'credential:delete-ssh-key';
export const CREDENTIAL_CHECK_EXISTS = 'credential:check-exists';
export const CREDENTIAL_SAVE_PAT = 'credential:save-pat';
export const CREDENTIAL_GET_PAT = 'credential:get-pat';
export const CREDENTIAL_DELETE_PAT = 'credential:delete-pat';
export const CREDENTIAL_GET_STATUS = 'credential:get-status';
export const CREDENTIAL_GET_GLOBAL_STATUS = 'credential:get-global-status';
export const CREDENTIAL_CONFIGURE_SSH_HOST = 'credential:configure-ssh-host';

/* ============================================================================
 * VCS
 * ============================================================================ */

export const VCS_GET_CONTEXT = 'vcs:get-context';
export const VCS_GET_PR_INFO = 'vcs:get-pr-info';
export const VCS_GET_DEEP_LINKS = 'vcs:get-deep-links';
export const VCS_GET_DEEP_LINK = 'vcs:get-deep-link';
export const VCS_OPEN_DEEP_LINK = 'vcs:open-deep-link';

/* ============================================================================
 * Canonical list (used by integration test to verify all channels registered)
 * ============================================================================ */

/**
 * All IPC channel names used in the application.
 * Must be kept in sync with the actual registrations in ipc/ modules.
 */
export const ALL_IPC_CHANNELS: readonly string[] = [
  // Settings
  GET_LAST_WORKSPACE,
  GET_SHOW_FASTFETCH,
  SET_SHOW_FASTFETCH,
  GET_AI_COMMIT_SETTINGS,
  SET_AI_COMMIT_ENABLED,
  SET_AI_COMMIT_PROVIDER,
  SET_AI_COMMIT_MODEL,
  GENERATE_COMMIT_MESSAGE,
  OPEN_DIRECTORY_DIALOG,
  READ_DIRECTORY,
  GET_HARNESS_OPTIONS,
  GET_HARNESS_MODELS,
  // Terminal
  SPAWN_TERMINAL,
  GET_TERMINAL_BUFFER,
  WRITE_TERMINAL,
  RESIZE_TERMINAL,
  KILL_TERMINAL,
  TERMINAL_CLEANUP_WORKSPACE,
  WRITE_CLIPBOARD,
  // Browser
  BROWSER_SET_BOUNDS,
  BROWSER_HIDE,
  BROWSER_NAVIGATE,
  BROWSER_BACK,
  BROWSER_FORWARD,
  BROWSER_REFRESH,
  BROWSER_STOP,
  BROWSER_DISPOSE_WORKSPACE,
  OPEN_EXTERNAL,
  CAN_GO_BACK,
  CAN_GO_FORWARD,
  // Window controls
  MINIMIZE_WINDOW,
  TOGGLE_MAXIMIZE_WINDOW,
  CLOSE_WINDOW,
  IS_MAXIMIZED_WINDOW,
  // Git
  GIT_START_POLLING,
  GIT_STOP_POLLING,
  GIT_GET_BRANCH_STATE,
  GIT_GET_OPERATION_STATE,
  GIT_GET_STASHES,
  GIT_GET_HISTORY,
  GIT_GET_DIFF,
  GIT_STAGE,
  GIT_UNSTAGE,
  GIT_COMMIT,
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
  // Event channels (main -> renderer, registered via ipcMain.on or webContents.send)
  TERMINAL_DATA,
  TERMINAL_EXIT,
  BROWSER_URL_UPDATED,
  FIT_ALL_PANES,
  GIT_STATUS_UPDATE,
  // Credentials
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
  // VCS
  VCS_GET_CONTEXT,
  VCS_GET_PR_INFO,
  VCS_GET_DEEP_LINKS,
  VCS_GET_DEEP_LINK,
  VCS_OPEN_DEEP_LINK,
];
