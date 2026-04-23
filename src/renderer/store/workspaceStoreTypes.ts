import type {
  BrowserPaneState,
  EditorPaneState,
  EditorTab,
  GridViewport,
  LayoutNode,
  Pane,
  PanePosition,
  Terminal,
  WorkspaceResourcePolicy,
  WorkspaceResidencyState,
  WorkspaceLifecycleState,
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
 * @invariant workspaces.length > 0 -> workspaces.filter(w => w.lifecycle === 'active').length === 1
 *   Exactly one workspace must be marked active in lifecycle state.
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
  gitCurrentBranch: string | null;
  gitIsRepo: boolean;
  gitIsDetached: boolean;
  workspaces: WorkspaceTab[];
  /** @invariant null - workspaces.length === 0 */
  activeWorkspaceId: string | null;
  /** @invariant workspaces.length > 0 -> exactly one workspace.lifecycle === 'active' */
  activeWorkspaceLifecycle: WorkspaceLifecycleState | null;
  gridViewport: GridViewport;
  layoutRevision: number;

  editorVisible: boolean;
  editorPane: EditorPaneState | null;
  editorTabs: EditorTab[];
  /** @invariant null - editorTabs.length === 0 */
  activeEditorTabId: string | null;

  addWorkspace: (workspace: Omit<WorkspaceTab, 'id' | 'lifecycle'>) => void;
  selectWorkspace: (id: string) => void;
  closeWorkspace: (id: string) => void;
  updateWorkspaceName: (id: string, name: string) => void;
  getWorkspaceById: (id: string | null) => WorkspaceTab | null;
  getActiveWorkspace: () => WorkspaceTab | null;
  isWorkspaceActive: (id: string) => boolean;
  /** Returns true when the active workspace is warm (surface residency is active). */
  isWorkspaceWarm: (workspaceId?: string) => boolean;
  /** Returns the resource policy for a workspace by id, or null if not found. */
  getWorkspaceResourcePolicy: (workspaceId: string) => WorkspaceResourcePolicy | null;
  /** Sets the residency state for a workspace by id. */
  setWorkspaceResidency: (workspaceId: string, residencyState: WorkspaceResidencyState) => void;
  /** Merges a partial resource policy into a workspace by id. */
  setWorkspaceResourcePolicy: (workspaceId: string, partialPolicy: Partial<WorkspaceResourcePolicy>) => void;

  setWorkspacePath: (path: string) => void;
  setHarness: (harness: string) => void;
  setModel: (model: string) => void;
  addTerminal: (terminal: Terminal) => void;
  removeTerminal: (id: string) => void;
  setActiveTerminal: (id: string) => void;
  toggleBrowser: () => void;
  pushBrowserOverlay: (workspaceId?: string) => void;
  popBrowserOverlay: (workspaceId?: string) => void;
  setBrowserUrl: (url: string, workspaceId?: string) => void;
  updateWorkspaceBrowserUrl: (workspaceId: string, url: string) => void;
  clearTerminals: () => void;
  setExplorerVisible: (visible: boolean, workspaceId?: string) => void;
  setExplorerSidebarWidth: (width: number, workspaceId?: string) => void;
  toggleExplorerPath: (path: string, workspaceId?: string) => void;
  setExplorerExpandedPaths: (paths: string[], workspaceId?: string) => void;
  clearExplorerDirectoryState: (paths: string[], workspaceId?: string) => void;
  setExplorerSelectedPath: (path: string | null, workspaceId?: string) => void;
  setExplorerDirectoryEntries: (directoryPath: string, entries: FileExplorerEntry[], workspaceId?: string) => void;
  setExplorerDirectoryLoading: (directoryPath: string, loading: boolean, workspaceId?: string) => void;
  setExplorerDirectoryError: (directoryPath: string, error: string | null, workspaceId?: string) => void;
  resetExplorerState: () => void;
  setShowHiddenFiles: (show: boolean, workspaceId?: string) => void;
  setGitChanges: (changes: GitStatus[]) => void;
  setGitBranchInfo: (branch: string | null, isRepo: boolean, isDetached: boolean) => void;

  setPanes: (panes: Pane[]) => void;
  addPane: (terminalId: string | null, position?: PanePosition) => void;
  removePane: (paneId: string) => void;
  updatePanePosition: (paneId: string, position: PanePosition) => void;
  updateAllPanePositions: (positions: Array<{ id: string; position: PanePosition }>) => void;
  updateBrowserPosition: (position: PanePosition) => void;
  setGridViewport: (viewport: GridViewport) => void;
  resetLayout: () => void;
  fitAllPanes: () => void;
  bringPaneIntoView: (paneId: string, workspaceId?: string) => void;
  bringBrowserIntoView: (workspaceId?: string) => void;
  togglePaneLock: (paneId: string, workspaceId?: string) => void;
  toggleBrowserLock: (workspaceId?: string) => void;
  swapPanes: (a: string, b: string, workspaceId?: string) => void;
  dockPaneToEdge: (paneId: string, edge: 'left' | 'right' | 'top' | 'bottom', workspaceId?: string) => void;
  insertPaneAtEdgeGap: (paneId: string, edge: 'left' | 'right' | 'top' | 'bottom', gapIndex: number, workspaceId?: string) => void;
  insertPaneAtEdgeSegment: (paneId: string, edge: 'left' | 'right' | 'top' | 'bottom', targetPaneId: string, workspaceId?: string) => void;
  setSplitRatio: (nodeId: string, ratio: number, workspaceId?: string) => void;
  canAddPane: () => boolean;

  openFileInEditor: (filePath: string, workspaceId?: string) => Promise<void>;
  closeEditorTab: (tabId: string, workspaceId?: string) => void;
  setActiveEditorTab: (tabId: string, workspaceId?: string) => void;
  updateEditorContent: (tabId: string, content: string, workspaceId?: string) => void;
  saveEditorFile: (tabId: string, workspaceId?: string) => Promise<boolean>;
  saveAllEditorFiles: () => Promise<void>;
  toggleEditorPane: () => void;
  closeEditorPane: (workspaceId?: string) => void;
  toggleEditorLock: (workspaceId?: string) => void;
  bringEditorIntoView: (workspaceId?: string) => void;
  resetEditorState: () => void;
  renameEditorTabPath: (oldPath: string, newPath: string, workspaceId?: string) => void;
  reloadEditorTab: (tabId: string, workspaceId?: string) => Promise<void>;
  markEditorTabExternallyChanged: (tabId: string, workspaceId?: string) => void;
  markEditorTabDeleted: (tabId: string, workspaceId?: string) => void;
  clearEditorTabExternalFlag: (tabId: string, workspaceId?: string) => void;

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
  | 'browserOverlayCount'
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
  | 'gitCurrentBranch'
  | 'gitIsRepo'
  | 'gitIsDetached'
  | 'editorVisible'
  | 'editorPane'
  | 'editorTabs'
  | 'activeEditorTabId'
>;

export interface PendingEditorOperationsHolder {
  pendingEditorOperations: Record<string, string>;
}
