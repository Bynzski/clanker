import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRemoteSession } from '../../../src/main/ipc/remoteSessionInvocation';
import type { RegisterSessionIpcDeps } from '../../../src/main/ipc/sessionIpc';
import type { RegisteredWorkspace } from '../../../src/main/workspaceRegistry';
import type { HarnessSession } from '../../../src/shared/types/session';
vi.mock('../../../src/main/ipc/ptySpawn', () => ({ spawnPtyProcess: vi.fn() }));
import { spawnPtyProcess } from '../../../src/main/ipc/ptySpawn';
import { withCheckoutContexts } from '../../_helpers/checkoutContexts';

function fixture(harness: HarnessSession['harness'] = 'codex') {
  const session: HarnessSession = { id: harness === 'agy' ? '12345678-1234-1234-1234-123456789abc' : 'native-id', harness, title: 'Host session', cwd: '/ws/sub', timestamp: 1, modelId: 'host-model', ...(harness === 'pi' || harness === 'omp' ? { filePath: `/home/remote/.${harness}/agent/sessions/p/session.jsonl` } : {}) };
  const release = vi.fn().mockResolvedValue(undefined);
  const environment = {
    capabilities: { sessionDiscovery: true, agentAttention: true },
    discoverSessions: vi.fn().mockResolvedValue([session]),
    getHarnessOptions: vi.fn().mockResolvedValue({ [harness]: { command: harness } }),
    validateWorkspacePath: vi.fn().mockResolvedValue({ valid: true, resolvedPath: '/ws/sub' }),
    resolveTerminalSpawn: vi.fn().mockResolvedValue({ spawnCmd: 'ssh', spawnArgs: ['-t', 'remote-host', 'remote launch'], env: {}, releaseAttention: release, attentionEnabled: true }),
  };
  const workspace = { workspaceId: 'remote-ws', location: { environmentId: 'ssh-a', path: '/ws' }, environment } as unknown as RegisteredWorkspace;
  const registry = withCheckoutContexts({ getWorkspace: vi.fn().mockReturnValue(workspace), isRemotePathReserved: vi.fn().mockReturnValue(false) });
  const broker = { registerRemote: vi.fn().mockReturnValue('a'.repeat(64)), release: vi.fn(), receiveRemote: vi.fn() };
  const defaults: { flags?: string; attentionEnabled?: boolean } = { flags: '--verbose', attentionEnabled: true };
  const deps = {
    getWorkspaceRegistry: () => registry, getIsShuttingDown: vi.fn().mockReturnValue(false),
    getTerminals: () => new Map(), getMainWindow: () => null,
    getStore: () => ({ get: () => ({ [harness]: defaults }) }),
    getHarnessOptions: vi.fn(() => { throw new Error('Desktop harnesses must not be consulted'); }),
    agentAttentionBroker: broker,
  } as unknown as RegisterSessionIpcDeps;
  return { session, environment, workspace, registry, broker, deps, release, defaults };
}
beforeEach(() => { vi.mocked(spawnPtyProcess).mockReset().mockImplementation((options) => ({ id: options.id, pid: 123 })); });

describe('remote session invocation', () => {
  it('releases broker registration when remote attention preparation fails', async () => {
    const f = fixture();
    f.environment.resolveTerminalSpawn.mockRejectedValueOnce(new Error('Host attention setup failed'));
    await expect(invokeRemoteSession(f.deps, f.workspace, f.session)).rejects.toThrow('attention setup failed');
    const id = f.broker.registerRemote.mock.calls[0][0];
    expect(f.broker.release).toHaveBeenCalledExactlyOnceWith(id);
    expect(spawnPtyProcess).not.toHaveBeenCalled();
  });

  it('refuses a workspace closed during host discovery before preparing attention', async () => {
    const f = fixture();
    let finish!: (sessions: HarnessSession[]) => void;
    f.environment.discoverSessions.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = invokeRemoteSession(f.deps, f.workspace, f.session);
    f.registry.getWorkspace.mockReturnValue(null);
    finish([f.session]);
    await expect(pending).rejects.toThrow('closed');
    expect(f.broker.registerRemote).not.toHaveBeenCalled();
    expect(f.environment.resolveTerminalSpawn).not.toHaveBeenCalled();
    expect(spawnPtyProcess).not.toHaveBeenCalled();
  });

  it.each(['codex', 'claude', 'opencode', 'pi', 'omp', 'agy'] as const)('resumes %s using fresh host metadata and the remote PTY lifecycle', async (harness) => {
    const f = fixture(harness);
    const result = await invokeRemoteSession(f.deps, f.workspace, { ...f.session, cwd: '/desktop/evil', modelId: 'spoofed', filePath: '/desktop/evil.jsonl' }) as { id: string };
    expect(f.environment.discoverSessions).toHaveBeenCalledWith('/ws');
    expect(f.environment.resolveTerminalSpawn).toHaveBeenCalledWith(expect.objectContaining({ workingDir: '/ws/sub', harness, attentionToken: 'a'.repeat(64), attentionRootSessionId: harness === 'claude' ? undefined : f.session.id, resumeSession: { session: f.session, fork: false, workspaceRoot: '/ws' } }));
    expect(spawnPtyProcess).toHaveBeenCalledWith(expect.objectContaining({ spawnCmd: 'ssh', workspaceId: 'remote-ws', environmentId: 'ssh-a', remoteWorkingDir: '/ws/sub', filterData: expect.any(Function) }));
    expect(result).toMatchObject({ workingDir: '/ws/sub', attentionEnabled: true });
    vi.mocked(spawnPtyProcess).mock.calls[0][0].onExit?.(result.id);
    expect(f.broker.release).toHaveBeenCalledWith(result.id);
    expect(f.release).toHaveBeenCalled();
  });
  it('seeds the rediscovered host session as the expected root for resume, never for fork or untrusted providers', async () => {
    const resumed = fixture('codex');
    await invokeRemoteSession(resumed.deps, resumed.workspace, resumed.session);
    expect(resumed.broker.registerRemote).toHaveBeenCalledWith(expect.any(String), 'codex', { rootSessionId: 'native-id', authority: 'full', quality: 'hook' });
    expect(resumed.environment.resolveTerminalSpawn).toHaveBeenCalledWith(expect.objectContaining({ attentionRootSessionId: 'native-id' }));
    const forked = fixture('codex');
    await invokeRemoteSession(forked.deps, forked.workspace, forked.session, true);
    expect(forked.broker.registerRemote).toHaveBeenCalledWith(expect.any(String), 'codex', { rootSessionId: undefined, authority: 'full', quality: 'hook' });
    expect(forked.environment.resolveTerminalSpawn).toHaveBeenCalledWith(expect.objectContaining({ attentionRootSessionId: undefined }));
    const claude = fixture('claude');
    await invokeRemoteSession(claude.deps, claude.workspace, claude.session);
    expect(claude.broker.registerRemote).toHaveBeenCalledWith(expect.any(String), 'claude', { rootSessionId: undefined, authority: 'partial', quality: 'hook' });
  });
  it('refuses unsupported, missing, unavailable, invalid and escaping sessions before spawning', async () => {
    const f = fixture();
    for (const id of ['--dangerous', '../path', 'id\ncommand']) await expect(invokeRemoteSession(f.deps, f.workspace, { ...f.session, id })).rejects.toThrow('Invalid remote session selection');
    await expect(invokeRemoteSession(f.deps, f.workspace, { ...f.session, harness: 'hermes' })).rejects.toThrow('Invalid remote session selection');
    f.environment.discoverSessions.mockResolvedValueOnce([]);
    await expect(invokeRemoteSession(f.deps, f.workspace, f.session)).rejects.toThrow('not found');
    f.environment.getHarnessOptions.mockResolvedValueOnce({});
    await expect(invokeRemoteSession(f.deps, f.workspace, f.session)).rejects.toThrow('not available');
    f.environment.validateWorkspacePath.mockResolvedValueOnce({ valid: true, resolvedPath: '/outside' });
    await expect(invokeRemoteSession(f.deps, f.workspace, f.session)).rejects.toThrow('no longer valid');
    expect(spawnPtyProcess).not.toHaveBeenCalled();
  });
  it('rejects conflicting attached selection flags and unsupported Antigravity forks', async () => {
    const f = fixture('opencode');
    for (const flags of ['--session=other', '-sother', '--continue']) {
      f.defaults.flags = flags;
      await expect(invokeRemoteSession(f.deps, f.workspace, f.session)).rejects.toThrow('flags conflict');
    }
    const agy = fixture('agy');
    await expect(invokeRemoteSession(agy.deps, agy.workspace, agy.session, true)).rejects.toThrow('forking is not supported');
    expect(spawnPtyProcess).not.toHaveBeenCalled();
  });
  it('forks without recording any durable task-session state', async () => {
    const f = fixture('pi');
    const storeSet = vi.fn();
    f.deps.getStore = () => ({ get: () => ({ pi: f.defaults }), set: storeSet }) as never;
    await invokeRemoteSession(f.deps, f.workspace, f.session, true);
    expect(f.environment.resolveTerminalSpawn).toHaveBeenCalledWith(expect.objectContaining({
      resumeSession: { session: f.session, fork: true, workspaceRoot: '/ws' },
    }));
    expect(storeSet.mock.calls.map(([key]) => key)).not.toContain('taskSessions');
  });
  it('rechecks registration and path reservations after preparation, releasing attention on refusal or spawn failure', async () => {
    for (const outcome of ['replaced', 'reserved', 'shutdown', 'spawn-error']) {
      const f = fixture();
      f.environment.resolveTerminalSpawn.mockImplementationOnce(async () => {
        if (outcome === 'replaced') f.registry.getWorkspace.mockReturnValue({ ...f.workspace });
        if (outcome === 'reserved') f.registry.isRemotePathReserved.mockReturnValue(true);
        if (outcome === 'shutdown') vi.mocked(f.deps.getIsShuttingDown).mockReturnValue(true);
        if (outcome === 'spawn-error') vi.mocked(spawnPtyProcess).mockImplementationOnce(() => { throw new Error('spawn failed'); });
        return { spawnCmd: 'ssh', spawnArgs: [], env: {}, releaseAttention: f.release, attentionEnabled: true };
      });
      await expect(invokeRemoteSession(f.deps, f.workspace, f.session)).rejects.toThrow();
      expect(f.release).toHaveBeenCalled();
      expect(f.broker.release).toHaveBeenCalled();
    }
    expect(spawnPtyProcess).toHaveBeenCalledTimes(1);
  });
});
