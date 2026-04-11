import type {
  BrowserPaneState,
  EditorPaneState,
  EditorTab,
  GridViewport,
  LayoutNode,
  Pane,
  PanePosition,
  Terminal,
  WorkspaceTab,
} from './workspaceTypes';
import type { GitStatus } from '../components/git/types';
import type { FileExplorerEntry } from '../../shared/types/fileExplorer';

/**
 * Workspace state for the active workspace and the collection of all workspaces.
 *
 * @invariant activeWorkspaceId === null - workspaces.length === 0
 *   When no workspaces exist, nothing can be active.
 *
 * @invariant activeWorkspaceId !== null -> workspaces.some(w => w.id === activeWorkspaceId)
 *   The active workspace ID always references an existing workspace.
 *
 * @invariant activeTerminalId === null - terminals.length === 0
 *   When no terminals exist, no terminal can be active.
 *
 * @invariant activeTerminalId !== null -> terminals.some(t => t.id === activeTerminalId)
 *   The active terminal ID always references an existing terminal.
 *
 * @invariant layoutRoot === null - panes.length === 0 && !browserVisible && !editorVisible
 *   The layout tree only exists when there are visible panes.
 *
 * @invariant layoutRoot !== null -> all pane IDs in layoutRoot exist in
 *   panes[].id ∪ {browserPane?.id} ∪ {editorPane?.id}
 *   The layout tree only references valid pane IDs.
 *
 * @invariant activeEditorTabId === null - editorTabs.length === 0
 *   When no editor tabs are open, no tab can be active.
 *
 * @invariant activeEditorTabId !== null -> editorTabs.some(t => t.id === activeEditorTabId)
 *   The active editor tab ID always references an existing tab.
 */
export interface WorkspaceState {
  name: string;
  workspacePath: string;
  harness: string;
  model: string;
  terminals: Terminal[];
  panes: Pane[];
  browserVisible: boolean;
  browserOverlayCount: number;
  browserUrl: string;
  /** @invariant null - terminals.length === 0 */
  activeTerminalId: string | null;
  browserPane: BrowserPaneState | null;
  /** @invariant null - panes.length === 0 && !browserVisible && !editorVisible */
  layoutRoot: LayoutNode | null;
  explorerVisible: boolean;
  explorerSidebarWidth: number;
  explorerExpandedPaths: string[];
  explorerSelectedPath: string | null;
  explorerEntriesByPath: Record<string, FileExplorerEntry[] | undefined>;
  explorerLoadingPaths: string[];
  explorerErrorsByPath: Record<string, string | null | undefined>;
  showHiddenFiles: boolean;
  gitChanges: GitStatus[];
  workspaces: WorkspaceTab[];
  /** @invariant null - workspaces.length === 0 */
  activeWorkspaceId: string | null;
  gridViewport: GridViewport;
  layoutRevision: number;

  editorVisible: boolean;
  editorPane: EditorPaneState | null;
  editorTabs: EditorTab[];
  /** @invariant null - editorTabs.length === 0 */
  activeEditorTabId: string | null;

  addWorkspace: (workspace: Omit<WorkspaceTab, 'id'>) => void;
  selectWorkspace: (id: string) => void;
  closeWorkspace: (id: string) => void;
  updateWorkspaceName: (id: string, name: string) => void;

  setWorkspacePath: (path: string) => void;
  setHarness: (harness: string) => void;
  setModel: (model: string) => void;
  addTerminal: (terminal: Terminal) => void;
  removeTerminal: (id: string) => void;
  setActiveTerminal: (id: string) => void;
  toggleBrowser: () => void;
  pushBrowserOverlay: () => void;
  popBrowserOverlay: () => void;
  setBrowserUrl: (url: string) => void;
  updateWorkspaceBrowserUrl: (workspaceId: string, url: string) => void;
  clearTerminals: () => void;
  setExplorerVisible: (visible: boolean) => void;
  setExplorerSidebarWidth: (width: number) => void;
  toggleExplorerPath: (path: string) => void;
  setExplorerExpandedPaths: (paths: string[]) => void;
  clearExplorerDirectoryState: (paths: string[]) => void;
  setExplorerSelectedPath: (path: string | null) => void;
  setExplorerDirectoryEntries: (directoryPath: string, entries: FileExplorerEntry[]) => void;
  setExplorerDirectoryLoading: (directoryPath: string, loading: boolean) => void;
  setExplorerDirectoryError: (directoryPath: string, error: string | null) => void;
  resetExplorerState: () => void;
  setShowHiddenFiles: (show: boolean) => void;
  setGitChanges: (changes: GitStatus[]) => void;

  setPanes: (panes: Pane[]) => void;
  addPane: (terminalId: string | null, position?: PanePosition) => void;
  removePane: (paneId: string) => void;
  updatePanePosition: (paneId: string, position: PanePosition) => void;
  updateAllPanePositions: (positions: Array<{ id: string; position: PanePosition }>) => void;
  updateBrowserPosition: (position: PanePosition) => void;
  setGridViewport: (viewport: GridViewport) => void;
  resetLayout: () => void;
  fitAllPanes: () => void;
  bringPaneIntoView: (paneId: string) => void;
  bringBrowserIntoView: () => void;
  togglePaneLock: (paneId: string) => void;
  toggleBrowserLock: () => void;
  swapPanes: (a: string, b: string) => void;
  dockPaneToEdge: (paneId: string, edge: 'left' | 'right' | 'top' | 'bottom') => void;
  setSplitRatio: (nodeId: string, ratio: number) => void;
  canAddPane: () => boolean;

  openFileInEditor: (filePath: string) => Promise<void>;
  closeEditorTab: (tabId: string) => void;
  setActiveEditorTab: (tabId: string) => void;
  updateEditorContent: (tabId: string, content: string) => void;
  saveEditorFile: (tabId: string) => Promise<boolean>;
  saveAllEditorFiles: () => Promise<void>;
  toggleEditorPane: () => void;
  closeEditorPane: () => void;
  toggleEditorLock: () => void;
  bringEditorIntoView: () => void;
  resetEditorState: () => void;
  renameEditorTabPath: (oldPath: string, newPath: string) => void;
  reloadEditorTab: (tabId: string) => Promise<void>;
  markEditorTabExternallyChanged: (tabId: string) => void;
  markEditorTabDeleted: (tabId: string) => void;
  clearEditorTabExternalFlag: (tabId: string) => void;

  /** Tracks in-flight async editor operations keyed by file path to prevent races. */
  pendingEditorOperations: Record<string, string>;
}

export type ActiveWorkspaceSnapshot = Pick<
  WorkspaceState,
  | 'name'
  | 'workspacePath'
  | 'harness'
  | 'model'
  | 'terminals'
  | 'panes'
  | 'browserVisible'
  | 'browserUrl'
  | 'activeTerminalId'
  | 'browserPane'
  | 'layoutRoot'
  | 'explorerVisible'
  | 'explorerSidebarWidth'
  | 'explorerExpandedPaths'
  | 'explorerSelectedPath'
  | 'explorerEntriesByPath'
  | 'explorerLoadingPaths'
  | 'explorerErrorsByPath'
  | 'showHiddenFiles'
  | 'gitChanges'
  | 'editorVisible'
  | 'editorPane'
  | 'editorTabs'
  | 'activeEditorTabId'
>;

export interface PendingEditorOperationsHolder {
  pendingEditorOperations: Record<string, string>;
}

