import type { HarnessSession } from '../shared/types/session';
import type { TaskSessionRecord, TaskRecoveryState } from '../shared/types/taskSessions';
import { normalizeWorkspacePath, isSameWorkspaceIdentity } from '../shared/workspaceIdentity';
import type { WorkspacePersistenceService } from './workspacePersistence';
import { discoverSessions } from './sessionHistory';
import { toNativePath } from '../shared/pathNormalize';

export class TaskSessionCoordinator {
  private shuttingDown = false;
  constructor(
    private readonly persistence: WorkspacePersistenceService,
    private readonly discoverSessionsFn: (workspacePath?: string) => Promise<HarnessSession[]> = discoverSessions,
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
        let sessions: HarnessSession[] = [];
        for (let attempt = 0; attempt < 5; attempt++) {
          sessions = await this.discoverSessionsFn(nativeDir);
          const matching = sessions.filter((s) =>
            s.harness === task.harnessId && s.timestamp >= task.createdAt - 60_000,
          );
          if (matching.length > 0 || this.shuttingDown) break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (this.shuttingDown) return null;
        // Look for sessions of the same harness created after the task started (with 60s tolerance)
        const candidates = sessions
          .filter((s) => s.harness === task.harnessId && s.timestamp >= task.createdAt - 60_000)
          .sort((a, b) => b.timestamp - a.timestamp);

        if (candidates.length === 1) {
          nativeSessionId = candidates[0].id;
          nativeSessionPath = candidates[0].filePath;
          if (candidates[0].title) {
            updatedTitle = candidates[0].title;
          }
        } else if (candidates.length > 1 && candidates[0].timestamp >= task.createdAt) {
          // If the most recent is clearly within the run time, correlate it
          nativeSessionId = candidates[0].id;
          nativeSessionPath = candidates[0].filePath;
          if (candidates[0].title) {
            updatedTitle = candidates[0].title;
          }
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
