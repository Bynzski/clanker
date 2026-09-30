import type { TaskSessionRecord } from '../../shared/types/taskSessions';
import type { HarnessSession } from '../../shared/types/session';
import type { RegisteredWorkspace, WorkspaceRegistry } from '../workspaceRegistry';
import { isPathContained } from '../remote/remotePaths';

import { findRemoteSessionCandidate } from '../remote/remoteSessionCorrelation';
import { SUPPORTED_RESUME_HARNESSES } from '../sessionLaunch';
interface RemoteRecoverySnapshot {
  workspace: RegisteredWorkspace;
  harnesses: Record<string, unknown>;
  sessions: HarnessSession[];
}

/** One host verification per registered workspace in a task-list request. */
export class RemoteTaskRecovery {
  private readonly completed = new Map<RegisteredWorkspace, RemoteRecoverySnapshot>();
  private readonly snapshots = new Map<RegisteredWorkspace, Promise<RemoteRecoverySnapshot>>();

  constructor(private readonly registry?: WorkspaceRegistry) {}

  canAssociate(record: TaskSessionRecord, sessionId: string, allTasks: TaskSessionRecord[]): boolean {
    const workspace = this.registry?.getWorkspaceByLocation(record.environmentId ?? 'local', record.workspacePath);
    const snapshot = workspace && this.completed.get(workspace);
    return !!snapshot && this.registry?.getWorkspace(snapshot.workspace.workspaceId) === snapshot.workspace
      && findRemoteSessionCandidate(record, snapshot.sessions, allTasks)?.id === sessionId;
  }

  async evaluate(record: TaskSessionRecord, allTasks: TaskSessionRecord[] = []): Promise<TaskSessionRecord> {
    const unavailable = (reason: string): TaskSessionRecord => ({
      ...record, terminalId: undefined, state: 'unavailable', stateReason: reason,
    });
    const workspace = this.registry?.getWorkspaceByLocation(record.environmentId ?? 'local', record.workspacePath);
    if (!workspace) return unavailable('Open the SSH workspace to verify its saved conversation');
    if (!SUPPORTED_RESUME_HARNESSES.has(record.harnessId)) return unavailable(`Harness '${record.harnessId}' does not support conversation resume`);
    if (record.state === 'unavailable' && /(?:resume failed|failed to resume)/i.test(record.stateReason ?? '')) {
      return unavailable(record.stateReason!);
    }
    if (!workspace.environment.capabilities.sessionDiscovery || !workspace.environment.discoverSessions) {
      return unavailable('Remote session discovery is not available');
    }
    const needsSelection = (): TaskSessionRecord => ({ ...record, terminalId: undefined, state: 'needs-selection', stateReason: undefined });
    if (!record.nativeSessionId && !record.remoteSessionBaseline) return needsSelection();
    try {
      let pending = this.snapshots.get(workspace);
      if (!pending) {
        pending = (async () => {
          const validation = await workspace.environment.validateWorkspacePath(workspace.location.path);
          if (!validation.valid || validation.resolvedPath !== workspace.location.path) throw new Error('Remote workspace directory is no longer valid');
          const harnesses = await workspace.environment.getHarnessOptions();
          const sessions = await workspace.environment.discoverSessions!(workspace.location.path);
          return { workspace, harnesses, sessions };
        })();
        this.snapshots.set(workspace, pending);
      }
      const snapshot = await pending;
      this.completed.set(workspace, snapshot);
      if (this.registry?.getWorkspace(workspace.workspaceId) !== snapshot.workspace) return unavailable('The SSH workspace closed while verifying its conversation');
      if (!(record.harnessId in snapshot.harnesses)) return unavailable(`Harness '${record.harnessId}' is not installed or available on the remote host`);
      if (!record.nativeSessionId) {
        const candidate = findRemoteSessionCandidate(record, snapshot.sessions, allTasks);
        if (!candidate) return needsSelection();
        return { ...record, terminalId: undefined, state: 'resumable', stateReason: undefined, nativeSessionId: candidate.id, nativeSessionPath: candidate.filePath, title: candidate.title || record.title };
      }
      const session = snapshot.sessions.find((session) => session.harness === record.harnessId && session.id === record.nativeSessionId && isPathContained(workspace.location.path, session.cwd));
      if (!session) return unavailable('Native conversation session was not found on the remote host');
      return { ...record, terminalId: undefined, state: 'resumable', stateReason: undefined, nativeSessionPath: session.filePath, title: session.title || record.title };
    } catch (error) {
      return unavailable(`Could not verify remote conversation: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
