import type { Pane, Terminal, WorkspaceTab } from '../../src/renderer/store/workspaceTypes';

export function createTerminalFixture(overrides: Partial<Terminal> = {}): Terminal {
  return {
    id: 'terminal-1',
    pid: 1001,
    workingDir: '/workspace',
    ...overrides,
  };
}

export function createPaneFixture(overrides: Partial<Pane> = {}): Pane {
  return {
    id: 'pane-1',
    terminalId: 'terminal-1',
    position: { x: 0, y: 0, w: 6, h: 6 },
    locked: false,
    ...overrides,
  };
}

export function createWorkspaceFixture(overrides: Partial<WorkspaceTab> = {}): WorkspaceTab {
  const terminal = createTerminalFixture();
  const pane = createPaneFixture({ terminalId: terminal.id });

  return {
    id: 'workspace-1',
    name: 'workspace',
    workspacePath: '/workspace',
    harness: 'codex',
    model: '',
    terminals: [terminal],
    panes: [pane],
    browserVisible: false,
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
    ...overrides,
  };
}
