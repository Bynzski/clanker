import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type Store from 'electron-store';
import type { StoreSchema } from '../../../src/shared/types/store';
import type { HarnessSession } from '../../../src/shared/types/session';
import { WorkspacePersistenceService } from '../../../src/main/workspacePersistence';
import { TaskSessionCoordinator } from '../../../src/main/taskSessionCoordinator';

class MemoryStore {
  private data: Record<string, unknown> = {};

  get(key: string): unknown {
    return this.data[key];
  }

  set(key: string, value: unknown): void {
    this.data[key] = value;
  }
}

describe('TaskSessionCoordinator', () => {
  let memoryStore: MemoryStore;
  let persistence: WorkspacePersistenceService;
  let mockDiscoverSessions: Mock<(workspacePath?: string, options?: { forceRefresh?: boolean }) => Promise<HarnessSession[]>>;
  let coordinator: TaskSessionCoordinator;

  beforeEach(() => {
    memoryStore = new MemoryStore();
    persistence = new WorkspacePersistenceService(() => memoryStore as unknown as Store<StoreSchema>);
    mockDiscoverSessions = vi.fn().mockResolvedValue([]);
    coordinator = new TaskSessionCoordinator(persistence, mockDiscoverSessions);
  });

  it('keeps resumed SSH tasks independent when two harnesses use the same native ID', () => {
    const session: HarnessSession & { environmentId: string } = { id: 'shared-id', harness: 'pi', cwd: '/repo', title: 'Pi', timestamp: 1, environmentId: 'vps' };
    const pi = coordinator.onSessionInvoked('pi-terminal', session);
    const omp = coordinator.onSessionInvoked('omp-terminal', { ...session, harness: 'omp', title: 'OMP' });
    expect(omp.id).not.toBe(pi.id);
    expect(persistence.getTaskSessionById(pi.id)).toMatchObject({ harnessId: 'pi', terminalId: 'pi-terminal' });
    expect(persistence.getTaskSessionById(omp.id)).toMatchObject({ harnessId: 'omp', terminalId: 'omp-terminal' });
  });

  it('preserves the main-captured SSH baseline across exit and shutdown', async () => {
    const baseline = { cwd: '/repo/sub', sessionIds: ['old'], hostTime: 8_000_000, localTime: 1_000_000 };
    const exited = coordinator.onTerminalSpawned('remote-exit', '/repo', 'codex', undefined, 'vps', baseline);
    await coordinator.onTerminalExited('remote-exit', 'vps');
    expect(persistence.getTaskSessionById(exited.id)).toMatchObject({ remoteSessionBaseline: baseline, state: 'unavailable', stoppedAt: expect.any(Number) });
    const shutdown = coordinator.onTerminalSpawned('remote-shutdown', '/repo', 'claude', undefined, 'vps', baseline);
    coordinator.onAppShutdown();
    expect(persistence.getTaskSessionById(shutdown.id)).toMatchObject({ remoteSessionBaseline: baseline, state: 'unavailable', stoppedAt: expect.any(Number) });
    expect(mockDiscoverSessions).not.toHaveBeenCalled();
  });

  it('tracks spawned terminal as running task session', () => {
    const task = coordinator.onTerminalSpawned(
      'term-1',
      '/home/user/project/',
      'codex',
      'gpt-5',
    );

    expect(task.id).toBeDefined();
    expect(task.workspacePath).toBe('/home/user/project');
    expect(task.harnessId).toBe('codex');
    expect(task.modelId).toBe('gpt-5');
    expect(task.terminalId).toBe('term-1');
    expect(task.state).toBe('running');

    const stored = persistence.getAllTaskSessions();
    expect(stored.length).toBe(1);
    expect(stored[0].id).toBe(task.id);
  });

  it('associates invoked session with existing task or creates a new one', () => {
    // 1. Invoking a new session creates a task record with nativeSessionId
    const session: HarnessSession = {
      id: 'sess-abc',
      harness: 'claude',
      title: 'Fix issue',
      cwd: '/home/user/project',
      timestamp: Date.now(),
    };

    const task1 = coordinator.onSessionInvoked('term-2', session);
    expect(task1.nativeSessionId).toBe('sess-abc');
    expect(task1.terminalId).toBe('term-2');
    expect(task1.state).toBe('running');

    // 2. Invoking the same session again updates the existing record
    const task2 = coordinator.onSessionInvoked('term-3', session);
    expect(task2.id).toBe(task1.id);
    expect(task2.terminalId).toBe('term-3');
    expect(task2.state).toBe('running');
    expect(persistence.getAllTaskSessions().length).toBe(1);
  });

  it('correlates native session on terminal exit and transitions to resumable', async () => {
    const task = coordinator.onTerminalSpawned('term-1', '/home/user/project', 'codex');

    // Mock discovered session created during task execution
    mockDiscoverSessions.mockResolvedValueOnce([
      {
        id: 'discovered-session-1',
        harness: 'codex',
        title: 'Discovered prompt title',
        cwd: '/home/user/project',
        timestamp: task.createdAt + 1000,
      },
    ]);

    const updated = await coordinator.onTerminalExited('term-1');
    expect(updated).not.toBeNull();
    expect(updated?.id).toBe(task.id);
    expect(updated?.terminalId).toBeUndefined();
    expect(updated?.nativeSessionId).toBe('discovered-session-1');
    expect(updated?.title).toBe('Discovered prompt title');
    expect(updated?.state).toBe('resumable');
    expect(updated?.stoppedAt).toBeDefined();
  });
  it('retries with forceRefresh: true to capture delayed session flushes', async () => {
    const task = coordinator.onTerminalSpawned('term-flush', '/home/user/project', 'codex');

    // First attempt: empty. Second attempt: delayed session file flushed by harness.
    mockDiscoverSessions
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'delayed-sess-1',
          harness: 'codex',
          title: 'Delayed Session Title',
          cwd: '/home/user/project',
          timestamp: task.createdAt + 100,
        },
      ]);

    const updated = await coordinator.onTerminalExited('term-flush');
    expect(updated).not.toBeNull();
    expect(updated?.nativeSessionId).toBe('delayed-sess-1');
    expect(updated?.title).toBe('Delayed Session Title');
    expect(updated?.state).toBe('resumable');

    // Verify discoverSessions was called with forceRefresh: true
    expect(mockDiscoverSessions).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ forceRefresh: true }),
    );
  });

  it('leaves task in needs-selection if multiple ambiguous sessions are discovered', async () => {
    const task = coordinator.onTerminalSpawned('term-ambiguous', '/home/user/project', 'codex');

    // Two candidates match timestamp window -> ambiguous
    mockDiscoverSessions.mockResolvedValueOnce([
      {
        id: 'sess-1',
        harness: 'codex',
        title: 'Session 1',
        cwd: '/home/user/project',
        timestamp: task.createdAt + 100,
      },
      {
        id: 'sess-2',
        harness: 'codex',
        title: 'Session 2',
        cwd: '/home/user/project',
        timestamp: task.createdAt + 200,
      },
    ]);

    const updated = await coordinator.onTerminalExited('term-ambiguous');
    expect(updated?.state).toBe('needs-selection');
    expect(updated?.nativeSessionId).toBeUndefined();
  });

  it('transitions to needs-selection if session correlation fails on terminal exit', async () => {
    const task = coordinator.onTerminalSpawned('term-1', '/home/user/project', 'codex');
    mockDiscoverSessions.mockResolvedValueOnce([]);

    const updated = await coordinator.onTerminalExited('term-1');
    expect(updated?.id).toBe(task.id);
    expect(updated?.terminalId).toBeUndefined();
    expect(updated?.nativeSessionId).toBeUndefined();
    expect(updated?.state).toBe('needs-selection');
  });

  it('cleans up running tasks on app shutdown without losing metadata', () => {
    coordinator.onTerminalSpawned('term-1', '/home/user/project', 'codex');
    const session: HarnessSession = {
      id: 'sess-resumable',
      harness: 'pi',
      title: 'Pi task',
      cwd: '/home/user/project',
      timestamp: Date.now(),
    };
    coordinator.onSessionInvoked('term-2', session);

    coordinator.onAppShutdown();

    const tasks = persistence.getAllTaskSessions();
    expect(tasks.length).toBe(2);

    const task1 = tasks.find((t) => t.harnessId === 'codex');
    const task2 = tasks.find((t) => t.harnessId === 'pi');

    // task1 had no native session -> needs-selection
    expect(task1?.terminalId).toBeUndefined();
    expect(task1?.state).toBe('needs-selection');
    expect(task1?.stoppedAt).toBeDefined();

    // task2 had native session -> resumable
    expect(task2?.terminalId).toBeUndefined();
    expect(task2?.state).toBe('resumable');
    expect(task2?.nativeSessionId).toBe('sess-resumable');
    expect(task2?.stoppedAt).toBeDefined();
  });

  it('marks remote tasks unavailable on shutdown without local session discovery, including tasks with a native ID', async () => {
    const remote = coordinator.onTerminalSpawned('remote-term', '/home/user/project', 'opencode', undefined, 'dev-vps');
    persistence.saveTaskSession({ ...remote, nativeSessionId: 'remote-native', stateReason: 'stale reason' });
    const local = coordinator.onTerminalSpawned('local-term', '/home/user/project', 'codex');
    coordinator.onAppShutdown();

    const storedRemote = persistence.getTaskSessionById(remote.id);
    expect(storedRemote).toMatchObject({
      environmentId: 'dev-vps', state: 'unavailable',
      stateReason: 'Awaiting remote conversation verification',
      nativeSessionId: 'remote-native',
    });
    expect(storedRemote?.terminalId).toBeUndefined();
    expect(storedRemote?.stoppedAt).toBeDefined();
    expect(storedRemote?.updatedAt).toBeDefined();
    expect(persistence.getTaskSessionById(local.id)?.state).toBe('needs-selection');
    expect(await coordinator.onTerminalExited('remote-term')).toBeNull();
    expect(mockDiscoverSessions).not.toHaveBeenCalled();
  });

  it('keeps legacy tasks without environmentId on the local shutdown recovery path', () => {
    const task = coordinator.onTerminalSpawned('legacy-term', '/home/user/project', 'codex');
    const raw = memoryStore.get('taskSessions') as Array<Record<string, unknown>>;
    memoryStore.set('taskSessions', raw.map((record) => record.id === task.id
      ? { ...record, environmentId: undefined, nativeSessionId: 'legacy-session' }
      : record));
    coordinator.onAppShutdown();
    expect(persistence.getTaskSessionById(task.id)).toMatchObject({ state: 'resumable', nativeSessionId: 'legacy-session' });
  });

  it('ignores late PTY exit callbacks after onAppShutdown has executed', async () => {
    coordinator.onTerminalSpawned('term-race', '/home/user/project', 'codex');
    coordinator.onAppShutdown();

    // PTY kill synchronously or asynchronously fires exit callback
    const result = await coordinator.onTerminalExited('term-race');

    // Should immediately return null without triggering session discovery
    expect(result).toBeNull();
    expect(mockDiscoverSessions).not.toHaveBeenCalled();

    const task = persistence.getAllTaskSessions().find((t) => t.harnessId === 'codex');
    expect(task?.state).toBe('needs-selection');
    expect(task?.terminalId).toBeUndefined();
  });
});
