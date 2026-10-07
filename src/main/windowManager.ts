/**
 * Window Manager
 *
 * Manages the main BrowserWindow creation and lifecycle.
 * Extracted from main.ts per S2.6.
 */

import { app, BrowserWindow, Menu, type Event } from 'electron';
import * as path from 'path';

import { DEFAULT_THEME_ID, normalizeThemeId, getThemeMetadata, type ThemeId } from '../shared/types/theme';

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
  onWindowClose?: (event: Event) => void;
  onQuerySessionEnd?: (event: Event) => void;
  onRendererGone?: () => void;
  backgroundColor?: string;
  /** Saved theme, passed to the page so its boot splash paints in the right colours before any script runs. */
  theme?: ThemeId;
  show?: boolean;
}

/**
 * Resolves the initial window background color from the persisted theme in store.
 */
export function resolveInitialTheme(targetStore: { get: (key: string) => unknown }): ThemeId {
  return normalizeThemeId(targetStore.get('theme'));
}

export function resolveInitialWindowBackground(targetStore: { get: (key: string) => unknown }): string {
  return getThemeMetadata(resolveInitialTheme(targetStore)).windowBackground;
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
 * Resolve loose development/build assets from the app root, and the packaged
 * extraResource outside app.asar. This also supports `npm start` after a build.
 */
export function getIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'src/assets/branding/generated/clanker-app-512.png');
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
    theme = DEFAULT_THEME_ID,
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

  // Show the window as soon as index.html's static boot splash has painted, so a
  // cold start shows the logo instead of nothing while the bundle loads. The
  // renderer's WINDOW_READY_TO_SHOW remains a fallback for the same show.
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
  });

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(getRendererUrl({ theme }));
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'), { query: { theme } });
  }

  const cleanup = () => {
    gitService.stopPolling();
    fileWatcher.unwatchAll();
    deps.explorerWatcher?.close();
    onWindowClosed?.();
  };

  if (deps.onWindowClose) mainWindow.on('close', deps.onWindowClose);
  if (deps.onQuerySessionEnd) mainWindow.on('query-session-end', deps.onQuerySessionEnd);
  mainWindow.on('closed', cleanup);
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (process.env.NODE_ENV === 'development') {
      console.error(
        `[diag] main renderer gone webContents=${mainWindow.webContents.id} reason=${details?.reason} exitCode=${details?.exitCode}`,
      );
    }
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
