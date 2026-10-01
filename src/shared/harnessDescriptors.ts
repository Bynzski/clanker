import { KNOWN_HARNESS_IDS, type HarnessId } from './harnessIds';

/** Serializable metadata only. Implementations and system resources live in main. */
export interface HarnessDescriptor {
  readonly id: HarnessId;
  readonly name: string;
  readonly iconKey: HarnessId;
  readonly legacyIcon: string;
  readonly aiCommit?: { readonly support: 'native' | 'emulated' };
}
export const HARNESS_DESCRIPTORS = {
  codex: { id: 'codex', name: 'Codex', iconKey: 'codex', legacyIcon: '🧠', aiCommit: { support: 'native' } },
  opencode: { id: 'opencode', name: 'OpenCode', iconKey: 'opencode', legacyIcon: '⚡', aiCommit: { support: 'native' } },
  pi: { id: 'pi', name: 'Pi', iconKey: 'pi', legacyIcon: 'π', aiCommit: { support: 'native' } },
  omp: { id: 'omp', name: 'Oh My Pi', iconKey: 'omp', legacyIcon: 'π', aiCommit: { support: 'native' } },
  claude: { id: 'claude', name: 'Claude', iconKey: 'claude', legacyIcon: '✨' },
  hermes: { id: 'hermes', name: 'Hermes', iconKey: 'hermes', legacyIcon: '☿' },
  agy: { id: 'agy', name: 'Antigravity', iconKey: 'agy', legacyIcon: '🪐', aiCommit: { support: 'native' } },
} as const satisfies Record<HarnessId, HarnessDescriptor>;

export type AiCommitHarnessId = {
  [Id in HarnessId]: typeof HARNESS_DESCRIPTORS[Id] extends { aiCommit: unknown } ? Id : never
}[HarnessId];

/** Preserve the existing picker order while deriving its IDs from descriptors. */
export const AI_COMMIT_HARNESS_IDS: readonly AiCommitHarnessId[] = KNOWN_HARNESS_IDS.filter(
  (id): id is AiCommitHarnessId => 'aiCommit' in HARNESS_DESCRIPTORS[id],
);
