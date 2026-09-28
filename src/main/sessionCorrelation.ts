import type { HarnessSession } from '../shared/types/session';
import type { TaskSessionRecord } from '../shared/types/taskSessions';
import { isSameWorkspaceIdentity } from '../shared/workspaceIdentity';

export const CORRELATION_START_TOLERANCE_MS = 60_000;
export const CORRELATION_END_TOLERANCE_MS = 120_000;

export interface SessionCorrelationOptions {
  observedExitTime?: number;
  claimedSessionIds?: Set<string>;
}

/**
 * Finds an unambiguous session candidate for a task session from discovered sessions.
 *
 * Rules:
 * 1. Must match harnessId.
 * 2. Must match workspace identity (using isSameWorkspaceIdentity).
 * 3. Session must fall within task lifetime:
 *    task.createdAt - START_TOLERANCE <= session.timestamp <= (stoppedAt ?? observedExitTime ?? updatedAt) + END_TOLERANCE
 * 4. Session ID must NOT already be associated with any other task record in the store,
 *    nor already claimed during the current evaluation pass.
 * 5. Exactly ONE candidate must match. If 0 or >1 candidates match, returns null (unambiguous only).
 *
 * This conservative approach avoids guessing or attaching the wrong conversation
 * when multiple simultaneous tasks use the same harness, or when an old unresolved task
 * encounters a newly created conversation days later.
 */
export type CorrelatableTask = Pick<
  TaskSessionRecord,
  'id' | 'workspacePath' | 'harnessId' | 'createdAt'
> & {
  stoppedAt?: number;
  updatedAt?: number;
};

export function findUnambiguousSessionCandidate(
  task: CorrelatableTask,
  discoveredSessions: HarnessSession[],
  allTasks: TaskSessionRecord[],
  options?: SessionCorrelationOptions,
): HarnessSession | null {
  // Collect all nativeSessionIds that are already associated with any other task,
  // including any IDs claimed during the current evaluation pass
  const alreadyAssociatedSessionIds = new Set<string>(options?.claimedSessionIds);
  for (const t of allTasks) {
    if (t.id !== task.id && t.nativeSessionId && t.nativeSessionId.trim()) {
      alreadyAssociatedSessionIds.add(t.nativeSessionId.trim());
    }
  }

  const lowerBound = task.createdAt - CORRELATION_START_TOLERANCE_MS;
  const upperReference = task.stoppedAt ?? options?.observedExitTime ?? task.updatedAt ?? task.createdAt;
  const upperBound = upperReference + CORRELATION_END_TOLERANCE_MS;

  // Filter candidates strictly
  const matchingCandidates = discoveredSessions.filter((s) => {
    if (s.harness !== task.harnessId) return false;
    if (!isSameWorkspaceIdentity(s.cwd, task.workspacePath)) return false;
    if (s.timestamp < lowerBound || s.timestamp > upperBound) return false;
    if (alreadyAssociatedSessionIds.has(s.id.trim())) return false;
    return true;
  });
  // Strictly unambiguous: exactly one candidate
  if (matchingCandidates.length === 1) {
    return matchingCandidates[0];
  }

  // If 0 candidates, or >1 ambiguous candidates, return null
  return null;
}
