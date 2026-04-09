/**
 * Browser IPC Handlers
 *
 * Registers all browser-related IPC handlers and manages WebContentsView instances.
 * Extracted from main.ts per S2.2.
 */

import { ipcMain, BrowserWindow, WebContentsView, shell } from 'electron';
import {
  normalizeAppBrowserUrl,
  normalizeExternalUrl,
} from '../security';

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

function attachBrowserShortcutHandlers(view: WebContentsView, sendFitAllPanes: () => void) {
  view.webContents.on('before-input-event', (_event, input) => {
    if (
      (input.control || input.meta) &&
      input.shift &&
      input.key.toLowerCase() === 'f'
    ) {
      sendFitAllPanes();
    }
  });
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
      partition: `persist:browser-${workspaceId}`,
    },
  });

  attachBrowserSecurityHandlers(view);
  attachBrowserShortcutHandlers(view, () => {
    const win = deps.getMainWindow();
    if (win) {
      win.webContents.send('fit-all-panes');
    }
  });
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
      win.webContents.send('browser-url-updated', { workspaceId, url: safeUrl });
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
  entry.view.setVisible(true);

  if (bounds.width > 0 && bounds.height > 0) {
    entry.view.setBounds(bounds);
  }
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

  // Browser view with viewport coordinates
  ipcMain.handle('browser-set-bounds', (_, workspaceId: string, viewportBounds: { x: number; y: number; width: number; height: number }) => {
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

  ipcMain.handle('browser-hide', (_, workspaceId: string) => {
    if (!workspaceId) {
      return;
    }

    hideBrowserView(workspaceId, deps);
  });

  ipcMain.handle('browser-navigate', (_, workspaceId: string, url: string) => {
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

    // Notify URL update
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send('browser-url-updated', { workspaceId, url: safeUrl });
    }

    void entry.view.webContents.loadURL(safeUrl);
    return true;
  });

  ipcMain.handle('browser-back', (_, workspaceId: string) => {
    if (!workspaceId) {
      return;
    }

    const entry = getBrowserViews().get(workspaceId);
    if (entry && entry.view.webContents.navigationHistory.canGoBack()) {
      entry.view.webContents.navigationHistory.goBack();
    }
  });

  ipcMain.handle('browser-forward', (_, workspaceId: string) => {
    if (!workspaceId) {
      return;
    }

    const entry = getBrowserViews().get(workspaceId);
    if (entry && entry.view.webContents.navigationHistory.canGoForward()) {
      entry.view.webContents.navigationHistory.goForward();
    }
  });

  ipcMain.handle('browser-refresh', (_, workspaceId: string) => {
    if (!workspaceId) {
      return;
    }

    const entry = getBrowserViews().get(workspaceId);
    if (entry) {
      entry.view.webContents.reload();
    }
  });

  ipcMain.handle('browser-stop', (_, workspaceId: string) => {
    if (!workspaceId) {
      return;
    }

    const entry = getBrowserViews().get(workspaceId);
    if (entry) {
      entry.view.webContents.stop();
    }
  });

  ipcMain.handle('browser-dispose-workspace', (_, workspaceId: string) => {
    if (!workspaceId) {
      return;
    }

    destroyBrowserView(workspaceId, deps);
  });

  ipcMain.handle('open-external', (_, url: string) => {
    const safeUrl = normalizeExternalUrl(url);
    if (!safeUrl) {
      return false;
    }

    void shell.openExternal(safeUrl);
    return true;
  });

  ipcMain.handle('can-go-back', (_, workspaceId: string) => {
    if (!workspaceId) {
      return false;
    }

    const entry = getBrowserViews().get(workspaceId);
    return entry?.view.webContents.navigationHistory.canGoBack() ?? false;
  });

  ipcMain.handle('can-go-forward', (_, workspaceId: string) => {
    if (!workspaceId) {
      return false;
    }

    const entry = getBrowserViews().get(workspaceId);
    return entry?.view.webContents.navigationHistory.canGoForward() ?? false;
  });
}

// Export helpers for testing
export { createBrowserViewForWorkspace, ensureBrowserViewEntry, setActiveBrowserWorkspace, updateBrowserView, hideBrowserView, destroyBrowserView };
