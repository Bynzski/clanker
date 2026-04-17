import type { HarnessId } from '../harnessIds';

export interface HarnessSession {
  id: string;
  harness: HarnessId;
  title: string;
  cwd: string;
  timestamp: number;
  modelId?: string;
  provider?: string;
  /** Required for Pi — pi --session takes a file path, not an ID */
  filePath?: string;
}
