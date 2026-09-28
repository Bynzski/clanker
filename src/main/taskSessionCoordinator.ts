import type { HarnessSession } from '../shared/types/session';
import type { TaskSessionRecord, TaskRecoveryState } from '../shared/types/taskSessions';
import { normalizeWorkspacePath, isSameWorkspaceIdentity } from '../shared/workspaceIdentity';
import type { WorkspacePersistenceService } from './workspacePersistence';
import { discoverSessions } from './sessionHistory';
import { toNativePath } from '../shared/pathNormalize';
import { findUnambiguousSessionCandidate } from './sessionCorrelation';

export type DiscoverSessionsFunction = (
  workspacePath?: string,
  options?: { forceRefresh?: boolean },
) => Promise<HarnessSession[]>;

export class TaskSessionCoordinator {
  private shuttingDown = false;
  constructor(
    private readonly persistence: WorkspacePersistenceService,
    private readonly discoverSessionsFn: DiscoverSessionsFunction = discoverSessions,
  ) {}

  public onTerminalSpawned(
    terminalId: string,
    workspacePath: string,
    harnessId: string,
    modelId?: string,
  ): TaskSessionRecord {
    const normalized = normalizeWorkspacePath(workspacePath);
    const now = Date.now();
    const taskId = `task-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const title = `${harnessId.toUpperCase()} Task (${new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;

    const record: TaskSessionRecord = {
      id: taskId,
      workspacePath: normalized,
      harnessId,
      ...(modelId ? { modelId } : {}),
      title,
      terminalId,
      state: 'running',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    return this.persistence.saveTaskSession(record);
  }

  public onSessionInvoked(terminalId: string, session: HarnessSession): TaskSessionRecord {
    const normalized = normalizeWorkspacePath(session.cwd);
    const now = Date.now();
    const all = this.persistence.getAllTaskSessions();

    const existing = all.find(
      (t) => t.nativeSessionId === session.id && isSameWorkspaceIdentity(t.workspacePath, normalized),
    );

    if (existing) {
      const updated: TaskSessionRecord = {
        ...existing,
        terminalId,
        nativeSessionId: session.id,
        ...(session.filePath ? { nativeSessionPath: session.filePath } : {}),
        state: 'running',
        stateReason: undefined,
        updatedAt: now,
      };
      return this.persistence.saveTaskSession(updated);
    }

    const taskId = `task-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const record: TaskSessionRecord = {
      id: taskId,
      workspacePath: normalized,
      harnessId: session.harness,
      ...(session.modelId ? { modelId: session.modelId } : {}),
      title: session.title || `${session.harness.toUpperCase()} Task`,
      terminalId,
      nativeSessionId: session.id,
      ...(session.filePath ? { nativeSessionPath: session.filePath } : {}),
      state: 'running',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    return this.persistence.saveTaskSession(record);
  }

  public async onTerminalExited(terminalId: string): Promise<TaskSessionRecord | null> {
    if (this.shuttingDown) return null;
    const all = this.persistence.getAllTaskSessions();
    const task = all.find((t) => t.terminalId === terminalId);
    if (!task) return null;

    let nativeSessionId = task.nativeSessionId;
    let nativeSessionPath = task.nativeSessionPath;
    let updatedTitle = task.title;

    if (!nativeSessionId) {
      try {
        const nativeDir = toNativePath(task.workspacePath, process.platform);
        // Harnesses often flush their session file just after the PTY exits.
        // Retry briefly before asking the user to associate a session manually.
        for (let attempt = 0; attempt < 5; attempt++) {
          const sessions = await this.discoverSessionsFn(nativeDir, { forceRefresh: true });
          const candidate = findUnambiguousSessionCandidate(task, sessions, all, { observedExitTime: Date.now() });
          if (candidate) {
            nativeSessionId = candidate.id;
            nativeSessionPath = candidate.filePath;
            if (candidate.title) {
              updatedTitle = candidate.title;
            }
            break;
          }
          if (this.shuttingDown) return null;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      } catch {
        // Leave unassociated for manual selection
      }
    }

    const state: TaskRecoveryState = nativeSessionId ? 'resumable' : 'needs-selection';
    const updated: TaskSessionRecord = {
      ...task,
      terminalId: undefined,
      nativeSessionId,
      nativeSessionPath,
      title: updatedTitle,
      state,
      stateReason: undefined,
      stoppedAt: Date.now(),
      updatedAt: Date.now(),
    };

    return this.persistence.saveTaskSession(updated);
  }

  public onAppShutdown(): void {
    this.shuttingDown = true;
    const all = this.persistence.getAllTaskSessions();
    const now = Date.now();
    for (const task of all) {
      if (task.state === 'running') {
        const state: TaskRecoveryState = task.nativeSessionId ? 'resumable' : 'needs-selection';
        this.persistence.saveTaskSession({
          ...task,
          terminalId: undefined,
          state,
          stoppedAt: now,
          updatedAt: now,
        });
      }
    }
  }
}
