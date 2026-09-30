import { describe, expect, it, vi } from 'vitest';
import { captureRemoteSessionBaseline, findRemoteSessionCandidate, sanitizeRemoteSessionBaseline } from '../../../src/main/remote/remoteSessionCorrelation';
import type { WorkspaceEnvironment } from '../../../src/main/environment/workspaceEnvironment';
import type { TaskSessionRecord } from '../../../src/shared/types/taskSessions';
import type { HarnessSession } from '../../../src/shared/types/session';
import { sanitizeTaskSessionRecord } from '../../../src/main/workspacePersistence';

const task: TaskSessionRecord = {
  id: 'task-a', workspacePath: '/repo', environmentId: 'vps-a', harnessId: 'codex', title: 'Task',
  state: 'needs-selection', createdAt: 1_000_000, updatedAt: 1_010_000, stoppedAt: 1_010_000, version: 1,
  remoteSessionBaseline: { cwd: '/repo/sub', sessionIds: ['old'], hostTime: 8_000_000, localTime: 1_000_000 },
};
const session: HarnessSession = { id: 'new', harness: 'codex', cwd: '/repo/sub', title: 'New', timestamp: 8_005_000 };

describe('remote session correlation', () => {
  it.each(['codex', 'claude', 'opencode', 'pi', 'omp', 'agy'] as const)('associates a new %s session despite host clock skew', (harness) => {
    const record = { ...task, harnessId: harness };
    const candidate = { ...session, harness };
    expect(findRemoteSessionCandidate(record, [candidate], [record])).toEqual(candidate);
  });

  it.each([
    ['existing-id', { ...session, id: 'old' }],
    ['sibling-cwd', { ...session, cwd: '/repo/other' }],
    ['parent-cwd', { ...session, cwd: '/repo' }],
    ['wrong-harness', { ...session, harness: 'claude' as const }],
    ['before-launch', { ...session, timestamp: 7_990_000 }],
    ['days-later', { ...session, timestamp: 80_000_000 }],
    ['invalid-time', { ...session, timestamp: Number.NaN }],
  ])('rejects %s evidence', (_, candidate) => {
    expect(findRemoteSessionCandidate(task, [candidate], [task])).toBeUndefined();
  });

  it('requires a complete baseline and a recorded exit, independent of later updates', () => {
    expect(findRemoteSessionCandidate({ ...task, remoteSessionBaseline: undefined }, [session], [])).toBeUndefined();
    expect(findRemoteSessionCandidate({ ...task, stoppedAt: undefined }, [session], [])).toBeUndefined();
    expect(findRemoteSessionCandidate({ ...task, updatedAt: 90_000_000 }, [{ ...session, timestamp: 80_000_000 }], [])).toBeUndefined();
  });

  it('leaves multiple new conversations for manual selection and deduplicates one ID', () => {
    expect(findRemoteSessionCandidate(task, [session, { ...session, id: 'another' }], [task])).toBeUndefined();
    expect(findRemoteSessionCandidate(task, [session, session], [task])).toEqual(session);
  });

  it.each(['stopped', 'running', 'no-baseline'] as const)('does not choose a winner for overlapping %s tasks', (kind) => {
    const peer = { ...task, id: 'peer', ...(kind === 'running' ? { stoppedAt: undefined, state: 'running' as const } : {}), ...(kind === 'no-baseline' ? { remoteSessionBaseline: undefined } : {}) };
    expect(findRemoteSessionCandidate(task, [session], [task, peer], 1_010_000)).toBeUndefined();
  });

  it('excludes already claimed IDs while keeping same-path environments and harnesses independent', () => {
    const owner = { ...task, id: 'owner', nativeSessionId: session.id };
    expect(findRemoteSessionCandidate(task, [session], [task, owner])).toBeUndefined();
    expect(findRemoteSessionCandidate(task, [session], [task, { ...owner, environmentId: 'vps-b' }])).toEqual(session);
    expect(findRemoteSessionCandidate(task, [session], [task, { ...owner, environmentId: 'local' }])).toEqual(session);
    expect(findRemoteSessionCandidate(task, [session], [task, { ...owner, harnessId: 'claude' }])).toEqual(session);
  });

  it('does not let a task that excluded this pre-existing ID compete for ownership', () => {
    const peer = { ...task, id: 'peer', remoteSessionBaseline: { ...task.remoteSessionBaseline!, sessionIds: [session.id] } };
    expect(findRemoteSessionCandidate(task, [session], [task, peer])).toEqual(session);
  });

  it('persists bounded launch evidence only on SSH tasks and drops malformed evidence', () => {
    expect(sanitizeTaskSessionRecord(task)?.remoteSessionBaseline).toEqual(task.remoteSessionBaseline);
    expect(sanitizeTaskSessionRecord({ ...task, environmentId: 'local' })?.remoteSessionBaseline).toBeUndefined();
    for (const patch of [{ cwd: '/outside' }, { cwd: '/repo/../repo' }, { hostTime: Infinity }, { localTime: 0 }, { sessionIds: Array(513).fill('id') }, { sessionIds: ['unsafe/../id'] }]) {
      expect(sanitizeRemoteSessionBaseline({ ...task.remoteSessionBaseline, ...patch }, '/repo')).toBeUndefined();
    }
  });

  it('captures before launch and fails safely without blocking when host discovery fails', async () => {
    const capture = vi.fn().mockResolvedValue({ sessions: [session, { ...session, harness: 'claude' }], hostTime: 8_000_000 });
    const environment = { capabilities: { sessionDiscovery: true }, captureSessionBaseline: capture } as unknown as WorkspaceEnvironment;
    expect(await captureRemoteSessionBaseline(environment, '/repo', '/repo/sub', 'codex')).toMatchObject({ cwd: '/repo/sub', hostTime: 8_000_000, sessionIds: ['new'] });
    expect(capture).toHaveBeenCalledWith('/repo', 'codex');
    capture.mockRejectedValueOnce(new Error('SSH timeout'));
    expect(await captureRemoteSessionBaseline(environment, '/repo', '/repo/sub', 'codex')).toBeUndefined();
    expect(await captureRemoteSessionBaseline(environment, '/repo', '/repo/sub', 'hermes')).toBeUndefined();
  });
});
