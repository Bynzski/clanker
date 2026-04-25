/**
 * Browser IPC Handlers
 *
 * Registers all browser-related IPC handlers and manages WebContentsView instances.
 * Each workspace gets its own WebContentsView but they all share a global partition
 * for cookies and session data. Extracted from main.ts per S2.2.
 */

import { ipcMain, BrowserWindow, Menu, WebContentsView, shell } from 'electron';
import {
  normalizeAppBrowserUrl,
  normalizeExternalUrl,
} from '../security';
import {
  BROWSER_SET_BOUNDS,
  BROWSER_HIDE,
  BROWSER_NAVIGATE,
  BROWSER_BACK,
  BROWSER_FORWARD,
  BROWSER_REFRESH,
  BROWSER_STOP,
  BROWSER_DISPOSE_WORKSPACE,
  OPEN_EXTERNAL,
  CAN_GO_BACK,
  CAN_GO_FORWARD,
  BROWSER_URL_UPDATED,
  BROWSER_GET_URL,
  BROWSER_SAVE_URL,
  BROWSER_CREATE_TAB,
  BROWSER_CLOSE_TAB,
  BROWSER_SWITCH_TAB,
  BROWSER_GET_TABS,
  BROWSER_TAB_NAVIGATE,
  FIT_ALL_PANES,
} from '../../shared/ipcChannels';

interface BrowserViewEntry {
  view: WebContentsView;
  url: string;
}

/**
 * Phase 1 tab tracking metadata.
 *
 * Stored independently of `WebContentsView` ownership: in Phase 1 main still
 * uses a single view per workspace, so all tabs in a workspace currently
 * share that view. Phase 2 will replace the single-view map with one view
 * per `tabId`. Until then, this map only tracks renderer-provided tab ids
 * so tab IPC handlers can answer create/switch/close/get without inventing
 * their own ids and so `BROWSER_URL_UPDATED` can include a tab id.
 */
interface TabRecord {
  id: string;
  url: string;
  title: string;
}

const tabRecordsByWorkspace = new Map<string, Map<string, TabRecord>>();
const tabOrderByWorkspace = new Map<string, string[]>();
const activeTabIdByWorkspace = new Map<string, string>();

function getOrCreateTabMap(workspaceId: string): Map<string, TabRecord> {
  let tabs = tabRecordsByWorkspace.get(workspaceId);
  if (!tabs) {
    tabs = new Map();
    tabRecordsByWorkspace.set(workspaceId, tabs);
    tabOrderByWorkspace.set(workspaceId, []);
  }
  return tabs;
}

function getTabOrder(workspaceId: string): string[] {
  let order = tabOrderByWorkspace.get(workspaceId);
  if (!order) {
    order = [];
    tabOrderByWorkspace.set(workspaceId, order);
  }
  return order;
}

function clearWorkspaceTabRecords(workspaceId: string): void {
  tabRecordsByWorkspace.delete(workspaceId);
  tabOrderByWorkspace.delete(workspaceId);
  activeTabIdByWorkspace.delete(workspaceId);
}

interface RegisterBrowserIpcDeps {
  getMainWindow: () => BrowserWindow | null;
  getBrowserViews: () => Map<string, BrowserViewEntry>;
  getActiveBrowserWorkspaceId: () => string | null;
  setActiveBrowserWorkspaceId: (id: string | null) => void;
}

const DEFAULT_BROWSER_URL = 'https://github.com';

function isBrowserKeyboardZoomShortcut(input: {
  control: boolean;
  meta: boolean;
  alt: boolean;
  key?: string;
  code?: string;
}): boolean {
  const primaryModifier = input.control || input.meta;
  if (!primaryModifier || input.alt) {
    return false;
  }

  const key = input.key?.toLowerCase() ?? '';
  const code = input.code?.toLowerCase() ?? '';

  return code === 'equal'
    || code === 'minus'
    || code === 'digit0'
    || key === '='
    || key === '+'
    || key === '-'
    || key === '_'
    || key === '0';
}

function isBrowserDevToolsShortcut(input: {
  control: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  key?: string;
}): boolean {
  if (input.alt) {
    return false;
  }

  const key = input.key?.toLowerCase() ?? '';
  return key === 'f12' || ((input.control || input.meta) && input.shift && key === 'i');
}

function attachBrowserShortcutHandlers(view: WebContentsView, sendFitAllPanes: () => void) {
  view.webContents.on('before-input-event', (event, input) => {
    if (isBrowserKeyboardZoomShortcut(input)) {
      event.preventDefault();
      return;
    }

    if (isBrowserDevToolsShortcut(input)) {
      event.preventDefault();
      if (view.webContents.isDevToolsOpened()) {
        view.webContents.closeDevTools();
      } else {
        view.webContents.openDevTools({ mode: 'detach' });
      }
      return;
    }

    if ((input.control || input.meta) && input.shift && input.key?.toLowerCase() === 'f') {
      sendFitAllPanes();
    }
  });
}

function attachBrowserContextMenuHandlers(view: WebContentsView, mainWindow: BrowserWindow) {
  view.webContents.on('context-menu', (_event, params) => {
    const menu = Menu.buildFromTemplate([
      {
        label: 'Open DevTools',
        click: () => {
          view.webContents.openDevTools({ mode: 'detach' });
        },
      },
      {
        label: 'Inspect Element',
        click: () => {
          view.webContents.inspectElement(params.x, params.y);
          view.webContents.openDevTools({ mode: 'detach' });
        },
      },
    ]);

    menu.popup({ window: mainWindow });
  });
}

function syncBrowserViewZoomToApp(mainWindow: BrowserWindow, view: WebContentsView) {
  const appZoomLevel = mainWindow.webContents.getZoomLevel();
  if (appZoomLevel === 0) {
    return;
  }

  const nextLevel = view.webContents.getZoomLevel() + appZoomLevel;
  view.webContents.setZoomLevel(nextLevel);
}

function attachBrowserSecurityHandlers(view: WebContentsView) {
  view.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = normalizeExternalUrl(url);
    if (externalUrl) {
      void shell.openExternal(externalUrl);
    }
    return { action: 'deny' };
  });

  view.webContents.on('will-navigate', (event, url) => {
    if (!normalizeAppBrowserUrl(url)) {
      event.preventDefault();
    }
  });
}

function createBrowserViewForWorkspace(
  workspaceId: string,
  deps: RegisterBrowserIpcDeps
): BrowserViewEntry | null {
  const mainWindow = deps.getMainWindow();
  if (!mainWindow) return null;

  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      partition: 'persist:browser-global',
    },
  });

  attachBrowserSecurityHandlers(view);
  attachBrowserShortcutHandlers(view, () => {
    const win = deps.getMainWindow();
    if (win) {
      win.webContents.send(FIT_ALL_PANES);
    }
  });
  attachBrowserContextMenuHandlers(view, mainWindow);
  syncBrowserViewZoomToApp(mainWindow, view);
  view.setVisible(false);
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  mainWindow.contentView.addChildView(view);

  const reportUrlChange = (navigatedUrl: string) => {
    const safeUrl = normalizeAppBrowserUrl(navigatedUrl);
    if (!safeUrl) return;
    const entry = deps.getBrowserViews().get(workspaceId);
    if (entry) {
      entry.url = safeUrl;
    }
    const tabId = activeTabIdByWorkspace.get(workspaceId);
    if (tabId) {
      const tabs = tabRecordsByWorkspace.get(workspaceId);
      const record = tabs?.get(tabId);
      if (record) {
        record.url = safeUrl;
      }
    }
    const win = deps.getMainWindow();
    if (win) {
      const title = view.webContents.getTitle();
      const canGoBack = view.webContents.navigationHistory.canGoBack();
      const canGoForward = view.webContents.navigationHistory.canGoForward();
      if (tabId) {
        const tabs = tabRecordsByWorkspace.get(workspaceId);
        const record = tabs?.get(tabId);
        if (record && typeof title === 'string') {
          record.title = title;
        }
      }
      win.webContents.send(BROWSER_URL_UPDATED, {
        workspaceId,
        ...(tabId ? { tabId } : {}),
        url: safeUrl,
        title,
        canGoBack,
        canGoForward,
      });
    }
  };
  view.webContents.on('did-navigate', (_event, url) => reportUrlChange(url));
  view.webContents.on('did-navigate-in-page', (_event, url) => reportUrlChange(url));

  void view.webContents.loadURL(DEFAULT_BROWSER_URL);

  return { view, url: DEFAULT_BROWSER_URL };
}

function ensureBrowserViewEntry(
  workspaceId: string,
  deps: RegisterBrowserIpcDeps
): BrowserViewEntry | null {
  const existing = deps.getBrowserViews().get(workspaceId);
  if (existing) {
    return existing;
  }

  const entry = createBrowserViewForWorkspace(workspaceId, deps);
  if (!entry) {
    return null;
  }

  deps.getBrowserViews().set(workspaceId, entry);
  return entry;
}

function setActiveBrowserWorkspace(workspaceId: string | null, deps: RegisterBrowserIpcDeps) {
  if (deps.getActiveBrowserWorkspaceId() === workspaceId) {
    return;
  }

  if (deps.getActiveBrowserWorkspaceId()) {
    const previous = deps.getBrowserViews().get(deps.getActiveBrowserWorkspaceId()!);
    previous?.view.setVisible(false);
  }

  deps.setActiveBrowserWorkspaceId(workspaceId);
}

function updateBrowserView(
  workspaceId: string,
  bounds: { x: number; y: number; width: number; height: number },
  deps: RegisterBrowserIpcDeps
) {
  const entry = ensureBrowserViewEntry(workspaceId, deps);
  if (!entry) {
    return;
  }

  setActiveBrowserWorkspace(workspaceId, deps);

  // Apply bounds BEFORE making visible to prevent the view from appearing at
  // stale or zero-sized bounds and then jumping to the correct position.
  if (bounds.width > 0 && bounds.height > 0) {
    entry.view.setBounds(bounds);
  }

  entry.view.setVisible(true);
}

function hideBrowserView(workspaceId: string, deps: RegisterBrowserIpcDeps) {
  const entry = deps.getBrowserViews().get(workspaceId);
  if (entry) {
    entry.view.setVisible(false);
  }

  if (deps.getActiveBrowserWorkspaceId() === workspaceId) {
    deps.setActiveBrowserWorkspaceId(null);
  }
}

function destroyBrowserView(workspaceId: string, deps: RegisterBrowserIpcDeps) {
  const entry = deps.getBrowserViews().get(workspaceId);
  if (!entry) {
    clearWorkspaceTabRecords(workspaceId);
    return;
  }

  entry.view.webContents.close();
  deps.getBrowserViews().delete(workspaceId);
  clearWorkspaceTabRecords(workspaceId);

  if (deps.getActiveBrowserWorkspaceId() === workspaceId) {
    deps.setActiveBrowserWorkspaceId(null);
  }
}

export function registerBrowserIpc(deps: RegisterBrowserIpcDeps): void {
  const { getMainWindow, getBrowserViews } = deps;

  ipcMain.handle(BROWSER_SET_BOUNDS, (
    _,
    workspaceId: string,
    viewportBounds: { x: number; y: number; width: number; height: number },
    tabId?: string,
  ) => {
    if (!workspaceId) {
      return;
    }

    // Phase 1: tabId is accepted but the underlying single view is shared.
    // Phase 2 will route bounds to the tab view identified by tabId.
    if (tabId) {
      const tabs = tabRecordsByWorkspace.get(workspaceId);
      if (tabs?.has(tabId)) {
        activeTabIdByWorkspace.set(workspaceId, tabId);
      }
    }

    updateBrowserView(workspaceId, {
      x: viewportBounds.x,
      y: viewportBounds.y,
      width: viewportBounds.width,
      height: viewportBounds.height,
    }, deps);
  });

  ipcMain.handle(BROWSER_HIDE, (_, workspaceId: string) => {
    if (!workspaceId) {
      return;
    }

    hideBrowserView(workspaceId, deps);
  });

  ipcMain.handle(BROWSER_NAVIGATE, (_, workspaceId: string, url: string, tabId?: string) => {
    if (!workspaceId) {
      return false;
    }

    const safeUrl = normalizeAppBrowserUrl(url);
    if (!safeUrl) {
      return false;
    }

    const entry = ensureBrowserViewEntry(workspaceId, deps);
    if (!entry) {
      return false;
    }

    entry.url = safeUrl;

    // Track per-tab url. Phase 1: navigation is only applied to the underlying
    // single view; Phase 2 will route navigation to the specific tab view.
    if (tabId) {
      const tabs = getOrCreateTabMap(workspaceId);
      const record = tabs.get(tabId);
      if (record) {
        record.url = safeUrl;
      }
    }
    const reportedTabId = tabId ?? activeTabIdByWorkspace.get(workspaceId);

    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(BROWSER_URL_UPDATED, {
        workspaceId,
        ...(reportedTabId ? { tabId: reportedTabId } : {}),
        url: safeUrl,
      });
    }

    void entry.view.webContents.loadURL(safeUrl);
    return true;
  });

  ipcMain.handle(BROWSER_BACK, (_, workspaceId: string) => {
    if (!workspaceId) {
      return;
    }

    const entry = getBrowserViews().get(workspaceId);
    if (entry && entry.view.webContents.navigationHistory.canGoBack()) {
      entry.view.webContents.navigationHistory.goBack();
    }
  });

  ipcMain.handle(BROWSER_FORWARD, (_, workspaceId: string) => {
    if (!workspaceId) {
      return;
    }

    const entry = getBrowserViews().get(workspaceId);
    if (entry && entry.view.webContents.navigationHistory.canGoForward()) {
      entry.view.webContents.navigationHistory.goForward();
    }
  });

  ipcMain.handle(BROWSER_REFRESH, (_, workspaceId: string) => {
    if (!workspaceId) {
      return;
    }

    const entry = getBrowserViews().get(workspaceId);
    if (entry) {
      entry.view.webContents.reload();
    }
  });

  ipcMain.handle(BROWSER_STOP, (_, workspaceId: string) => {
    if (!workspaceId) {
      return;
    }

    const entry = getBrowserViews().get(workspaceId);
    if (entry) {
      entry.view.webContents.stop();
    }
  });

  ipcMain.handle(BROWSER_DISPOSE_WORKSPACE, (_, workspaceId: string) => {
    if (!workspaceId) {
      return;
    }

    destroyBrowserView(workspaceId, deps);
  });

  ipcMain.handle(OPEN_EXTERNAL, (_, url: string) => {
    const safeUrl = normalizeExternalUrl(url);
    if (!safeUrl) {
      return false;
    }

    void shell.openExternal(safeUrl);
    return true;
  });

  ipcMain.handle(CAN_GO_BACK, (_, workspaceId: string) => {
    if (!workspaceId) {
      return false;
    }

    const entry = getBrowserViews().get(workspaceId);
    return entry?.view.webContents.navigationHistory.canGoBack() ?? false;
  });

  ipcMain.handle(CAN_GO_FORWARD, (_, workspaceId: string) => {
    if (!workspaceId) {
      return false;
    }

    const entry = getBrowserViews().get(workspaceId);
    return entry?.view.webContents.navigationHistory.canGoForward() ?? false;
  });

  ipcMain.handle(BROWSER_GET_URL, (_, workspaceId: string) => {
    const entry = getBrowserViews().get(workspaceId);
    return entry?.url ?? null;
  });

  ipcMain.handle(BROWSER_SAVE_URL, (_, workspaceId: string, url: string) => {
    const safeUrl = normalizeAppBrowserUrl(url);
    if (!safeUrl) return false;
    const entry = getBrowserViews().get(workspaceId);
    if (entry) {
      entry.url = safeUrl;
      return true;
    }
    return false;
  });

  ipcMain.handle(BROWSER_CREATE_TAB, (_, workspaceId: string, tabId: string) => {
    if (!workspaceId || !tabId) {
      return { url: '', title: '' };
    }

    const tabs = getOrCreateTabMap(workspaceId);
    const order = getTabOrder(workspaceId);
    let record = tabs.get(tabId);
    if (!record) {
      record = { id: tabId, url: DEFAULT_BROWSER_URL, title: '' };
      tabs.set(tabId, record);
      order.push(tabId);
    }

    if (!activeTabIdByWorkspace.get(workspaceId)) {
      activeTabIdByWorkspace.set(workspaceId, tabId);
    }

    return { url: record.url, title: record.title };
  });

  ipcMain.handle(BROWSER_CLOSE_TAB, (_, workspaceId: string, tabId: string) => {
    if (!workspaceId || !tabId) {
      return false;
    }

    const tabs = tabRecordsByWorkspace.get(workspaceId);
    const order = tabOrderByWorkspace.get(workspaceId);
    if (!tabs || !order || !tabs.has(tabId)) {
      return false;
    }

    if (tabs.size <= 1) {
      // Refuse to remove the last tracked tab — last-tab close must come from
      // dispose/hide flow, not from the tab close UI.
      return false;
    }

    const removedIndex = order.indexOf(tabId);
    tabs.delete(tabId);
    if (removedIndex !== -1) {
      order.splice(removedIndex, 1);
    }

    if (activeTabIdByWorkspace.get(workspaceId) === tabId) {
      const fallback = order[Math.min(removedIndex, order.length - 1)] ?? order[0] ?? null;
      if (fallback) {
        activeTabIdByWorkspace.set(workspaceId, fallback);
      } else {
        activeTabIdByWorkspace.delete(workspaceId);
      }
    }

    return true;
  });

  ipcMain.handle(BROWSER_SWITCH_TAB, (_, workspaceId: string, tabId: string) => {
    if (!workspaceId || !tabId) {
      return null;
    }

    const tabs = tabRecordsByWorkspace.get(workspaceId);
    const record = tabs?.get(tabId);
    if (!record) {
      return null;
    }

    activeTabIdByWorkspace.set(workspaceId, tabId);
    return { url: record.url, title: record.title };
  });

  ipcMain.handle(BROWSER_GET_TABS, (_, workspaceId: string) => {
    if (!workspaceId) {
      return [];
    }

    const tabs = tabRecordsByWorkspace.get(workspaceId);
    const order = tabOrderByWorkspace.get(workspaceId);
    if (!tabs || !order) {
      return [];
    }

    return order
      .map((id) => tabs.get(id))
      .filter((record): record is TabRecord => record != null)
      .map((record) => ({ tabId: record.id, url: record.url, title: record.title }));
  });

  ipcMain.handle(BROWSER_TAB_NAVIGATE, (_, workspaceId: string, tabId: string, url: string) => {
    if (!workspaceId || !tabId) {
      return false;
    }

    const safeUrl = normalizeAppBrowserUrl(url);
    if (!safeUrl) {
      return false;
    }

    const tabs = getOrCreateTabMap(workspaceId);
    const record = tabs.get(tabId);
    if (!record) {
      return false;
    }
    record.url = safeUrl;

    // Phase 1: apply navigation to the underlying single view if this tab is
    // active for the workspace. Otherwise just record the url; Phase 2 will
    // route navigation to the tab's own WebContentsView.
    const activeTabId = activeTabIdByWorkspace.get(workspaceId);
    if (activeTabId === tabId) {
      const entry = ensureBrowserViewEntry(workspaceId, deps);
      if (entry) {
        entry.url = safeUrl;
        void entry.view.webContents.loadURL(safeUrl);
      }
    }

    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(BROWSER_URL_UPDATED, { workspaceId, tabId, url: safeUrl });
    }

    return true;
  });

  ipcMain.on(BROWSER_URL_UPDATED, () => { });
  ipcMain.on(FIT_ALL_PANES, () => { });
}

/** Test-only: clear all in-memory tab tracking state. */
export function __resetBrowserTabState(): void {
  tabRecordsByWorkspace.clear();
  tabOrderByWorkspace.clear();
  activeTabIdByWorkspace.clear();
}

export { createBrowserViewForWorkspace, ensureBrowserViewEntry, setActiveBrowserWorkspace, updateBrowserView, hideBrowserView, destroyBrowserView };
