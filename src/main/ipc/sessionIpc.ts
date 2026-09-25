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
import type { AgentAttentionBroker } from '../agentAttentionBroker';
import { attentionLaunchOptions, ensureAttentionAdapterFiles, withoutAttentionEnvironment } from '../agentAttentionAdapters';

interface RegisterSessionIpcDeps {
  getTerminals: () => Map<string, Terminal>;
  getMainWindow: () => BrowserWindow | null;
  getSafeWorkspacePath: (workingDir: string) => string;
  getIsShuttingDown: () => boolean;
  getStore: () => Store<StoreSchema>;
  getHarnessOptions: () => Record<string, { name: string; command: string; args: string[]; icon: string; env?: Record<string, string> }>;
  agentAttentionBroker?: AgentAttentionBroker;
}

export function registerSessionIpc(deps: RegisterSessionIpcDeps): void {
  const { getTerminals, getMainWindow, getSafeWorkspacePath, getIsShuttingDown, getStore, getHarnessOptions, agentAttentionBroker } = deps;

  ipcMain.handle(SESSION_DISCOVER, async (_, workspacePath?: string) => {
    const nativeWorkspacePath = workspacePath
      ? toNativePath(workspacePath, process.platform)
      : undefined;
    const availableHarnessIds = new Set(Object.keys(getHarnessOptions()));
    const sessions = await discoverSessions(nativeWorkspacePath);
    return sessions.filter((session) => availableHarnessIds.has(session.harness));
  });

  ipcMain.handle(SESSION_INVOKE, async (_, session: HarnessSession, fork?: boolean) => {
    const terminals = getTerminals();
    const mainWindow = getMainWindow();
    const store = getStore();
    const harnessOptions = getHarnessOptions();
    const harnessConfig = harnessOptions[session.harness];

    if (!harnessConfig) {
      throw new Error(`${session.harness} harness is not available`);
    }

    // Look up per-harness default flags from store — same source as SPAWN_TERMINAL
    const harnessDefaults = store.get('harnessDefaults');
    const attentionEnabled = harnessDefaults[session.harness]?.attentionEnabled === true;
    const userFlags = harnessDefaults[session.harness]?.flags?.trim();

    const nativeSession = {
      ...session,
      cwd: toNativePath(session.cwd, process.platform),
      ...(session.filePath ? { filePath: toNativePath(session.filePath, process.platform) } : {}),
    };

    const id = `term-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const { spawnCmd, spawnArgs: baseArgs } = buildSessionInvokeArgs(nativeSession, fork ?? false, userFlags);
    const harnessEnv = harnessConfig.env ?? {};
    let spawnArgs = baseArgs;
    let attentionEnv: Record<string, string> = {};
    let attentionCommand: string | undefined;
    if (attentionEnabled && agentAttentionBroker) {
      try {
        const options = attentionLaunchOptions(session.harness, baseArgs, { ...process.env, ...harnessEnv }, ensureAttentionAdapterFiles(), fork ? undefined : session.id);
        if (options) {
          attentionEnv = { ...options.env, ...await agentAttentionBroker.register(id, session.harness) };
          attentionCommand = ensureAttentionAdapterFiles().command;
          spawnArgs = options.args;
        }
      } catch {
        agentAttentionBroker.release(id);
      }
    }
    const cwd = getSafeWorkspacePath(nativeSession.cwd);
    const userShell = defaultShell();

    const env: { [key: string]: string } = {
      ...withoutAttentionEnvironment(process.env),
      ...withoutAttentionEnvironment(harnessEnv),
      ...attentionEnv,
      ...(attentionCommand ? { CLANKER_ATTENTION_COMMAND: attentionCommand } : {}),
      CLANKER_GRID_FALLBACK_SHELL: userShell,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'clanker-grid',
      FORCE_COLOR: '1',
    };

    const launchLabel = `[clanker-grid] ${spawnArgs.join(' ')}`;

    try {
      const result = spawnPtyProcess({
      id,
      spawnCmd,
      spawnArgs,
      cwd,
      env,
      terminals,
      mainWindow,
      getIsShuttingDown,
      launchLabel,
      onExit: () => agentAttentionBroker?.release(id),
      });
      return { ...result, harnessId: session.harness, attentionEnabled };
    } catch (error) {
      agentAttentionBroker?.release(id);
      throw error;
    }
  });
}
