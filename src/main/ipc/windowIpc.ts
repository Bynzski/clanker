/**
 * Window Control IPC Handlers
 *
 * Registers IPC handlers for window control operations (minimize, maximize, close, zoom).
 * Separated from settingsIpc.ts per concern separation.
 */

import { ipcMain, BrowserWindow } from 'electron';
import type { AppClosePrompt } from '../appClosePrompt';
import {
  MINIMIZE_WINDOW,
  TOGGLE_MAXIMIZE_WINDOW,
  CLOSE_WINDOW,
  IS_MAXIMIZED_WINDOW,
  ZOOM_IN_WINDOW,
  ZOOM_OUT_WINDOW,
  RESET_ZOOM_WINDOW,
  WINDOW_READY_TO_SHOW,
  APP_CLOSE_REQUEST,
  APP_CLOSE_READY,
  APP_CLOSE_RESPONSE,
} from '../../shared/ipcChannels';

interface RegisterWindowIpcDeps {
  getMainWindow: () => BrowserWindow | null;
  closePrompt?: AppClosePrompt;
}

function clampZoomLevel(level: number): number {
  return Math.max(-5, Math.min(5, level));
}

function adjustWindowZoom(
  getMainWindow: () => BrowserWindow | null,
  delta: number
): void {
  const mainWindow = getMainWindow();
  if (!mainWindow) {
    return;
  }

  const currentLevel = mainWindow.webContents.getZoomLevel();
  const nextLevel = clampZoomLevel(currentLevel + delta);
  mainWindow.webContents.setZoomLevel(nextLevel);
}

function resetWindowZoom(
  getMainWindow: () => BrowserWindow | null,
): void {
  const mainWindow = getMainWindow();
  if (!mainWindow) {
    return;
  }

  mainWindow.webContents.setZoomLevel(0);
}

export function registerWindowIpc(deps: RegisterWindowIpcDeps): void {
  const { getMainWindow } = deps;
  // Record this outbound-only channel alongside the canonical IPC inventory.
  ipcMain.on(APP_CLOSE_REQUEST, () => { /* main → renderer notification only */ });
  ipcMain.handle(APP_CLOSE_READY, (event, ready: unknown) => deps.closePrompt?.setReady(event, ready));
  ipcMain.handle(APP_CLOSE_RESPONSE, (event, id: unknown, answer: unknown) => deps.closePrompt?.respond(event, id, answer));

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
    adjustWindowZoom(getMainWindow, 0.5);
  });

  ipcMain.handle(ZOOM_OUT_WINDOW, () => {
    adjustWindowZoom(getMainWindow, -0.5);
  });

  ipcMain.handle(RESET_ZOOM_WINDOW, () => {
    resetWindowZoom(getMainWindow);
  });

  ipcMain.handle(WINDOW_READY_TO_SHOW, () => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed?.() && !mainWindow.isVisible?.()) {
      mainWindow.show();
    }
  });
}

export {
  clampZoomLevel,
  adjustWindowZoom,
  resetWindowZoom,
};
