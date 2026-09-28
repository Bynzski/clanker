import { ipcMain } from 'electron';
import * as fs from 'node:fs';
import type Store from 'electron-store';
import type { StoreSchema } from '../../shared/types/store';
import type {
  TaskSessionRecord,
  TaskRecoveryState,
} from '../../shared/types/taskSessions';
import {
  TASK_SESSION_LIST,
  TASK_SESSION_DELETE,
  TASK_SESSION_UPDATE,
} from '../../shared/ipcChannels';
import { WorkspacePersistenceService } from '../workspacePersistence';
import { toNativePath } from '../../shared/pathNormalize';
import type { Terminal } from './terminalIpc';
import { findUnambiguousSessionCandidate } from '../sessionCorrelation';
import { discoverSessions } from '../sessionHistory';
import type { HarnessSession } from '../../shared/types/session';
import { isSameWorkspaceIdentity } from '../../shared/workspaceIdentity';

const SUPPORTED_RESUME_HARNESSES: Record<string, true> = {
  codex: true,
  claude: true,
  opencode: true,
  pi: true,
  omp: true,
  agy: true,
};

export type SessionDiscoveryResult =
  | { status: 'success'; sessions: HarnessSession[] }
  | { status: 'error'; error: string };
export interface RegisterTaskSessionIpcDeps {
  getStore: () => Store<StoreSchema>;
  getTerminals: () => Map<string, Terminal>;
  getHarnessOptions: () => Record<string, unknown>;
  discoverSessionsFn?: (workspacePath?: string, options?: { forceRefresh?: boolean }) => Promise<HarnessSession[]>;
}

export function evaluateTaskRecoveryState(
  record: TaskSessionRecord,
  liveTerminalIds: Set<string>,
  availableHarnesses: Record<string, unknown>,
  discoveryResult?: SessionDiscoveryResult | HarnessSession[],
  allTasks?: TaskSessionRecord[],
  claimedSessionIds?: Set<string>,
): {
  state: TaskRecoveryState;
  stateReason?: string;
  terminalId?: string;
  nativeSessionId?: string;
  nativeSessionPath?: string;
  title?: string;
} {
  const normalizedDiscovery: SessionDiscoveryResult | undefined = Array.isArray(discoveryResult)
    ? { status: 'success', sessions: discoveryResult }
    : discoveryResult;
  // If the record claims to be running, check if its PTY is actually alive in this process
  if (record.state === 'running') {
    if (record.terminalId && liveTerminalIds.has(record.terminalId)) {
      return { state: 'running', terminalId: record.terminalId };
    }
  }

  // Not currently running in this process — check workspace path existence
  const nativeWorkspace = toNativePath(record.workspacePath, process.platform);
  let dirExists = false;
  try {
    const stat = fs.statSync(nativeWorkspace);
    dirExists = stat.isDirectory();
  } catch {
    dirExists = false;
  }

  if (!dirExists) {
    return {
      state: 'unavailable',
      stateReason: 'Workspace directory does not exist',
      terminalId: undefined,
    };
  }

  // Check harness availability
  if (!(record.harnessId in availableHarnesses)) {
    return {
      state: 'unavailable',
      stateReason: `Harness '${record.harnessId}' is not installed or available`,
      terminalId: undefined,
    };
  }

  // Check if harness supports resume
  if (!(record.harnessId in SUPPORTED_RESUME_HARNESSES)) {
    return {
      state: 'unavailable',
      stateReason: `Harness '${record.harnessId}' does not support conversation resume`,
      terminalId: undefined,
    };
  }

  // Option A: If the task explicitly failed a resume invocation, preserve that failure state and explanation
  if (record.state === 'unavailable' && /(?:resume failed|failed to resume)/i.test(record.stateReason ?? '')) {
    return {
      state: 'unavailable',
      stateReason: record.stateReason,
      terminalId: undefined,
      nativeSessionId: record.nativeSessionId,
      nativeSessionPath: record.nativeSessionPath,
    };
  }
  // Check native session ID
  if (record.nativeSessionId && record.nativeSessionId.trim()) {
    if (normalizedDiscovery) {
      if (normalizedDiscovery.status === 'success') {
        const exists = normalizedDiscovery.sessions.some(
          (s) => s.harness === record.harnessId && s.id === record.nativeSessionId,
        );
        if (!exists) {
          return {
            state: 'unavailable',
            stateReason: 'Native conversation session was not found on disk',
            terminalId: undefined,
            nativeSessionId: record.nativeSessionId,
            nativeSessionPath: record.nativeSessionPath,
          };
        }
      } else {
        // Failed discovery provides no evidence that the known session disappeared.
        return {
          state: record.state === 'unavailable' ? 'unavailable' : 'resumable',
          stateReason: record.state === 'unavailable' ? record.stateReason : undefined,
          terminalId: undefined,
          nativeSessionId: record.nativeSessionId,
          nativeSessionPath: record.nativeSessionPath,
        };
      }
    }

    return {
      state: 'resumable',
      terminalId: undefined,
      nativeSessionId: record.nativeSessionId,
      nativeSessionPath: record.nativeSessionPath,
    };
  }

  if (normalizedDiscovery?.status === 'error' && record.state === 'unavailable') {
    return { state: 'unavailable', stateReason: record.stateReason, terminalId: undefined };
  }

  // Has task metadata but native session ID is not known yet.
  // Attempt conservative correlation from successfully discovered sessions.
  if (normalizedDiscovery && normalizedDiscovery.status === 'success' && allTasks) {
    const candidate = findUnambiguousSessionCandidate(
      record,
      normalizedDiscovery.sessions,
      allTasks,
      { claimedSessionIds },
    );
    if (candidate) {
      return {
        state: 'resumable',
        terminalId: undefined,
        nativeSessionId: candidate.id,
        nativeSessionPath: candidate.filePath,
        title: candidate.title || record.title,
      };
    }
  }

  return {
    state: 'needs-selection',
    terminalId: undefined,
  };
}

export function registerTaskSessionIpc(deps: RegisterTaskSessionIpcDeps): WorkspacePersistenceService {
  const { getStore, getTerminals, getHarnessOptions, discoverSessionsFn = discoverSessions } = deps;
  const persistence = new WorkspacePersistenceService(getStore);
  ipcMain.handle(TASK_SESSION_LIST, async (_, workspacePath?: string) => {
    const rawSessions = workspacePath && typeof workspacePath === 'string' && workspacePath.trim()
      ? persistence.getTaskSessionsForWorkspace(workspacePath)
      : persistence.getAllTaskSessions();

    const liveTerminalIds = new Set<string>(getTerminals().keys());
    const availableHarnesses = getHarnessOptions();

    const discoveredByWorkspace = new Map<string, SessionDiscoveryResult>();
    for (const record of rawSessions) {
      const key = record.workspacePath;
      if (!discoveredByWorkspace.has(key)) {
        try {
          const nativeDir = toNativePath(record.workspacePath, process.platform);
          const sessions = await discoverSessionsFn(nativeDir, { forceRefresh: true });
          discoveredByWorkspace.set(key, { status: 'success', sessions });
        } catch (err) {
          discoveredByWorkspace.set(key, {
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Maintain an evolving set of claimed session IDs across the evaluation pass
    // to prevent two tasks from claiming the same candidate in one pass.
    const claimedSessionIds = new Set<string>();
    for (const record of rawSessions) {
      if (record.nativeSessionId && record.nativeSessionId.trim()) {
        claimedSessionIds.add(record.nativeSessionId.trim());
      }
    }

    const evaluated: TaskSessionRecord[] = [];
    for (const record of rawSessions) {
      const workspaceDiscoveryResult = discoveredByWorkspace.get(record.workspacePath);
      const evaluatedState = evaluateTaskRecoveryState(
        record,
        liveTerminalIds,
        availableHarnesses,
        workspaceDiscoveryResult,
        rawSessions,
        claimedSessionIds,
      );
      const { state, stateReason, terminalId, nativeSessionId, nativeSessionPath, title } = evaluatedState;

      // Track newly claimed session IDs in the running set
      if (nativeSessionId && nativeSessionId.trim()) {
        claimedSessionIds.add(nativeSessionId.trim());
      }
      // If state or attributes changed, update persistence
      if (
        record.state !== state
        || record.terminalId !== terminalId
        || record.stateReason !== stateReason
        || (nativeSessionId !== undefined && record.nativeSessionId !== nativeSessionId)
      ) {
        const updatedRecord: TaskSessionRecord = {
          ...record,
          state,
          terminalId,
          ...(nativeSessionId ? { nativeSessionId } : {}),
          ...(nativeSessionPath ? { nativeSessionPath } : {}),
          ...(title ? { title } : {}),
          ...(stateReason ? { stateReason } : { stateReason: undefined }),
          updatedAt: Date.now(),
        };
        persistence.saveTaskSession(updatedRecord);
        evaluated.push(updatedRecord);
      } else {
        evaluated.push(record);
      }
    }
    return evaluated;
  });

  ipcMain.handle(TASK_SESSION_DELETE, async (_, taskId: string) => {
    if (typeof taskId !== 'string' || !taskId.trim()) {
      return false;
    }
    return persistence.deleteTaskSession(taskId.trim());
  });

  ipcMain.handle(TASK_SESSION_UPDATE, async (_, updates: unknown) => {
    if (typeof updates !== 'object' || updates === null) {
      throw new Error('Invalid task session update payload');
    }
    const updateObj = updates as Record<string, unknown>;
    if (typeof updateObj.id !== 'string' || !updateObj.id.trim()) {
      throw new Error('Missing task ID in update');
    }

    const existing = persistence.getTaskSessionById(updateObj.id.trim());
    if (!existing) {
      throw new Error(`Task session not found: ${updateObj.id}`);
    }

    const requestedSessionId = typeof updateObj.nativeSessionId === 'string'
      ? updateObj.nativeSessionId.trim()
      : '';
    if (requestedSessionId && requestedSessionId !== existing.nativeSessionId) {
      const owner = persistence.getAllTaskSessions().find((task) =>
        task.id !== existing.id
        && task.harnessId === existing.harnessId
        && isSameWorkspaceIdentity(task.workspacePath, existing.workspacePath)
        && task.nativeSessionId === requestedSessionId,
      );
      if (owner) {
        throw new Error(`Session ${requestedSessionId} is already associated with task ${owner.id}`);
      }
    }

    const merged: TaskSessionRecord = {
      ...existing,
      ...(typeof updateObj.title === 'string' && updateObj.title.trim() ? { title: updateObj.title.trim() } : {}),
      ...(typeof updateObj.nativeSessionId === 'string' && updateObj.nativeSessionId.trim() ? { nativeSessionId: updateObj.nativeSessionId.trim() } : {}),
      ...(typeof updateObj.nativeSessionPath === 'string' && updateObj.nativeSessionPath.trim() ? { nativeSessionPath: updateObj.nativeSessionPath.trim() } : {}),
      ...(requestedSessionId && requestedSessionId !== existing.nativeSessionId && !updateObj.nativeSessionPath
        ? { nativeSessionPath: undefined } : {}),
      ...(typeof updateObj.state === 'string' && updateObj.state.trim() ? { state: updateObj.state.trim() as TaskRecoveryState } : {}),
      ...(typeof updateObj.stateReason === 'string' ? { stateReason: updateObj.stateReason.trim() } : {}),
      ...(updateObj.state === 'resumable' && requestedSessionId ? { stateReason: undefined } : {}),
      updatedAt: Date.now(),
    };

    return persistence.saveTaskSession(merged);
  });

  return persistence;
}
