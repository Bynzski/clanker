/**
 * Window Manager
 *
 * Manages the main BrowserWindow creation and lifecycle.
 * Extracted from main.ts per S2.6.
 */

import { BrowserWindow, Menu, WebContentsView } from 'electron';
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

  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAutoHideMenuBar(true);
  Menu.setApplicationMenu(null);

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(getRendererUrl({}));
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  const cleanup = () => {
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
