/**
 * Browser IPC Handlers
 *
 * Registers all browser-related IPC handlers and manages tab-scoped
 * WebContentsView instances owned by the Electron main process.
 */

import { ipcMain, BrowserWindow, Menu, WebContentsView, shell, type Rectangle } from 'electron';
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
  BROWSER_HISTORY_ADD,
  BROWSER_HISTORY_GET,
  BROWSER_HISTORY_CLEAR,
  FIT_ALL_PANES,
} from '../../shared/ipcChannels';
import { getBrowserHistoryService } from '../browserHistory';

export interface BrowserViewEntry {
  view: WebContentsView;
  url: string;
  title: string;
}

export type BrowserWorkspaceViews = Map<string, BrowserViewEntry>;
export type BrowserViewsByWorkspace = Map<string, BrowserWorkspaceViews>;

const tabOrderByWorkspace = new Map<string, string[]>();
const activeTabIdsByWorkspace = new Map<string, string>();
const lastBrowserBoundsByWorkspace = new Map<string, Rectangle>();

interface RegisterBrowserIpcDeps {
  getMainWindow: () => BrowserWindow | null;
  getBrowserViews: () => BrowserViewsByWorkspace;
  getActiveBrowserWorkspaceId: () => string | null;
  setActiveBrowserWorkspaceId: (id: string | null) => void;
  onActiveBrowserTabChanged?: (workspaceId: string, tabId: string | null) => void;
}

const DEFAULT_BROWSER_URL = 'https://github.com';

/**
 * Fallback tab ID used by workspace-scoped browser APIs (e.g. BROWSER_NAVIGATE
 * without a tabId) when no active tab is known for the workspace. This is a
 * supported backward-compatible API surface — the renderer may call
 * browserNavigate/builderSetBounds without a tabId when the tab state is
 * not yet initialized.
 */
const FALLBACK_TAB_ID = '__fallback_tab__';

function getWorkspaceTabViews(workspaceId: string, deps: RegisterBrowserIpcDeps): BrowserWorkspaceViews {
  let workspaceViews = deps.getBrowserViews().get(workspaceId);
  if (!workspaceViews) {
    workspaceViews = new Map();
    deps.getBrowserViews().set(workspaceId, workspaceViews);
  }
  return workspaceViews;
}

function getExistingWorkspaceTabViews(workspaceId: string, deps: RegisterBrowserIpcDeps): BrowserWorkspaceViews | undefined {
  return deps.getBrowserViews().get(workspaceId);
}

function getTabOrder(workspaceId: string): string[] {
  let order = tabOrderByWorkspace.get(workspaceId);
  if (!order) {
    order = [];
    tabOrderByWorkspace.set(workspaceId, order);
  }
  return order;
}

function rememberTabId(workspaceId: string, tabId: string): void {
  const order = getTabOrder(workspaceId);
  if (!order.includes(tabId)) {
    order.push(tabId);
  }
}

function forgetTabId(workspaceId: string, tabId: string): void {
  const order = tabOrderByWorkspace.get(workspaceId);
  if (!order) return;
  const index = order.indexOf(tabId);
  if (index !== -1) {
    order.splice(index, 1);
  }
  if (order.length === 0) {
    tabOrderByWorkspace.delete(workspaceId);
  }
}

function getActiveTabId(workspaceId: string): string | null {
  return activeTabIdsByWorkspace.get(workspaceId) ?? null;
}

function setActiveTabId(workspaceId: string, tabId: string | null, deps?: RegisterBrowserIpcDeps): void {
  const previousTabId = activeTabIdsByWorkspace.get(workspaceId) ?? null;
  if (tabId) {
    activeTabIdsByWorkspace.set(workspaceId, tabId);
    rememberTabId(workspaceId, tabId);
  } else {
    activeTabIdsByWorkspace.delete(workspaceId);
  }
  if (previousTabId !== tabId) {
    deps?.onActiveBrowserTabChanged?.(workspaceId, tabId);
  }
}



function getActiveViewEntry(workspaceId: string, deps: RegisterBrowserIpcDeps): BrowserViewEntry | null {
  const activeTabId = getActiveTabId(workspaceId);
  if (!activeTabId) return null;
  return getExistingWorkspaceTabViews(workspaceId, deps)?.get(activeTabId) ?? null;
}

function isBrowserKeyboardZoomShortcut(input: {
  control: boolean;
  meta: boolean;
  alt: boolean;
  key?: string;
  code?: string;
}): boolean {
  const primaryModifier = input.control || input.meta;
  if (!primaryModifier || input.alt) return false;

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
  if (input.alt) return false;
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
        click: () => view.webContents.openDevTools({ mode: 'detach' }),
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
  if (appZoomLevel === 0) return;
  view.webContents.setZoomLevel(view.webContents.getZoomLevel() + appZoomLevel);
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

function createBrowserViewForTab(
  workspaceId: string,
  tabId: string,
  deps: RegisterBrowserIpcDeps,
): BrowserViewEntry | null {
  const mainWindow = deps.getMainWindow();
  if (!mainWindow || !tabId) return null;

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

  const entry: BrowserViewEntry = { view, url: DEFAULT_BROWSER_URL, title: '' };

  const reportUrlChange = (navigatedUrl: string) => {
    const safeUrl = normalizeAppBrowserUrl(navigatedUrl);
    if (!safeUrl) return;

    entry.url = safeUrl;
    const title = view.webContents.getTitle();
    if (typeof title === 'string') {
      entry.title = title;
    }

    deps.getMainWindow()?.webContents.send(BROWSER_URL_UPDATED, {
      workspaceId,
      tabId,
      url: safeUrl,
      title,
      canGoBack: view.webContents.navigationHistory.canGoBack(),
      canGoForward: view.webContents.navigationHistory.canGoForward(),
    });
    getBrowserHistoryService().add(safeUrl, title);
  };

  view.webContents.on('did-navigate', (_event, url) => reportUrlChange(url));
  view.webContents.on('did-navigate-in-page', (_event, url) => reportUrlChange(url));

  void view.webContents.loadURL(DEFAULT_BROWSER_URL);
  return entry;
}

function ensureTabViewEntry(
  workspaceId: string,
  tabId: string,
  deps: RegisterBrowserIpcDeps,
): BrowserViewEntry | null {
  if (!workspaceId || !tabId) return null;

  const workspaceViews = getWorkspaceTabViews(workspaceId, deps);
  const existing = workspaceViews.get(tabId);
  if (existing) {
    rememberTabId(workspaceId, tabId);
    return existing;
  }

  const entry = createBrowserViewForTab(workspaceId, tabId, deps);
  if (!entry) return null;

  workspaceViews.set(tabId, entry);
  rememberTabId(workspaceId, tabId);
  return entry;
}

function hideWorkspaceTabViews(workspaceId: string, deps: RegisterBrowserIpcDeps): void {
  const workspaceViews = getExistingWorkspaceTabViews(workspaceId, deps);
  if (!workspaceViews) return;
  for (const { view } of workspaceViews.values()) {
    view.setVisible(false);
  }
}

function hideAllOtherWorkspaceTabViews(workspaceId: string, deps: RegisterBrowserIpcDeps): void {
  for (const [candidateWorkspaceId] of deps.getBrowserViews()) {
    if (candidateWorkspaceId !== workspaceId) {
      hideWorkspaceTabViews(candidateWorkspaceId, deps);
    }
  }
}

function showTabView(workspaceId: string, tabId: string, deps: RegisterBrowserIpcDeps): boolean {
  const entry = getExistingWorkspaceTabViews(workspaceId, deps)?.get(tabId);
  const bounds = lastBrowserBoundsByWorkspace.get(workspaceId);
  if (!entry || !bounds) return false;

  hideAllOtherWorkspaceTabViews(workspaceId, deps);
  hideWorkspaceTabViews(workspaceId, deps);
  if (bounds.width > 0 && bounds.height > 0) {
    entry.view.setBounds(bounds);
  }
  entry.view.setVisible(true);
  deps.setActiveBrowserWorkspaceId(workspaceId);
  return true;
}

function destroyTabView(workspaceId: string, tabId: string, deps: RegisterBrowserIpcDeps): boolean {
  const workspaceViews = getExistingWorkspaceTabViews(workspaceId, deps);
  const entry = workspaceViews?.get(tabId);
  if (!workspaceViews || !entry) return false;

  entry.view.setVisible(false);
  entry.view.webContents.close();
  workspaceViews.delete(tabId);
  forgetTabId(workspaceId, tabId);

  if (workspaceViews.size === 0) {
    deps.getBrowserViews().delete(workspaceId);
  }
  return true;
}

function destroyWorkspaceBrowserViews(workspaceId: string, deps: RegisterBrowserIpcDeps): void {
  const workspaceViews = getExistingWorkspaceTabViews(workspaceId, deps);
  if (workspaceViews) {
    for (const { view } of workspaceViews.values()) {
      view.setVisible(false);
      view.webContents.close();
    }
    workspaceViews.clear();
  }

  deps.getBrowserViews().delete(workspaceId);
  tabOrderByWorkspace.delete(workspaceId);
  activeTabIdsByWorkspace.delete(workspaceId);
  lastBrowserBoundsByWorkspace.delete(workspaceId);

  if (deps.getActiveBrowserWorkspaceId() === workspaceId) {
    deps.setActiveBrowserWorkspaceId(null);
  }
  deps.onActiveBrowserTabChanged?.(workspaceId, null);
}

function resolveTabIdForWorkspace(workspaceId: string, requestedTabId: string | undefined): string | null {
  if (requestedTabId) return requestedTabId;
  const activeTabId = getActiveTabId(workspaceId);
  if (activeTabId) return activeTabId;
  return tabOrderByWorkspace.get(workspaceId)?.[0] ?? FALLBACK_TAB_ID;
}

function selectFallbackTab(workspaceId: string, removedTabId: string): string | null {
  const order = tabOrderByWorkspace.get(workspaceId) ?? [];
  const removedIndex = order.indexOf(removedTabId);
  const remaining = order.filter((id) => id !== removedTabId);
  if (remaining.length === 0) return null;
  if (removedIndex === -1) return remaining[0] ?? null;
  return remaining[Math.min(removedIndex, remaining.length - 1)] ?? remaining[0] ?? null;
}

function getActiveBrowserEntryForOperation(workspaceId: string, deps: RegisterBrowserIpcDeps): BrowserViewEntry | null {
  return getActiveViewEntry(workspaceId, deps);
}

export function registerBrowserIpc(deps: RegisterBrowserIpcDeps): void {
  const { getMainWindow } = deps;

  ipcMain.handle(BROWSER_SET_BOUNDS, (
    _,
    workspaceId: string,
    viewportBounds: Rectangle,
    tabId?: string,
  ) => {
    if (!workspaceId) return;

    const bounds = {
      x: viewportBounds.x,
      y: viewportBounds.y,
      width: viewportBounds.width,
      height: viewportBounds.height,
    };
    lastBrowserBoundsByWorkspace.set(workspaceId, bounds);

    const targetTabId = resolveTabIdForWorkspace(workspaceId, tabId);
    if (!targetTabId) {
      return;
    }

    const entry = ensureTabViewEntry(workspaceId, targetTabId, deps);
    if (!entry) return;

    setActiveTabId(workspaceId, targetTabId, deps);
    showTabView(workspaceId, targetTabId, deps);
  });

  ipcMain.handle(BROWSER_HIDE, (_, workspaceId: string) => {
    if (!workspaceId) return;
    hideWorkspaceTabViews(workspaceId, deps);
    if (deps.getActiveBrowserWorkspaceId() === workspaceId) {
      deps.setActiveBrowserWorkspaceId(null);
    }
  });

  ipcMain.handle(BROWSER_NAVIGATE, (_, workspaceId: string, url: string, tabId?: string) => {
    if (!workspaceId) return false;
    const safeUrl = normalizeAppBrowserUrl(url);
    if (!safeUrl) return false;

    const targetTabId = resolveTabIdForWorkspace(workspaceId, tabId);
    if (!targetTabId) return false;

    const entry = ensureTabViewEntry(workspaceId, targetTabId, deps);
    if (!entry) return false;

    entry.url = safeUrl;
    setActiveTabId(workspaceId, targetTabId, deps);
    getMainWindow()?.webContents.send(BROWSER_URL_UPDATED, { workspaceId, tabId: targetTabId, url: safeUrl });
    void entry.view.webContents.loadURL(safeUrl);
    return true;
  });

  ipcMain.handle(BROWSER_BACK, (_, workspaceId: string) => {
    if (!workspaceId) return;
    const entry = getActiveBrowserEntryForOperation(workspaceId, deps);
    if (entry?.view.webContents.navigationHistory.canGoBack()) {
      entry.view.webContents.navigationHistory.goBack();
    }
  });

  ipcMain.handle(BROWSER_FORWARD, (_, workspaceId: string) => {
    if (!workspaceId) return;
    const entry = getActiveBrowserEntryForOperation(workspaceId, deps);
    if (entry?.view.webContents.navigationHistory.canGoForward()) {
      entry.view.webContents.navigationHistory.goForward();
    }
  });

  ipcMain.handle(BROWSER_REFRESH, (_, workspaceId: string) => {
    if (!workspaceId) return;
    getActiveBrowserEntryForOperation(workspaceId, deps)?.view.webContents.reload();
  });

  ipcMain.handle(BROWSER_STOP, (_, workspaceId: string) => {
    if (!workspaceId) return;
    getActiveBrowserEntryForOperation(workspaceId, deps)?.view.webContents.stop();
  });

  ipcMain.handle(BROWSER_DISPOSE_WORKSPACE, (_, workspaceId: string) => {
    if (!workspaceId) return;
    destroyWorkspaceBrowserViews(workspaceId, deps);
  });

  ipcMain.handle(OPEN_EXTERNAL, (_, url: string) => {
    const safeUrl = normalizeExternalUrl(url);
    if (!safeUrl) return false;
    void shell.openExternal(safeUrl);
    return true;
  });

  ipcMain.handle(CAN_GO_BACK, (_, workspaceId: string) => {
    if (!workspaceId) return false;
    return getActiveBrowserEntryForOperation(workspaceId, deps)?.view.webContents.navigationHistory.canGoBack() ?? false;
  });

  ipcMain.handle(CAN_GO_FORWARD, (_, workspaceId: string) => {
    if (!workspaceId) return false;
    return getActiveBrowserEntryForOperation(workspaceId, deps)?.view.webContents.navigationHistory.canGoForward() ?? false;
  });

  ipcMain.handle(BROWSER_GET_URL, (_, workspaceId: string) => {
    return getActiveBrowserEntryForOperation(workspaceId, deps)?.url ?? null;
  });

  ipcMain.handle(BROWSER_SAVE_URL, (_, workspaceId: string, url: string) => {
    const safeUrl = normalizeAppBrowserUrl(url);
    if (!safeUrl) return false;
    const entry = getActiveBrowserEntryForOperation(workspaceId, deps);
    if (!entry) return false;
    entry.url = safeUrl;
    return true;
  });

  ipcMain.handle(BROWSER_CREATE_TAB, (_, workspaceId: string, tabId: string) => {
    if (!workspaceId || !tabId) return { url: '', title: '' };
    const entry = ensureTabViewEntry(workspaceId, tabId, deps);
    if (!entry) return { url: '', title: '' };

    if (!getActiveTabId(workspaceId)) {
      setActiveTabId(workspaceId, tabId, deps);
    }
    return { url: entry.url, title: entry.title };
  });

  ipcMain.handle(BROWSER_CLOSE_TAB, (_, workspaceId: string, tabId: string) => {
    if (!workspaceId || !tabId) return false;

    const workspaceViews = getExistingWorkspaceTabViews(workspaceId, deps);
    if (!workspaceViews?.has(tabId)) return false;

    if (workspaceViews.size <= 1) {
      return false;
    }

    const closingActive = getActiveTabId(workspaceId) === tabId;
    const fallbackTabId = closingActive ? selectFallbackTab(workspaceId, tabId) : getActiveTabId(workspaceId);

    destroyTabView(workspaceId, tabId, deps);

    if (closingActive) {
      setActiveTabId(workspaceId, fallbackTabId, deps);
      if (fallbackTabId && deps.getActiveBrowserWorkspaceId() === workspaceId) {
        showTabView(workspaceId, fallbackTabId, deps);
      }
    }

    return true;
  });

  ipcMain.handle(BROWSER_SWITCH_TAB, (_, workspaceId: string, tabId: string) => {
    if (!workspaceId || !tabId) return null;

    const entry = getExistingWorkspaceTabViews(workspaceId, deps)?.get(tabId);
    if (!entry) return null;

    setActiveTabId(workspaceId, tabId, deps);
    if (deps.getActiveBrowserWorkspaceId() === workspaceId || lastBrowserBoundsByWorkspace.has(workspaceId)) {
      showTabView(workspaceId, tabId, deps);
    }
    return { url: entry.url, title: entry.title };
  });

  ipcMain.handle(BROWSER_GET_TABS, (_, workspaceId: string) => {
    if (!workspaceId) return [];
    const workspaceViews = getExistingWorkspaceTabViews(workspaceId, deps);
    const order = tabOrderByWorkspace.get(workspaceId) ?? [];
    if (!workspaceViews) return [];

    return order
      .map((id) => {
        const entry = workspaceViews.get(id);
        return entry ? { tabId: id, url: entry.url, title: entry.title } : null;
      })
      .filter((entry): entry is { tabId: string; url: string; title: string } => entry != null);
  });

  ipcMain.handle(BROWSER_HISTORY_ADD, (_, url: string, title?: string) => {
    return getBrowserHistoryService().add(url, title);
  });

  ipcMain.handle(BROWSER_HISTORY_GET, (_, prefix?: string) => {
    return getBrowserHistoryService().query(prefix);
  });

  ipcMain.handle(BROWSER_HISTORY_CLEAR, () => {
    return getBrowserHistoryService().clear();
  });

  ipcMain.handle(BROWSER_TAB_NAVIGATE, (_, workspaceId: string, tabId: string, url: string) => {
    if (!workspaceId || !tabId) return false;
    const safeUrl = normalizeAppBrowserUrl(url);
    if (!safeUrl) return false;

    const entry = ensureTabViewEntry(workspaceId, tabId, deps);
    if (!entry) return false;

    entry.url = safeUrl;
    getMainWindow()?.webContents.send(BROWSER_URL_UPDATED, { workspaceId, tabId, url: safeUrl });
    if (getActiveTabId(workspaceId) === tabId) {
      void entry.view.webContents.loadURL(safeUrl);
    }
    return true;
  });

  ipcMain.on(BROWSER_URL_UPDATED, () => { });
  ipcMain.on(FIT_ALL_PANES, () => { });
}

/** Test-only: clear all in-memory tab tracking state. */
export function __resetBrowserTabState(): void {
  tabOrderByWorkspace.clear();
  activeTabIdsByWorkspace.clear();
  lastBrowserBoundsByWorkspace.clear();
}

/** Test-only/introspection helpers. */
export {
  DEFAULT_BROWSER_URL,
  getWorkspaceTabViews,
  getActiveTabId,
  setActiveTabId,
  ensureTabViewEntry,
  hideWorkspaceTabViews,
  showTabView,
  destroyTabView,
  destroyWorkspaceBrowserViews,
  createBrowserViewForTab,
};
