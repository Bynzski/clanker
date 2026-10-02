import type { HarnessId } from '../../shared/harnessIds';
import type { WorkspaceEnvironmentId } from '../../shared/types/environments';
import type { HarnessAccountId, HarnessAccountStatus } from '../../shared/types/harnessAccounts';

/**
 * Persistent account metadata. Never holds provider tokens, OAuth URLs, raw auth responses or
 * filesystem paths: the account home is always derived in main from `id` and `harness`.
 */
export interface StoredHarnessAccount {
  id: HarnessAccountId;
  harness: HarnessId;
  environmentId: WorkspaceEnvironmentId;
  kind: 'managed';
  label?: string;
  createdAt: number;
  /** Display-only provider metadata captured at verification time. */
  email?: string;
  plan?: string;
  status?: HarnessAccountStatus;
}

export interface HarnessAccountRegistryState {
  accounts: StoredHarnessAccount[];
  /** `environment + harness -> managed account ID`; absence means the native/default account. */
  selections: Record<string, HarnessAccountId>;
}

/** Narrow persistence port so the service is testable without Electron. */
export interface HarnessAccountStorage {
  load(): unknown;
  save(state: HarnessAccountRegistryState): void;
}

export class MemoryAccountStorage implements HarnessAccountStorage {
  public state: unknown;
  constructor(initial?: unknown) { this.state = initial; }
  load(): unknown { return this.state; }
  save(state: HarnessAccountRegistryState): void { this.state = JSON.parse(JSON.stringify(state)); }
}
