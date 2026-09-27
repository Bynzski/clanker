import type { HarnessId } from '../harnessIds';

export interface HarnessSession {
  id: string;
  harness: HarnessId;
  title: string;
  cwd: string;
  timestamp: number;
  modelId?: string;
  provider?: string;
  /** File path used by Pi and OMP for precise session resume/fork. */
  filePath?: string;
}
