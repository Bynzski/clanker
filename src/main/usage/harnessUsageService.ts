import { getHarnessProviders } from '../harnesses/registry';
import { HarnessCapabilityError, classifyHarnessFailure, type HarnessProvider } from '../harnesses/types';
import type { HarnessCommandExecutor } from '../harnesses/commandExecution';
import type { WorkspaceEnvironment } from '../environment/workspaceEnvironment';
import type { RegisteredWorkspace } from '../workspaceRegistry';
import type {
  HarnessUsageEntry,
  HarnessUsageRequest,
  HarnessUsageResponse,
  HarnessUsageStatus,
} from '../../shared/types/harnessUsage';
import { toUsageView } from './usageSnapshot';

export const DEFAULT_USAGE_MIN_INTERVAL_MS = 5 * 60_000;
export const DEFAULT_USAGE_FAILURE_BACKOFF_MS = 60_000;
/** Explicit refreshes closer together than this return the cached result. */
export const USAGE_FORCE_FLOOR_MS = 10_000;
/** Whole-probe ceiling, independent of per-command timeouts. */
export const USAGE_PROVIDER_DEADLINE_MS = 45_000;
const MIN_POLICY_MS = 10_000;
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
}

interface CacheEntry extends HarnessUsageEntry { nextRefreshAt: number; checkedAt: number }

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
 */
export class HarnessUsageService {
  private readonly cache = new WeakMap<WorkspaceEnvironment, Map<string, CacheEntry>>();
  private readonly flights = new WeakMap<WorkspaceEnvironment, Map<string, Promise<CacheEntry>>>();
  private readonly controllers = new Set<AbortController>();
  private readonly now: () => number;
  private readonly listProviders: () => readonly HarnessProvider[];

  constructor(private readonly registry: UsageWorkspaceLookup, options: HarnessUsageServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.listProviders = options.providers ?? getHarnessProviders;
  }

  public async get(workspaceId: string, request: HarnessUsageRequest = {}): Promise<HarnessUsageResponse> {
    const workspace = typeof workspaceId === 'string' ? this.registry.getWorkspace(workspaceId) : null;
    if (!workspace) throw new Error('Workspace is not registered');

    let providers = this.listProviders();
    if (request.harnessIds) {
      const wanted = new Set(request.harnessIds.slice(0, MAX_HARNESS_IDS));
      providers = providers.filter((provider) => wanted.has(provider.descriptor.id));
    }
    const force = request.force === true;
    const entries = await Promise.all(providers.map((provider) => this.resolve(workspace.environment, provider, force)));

    // The workspace may have closed (or been replaced under the same ID)
    // while probes ran. Never hand its result to whatever workspace is there now.
    if (this.registry.getWorkspace(workspaceId) !== workspace) throw new Error('Workspace closed during usage request');
    return { workspaceId, entries };
  }

  /** Aborts in-flight probes (shutdown). */
  public dispose(): void {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }

  private async resolve(environment: WorkspaceEnvironment, provider: HarnessProvider, force: boolean): Promise<HarnessUsageEntry> {
    const harnessId = provider.descriptor.id;
    const capability = provider.usage;
    if (!capability) return { harnessId, status: 'unsupported', measurements: [], error: STATUS_TEXT.unsupported };
    if (!environment.executeHarnessCommand) {
      return { harnessId, status: 'unavailable', measurements: [], error: STATUS_TEXT.unavailable };
    }

    const now = this.now();
    const cached = this.cache.get(environment)?.get(harnessId);
    if (cached && now < cached.nextRefreshAt && !(force && now - cached.checkedAt >= USAGE_FORCE_FLOOR_MS)) {
      return { ...cached };
    }
    let flights = this.flights.get(environment);
    if (!flights) this.flights.set(environment, flights = new Map());
    let flight = flights.get(harnessId);
    if (!flight) {
      flight = this.probe(environment, provider, cached).finally(() => { flights.delete(harnessId); });
      flights.set(harnessId, flight);
    }
    return { ...(await flight) };
  }

  private async probe(environment: WorkspaceEnvironment, provider: HarnessProvider, previous: CacheEntry | undefined): Promise<CacheEntry> {
    const harnessId = provider.descriptor.id;
    const capability = provider.usage!;
    const execute = environment.executeHarnessCommand!.bind(environment);
    const controller = new AbortController();
    this.controllers.add(controller);
    const executor: HarnessCommandExecutor = { run: (command) => execute(command, controller.signal) };
    const policy = capability.refresh;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let entry: CacheEntry;
    try {
      const snapshot = await Promise.race([
        capability.get({ executor, transport: environment.kind, signal: controller.signal }),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => {
            controller.abort();
            reject(new HarnessCapabilityError('timeout', 'Usage probe exceeded its deadline'));
          }, USAGE_PROVIDER_DEADLINE_MS);
        }),
      ]);
      const view = toUsageView(snapshot);
      const checkedAt = this.now();
      entry = {
        harnessId, status: 'ok', measurements: view.measurements, observedAt: view.observedAt, checkedAt,
        nextRefreshAt: checkedAt + Math.max(policy?.minIntervalMs ?? DEFAULT_USAGE_MIN_INTERVAL_MS, MIN_POLICY_MS),
      };
    } catch (error) {
      const failure = classifyHarnessFailure(error, environment.kind);
      const status = statusFor(failure);
      const checkedAt = this.now();
      entry = {
        harnessId, status, checkedAt, error: STATUS_TEXT[status],
        nextRefreshAt: checkedAt + Math.max(policy?.failureBackoffMs ?? DEFAULT_USAGE_FAILURE_BACKOFF_MS, MIN_POLICY_MS),
        // Keep the last good reading, flagged, so the UI need not go blank.
        measurements: previous?.measurements ?? [],
        ...(previous?.observedAt !== undefined ? { observedAt: previous.observedAt, stale: true } : {}),
      };
    } finally {
      if (deadline) clearTimeout(deadline);
      this.controllers.delete(controller);
    }
    let perEnvironment = this.cache.get(environment);
    if (!perEnvironment) this.cache.set(environment, perEnvironment = new Map());
    perEnvironment.set(harnessId, entry);
    return entry;
  }
}
