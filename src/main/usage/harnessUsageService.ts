import { getHarnessProviders } from '../harnesses/registry';
import { HarnessCapabilityError, classifyHarnessFailure, type HarnessProvider, type HarnessUsageSnapshot } from '../harnesses/types';
import type { HarnessCommandExecutor, HarnessCommandSession, HarnessCommandSessionExecutor } from '../harnesses/commandExecution';
import type { WorkspaceEnvironment } from '../environment/workspaceEnvironment';
import type { RegisteredWorkspace } from '../workspaceRegistry';
import type {
  HarnessUsageEntry,
  HarnessUsageRequest,
  HarnessUsageResponse,
  HarnessUsageStatus,
} from '../../shared/types/harnessUsage';
import { toRendererMeasurements, validateUsageSnapshot } from './usageSnapshot';

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

export interface HarnessUsageServiceOptions {
  now?: () => number;
  /** Injectable for tests; production uses the canonical registry. */
  providers?: () => readonly HarnessProvider[];
  /** Desktop application version, supplied by main (providers never touch Electron). */
  clientVersion?: () => string;
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
  private readonly flights = new WeakMap<WorkspaceEnvironment, Map<string, Promise<UsageRecord | 'not-installed'>>>();
  private readonly availability = new WeakMap<WorkspaceEnvironment, { ids: ReadonlySet<string>; at: number }>();
  private readonly controllers = new Set<AbortController>();
  private readonly now: () => number;
  private readonly listProviders: () => readonly HarnessProvider[];
  private readonly clientVersion: () => string;

  constructor(private readonly registry: UsageWorkspaceLookup, options: HarnessUsageServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.listProviders = options.providers ?? getHarnessProviders;
    this.clientVersion = options.clientVersion ?? (() => 'unknown');
  }

  public async get(workspaceId: string, request: HarnessUsageRequest = {}): Promise<HarnessUsageResponse> {
    const workspace = typeof workspaceId === 'string' ? this.registry.getWorkspace(workspaceId) : null;
    if (!workspace) throw new Error('Workspace is not registered');
    const { environment } = workspace;

    let providers = this.listProviders();
    if (request.harnessIds) {
      const wanted = new Set(request.harnessIds.slice(0, MAX_HARNESS_IDS));
      providers = providers.filter((provider) => wanted.has(provider.descriptor.id));
    }
    const force = request.force === true;
    // One availability check per request, shared by every provider that needs it.
    let availability: Promise<ReadonlySet<string> | undefined> | undefined;
    const installed = () => availability ??= this.installedHarnesses(environment, force);
    const entries = await Promise.all(providers.map((provider) => this.resolve(environment, provider, force, installed)));

    // The workspace may have closed (or been replaced under the same ID)
    // while probes ran. Never hand its result to whatever workspace is there now.
    if (this.registry.getWorkspace(workspaceId) !== workspace) throw new Error('Workspace closed during usage request');
    return { workspaceId, entries };
  }

  /** Main-process access to the retained snapshots (including opaque account IDs). */
  public getCachedSnapshots(workspaceId: string): CachedUsageSnapshot[] {
    const workspace = this.registry.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace is not registered');
    return [...(this.cache.get(workspace.environment)?.values() ?? [])].flatMap((record) =>
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

  private async resolve(
    environment: WorkspaceEnvironment, provider: HarnessProvider, force: boolean,
    installedHarnesses: () => Promise<ReadonlySet<string> | undefined>,
  ): Promise<HarnessUsageEntry> {
    const harnessId = provider.descriptor.id;
    if (!provider.usage) return plainEntry(harnessId, 'unsupported');
    if (!environment.executeHarnessCommand) return plainEntry(harnessId, 'unavailable');

    const cached = this.cache.get(environment)?.get(harnessId);
    if (this.mustServeCache(cached, force, this.now())) return toEntry(cached);
    let flights = this.flights.get(environment);
    if (!flights) this.flights.set(environment, flights = new Map());
    let flight = flights.get(harnessId);
    if (!flight) {
      flight = installedHarnesses()
        .then(async (installed): Promise<UsageRecord | 'not-installed'> => (installed && !installed.has(harnessId) ? 'not-installed' : this.probe(environment, provider, cached)))
        .finally(() => { flights.delete(harnessId); });
      flights.set(harnessId, flight);
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
    return environment.probeAvailableHarnessIds().then((ids) => {
      if (!Array.isArray(ids) || ids.length === 0) return undefined;
      const set = new Set(ids.filter((id): id is string => typeof id === 'string'));
      this.availability.set(environment, { ids: set, at: this.now() });
      return set;
    }, () => undefined);
  }

  private async probe(environment: WorkspaceEnvironment, provider: HarnessProvider, previous: UsageRecord | undefined): Promise<UsageRecord> {
    const harnessId = provider.descriptor.id;
    const capability = provider.usage!;
    const execute = environment.executeHarnessCommand!.bind(environment);
    const controller = new AbortController();
    this.controllers.add(controller);
    const executor: HarnessCommandExecutor = { run: (command) => execute(command, controller.signal) };
    // Sessions opened by the provider are always reaped when the probe ends, however it ends.
    const sessions = new Set<HarnessCommandSession>();
    const openSession = environment.openHarnessCommandSession?.bind(environment);
    const sessionExecutor: HarnessCommandSessionExecutor | undefined = openSession ? {
      open: async (command) => {
        const session = await openSession(command, controller.signal);
        sessions.add(session);
        return session;
      },
    } : undefined;
    const policy = capability.refresh;
    const hardMinimum = Math.max(policy?.minimumProbeIntervalMs ?? 0, 0);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let record: UsageRecord;
    try {
      const raw = await Promise.race([
        capability.get({ executor, ...(sessionExecutor ? { sessionExecutor } : {}), transport: environment.kind, signal: controller.signal, clientInfo: { name: 'clanker-grid', title: 'Clanker Grid', version: this.clientVersion() } }),
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
      await Promise.allSettled([...sessions].map((session) => session.dispose()));
    }
    let perEnvironment = this.cache.get(environment);
    if (!perEnvironment) this.cache.set(environment, perEnvironment = new Map());
    perEnvironment.set(harnessId, record);
    return record;
  }
}
