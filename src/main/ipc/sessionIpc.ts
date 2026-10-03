import { disposeAttentionSafely } from '../harnesses/localAttention';
import type { PreparedLocalAttention } from '../harnesses/types';
import { findHarnessProvider, isHarnessId } from '../harnesses/registry';
import { prepareHarnessAccountContext, type HarnessAccountService } from '../accounts/harnessAccountService';
import { DEFAULT_HARNESS_ACCOUNT_ID } from '../../shared/types/harnessAccounts';
import { supportsSessionOperation } from '../sessionLaunch';
/**
 * Session History IPC Handlers
 *
 * Registers handlers for discovering and invoking AI harness sessions.
 */

import { ipcMain, BrowserWindow } from 'electron';
import * as path from 'node:path';
import Store from 'electron-store';
import { type StoreSchema } from '../../shared/types/store';
import { discoverSessions, buildSessionLaunch } from '../sessionHistory';
import { ensureHarnessWrapperScript, resolveHarnessPtySpawn, type HarnessPtySpawnOptions } from '../harnessLaunch';
import { SESSION_DISCOVER, SESSION_INVOKE } from '../../shared/ipcChannels';
import { spawnPtyProcess } from './ptySpawn';
import type { Terminal } from './terminalIpc';
import type { HarnessSession } from '../../shared/types/session';
import { defaultShell } from '../platformShell';
import type { WorkspaceRegistry } from '../workspaceRegistry';
import { toNativePath } from '../../shared/pathNormalize';
import type { AgentAttentionBroker } from '../agentAttentionBroker';
import { invokeRemoteSession } from './remoteSessionInvocation';
import {
  ensureAttentionAdapterFiles,
  prepareLocalAttention,
  trustedRootSessionId,
  withoutAttentionEnvironment,
} from '../agentAttentionAdapters';

export interface RegisterSessionIpcDeps {
  getTerminals: () => Map<string, Terminal>;
  getMainWindow: () => BrowserWindow | null;
  getSafeWorkspacePath: (workingDir: string) => string;
  getIsShuttingDown: () => boolean;
  getStore: () => Store<StoreSchema>;
  getHarnessOptions: () => Record<string, { name: string; command: string; args: string[]; icon: string; env?: Record<string, string> }>;
  agentAttentionBroker?: AgentAttentionBroker;
  createRemoteOutputObserver?: (workspaceId: string) => (data: string) => void;
  getWorkspaceRegistry?: () => WorkspaceRegistry;
  /** Optional: without it (or without managed accounts) discovery and resume use the native account only. */
  getHarnessAccountService?: () => HarnessAccountService | undefined;
  /** Test seams mirroring terminal spawning: wrapper lookup and Windows file/platform resolution. */
  ensureHarnessWrapperScript?: () => string | null;
  harnessSpawnOverrides?: Partial<HarnessPtySpawnOptions>;
}

export function registerSessionIpc(deps: RegisterSessionIpcDeps): void {
  const { getTerminals, getMainWindow, getSafeWorkspacePath, getIsShuttingDown, getStore, getHarnessOptions, agentAttentionBroker } = deps;

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
    const managed = deps.getHarnessAccountService?.()?.discoverySource('local');
    const sessions = managed ? await discoverSessions(nativeWorkspacePath, { managed }) : await discoverSessions(nativeWorkspacePath);
    return sessions.filter((session) => availableHarnessIds.has(session.harness));
  });

  ipcMain.handle(SESSION_INVOKE, async (_, workspaceId: string, requestedSession: HarnessSession, fork?: boolean) => {
    const workspace = typeof workspaceId === 'string'
      ? deps.getWorkspaceRegistry?.()?.getWorkspace(workspaceId)
      : null;
    if (!workspace) throw new Error('Workspace is not registered');
    if (workspace.location.environmentId !== 'local') {
      return invokeRemoteSession(deps, workspace, requestedSession, fork);
    }
    const nativeWorkspacePath = toNativePath(workspace.location.path, process.platform);
    // A session's `accountId` is only a claim. For a managed account main re-finds the session inside
    // that account's own storage and launches that authoritative copy with that account's binding;
    // a session without a claim resumes under the native account, never the currently selected one.
    const accountService = deps.getHarnessAccountService?.();
    let session = requestedSession;
    const claimedAccountId = (requestedSession as { accountId?: unknown } | null)?.accountId;
    const managedClaim = claimedAccountId !== undefined && claimedAccountId !== DEFAULT_HARNESS_ACCOUNT_ID;
    let accountBinding = prepareHarnessAccountContext(accountService, {
      environmentId: 'local', harness: String(requestedSession?.harness), accountId: DEFAULT_HARNESS_ACCOUNT_ID,
    });
    if (managedClaim) {
      if (!accountService || !isHarnessId(requestedSession?.harness) || typeof requestedSession.id !== 'string'
        || !supportsSessionOperation(requestedSession.harness, fork === true, 'local')) {
        throw new Error('Session account is not available');
      }
      const owned = await accountService.resolveOwnedSession({
        environmentId: 'local', harness: requestedSession.harness, accountId: claimedAccountId,
        sessionId: requestedSession.id, workspacePath: nativeWorkspacePath,
      });
      session = owned.session;
      accountBinding = owned.binding;
    }
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
    if (!supportsSessionOperation(session.harness, fork === true, 'local')) {
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


    // Look up per-harness default flags from store — same source as SPAWN_TERMINAL
    const harnessDefaults = store.get('harnessDefaults');
    const attentionEnabled = harnessDefaults[session.harness]?.attentionEnabled === true;
    const userFlags = harnessDefaults[session.harness]?.flags?.trim();
    const validatedSession = await findHarnessProvider(session.harness)?.sessions?.validateLocal?.(session, { workspacePath: nativeWorkspacePath, userFlags }) ?? session;

    const nativeSession = {
      ...validatedSession,
      cwd: toNativePath(validatedSession.cwd, process.platform),
      ...(validatedSession.filePath ? { filePath: toNativePath(validatedSession.filePath, process.platform) } : {}),
    };

    const id = `term-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const { command: sessionCommand, args: baseArgs } = buildSessionLaunch(nativeSession, fork ?? false, userFlags);
    const harnessEnv = accountBinding.mergeEnvironment(harnessConfig.env ?? {});
    let spawnArgs = baseArgs;
    let attentionEnv: Record<string, string> = {};
    let attentionCommand: string | undefined;
    let preparedAttention: PreparedLocalAttention | null = null;
    if (agentAttentionBroker) {
      try {
        const files = ensureAttentionAdapterFiles();
        const rootSessionId = trustedRootSessionId(session.harness, validatedSession, fork === true);
        if (attentionEnabled) {
          preparedAttention = prepareLocalAttention(session.harness, {
            terminalId: id, args: baseArgs, env: { ...process.env, ...harnessEnv }, files,
            platform: process.platform, rootSessionId,
          }) ?? null;
        }
        attentionEnv = await agentAttentionBroker.register(id, session.harness, { rootSessionId });
        attentionCommand = files.command;
        if (preparedAttention) {
          attentionEnv = { ...attentionEnv, ...preparedAttention.env };
          spawnArgs = preparedAttention.args;
        }
      } catch {
        disposeAttentionSafely(preparedAttention);
        agentAttentionBroker.release(id);
      }
    }
    try {
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

      // Planned last, from the final (attention-mutated) argv and the exact child environment.
      const planned = resolveHarnessPtySpawn(sessionCommand, spawnArgs, (deps.ensureHarnessWrapperScript ?? ensureHarnessWrapperScript)(), { env, ...deps.harnessSpawnOverrides });
      const launchLabel = `[clanker-grid] ${sessionCommand} ${spawnArgs.join(' ')}`;

      const result = spawnPtyProcess({
      id,
      spawnCmd: planned.spawnCmd,
      spawnArgs: planned.spawnArgs,
      cwd,
      env,
      terminals,
      mainWindow,
      getIsShuttingDown,
      launchLabel,
      harnessId: session.harness,
      onExit: () => {
        disposeAttentionSafely(preparedAttention);
        agentAttentionBroker?.release(id);
      },
      });
      return { ...result, harnessId: session.harness, attentionEnabled };
    } catch (error) {
      disposeAttentionSafely(preparedAttention);
      agentAttentionBroker?.release(id);
      throw error;
    }
  });
}
