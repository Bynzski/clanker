/**
 * Window Manager
 *
 * Manages the main BrowserWindow creation and lifecycle.
 * Extracted from main.ts per S2.6.
 */

import { BrowserWindow, Menu, WebContentsView, globalShortcut } from 'electron';
import * as path from 'path';

export interface WindowManagerDeps {
  getPreloadPath: () => string;
}

export interface CreateMainWindowOptions {
  preloadPath: string;
  gitService: {
    stopPolling: () => void;
  };
  browserViews: Map<string, { view: WebContentsView; url: string }>;
  onWindowClosed?: () => void;
}

/**
 * Build the renderer URL with optional query parameters.
 */
export function getRendererUrl(query: Record<string, string | null | undefined>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value.length > 0) {
      searchParams.set(key, value);
    }
  }
  const queryString = searchParams.toString();

  if (process.env.NODE_ENV === 'development') {
    return `http://localhost:1420${queryString ? `/?${queryString}` : '/'}`;
  }

  const fileUrl = path.join(__dirname, '../renderer/index.html');
  return queryString ? `${fileUrl}?${queryString}` : fileUrl;
}

/**
 * Get the path to the application icon based on environment.
 */
export function getIconPath(): string {
  if (process.env.NODE_ENV === 'development') {
    return path.join(__dirname, '../build/icon.png');
  }
  return path.join(process.resourcesPath, 'icon.png');
}

/**
 * Creates the main application window.
 * Returns the created BrowserWindow and a cleanup function.
 */
export function createMainWindow(deps: CreateMainWindowOptions): {
  window: BrowserWindow;
  cleanup: () => void;
} {
  const { preloadPath, gitService, browserViews, onWindowClosed } = deps;

  // Module-level reference for global shortcut callbacks
  let windowRef: BrowserWindow | null = null;

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Clanker Grid',
    backgroundColor: '#0d1117',
    icon: getIconPath(),
    show: true,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: preloadPath,
    },
  });

  // Store reference for global shortcut callbacks
  windowRef = mainWindow;

  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAutoHideMenuBar(true);
  Menu.setApplicationMenu(null);

  // Register zoom shortcuts
  const registerZoomShortcuts = () => {
    // Zoom In: Ctrl+= (also handles Ctrl+Plus)
    if (!globalShortcut.register('CommandOrControl+=', () => {
      windowRef?.webContents.setZoomLevel(windowRef.webContents.getZoomLevel() + 0.5);
    })) {
      console.error('[windowManager] Failed to register Ctrl+= zoom shortcut');
    }

    // Zoom Out: Ctrl+- (also handles Ctrl+Minus)
    if (!globalShortcut.register('CommandOrControl+-', () => {
      windowRef?.webContents.setZoomLevel(windowRef.webContents.getZoomLevel() - 0.5);
    })) {
      console.error('[windowManager] Failed to register Ctrl+- zoom shortcut');
    }
  };

  const unregisterZoomShortcuts = () => {
    globalShortcut.unregisterAll();
  };

  registerZoomShortcuts();

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(getRendererUrl({}));
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  const cleanup = () => {
    // Clear reference so callbacks don't access closed window
    windowRef = null;
    unregisterZoomShortcuts();
    browserViews.forEach(({ view }) => {
      view.webContents.close();
    });
    browserViews.clear();
    gitService.stopPolling();
    onWindowClosed?.();
  };

  mainWindow.on('closed', cleanup);

  return {
    window: mainWindow,
    cleanup,
  };
}

/**
 * Get the preload script path for the main window.
 */
export function getPreloadPath(): string {
  return path.join(__dirname, 'preload.js');
}
