import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Store from 'electron-store';
import type { StoreSchema } from '../../../src/shared/types/store';
import type { TaskSessionRecord } from '../../../src/shared/types/taskSessions';
import {
  TASK_SESSION_LIST,
  TASK_SESSION_DELETE,
  TASK_SESSION_UPDATE,
} from '../../../src/shared/ipcChannels';

const { mockHandle } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockHandle,
  },
}));

import {
  registerTaskSessionIpc,
  evaluateTaskRecoveryState,
} from '../../../src/main/ipc/taskSessionIpc';
import type { Terminal } from '../../../src/main/ipc/terminalIpc';

class MemoryStore {
  private data: Record<string, unknown> = {};

  get(key: string): unknown {
    return this.data[key];
  }

  set(key: string, value: unknown): void {
    this.data[key] = value;
  }
}

describe('evaluateTaskRecoveryState', () => {
  const availableHarnesses = {
    codex: { name: 'Codex' },
    claude: { name: 'Claude' },
    hermes: { name: 'Hermes' },
  };

  it('keeps running state if terminal is genuinely alive in this process', () => {
    const record: TaskSessionRecord = {
      id: 'task-1',
      workspacePath: process.cwd(),
      harnessId: 'codex',
      title: 'Codex Task',
      terminalId: 'term-live-1',
      state: 'running',
      createdAt: 1000,
      updatedAt: 1000,
      version: 1,
    };

    const result = evaluateTaskRecoveryState(
      record,
      new Set(['term-live-1']),
      availableHarnesses,
    );

    expect(result.state).toBe('running');
    expect(result.terminalId).toBe('term-live-1');
  });

  it('marks unavailable if workspace directory does not exist', () => {
    const record: TaskSessionRecord = {
      id: 'task-2',
      workspacePath: '/non/existent/dir/xyz/123',
      harnessId: 'codex',
      title: 'Codex Task',
      terminalId: 'term-dead',
      state: 'running',
      createdAt: 1000,
      updatedAt: 1000,
      version: 1,
    };

    const result = evaluateTaskRecoveryState(
      record,
      new Set(),
      availableHarnesses,
    );

    expect(result.state).toBe('unavailable');
    expect(result.stateReason).toContain('Workspace directory does not exist');
    expect(result.terminalId).toBeUndefined();
  });

  it('marks unavailable if harness is not installed or available', () => {
    const record: TaskSessionRecord = {
      id: 'task-3',
      workspacePath: process.cwd(),
      harnessId: 'opencode', // not in availableHarnesses
      title: 'OpenCode Task',
      state: 'running',
      createdAt: 1000,
      updatedAt: 1000,
      version: 1,
    };

    const result = evaluateTaskRecoveryState(
      record,
      new Set(),
      availableHarnesses,
    );

    expect(result.state).toBe('unavailable');
    expect(result.stateReason).toContain('is not installed or available');
  });

  it('marks unavailable if harness does not support conversation resume', () => {
    const record: TaskSessionRecord = {
      id: 'task-4',
      workspacePath: process.cwd(),
      harnessId: 'hermes',
      title: 'Hermes Task',
      state: 'running',
      createdAt: 1000,
      updatedAt: 1000,
      version: 1,
    };

    const result = evaluateTaskRecoveryState(
      record,
      new Set(),
      availableHarnesses,
    );

    expect(result.state).toBe('unavailable');
    expect(result.stateReason).toContain('does not support conversation resume');
  });

  it('marks resumable if native session ID exists and session is found on disk', () => {
    const record: TaskSessionRecord = {
      id: 'task-5',
      workspacePath: process.cwd(),
      harnessId: 'codex',
      nativeSessionId: 'sess-xyz',
      title: 'Codex Task',
      state: 'running',
      createdAt: 1000,
      updatedAt: 1000,
      version: 1,
    };

    const discovered = [
      { id: 'sess-xyz', harness: 'codex' as const, title: 'Found Session', cwd: process.cwd(), timestamp: 1200 },
    ];

    const result = evaluateTaskRecoveryState(
      record,
      new Set(),
      availableHarnesses,
      discovered,
      [record],
    );

    expect(result.state).toBe('resumable');
    expect(result.terminalId).toBeUndefined();
  });

  it('marks unavailable if native session was deleted from disk', () => {
    const record: TaskSessionRecord = {
      id: 'task-deleted',
      workspacePath: process.cwd(),
      harnessId: 'codex',
      nativeSessionId: 'sess-missing',
      title: 'Codex Task',
      state: 'resumable',
      createdAt: 1000,
      updatedAt: 1000,
      version: 1,
    };

    const discovered = [
      { id: 'sess-other', harness: 'codex' as const, title: 'Other Session', cwd: process.cwd(), timestamp: 1200 },
    ];

    const result = evaluateTaskRecoveryState(
      record,
      new Set(),
      availableHarnesses,
      discovered,
      [record],
    );

    expect(result.state).toBe('unavailable');
    expect(result.stateReason).toContain('Native conversation session was not found on disk');
  });

  it('correlates unambiguous candidate on restart for needs-selection task', () => {
    const record: TaskSessionRecord = {
      id: 'task-restart-correlate',
      workspacePath: process.cwd(),
      harnessId: 'codex',
      title: 'Codex Task',
      state: 'needs-selection',
      createdAt: 5000,
      updatedAt: 5000,
      version: 1,
    };

    const discovered = [
      { id: 'sess-flushed', harness: 'codex' as const, title: 'Flushed Title', cwd: process.cwd(), timestamp: 5100 },
    ];

    const result = evaluateTaskRecoveryState(
      record,
      new Set(),
      availableHarnesses,
      discovered,
      [record],
    );

    expect(result.state).toBe('resumable');
    expect(result.nativeSessionId).toBe('sess-flushed');
    expect(result.title).toBe('Flushed Title');
  });

  it('leaves task in needs-selection if restart correlation is ambiguous', () => {
    const record: TaskSessionRecord = {
      id: 'task-restart-ambiguous',
      workspacePath: process.cwd(),
      harnessId: 'claude',
      title: 'Claude Task',
      state: 'needs-selection',
      createdAt: 5000,
      updatedAt: 5000,
      version: 1,
    };

    const discovered = [
      { id: 'sess-1', harness: 'claude' as const, title: 'Session 1', cwd: process.cwd(), timestamp: 5100 },
      { id: 'sess-2', harness: 'claude' as const, title: 'Session 2', cwd: process.cwd(), timestamp: 5200 },
    ];

    const result = evaluateTaskRecoveryState(
      record,
      new Set(),
      availableHarnesses,
      discovered,
      [record],
    );

    expect(result.state).toBe('needs-selection');
    expect(result.nativeSessionId).toBeUndefined();
  });
});

describe('taskSessionIpc handlers', () => {
  let memoryStore: MemoryStore;
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  const mockTerminals = new Map<string, Terminal>();

  beforeEach(() => {
    memoryStore = new MemoryStore();
    handlers = new Map();
    mockHandle.mockReset();
    mockHandle.mockImplementation((channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    });
  });

  it('registers IPC handlers and handles list, update, delete', async () => {
    const persistence = registerTaskSessionIpc({
      getStore: () => memoryStore as unknown as Store<StoreSchema>,
      getTerminals: () => mockTerminals,
      getHarnessOptions: () => ({ codex: { name: 'Codex' } }),
    });

    expect(handlers.has(TASK_SESSION_LIST)).toBe(true);
    expect(handlers.has(TASK_SESSION_DELETE)).toBe(true);
    expect(handlers.has(TASK_SESSION_UPDATE)).toBe(true);

    // Save initial session via persistence
    persistence.saveTaskSession({
      id: 'task-10',
      workspacePath: process.cwd(),
      harnessId: 'codex',
      title: 'Initial Title',
      state: 'running',
      terminalId: 'term-old',
    });

    const listHandler = handlers.get(TASK_SESSION_LIST)!;
    const updateHandler = handlers.get(TASK_SESSION_UPDATE)!;
    const deleteHandler = handlers.get(TASK_SESSION_DELETE)!;

    // List: should evaluate and transition from dead running to needs-selection
    const sessions = await listHandler(null) as TaskSessionRecord[];
    expect(sessions.length).toBe(1);
    expect(sessions[0].state).toBe('needs-selection');
    expect(sessions[0].terminalId).toBeUndefined();

    // Update with session ID -> becomes resumable
    const updated = await updateHandler(null, {
      id: 'task-10',
      title: 'Updated Title',
      nativeSessionId: 'native-123',
      state: 'resumable',
    }) as TaskSessionRecord;

    expect(updated.title).toBe('Updated Title');
    expect(updated.nativeSessionId).toBe('native-123');
    expect(updated.state).toBe('resumable');

    // Delete
    const deleted = await deleteHandler(null, 'task-10');
    expect(deleted).toBe(true);

    const emptyList = await listHandler(null) as TaskSessionRecord[];
    expect(emptyList.length).toBe(0);
  });
  it('auto-correlates needs-selection task on list when unambiguous session is found', async () => {
    const mockDiscover = vi.fn().mockResolvedValue([
      { id: 'sess-auto', harness: 'codex', title: 'Auto Found', cwd: process.cwd(), timestamp: 2500 },
    ]);

    const persistence = registerTaskSessionIpc({
      getStore: () => memoryStore as unknown as Store<StoreSchema>,
      getTerminals: () => mockTerminals,
      getHarnessOptions: () => ({ codex: { name: 'Codex' } }),
      discoverSessionsFn: mockDiscover,
    });

    persistence.saveTaskSession({
      id: 'task-auto',
      workspacePath: process.cwd(),
      harnessId: 'codex',
      title: 'Initial',
      state: 'needs-selection',
      createdAt: 2000,
      updatedAt: 2000,
    });

    const listHandler = handlers.get(TASK_SESSION_LIST)!;
    const sessions = await listHandler(null) as TaskSessionRecord[];
    expect(sessions.length).toBe(1);
    expect(sessions[0].state).toBe('resumable');
    expect(sessions[0].nativeSessionId).toBe('sess-auto');
    expect(sessions[0].title).toBe('Auto Found');
  });
});
