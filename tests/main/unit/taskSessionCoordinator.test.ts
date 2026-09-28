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
  let mockDiscoverSessions: Mock<(workspacePath?: string) => Promise<HarnessSession[]>>;
  let coordinator: TaskSessionCoordinator;

  beforeEach(() => {
    memoryStore = new MemoryStore();
    persistence = new WorkspacePersistenceService(() => memoryStore as unknown as Store<StoreSchema>);
    mockDiscoverSessions = vi.fn().mockResolvedValue([]);
    coordinator = new TaskSessionCoordinator(persistence, mockDiscoverSessions);
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
});
