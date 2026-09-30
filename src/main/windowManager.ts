/**
 * Window Manager
 *
 * Manages the main BrowserWindow creation and lifecycle.
 * Extracted from main.ts per S2.6.
 */

import { BrowserWindow, Menu } from 'electron';
import * as path from 'path';

import { DEFAULT_THEME_ID, normalizeThemeId, getThemeMetadata } from '../shared/types/theme';

/** Async resource callbacks may outlive the renderer or its window. */
export function isWindowAvailable(window: BrowserWindow | null): window is BrowserWindow {
  return !!window && !window.isDestroyed?.() && !window.webContents.isDestroyed?.() && !window.webContents.isCrashed?.();
}

export interface CreateMainWindowOptions {
  preloadPath: string;
  gitService: {
    stopPolling: () => void;
  };
  fileWatcher: {
    unwatchAll: () => void;
  };
  /** Explorer watcher service for workspace tree auto-refresh. */
  explorerWatcher?: {
    close: () => void;
  };
  onWindowClosed?: () => void;
  onRendererGone?: () => void;
  backgroundColor?: string;
  show?: boolean;
}

/**
 * Resolves the initial window background color from the persisted theme in store.
 */
export function resolveInitialWindowBackground(targetStore: { get: (key: string) => unknown }): string {
  const savedTheme = normalizeThemeId(targetStore.get('theme'));
  return getThemeMetadata(savedTheme).windowBackground;
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
 * In dev: src/assets/icons/icon-512.png
 * In prod: process.resourcesPath/icon.png (copied by electron-builder from extraResources)
 */
export function getIconPath(): string {
  if (process.env.NODE_ENV === 'development') {
    return path.join(__dirname, '../../assets/icons/icon_512x512.png');
  }
  return path.join(process.resourcesPath, 'icon.png');
}

/**
 * Returns true if debug mode is active via CLI flag or environment variables.
 */
export function isDebugMode(): boolean {
  return process.argv.includes('--debug')
    || process.env.CLANKER_DEBUG === '1'
    || process.env.DEBUG === '1';
}

/**
 * Creates the main application window.
 * Returns the created BrowserWindow and a cleanup function.
 */
export function createMainWindow(deps: CreateMainWindowOptions): {
  window: BrowserWindow;
  cleanup: () => void;
} {
  const {
    preloadPath,
    gitService,
    fileWatcher,
    onWindowClosed,
    backgroundColor = getThemeMetadata(DEFAULT_THEME_ID).windowBackground,
    show = false,
  } = deps;
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Clanker Grid',
    backgroundColor,
    icon: getIconPath(),
    show,
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

  const isDebug = isDebugMode();
  if (isDebug) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  if (isDebug || process.env.NODE_ENV === 'development') {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      const isDevTools = input.key?.toLowerCase() === 'f12'
        || ((input.control || input.meta) && input.shift && input.key?.toLowerCase() === 'i');
      if (isDevTools) {
        event.preventDefault();
        if (mainWindow.webContents.isDevToolsOpened()) {
          mainWindow.webContents.closeDevTools();
        } else {
          mainWindow.webContents.openDevTools({ mode: 'detach' });
        }
      }
    });
  }

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(getRendererUrl({}));
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  const cleanup = () => {
    gitService.stopPolling();
    fileWatcher.unwatchAll();
    deps.explorerWatcher?.close();
    onWindowClosed?.();
  };

  mainWindow.on('closed', cleanup);
  mainWindow.webContents.on('render-process-gone', () => {
    gitService.stopPolling();
    fileWatcher.unwatchAll();
    deps.explorerWatcher?.close();
    deps.onRendererGone?.();
  });

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
