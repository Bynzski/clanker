/**
 * Settings IPC Handlers
 *
 * Registers IPC handlers for store/schema operations, harness options, and workspace path utilities.
 * Window controls extracted to windowIpc.ts. AI commit generation extracted to aiCommitIpc.ts.
 */

import { ipcMain, dialog, BrowserWindow, app } from 'electron';
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
import { KeybindingOverridesService } from '../keybindingOverrides';
import { toNativePath, toPosixPath } from '../../shared/pathNormalize';
import { isWorkspaceNavigationMode, normalizeWorkspaceNavigationMode, normalizeWorkspaceSidebarWidth } from '../../shared/types/workspaceNavigation';
import { isThemeId, normalizeThemeId, getThemeMetadata } from '../../shared/types/theme';
import {
  GET_APP_VERSION,
  GET_LAST_WORKSPACE,
  GET_BASE_DIRECTORY,
  OPEN_BASE_DIRECTORY_DIALOG,
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
  GET_THEME,
  SET_THEME,
  GET_WORKSPACE_NAVIGATION_MODE,
  SET_WORKSPACE_NAVIGATION_MODE,
  GET_WORKSPACE_SIDEBAR_WIDTH,
  SET_WORKSPACE_SIDEBAR_WIDTH,
  GET_KEYBINDING_OVERRIDES,
  SET_KEYBINDING_OVERRIDES,
} from '../../shared/ipcChannels';

interface RegisterSettingsIpcDeps {
  getStore: () => Store<StoreSchema>;
  getMainWindow: () => BrowserWindow | null;
  /** Shared with browser IPC so main has one validated override cache; defaults to a private one. */
  keybindingOverrides?: KeybindingOverridesService;
}

function getInvalidWorkspaceResult() {
  return { success: false, error: 'Workspace path is invalid or not a directory' };
}

export function registerSettingsIpc(deps: RegisterSettingsIpcDeps): void {
  const { getStore, getMainWindow } = deps;
  const keybindingOverrides = deps.keybindingOverrides ?? new KeybindingOverridesService(getStore);

  ipcMain.handle(GET_APP_VERSION, () => app.getVersion());

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
      properties: ['openDirectory', 'createDirectory'],
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
      properties: ['openDirectory', 'createDirectory'],
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

  ipcMain.handle(GET_HARNESS_MODELS, async (_, harness: string, refresh?: boolean) => {
    return refresh === undefined
      ? discoverHarnessModels(harness)
      : discoverHarnessModels(harness, refresh);
  });

  ipcMain.handle(GET_HARNESS_OPTIONS, () => {
    return getAvailableHarnessOptions();
  });

  ipcMain.handle(GET_HARNESS_DEFAULTS, () => {
    const result = validateHarnessDefaultsMap(getStore().get('harnessDefaults'));
    if (result.valid) {
      getStore().set('harnessDefaults', result.sanitized);
      return result.sanitized;
    }

    const fallback = validateHarnessDefaultsMap({});
    if (fallback.valid) {
      getStore().set('harnessDefaults', fallback.sanitized);
      return fallback.sanitized;
    }

    return {};
  });

  ipcMain.handle(SET_HARNESS_DEFAULTS, (_, payload: HarnessDefaultsMap) => {
    const result = validateHarnessDefaultsMap(payload);
    if (!result.valid) {
      console.warn('[clanker-grid] SET_HARNESS_DEFAULTS rejected:', result.error);
      return;
    }
    getStore().set('harnessDefaults', result.sanitized);
  });

  ipcMain.handle(GET_THEME, () => {
    const raw = getStore().get('theme');
    const normalized = normalizeThemeId(raw);
    if (raw !== normalized) {
      getStore().set('theme', normalized);
    }
    return normalized;
  });

  ipcMain.handle(GET_WORKSPACE_NAVIGATION_MODE, () => {
    const raw = getStore().get('workspaceNavigationMode');
    const normalized = normalizeWorkspaceNavigationMode(raw);
    if (raw !== normalized) {
      getStore().set('workspaceNavigationMode', normalized);
    }
    return normalized;
  });

  ipcMain.handle(SET_WORKSPACE_NAVIGATION_MODE, (_, mode: unknown) => {
    if (!isWorkspaceNavigationMode(mode)) {
      console.warn('[clanker-grid] SET_WORKSPACE_NAVIGATION_MODE rejected invalid mode:', mode);
      return;
    }
    getStore().set('workspaceNavigationMode', mode);
  });

  ipcMain.handle(GET_WORKSPACE_SIDEBAR_WIDTH, () => {
    const raw = getStore().get('workspaceSidebarWidth');
    const normalized = normalizeWorkspaceSidebarWidth(raw);
    if (raw !== normalized) {
      getStore().set('workspaceSidebarWidth', normalized);
    }
    return normalized;
  });

  ipcMain.handle(SET_WORKSPACE_SIDEBAR_WIDTH, (_, width: unknown) => {
    if (typeof width !== 'number' || !Number.isFinite(width)) {
      console.warn('[clanker-grid] SET_WORKSPACE_SIDEBAR_WIDTH rejected invalid width:', width);
      return;
    }
    getStore().set('workspaceSidebarWidth', normalizeWorkspaceSidebarWidth(width));
  });

  ipcMain.handle(GET_KEYBINDING_OVERRIDES, () => keybindingOverrides.get());

  ipcMain.handle(SET_KEYBINDING_OVERRIDES, (_, overrides: unknown) => keybindingOverrides.set(overrides));

  ipcMain.handle(SET_THEME, (_, theme: unknown) => {
    if (!isThemeId(theme)) {
      console.warn('[clanker-grid] SET_THEME rejected invalid theme:', theme);
      return;
    }
    getStore().set('theme', theme);
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed?.()) {
      mainWindow.setBackgroundColor?.(getThemeMetadata(theme).windowBackground);
    }
  });
}

export {
  getInvalidWorkspaceResult,
};
