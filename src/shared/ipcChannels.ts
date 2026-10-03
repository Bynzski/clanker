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

export const GET_APP_VERSION = 'get-app-version';
export const GET_LAST_WORKSPACE = 'get-last-workspace';
export const GET_BASE_DIRECTORY = 'get-base-directory';
export const OPEN_BASE_DIRECTORY_DIALOG = 'open-base-directory-dialog';
export const GET_AI_COMMIT_SETTINGS = 'get-ai-commit-settings';
export const SET_AI_COMMIT_ENABLED = 'set-ai-commit-enabled';
export const SET_AI_COMMIT_PROVIDER = 'set-ai-commit-provider';
export const SET_AI_COMMIT_MODEL = 'set-ai-commit-model';
export const GENERATE_COMMIT_MESSAGE = 'generate-commit-message';
export const OPEN_DIRECTORY_DIALOG = 'open-directory-dialog';
export const READ_DIRECTORY = 'read-directory';
export const FILE_LIST_DIRECTORY = 'file-list-directory';
export const REMOTE_FILES_WATCH = 'remote-files-watch';
export const REMOTE_FILES_CHANGED = 'remote-files-changed';
export const GET_HARNESS_OPTIONS = 'get-harness-options';
export const GET_HARNESS_MODELS = 'get-harness-models';
export const GET_HARNESS_DEFAULTS = 'get-harness-defaults';
export const SET_HARNESS_DEFAULTS = 'set-harness-defaults';
export const GET_THEME = 'get-theme';
export const SET_THEME = 'set-theme';
export const GET_WORKSPACE_NAVIGATION_MODE = 'get-workspace-navigation-mode';
export const SET_WORKSPACE_NAVIGATION_MODE = 'set-workspace-navigation-mode';
export const GET_KEYBINDING_OVERRIDES = 'get-keybinding-overrides';
export const SET_KEYBINDING_OVERRIDES = 'set-keybinding-overrides';

/* ============================================================================
 * Terminal
 * ============================================================================ */

export const SPAWN_TERMINAL = 'spawn-terminal';
export const GET_TERMINAL_BUFFER = 'get-terminal-buffer';
export const WRITE_TERMINAL = 'write-terminal';
export const GET_AGENT_HANDOFF_STATUSES = 'get-agent-handoff-statuses';
export const SEND_ANNOTATION_TO_AGENT = 'send-annotation-to-agent';
export const RESIZE_TERMINAL = 'resize-terminal';
export const KILL_TERMINAL = 'kill-terminal';
export const TERMINAL_CLEANUP_WORKSPACE = 'terminal:cleanup-workspace';
export const TERMINAL_DATA = 'terminal-data';
export const TERMINAL_EXIT = 'terminal-exit';
export const AGENT_ATTENTION_UPDATE = 'agent-attention-update';
export const TERMINAL_RESIZED = 'terminal-resized';
export const TERMINAL_READY = 'terminal-ready';
export const RECIPE_COMMAND_WAIT = 'recipe-command:wait';
export const WRITE_CLIPBOARD = 'write-clipboard';

/* ============================================================================
 * Browser
 * ============================================================================ */

export const REMOTE_PREVIEW_WATCH = 'remote-preview:watch';
export const REMOTE_PREVIEW_GET = 'remote-preview:get';
export const REMOTE_PREVIEW_START = 'remote-preview:start';
export const REMOTE_PREVIEW_STOP = 'remote-preview:stop';
export const REMOTE_PREVIEW_CHANGED = 'remote-preview:changed';

export const BROWSER_SET_BOUNDS = 'browser-set-bounds';
export const BROWSER_HIDE = 'browser-hide';
export const BROWSER_NAVIGATE = 'browser-navigate';
export const RECIPE_PREVIEW_PROBE = 'recipe-preview:probe';
export const BROWSER_BACK = 'browser-back';
export const BROWSER_FORWARD = 'browser-forward';
export const BROWSER_REFRESH = 'browser-refresh';
export const BROWSER_STOP = 'browser-stop';
export const BROWSER_DISPOSE_WORKSPACE = 'browser-dispose-workspace';
export const OPEN_EXTERNAL = 'open-external';
export const REVEAL_IN_FILE_MANAGER = 'reveal-in-file-manager';
export const CAN_GO_BACK = 'can-go-back';
export const CAN_GO_FORWARD = 'can-go-forward';
export const BROWSER_URL_UPDATED = 'browser-url-updated';
export const BROWSER_GET_URL = 'browser-get-url';
export const BROWSER_SAVE_URL = 'browser-save-url';
export const BROWSER_CREATE_TAB = 'browser-create-tab';
export const BROWSER_CLOSE_TAB = 'browser-close-tab';
export const BROWSER_SWITCH_TAB = 'browser-switch-tab';
export const BROWSER_ACTIVATE = 'browser-activate';
export const BROWSER_MOVE_TAB = 'browser-move-tab';
export const BROWSER_GET_TABS = 'browser-get-tabs';
export const BROWSER_TAB_NAVIGATE = 'browser-tab-navigate';
export const BROWSER_HISTORY_ADD = 'browser-history-add';
export const BROWSER_HISTORY_GET = 'browser-history-get';
export const BROWSER_HISTORY_CLEAR = 'browser-history-clear';
export const FIT_ALL_PANES = 'fit-all-panes';
/** Main → renderer: a browser-context keybinding that renderer-owned tab/address state must run. */
export const BROWSER_KEYBINDING_COMMAND = 'browser-keybinding-command';

/* ============================================================================
 * Git
 * ============================================================================ */

export const GIT_START_POLLING = 'git-start-polling';
export const GIT_STOP_POLLING = 'git-stop-polling';
export const GIT_GET_BRANCH_STATE = 'git-get-branch-state';
export const GIT_LIST_WORKTREES = 'git-list-worktrees';
export const GIT_CREATE_WORKTREE = 'git-create-worktree';
export const GIT_INSPECT_WORKTREE = 'git-inspect-worktree';
export const GIT_REMOVE_WORKTREE = 'git-remove-worktree';
export const REGISTER_OPEN_WORKSPACE = 'register-open-workspace';
export const UNREGISTER_OPEN_WORKSPACE = 'unregister-open-workspace';
export const GIT_GET_OPERATION_STATE = 'git-get-operation-state';
export const GIT_GET_STASHES = 'git-get-stashes';
export const GIT_GET_HISTORY = 'git-get-history';
export const GIT_GET_DIFF = 'git-get-diff';
export const GIT_GET_FILE_DIFF = 'git-get-file-diff';
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
export const ZOOM_IN_WINDOW = 'zoom-in-window';
export const ZOOM_OUT_WINDOW = 'zoom-out-window';
export const RESET_ZOOM_WINDOW = 'reset-zoom-window';
export const WINDOW_READY_TO_SHOW = 'window-ready-to-show';

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
 * Explorer
 * ============================================================================ */

export const EXPLORER_TREE_CHANGED = 'explorer-tree-changed';
export const EXPLORER_START_WATCHING = 'explorer-start-watching';
export const EXPLORER_STOP_WATCHING = 'explorer-stop-watching';

/* ============================================================================
 * Editor
 * ============================================================================ */

export const FILE_READ = 'file-read';
export const FILE_WRITE = 'file-write';
export const FILE_CHANGED = 'file-changed';
export const FILE_WATCH = 'file-watch';
export const FILE_UNWATCH = 'file-unwatch';

/* ============================================================================
 * File Operations
 * ============================================================================ */

export const FILE_CREATE = 'file-create';
export const FILE_DELETE = 'file-delete';
export const FILE_RENAME = 'file-rename';

/* ============================================================================
 * Session History
 * ============================================================================ */

export const SESSION_DISCOVER = 'session-discover';
export const SESSION_INVOKE = 'session-invoke';

/* ============================================================================
 * Harness Usage
 * ============================================================================ */

export const HARNESS_USAGE_GET = 'harness-usage:get';

/* ============================================================================
 * Harness Accounts
 * ============================================================================ */

export const HARNESS_ACCOUNTS_LIST = 'harness-accounts:list';
export const HARNESS_ACCOUNTS_SELECT = 'harness-accounts:select';
export const HARNESS_ACCOUNTS_ADD_START = 'harness-accounts:add-start';
export const HARNESS_ACCOUNTS_RECONNECT = 'harness-accounts:reconnect';
export const HARNESS_ACCOUNTS_AUTH_CANCEL = 'harness-accounts:auth-cancel';
export const HARNESS_ACCOUNTS_REMOVE = 'harness-accounts:remove';
export const HARNESS_ACCOUNTS_RENAME = 'harness-accounts:rename';
/** Main -> renderer progress event, keyed by an opaque flow ID. */
export const HARNESS_ACCOUNTS_AUTH_STATE = 'harness-accounts:auth-state';

/* ============================================================================
 * Workspace Recipes
 * ============================================================================ */

export const RECIPE_GET_ALL = 'recipe:get-all';
export const RECIPE_SAVE = 'recipe:save';
export const RECIPE_DELETE = 'recipe:delete';

/* ============================================================================
 * SSH Environments
 * ============================================================================ */

export const SSH_ENVIRONMENT_LIST = 'ssh-environment:list';
export const SSH_ENVIRONMENT_SAVE = 'ssh-environment:save';
export const SSH_ENVIRONMENT_DELETE = 'ssh-environment:delete';
export const SSH_ENVIRONMENT_TEST = 'ssh-environment:test';
export const SSH_GET_HOME_DIRECTORY = 'ssh-environment:get-home-directory';
export const SSH_LIST_DIRECTORIES = 'ssh-environment:list-directories';
export const SSH_CREATE_DIRECTORY = 'ssh-environment:create-directory';
export const GET_ENVIRONMENT_HARNESS_OPTIONS = 'get-environment-harness-options';
export const GET_ENVIRONMENT_HARNESS_MODELS = 'get-environment-harness-models';
/* ============================================================================
 * Annotation
 * ============================================================================ */

export const ANNOTATION_ENABLE = 'annotation-enable';
export const ANNOTATION_DISABLE = 'annotation-disable';
export const ANNOTATION_CAPTURE = 'annotation-capture';
export const ANNOTATION_GET_STATE = 'annotation-get-state';
export const ANNOTATION_EXPORT = 'annotation-export';
export const ANNOTATION_CHECK_ESCAPED = 'annotation-check-escaped';
export const ANNOTATION_ESCAPE = 'annotation-escape';
export const ANNOTATION_STATE_CHANGED = 'annotation-state-changed';
export const ANNOTATION_TRIGGER_COPY = 'annotation-trigger-copy';
export const ANNOTATION_PREPARE_SEND = 'annotation-prepare-send';

/* ============================================================================
 * Canonical list (used by integration test to verify all channels registered)
 * ============================================================================ */

/**
 * All IPC channel names used in the application.
 * Must be kept in sync with the actual registrations in ipc/ modules.
 */
export const ALL_IPC_CHANNELS: readonly string[] = [
  // Settings
  GET_APP_VERSION,
  GET_LAST_WORKSPACE,
  GET_BASE_DIRECTORY,
  OPEN_BASE_DIRECTORY_DIALOG,
  GET_AI_COMMIT_SETTINGS,
  SET_AI_COMMIT_ENABLED,
  SET_AI_COMMIT_PROVIDER,
  SET_AI_COMMIT_MODEL,
  GENERATE_COMMIT_MESSAGE,
  OPEN_DIRECTORY_DIALOG,
  READ_DIRECTORY,
  FILE_LIST_DIRECTORY,
  GET_HARNESS_OPTIONS,
  GET_HARNESS_MODELS,
  GET_HARNESS_DEFAULTS,
  SET_HARNESS_DEFAULTS,
  GET_THEME,
  SET_THEME,
  GET_WORKSPACE_NAVIGATION_MODE,
  SET_WORKSPACE_NAVIGATION_MODE,
  GET_KEYBINDING_OVERRIDES,
  SET_KEYBINDING_OVERRIDES,
  // Terminal
  SPAWN_TERMINAL,
  GET_TERMINAL_BUFFER,
  WRITE_TERMINAL,
  GET_AGENT_HANDOFF_STATUSES,
  SEND_ANNOTATION_TO_AGENT,
  RESIZE_TERMINAL,
  KILL_TERMINAL,
  TERMINAL_CLEANUP_WORKSPACE,
  TERMINAL_READY,
  RECIPE_COMMAND_WAIT,
  WRITE_CLIPBOARD,
  // Browser
  REMOTE_PREVIEW_WATCH,
  REMOTE_PREVIEW_GET,
  REMOTE_PREVIEW_START,
  REMOTE_PREVIEW_STOP,
  BROWSER_SET_BOUNDS,
  BROWSER_HIDE,
  BROWSER_NAVIGATE,
  RECIPE_PREVIEW_PROBE,
  BROWSER_BACK,
  BROWSER_FORWARD,
  BROWSER_REFRESH,
  BROWSER_STOP,
  BROWSER_DISPOSE_WORKSPACE,
  OPEN_EXTERNAL,
  REVEAL_IN_FILE_MANAGER,
  CAN_GO_BACK,
  CAN_GO_FORWARD,
  BROWSER_GET_URL,
  BROWSER_SAVE_URL,
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
  // Window controls
  MINIMIZE_WINDOW,
  TOGGLE_MAXIMIZE_WINDOW,
  CLOSE_WINDOW,
  IS_MAXIMIZED_WINDOW,
  ZOOM_IN_WINDOW,
  ZOOM_OUT_WINDOW,
  RESET_ZOOM_WINDOW,
  WINDOW_READY_TO_SHOW,
  // Git
  GIT_START_POLLING,
  GIT_STOP_POLLING,
  GIT_GET_BRANCH_STATE,
  GIT_LIST_WORKTREES,
  GIT_CREATE_WORKTREE,
  GIT_INSPECT_WORKTREE,
  GIT_REMOVE_WORKTREE,
  REGISTER_OPEN_WORKSPACE,
  UNREGISTER_OPEN_WORKSPACE,
  GIT_GET_OPERATION_STATE,
  GIT_GET_STASHES,
  GIT_GET_HISTORY,
  GIT_GET_DIFF,
  GIT_GET_FILE_DIFF,
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
  TERMINAL_RESIZED,
  REMOTE_PREVIEW_CHANGED,
  BROWSER_URL_UPDATED,
  FIT_ALL_PANES,
  BROWSER_KEYBINDING_COMMAND,
  GIT_STATUS_UPDATE,
  EXPLORER_TREE_CHANGED,
  EXPLORER_START_WATCHING,
  EXPLORER_STOP_WATCHING,
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
  // Editor
  FILE_READ,
  FILE_WRITE,
  FILE_CHANGED,
  FILE_WATCH,
  FILE_UNWATCH,
  REMOTE_FILES_WATCH,
  REMOTE_FILES_CHANGED,
  // File Operations
  FILE_CREATE,
  FILE_DELETE,
  FILE_RENAME,
  // Annotation
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
  // Session history
  SESSION_DISCOVER,
  SESSION_INVOKE,
  // Harness usage
  HARNESS_USAGE_GET,
  HARNESS_ACCOUNTS_LIST,
  HARNESS_ACCOUNTS_SELECT,
  HARNESS_ACCOUNTS_ADD_START,
  HARNESS_ACCOUNTS_RECONNECT,
  HARNESS_ACCOUNTS_AUTH_CANCEL,
  HARNESS_ACCOUNTS_REMOVE,
  HARNESS_ACCOUNTS_RENAME,
  HARNESS_ACCOUNTS_AUTH_STATE,
  // Workspace Recipes
  RECIPE_GET_ALL,
  RECIPE_SAVE,
  RECIPE_DELETE,
  // SSH Environments
  SSH_ENVIRONMENT_LIST,
  SSH_ENVIRONMENT_SAVE,
  SSH_ENVIRONMENT_DELETE,
  SSH_ENVIRONMENT_TEST,
  SSH_GET_HOME_DIRECTORY,
  SSH_LIST_DIRECTORIES,
  SSH_CREATE_DIRECTORY,
  GET_ENVIRONMENT_HARNESS_OPTIONS,
  GET_ENVIRONMENT_HARNESS_MODELS,
];
