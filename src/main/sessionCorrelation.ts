import type { HarnessSession } from '../shared/types/session';
import type { TaskSessionRecord } from '../shared/types/taskSessions';
import { isSameWorkspaceIdentity } from '../shared/workspaceIdentity';

/**
 * Finds an unambiguous session candidate for a task session from discovered sessions.
 *
 * Rules:
 * 1. Must match harnessId.
 * 2. Must match workspace identity (using isSameWorkspaceIdentity).
 * 3. Session must have started around or after task creation (timestamp >= createdAt - 60_000).
 * 4. Session ID must NOT already be associated with any other task record in the store.
 * 5. Exactly ONE candidate must match. If 0 or >1 candidates match, returns null (unambiguous only).
 *
 * This conservative approach avoids guessing or attaching the wrong conversation
 * when multiple simultaneous tasks use the same harness.
 */
export function findUnambiguousSessionCandidate(
  task: Pick<TaskSessionRecord, 'id' | 'workspacePath' | 'harnessId' | 'createdAt'>,
  discoveredSessions: HarnessSession[],
  allTasks: TaskSessionRecord[],
): HarnessSession | null {
  // Collect all nativeSessionIds that are already associated with any other task
  const alreadyAssociatedSessionIds = new Set<string>();
  for (const t of allTasks) {
    if (t.id !== task.id && t.nativeSessionId && t.nativeSessionId.trim()) {
      alreadyAssociatedSessionIds.add(t.nativeSessionId.trim());
    }
  }

  // Filter candidates strictly
  const matchingCandidates = discoveredSessions.filter((s) => {
    if (s.harness !== task.harnessId) return false;
    if (!isSameWorkspaceIdentity(s.cwd, task.workspacePath)) return false;
    if (s.timestamp < task.createdAt - 60_000) return false;
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
