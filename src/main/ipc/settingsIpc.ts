/**
 * Settings IPC Handlers
 *
 * Registers IPC handlers for store/schema operations, harness options, and workspace path utilities.
 * Window controls extracted to windowIpc.ts. AI commit generation extracted to aiCommitIpc.ts.
 */

import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import Store from 'electron-store';
import {
  discoverHarnessModels,
  getAvailableHarnessOptions,
} from '../harnessCatalog';
import {
  resolveExistingDirectory,
} from '../security';
import { type StoreSchema, type HarnessDefaultsMap } from '../../shared/types/store';
import { type AiCommitProvider } from '../aiCommit';
import { validateHarnessDefaultsMap } from '../harnessDefaultsValidation';
import { toNativePath, toPosixPath } from '../../shared/pathNormalize';
import {
  GET_LAST_WORKSPACE,
  GET_BASE_DIRECTORY,
  OPEN_BASE_DIRECTORY_DIALOG,
  GET_SHOW_FASTFETCH,
  SET_SHOW_FASTFETCH,
  GET_AI_COMMIT_SETTINGS,
  SET_AI_COMMIT_ENABLED,
  SET_AI_COMMIT_PROVIDER,
  SET_AI_COMMIT_MODEL,
  GET_HARNESS_DEFAULTS,
  SET_HARNESS_DEFAULTS,
  OPEN_DIRECTORY_DIALOG,
  READ_DIRECTORY,
  GET_HARNESS_OPTIONS,
  GET_HARNESS_MODELS,
} from '../../shared/ipcChannels';

interface RegisterSettingsIpcDeps {
  getStore: () => Store<StoreSchema>;
  getMainWindow: () => BrowserWindow | null;
}

function getInvalidWorkspaceResult() {
  return { success: false, error: 'Workspace path is invalid or not a directory' };
}

export function registerSettingsIpc(deps: RegisterSettingsIpcDeps): void {
  const { getStore, getMainWindow } = deps;

  ipcMain.handle(GET_LAST_WORKSPACE, () => {
    return getStore().get('lastWorkspace');
  });

  ipcMain.handle(GET_BASE_DIRECTORY, () => {
    return getStore().get('baseDirectory');
  });

  ipcMain.handle(OPEN_BASE_DIRECTORY_DIALOG, async () => {
    const mainWindow = getMainWindow();
    const currentBaseRaw = getStore().get('baseDirectory');
    const currentBase = currentBaseRaw
      ? toNativePath(currentBaseRaw, process.platform)
      : currentBaseRaw;
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select Base Directory',
      defaultPath: currentBase,
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0];
      const sep = path.sep;
      const normalized = selectedPath.endsWith(sep) ? selectedPath : selectedPath + sep;
      const posixPath = toPosixPath(normalized);
      getStore().set('baseDirectory', posixPath);
      return posixPath;
    }
    return null;
  });

  ipcMain.handle(GET_SHOW_FASTFETCH, () => {
    return getStore().get('showFastfetch');
  });

  ipcMain.handle(SET_SHOW_FASTFETCH, (_, showFastfetch: boolean) => {
    getStore().set('showFastfetch', showFastfetch);
  });

  ipcMain.handle(GET_AI_COMMIT_SETTINGS, () => {
    return {
      enabled: getStore().get('aiCommitEnabled'),
      provider: getStore().get('aiCommitProvider'),
      model: getStore().get('aiCommitModel'),
    };
  });

  ipcMain.handle(SET_AI_COMMIT_ENABLED, (_, enabled: boolean) => {
    getStore().set('aiCommitEnabled', enabled);
  });

  ipcMain.handle(SET_AI_COMMIT_PROVIDER, (_, provider: AiCommitProvider) => {
    getStore().set('aiCommitProvider', provider);
  });

  ipcMain.handle(SET_AI_COMMIT_MODEL, (_, model: string) => {
    getStore().set('aiCommitModel', model);
  });

  ipcMain.handle(OPEN_DIRECTORY_DIALOG, async () => {
    const mainWindow = getMainWindow();
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select Workspace Directory',
      defaultPath: toNativePath(getStore().get('baseDirectory') || '', process.platform) || undefined,
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0];
      const posixPath = toPosixPath(selectedPath);
      getStore().set('lastWorkspace', posixPath);
      return posixPath;
    }
    return null;
  });

  ipcMain.handle(READ_DIRECTORY, async (_, dirPath: string) => {
    const nativeDirPath = toNativePath(dirPath, process.platform);
    const safeDirectoryPath = resolveExistingDirectory(nativeDirPath);
    if (!safeDirectoryPath) {
      return [];
    }

    try {
      const entries = fs.readdirSync(safeDirectoryPath, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory(),
        }));
    } catch {
      return [];
    }
  });

  ipcMain.handle(GET_HARNESS_MODELS, async (_, harness: string) => {
    return discoverHarnessModels(harness);
  });

  ipcMain.handle(GET_HARNESS_OPTIONS, () => {
    return getAvailableHarnessOptions();
  });

  ipcMain.handle(GET_HARNESS_DEFAULTS, () => {
    return getStore().get('harnessDefaults');
  });

  ipcMain.handle(SET_HARNESS_DEFAULTS, (_, payload: HarnessDefaultsMap) => {
    const result = validateHarnessDefaultsMap(payload);
    if (!result.valid) {
      console.warn('[clanker-grid] SET_HARNESS_DEFAULTS rejected:', result.error);
      return;
    }
    getStore().set('harnessDefaults', result.sanitized);
  });
}

export {
  getInvalidWorkspaceResult,
};
