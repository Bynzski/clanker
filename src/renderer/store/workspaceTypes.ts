import type { FileExplorerEntry } from '../../shared/types/fileExplorer';
import type { GitStatus } from '../components/git/types';

export interface Terminal {
  id: string;
  pid: number;
  workingDir: string;
}

export interface PanePosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pane {
  id: string;
  terminalId: string | null;
  position?: PanePosition;
}

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowserPaneState {
  id: string;
  position: PanePosition;
  tabs: BrowserTab[];
  activeTabId: string | null;
}

export interface EditorPaneState {
  id: string;
}

export interface NotesPaneState {
  id: string;
}

export interface EditorTab {
  id: string;
  filePath: string;
  fileName: string;
  isDirty: boolean;
  content: string;
  originalContent: string;
  hasExternalChange?: boolean;
  isDeleted?: boolean;
}

export interface GridViewport {
  cols: number;
  rows: number;
}

export type WorkspaceLifecycleState = 'active' | 'parked';

/**
 * Runtime residency state for a workspace.
 *
 * residencyState governs whether the workspace's pane surfaces are kept
 * warm in memory. Resource policy gives fine-grained control per subsystem.
 *
 * @note 'closing' and 'errored' are reserved for future lifecycle phases.
 * New workspaces default to 'warm'.
 */
export type WorkspaceResidencyState = 'warm' | 'cold' | 'closing' | 'errored';

/**
 * Per-subsystem resource policy for a workspace.
 *
 * - 'warm': keep the subsystem state/instance alive across workspace switches
 * - 'cold': release subsystem resources when the workspace is not focused
 * - 'cached' (explorer only): keep directory contents cached but do not watch
 * - 'watching' (explorer only): keep directory contents cached and actively watch for changes
 *
 * @note Terminals default to 'warm' because PTY processes run in the main
 * process and are independent of React rendering. xtermCache + terminalSessionBridge
 * deliver output to cached xterm instances regardless of surface residency.
 */
export type ResourcePolicy = 'warm' | 'cold' | 'cached' | 'watching';

export interface WorkspaceResourcePolicy {
  terminals: 'warm' | 'cold';
  browser: 'warm' | 'cold';
  explorer: 'watching' | 'cached';
  editor: 'warm' | 'cold';
}

export interface WorkspaceRuntimeState {
  residencyState: WorkspaceResidencyState;
  resourcePolicy: WorkspaceResourcePolicy;
}

export type LayoutNode = LayoutLeaf | LayoutSplit;

export interface LayoutLeaf {
  type: 'leaf';
  nodeId: string;
  paneId: string;
}

export interface LayoutSplit {
  type: 'split';
  nodeId: string;
  orientation: 'horizontal' | 'vertical';
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
}

export interface WorkspaceTab {
  id: string;
  lifecycle: WorkspaceLifecycleState;
  name: string;
  workspacePath: string;
  harness: string;
  model: string;
  terminals: Terminal[];
  panes: Pane[];
  browserVisible: boolean;
  browserOverlayCount?: number;
  browserUrl: string;
  activeTerminalId: string | null;
  browserPane: BrowserPaneState | null;
  editorPane: EditorPaneState | null;
  editorVisible: boolean;
  notesPane?: NotesPaneState | null;
  notesVisible?: boolean;
  editorTabs: EditorTab[];
  activeEditorTabId: string | null;
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
  /** Runtime residency state — controls whether pane surfaces are kept warm. */
  runtimeState: WorkspaceRuntimeState;
}
