import { describe, it, expect } from 'vitest';
import type { HarnessSession } from '../../../src/shared/types/session';
import type { TaskSessionRecord } from '../../../src/shared/types/taskSessions';
import { findUnambiguousSessionCandidate } from '../../../src/main/sessionCorrelation';

describe('sessionCorrelation', () => {
  const task: Pick<TaskSessionRecord, 'id' | 'workspacePath' | 'harnessId' | 'createdAt'> = {
    id: 'task-target',
    workspacePath: '/projects/repo',
    harnessId: 'codex',
    createdAt: 10000,
  };

  it('associates when exactly one candidate is found within timestamp window', () => {
    const discovered: HarnessSession[] = [
      {
        id: 'sess-1',
        harness: 'codex',
        title: 'Task 1 conversation',
        cwd: '/projects/repo',
        timestamp: 10500,
      },
    ];

    const result = findUnambiguousSessionCandidate(task, discovered, []);
    expect(result).not.toBeNull();
    expect(result?.id).toBe('sess-1');
  });

  it('returns null when multiple candidates match (conservative, no guessing)', () => {
    const discovered: HarnessSession[] = [
      {
        id: 'sess-1',
        harness: 'codex',
        title: 'Older conversation',
        cwd: '/projects/repo',
        timestamp: 10100,
      },
      {
        id: 'sess-2',
        harness: 'codex',
        title: 'Newer conversation',
        cwd: '/projects/repo',
        timestamp: 10500,
      },
    ];

    const result = findUnambiguousSessionCandidate(task, discovered, []);
    expect(result).toBeNull();
  });

  it('excludes candidates already associated with other tasks', () => {
    const discovered: HarnessSession[] = [
      {
        id: 'sess-taken',
        harness: 'codex',
        title: 'Taken conversation',
        cwd: '/projects/repo',
        timestamp: 10100,
      },
      {
        id: 'sess-free',
        harness: 'codex',
        title: 'Free conversation',
        cwd: '/projects/repo',
        timestamp: 10200,
      },
    ];

    const otherTasks: TaskSessionRecord[] = [
      {
        id: 'task-other',
        workspacePath: '/projects/repo',
        harnessId: 'codex',
        title: 'Other task',
        nativeSessionId: 'sess-taken',
        state: 'resumable',
        createdAt: 9000,
        updatedAt: 9500,
        version: 1,
      },
    ];

    // sess-taken is excluded, leaving only sess-free as the unambiguous candidate
    const result = findUnambiguousSessionCandidate(task, discovered, otherTasks);
    expect(result).not.toBeNull();
    expect(result?.id).toBe('sess-free');
  });

  it('handles multiple simultaneous tasks using the same harness without duplicate assignment', () => {
    const taskA: Pick<TaskSessionRecord, 'id' | 'workspacePath' | 'harnessId' | 'createdAt'> = {
      id: 'task-A',
      workspacePath: '/projects/repo',
      harnessId: 'codex',
      createdAt: 10000,
    };
    const taskB: Pick<TaskSessionRecord, 'id' | 'workspacePath' | 'harnessId' | 'createdAt'> = {
      id: 'task-B',
      workspacePath: '/projects/repo',
      harnessId: 'codex',
      createdAt: 10000,
    };

    const discovered: HarnessSession[] = [
      {
        id: 'sess-1',
        harness: 'codex',
        title: 'Conversation 1',
        cwd: '/projects/repo',
        timestamp: 10200,
      },
      {
        id: 'sess-2',
        harness: 'codex',
        title: 'Conversation 2',
        cwd: '/projects/repo',
        timestamp: 10300,
      },
    ];

    // While both sessions are unassigned, neither task can guess unambiguously
    expect(findUnambiguousSessionCandidate(taskA, discovered, [])).toBeNull();
    expect(findUnambiguousSessionCandidate(taskB, discovered, [])).toBeNull();

    // If taskA is assigned to sess-1 (e.g., manually or earlier)
    const taskARecord: TaskSessionRecord = {
      id: 'task-A',
      workspacePath: '/projects/repo',
      harnessId: 'codex',
      title: 'Task A',
      nativeSessionId: 'sess-1',
      state: 'resumable',
      createdAt: 10000,
      updatedAt: 10250,
      version: 1,
    };

    // Now taskB has only sess-2 as an unassociated candidate -> unambiguous!
    const resultB = findUnambiguousSessionCandidate(taskB, discovered, [taskARecord]);
    expect(resultB).not.toBeNull();
    expect(resultB?.id).toBe('sess-2');
  });

  it('accepts candidate within task lifetime or slightly after stoppedAt (flush delay)', () => {
    const stoppedTask: Pick<TaskSessionRecord, 'id' | 'workspacePath' | 'harnessId' | 'createdAt' | 'stoppedAt' | 'updatedAt'> = {
      id: 'task-lifetime',
      workspacePath: '/projects/repo',
      harnessId: 'codex',
      createdAt: 10_000,
      stoppedAt: 20_000,
      updatedAt: 20_000,
    };

    // Session within run time
    const sessionDuringRun = [
      { id: 's-during', harness: 'codex' as const, title: 'During', cwd: '/projects/repo', timestamp: 15_000 },
    ];
    expect(findUnambiguousSessionCandidate(stoppedTask, sessionDuringRun, [])?.id).toBe('s-during');

    // Session flushed 30s after exit
    const sessionShortlyAfter = [
      { id: 's-after', harness: 'codex' as const, title: 'After', cwd: '/projects/repo', timestamp: 20_030 },
    ];
    expect(findUnambiguousSessionCandidate(stoppedTask, sessionShortlyAfter, [])?.id).toBe('s-after');
  });

  it('rejects candidate created days after task was stopped (unrelated conversation)', () => {
    const oldTask: Pick<TaskSessionRecord, 'id' | 'workspacePath' | 'harnessId' | 'createdAt' | 'stoppedAt' | 'updatedAt'> = {
      id: 'task-old',
      workspacePath: '/projects/repo',
      harnessId: 'codex',
      createdAt: 100_000,
      stoppedAt: 120_000, // Monday
      updatedAt: 120_000,
    };

    // Wednesday conversation (days later)
    const muchLaterSession = [
      { id: 's-wednesday', harness: 'codex' as const, title: 'New chat', cwd: '/projects/repo', timestamp: 200_000_000 },
    ];

    const result = findUnambiguousSessionCandidate(oldTask, muchLaterSession, []);
    expect(result).toBeNull();
  });

  it('excludes session IDs claimed during the current evaluation pass', () => {
    const task1 = { id: 't1', workspacePath: '/projects/repo', harnessId: 'codex', createdAt: 1000 };
    const task2 = { id: 't2', workspacePath: '/projects/repo', harnessId: 'codex', createdAt: 1000 };

    const discovered = [
      { id: 'sess-single', harness: 'codex' as const, title: 'Chat', cwd: '/projects/repo', timestamp: 1100 },
    ];

    // Task 1 evaluates first and claims sess-single
    const claimedInPass = new Set<string>();
    const res1 = findUnambiguousSessionCandidate(task1, discovered, [], { claimedSessionIds: claimedInPass });
    expect(res1?.id).toBe('sess-single');
    claimedInPass.add(res1!.id);

    // Task 2 evaluates in the same pass with claimedInPass updated
    const res2 = findUnambiguousSessionCandidate(task2, discovered, [], { claimedSessionIds: claimedInPass });
    // Must NOT claim sess-single
    expect(res2).toBeNull();
  });
  it('filters out sessions from different workspaces or harnesses', () => {
    const discovered: HarnessSession[] = [
      {
        id: 'sess-other-ws',
        harness: 'codex',
        title: 'Other WS',
        cwd: '/projects/other-repo',
        timestamp: 10500,
      },
      {
        id: 'sess-other-harness',
        harness: 'claude',
        title: 'Claude session',
        cwd: '/projects/repo',
        timestamp: 10500,
      },
    ];

    const result = findUnambiguousSessionCandidate(task, discovered, []);
    expect(result).toBeNull();
  });
});
