import type { HarnessSession } from '../../shared/types/session';
import type { PreparedHarnessAttachment } from '../launchAttachments';
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
  readonly accounts?: HarnessAccountsCapability;
  readonly agentBridge?: HarnessAgentBridgeCapability;
  readonly checkoutRehome?: HarnessCheckoutRehomeCapability;
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
  /**
   * Catalog for the environment that owns `executor` (local or SSH). The provider chooses the
   * command and parser; the environment decides where it runs. Absent means the harness has no
   * reliable model-list command for environment-bound execution. Failures reject; callers must not
   * substitute fallbacks or a desktop catalog.
   */
  discoverInEnvironment?(executor: HarnessCommandExecutor): Promise<ModelOption[]>;
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
  /**
   * True only when the CLI was shown to resume a conversation from a different directory after the
   * directory it started in was removed (see docs/harness-integration.md "Removed-worktree resume").
   * Absent means unproven or known not to: such a conversation resumes only in its original
   * directory, so a removed worktree must be recreated rather than substituting another checkout.
   */
  readonly resumesWithoutOriginalDirectory?: boolean;
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
/** Transport-neutral launch context for attention preparation. */
export interface AttentionPreparationContext {
  /** Main-validated native session a non-fork resume continues; never renderer-supplied. */
  rootSessionId?: string;
}
export interface LocalAttentionContext extends AttentionPreparationContext {
  terminalId: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  files: AttentionAdapterFiles;
  platform: NodeJS.Platform;
  homeDir?: string;
}
export interface HarnessLocalAttention {
  plan(context: LocalAttentionContext): AttentionPlan;
  options(context: LocalAttentionContext): AttentionLaunchOptions | null;
  prepare(context: LocalAttentionContext): PreparedLocalAttention | null;
}
/** Canonical lifecycle event a provider interpreter asks the shared bridge to forward. */
export interface AttentionInterpretation {
  event?: {
    type: 'turn_started' | 'input_requested' | 'input_resolved' | 'turn_completed' | 'turn_interrupted' | 'turn_failed'
      | 'session_started' | 'session_ended' | 'session_continued' | 'location_changed';
    /** Provider-proven subject. Anything not explicitly 'root' fails closed in the broker. */
    scope?: 'root' | 'child';
    sessionId?: string;
    turnId?: string;
    inputId?: string;
    /** Only when the provider can prove input vs approval; never inferred from weak evidence. */
    requestKind?: 'input' | 'approval';
    /** Only for `session_continued`: the bound root session this one continues. */
    continuesSessionId?: string;
    /** Native event class, for diagnostics only. */
    nativeEvent?: string;
    /** The root agent's working directory, as the provider reports it (see "Agent location"). */
    cwd?: string;
  };
  /** Hook stdout; hosts may require a decision payload. Defaults to `{}`. */
  output?: Record<string, unknown>;
}

export interface HarnessAttentionCapability {
  /** ESM source: `export default (input, hook) => AttentionInterpretation`. It owns native
   * lifecycle semantics for hook-command providers; the shared bridge only forwards its result. */
  readonly interpreter?: string;
  /** Whether a non-fork resume keeps its native session ID, so the validated ID may seed the root. */
  readonly resumePreservesSessionId?: boolean;
  /** How completely this provider's structured lifecycle covers a foreground turn. Absent means `full`:
   * every lower-confidence source stays suppressed. `partial` marks an unobservable boundary. */
  readonly authority?: 'full' | 'partial';
  /** `native`: in-process plugin/extension events; `hook`: provider hook commands. Absent means `hook`. */
  readonly source?: 'native' | 'hook';
  /** The provider spawns its hook commands in the agent's own working directory, so once that
   * directory is gone no lifecycle event can arrive (Codex: verified). Its agents reported inside a
   * checkout Git no longer has are then taken off Running rather than left there forever. */
  readonly hooksRunInAgentDirectory?: boolean;
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
    parts: string[]; files: Record<string, string>; upgradeFile?: string; legacyFiles?: readonly string[];
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
  /** Desktop application identity for protocols that ask clients to introduce themselves. */
  readonly clientInfo?: { readonly name: string; readonly title: string; readonly version: string };
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

/**
 * Optional manually-managed accounts. Shared code owns IDs, selection, persistence, owned-directory
 * allocation, launch binding and provenance; the provider owns only authentication protocol and
 * account-environment semantics. Providers receive bound executors (their environment already carries
 * the managed home) and never an SSH target, a renderer value or a filesystem path other than the
 * trusted `home` handed to `environment` and `discoverSessions` by main.
 */
export interface HarnessAccountIdentity {
  /** Display-only; provider-reported. */
  email?: string;
  plan?: string;
}
export interface HarnessAccountExecutionContext {
  /** Bounded commands whose environment is already bound to the managed account. */
  readonly executor: HarnessCommandExecutor;
  readonly sessionExecutor?: HarnessCommandSessionExecutor;
  readonly signal: AbortSignal;
  readonly clientInfo: { readonly name: string; readonly title: string; readonly version: string };
}
export interface HarnessAccountAuthContext extends HarnessAccountExecutionContext {
  /** Main validates and opens the URL; the provider never opens anything itself. */
  openUrl(url: string): void;
  /** Reports that the user must finish in the browser. */
  waitingForBrowser(): void;
}
export interface HarnessAccountsCapability {
  /** Provider-owned variables that bind a launch/probe to a managed home. Never used for the default account. */
  environment(home: string): Record<string, string>;
  /** Runs the provider's supported sign-in to completion and verifies the account. Abort cancels it. */
  authenticate(context: HarnessAccountAuthContext): Promise<HarnessAccountIdentity>;
  /** Machine-readable check of the bound account; throws `unauthenticated` when signed out. */
  verify(context: HarnessAccountExecutionContext): Promise<HarnessAccountIdentity>;
  /** Provider-supported sign-out/secure-store cleanup of the bound account. */
  logout(context: HarnessAccountExecutionContext): Promise<void>;
  /** Same parser as the default discovery, run against a trusted managed home. */
  discoverSessions(workspacePath: string, home: string): Promise<HarnessSession[]>;
}

/**
 * How a LIVE conversation of this harness may be moved to another checkout (issue #102). This is not
 * implied by `sessions.resumesWithoutOriginalDirectory`, which only says a conversation can be resumed
 * once its original directory is gone. Moving a running one is a different property, so a provider says
 * so explicitly, and shared code never branches on a harness name:
 *
 * - `hot-replace`: a second process may resume the conversation while the first is still alive and
 *   waiting inside the request that asked for the move. Shared code proves the second one, then retires
 *   the first.
 * - `after-turn`: the conversation must not be resumed while its process (or an in-flight turn) still
 *   owns it. The move is scheduled when the request is accepted and performed after the harness'
 *   native root turn completes: the first process is retired completely, and only then is the same
 *   conversation resumed in the target.
 * - `live-relocate`: a proven native operation moves the SAME running root turn, including its tools
 *   and resources. Main waits for matching native location evidence, then atomically rebinds authority.
 *   Neither a resume capability nor an API success response proves this property.
 */
export type CheckoutRehomeMode = 'hot-replace' | 'after-turn' | 'live-relocate';
/**
 * A provider helper process that touched native conversation state could not be PROVEN to have exited. Nothing may
 * be resumed afterwards: a second process around the same native session state is exactly what the checkout
 * lifecycle exists to prevent.
 */
export class UnverifiedProcessExitError extends Error {
  constructor(message = 'A helper process could not be confirmed stopped') { super(message); this.name = 'UnverifiedProcessExitError'; }
}

export interface HarnessCheckoutRehomeCapability {
  readonly mode: CheckoutRehomeMode;
  /**
   * Proven provider-native movement of the running root session, including cwd-bound tools/resources.
   * Required for `live-relocate`. Must honor cancellation and never submit a prompt, restart a process,
   * or redirect only individual tools. Returning is NOT proof: main waits for native location evidence.
   * No shipped provider advertises this until a same-turn experiment proves the contract.
   */
  relocateLiveConversation?(request: {
    readonly terminalId: string;
    readonly sessionId: string;
    readonly source: import('../../shared/types/checkoutContext').CheckoutContext;
    readonly target: import('../../shared/types/checkoutContext').CheckoutContext;
    readonly signal: AbortSignal;
  }): Promise<void>;
  /**
   * The resume argv with the harness' own explicit "work in this directory" option set to `directory`
   * (any such option already present is replaced: the target is Clanker's, never the user's). `directory`
   * is a native path taken from a main-owned checkout context. Absent: the launch directory alone decides.
   */
  withTargetDirectory?(args: readonly string[], directory: string): string[];
  /**
   * Whether the output of a resume that failed at startup is this provider's own recognizable, transient
   * "the conversation is still owned" failure. Only this provider-owned recognition permits a retry.
   */
  isWriterContention?(output: string): boolean;
  /**
   * For a CLI whose resume ignores the launch directory and runs in the directory *recorded in the
   * conversation*: moves that recorded directory with the CLI's own native operation, so the resume that
   * follows really runs in `directory` (a native path from a main-owned checkout context). Called with the
   * source process already retired, before every replacement attempt (including recovery, which relocates
   * back). Rejects when the CLI refuses; the caller then treats the attempt as failed and never resumes.
   */
  relocateConversation?(request: { readonly sessionId: string; readonly directory: string; readonly env: NodeJS.ProcessEnv }): Promise<void>;
  /** Bound for such retries; absent means none. */
  readonly writerContentionRetry?: { readonly attempts: number; readonly delayMs: number };
}

/**
 * Optional, distinct from attention: how this harness receives the shared Clanker MCP bridge for one
 * local launch. Shared code owns the server, the credential, identity binding and every tool; the
 * provider owns only the harness-native mechanism (launch args, environment, a temporary owned
 * config file). A provider that cannot attach the bridge without replacing or disabling the user's
 * own MCP configuration omits this capability: there is no no-op support.
 */
export interface HarnessAgentBridgeContext {
  /** Loopback Streamable HTTP endpoint (`http://127.0.0.1:<port>/mcp`). */
  readonly url: string;
  /** MCP server name to register; shared by every provider so tool names are uniform. */
  readonly serverName: string;
  /**
   * Environment variable that will carry the bearer credential into the child. Providers reference
   * it by name (header expansion / bearer-token env var); they never receive the credential itself,
   * so it cannot end up in argv or a config file.
   */
  readonly tokenEnvVar: string;
  /** Launch argv so far (after earlier attachments). */
  readonly args: readonly string[];
  /** User + harness environment so far, for detecting conflicting user configuration. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  /** Private (0700) directory owned by this launch, created on first use and removed on disposal. */
  scratchDir(): string;
  /**
   * Clanker's guidance for exactly what this launch was granted (see bridgeInstructions). Claude shows MCP
   * server instructions to the model itself; a harness that does not (Codex defers MCP tools behind a
   * search and never surfaces the server's text) may pass this through its own launch-scoped instruction
   * channel, but only where that cannot replace instructions the user wrote. Guidance only: nothing
   * depends on the model following it.
   */
  readonly instructions?: string;
}
export interface HarnessAgentBridgeCapability {
  /**
   * Returns null when the bridge cannot be attached to this launch without touching user-owned
   * configuration (e.g. the user already defines the same server name or the same override channel).
   * The returned `dispose` releases only provider-owned resources; the credential and the scratch
   * directory are released by shared code.
   */
  prepare(context: HarnessAgentBridgeContext): PreparedHarnessAttachment | null;
}

export type AttentionPlan = { status: 'ready'; options: AttentionLaunchOptions }
  | { status: 'blocked'; failure: HarnessCapabilityError };

/** Metadata cannot advertise AI commit, usage or accounts without an implementation, or vice versa. */
export function defineHarness<Provider extends HarnessProvider>(provider: Provider & (
  Provider['descriptor'] extends { aiCommit: unknown }
    ? { aiCommit: HarnessAiCommitCapability } : { aiCommit?: never }
) & (
  Provider['descriptor'] extends { usage: unknown }
    ? { usage: HarnessUsageCapability } : { usage?: never }
) & (
  Provider['descriptor'] extends { accounts: unknown }
    ? { accounts: HarnessAccountsCapability } : { accounts?: never }
) & (
  Provider['descriptor'] extends { agentBridge: unknown }
    ? { agentBridge: HarnessAgentBridgeCapability } : { agentBridge?: never }
)): Provider { return provider; }
