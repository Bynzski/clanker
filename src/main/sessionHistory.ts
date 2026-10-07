import type { HarnessSession } from '../shared/types/session';
import type { HarnessId } from '../shared/harnessIds';
import { buildSessionCommand } from './sessionLaunch';
import { toNativePath, toPosixPath } from '../shared/pathNormalize';
import { getHarnessProviders } from './harnesses/registry';
import { classifyHarnessFailure, type HarnessCapabilityError } from './harnesses/types';
import type { ManagedSessionDiscovery } from './accounts/harnessAccountService';
export { sessionMatchesWorkspace } from './harnesses/sessionFiles';
export { encodeClaudeProjectDir } from './harnesses/claude/sessions';
export { parseOmpSessionMetadata } from './harnesses/omp/sessions';
export { parseAgyWorkspaceUris, mapAgyRowToSession, discoverAgySessions } from './harnesses/agy/sessions';

export const SESSION_CACHE_TTL_MS = 60 * 1000;
export const SESSION_CACHE_MAX_ENTRIES = 16;

interface SessionCacheEntry {
  discovery: DetailedSessionDiscovery;
  cachedAt: number;
}

const sessionCache = new Map<string, SessionCacheEntry>();
const activeScans = new Map<string, object>();
let cacheGeneration = 0;
const CACHE_KEY_SEPARATOR = '\u0000';
export function clearSessionCache(): void {
  cacheGeneration++;
  sessionCache.clear();
}

export function clearSessionCacheForWorkspace(workspacePath?: string): void {
  cacheGeneration++;
  if (!workspacePath) {
    sessionCache.clear();
    return;
  }
  const normalizedPath = toNativePath(workspacePath.replace(/[\\/]+$/, ''), process.platform);
  // Entries are keyed by path plus (when managed accounts exist) the account-set generation.
  for (const key of [...sessionCache.keys()]) {
    if (key === normalizedPath || key.startsWith(`${normalizedPath}${CACHE_KEY_SEPARATOR}`)) sessionCache.delete(key);
  }
}
/** Test-only/introspection helper for verifying the cache remains bounded. */
export function getSessionCacheSize(): number {
  return sessionCache.size;
}

function pruneSessionCache(now: number): void {
  for (const [key, entry] of sessionCache) {
    if (now - entry.cachedAt >= SESSION_CACHE_TTL_MS) {
      sessionCache.delete(key);
    }
  }

  while (sessionCache.size > SESSION_CACHE_MAX_ENTRIES) {
    const oldestKey = sessionCache.keys().next().value;
    if (oldestKey === undefined) break;
    sessionCache.delete(oldestKey);
  }
}

// ============================================================================
// Public API
// ============================================================================
export interface DiscoverSessionsOptions {
  forceRefresh?: boolean;
  /**
   * Trusted managed-account storage roots, supplied by main's account service. The cache key then
   * includes the account-set generation, so stale provenance is never served after the set changes.
   * Absent for default-only users, whose cache identity is exactly the workspace path as before.
   */
  managed?: ManagedSessionDiscovery;
}

type DiscoveryStatus = { status: 'success' } | { status: 'error'; error: string; failure?: HarnessCapabilityError };
export interface DetailedSessionDiscovery {
  sessions: HarnessSession[];
  harnessStatus: Partial<Record<HarnessId, DiscoveryStatus>>;
}

export async function discoverSessions(
  workspacePath?: string,
  options?: DiscoverSessionsOptions,
): Promise<HarnessSession[]> {
  return (await discoverSessionsDetailed(workspacePath, options)).sessions;
}

export async function discoverSessionsDetailed(
  workspacePath?: string,
  options?: DiscoverSessionsOptions,
): Promise<DetailedSessionDiscovery> {
  const normalizedPath = toNativePath((workspacePath ?? '').replace(/[\\/]+$/, ''), process.platform);
  const now = Date.now();
  pruneSessionCache(now);

  const managed = options?.managed && options.managed.targets.length > 0 ? options.managed : undefined;
  const cacheKey = managed ? `${normalizedPath}${CACHE_KEY_SEPARATOR}${managed.cacheKey}` : normalizedPath;
  const cached = sessionCache.get(cacheKey);
  if (cached && !options?.forceRefresh) {
    // Refresh insertion order so eviction follows least-recently-used behavior.
    sessionCache.delete(cacheKey);
    sessionCache.set(cacheKey, cached);
    return cached.discovery;
  }

  // A failed refresh must not leave an older successful entry looking current.
  if (options?.forceRefresh) sessionCache.delete(cacheKey);
  const generation = cacheGeneration;
  const token = {};
  activeScans.set(cacheKey, token);
  try {
    const providers = getHarnessProviders().filter((provider) => provider.sessions?.discover)
      .sort((a, b) => (a.sessions?.discoveryOrder ?? Infinity) - (b.sessions?.discoveryOrder ?? Infinity));
    const harnesses = providers.map((provider) => provider.descriptor.id);
    const [results, managedResults] = await Promise.all([
      Promise.allSettled(providers.map((provider) => Promise.resolve().then(() => provider.sessions!.discover(normalizedPath)))),
      Promise.allSettled((managed?.targets ?? []).map((target) => Promise.resolve().then(() => target.discover(normalizedPath)))),
    ]);

    const sessions: HarnessSession[] = [];
    const harnessStatus = {} as DetailedSessionDiscovery['harnessStatus'];
    for (const [index, result] of results.entries()) {
      const harness = harnesses[index];
      if (result.status === 'fulfilled') {
        sessions.push(...result.value);
        harnessStatus[harness] = { status: 'success' };
      } else {
        harnessStatus[harness] = { status: 'error', error: result.reason instanceof Error ? result.reason.message : String(result.reason), failure: classifyHarnessFailure(result.reason) };
      }
    }

    // Each managed account runs the provider's own parser against its own root. A failing account
    // marks only its harness, never hides the others, and keeps a partial scan out of the cache.
    for (const [index, result] of managedResults.entries()) {
      const target = managed!.targets[index];
      if (result.status === 'fulfilled') {
        sessions.push(...result.value.map((session) => ({ ...session, accountId: target.accountId })));
      } else if (harnessStatus[target.harness]?.status !== 'error') {
        harnessStatus[target.harness] = { status: 'error', error: 'A managed account\'s session history could not be read', failure: classifyHarnessFailure(result.reason) };
      }
    }

    sessions.sort((a, b) => b.timestamp - a.timestamp);

    const posixSessions = sessions.map((session) => ({
      ...session,
      cwd: toPosixPath(session.cwd),
      ...(session.filePath ? { filePath: toPosixPath(session.filePath) } : {}),
    }));

    const discovery = { sessions: posixSessions, harnessStatus };
    // A partial scan can still populate history, but it must not turn into a cached empty scan.
    if (cacheGeneration === generation && activeScans.get(cacheKey) === token
      && Object.values(harnessStatus).every((status) => status?.status === 'success')) {
      sessionCache.set(cacheKey, { discovery, cachedAt: Date.now() });
      pruneSessionCache(Date.now());
    }
    return discovery;
  } finally {
    if (activeScans.get(cacheKey) === token) activeScans.delete(cacheKey);
  }
}

/**
 * Raw provider command and argv for a local resume/fork. Deliberately not a spawn plan: the caller
 * must apply attention integration to this argv and only then plan the PTY spawn (wrapper or
 * Windows resolution) from the final argv and child environment.
 */
export function buildSessionLaunch(session: HarnessSession, fork = false, userFlags?: string): { command: string; args: string[] } {
  return buildSessionCommand({ ...session, ...(session.filePath ? { filePath: toPosixPath(session.filePath) } : {}) }, { operation: fork ? 'fork' : 'resume', transport: 'local', userFlags });
}
