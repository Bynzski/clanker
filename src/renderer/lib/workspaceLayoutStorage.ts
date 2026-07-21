import type { LayoutNode, WorkspaceTab } from '../store/workspaceTypes';
import { pathKey } from '../../shared/pathKey';
import { createDefaultBrowserPane, generateId } from '../store/workspaceStoreHelpers';

const STORAGE_PREFIX = 'clanker-grid:layout:v1:';
const STORAGE_VERSION = 1;

type PersistedLayoutNode =
  | { type: 'leaf'; paneKey: string }
  | {
      type: 'split';
      orientation: 'horizontal' | 'vertical';
      ratio: number;
      first: PersistedLayoutNode;
      second: PersistedLayoutNode;
    };

interface PersistedWorkspaceLayout {
  version: typeof STORAGE_VERSION;
  terminalCount: number;
  root: PersistedLayoutNode | null;
}

export function getWorkspaceLayoutStorageKey(workspacePath: string, isWindows?: boolean): string {
  let normalized = workspacePath.trim().replace(/\\/g, '/');
  while (normalized.length > 1 && normalized.endsWith('/') && !/^[A-Za-z]:\/$/.test(normalized)) {
    normalized = normalized.slice(0, -1);
  }
  normalized = pathKey(normalized, isWindows);
  return `${STORAGE_PREFIX}${encodeURIComponent(normalized)}`;
}

function createPaneKeyMap(workspace: WorkspaceTab): Map<string, string> {
  const map = new Map<string, string>();
  workspace.panes.forEach((pane, index) => map.set(pane.id, `terminal:${index}`));
  if (workspace.explorerPane) map.set(workspace.explorerPane.id, 'explorer');
  if (workspace.browserPane) map.set(workspace.browserPane.id, 'browser');
  if (workspace.editorPane) map.set(workspace.editorPane.id, 'editor');
  if (workspace.notesPane) map.set(workspace.notesPane.id, 'notes');
  return map;
}

function serializeNode(node: LayoutNode | null, paneKeys: Map<string, string>): PersistedLayoutNode | null {
  if (node == null) return null;
  if (node.type === 'leaf') {
    const paneKey = paneKeys.get(node.paneId);
    return paneKey ? { type: 'leaf', paneKey } : null;
  }
  const first = serializeNode(node.first, paneKeys);
  const second = serializeNode(node.second, paneKeys);
  if (first == null) return second;
  if (second == null) return first;
  return {
    type: 'split',
    orientation: node.orientation,
    ratio: node.ratio,
    first,
    second,
  };
}

function parsePersistedNode(value: unknown): PersistedLayoutNode | null {
  if (value == null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.type === 'leaf' && typeof record.paneKey === 'string') {
    return { type: 'leaf', paneKey: record.paneKey };
  }
  if (
    record.type === 'split'
    && (record.orientation === 'horizontal' || record.orientation === 'vertical')
    && typeof record.ratio === 'number'
  ) {
    const first = parsePersistedNode(record.first);
    const second = parsePersistedNode(record.second);
    if (first && second) {
      return {
        type: 'split',
        orientation: record.orientation,
        ratio: Math.max(0.1, Math.min(0.9, record.ratio)),
        first,
        second,
      };
    }
  }
  return null;
}

function createNodeId(prefix: 'leaf' | 'split'): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function restoreNode(node: PersistedLayoutNode | null, paneIds: Map<string, string>): LayoutNode | null {
  if (node == null) return null;
  if (node.type === 'leaf') {
    const paneId = paneIds.get(node.paneKey);
    return paneId ? { type: 'leaf', nodeId: createNodeId('leaf'), paneId } : null;
  }
  const first = restoreNode(node.first, paneIds);
  const second = restoreNode(node.second, paneIds);
  if (first == null) return second;
  if (second == null) return first;
  return {
    type: 'split',
    nodeId: createNodeId('split'),
    orientation: node.orientation,
    ratio: node.ratio,
    first,
    second,
  };
}

function collectPersistedPaneKeys(node: PersistedLayoutNode | null, keys = new Set<string>()): Set<string> {
  if (node == null) return keys;
  if (node.type === 'leaf') {
    keys.add(node.paneKey);
    return keys;
  }
  collectPersistedPaneKeys(node.first, keys);
  collectPersistedPaneKeys(node.second, keys);
  return keys;
}

function restoreUtilityPaneState(
  workspace: WorkspaceTab,
  paneKeys: Set<string>,
): WorkspaceTab {
  const explorerPane = paneKeys.has('explorer')
    ? workspace.explorerPane ?? { id: generateId('explorer') }
    : workspace.explorerPane;
  const browserPane = paneKeys.has('browser')
    ? workspace.browserPane ?? createDefaultBrowserPane(
        generateId('browser'),
        { x: 0, y: 0, w: 6, h: 6 },
        workspace.browserUrl,
      )
    : workspace.browserPane;
  const editorPane = paneKeys.has('editor')
    ? workspace.editorPane ?? { id: generateId('editor') }
    : workspace.editorPane;
  const notesPane = paneKeys.has('notes')
    ? workspace.notesPane ?? { id: generateId('notes') }
    : workspace.notesPane;

  return {
    ...workspace,
    explorerPane,
    explorerVisible: paneKeys.has('explorer'),
    browserPane,
    browserVisible: paneKeys.has('browser'),
    editorPane,
    editorVisible: paneKeys.has('editor'),
    notesPane,
    notesVisible: paneKeys.has('notes'),
  };
}

export function persistWorkspaceLayout(workspace: WorkspaceTab): void {
  if (typeof window === 'undefined' || !workspace.workspacePath) return;
  try {
    const payload: PersistedWorkspaceLayout = {
      version: STORAGE_VERSION,
      terminalCount: workspace.panes.length,
      root: serializeNode(workspace.layoutRoot, createPaneKeyMap(workspace)),
    };
    window.localStorage.setItem(getWorkspaceLayoutStorageKey(workspace.workspacePath), JSON.stringify(payload));
  } catch {
    // Layout persistence must never prevent the workspace from operating.
  }
}

export function restoreWorkspaceLayout(workspace: WorkspaceTab): WorkspaceTab {
  if (typeof window === 'undefined' || !workspace.workspacePath) return workspace;
  try {
    const raw = window.localStorage.getItem(getWorkspaceLayoutStorageKey(workspace.workspacePath));
    if (!raw) return workspace;
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.version !== STORAGE_VERSION || value.terminalCount !== workspace.panes.length) {
      return workspace;
    }
    const persistedRoot = parsePersistedNode(value.root);
    if (persistedRoot == null) return workspace;

    // Pane instances are runtime state and receive fresh IDs on every app
    // launch. Recreate utility panes represented by the saved topology before
    // mapping pane keys, otherwise reopening a workspace would collapse and
    // immediately overwrite those branches.
    const restoredWorkspace = restoreUtilityPaneState(
      workspace,
      collectPersistedPaneKeys(persistedRoot),
    );

    const paneIds = new Map<string, string>();
    restoredWorkspace.panes.forEach((pane, index) => paneIds.set(`terminal:${index}`, pane.id));
    if (restoredWorkspace.explorerPane) paneIds.set('explorer', restoredWorkspace.explorerPane.id);
    if (restoredWorkspace.browserPane) paneIds.set('browser', restoredWorkspace.browserPane.id);
    if (restoredWorkspace.editorPane) paneIds.set('editor', restoredWorkspace.editorPane.id);
    if (restoredWorkspace.notesPane) paneIds.set('notes', restoredWorkspace.notesPane.id);
    const layoutRoot = restoreNode(persistedRoot, paneIds);
    if (layoutRoot == null) return workspace;

    return {
      ...restoredWorkspace,
      layoutRoot,
      layoutRevision: (workspace.layoutRevision ?? 0) + 1,
      layoutUndoStack: [],
    };
  } catch {
    return workspace;
  }
}
