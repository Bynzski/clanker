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
import type { RegisteredWorkspace, WorkspaceRegistry } from '../workspaceRegistry';
import { toNativePath, toPosixPath } from '../../shared/pathNormalize';
import type { GitWorktreeCreateResult, GitWorktreeListResult } from '../../shared/types/git';
import type { SessionInvokeOptions } from '../../shared/types/session';
import type { AgentAttentionBroker } from '../agentAttentionBroker';
import { invokeRemoteSession } from './remoteSessionInvocation';
import {
  ensureAttentionAdapterFiles,
  prepareLocalAttention,
  attentionSourceOptions,
  trustedRootSessionId,
  withoutAttentionEnvironment,
} from '../agentAttentionAdapters';
import { isInsideRoot } from '../localPathContainment';
import { sessionMatchesWorkspace } from '../harnesses/sessionFiles';
import {
  classifySessions, directoryExists, discoverSessionsWithCheckouts, loadSessionCheckoutPlan, MAX_REMOTE_SESSION_SCOPES,
  routeSessionResume, sessionScanScopes, type SessionCheckoutPlan,
} from '../sessionWorktrees';
import { isCurrentCheckoutContext, resolveSessionResumeTarget } from '../sessionResumeTarget';
import type { WorktreeProvenance } from '../worktreeProvenance';

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
  /**
   * Git's worktree listing for a registered local workspace (scoped to it). Optional: without it,
   * history and resume only cover the workspace root and its already registered worktree contexts.
   */
  listWorktrees?: (workspaceId: string) => Promise<GitWorktreeListResult>;
  /** Existing local branch names of the workspace's repository (scoped like `listWorktrees`). */
  listBranches?: (workspaceId: string) => Promise<string[]>;
  /** Main-owned memory of removed worktrees; see worktreeProvenance.ts. */
  worktreeProvenance?: WorktreeProvenance;
  /**
   * Creates the worktree for an existing branch at its generated path and attaches it to the workspace
   * (the same trusted route as `New isolated agent`). Only used after the user confirms recreation.
   */
  recreateWorktree?: (workspaceId: string, branch: string) => Promise<GitWorktreeCreateResult>;
  /** Optional: without it (or without managed accounts) discovery and resume use the native account only. */
  getHarnessAccountService?: () => HarnessAccountService | undefined;
  /** Test seams mirroring terminal spawning: wrapper lookup and Windows file/platform resolution. */
  ensureHarnessWrapperScript?: () => string | null;
  harnessSpawnOverrides?: Partial<HarnessPtySpawnOptions>;
}

export function registerSessionIpc(deps: RegisterSessionIpcDeps): void {
  const { getTerminals, getMainWindow, getSafeWorkspacePath, getIsShuttingDown, getStore, getHarnessOptions, agentAttentionBroker } = deps;

  const loadPlan = (workspaceId: string, workspace: RegisteredWorkspace): Promise<SessionCheckoutPlan | null> => loadSessionCheckoutPlan({
    registry: deps.getWorkspaceRegistry?.(), workspace,
    listWorktrees: deps.listWorktrees ? () => deps.listWorktrees!(workspaceId) : undefined,
    listBranches: deps.listBranches ? () => deps.listBranches!(workspaceId) : undefined,
    provenance: deps.worktreeProvenance,
  });

  ipcMain.handle(SESSION_DISCOVER, async (_, workspaceId: string) => {
    const workspace = typeof workspaceId === 'string'
      ? deps.getWorkspaceRegistry?.()?.getWorkspace(workspaceId)
      : null;
    if (!workspace) throw new Error('Workspace is not registered');
    const plan = await loadPlan(workspaceId, workspace);
    if (workspace.location.environmentId !== 'local') {
      if (!workspace.environment?.capabilities.sessionDiscovery || !workspace.environment.discoverSessions) return [];
      // One bounded on-host scan covers the workspace and the worktree scopes main derived from Git.
      const scopes = plan ? sessionScanScopes(plan).slice(0, MAX_REMOTE_SESSION_SCOPES) : [];
      const found = scopes.length > 0
        ? await workspace.environment.discoverSessions(workspace.location.path, scopes)
        : await workspace.environment.discoverSessions(workspace.location.path);
      if (deps.getWorkspaceRegistry?.()?.getWorkspace(workspaceId) !== workspace) throw new Error('Remote workspace closed during discovery');
      return plan ? classifySessions(plan, found) : found;
    }

    const nativeWorkspacePath = toNativePath(workspace.location.path, process.platform);
    const availableHarnessIds = new Set(Object.keys(getHarnessOptions()));
    const managed = deps.getHarnessAccountService?.()?.discoverySource('local');
    const discover = (scanPath: string) => managed ? discoverSessions(scanPath, { managed }) : discoverSessions(scanPath);
    // Conversations of isolated agents live in linked worktrees outside the workspace root; they
    // belong to this workspace's history, labelled with their checkout.
    const sessions = plan
      ? await discoverSessionsWithCheckouts({
        plan, scanWorkspacePath: nativeWorkspacePath, discover,
        toScanPath: (posixPath) => toNativePath(posixPath, process.platform),
      })
      : await discover(nativeWorkspacePath);
    return sessions.filter((session) => availableHarnessIds.has(session.harness));
  });

  ipcMain.handle(SESSION_INVOKE, async (_, workspaceId: string, requestedSession: HarnessSession, fork?: boolean, options?: SessionInvokeOptions) => {
    const workspace = typeof workspaceId === 'string'
      ? deps.getWorkspaceRegistry?.()?.getWorkspace(workspaceId)
      : null;
    if (!workspace) throw new Error('Workspace is not registered');
    if (workspace.location.environmentId !== 'local') {
      return invokeRemoteSession(deps, workspace, requestedSession, fork, options);
    }
    const nativeWorkspacePath = toNativePath(workspace.location.path, process.platform);
    const registry = deps.getWorkspaceRegistry?.();
    // Resume runs in the workspace's main checkout context unless the conversation ran in one of its
    // linked worktrees (decided below from the session's recorded cwd, never from renderer fields).
    const mainContext = registry?.resolveCheckoutContext(workspaceId) ?? null;
    const plan = await loadPlan(workspaceId, workspace);
    const routeFor = (candidate: HarnessSession): ReturnType<typeof routeSessionResume> => {
      const cwd = typeof candidate?.cwd === 'string' ? toPosixPath(candidate.cwd) : '';
      if (plan) return routeSessionResume(plan, cwd);
      // Without a registry there is no worktree evidence: only the workspace root itself qualifies.
      return cwd && !cwd.split('/').some((segment) => segment === '..' || segment === '.')
        && sessionMatchesWorkspace(workspace.location.path, cwd) ? { kind: 'main' } : { kind: 'outside' };
    };
    const preRoute = routeFor(requestedSession);
    if (preRoute.kind === 'outside') throw new Error('Session working directory is outside the workspace');
    // The checkout root the session's own history lives under (the workspace root for ordinary sessions).
    const sessionRootPath = preRoute.kind === 'worktree' || preRoute.kind === 'gone'
      ? toNativePath(preRoute.root.path, process.platform) : nativeWorkspacePath;
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
        sessionId: requestedSession.id, workspacePath: sessionRootPath,
      });
      session = owned.session;
      accountBinding = owned.binding;
    }
    const nativeSessionCwd = typeof session?.cwd === 'string'
      ? toNativePath(session.cwd, process.platform)
      : '';
    const route = routeFor(session);
    const rootPathOf = (value: typeof route): string | null => value.kind === 'worktree' || value.kind === 'gone' ? value.root.path : null;
    const sameRoute = route.kind === preRoute.kind && rootPathOf(route) === rootPathOf(preRoute);
    if (route.kind === 'outside' || !sameRoute || !path.isAbsolute(nativeSessionCwd)) {
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

    // Where it launches: the checkout the conversation ran in when that still exists (its registered
    // context, or one adopted through Git's own listing); otherwise the main checkout with an
    // explicit notice, or an offer to recreate the worktree for a harness that cannot resume
    // elsewhere. A removed or unusable worktree never becomes the launch directory.
    const sessionPosixCwd = toPosixPath(session.cwd);
    const discoverForConfirmation = (scanPath: string) => {
      const managedSource = accountService?.discoverySource('local');
      return managedSource ? discoverSessions(scanPath, { managed: managedSource }) : discoverSessions(scanPath);
    };
    const target = plan ? await resolveSessionResumeTarget({
      registry, workspace, plan, harness: session.harness, cwd: sessionPosixCwd, mainContext,
      listWorktrees: deps.listWorktrees ? () => deps.listWorktrees!(workspaceId) : undefined,
      recreateWorktree: deps.recreateWorktree ? (branch) => deps.recreateWorktree!(workspaceId, branch) : undefined,
      recreateRequested: options?.recreateCheckout === true,
      isUsable: (context) => directoryExists(toNativePath(context.path, process.platform)),
      // A renderer-named cwd must be a conversation main itself finds before anything is offered or created.
      confirmSession: async () => (await discoverSessionsWithCheckouts({
        plan, scanWorkspacePath: nativeWorkspacePath, discover: discoverForConfirmation,
        toScanPath: (posixPath) => toNativePath(posixPath, process.platform),
      })).some((entry) => entry.harness === session.harness && entry.id === session.id && toPosixPath(entry.cwd) === sessionPosixCwd),
    }) : { kind: 'launch' as const, target: 'main' as const, context: mainContext };
    if (target.kind === 'offer') return { recreateOffer: target.offer };

    // Look up per-harness default flags from store — same source as SPAWN_TERMINAL
    const harnessDefaults = store.get('harnessDefaults');
    const attentionEnabled = harnessDefaults[session.harness]?.attentionEnabled === true;
    const userFlags = harnessDefaults[session.harness]?.flags?.trim();
    // A recreated worktree exists again by now, so a harness that validates against its own store
    // (Pi) does so exactly as for any live worktree; nothing about that check is relaxed.
    const validatedSession = await findHarnessProvider(session.harness)?.sessions?.validateLocal?.(session, { workspacePath: sessionRootPath, userFlags }) ?? session;

    const launchContext = target.context;
    const resumeNotice = target.notice;
    const launchRoot = target.target === 'worktree' && launchContext
      ? toNativePath(launchContext.path, process.platform) : nativeWorkspacePath;

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
        attentionEnv = await agentAttentionBroker.register(id, session.harness, { rootSessionId, ...attentionSourceOptions(session.harness) });
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
      // Never a directory outside the root being launched into: a session whose recorded cwd is not
      // inside it (or no longer exists) starts at that root.
      const wantedCwd = isInsideRoot(launchRoot, nativeSession.cwd) ? nativeSession.cwd : launchRoot;
      const cwd = getSafeWorkspacePath(wantedCwd);
      // getSafeWorkspacePath falls back to lastWorkspace or home when the directory is gone. Judge the
      // directory actually used, exactly as an ordinary terminal launch does, so a checkout that vanished
      // after route resolution fails here, before any PTY exists, instead of resuming somewhere else
      // while still bound to the selected checkout context.
      if (!isInsideRoot(launchRoot, cwd)) {
        throw new Error('Resume directory is outside the checkout it was resolved to');
      }
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

      // Everything above awaited: the workspace or the selected checkout may have been closed or
      // released meanwhile. Fail closed before any process exists.
      if (registry && (registry.getWorkspace(workspaceId) !== workspace || !isCurrentCheckoutContext(registry, launchContext))) {
        throw new Error('Workspace was closed or is being removed');
      }

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
      // Main's own record of ownership: an agent's reported location is resolved against it (agentLocation.ts).
      workspaceId: workspace.workspaceId,
      checkoutContextId: launchContext?.id,
      onExit: () => {
        disposeAttentionSafely(preparedAttention);
        agentAttentionBroker?.release(id);
      },
      });
      return {
        ...result, harnessId: session.harness, attentionEnabled, checkoutContextId: launchContext?.id,
        // Where it actually started (never the recorded cwd of a removed worktree).
        workingDir: toPosixPath(cwd),
        ...(launchContext && launchContext.kind === 'worktree' ? { checkoutContext: launchContext } : {}),
        ...(resumeNotice ? { resumeNotice } : {}),
      };
    } catch (error) {
      disposeAttentionSafely(preparedAttention);
      agentAttentionBroker?.release(id);
      throw error;
    }
  });
}
