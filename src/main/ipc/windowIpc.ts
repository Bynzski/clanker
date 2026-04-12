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

interface RegisterWindowIpcDeps {
  getMainWindow: () => BrowserWindow | null;
  getBrowserViews?: () => Map<string, { view: { webContents: Pick<BrowserWindow['webContents'], 'getZoomLevel' | 'setZoomLevel'> } }>;
}

function clampZoomLevel(level: number): number {
  return Math.max(-5, Math.min(5, level));
}

function applyBrowserViewZoomDelta(
  getBrowserViews: (() => Map<string, { view: { webContents: Pick<BrowserWindow['webContents'], 'getZoomLevel' | 'setZoomLevel'> } }>) | undefined,
  delta: number
): void {
  if (!getBrowserViews || delta === 0) {
    return;
  }

  for (const { view } of getBrowserViews().values()) {
    const nextLevel = view.webContents.getZoomLevel() + delta;
    view.webContents.setZoomLevel(nextLevel);
  }
}

function adjustWindowZoom(
  getMainWindow: () => BrowserWindow | null,
  getBrowserViews: (() => Map<string, { view: { webContents: Pick<BrowserWindow['webContents'], 'getZoomLevel' | 'setZoomLevel'> } }>) | undefined,
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
  getBrowserViews: (() => Map<string, { view: { webContents: Pick<BrowserWindow['webContents'], 'getZoomLevel' | 'setZoomLevel'> } }>) | undefined
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
};
