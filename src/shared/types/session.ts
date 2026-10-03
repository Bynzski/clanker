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
  /**
   * Opaque Clanker account that owns this session's native storage. Absent for the native/default
   * account. Provenance only: main re-verifies it before any launch and never trusts it as authority.
   */
  accountId?: string;
}
