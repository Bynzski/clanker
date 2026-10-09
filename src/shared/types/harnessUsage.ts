/** Renderer-facing usage contract. Normalized, display-safe data only. */
export type HarnessUsageStatus =
  | 'ok'
  | 'unsupported'
  | 'not-installed'
  | 'unauthenticated'
  | 'unavailable'
  | 'error';

export interface HarnessUsageMeasurementView {
  kind: 'allowance' | 'rate-limit' | 'tokens' | 'spend' | 'other';
  unit: string;
  used?: number;
  remaining?: number;
  limit?: number;
  /** Epoch milliseconds. */
  resetsAt?: number;
  period?: { startsAt?: number; endsAt?: number; label?: string };
  /** Opaque account keys stay in main; only display-safe labels cross IPC. */
  scope?: { accountLabel?: string; planLabel?: string; providerId?: string; modelId?: string };
  label?: string;
  description?: string;
}

export interface HarnessUsageEntry {
  harnessId: string;
  /**
   * Present only when a harness has managed accounts. `id` is Clanker's opaque account ID (never a
   * provider-native identifier); `name` is display-safe. Entries are ordered selected account first.
   */
  account?: { id: string; name: string; selected: boolean };
  status: HarnessUsageStatus;
  /** Last good measurements; retained (with `stale`) when a later probe fails. */
  measurements: HarnessUsageMeasurementView[];
  /** When the measurements were observed; renderer may animate countdowns from it. */
  observedAt?: number;
  /** When the probe last ran (success or failure). */
  checkedAt?: number;
  /** Until when an ordinary request is served from cache. */
  nextRefreshAt?: number;
  /** Earliest time a manual refresh (`force`) will actually query the provider. */
  refreshableAt?: number;
  stale?: boolean;
  /** Fixed, safe text by failure category; never raw command output. */
  error?: string;
}

export interface HarnessUsageRequest {
  /** Defaults to every harness; unknown IDs are ignored. */
  harnessIds?: string[];
  /** Bypass the cache (still rate-floored in main). */
  force?: boolean;
}

export interface HarnessUsageResponse {
  workspaceId?: string;
  /** Main-owned execution environment and incarnation. Local is stable at generation 0. */
  environmentId: string;
  environmentGeneration: number;
  entries: HarnessUsageEntry[];
}
