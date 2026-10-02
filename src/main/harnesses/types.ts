import type { HarnessSession } from '../../shared/types/session';
import type { HarnessCommandExecutor, HarnessCommandSessionExecutor } from './commandExecution';

import type { HarnessDescriptor } from '../../shared/harnessDescriptors';
export type { HarnessDescriptor } from '../../shared/harnessDescriptors';

/** CLI identity only; PTYs, wrappers, shells and transports remain shared. */
export interface HarnessLaunchCapability {
  readonly command: string;
  readonly args: string[];
  readonly modelArg: string;
  readonly env?: Record<string, string>;
  readonly modelArgs?: (model: string, modelArg?: string) => string[] | undefined;
  readonly localEnvironment?: (flags?: string) => Record<string, string>;
}

export interface HarnessProvider {
  readonly descriptor: HarnessDescriptor;
  readonly launch: HarnessLaunchCapability;
  readonly models?: HarnessModelsCapability;
  readonly sessions?: HarnessSessionsCapability;
  readonly attention?: HarnessAttentionCapability;
  readonly aiCommit?: HarnessAiCommitCapability;
  readonly usage?: HarnessUsageCapability;
}

export type CapabilitySupport = 'native' | 'emulated';
export type HarnessFailureKind = 'unsupported' | 'binary-unavailable' | 'not-configured' | 'unauthenticated'
  | 'command-failed' | 'timeout' | 'output-limit' | 'input-limit' | 'aborted' | 'parse-failure' | 'storage-changed' | 'transport-failure';

/** Compatibility surfaces may hide failures; providers retain the cause. */
export class HarnessCapabilityError extends Error {
  /** `retryAfterMs` lets a provider demand a longer hard backoff than its policy. */
  constructor(readonly kind: HarnessFailureKind, message: string, readonly cause?: unknown, readonly retryAfterMs?: number) {
    super(message);
    this.name = 'HarnessCapabilityError';
  }
}

export interface ModelOption { id: string; label: string }
export interface HarnessModelsCapability {
  discover(refresh?: boolean): Promise<ModelOption[]>;
  readonly fallback?: ModelOption[];
  readonly explicitRefresh?: boolean;
  /** Preserve legacy caching at the wrapper, while providers report parse errors. */
  readonly compatibility?: { cacheParseFailureAsEmpty?: boolean };
}

export function classifyHarnessFailure(error: unknown, transport: 'local' | 'ssh' = 'local'): HarnessCapabilityError {
  if (error instanceof HarnessCapabilityError) return error;
  const details = error as { code?: string; killed?: boolean; exitCode?: number; stderr?: string } | null;
  const message = error instanceof Error ? error.message : String(error);
  const diagnostic = `${message} ${details?.stderr ?? ''}`;
  const kind: HarnessFailureKind = error instanceof SyntaxError ? 'parse-failure'
    : details?.killed || /timed out|timeout/i.test(message) ? 'timeout'
    : /no such (?:table|column)|database schema/i.test(diagnostic) ? 'storage-changed'
    : /cannot replace|requires the default|Refusing to overwrite/i.test(diagnostic) ? 'not-configured'
    : transport === 'ssh' && (details?.exitCode === undefined || details.exitCode === 255) ? 'transport-failure'
    : details?.code === 'ENOENT' ? 'binary-unavailable' : 'command-failed';
  return new HarnessCapabilityError(kind, message, error);
}

export interface HarnessSessionsCapability {
  /** Preserve stable timestamp-tie ordering in existing history results. */
  readonly discoveryOrder?: number;
  readonly validateLocal?: (session: HarnessSession, context: { workspacePath: string; userFlags?: string }) => HarnessSession | Promise<HarnessSession>;
  readonly validateRemote?: (session: HarnessSession) => boolean;
  discover(workspacePath: string): Promise<HarnessSession[]>;
  readonly resume?: HarnessSessionOperation;
  readonly fork?: HarnessSessionOperation;
  readonly remote?: HarnessRemoteSessions;
  readonly selectionFlags?: readonly string[];

}

export interface HarnessSessionOperation {
  readonly support: CapabilitySupport;
  /** Omission means both transports. Agy's emulated fork is local only. */
  readonly transports?: readonly ('local' | 'ssh')[];
  build(session: HarnessSession, userFlags?: string): { command: string; args: string[] };
}

export interface HarnessRemoteSessions {
  /** Host scan order also governs consumption of the shared metadata budget. */
  readonly discoveryOrder?: number;
  /** Body of scan(harness), using the transport's bounded read/emit helpers. */
  readonly scan: string;
  readonly command?: { command: string; args: string[] };
  readonly fileStore?: string;
}

export interface AttentionAdapterFiles {
  command: string;
  /** Private per-provider resource directory; command bridge remains shared. */
  resourceRoot?: string;
}
export interface AttentionLaunchOptions { args: string[]; env: Record<string, string> }
export interface PreparedLocalAttention extends AttentionLaunchOptions { dispose(): void }
export interface LocalAttentionContext {
  terminalId: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  files: AttentionAdapterFiles;
  sessionId?: string;
  platform: NodeJS.Platform;
  homeDir?: string;
}
export interface HarnessLocalAttention {
  plan(context: LocalAttentionContext): AttentionPlan;
  options(context: LocalAttentionContext): AttentionLaunchOptions | null;
  prepare(context: LocalAttentionContext): PreparedLocalAttention | null;
}
export interface HarnessAttentionCapability {
  readonly prepareResources?: (files: AttentionAdapterFiles, observer: string) => void;
  readonly disposeResources?: () => void;
  readonly local?: HarnessLocalAttention;
  readonly remote?: HarnessRemoteAttention;
}

export interface HarnessRemoteAttention {
  readonly resources?: (observer: string) => Record<string, string>;
  readonly environmentKeys?: readonly string[];
  readonly requiresNode: boolean;
  readonly validate: string;
  readonly configure: string;
  readonly plugin?: () => {
    parts: string[]; files: Record<string, string>; upgradeFile?: string; legacyFile?: string;
  };
  readonly enableCommand?: { command: string; args: string[] };
}

/** Provider CLI invocation only; Git context and text cleanup remain shared. */
export interface HarnessAiCommitInvocation {
  command: string;
  args: string[];
  stdin?: string;
  timeoutMs: number;
  env?: Record<string, string>;
}
export interface HarnessAiCommitCapability {
  parseOutput?(output: string): string;
  buildInvocation(context: { model?: string; prompt: string }): HarnessAiCommitInvocation;
  /** Descriptive model flag for the legacy catalog; execution uses buildInvocation. */
  readonly modelArg: string;
}

/**
 * Usage is a provider decision (WHAT to run, HOW to parse it) executed by the
 * workspace environment (WHERE/HOW). Providers receive only a bound executor:
 * never an SSH target, environment object, credential path or Electron handle.
 * Measurements need not share units, periods or a fixed window set.
 */
export interface HarnessUsageContext {
  /** Runs bounded commands in the registered workspace's own environment. */
  readonly executor: HarnessCommandExecutor;
  /** Bounded interactive stdio sessions for stateful line protocols; absent if the environment has none. */
  readonly sessionExecutor?: HarnessCommandSessionExecutor;
  /** Descriptive only; providers must not fork execution by transport. */
  readonly transport: 'local' | 'ssh';
  /** Aborted on shutdown or when the service gives up on the provider. */
  readonly signal: AbortSignal;
  readonly accountId?: string;
  readonly modelId?: string;
}
export interface HarnessUsageRefreshPolicy {
  /** Ordinary cache freshness for a successful probe; a manual refresh may bypass it. */
  readonly cacheTtlMs?: number;
  /**
   * Hard limit: the upstream source must not be queried more often than this,
   * even for a manual refresh. Measured from the previous probe attempt.
   */
  readonly minimumProbeIntervalMs?: number;
  /** Hard limit after a failed probe; manual refresh cannot shorten it. */
  readonly failureBackoffMs?: number;
}
export interface HarnessUsageCapability {
  get(context: HarnessUsageContext): Promise<HarnessUsageSnapshot>;
  /** Conservative provider-specific limits; the service applies defaults. */
  readonly refresh?: HarnessUsageRefreshPolicy;
}
export interface HarnessUsageMeasurement {
  kind: 'allowance' | 'rate-limit' | 'tokens' | 'spend' | 'other';
  /** Arbitrary unit, e.g. 'percent', 'tokens', 'usd', 'requests'. */
  unit: string;
  used?: number;
  remaining?: number;
  limit?: number;
  /** Epoch milliseconds. */
  resetsAt?: number;
  period?: { startsAt?: number; endsAt?: number; label?: string };
  /**
   * Source harness -> provider -> account -> measurement. `accountId` is an
   * opaque grouping key kept in main; only `accountLabel`/`planLabel` are
   * display-safe and cross IPC. Do not invent identity that is not reliable.
   */
  scope?: { accountId?: string; accountLabel?: string; planLabel?: string; providerId?: string; modelId?: string };
  /** Short display label supplied by the provider, e.g. '5 hour'. */
  label?: string;
  description?: string;
}
export interface HarnessUsageSnapshot {
  observedAt: number;
  measurements: HarnessUsageMeasurement[];
}

export type AttentionPlan = { status: 'ready'; options: AttentionLaunchOptions }
  | { status: 'blocked'; failure: HarnessCapabilityError };

/** Metadata cannot advertise AI commit without an implementation, or vice versa. */
export function defineHarness<Provider extends HarnessProvider>(provider: Provider & (
  Provider['descriptor'] extends { aiCommit: unknown }
    ? { aiCommit: HarnessAiCommitCapability } : { aiCommit?: never }
)): Provider { return provider; }
