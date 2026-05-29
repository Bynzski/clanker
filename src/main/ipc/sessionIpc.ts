/**
 * Session History IPC Handlers
 *
 * Registers handlers for discovering and invoking AI harness sessions.
 */

import { ipcMain, BrowserWindow } from 'electron';
import Store from 'electron-store';
import { type StoreSchema } from '../../shared/types/store';
import { discoverSessions, buildSessionInvokeArgs } from '../sessionHistory';
import { SESSION_DISCOVER, SESSION_INVOKE } from '../../shared/ipcChannels';
import { spawnPtyProcess } from './ptySpawn';
import type { Terminal } from './terminalIpc';
import type { HarnessSession } from '../../shared/types/session';
import { defaultShell } from '../platformShell';
import { toNativePath } from '../../shared/pathNormalize';

interface RegisterSessionIpcDeps {
  getTerminals: () => Map<string, Terminal>;
  getMainWindow: () => BrowserWindow | null;
  getSafeWorkspacePath: (workingDir: string) => string;
  getIsShuttingDown: () => boolean;
  getStore: () => Store<StoreSchema>;
  getHarnessOptions: () => Record<string, { name: string; command: string; args: string[]; icon: string; env?: Record<string, string> }>;
}

export function registerSessionIpc(deps: RegisterSessionIpcDeps): void {
  const { getTerminals, getMainWindow, getSafeWorkspacePath, getIsShuttingDown, getStore, getHarnessOptions } = deps;

  ipcMain.handle(SESSION_DISCOVER, async (_, workspacePath?: string) => {
    const nativeWorkspacePath = workspacePath
      ? toNativePath(workspacePath, process.platform)
      : undefined;
    return discoverSessions(nativeWorkspacePath);
  });

  ipcMain.handle(SESSION_INVOKE, async (_, session: HarnessSession, fork?: boolean) => {
    const terminals = getTerminals();
    const mainWindow = getMainWindow();
    const store = getStore();
    const harnessOptions = getHarnessOptions();

    // Look up per-harness default flags from store — same source as SPAWN_TERMINAL
    const harnessDefaults = store.get('harnessDefaults');
    const userFlags = harnessDefaults[session.harness]?.flags?.trim();

    const nativeSession = {
      ...session,
      cwd: toNativePath(session.cwd, process.platform),
      ...(session.filePath ? { filePath: toNativePath(session.filePath, process.platform) } : {}),
    };

    const { spawnCmd, spawnArgs } = buildSessionInvokeArgs(nativeSession, fork ?? false, userFlags);
    const cwd = getSafeWorkspacePath(nativeSession.cwd);
    const userShell = defaultShell();

    const harnessEnv = harnessOptions[session.harness]?.env ?? {};

    const env: { [key: string]: string } = {
      ...process.env as { [key: string]: string },
      ...harnessEnv,
      CLANKER_GRID_FALLBACK_SHELL: userShell,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'clanker-grid',
      FORCE_COLOR: '1',
    };

    const launchLabel = `[clanker-grid] ${spawnArgs.join(' ')}`;

    return spawnPtyProcess({
      id: `term-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      spawnCmd,
      spawnArgs,
      cwd,
      env,
      terminals,
      mainWindow,
      getIsShuttingDown,
      launchLabel,
    });
  });
}
