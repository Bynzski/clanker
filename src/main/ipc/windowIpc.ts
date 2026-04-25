/**
 * Window Control IPC Handlers
 *
 * Registers IPC handlers for window control operations (minimize, maximize, close, zoom).
 * Separated from settingsIpc.ts per concern separation.
 */

import { ipcMain, BrowserWindow } from 'electron';
import {
  MINIMIZE_WINDOW,
  TOGGLE_MAXIMIZE_WINDOW,
  CLOSE_WINDOW,
  IS_MAXIMIZED_WINDOW,
  ZOOM_IN_WINDOW,
  ZOOM_OUT_WINDOW,
  RESET_ZOOM_WINDOW,
} from '../../shared/ipcChannels';

type ZoomableBrowserEntry = {
  view: { webContents: Pick<BrowserWindow['webContents'], 'getZoomLevel' | 'setZoomLevel'> };
};
type FlatBrowserViewMap = Map<string, ZoomableBrowserEntry>;
type NestedBrowserViewMap = Map<string, FlatBrowserViewMap>;
type BrowserViewMap = FlatBrowserViewMap | NestedBrowserViewMap;

interface RegisterWindowIpcDeps {
  getMainWindow: () => BrowserWindow | null;
  getBrowserViews?: () => BrowserViewMap;
}

function clampZoomLevel(level: number): number {
  return Math.max(-5, Math.min(5, level));
}

function isZoomableBrowserEntry(value: unknown): value is ZoomableBrowserEntry {
  return typeof value === 'object'
    && value !== null
    && 'view' in value
    && typeof (value as ZoomableBrowserEntry).view?.webContents?.getZoomLevel === 'function'
    && typeof (value as ZoomableBrowserEntry).view?.webContents?.setZoomLevel === 'function';
}

function forEachBrowserViewEntry(browserViews: BrowserViewMap, callback: (entry: ZoomableBrowserEntry) => void): void {
  for (const value of browserViews.values()) {
    if (isZoomableBrowserEntry(value)) {
      callback(value);
      continue;
    }

    if (value instanceof Map) {
      for (const nestedValue of value.values()) {
        if (isZoomableBrowserEntry(nestedValue)) {
          callback(nestedValue);
        }
      }
    }
  }
}

function applyBrowserViewZoomDelta(
  getBrowserViews: (() => BrowserViewMap) | undefined,
  delta: number
): void {
  if (!getBrowserViews || delta === 0) {
    return;
  }

  forEachBrowserViewEntry(getBrowserViews(), ({ view }) => {
    const nextLevel = view.webContents.getZoomLevel() + delta;
    view.webContents.setZoomLevel(nextLevel);
  });
}

function adjustWindowZoom(
  getMainWindow: () => BrowserWindow | null,
  getBrowserViews: (() => BrowserViewMap) | undefined,
  delta: number
): void {
  const mainWindow = getMainWindow();
  if (!mainWindow) {
    return;
  }

  const currentLevel = mainWindow.webContents.getZoomLevel();
  const nextLevel = clampZoomLevel(currentLevel + delta);
  mainWindow.webContents.setZoomLevel(nextLevel);
  applyBrowserViewZoomDelta(getBrowserViews, nextLevel - currentLevel);
}

function resetWindowZoom(
  getMainWindow: () => BrowserWindow | null,
  getBrowserViews: (() => BrowserViewMap) | undefined
): void {
  const mainWindow = getMainWindow();
  if (!mainWindow) {
    return;
  }

  const currentLevel = mainWindow.webContents.getZoomLevel();
  mainWindow.webContents.setZoomLevel(0);
  applyBrowserViewZoomDelta(getBrowserViews, -currentLevel);
}

export function registerWindowIpc(deps: RegisterWindowIpcDeps): void {
  const { getMainWindow, getBrowserViews } = deps;

  ipcMain.handle(MINIMIZE_WINDOW, () => {
    getMainWindow()?.minimize();
  });

  ipcMain.handle(TOGGLE_MAXIMIZE_WINDOW, () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.handle(CLOSE_WINDOW, () => {
    getMainWindow()?.close();
  });

  ipcMain.handle(IS_MAXIMIZED_WINDOW, () => {
    return getMainWindow()?.isMaximized() ?? false;
  });

  ipcMain.handle(ZOOM_IN_WINDOW, () => {
    adjustWindowZoom(getMainWindow, getBrowserViews, 0.5);
  });

  ipcMain.handle(ZOOM_OUT_WINDOW, () => {
    adjustWindowZoom(getMainWindow, getBrowserViews, -0.5);
  });

  ipcMain.handle(RESET_ZOOM_WINDOW, () => {
    resetWindowZoom(getMainWindow, getBrowserViews);
  });
}

export {
  clampZoomLevel,
  adjustWindowZoom,
  resetWindowZoom,
  forEachBrowserViewEntry,
};
