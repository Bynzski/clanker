import type { NativeAttentionCapability } from '../../shared/types/attentionSignal';
import type { PanePlacementRestoreHint } from './workspaceLayout';
import type { FileExplorerEntry } from '../../shared/types/fileExplorer';
import type { GitStatus } from '../components/git/types';
import type { CheckoutContext } from '../../shared/types/checkoutContext';

export interface Terminal {
  id: string;
  pid: number;
  workingDir: string;
  workspaceId?: string;
  /** Execution root this terminal runs in; absent on legacy terminals, which mean the workspace's main checkout. */
  checkoutContextId?: string;
  environmentId?: string;
  harnessId?: string | null;
  attentionEnabled?: boolean;
  attention?: NativeAttentionCapability;
  displayName?: string;
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
  /** Runtime-only: SSH discovery may auto-open once, never on a panel remount. */
  remotePreviewInitialized?: boolean;
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

export interface ExplorerPaneState {
  id: string;
}

export interface EditorTab {
  id: string;
  checkoutContextId?: string;
  checkoutRoot?: string;
  checkoutLabel?: string;
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
 * New workspaces default to 'warm'. The renderer keeps the active workspace and
 * two most recently used workspace surfaces warm, then marks older ones cold.
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

/** Canonical Browser state; the workspace fields project the selected page only. */
export interface WorkspacePageBrowser {
  /** Null only for legacy URL/visibility seeds before the first pane is created. */
  pane: BrowserPaneState | null;
  visible: boolean;
  url: string;
  placementHint?: PanePlacementRestoreHint | null;
}

export interface WorkspacePage {
  browser?: WorkspacePageBrowser;
  id: string;
  layoutRoot: LayoutNode | null;
  layoutRevision: number;
  layoutUndoStack: LayoutNode[];
  activeTerminalId: string | null;
  maximizedPaneId?: string;
  focusBeforeMaximize?: string | null;
}

export interface MinimizedPane {
  paneId: string;
  pageId: string;
  placement: PanePlacementRestoreHint | null;
}

export interface WorkspaceTab {
  /** Optional on legacy inputs; sanitized workspaces always have a page. */
  pages?: WorkspacePage[];
  activePageId?: string;
  minimizedPanes?: MinimizedPane[];
  /** Newly spawned/replaced terminals keep their surface warm until the startup handshake. */
  pendingTerminalIds?: string[];
  id: string;
  lifecycle: WorkspaceLifecycleState;
  name: string;
  workspacePath: string;
  environmentId?: string;
  environmentLabel?: string;
  /**
   * Validated working roots owned by this workspace (always includes the main context once
   * sanitized). `workspacePath` is still the registered root, equal to the main context's path.
   */
  checkoutContexts?: CheckoutContext[];
  /** Explicit editor-surface focus; terminal focus clears it. Runtime/descriptive only. */
  fileSurfaceContextId?: string;
  /** Transitional: linked worktrees are still presented as workspaces (see checkoutContexts). */
  isLinkedWorktree?: boolean;
  projectName?: string;
  harness: string;
  model: string;
  terminals: Terminal[];
  panes: Pane[];
  /** Compatibility projection of the selected page's canonical Browser. */
  browserVisible: boolean;
  browserOverlayCount?: number;
  browserUrl: string;
  activeTerminalId: string | null;
  browserPane: BrowserPaneState | null;
  explorerPane?: ExplorerPaneState | null;
  editorPane: EditorPaneState | null;
  editorVisible: boolean;
  notesPane?: NotesPaneState | null;
  notesVisible?: boolean;
  editorTabs: EditorTab[];
  activeEditorTabId: string | null;
  /** Compatibility projection of the active page, synchronized by workspacePages.ts. */
  layoutRoot: LayoutNode | null;
  /** Monotonic revision scoped to the active page's layout. */
  layoutRevision?: number;
  /** In-memory layout history; intentionally not persisted across launches. */
  layoutUndoStack?: LayoutNode[];
  /** Runtime-only: where the browser sat before it was hidden. Never persisted. */
  browserPlacementHint?: PanePlacementRestoreHint | null;
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
