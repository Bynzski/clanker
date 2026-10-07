import { getHarnessProvider } from '../harnesses/registry';
import { randomUUID } from 'node:crypto';
import type { HarnessSession, SessionInvokeOptions } from '../../shared/types/session';
import type { RegisteredWorkspace } from '../workspaceRegistry';
import type { RegisterSessionIpcDeps } from './sessionIpc';
import { isPathContained } from '../remote/remotePaths';
import { createRemoteAttentionFilter } from '../remote/remoteAttentionTransport';
import { spawnPtyProcess } from './ptySpawn';
import { attentionSourceOptions, trustedRootSessionId } from '../agentAttentionAdapters';
import { loadSessionCheckoutPlan, sessionScanScopes, MAX_REMOTE_SESSION_SCOPES } from '../sessionWorktrees';
import { isCurrentCheckoutContext, resolveSessionResumeTarget, type SessionResumeTarget } from '../sessionResumeTarget';

import { SUPPORTED_RESUME_HARNESSES, assertSessionSelectionFlags, supportsSessionOperation } from '../sessionLaunch';
import { readInitialTerminalGeometry } from '../../shared/terminalGeometry';
/**
 * Re-read the host session instead of trusting renderer-supplied paths or models. The conversation
 * is found by one bounded on-host scan of the workspace plus the worktree scopes main derived from
 * Git; where it resumes is decided in main from that host-reported cwd (never a renderer field), by
 * the same rules as local: a live worktree resumes into its registered or Git-adopted checkout
 * context confined to that root, a removed one resumes in the main checkout with an explicit notice
 * or is offered for recreation, and a removed path is never the working directory.
 */
export async function invokeRemoteSession(deps: RegisterSessionIpcDeps, workspace: RegisteredWorkspace, requested: HarnessSession, fork?: boolean, invokeOptions?: SessionInvokeOptions) {
  const initialGeometry = readInitialTerminalGeometry(invokeOptions?.initialGeometry);
  const environment = workspace.environment;
  if (!environment?.capabilities.sessionDiscovery || !environment.discoverSessions) throw new Error('Remote session invocation is not supported by this environment');
  if (!requested || !SUPPORTED_RESUME_HARNESSES.has(requested.harness) || typeof requested.id !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(requested.id) || (fork !== undefined && typeof fork !== 'boolean')) throw new Error('Invalid remote session selection');
  if (!supportsSessionOperation(requested.harness, fork === true, 'ssh')) throw new Error(`${getHarnessProvider(requested.harness).descriptor.name} session forking is not supported`);
  const registry = deps.getWorkspaceRegistry?.();
  const workspaceId = workspace.workspaceId;
  const checkWorkspace = () => {
    if (deps.getIsShuttingDown() || registry?.getWorkspace(workspace.workspaceId) !== workspace
      || registry.isRemotePathReserved?.(workspace.location.environmentId, workspace.location.path)) throw new Error('Remote workspace was closed or is being removed');
  };
  checkWorkspace();
  // Resume runs in the workspace's main checkout context unless the host-reported cwd is a linked worktree.
  const mainContext = registry?.resolveCheckoutContext(workspace.workspaceId) ?? null;
  const plan = await loadSessionCheckoutPlan({
    registry, workspace,
    listWorktrees: deps.listWorktrees ? () => deps.listWorktrees!(workspaceId) : undefined,
    listBranches: deps.listBranches ? () => deps.listBranches!(workspaceId) : undefined,
    provenance: deps.worktreeProvenance,
  });
  checkWorkspace();
  const scopes = plan ? sessionScanScopes(plan).slice(0, MAX_REMOTE_SESSION_SCOPES) : [];
  const sessions = scopes.length > 0
    ? await environment.discoverSessions(workspace.location.path, scopes)
    : await environment.discoverSessions(workspace.location.path);
  checkWorkspace();
  const found = sessions.find((candidate) => candidate.harness === requested.harness && candidate.id === requested.id);
  if (!found) throw new Error('Remote session was not found in this workspace');
  let target: SessionResumeTarget;
  if (plan) {
    target = await resolveSessionResumeTarget({
      registry, workspace, plan, harness: found.harness, cwd: found.cwd, mainContext,
      listWorktrees: deps.listWorktrees ? () => deps.listWorktrees!(workspaceId) : undefined,
      recreateWorktree: deps.recreateWorktree ? (branch) => deps.recreateWorktree!(workspaceId, branch) : undefined,
      recreateRequested: invokeOptions?.recreateCheckout === true,
    });
  } else if (isPathContained(workspace.location.path, found.cwd)) {
    target = { kind: 'launch', target: 'main', context: mainContext };
  } else {
    throw new Error('Remote session was not found in this workspace');
  }
  if (target.kind === 'offer') return { recreateOffer: target.offer };
  checkWorkspace();

  const launchContext = target.context;
  if (target.target === 'worktree' && !launchContext) throw new Error('Remote session checkout is unavailable');
  const launchRoot = target.target === 'worktree' && launchContext ? launchContext.path : workspace.location.path;
  // A session resumed away from its recorded directory (its worktree is gone) keeps its identity but
  // is launched where main chose; the host launch script then re-verifies that directory and root.
  const session: HarnessSession = isPathContained(launchRoot, found.cwd) ? found : { ...found, cwd: launchRoot };
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(session.id)
    || (session.modelId && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(session.modelId))
    || (session.provider && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(session.provider))
    || (getHarnessProvider(session.harness).sessions?.validateRemote?.(session) === false)) throw new Error('Invalid remote session metadata');
  const harnessOptions = await environment.getHarnessOptions();
  checkWorkspace();
  if (!harnessOptions[session.harness]) throw new Error(`${session.harness} harness is not available on the remote host`);
  const validation = await environment.validateWorkspacePath(session.cwd);
  checkWorkspace();
  if (!validation.valid || validation.resolvedPath !== session.cwd || !isPathContained(launchRoot, validation.resolvedPath)) throw new Error('Remote session working directory is no longer valid');
  if (registry?.isRemotePathReserved?.(workspace.location.environmentId, session.cwd)) throw new Error('Remote session directory is being removed');
  const defaults = deps.getStore().get('harnessDefaults')[session.harness];
  const flags = defaults?.flags?.trim();
  assertSessionSelectionFlags(session.harness, flags, 'ssh');
  const id = `term-${randomUUID()}`;
  const broker = deps.agentAttentionBroker;
  // The rediscovered host session is the only authority for a resumed root identity.
  const attentionRootSessionId = trustedRootSessionId(session.harness, session, fork === true);
  const attentionToken = defaults?.attentionEnabled && environment.capabilities.agentAttention && broker
    ? broker.registerRemote(id, session.harness, { rootSessionId: attentionRootSessionId, ...attentionSourceOptions(session.harness) }) : undefined;
  let releaseAttention: (() => Promise<void>) | undefined;
  try {
    const resolved = await environment.resolveTerminalSpawn({
      id, workingDir: session.cwd, harness: session.harness, flags, attentionToken, attentionRootSessionId,
      resumeSession: { session, fork: fork === true, workspaceRoot: launchRoot },
    });
    releaseAttention = resolved.releaseAttention;
    checkWorkspace();
    if (registry?.isRemotePathReserved?.(workspace.location.environmentId, session.cwd)) throw new Error('Remote session directory is being removed');
    if (!isCurrentCheckoutContext(registry, launchContext)) throw new Error('Remote session checkout was released while resuming');
    const result = spawnPtyProcess({
      id, spawnCmd: resolved.spawnCmd, spawnArgs: resolved.spawnArgs, cwd: process.cwd(), env: resolved.env,
      terminals: deps.getTerminals(), mainWindow: deps.getMainWindow(), getIsShuttingDown: deps.getIsShuttingDown,
      launchLabel: resolved.launchLabel, harnessId: session.harness, workspaceId: workspace.workspaceId,
      checkoutContextId: launchContext?.id,
      ...(initialGeometry ? { initialGeometry } : {}),
      environmentId: workspace.location.environmentId, remoteWorkingDir: session.cwd,
      onOutput: deps.createRemoteOutputObserver?.(workspace.workspaceId),
      filterData: resolved.attentionEnabled && broker ? createRemoteAttentionFilter((raw) => broker.receiveRemote(id, raw)) : undefined,
      onExit: async () => {
        broker?.release(id);
        await releaseAttention?.();
      },
    });
    return {
      ...result, harnessId: session.harness, attentionEnabled: resolved.attentionEnabled === true, workingDir: session.cwd,
      checkoutContextId: launchContext?.id,
      ...(launchContext && launchContext.kind === 'worktree' ? { checkoutContext: launchContext } : {}),
      ...(target.notice ? { resumeNotice: target.notice } : {}),
    };
  } catch (error) {
    broker?.release(id);
    await releaseAttention?.().catch(() => undefined);
    throw error;
  }
}
