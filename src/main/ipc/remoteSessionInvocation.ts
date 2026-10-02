import { getHarnessProvider } from '../harnesses/registry';
import { randomUUID } from 'node:crypto';
import type { HarnessSession } from '../../shared/types/session';
import type { RegisteredWorkspace } from '../workspaceRegistry';
import type { RegisterSessionIpcDeps } from './sessionIpc';
import { isPathContained } from '../remote/remotePaths';
import { createRemoteAttentionFilter } from '../remote/remoteAttentionTransport';
import { captureRemoteSessionBaseline } from '../remote/remoteSessionCorrelation';
import { spawnPtyProcess } from './ptySpawn';

import { SUPPORTED_RESUME_HARNESSES, supportsSessionOperation } from '../sessionLaunch';
/** Re-read the host session instead of trusting renderer-supplied paths or models. */
export async function invokeRemoteSession(deps: RegisterSessionIpcDeps, workspace: RegisteredWorkspace, requested: HarnessSession, fork?: boolean) {
  const environment = workspace.environment;
  if (!environment?.capabilities.sessionDiscovery || !environment.discoverSessions) throw new Error('Remote session invocation is not supported by this environment');
  if (!requested || !SUPPORTED_RESUME_HARNESSES.has(requested.harness) || typeof requested.id !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(requested.id) || (fork !== undefined && typeof fork !== 'boolean')) throw new Error('Invalid remote session selection');
  if (!supportsSessionOperation(requested.harness, fork === true, 'ssh')) throw new Error(`${getHarnessProvider(requested.harness).descriptor.name} session forking is not supported`);
  const registry = deps.getWorkspaceRegistry?.();
  const checkWorkspace = () => {
    if (deps.getIsShuttingDown() || registry?.getWorkspace(workspace.workspaceId) !== workspace
      || registry.isRemotePathReserved?.(workspace.location.environmentId, workspace.location.path)) throw new Error('Remote workspace was closed or is being removed');
  };
  checkWorkspace();
  const sessions = await environment.discoverSessions(workspace.location.path);
  checkWorkspace();
  const session = sessions.find((candidate) => candidate.harness === requested.harness && candidate.id === requested.id);
  if (!session || !isPathContained(workspace.location.path, session.cwd)) throw new Error('Remote session was not found in this workspace');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(session.id)
    || (session.modelId && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(session.modelId))
    || (session.provider && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(session.provider))
    || (getHarnessProvider(session.harness).sessions?.validateRemote?.(session) === false)) throw new Error('Invalid remote session metadata');
  const options = await environment.getHarnessOptions();
  checkWorkspace();
  if (!options[session.harness]) throw new Error(`${session.harness} harness is not available on the remote host`);
  const validation = await environment.validateWorkspacePath(session.cwd);
  checkWorkspace();
  if (!validation.valid || validation.resolvedPath !== session.cwd || !isPathContained(workspace.location.path, validation.resolvedPath)) throw new Error('Remote session working directory is no longer valid');
  if (registry?.isRemotePathReserved?.(workspace.location.environmentId, session.cwd)) throw new Error('Remote session directory is being removed');
  const defaults = deps.getStore().get('harnessDefaults')[session.harness];
  const flags = defaults?.flags?.trim();
  const tokens = flags?.split(/\s+/) ?? [];
  if (tokens.some((token) => (getHarnessProvider(session.harness).sessions?.selectionFlags ?? []).some((option) => token === option || token.startsWith(`${option}=`) || (option.length === 2 && token.startsWith(option))))) throw new Error('Harness default flags conflict with remote session selection');
  const id = `term-${randomUUID()}`;
  const broker = deps.agentAttentionBroker;
  const attentionToken = defaults?.attentionEnabled && environment.capabilities.agentAttention && broker
    ? broker.registerRemote(id, session.harness) : undefined;
  let releaseAttention: (() => Promise<void>) | undefined;
  try {
    const baseline = fork ? await captureRemoteSessionBaseline(environment, workspace.location.path, session.cwd, session.harness) : undefined;
    checkWorkspace();
    const resolved = await environment.resolveTerminalSpawn({
      id, workingDir: session.cwd, harness: session.harness, flags, attentionToken,
      resumeSession: { session, fork: fork === true, workspaceRoot: workspace.location.path },
    });
    releaseAttention = resolved.releaseAttention;
    checkWorkspace();
    if (registry?.isRemotePathReserved?.(workspace.location.environmentId, session.cwd)) throw new Error('Remote session directory is being removed');
    const result = spawnPtyProcess({
      id, spawnCmd: resolved.spawnCmd, spawnArgs: resolved.spawnArgs, cwd: process.cwd(), env: resolved.env,
      terminals: deps.getTerminals(), mainWindow: deps.getMainWindow(), getIsShuttingDown: deps.getIsShuttingDown,
      launchLabel: resolved.launchLabel, harnessId: session.harness, workspaceId: workspace.workspaceId,
      environmentId: workspace.location.environmentId, remoteWorkingDir: session.cwd,
      onOutput: deps.createRemoteOutputObserver?.(workspace.workspaceId),
      filterData: resolved.attentionEnabled && broker ? createRemoteAttentionFilter((raw) => broker.receiveRemote(id, raw)) : undefined,
      onExit: () => {
        broker?.release(id);
        return Promise.all([
          releaseAttention?.(), deps.taskSessionCoordinator?.onTerminalExited(id, workspace.location.environmentId),
        ]).then(() => undefined);
      },
    });
    if (fork) deps.taskSessionCoordinator?.onTerminalSpawned(id, workspace.location.path, session.harness, session.modelId, workspace.location.environmentId, baseline);
    else deps.taskSessionCoordinator?.onSessionInvoked(id, { ...session, cwd: workspace.location.path, environmentId: workspace.location.environmentId });
    return { ...result, harnessId: session.harness, attentionEnabled: resolved.attentionEnabled === true, workingDir: session.cwd };
  } catch (error) {
    broker?.release(id);
    await releaseAttention?.().catch(() => undefined);
    throw error;
  }
}
