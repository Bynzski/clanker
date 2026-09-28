export type TaskRecoveryState =
  | 'running'
  | 'resumable'
  | 'needs-selection'
  | 'unavailable';

export interface TaskSessionRecord {
  id: string;
  workspacePath: string;
  harnessId: string;
  modelId?: string;
  title: string;
  terminalId?: string;
  nativeSessionId?: string;
  nativeSessionPath?: string;
  state: TaskRecoveryState;
  stateReason?: string;
  createdAt: number;
  updatedAt: number;
  stoppedAt?: number;
  version: 1;
}
