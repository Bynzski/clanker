import type { LayoutNode, WorkspaceTab } from '../store/workspaceTypes';
import { MAX_WORKSPACE_PAGES, selectPage, synchronizePages } from '../store/workspacePages';
import { workspaceIdentityKey } from '../../shared/workspaceIdentity';

type SavedNode = { type: 'leaf'; key: string } | { type: 'split'; orientation: 'horizontal' | 'vertical'; ratio: number; first: SavedNode; second: SavedNode };
export interface WorkspacePagePreferences {
  version: 1 | 2;
  browsers?: { id: string; pageId: string; visible: boolean; tabIds: string[] }[];
  activePageId: string;
  pages: { id: string; root: SavedNode | null }[];
  minimized: { key: string; pageId: string }[];
}
const PREFIX = 'clanker-grid:workspace-pages:v2:';
const LEGACY_PREFIX = 'clanker-grid:workspace-pages:v1:';
const MAX_NODES = 512;

function keys(workspace: WorkspaceTab): Map<string, string> {
  const result = new Map(workspace.panes.map((pane, index) => [pane.id, `terminal-slot:${index}`]));
  if (workspace.pages) {
    for (const page of workspace.pages) if (page.browser?.pane) result.set(page.browser.pane.id, `browser:${page.browser.pane.id}`);
  } else if (workspace.browserPane) result.set(workspace.browserPane.id, `browser:${workspace.browserPane.id}`);
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
  return { version: 2, activePageId: workspace.activePageId ?? '',
    browsers: (workspace.pages ?? []).flatMap((page) => page.browser?.pane ? [{ id: page.browser.pane.id, pageId: page.id,
      visible: page.browser.visible, tabIds: page.browser.pane.tabs.map((tab) => tab.id) }] : []),
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
  if ((data.version !== 1 && data.version !== 2) || !Array.isArray(data.pages) || !data.pages.length || data.pages.length > MAX_WORKSPACE_PAGES || !Array.isArray(data.minimized) || data.minimized.length > MAX_NODES) return null;
  let remaining = MAX_NODES;
  const used = new Set<string>();
  const idValid = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 160 && !/[\0\r\n]/.test(id);
  const browserOwners = new Map<string, string>();
  const keyValid = (key: unknown): key is string => typeof key === 'string' && (/^(editor|notes|terminal-slot:\d{1,3})$/.test(key)
    || (data.version === 1 ? key === 'browser' : browserOwners.has(key)));
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
    let browsers: WorkspacePagePreferences['browsers'];
    if (data.version === 2) {
      if (!Array.isArray(data.browsers) || data.browsers.length > MAX_WORKSPACE_PAGES) return null;
      const tabIds = new Set<string>();
      const browserPages = new Set<string>();
      browsers = data.browsers.map((raw) => {
        if (!raw || typeof raw !== 'object') throw new Error('Invalid Browser');
        const browser = raw as Record<string, unknown>;
        if (!idValid(browser.id) || !idValid(browser.pageId) || typeof browser.visible !== 'boolean'
          || !Array.isArray(browser.tabIds) || !browser.tabIds.length || browser.tabIds.length > 128
          || browserOwners.has(`browser:${browser.id}`) || browserPages.has(browser.pageId)) throw new Error('Invalid Browser ownership');
        const ids = browser.tabIds.map((id) => {
          if (!idValid(id) || tabIds.has(id)) throw new Error('Duplicate Browser tab');
          tabIds.add(id); return id;
        });
        browserOwners.set(`browser:${browser.id}`, browser.pageId);
        browserPages.add(browser.pageId);
        return { id: browser.id, pageId: browser.pageId, visible: browser.visible, tabIds: ids };
      });
    }
    const pages = data.pages.map((raw) => {
      if (!raw || typeof raw !== 'object') throw new Error('Invalid page');
      const page = raw as Record<string, unknown>;
      if (!idValid(page.id) || pageIds.has(page.id)) throw new Error('Invalid page');
      pageIds.add(page.id);
      const root = parseNode(page.root, 0);
      const validateOwner = (node: SavedNode | null): void => {
        if (!node) return;
        if (node.type === 'leaf') {
          const owner = browserOwners.get(node.key);
          if (owner && owner !== page.id) throw new Error('Foreign Browser leaf');
        } else { validateOwner(node.first); validateOwner(node.second); }
      };
      validateOwner(root);
      return { id: page.id, root };
    });
    if (typeof data.activePageId !== 'string' || !pageIds.has(data.activePageId) || browsers?.some((browser) => !pageIds.has(browser.pageId))) return null;
    const minimized = data.minimized.map((raw) => {
      if (!raw || typeof raw !== 'object') throw new Error('Invalid minimized pane');
      const entry = raw as Record<string, unknown>;
      if (!keyValid(entry.key) || used.has(entry.key) || typeof entry.pageId !== 'string' || !pageIds.has(entry.pageId)) throw new Error('Invalid minimized pane');
      const owner = browserOwners.get(entry.key);
      if (owner && owner !== entry.pageId) throw new Error('Foreign minimized Browser');
      used.add(entry.key);
      return { key: entry.key, pageId: entry.pageId };
    });
    if (browsers?.some((browser) => browser.visible !== used.has(`browser:${browser.id}`))) return null;
    return { version: data.version, activePageId: data.activePageId, pages, minimized, ...(browsers ? { browsers } : {}) };
  } catch { return null; }
}

/** Only already-present singleton utilities can be mapped. Terminal slots NEVER bind future chats. */
export function restoreWorkspacePages(workspace: WorkspaceTab, value: unknown): WorkspaceTab {
  const saved = parseWorkspacePages(value);
  if (!saved) return workspace;
  const paneIds = new Map([...keys(workspace)].filter(([, key]) => !key.startsWith('terminal-slot:')).map(([id, key]) => [key, id]));
  if (saved.version === 1 && workspace.browserPane) paneIds.set('browser', workspace.browserPane.id);
  const existingBrowsers = new Map((workspace.pages ?? []).flatMap((page) => page.browser?.pane ? [[page.browser.pane.id, page.browser] as const] : []));
  if (workspace.browserPane && !existingBrowsers.has(workspace.browserPane.id)) existingBrowsers.set(workspace.browserPane.id,
    { pane: workspace.browserPane, visible: workspace.browserVisible, url: workspace.browserUrl });
  for (const browser of saved.browsers ?? []) {
    const pane = existingBrowsers.get(browser.id)?.pane;
    if (!pane || pane.tabs.length !== browser.tabIds.length || !pane.tabs.every((tab) => browser.tabIds.includes(tab.id))) paneIds.delete(`browser:${browser.id}`);
  }
  // Preferences cannot retire live Browser resources or bind a newly generated
  // pane/tab collection to an old resource key.
  if (saved.version === 2 && [...existingBrowsers.keys()].some((id) => !saved.browsers?.some((browser) => browser.id === id)
    || !paneIds.has(`browser:${id}`))) return workspace;
  if (saved.version === 1 && existingBrowsers.size > 1) return workspace;
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
  // V1 maps only an already-present singleton; capture ownership before selecting
  // projects an empty page's Browser fields over the legacy input.
  const browserPageId = saved.pages.find((page) => {
    const contains = (node: SavedNode | null): boolean => Boolean(node && (node.type === 'leaf'
      ? node.key === 'browser' : contains(node.first) || contains(node.second)));
    return contains(page.root);
  })?.id ?? saved.minimized.find((entry) => entry.key === 'browser')?.pageId ?? saved.activePageId;
  const ownedPages = pages.map((page) => {
    if (saved.version === 1) return page.id === browserPageId && workspace.browserPane
      ? { ...page, browser: { pane: workspace.browserPane, visible: workspace.browserVisible, url: workspace.browserUrl } } : page;
    const descriptor = saved.browsers?.find((browser) => browser.pageId === page.id && paneIds.has(`browser:${browser.id}`));
    const browser = descriptor && existingBrowsers.get(descriptor.id);
    return browser && descriptor ? { ...page, browser: { ...browser, visible: descriptor.visible } } : page;
  });
  const next = selectPage({ ...workspace, pages: ownedPages, minimizedPanes }, saved.activePageId);
  return synchronizePages(undefined, next);
}
function storageKey(workspace: WorkspaceTab): string {
  return PREFIX + workspaceIdentityKey({ environmentId: workspace.environmentId ?? 'local', path: workspace.workspacePath });
}
export function readWorkspacePages(workspace: WorkspaceTab): WorkspaceTab {
  try {
    const key = storageKey(workspace);
    const text = window.localStorage.getItem(key) ?? window.localStorage.getItem(LEGACY_PREFIX + key.slice(PREFIX.length));
    if (!text || text.length > 128 * 1024) return workspace;
    return restoreWorkspacePages(workspace, JSON.parse(text));
  } catch { return workspace; }
}
export function persistWorkspacePages(workspace: WorkspaceTab): void {
  try {
    const saved = serializeWorkspacePages(workspace);
    const text = JSON.stringify(saved);
    if (text.length > 128 * 1024 || !parseWorkspacePages(saved)) return;
    window.localStorage.setItem(storageKey(workspace), text);
  }
  catch { /* Preferences never prevent working. */ }
}
