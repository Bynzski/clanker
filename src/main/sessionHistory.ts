import type { HarnessSession } from '../shared/types/session';
import type { HarnessId } from '../shared/harnessIds';
import { ensureHarnessWrapperScript, resolveHarnessSpawn } from './harnessLaunch';
import { buildSessionCommand } from './sessionLaunch';
import { toNativePath, toPosixPath } from '../shared/pathNormalize';
import { getHarnessProviders } from './harnesses/registry';
import { classifyHarnessFailure, type HarnessCapabilityError } from './harnesses/types';
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
export function clearSessionCache(): void {
  sessionCache.clear();
}

export function clearSessionCacheForWorkspace(workspacePath?: string): void {
  if (!workspacePath) {
    sessionCache.clear();
    return;
  }
  const normalizedPath = toNativePath(workspacePath.replace(/[\\/]+$/, ''), process.platform);
  sessionCache.delete(normalizedPath);
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

  const cached = sessionCache.get(normalizedPath);
  if (cached && !options?.forceRefresh) {
    // Refresh insertion order so eviction follows least-recently-used behavior.
    sessionCache.delete(normalizedPath);
    sessionCache.set(normalizedPath, cached);
    return cached.discovery;
  }

  const providers = getHarnessProviders().filter((provider) => provider.sessions?.discover)
    .sort((a, b) => (a.sessions?.discoveryOrder ?? Infinity) - (b.sessions?.discoveryOrder ?? Infinity));
  const harnesses = providers.map((provider) => provider.descriptor.id);
  const results = await Promise.allSettled(providers.map((provider) => provider.sessions!.discover(normalizedPath)));

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

  sessions.sort((a, b) => b.timestamp - a.timestamp);

  const posixSessions = sessions.map((session) => ({
    ...session,
    cwd: toPosixPath(session.cwd),
    ...(session.filePath ? { filePath: toPosixPath(session.filePath) } : {}),
  }));

  const discovery = { sessions: posixSessions, harnessStatus };
  // A partial scan can still populate history, but it must not turn into a cached empty scan.
  if (Object.values(harnessStatus).every((status) => status?.status === 'success')) {
    sessionCache.set(normalizedPath, { discovery, cachedAt: Date.now() });
    pruneSessionCache(Date.now());
  }
  return discovery;
}

export function buildSessionInvokeArgs(session: HarnessSession, fork = false, userFlags?: string): { spawnCmd: string; spawnArgs: string[] } {
  const launch = buildSessionCommand({ ...session, ...(session.filePath ? { filePath: toPosixPath(session.filePath) } : {}) }, { operation: fork ? 'fork' : 'resume', transport: 'local', userFlags });
  return resolveHarnessSpawn(launch.command, launch.args, ensureHarnessWrapperScript());
}
