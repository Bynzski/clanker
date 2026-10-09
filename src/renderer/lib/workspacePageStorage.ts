import type { LayoutNode, WorkspaceTab } from '../store/workspaceTypes';
import { MAX_WORKSPACE_PAGES, selectPage, synchronizePages } from '../store/workspacePages';
import { workspaceIdentityKey } from '../../shared/workspaceIdentity';

type SavedNode = { type: 'leaf'; key: string } | { type: 'split'; orientation: 'horizontal' | 'vertical'; ratio: number; first: SavedNode; second: SavedNode };
export interface WorkspacePagePreferences {
  version: 1;
  activePageId: string;
  pages: { id: string; root: SavedNode | null }[];
  minimized: { key: string; pageId: string }[];
}
const PREFIX = 'clanker-grid:workspace-pages:v1:';
const MAX_NODES = 512;

function keys(workspace: WorkspaceTab): Map<string, string> {
  const result = new Map(workspace.panes.map((pane, index) => [pane.id, `terminal-slot:${index}`]));
  if (workspace.browserPane) result.set(workspace.browserPane.id, 'browser');
  if (workspace.editorPane) result.set(workspace.editorPane.id, 'editor');
  if (workspace.notesPane) result.set(workspace.notesPane.id, 'notes');
  return result;
}
function saveNode(node: LayoutNode | null, paneKeys: Map<string, string>): SavedNode | null {
  if (!node) return null;
  if (node.type === 'leaf') {
    const key = paneKeys.get(node.paneId);
    return key ? { type: 'leaf', key } : null;
  }
  const first = saveNode(node.first, paneKeys);
  const second = saveNode(node.second, paneKeys);
  return first && second ? { type: 'split', orientation: node.orientation, ratio: node.ratio, first, second } : first ?? second;
}
export function serializeWorkspacePages(workspace: WorkspaceTab): WorkspacePagePreferences {
  const paneKeys = keys(workspace);
  return { version: 1, activePageId: workspace.activePageId ?? '',
    pages: (workspace.pages ?? []).map((page) => ({ id: page.id, root: saveNode(page.layoutRoot, paneKeys) })),
    minimized: (workspace.minimizedPanes ?? []).flatMap((entry) => {
      const key = paneKeys.get(entry.paneId);
      return key ? [{ key, pageId: entry.pageId }] : [];
    }) };
}

/** Treat preference bytes as untrusted; bounds apply across the whole collection. */
export function parseWorkspacePages(value: unknown): WorkspacePagePreferences | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (data.version !== 1 || !Array.isArray(data.pages) || !data.pages.length || data.pages.length > MAX_WORKSPACE_PAGES || !Array.isArray(data.minimized) || data.minimized.length > MAX_NODES) return null;
  let remaining = MAX_NODES;
  const used = new Set<string>();
  const idValid = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 160 && !/[\0\r\n]/.test(id);
  const keyValid = (key: unknown): key is string => typeof key === 'string' && /^(browser|editor|notes|terminal-slot:\d{1,3})$/.test(key);
  function parseNode(raw: unknown, depth: number): SavedNode | null {
    if (raw === null) return null;
    if (depth > 32 || --remaining < 0 || !raw || typeof raw !== 'object') throw new Error('Invalid page topology');
    const node = raw as Record<string, unknown>;
    if (node.type === 'leaf' && keyValid(node.key) && !used.has(node.key)) {
      used.add(node.key);
      return { type: 'leaf', key: node.key };
    }
    if (node.type === 'split' && (node.orientation === 'horizontal' || node.orientation === 'vertical') && typeof node.ratio === 'number' && Number.isFinite(node.ratio) && node.ratio >= .1 && node.ratio <= .9) {
      const first = parseNode(node.first, depth + 1);
      const second = parseNode(node.second, depth + 1);
      if (first && second) return { type: 'split', orientation: node.orientation, ratio: node.ratio, first, second };
    }
    throw new Error('Invalid page topology');
  }
  try {
    const pageIds = new Set<string>();
    const pages = data.pages.map((raw) => {
      if (!raw || typeof raw !== 'object') throw new Error('Invalid page');
      const page = raw as Record<string, unknown>;
      if (!idValid(page.id) || pageIds.has(page.id)) throw new Error('Invalid page');
      pageIds.add(page.id);
      return { id: page.id, root: parseNode(page.root, 0) };
    });
    if (typeof data.activePageId !== 'string' || !pageIds.has(data.activePageId)) return null;
    const minimized = data.minimized.map((raw) => {
      if (!raw || typeof raw !== 'object') throw new Error('Invalid minimized pane');
      const entry = raw as Record<string, unknown>;
      if (!keyValid(entry.key) || used.has(entry.key) || typeof entry.pageId !== 'string' || !pageIds.has(entry.pageId)) throw new Error('Invalid minimized pane');
      used.add(entry.key);
      return { key: entry.key, pageId: entry.pageId };
    });
    return { version: 1, activePageId: data.activePageId, pages, minimized };
  } catch { return null; }
}

/** Only already-present singleton utilities can be mapped. Terminal slots NEVER bind future chats. */
export function restoreWorkspacePages(workspace: WorkspaceTab, value: unknown): WorkspaceTab {
  const saved = parseWorkspacePages(value);
  if (!saved) return workspace;
  const paneIds = new Map([...keys(workspace)].filter(([, key]) => !key.startsWith('terminal-slot:')).map(([id, key]) => [key, id]));
  function restore(node: SavedNode | null): LayoutNode | null {
    if (!node) return null;
    if (node.type === 'leaf') {
      const paneId = paneIds.get(node.key);
      return paneId ? { type: 'leaf', nodeId: crypto.randomUUID(), paneId } : null;
    }
    const first = restore(node.first);
    const second = restore(node.second);
    return first && second ? { type: 'split', nodeId: crypto.randomUUID(), orientation: node.orientation, ratio: node.ratio, first, second } : first ?? second;
  }
  // Ordinary reopen is an empty shell. Refuse to overwrite an already-live workspace.
  if (workspace.panes.length) return workspace;
  const pages = saved.pages.map((page) => ({ id: page.id, layoutRoot: restore(page.root), layoutRevision: 0, layoutUndoStack: [], activeTerminalId: null }));
  const minimizedPanes = saved.minimized.flatMap((entry) => {
    const paneId = paneIds.get(entry.key);
    return paneId ? [{ paneId, pageId: entry.pageId, placement: null }] : [];
  });
  const next = selectPage({ ...workspace, pages, minimizedPanes }, saved.activePageId);
  return synchronizePages(undefined, next);
}
function storageKey(workspace: WorkspaceTab): string {
  return PREFIX + workspaceIdentityKey({ environmentId: workspace.environmentId ?? 'local', path: workspace.workspacePath });
}
export function readWorkspacePages(workspace: WorkspaceTab): WorkspaceTab {
  try {
    const text = window.localStorage.getItem(storageKey(workspace));
    if (!text || text.length > 128 * 1024) return workspace;
    return restoreWorkspacePages(workspace, JSON.parse(text));
  } catch { return workspace; }
}
export function persistWorkspacePages(workspace: WorkspaceTab): void {
  try { window.localStorage.setItem(storageKey(workspace), JSON.stringify(serializeWorkspacePages(workspace))); }
  catch { /* Preferences never prevent working. */ }
}
