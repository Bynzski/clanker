import type { FileExplorerEntry } from '../../shared/types/fileExplorer';

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
  locked?: boolean;
}

export interface BrowserPaneState {
  id: string;
  position: PanePosition;
  locked: boolean;
}

export interface GridViewport {
  cols: number;
  rows: number;
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
  layoutRoot: LayoutNode | null;
  explorerVisible: boolean;
  explorerSidebarWidth: number;
  explorerExpandedPaths: string[];
  explorerSelectedPath: string | null;
  explorerEntriesByPath: Record<string, FileExplorerEntry[] | undefined>;
  explorerLoadingPaths: string[];
  explorerErrorsByPath: Record<string, string | null | undefined>;
}
