import { getHarnessProviders } from '../harnesses/registry';
import { HarnessCapabilityError, classifyHarnessFailure, type HarnessProvider, type HarnessUsageSnapshot } from '../harnesses/types';
import { LocalEnvironment } from '../environment/localEnvironment';
import type { WorkspaceEnvironment } from '../environment/workspaceEnvironment';
import type { RegisteredWorkspace } from '../workspaceRegistry';
import type {
  HarnessUsageEntry,
  HarnessUsageRequest,
  HarnessUsageResponse,
  HarnessUsageStatus,
} from '../../shared/types/harnessUsage';
import { toRendererMeasurements, validateUsageSnapshot } from './usageSnapshot';
import { bindHarnessExecution } from '../accounts/accountExecution';
import type { HarnessAccountStatus } from '../../shared/types/harnessAccounts';
import type { HarnessId } from '../../shared/harnessIds';
import type { ResolvedHarnessAccountBinding } from '../accounts/harnessAccountService';

export const DEFAULT_USAGE_CACHE_TTL_MS = 5 * 60_000;
export const DEFAULT_USAGE_FAILURE_BACKOFF_MS = 60_000;
/** Clanker's own floor between manual refreshes of one provider. */
export const USAGE_FORCE_FLOOR_MS = 10_000;
/** Whole-probe ceiling, independent of per-command timeouts. */
export const USAGE_PROVIDER_DEADLINE_MS = 45_000;
/** How long an installed-harness answer is reused (a manual refresh re-checks). */
export const USAGE_AVAILABILITY_TTL_MS = 60_000;
const MIN_TTL_MS = 10_000;
const MAX_HARNESS_IDS = 32;
const ACCOUNT_KEY_SEPARATOR = '\u0000';
/** Default and single-account launches keep the harness ID as their key, exactly as before accounts existed. */
const usageKey = (harnessId: string, binding?: ResolvedHarnessAccountBinding) =>
  binding?.kind === 'managed' ? `${harnessId}${ACCOUNT_KEY_SEPARATOR}${binding.id}` : harnessId;

const STATUS_TEXT: Record<Exclude<HarnessUsageStatus, 'ok'>, string> = {
  unsupported: 'No supported usage probe',
  'not-installed': 'Not installed in this environment',
  unauthenticated: 'Not signed in',
  unavailable: 'Usage temporarily unavailable',
  error: 'Usage could not be read',
};

export interface UsageWorkspaceLookup {
  getWorkspace(workspaceId: string): RegisteredWorkspace | null;
}

/** The slice of the account service usage needs; usage never owns account state. */
export interface UsageAccountSource {
  listBindings(environmentId: string, harness: HarnessId): ResolvedHarnessAccountBinding[];
  reportStatus(accountId: string, status: Exclude<HarnessAccountStatus, 'unknown'>): void;
  onAccountsChanged?(listener: (change: { accountId: string; type?: string }) => void): () => void;
}

export interface HarnessUsageServiceOptions {
  /** Optional account orchestration; without it (or without managed accounts) behaviour is unchanged. */
  accounts?: UsageAccountSource;
  now?: () => number;
  /** Injectable for tests; production uses the canonical registry. */
  providers?: () => readonly HarnessProvider[];
  /** Desktop application version, supplied by main (providers never touch Electron). */
  clientVersion?: () => string;
  /** Optional local environment; if omitted, falls back to new LocalEnvironment(). */
  localEnvironment?: WorkspaceEnvironment | (() => WorkspaceEnvironment);
  /** Optional environment generation provider for invalidation tracking. */
  getEnvironmentGeneration?: (environmentId: string) => number;
}

/**
 * Main-process record. Holds the validated snapshot including opaque account
 * identity; it is converted to a renderer-safe entry only in `toEntry`.
 */
interface UsageRecord {
  harnessId: string;
  status: HarnessUsageStatus;
  snapshot?: HarnessUsageSnapshot;
  stale?: boolean;
  error?: string;
  checkedAt: number;
  /** Ordinary requests are served from cache until then. */
  freshUntil: number;
  /** Hard provider limit: not even a manual refresh probes before this. */
  probeNotBefore: number;
}

/** Main-only view of cached snapshots; never sent over IPC. */
export interface CachedUsageSnapshot {
  harnessId: string;
  status: HarnessUsageStatus;
  snapshot: HarnessUsageSnapshot;
  stale: boolean;
}

function toEntry(record: UsageRecord): HarnessUsageEntry {
  return {
    harnessId: record.harnessId,
    status: record.status,
    measurements: record.snapshot ? toRendererMeasurements(record.snapshot) : [],
    ...(record.snapshot ? { observedAt: record.snapshot.observedAt } : {}),
    checkedAt: record.checkedAt,
    nextRefreshAt: record.freshUntil,
    refreshableAt: Math.max(record.probeNotBefore, record.checkedAt + USAGE_FORCE_FLOOR_MS),
    ...(record.stale ? { stale: true } : {}),
    ...(record.error ? { error: record.error } : {}),
  };
}

function plainEntry(harnessId: string, status: Exclude<HarnessUsageStatus, 'ok'>): HarnessUsageEntry {
  return { harnessId, status, measurements: [], error: STATUS_TEXT[status] };
}

/** Failure categories map to display states generically; no harness knowledge. */
function statusFor(error: HarnessCapabilityError): Exclude<HarnessUsageStatus, 'ok'> {
  switch (error.kind) {
    case 'unsupported': return 'unsupported';
    case 'binary-unavailable': return 'not-installed';
    case 'unauthenticated': return 'unauthenticated';
    case 'timeout': case 'transport-failure': case 'aborted': case 'not-configured': return 'unavailable';
    default: return 'error';
  }
}

/**
 * Resolves usage through each provider's `usage` capability, executed in the
 * registered workspace's own environment. Results are cached per environment
 * object (so local and SSH accounts never share), deduplicated while in flight
 * and isolated per provider. There is no background polling: probes run only
 * when a caller asks and the provider's refresh policy permits.
 *
 * Refresh policy: a normal request is served from cache until `cacheTtlMs`
 * (default 5 min) passes. A manual refresh (`force`) bypasses that freshness
 * but never the hard limits: the provider's `minimumProbeIntervalMs`, its
 * failure backoff, or Clanker's own 10 s floor.
 */
export class HarnessUsageService {
  private readonly cache = new WeakMap<WorkspaceEnvironment, Map<string, UsageRecord>>();
  /** Recently used per-environment record maps (bounded), so a removed account's entries can be dropped. */
  private readonly recordMaps: Array<Map<string, UsageRecord>> = [];
  private readonly flights = new WeakMap<WorkspaceEnvironment, Map<string, Promise<UsageRecord | 'not-installed'>>>();
  private readonly availability = new WeakMap<WorkspaceEnvironment, { ids: ReadonlySet<string>; at: number }>();
  private readonly availabilityFlights = new WeakMap<WorkspaceEnvironment, Promise<ReadonlySet<string> | undefined>>();
  private readonly controllers = new Set<AbortController>();
  private readonly now: () => number;
  private readonly listProviders: () => readonly HarnessProvider[];
  private readonly clientVersion: () => string;
  private readonly accounts?: UsageAccountSource;
  private readonly localEnvironment?: WorkspaceEnvironment | (() => WorkspaceEnvironment);
  private defaultLocalEnvironment?: WorkspaceEnvironment;
  private readonly getEnvironmentGeneration: (environmentId: string) => number;

  constructor(private readonly registry: UsageWorkspaceLookup, options: HarnessUsageServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.listProviders = options.providers ?? getHarnessProviders;
    this.clientVersion = options.clientVersion ?? (() => 'unknown');
    this.accounts = options.accounts;
    this.localEnvironment = options.localEnvironment;
    this.getEnvironmentGeneration = options.getEnvironmentGeneration ?? (() => 0);
    // A removed or reconnected account's cached readings and backoff must not outlive it.
    this.accounts?.onAccountsChanged?.((change) => {
      if (change.type === 'removed' || change.type === 'reconnected') {
        this.forgetAccount(change.accountId);
      }
    });
  }

  private forgetAccount(accountId: string): void {
    for (const records of this.recordMaps) {
      for (const key of [...records.keys()]) if (key.endsWith(`${ACCOUNT_KEY_SEPARATOR}${accountId}`)) records.delete(key);
    }
  }

  private resolveLocalEnvironment(): WorkspaceEnvironment {
    if (typeof this.localEnvironment === 'function') return this.localEnvironment();
    if (this.localEnvironment) return this.localEnvironment;
    return (this.defaultLocalEnvironment ??= new LocalEnvironment());
  }

  private async resolveEntries(environment: WorkspaceEnvironment, request: HarnessUsageRequest): Promise<HarnessUsageEntry[]> {
    let providers = this.listProviders();
    if (request.harnessIds) {
      const wanted = new Set(request.harnessIds.slice(0, MAX_HARNESS_IDS));
      providers = providers.filter((provider) => wanted.has(provider.descriptor.id));
    }
    const force = request.force === true;
    // One availability check per request, shared by every provider that needs it.
    let availability: Promise<ReadonlySet<string> | undefined> | undefined;
    const installed = () => availability ??= this.installedHarnesses(environment, force);
    return (await Promise.all(providers.map((provider) => this.resolveAccounts(environment, provider, force, installed)))).flat();
  }

  public async get(workspaceId: string, request: HarnessUsageRequest = {}): Promise<HarnessUsageResponse> {
    const workspace = typeof workspaceId === 'string' ? this.registry.getWorkspace(workspaceId) : null;
    if (!workspace) throw new Error('Workspace is not registered');
    const { environment } = workspace;

    const entries = await this.resolveEntries(environment, request);

    // The workspace may have closed (or been replaced under the same ID)
    // while probes ran. Never hand its result to whatever workspace is there now.
    if (this.registry.getWorkspace(workspaceId) !== workspace) throw new Error('Workspace closed during usage request');
    return {
      workspaceId,
      environmentId: environment.id,
      environmentGeneration: this.getEnvironmentGeneration(environment.id),
      entries,
    };
  }

  public async getLocal(request: HarnessUsageRequest = {}): Promise<HarnessUsageResponse> {
    const environment = this.resolveLocalEnvironment();
    const entries = await this.resolveEntries(environment, request);
    return {
      environmentId: 'local',
      environmentGeneration: 0,
      entries,
    };
  }

  /** Main-process access to the retained snapshots (including opaque account IDs). */
  public getCachedSnapshots(workspaceId?: string | null): CachedUsageSnapshot[] {
    const isLocal = !workspaceId || workspaceId === 'local';
    const environment = isLocal ? this.resolveLocalEnvironment() : this.registry.getWorkspace(workspaceId)?.environment;
    if (!isLocal && !environment) throw new Error('Workspace is not registered');
    if (!environment) return [];
    return [...(this.cache.get(environment)?.values() ?? [])].flatMap((record) =>
      record.snapshot ? [{ harnessId: record.harnessId, status: record.status, snapshot: record.snapshot, stale: record.stale === true }] : []);
  }

  /** Aborts in-flight probes (shutdown). */
  public dispose(): void {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }

  /** Whether a probe may start now for this cached record. */
  private mustServeCache(record: UsageRecord | undefined, force: boolean, now: number): record is UsageRecord {
    if (!record) return false;
    if (now < record.probeNotBefore) return true;
    if (force) return now - record.checkedAt < USAGE_FORCE_FLOOR_MS;
    return now < record.freshUntil;
  }

  /**
   * Account-capable providers with managed accounts report one entry per account (selected first), each
   * cached, backed off and probed independently. Everyone else, including every default-only user,
   * takes the single-entry path unchanged.
   */
  private async resolveAccounts(
    environment: WorkspaceEnvironment, provider: HarnessProvider, force: boolean,
    installedHarnesses: () => Promise<ReadonlySet<string> | undefined>,
  ): Promise<HarnessUsageEntry[]> {
    const bindings = this.accounts && provider.accounts && environment.kind === 'local'
      ? this.accounts.listBindings(environment.id, provider.descriptor.id) : [];
    if (bindings.length <= 1) return [await this.resolve(environment, provider, force, installedHarnesses)];
    const entries = await Promise.all(bindings.map(async (binding): Promise<HarnessUsageEntry> => ({
      ...(await this.resolve(environment, provider, force, installedHarnesses, binding)),
      // Identity and selection are read live: cached readings must not carry a stale "selected" flag.
      account: { id: binding.id, name: binding.safe.label ?? binding.safe.email ?? (binding.kind === 'default' ? 'Default' : 'Account'), selected: binding.safe.selected },
    })));
    // "Not installed" is a property of the environment, not of an account.
    if (entries[0].status === 'not-installed' || entries[0].status === 'unsupported') return [{ ...entries[0], account: undefined }];
    return entries;
  }

  private async resolve(
    environment: WorkspaceEnvironment, provider: HarnessProvider, force: boolean,
    installedHarnesses: () => Promise<ReadonlySet<string> | undefined>,
    binding?: ResolvedHarnessAccountBinding,
  ): Promise<HarnessUsageEntry> {
    const harnessId = provider.descriptor.id;
    if (!provider.usage) return plainEntry(harnessId, 'unsupported');
    if (!environment.executeHarnessCommand) return plainEntry(harnessId, 'unavailable');

    // An unusable managed account is reported, never probed and never replaced by another account.
    if (binding?.unusable) return plainEntry(harnessId, 'unauthenticated');
    const key = usageKey(harnessId, binding);
    const cached = this.cache.get(environment)?.get(key);
    if (this.mustServeCache(cached, force, this.now())) return toEntry(cached);
    let flights = this.flights.get(environment);
    if (!flights) this.flights.set(environment, flights = new Map());
    let flight = flights.get(key);
    if (!flight) {
      flight = installedHarnesses()
        .then(async (installed): Promise<UsageRecord | 'not-installed'> => (installed && !installed.has(harnessId) ? 'not-installed' : this.probe(environment, provider, cached, binding)))
        .finally(() => { flights.delete(key); });
      flights.set(key, flight);
    }
    const outcome = await flight;
    return outcome === 'not-installed' ? plainEntry(harnessId, 'not-installed') : toEntry(outcome);
  }

  /**
   * One environment-owned availability check per refresh window (a single
   * batched SSH call remotely). An empty or failed answer is inconclusive, not
   * "nothing installed": probes then proceed and report their own outcome.
   */
  private installedHarnesses(environment: WorkspaceEnvironment, force: boolean): Promise<ReadonlySet<string> | undefined> {
    const known = this.availability.get(environment);
    if (known && !force && this.now() - known.at < USAGE_AVAILABILITY_TTL_MS) return Promise.resolve(known.ids);
    if (!environment.probeAvailableHarnessIds) return Promise.resolve(undefined);
    // Per-harness requests arrive concurrently; they all share the check that is already running
    // (forced or not: it started just now, so it is as fresh as a new one would be).
    const running = this.availabilityFlights.get(environment);
    if (running) return running;
    const flight = environment.probeAvailableHarnessIds().then((ids) => {
      if (!Array.isArray(ids) || ids.length === 0) return undefined;
      const set = new Set(ids.filter((id): id is string => typeof id === 'string'));
      this.availability.set(environment, { ids: set, at: this.now() });
      return set;
    }, () => undefined).finally(() => {
      if (this.availabilityFlights.get(environment) === flight) this.availabilityFlights.delete(environment);
    });
    this.availabilityFlights.set(environment, flight);
    return flight;
  }

  private async probe(environment: WorkspaceEnvironment, provider: HarnessProvider, previous: UsageRecord | undefined, binding?: ResolvedHarnessAccountBinding): Promise<UsageRecord> {
    const harnessId = provider.descriptor.id;
    const capability = provider.usage!;
    const controller = new AbortController();
    this.controllers.add(controller);
    // The environment decides WHERE/HOW; a managed account only adds its main-owned variables. The
    // provider never sees a path or variable: it gets these bound executors (default: untouched).
    const execution = bindHarnessExecution(environment, binding?.kind === 'managed' ? binding.environment : undefined, controller.signal);
    const { executor, sessionExecutor } = execution;
    const policy = capability.refresh;
    const hardMinimum = Math.max(policy?.minimumProbeIntervalMs ?? 0, 0);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let record: UsageRecord;
    try {
      const raw = await Promise.race([
        capability.get({ executor, ...(sessionExecutor ? { sessionExecutor } : {}), transport: environment.kind, signal: controller.signal, ...(binding?.kind === 'managed' ? { accountId: binding.id } : {}), clientInfo: { name: 'clanker-grid', title: 'Clanker Grid', version: this.clientVersion() } }),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => {
            controller.abort();
            reject(new HarnessCapabilityError('timeout', 'Usage probe exceeded its deadline'));
          }, USAGE_PROVIDER_DEADLINE_MS);
        }),
      ]);
      const snapshot = validateUsageSnapshot(raw);
      const checkedAt = this.now();
      record = {
        harnessId, status: 'ok', snapshot, checkedAt,
        freshUntil: checkedAt + Math.max(policy?.cacheTtlMs ?? DEFAULT_USAGE_CACHE_TTL_MS, MIN_TTL_MS, hardMinimum),
        probeNotBefore: checkedAt + hardMinimum,
      };
    } catch (error) {
      const failure = classifyHarnessFailure(error, environment.kind);
      const status = statusFor(failure);
      const checkedAt = this.now();
      // retryAfterMs is provider-controlled: only a finite positive number may lengthen the backoff.
      const demanded = typeof failure.retryAfterMs === 'number' && Number.isFinite(failure.retryAfterMs) && failure.retryAfterMs > 0 ? failure.retryAfterMs : 0;
      const backoff = Math.max(policy?.failureBackoffMs ?? DEFAULT_USAGE_FAILURE_BACKOFF_MS, MIN_TTL_MS, hardMinimum, demanded);
      record = {
        harnessId, status, checkedAt, error: STATUS_TEXT[status],
        freshUntil: checkedAt + backoff,
        // Failure backoff is a hard limit: repeated manual refreshes cannot shorten it.
        probeNotBefore: checkedAt + backoff,
        // Keep the last good reading, flagged, so the UI need not go blank.
        ...(previous?.snapshot ? { snapshot: previous.snapshot, stale: true } : {}),
      };
    } finally {
      if (deadline) clearTimeout(deadline);
      this.controllers.delete(controller);
      controller.abort();
      await execution.disposeSessions();
    }
    let perEnvironment = this.cache.get(environment);
    if (!perEnvironment) {
      this.cache.set(environment, perEnvironment = new Map());
      this.recordMaps.push(perEnvironment);
      if (this.recordMaps.length > 64) this.recordMaps.shift();
    }
    perEnvironment.set(usageKey(harnessId, binding), record);
    // A probe may only mark a managed account (never delete or reroute it).
    if (binding?.kind === 'managed') {
      if (record.status === 'ok') this.accounts?.reportStatus(binding.id, 'connected');
      else if (record.status === 'unauthenticated') this.accounts?.reportStatus(binding.id, 'needs-auth');
    }
    return record;
  }
}
