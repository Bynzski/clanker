import { posix } from 'node:path';
import type { HarnessSession } from '../../shared/types/session';
import type { RemoteSessionBaseline, TaskSessionRecord } from '../../shared/types/taskSessions';
import type { WorkspaceEnvironment } from '../environment/workspaceEnvironment';
import { SUPPORTED_RESUME_HARNESSES } from '../sessionLaunch';
import { isPathContained } from './remotePaths';
import { CORRELATION_END_TOLERANCE_MS } from '../sessionCorrelation';

export function sanitizeRemoteSessionBaseline(value: unknown, root: string): RemoteSessionBaseline | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const baseline = value as Record<string, unknown>;
  if (typeof baseline.cwd !== 'string' || posix.normalize(baseline.cwd) !== baseline.cwd || baseline.cwd.includes('\0') || !isPathContained(root, baseline.cwd)
    || typeof baseline.hostTime !== 'number' || !Number.isFinite(baseline.hostTime) || baseline.hostTime <= 0
    || typeof baseline.localTime !== 'number' || !Number.isFinite(baseline.localTime) || baseline.localTime <= 0
    || !Array.isArray(baseline.sessionIds) || baseline.sessionIds.length > 512
    || baseline.sessionIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(id))) return undefined;
  return { cwd: baseline.cwd, hostTime: baseline.hostTime, localTime: baseline.localTime, sessionIds: [...new Set(baseline.sessionIds as string[])] };
}

export async function captureRemoteSessionBaseline(environment: WorkspaceEnvironment, root: string, cwd: string, harness?: string): Promise<RemoteSessionBaseline | undefined> {
  if (!harness || !SUPPORTED_RESUME_HARNESSES.has(harness) || !environment.capabilities?.sessionDiscovery || !environment.captureSessionBaseline) return undefined;
  try {
    const { sessions, hostTime } = await environment.captureSessionBaseline(root, harness);
    return sanitizeRemoteSessionBaseline({ cwd, hostTime, localTime: Date.now(), sessionIds: sessions.filter((session) => session.harness === harness).map((session) => session.id) }, root);
  } catch {
    // Discovery is optional for launch. Without complete evidence, require manual association.
    return undefined;
  }
}

function matches(task: TaskSessionRecord, session: HarnessSession, now: number): boolean {
  const baseline = task.remoteSessionBaseline;
  if (!baseline || task.nativeSessionId || task.harnessId !== session.harness
    || baseline.cwd !== session.cwd || baseline.sessionIds.includes(session.id)
    || !Number.isFinite(session.timestamp) || session.timestamp <= 0) return false;
  const end = task.stoppedAt ?? (task.state === 'running' ? now : undefined);
  if (end === undefined || end < baseline.localTime) return false;
  // Convert the desktop-observed exit to host time; allow bounded session flush delay.
  const hostEnd = baseline.hostTime + (end - baseline.localTime) + CORRELATION_END_TOLERANCE_MS;
  return session.timestamp >= baseline.hostTime - 1000 && session.timestamp <= hostEnd;
}

/** Both the conversation and its owning task must be unique. */
export function findRemoteSessionCandidate(task: TaskSessionRecord, sessions: HarnessSession[], allTasks: TaskSessionRecord[], now = Date.now()): HarnessSession | undefined {
  if (!task.remoteSessionBaseline || task.stoppedAt === undefined) return undefined;
  const environmentId = task.environmentId ?? 'local';
  if (environmentId === 'local') return undefined;
  const peers = allTasks.filter((peer) => (peer.environmentId ?? 'local') === environmentId && peer.harnessId === task.harnessId);
  const candidates = sessions.filter((session) => matches(task, session, now)
    && !peers.some((peer) => peer.id !== task.id && peer.nativeSessionId === session.id));
  const unique = [...new Map(candidates.map((session) => [session.id, session])).values()];
  if (unique.length !== 1) return undefined;
  const candidate = unique[0];
  const candidateLocalTime = task.remoteSessionBaseline.localTime + candidate.timestamp - task.remoteSessionBaseline.hostTime;
  if (peers.some((peer) => {
    if (peer.id === task.id || peer.nativeSessionId) return false;
    if (peer.remoteSessionBaseline) return matches(peer, candidate, now);
    // A failed/legacy baseline cannot establish which overlapping task owns this session.
    const end = peer.stoppedAt ?? (peer.state === 'running' ? now : peer.updatedAt);
    return isPathContained(peer.workspacePath, candidate.cwd)
      && candidateLocalTime >= peer.createdAt - 1000 && candidateLocalTime <= end + CORRELATION_END_TOLERANCE_MS;
  })) return undefined;
  return candidate;
}
