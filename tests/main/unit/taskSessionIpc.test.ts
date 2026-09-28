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

  it('marks resumable if native session ID exists and harness is supported', () => {
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

    const result = evaluateTaskRecoveryState(
      record,
      new Set(),
      availableHarnesses,
    );

    expect(result.state).toBe('resumable');
    expect(result.terminalId).toBeUndefined();
  });

  it('marks needs-selection if native session ID is missing', () => {
    const record: TaskSessionRecord = {
      id: 'task-6',
      workspacePath: process.cwd(),
      harnessId: 'claude',
      title: 'Claude Task',
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

    expect(result.state).toBe('needs-selection');
    expect(result.terminalId).toBeUndefined();
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
});
