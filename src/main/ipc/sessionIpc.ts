/**
 * Session History IPC Handlers
 *
 * Registers handlers for discovering and invoking AI harness sessions.
 */

import { ipcMain, BrowserWindow } from 'electron';
import * as os from 'node:os';
import * as path from 'node:path';
import Store from 'electron-store';
import { type StoreSchema } from '../../shared/types/store';
import { discoverSessions, buildSessionInvokeArgs } from '../sessionHistory';
import { SESSION_DISCOVER, SESSION_INVOKE } from '../../shared/ipcChannels';
import { spawnPtyProcess } from './ptySpawn';
import type { Terminal } from './terminalIpc';
import type { HarnessSession } from '../../shared/types/session';
import { defaultShell } from '../platformShell';
import type { WorkspaceRegistry } from '../workspaceRegistry';
import { toNativePath } from '../../shared/pathNormalize';
import { resolveExistingFileWithinDirectory } from '../security';
import type { TaskSessionCoordinator } from '../taskSessionCoordinator';
import type { AgentAttentionBroker } from '../agentAttentionBroker';
import {
  acquireAgyAttentionPlugin,
  attentionLaunchOptions,
  ensureAttentionAdapterFiles,
  releaseAgyAttentionPlugin,
  withoutAttentionEnvironment,
} from '../agentAttentionAdapters';

const AGY_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGY_MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

interface RegisterSessionIpcDeps {
  getTerminals: () => Map<string, Terminal>;
  getMainWindow: () => BrowserWindow | null;
  getSafeWorkspacePath: (workingDir: string) => string;
  getIsShuttingDown: () => boolean;
  getStore: () => Store<StoreSchema>;
  getHarnessOptions: () => Record<string, { name: string; command: string; args: string[]; icon: string; env?: Record<string, string> }>;
  agentAttentionBroker?: AgentAttentionBroker;
  taskSessionCoordinator?: TaskSessionCoordinator;
  getWorkspaceRegistry?: () => WorkspaceRegistry;
}

export function registerSessionIpc(deps: RegisterSessionIpcDeps): void {
  const { getTerminals, getMainWindow, getSafeWorkspacePath, getIsShuttingDown, getStore, getHarnessOptions, agentAttentionBroker, taskSessionCoordinator } = deps;

  ipcMain.handle(SESSION_DISCOVER, async (_, workspaceId: string) => {
    const workspace = typeof workspaceId === 'string'
      ? deps.getWorkspaceRegistry?.()?.getWorkspace(workspaceId)
      : null;
    if (!workspace) throw new Error('Workspace is not registered');
    if (workspace.location.environmentId !== 'local') {
      if (!workspace.environment?.capabilities.sessionDiscovery || !workspace.environment.discoverSessions) return [];
      const sessions = await workspace.environment.discoverSessions(workspace.location.path);
      if (deps.getWorkspaceRegistry?.()?.getWorkspace(workspaceId) !== workspace) throw new Error('Remote workspace closed during discovery');
      return sessions;
    }

    const nativeWorkspacePath = toNativePath(workspace.location.path, process.platform);
    const availableHarnessIds = new Set(Object.keys(getHarnessOptions()));
    const sessions = await discoverSessions(nativeWorkspacePath);
    return sessions.filter((session) => availableHarnessIds.has(session.harness));
  });

  ipcMain.handle(SESSION_INVOKE, async (_, workspaceId: string, session: HarnessSession, fork?: boolean) => {
    const workspace = typeof workspaceId === 'string'
      ? deps.getWorkspaceRegistry?.()?.getWorkspace(workspaceId)
      : null;
    if (!workspace) throw new Error('Workspace is not registered');
    if (workspace.location.environmentId !== 'local') {
      throw new Error('Remote session invocation is not supported in this version');
    }
    const nativeWorkspacePath = toNativePath(workspace.location.path, process.platform);
    const nativeSessionCwd = typeof session?.cwd === 'string'
      ? toNativePath(session.cwd, process.platform)
      : '';
    const relativeCwd = path.relative(nativeWorkspacePath, nativeSessionCwd);
    if (!path.isAbsolute(nativeSessionCwd) || relativeCwd === '..'
      || relativeCwd.startsWith(`..${path.sep}`) || path.isAbsolute(relativeCwd)) {
      throw new Error('Session working directory is outside the workspace');
    }

    // The installed CLI is not enough to imply that its session format or
    // resume command is integrated. Do not route Hermes through Claude's
    // fallback invocation for renderer-supplied session payloads.
    if (!['codex', 'claude', 'opencode', 'pi', 'omp', 'agy'].includes(session.harness)) {
      throw new Error(`${session.harness} session invocation is not supported`);
    }
    const terminals = getTerminals();
    const mainWindow = getMainWindow();
    const store = getStore();
    const harnessOptions = getHarnessOptions();
    const harnessConfig = harnessOptions[session.harness];

    if (!harnessConfig) {
      throw new Error(`${session.harness} harness is not available`);
    }

    // OMP resumes by path; reject renderer-supplied paths outside its session store.
    const ompSessionPath = session.harness === 'omp' && session.filePath?.endsWith('.jsonl')
      ? resolveExistingFileWithinDirectory(
        toNativePath(session.filePath, process.platform),
        path.join(os.homedir(), '.omp', 'agent', 'sessions'),
      )
      : null;
    if (session.harness === 'omp' && !ompSessionPath) {
      throw new Error('OMP session file is invalid');
    }

    let agySessionId = session.id;
    let agyModelId = session.modelId;
    if (session.harness === 'agy') {
      if (typeof session.id !== 'string' || !AGY_SESSION_ID_PATTERN.test(session.id.trim())) {
        throw new Error('Antigravity session ID is invalid');
      }
      agySessionId = session.id.trim();
      if (session.modelId !== undefined) {
        if (typeof session.modelId !== 'string'
          || (session.modelId.trim() && !AGY_MODEL_ID_PATTERN.test(session.modelId.trim()))) {
          throw new Error('Antigravity model ID is invalid');
        }
        agyModelId = session.modelId.trim() || undefined;
      }
    }

    // Look up per-harness default flags from store — same source as SPAWN_TERMINAL
    const harnessDefaults = store.get('harnessDefaults');
    const attentionEnabled = harnessDefaults[session.harness]?.attentionEnabled === true;
    const userFlags = harnessDefaults[session.harness]?.flags?.trim();

    const nativeSession = {
      ...session,
      id: agySessionId,
      modelId: agyModelId,
      cwd: nativeSessionCwd,
      ...(session.filePath ? { filePath: ompSessionPath ?? toNativePath(session.filePath, process.platform) } : {}),
    };

    const id = `term-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const { spawnCmd, spawnArgs: baseArgs } = buildSessionInvokeArgs(nativeSession, fork ?? false, userFlags);
    const harnessEnv = harnessConfig.env ?? {};
    let spawnArgs = baseArgs;
    let attentionEnv: Record<string, string> = {};
    let attentionCommand: string | undefined;
    if (agentAttentionBroker) {
      try {
        const files = ensureAttentionAdapterFiles();
        if (attentionEnabled && session.harness === 'agy') {
          acquireAgyAttentionPlugin(id, files);
        }
        attentionEnv = await agentAttentionBroker.register(id, session.harness);
        attentionCommand = files.command;
        if (attentionEnabled) {
          const options = attentionLaunchOptions(session.harness, baseArgs, { ...process.env, ...harnessEnv }, files, fork ? undefined : agySessionId);
          if (options) {
            attentionEnv = { ...attentionEnv, ...options.env };
            spawnArgs = options.args;
          }
        }
      } catch {
        releaseAgyAttentionPlugin(id);
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
      harnessId: session.harness,
      onExit: () => {
        releaseAgyAttentionPlugin(id);
        agentAttentionBroker?.release(id);
        void taskSessionCoordinator?.onTerminalExited(id);
      },
      });
      taskSessionCoordinator?.onSessionInvoked(id, {
        ...nativeSession,
        // The session record crosses into persistence and renderer matching;
        // keep its original IPC-form path, not the native spawn cwd.
        cwd: session.cwd,
      });
      return { ...result, harnessId: session.harness, attentionEnabled };
    } catch (error) {
      releaseAgyAttentionPlugin(id);
      agentAttentionBroker?.release(id);
      throw error;
    }
  });
}
