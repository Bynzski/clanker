import type { WorkspaceEnvironmentId } from './environments';

export type TaskRecoveryState =
  | 'running'
  | 'resumable'
  | 'needs-selection'
  | 'unavailable';

/** Main-captured launch evidence; absent on legacy records or failed scans. */
export interface RemoteSessionBaseline {
  cwd: string;
  sessionIds: string[];
  hostTime: number;
  localTime: number;
}

export interface TaskSessionRecord {
  id: string;
  workspacePath: string;
  environmentId?: WorkspaceEnvironmentId;
  harnessId: string;
  modelId?: string;
  title: string;
  terminalId?: string;
  nativeSessionId?: string;
  nativeSessionPath?: string;
  remoteSessionBaseline?: RemoteSessionBaseline;
  state: TaskRecoveryState;
  stateReason?: string;
  createdAt: number;
  updatedAt: number;
  stoppedAt?: number;
  version: 1;
}
