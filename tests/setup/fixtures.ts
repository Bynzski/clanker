import type { BrowserPaneState, BrowserTab, Pane, Terminal, WorkspaceTab } from '../../src/renderer/store/workspaceTypes';
import {
  DEFAULT_NEW_TAB_URL,
  DEFAULT_RUNTIME_STATE,
} from '../../src/renderer/store/workspaceStoreHelpers';

export function createTerminalFixture(overrides: Partial<Terminal> = {}): Terminal {
  return {
    id: 'terminal-1',
    pid: 1001,
    workingDir: '/workspace',
    ...overrides,
  };
}

export function createBrowserTabFixture(overrides: Partial<BrowserTab> = {}): BrowserTab {
  return {
    id: 'browser-tab-1',
    url: DEFAULT_NEW_TAB_URL,
    title: '',
    canGoBack: false,
    canGoForward: false,
    ...overrides,
  };
}

/**
 * Build a valid browser pane fixture with at least one tab and a matching activeTabId.
 * Use this in tests that need a non-null browserPane.
 */
export function createBrowserPaneFixture(overrides: Partial<BrowserPaneState> = {}): BrowserPaneState {
  const tab = createBrowserTabFixture();
  return {
    id: 'browser-pane-1',
    position: { x: 0, y: 0, w: 6, h: 6 },
    tabs: [tab],
    activeTabId: tab.id,
    ...overrides,
  };
}

export function createPaneFixture(overrides: Partial<Pane> = {}): Pane {
  return {
    id: 'pane-1',
    terminalId: 'terminal-1',
    position: { x: 0, y: 0, w: 6, h: 6 },
    ...overrides,
  };
}

/**
 * Create a workspace fixture. runtimeState is always included with safe defaults.
 * Omitting runtimeState from overrides simulates an older persisted workspace —
 * sanitizeWorkspace will backfill it.
 */
export function createWorkspaceFixture(overrides: Partial<WorkspaceTab> = {}): WorkspaceTab {
  const terminal = createTerminalFixture();
  const pane = createPaneFixture({ terminalId: terminal.id });

  return {
    id: 'workspace-1',
    lifecycle: 'active',
    name: 'workspace',
    workspacePath: '/workspace',
    harness: 'codex',
    model: '',
    terminals: [terminal],
    panes: [pane],
    browserVisible: false,
    browserOverlayCount: 0,
    browserUrl: 'https://github.com',
    activeTerminalId: terminal.id,
    browserPane: null,
    layoutRoot: null,
    explorerVisible: false,
    explorerSidebarWidth: 280,
    explorerExpandedPaths: [],
    explorerSelectedPath: null,
    explorerEntriesByPath: {},
    explorerLoadingPaths: [],
    explorerErrorsByPath: {},
    showHiddenFiles: true,
    editorPane: null,
    editorVisible: false,
    editorTabs: [],
    activeEditorTabId: null,
    gitChanges: [],
    gitCurrentBranch: null,
    gitIsRepo: false,
    gitIsDetached: false,
    runtimeState: { ...DEFAULT_RUNTIME_STATE },
    ...overrides,
  };
}
