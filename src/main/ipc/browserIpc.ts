/**
 * Browser IPC Handlers
 *
 * Registers all browser-related IPC handlers and manages WebContentsView instances.
 * Each workspace gets its own WebContentsView but they all share a global partition
 * for cookies and session data. Extracted from main.ts per S2.2.
 */

import { ipcMain, BrowserWindow, WebContentsView, shell } from 'electron';
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
  FIT_ALL_PANES,
} from '../../shared/ipcChannels';

interface BrowserViewEntry {
  view: WebContentsView;
  url: string;
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

function attachBrowserShortcutHandlers(view: WebContentsView, sendFitAllPanes: () => void) {
  view.webContents.on('before-input-event', (event, input) => {
    if (isBrowserKeyboardZoomShortcut(input)) {
      event.preventDefault();
      return;
    }

    if ((input.control || input.meta) && input.shift && input.key?.toLowerCase() === 'f') {
      sendFitAllPanes();
    }
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
    const win = deps.getMainWindow();
    if (win) {
      win.webContents.send(BROWSER_URL_UPDATED, { workspaceId, url: safeUrl });
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
    return;
  }

  entry.view.webContents.close();
  deps.getBrowserViews().delete(workspaceId);

  if (deps.getActiveBrowserWorkspaceId() === workspaceId) {
    deps.setActiveBrowserWorkspaceId(null);
  }
}

export function registerBrowserIpc(deps: RegisterBrowserIpcDeps): void {
  const { getMainWindow, getBrowserViews } = deps;

  ipcMain.handle(BROWSER_SET_BOUNDS, (_, workspaceId: string, viewportBounds: { x: number; y: number; width: number; height: number }) => {
    if (!workspaceId) {
      return;
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

  ipcMain.handle(BROWSER_NAVIGATE, (_, workspaceId: string, url: string) => {
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

    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(BROWSER_URL_UPDATED, { workspaceId, url: safeUrl });
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

  ipcMain.on(BROWSER_URL_UPDATED, () => { });
  ipcMain.on(FIT_ALL_PANES, () => { });
}

export { createBrowserViewForWorkspace, ensureBrowserViewEntry, setActiveBrowserWorkspace, updateBrowserView, hideBrowserView, destroyBrowserView };
