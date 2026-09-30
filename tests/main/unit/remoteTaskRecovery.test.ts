import { describe, expect, it, vi } from 'vitest';
import { RemoteTaskRecovery } from '../../../src/main/ipc/remoteTaskRecovery';
import type { WorkspaceRegistry, RegisteredWorkspace } from '../../../src/main/workspaceRegistry';
import type { TaskSessionRecord } from '../../../src/shared/types/taskSessions';
import type { HarnessSession } from '../../../src/shared/types/session';

function fixture(harness: HarnessSession['harness'] = 'codex') {
  const record: TaskSessionRecord = { id: 'task', environmentId: 'vps', workspacePath: '/remote/repo', harnessId: harness, nativeSessionId: 'native', nativeSessionPath: '/stale', title: 'Old title', state: 'unavailable', stateReason: 'Remote session recovery is not supported in this version', createdAt: 1, updatedAt: 1, version: 1 };
  const session: HarnessSession = { id: 'native', harness, cwd: '/remote/repo/sub', title: 'Host title', timestamp: 1, filePath: '/host/session.jsonl' };
  const environment = {
    capabilities: { sessionDiscovery: true },
    validateWorkspacePath: vi.fn().mockResolvedValue({ valid: true, resolvedPath: '/remote/repo' }),
    getHarnessOptions: vi.fn().mockResolvedValue({ [harness]: {} }),
    discoverSessions: vi.fn().mockResolvedValue([session]),
  };
  const workspace = { workspaceId: 'ws', location: { environmentId: 'vps', path: '/remote/repo' }, environment } as unknown as RegisteredWorkspace;
  const registry = { getWorkspaceByLocation: vi.fn().mockReturnValue(workspace), getWorkspace: vi.fn().mockReturnValue(workspace) };
  const recovery = new RemoteTaskRecovery(registry as unknown as WorkspaceRegistry);
  return { record, session, environment, workspace, registry, recovery };
}

describe('known remote task recovery', () => {
  it.each(['codex', 'claude', 'opencode', 'pi', 'omp', 'agy'] as const)('verifies %s on its own host and refreshes saved metadata', async (harness) => {
    const f = fixture(harness);
    expect(await f.recovery.evaluate(f.record)).toMatchObject({ state: 'resumable', stateReason: undefined, terminalId: undefined, title: 'Host title', nativeSessionPath: '/host/session.jsonl' });
    expect(f.registry.getWorkspaceByLocation).toHaveBeenCalledWith('vps', '/remote/repo');
    expect(f.environment.discoverSessions).toHaveBeenCalledWith('/remote/repo');
  });

  it('shares one host verification across tasks in the same workspace', async () => {
    const f = fixture();
    await f.recovery.evaluate(f.record);
    await f.recovery.evaluate({ ...f.record, id: 'other', nativeSessionId: 'missing' });
    expect(f.environment.discoverSessions).toHaveBeenCalledTimes(1);
    expect(f.environment.getHarnessOptions).toHaveBeenCalledTimes(1);
  });

  it('requires registration, a supported harness, and a known association', async () => {
    const f = fixture();
    f.registry.getWorkspaceByLocation.mockReturnValueOnce(null);
    expect(await f.recovery.evaluate(f.record)).toMatchObject({ state: 'unavailable', stateReason: expect.stringContaining('Open the SSH workspace') });
    expect(await f.recovery.evaluate({ ...f.record, harnessId: 'hermes' })).toMatchObject({ state: 'unavailable' });
    expect(await f.recovery.evaluate({ ...f.record, nativeSessionId: undefined })).toMatchObject({ state: 'needs-selection', stateReason: undefined });
    expect(f.environment.discoverSessions).not.toHaveBeenCalled();
  });

  it.each(['missing', 'wrong-harness', 'outside-root', 'uninstalled', 'invalid-root', 'capability'])('fails closed for %s', async (failure) => {
    const f = fixture();
    if (failure === 'missing') f.environment.discoverSessions.mockResolvedValue([]);
    if (failure === 'wrong-harness') f.environment.discoverSessions.mockResolvedValue([{ ...f.session, harness: 'claude' }]);
    if (failure === 'outside-root') f.environment.discoverSessions.mockResolvedValue([{ ...f.session, cwd: '/remote/other' }]);
    if (failure === 'uninstalled') f.environment.getHarnessOptions.mockResolvedValue({});
    if (failure === 'invalid-root') f.environment.validateWorkspacePath.mockResolvedValue({ valid: true, resolvedPath: '/elsewhere' });
    if (failure === 'capability') f.environment.capabilities.sessionDiscovery = false;
    expect(await f.recovery.evaluate(f.record)).toMatchObject({ state: 'unavailable', nativeSessionId: 'native', nativeSessionPath: '/stale' });
  });

  it('retains identity on an SSH error and recovers on the next list request', async () => {
    const f = fixture();
    f.environment.discoverSessions.mockRejectedValueOnce(new Error('SSH disconnected'));
    const failed = await f.recovery.evaluate(f.record);
    expect(failed).toMatchObject({ state: 'unavailable', nativeSessionId: 'native', stateReason: expect.stringContaining('SSH disconnected') });
    expect(await new RemoteTaskRecovery(f.registry as unknown as WorkspaceRegistry).evaluate(failed)).toMatchObject({ state: 'resumable', stateReason: undefined });
  });

  it('discards verification after the workspace closes or is replaced', async () => {
    const f = fixture();
    f.environment.discoverSessions.mockImplementation(async () => {
      f.registry.getWorkspace.mockReturnValue({ ...f.workspace });
      return [f.session];
    });
    expect(await f.recovery.evaluate(f.record)).toMatchObject({ state: 'unavailable', stateReason: expect.stringContaining('workspace closed') });
  });

  it('preserves an explicit resume failure until the user retries', async () => {
    const f = fixture();
    expect(await f.recovery.evaluate({ ...f.record, stateReason: 'Failed to resume: bad flags' })).toMatchObject({ state: 'unavailable', stateReason: 'Failed to resume: bad flags' });
    expect(f.environment.discoverSessions).not.toHaveBeenCalled();
  });

  it('rejects final association after the verified workspace registration is lost', async () => {
    const f = fixture();
    const record = { ...f.record, nativeSessionId: undefined, stoppedAt: 2,
      remoteSessionBaseline: { cwd: f.session.cwd, hostTime: 1, localTime: 1, sessionIds: [] } };
    expect(await f.recovery.evaluate(record, [record])).toMatchObject({ nativeSessionId: 'native', state: 'resumable' });
    expect(f.recovery.canAssociate(record, 'native', [record])).toBe(true);
    f.registry.getWorkspace.mockReturnValue(null as never);
    expect(f.recovery.canAssociate(record, 'native', [record])).toBe(false);
  });
});
