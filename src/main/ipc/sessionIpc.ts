import type { NativeAttentionCapability } from '../../shared/types/attentionSignal';
import { findHarnessProvider, isHarnessId } from '../harnesses/registry';
import { prepareHarnessAccountContext, type HarnessAccountService } from '../accounts/harnessAccountService';
import { DEFAULT_HARNESS_ACCOUNT_ID } from '../../shared/types/harnessAccounts';
import { assertSessionSelectionFlags, supportsSessionOperation } from '../sessionLaunch';
/**
 * Session History IPC Handlers
 *
 * Registers handlers for discovering and invoking AI harness sessions.
 */

import { ipcMain, BrowserWindow } from 'electron';
import * as path from 'node:path';
import Store from 'electron-store';
import { type StoreSchema } from '../../shared/types/store';
import { discoverSessions, discoverSessionsDetailed, buildSessionLaunch } from '../sessionHistory';
import { ensureHarnessWrapperScript, resolveHarnessPtySpawn, type HarnessPtySpawnOptions } from '../harnessLaunch';
import { SESSION_DISCOVER, SESSION_INVOKE } from '../../shared/ipcChannels';
import { spawnPtyProcess } from './ptySpawn';
import type { Terminal } from './terminalIpc';
import type { SessionDiscoveryIssue, SessionDiscoveryResult, HarnessSession } from '../../shared/types/session';
import { defaultShell } from '../platformShell';
import type { RegisteredWorkspace, WorkspaceRegistry } from '../workspaceRegistry';
import { toNativePath, toPosixPath } from '../../shared/pathNormalize';
import type { GitWorktreeCreateResult, GitWorktreeListResult } from '../../shared/types/git';
import type { SessionInvokeOptions } from '../../shared/types/session';
import type { AgentAttentionBroker } from '../agentAttentionBroker';
import { invokeRemoteSession } from './remoteSessionInvocation';
import { trustedRootSessionId } from '../agentAttentionAdapters';
import { withoutAttentionEnvironment } from '../environment/attentionEnvironment';
import { prepareLaunchAttachments, type LaunchAttachmentStep } from '../launchAttachments';
import { attentionLaunchStep, localAttentionCapability, NATIVE_ATTENTION_ATTACHED } from '../attentionLaunchStep';
import { agentBridgeLaunchStep, withoutAgentBridgeEnvironment, type AgentBridgeService } from '../agentBridge/service';
import { grantsCheckoutRehoming } from '../isolatedCheckout/rehomeSupport';
import type { CheckoutContext } from '../../shared/types/checkoutContext';
import { isInsideRoot } from '../localPathContainment';
import { sessionMatchesWorkspace } from '../harnesses/sessionFiles';
import {
  classifySessions, directoryExists, discoverSessionsWithCheckouts, loadSessionCheckoutPlan, MAX_REMOTE_SESSION_SCOPES,
  routeSessionResume, sessionScanScopes, type SessionCheckoutPlan,
} from '../sessionWorktrees';
import { isCurrentCheckoutContext, resolveSessionResumeTarget } from '../sessionResumeTarget';
import type { WorktreeProvenance } from '../worktreeProvenance';
import { rediscoverDefaultLocalSession } from '../localSessionSelection';
import { readInitialTerminalGeometry } from '../../shared/terminalGeometry';

export interface RegisterSessionIpcDeps {
  getTerminals: () => Map<string, Terminal>;
  getMainWindow: () => BrowserWindow | null;
  getSafeWorkspacePath: (workingDir: string) => string;
  getIsShuttingDown: () => boolean;
  getStore: () => Store<StoreSchema>;
  getHarnessOptions: () => Record<string, { name: string; command: string; args: string[]; icon: string; env?: Record<string, string> }>;
  agentAttentionBroker?: AgentAttentionBroker;
  /** Optional: without it no launch attaches the Clanker MCP bridge. */
  agentBridge?: AgentBridgeService;
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

/**
 * A resume main performs on its own account (never a renderer request): the conversation runs in a
 * checkout main chose, instead of the one its recorded directory implies.
 */
export interface InternalResumeRequest {
  /** The checkout the conversation must run in. Re-verified as still registered just before the PTY exists. */
  targetContext: CheckoutContext;
  /** Sees PTY output as it arrives (the lifecycle service's liveness proof). */
  onOutput?: (data: string) => void;
  /** Called once the process has exited and its launch attachments were disposed. */
  onExit?: () => void;
  /** The replacement starts before its pane adopts it, so it may need to hold more startup output. */
  startupBufferLimit?: { bytes: number; chunks: number };
  initialGeometry?: { cols: number; rows: number };
}

export interface ResumedSessionLaunch {
  id: string;
  pid: number;
  harnessId: string;
  attentionEnabled: boolean;
  attention?: NativeAttentionCapability;
  checkoutContextId?: string;
  workingDir: string;
}

export interface SessionIpcController {
  /**
   * Main's own rediscovery of one local conversation by harness and native session id, from the same
   * history SESSION_DISCOVER shows (managed accounts and worktree checkouts included). Null when it is
   * not found. The result, not any caller's description of it, is what a resume is launched from.
   */
  findSession(workspaceId: string, harness: string, sessionId: string): Promise<HarnessSession | null>;
  /**
   * Resumes `session` (main's own rediscovered record) in `request.targetContext`. Local workspaces only.
   * Goes through exactly the launch SESSION_INVOKE uses (account binding, attention, the bridge, the
   * revalidation just before spawn); only the routing decision is replaced by main's choice.
   */
  resumeInCheckout(workspaceId: string, session: HarnessSession, request: InternalResumeRequest): Promise<ResumedSessionLaunch>;
}

export function registerSessionIpc(deps: RegisterSessionIpcDeps): SessionIpcController {
  const { getTerminals, getMainWindow, getSafeWorkspacePath, getIsShuttingDown, getStore, getHarnessOptions, agentAttentionBroker } = deps;

  const loadPlan = (workspaceId: string, workspace: RegisteredWorkspace): Promise<SessionCheckoutPlan | null> => loadSessionCheckoutPlan({
    registry: deps.getWorkspaceRegistry?.(), workspace,
    listWorktrees: deps.listWorktrees ? () => deps.listWorktrees!(workspaceId) : undefined,
    listBranches: deps.listBranches ? () => deps.listBranches!(workspaceId) : undefined,
    provenance: deps.worktreeProvenance,
  });

  /** Local history for a workspace, labelled with checkouts: exactly what SESSION_DISCOVER returns. */
  const discoverLocalSessions = async (workspace: RegisteredWorkspace, plan: SessionCheckoutPlan | null, forceRefresh = false, issues?: SessionDiscoveryIssue[]): Promise<HarnessSession[]> => {
    const nativeWorkspacePath = toNativePath(workspace.location.path, process.platform);
    const availableHarnessIds = new Set(Object.keys(getHarnessOptions()));
    const managed = deps.getHarnessAccountService?.()?.discoverySource('local');
    // `forceRefresh` bypasses the history cache. A listing is only a recent view; a conversation that began
    // after it was cached (the first turn of a new conversation) would otherwise be "not found".
    const discover = async (scanPath: string): Promise<HarnessSession[]> => {
      if (issues) {
        const found = await discoverSessionsDetailed(scanPath, { ...(managed ? { managed } : {}), forceRefresh });
        for (const [harness, status] of Object.entries(found.harnessStatus)) {
          if (status.status !== 'error' || !availableHarnessIds.has(harness)) continue;
          console.warn(`[clanker-grid] ${harness} history discovery failed:`, status.failure?.kind ?? 'command-failed');
          const label = findHarnessProvider(harness)?.descriptor.name ?? harness;
          const reason = status.failure?.kind === 'storage-changed' ? 'its session storage format changed'
            : status.failure?.kind === 'binary-unavailable' ? 'its CLI is unavailable'
            : status.failure?.kind === 'timeout' ? 'discovery timed out'
            : status.failure?.kind === 'output-limit' ? 'its session listing exceeds the supported limit'
            : 'its session history could not be read';
          const message = `${label}: ${reason}.`;
          if (!issues.some((issue) => issue.message === message)) issues.push({ harness: harness as HarnessSession['harness'], message });
        }
        return found.sessions;
      }
      return managed || forceRefresh
      ? discoverSessions(scanPath, { ...(managed ? { managed } : {}), ...(forceRefresh ? { forceRefresh: true } : {}) })
      : discoverSessions(scanPath);
    };
    // Conversations of isolated agents live in linked worktrees outside the workspace root; they
    // belong to this workspace's history, labelled with their checkout.
    const sessions = plan
      ? await discoverSessionsWithCheckouts({
        plan, scanWorkspacePath: nativeWorkspacePath, discover,
        onScanError: issues ? () => {
          const message = 'Some checkout history could not be read.';
          if (!issues.some((issue) => issue.message === message)) issues.push({ harness: null, message });
        } : undefined,
        toScanPath: (posixPath) => toNativePath(posixPath, process.platform),
      })
      : await discover(nativeWorkspacePath);
    return sessions.filter((session) => availableHarnessIds.has(session.harness));
  };

  ipcMain.handle(SESSION_DISCOVER, async (_, workspaceId: string, options?: { detailed?: boolean; forceRefresh?: boolean }) => {
    const workspace = typeof workspaceId === 'string'
      ? deps.getWorkspaceRegistry?.()?.getWorkspace(workspaceId)
      : null;
    if (!workspace) throw new Error('Workspace is not registered');
    const plan = await loadPlan(workspaceId, workspace);
    if (workspace.location.environmentId !== 'local') {
      if (!workspace.environment?.capabilities.sessionDiscovery || !workspace.environment.discoverSessions) return options?.detailed ? { sessions: [], issues: [] } : [];
      // One bounded on-host scan covers the workspace and the worktree scopes main derived from Git.
      const scopes = plan ? sessionScanScopes(plan).slice(0, MAX_REMOTE_SESSION_SCOPES) : [];
      const found = scopes.length > 0
        ? await workspace.environment.discoverSessions(workspace.location.path, scopes)
        : await workspace.environment.discoverSessions(workspace.location.path);
      if (deps.getWorkspaceRegistry?.()?.getWorkspace(workspaceId) !== workspace) throw new Error('Remote workspace closed during discovery');
      const sessions = plan ? classifySessions(plan, found) : found;
      return options?.detailed ? { sessions, issues: [] } : sessions;
    }

    const issues: SessionDiscoveryIssue[] = [];
    const sessions = await discoverLocalSessions(workspace, plan, options?.forceRefresh === true, options?.detailed ? issues : undefined);
    if (deps.getWorkspaceRegistry?.()?.getWorkspace(workspaceId) !== workspace) throw new Error('Workspace closed during discovery');
    return options?.detailed ? { sessions, issues } satisfies SessionDiscoveryResult : sessions;
  });

  const invokeSession = async (
    workspaceId: string, requestedSession: HarnessSession, fork?: boolean, options?: SessionInvokeOptions, internal?: InternalResumeRequest,
  ) => {
    const workspace = typeof workspaceId === 'string'
      ? deps.getWorkspaceRegistry?.()?.getWorkspace(workspaceId)
      : null;
    if (!workspace) throw new Error('Workspace is not registered');
    if (workspace.location.environmentId !== 'local') {
      if (internal) throw new Error('Moving a conversation to another checkout is available for local workspaces only');
      return invokeRemoteSession(deps, workspace, requestedSession, fork, options);
    }
    const initialGeometry = readInitialTerminalGeometry(options?.initialGeometry);
    if (!requestedSession || !isHarnessId(requestedSession.harness) || typeof requestedSession.id !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(requestedSession.id.trim())
      || /[\u0000-\u001f\u007f]/.test(requestedSession.id) || (fork !== undefined && typeof fork !== 'boolean')) {
      throw new Error('Invalid local session selection');
    }
    if (!supportsSessionOperation(requestedSession.harness, fork === true, 'local')) {
      throw new Error(`${requestedSession.harness} session invocation is not supported`);
    }
    if (!getHarnessOptions()[requestedSession.harness]) throw new Error(`${requestedSession.harness} harness is not available`);
    const nativeWorkspacePath = toNativePath(workspace.location.path, process.platform);
    const registry = deps.getWorkspaceRegistry?.();
    const checkWorkspace = () => {
      if (getIsShuttingDown() || registry?.getWorkspace(workspaceId) !== workspace) {
        throw new Error('Workspace was closed or is being removed');
      }
    };
    checkWorkspace();
    // Resume runs in the workspace's main checkout context unless the conversation ran in one of its
    // linked worktrees (decided below from the session's recorded cwd, never from renderer fields).
    const mainContext = registry?.resolveCheckoutContext(workspaceId) ?? null;
    const plan = await loadPlan(workspaceId, workspace);
    checkWorkspace();
    const claimedAccountId = (requestedSession as { accountId?: unknown }).accountId;
    const managedClaim = claimedAccountId !== undefined && claimedAccountId !== DEFAULT_HARNESS_ACCOUNT_ID;
    const defaultSelection = !internal && !managedClaim;
    let session = defaultSelection ? await rediscoverDefaultLocalSession({
      selection: { harness: requestedSession.harness, id: requestedSession.id.trim() },
      workspacePath: workspace.location.path, plan,
    }) : requestedSession;
    checkWorkspace();
    const routeFor = (candidate: HarnessSession): ReturnType<typeof routeSessionResume> => {
      const cwd = typeof candidate?.cwd === 'string' ? toPosixPath(candidate.cwd) : '';
      if (plan) return routeSessionResume(plan, cwd);
      // Without a registry there is no worktree evidence: only the workspace root itself qualifies.
      return cwd && !cwd.split('/').some((segment) => segment === '..' || segment === '.')
        && sessionMatchesWorkspace(workspace.location.path, cwd) ? { kind: 'main' } : { kind: 'outside' };
    };
    const preRoute = routeFor(session);
    if (preRoute.kind === 'outside') throw new Error('Session working directory is outside the workspace');
    // The checkout root the session's own history lives under (the workspace root for ordinary sessions).
    const sessionRootPath = preRoute.kind === 'worktree' || preRoute.kind === 'gone'
      ? toNativePath(preRoute.root.path, process.platform) : nativeWorkspacePath;
    // A session's `accountId` is only a claim. For a managed account main re-finds the session inside
    // that account's own storage and launches that authoritative copy with that account's binding;
    // a session without a claim resumes under the native account, never the currently selected one.
    const accountService = deps.getHarnessAccountService?.();
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
    checkWorkspace();
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

    // Same defaults as SPAWN_TERMINAL, but they may not override main's selected conversation.
    const harnessDefaults = store.get('harnessDefaults');
    const attentionEnabled = harnessDefaults[session.harness]?.attentionEnabled === true;
    const userFlags = harnessDefaults[session.harness]?.flags?.trim();
    assertSessionSelectionFlags(session.harness, userFlags, 'local');

    // Where it launches: the checkout the conversation ran in when that still exists (its registered
    // context, or one adopted through Git's own listing); otherwise the main checkout with an
    // explicit notice, or an offer to recreate the worktree for a harness that cannot resume
    // elsewhere. A removed or unusable worktree never becomes the launch directory.
    const sessionPosixCwd = toPosixPath(session.cwd);
    const discoverForConfirmation = (scanPath: string) => {
      const managedSource = accountService?.discoverySource('local');
      return managedSource ? discoverSessions(scanPath, { managed: managedSource }) : discoverSessions(scanPath);
    };
    // A target must be a checkout of THIS workspace, whatever the caller meant to pass.
    if (internal && (internal.targetContext.workspaceId !== workspace.workspaceId
      || internal.targetContext.environmentId !== workspace.location.environmentId)) {
      throw new Error('The target checkout does not belong to this workspace');
    }
    // An internal request carries main's own routing decision (the checkout the lifecycle transaction
    // chose); the recorded directory of the conversation does not get a say.
    const target = internal ? {
      kind: 'launch' as const, target: internal.targetContext.id === mainContext?.id ? 'main' as const : 'worktree' as const, context: internal.targetContext,
    } : plan ? await resolveSessionResumeTarget({
      registry, workspace, plan, harness: session.harness, cwd: sessionPosixCwd, mainContext,
      listWorktrees: deps.listWorktrees ? () => deps.listWorktrees!(workspaceId) : undefined,
      recreateWorktree: deps.recreateWorktree ? (branch) => deps.recreateWorktree!(workspaceId, branch) : undefined,
      recreateRequested: options?.recreateCheckout === true,
      isUsable: (context) => directoryExists(toNativePath(context.path, process.platform)),
      // Default selections already have fresh, unambiguous native evidence; other paths retain their confirmation.
      confirmSession: defaultSelection ? async () => true : async () => (await discoverSessionsWithCheckouts({
        plan, scanWorkspacePath: nativeWorkspacePath, discover: discoverForConfirmation,
        toScanPath: (posixPath) => toNativePath(posixPath, process.platform),
      })).some((entry) => entry.harness === session.harness && entry.id === session.id && toPosixPath(entry.cwd) === sessionPosixCwd),
    }) : { kind: 'launch' as const, target: 'main' as const, context: mainContext };
    checkWorkspace();
    if (target.kind === 'offer') return { recreateOffer: target.offer };

    // A recreated worktree exists again by now, so a harness that validates against its own store
    // (Pi) does so exactly as for any live worktree; nothing about that check is relaxed.
    const validatedSession = await findHarnessProvider(session.harness)?.sessions?.validateLocal?.(session, { workspacePath: sessionRootPath, userFlags }) ?? session;
    checkWorkspace();
    const validatedRoute = routeFor(validatedSession);
    if (validatedSession.id !== session.id || validatedSession.harness !== session.harness
      || validatedRoute.kind !== route.kind || rootPathOf(validatedRoute) !== rootPathOf(route)) {
      throw new Error('Session identity or checkout changed while preparing the launch. Refresh History and try again.');
    }

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
    const { command: sessionCommand, args: builtArgs } = buildSessionLaunch(nativeSession, fork ?? false, userFlags);
    // A Clanker-authoritative move names its target explicitly when the harness has an option for it,
    // from the checkout context main chose (never from the caller, the renderer or the model). An
    // ordinary history resume has no `internal` request and keeps exactly the arguments it always had.
    const baseArgs = internal ? (findHarnessProvider(session.harness)?.checkoutRehome?.withTargetDirectory?.(builtArgs, launchRoot) ?? builtArgs) : builtArgs;
    const harnessEnv = accountBinding.mergeEnvironment(harnessConfig.env ?? {});
    // Same coordinator as an ordinary launch: attention first, then the optional agent bridge.
    const steps: LaunchAttachmentStep[] = [];
    if (agentAttentionBroker) {
      steps.push(attentionLaunchStep({
        broker: agentAttentionBroker, harness: session.harness, terminalId: id, enabled: attentionEnabled,
        rootSessionId: trustedRootSessionId(session.harness, validatedSession, fork === true),
      }));
    }
    if (deps.agentBridge && harnessDefaults[session.harness]?.agentBridgeEnabled === true && launchContext) {
      steps.push(agentBridgeLaunchStep({
        service: deps.agentBridge, harness: session.harness,
        grants: ({ state, bridgeAvailable }) => ({ checkoutRehoming: grantsCheckoutRehoming(session.harness, { nativeAttentionAttached: state.provided.has(NATIVE_ATTENTION_ATTACHED), bridgeAvailable }) }),
        identity: {
          terminalId: id, workspaceId: workspace.workspaceId, environmentId: workspace.location.environmentId,
          checkoutContextId: launchContext.id, harnessId: session.harness,
        },
      }));
    }
    const attachments = await prepareLaunchAttachments({ args: baseArgs, env: { ...process.env, ...harnessEnv } }, steps);
    const spawnArgs = attachments.args;
    // The terminal's cleanup keeps only the disposer: `attachments.env` holds the launch credentials and
    // must not outlive spawning.
    const disposeAttachments = attachments.dispose;
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
        ...withoutAgentBridgeEnvironment(withoutAttentionEnvironment(process.env)),
        ...withoutAgentBridgeEnvironment(withoutAttentionEnvironment(harnessEnv)),
        ...attachments.env,
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
      checkWorkspace();
      if (registry && !isCurrentCheckoutContext(registry, launchContext)) {
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
      attention: localAttentionCapability(session.harness, attentionEnabled, attachments),
      // Main's own record of ownership: an agent's reported location is resolved against it (agentLocation.ts).
      workspaceId: workspace.workspaceId,
      checkoutContextId: launchContext?.id,
      onExit: internal?.onExit
        ? async () => { try { await disposeAttachments(); } finally { internal.onExit?.(); } }
        : disposeAttachments,
      ...(internal?.onOutput ? { onOutput: internal.onOutput } : {}),
      ...(internal?.startupBufferLimit ? { startupBufferLimit: internal.startupBufferLimit } : {}),
      ...(internal?.initialGeometry || initialGeometry ? { initialGeometry: internal?.initialGeometry ?? initialGeometry } : {}),
      });
      return {
        ...result, harnessId: session.harness, attention: localAttentionCapability(session.harness, attentionEnabled, attachments), attentionEnabled: attachments.provided.has(NATIVE_ATTENTION_ATTACHED), checkoutContextId: launchContext?.id,
        // Where it actually started (never the recorded cwd of a removed worktree).
        workingDir: toPosixPath(cwd),
        ...(launchContext && launchContext.kind === 'worktree' ? { checkoutContext: launchContext } : {}),
        ...(resumeNotice ? { resumeNotice } : {}),
      };
    } catch (error) {
      await attachments.dispose();
      throw error;
    }
  };

  ipcMain.handle(SESSION_INVOKE, (_, workspaceId: string, requestedSession: HarnessSession, fork?: boolean, options?: SessionInvokeOptions) =>
    invokeSession(workspaceId, requestedSession, fork, options));

  return {
    async findSession(workspaceId, harness, sessionId) {
      const workspace = deps.getWorkspaceRegistry?.()?.getWorkspace(workspaceId);
      if (!workspace || workspace.location.environmentId !== 'local') return null;
      // Fresh, never cached: this is about a conversation that is running right now.
      const found = await discoverLocalSessions(workspace, await loadPlan(workspaceId, workspace), true);
      return found.find((entry) => entry.harness === harness && entry.id === sessionId) ?? null;
    },
    async resumeInCheckout(workspaceId, session, request) {
      const launched = await invokeSession(workspaceId, session, false, undefined, request);
      // An internal request replaces the routing decision, so it never yields a recreate offer.
      if (!('id' in launched)) throw new Error('The conversation could not be resumed in the requested checkout');
      return launched;
    },
  };
}
