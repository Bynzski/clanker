import { KNOWN_HARNESS_IDS, type HarnessId } from './harnessIds';

/** Serializable metadata only. Implementations and system resources live in main. */
export interface HarnessDescriptor {
  readonly id: HarnessId;
  readonly name: string;
  readonly iconKey: HarnessId;
  readonly legacyIcon: string;
  readonly aiCommit?: { readonly support: 'native' | 'emulated' };
  /** Present only for harnesses with a verified provider usage capability (see defineHarness). */
  readonly usage?: { readonly support: 'native' | 'emulated' };
  /** Optional manually-managed accounts (see HarnessAccountsCapability). Only advertised with an implementation. */
  readonly accounts?: { readonly support: 'native' | 'emulated' };
}
export const HARNESS_DESCRIPTORS = {
  codex: { id: 'codex', name: 'Codex', iconKey: 'codex', legacyIcon: '🧠', aiCommit: { support: 'native' }, usage: { support: 'native' }, accounts: { support: 'native' } },
  opencode: { id: 'opencode', name: 'OpenCode', iconKey: 'opencode', legacyIcon: '⚡', aiCommit: { support: 'native' } },
  pi: { id: 'pi', name: 'Pi', iconKey: 'pi', legacyIcon: 'π', aiCommit: { support: 'native' } },
  omp: { id: 'omp', name: 'Oh My Pi', iconKey: 'omp', legacyIcon: 'π', aiCommit: { support: 'native' }, usage: { support: 'native' } },
  claude: { id: 'claude', name: 'Claude', iconKey: 'claude', legacyIcon: '✨', usage: { support: 'native' }, accounts: { support: 'native' } },
  hermes: { id: 'hermes', name: 'Hermes', iconKey: 'hermes', legacyIcon: '☿', usage: { support: 'native' } },
  agy: { id: 'agy', name: 'Antigravity', iconKey: 'agy', legacyIcon: '🪐', aiCommit: { support: 'native' }, usage: { support: 'native' } },
} as const satisfies Record<HarnessId, HarnessDescriptor>;

export type AiCommitHarnessId = {
  [Id in HarnessId]: typeof HARNESS_DESCRIPTORS[Id] extends { aiCommit: unknown } ? Id : never
}[HarnessId];

/** Preserve the existing picker order while deriving its IDs from descriptors. */
export const AI_COMMIT_HARNESS_IDS: readonly AiCommitHarnessId[] = KNOWN_HARNESS_IDS.filter(
  (id): id is AiCommitHarnessId => 'aiCommit' in HARNESS_DESCRIPTORS[id],
);

export type UsageHarnessId = {
  [Id in HarnessId]: typeof HARNESS_DESCRIPTORS[Id] extends { usage: unknown } ? Id : never
}[HarnessId];

/** Harnesses with a verified usage capability, in canonical order. The renderer panel derives from this. */
export const USAGE_HARNESS_IDS: readonly UsageHarnessId[] = KNOWN_HARNESS_IDS.filter(
  (id): id is UsageHarnessId => 'usage' in HARNESS_DESCRIPTORS[id],
);

export type AccountHarnessId = {
  [Id in HarnessId]: typeof HARNESS_DESCRIPTORS[Id] extends { accounts: unknown } ? Id : never
}[HarnessId];

/** Harnesses whose providers implement optional account management, in canonical order. */
export const ACCOUNT_HARNESS_IDS: readonly AccountHarnessId[] = KNOWN_HARNESS_IDS.filter(
  (id): id is AccountHarnessId => 'accounts' in HARNESS_DESCRIPTORS[id],
);
