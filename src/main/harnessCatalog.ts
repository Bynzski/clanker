import { HarnessCapabilityError, classifyHarnessFailure } from './harnesses/types';
import { findHarnessProvider, getHarnessProviders } from './harnesses/registry';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { type HarnessConfig } from './harnessLaunch';
import {
  ElectronStoreModelCache,
  DEFAULT_MODEL_CACHE_TTL_MS,
} from './modelCache';
import { userCliBinPaths } from './platformShell';

// Module-level singleton for persistent model cache
const persistentModelCache = new ElectronStoreModelCache();
// Successful explicit refreshes invalidate older nonblocking Hermes warmups.
const catalogEpochs = new Map<string, number>();

export interface ModelOption {
  id: string;
  label: string;
}

/** Compatibility catalog derived from the canonical providers. */
export const HARNESS_OPTIONS: Record<string, HarnessConfig> = Object.fromEntries(
  getHarnessProviders().map(({ descriptor, launch }) => [descriptor.id, {
    command: launch.command, args: launch.args, modelArg: launch.modelArg,
    ...(launch.env ? { env: launch.env } : {}), name: descriptor.name, icon: descriptor.legacyIcon,
  }]),
);

export { normalizeModelLine } from './harnesses/modelParsing';
export { parsePiModels } from './harnesses/pi/models';
export { parseOpenCodeModels } from './harnesses/opencode/models';
export { parseAgyModels } from './harnesses/agy/models';
export { parseOmpModels } from './harnesses/omp/models';
export { parseCodexDebugModels } from './harnesses/codex/models';
export { parseHermesModelOptions } from './harnesses/hermes/models';

interface DiscoveryResult {
  models: ModelOption[];
  discovered: boolean;
  failure?: HarnessCapabilityError;
}

export async function discoverHarnessModelsDetailed(harness: string, refresh = false): Promise<DiscoveryResult> {
  const capability = findHarnessProvider(harness)?.models;
  if (!capability) return { models: [], discovered: false, failure: new HarnessCapabilityError('unsupported', `${harness} model discovery is not supported`) };
  try {
    return { models: await capability.discover(refresh), discovered: true };
  } catch (error) {
    return { models: capability.fallback ?? [], discovered: false, failure: classifyHarnessFailure(error) };
  }
}

export async function discoverHarnessModels(harness: string, refresh = false): Promise<ModelOption[]> {
  // Only an explicit Hermes refresh bypasses the TTL. Retain even an expired
  // catalog if a transient gateway failure prevents replacing it.
  const explicitRefresh = findHarnessProvider(harness)?.models?.explicitRefresh === true && refresh === true;
  const cached = persistentModelCache.get(
    harness,
    explicitRefresh ? Number.POSITIVE_INFINITY : DEFAULT_MODEL_CACHE_TTL_MS
  );
  if (cached && !explicitRefresh) {
    // Fire-and-forget background refresh to keep cache fresh for next launch
    refreshCacheSilently(harness);
    return cached;
  }

  const config = HARNESS_OPTIONS[harness];
  if (!config) {
    return [];
  }

  const { models, discovered } = await discoverHarnessModelsDetailed(harness, explicitRefresh);
  const result = discovered
    ? models
    : (cached ?? (models.length > 0 ? models : (findHarnessProvider(harness)?.models?.fallback ?? [])));

  if (discovered) {
    // Persist only successful discovery results so a transient failure cannot
    // replace a good cache entry with fallback data.
    if (explicitRefresh) catalogEpochs.set(harness, (catalogEpochs.get(harness) ?? 0) + 1);
    persistentModelCache.set(harness, result);
  }

  return result;
}

/**
 * Kick off a silent background refresh of the model cache for a harness.
 * Results are persisted to disk so the next launch gets fresh data instantly.
 * Errors are silently ignored — fallback models are always available.
 */
function refreshCacheSilently(harness: string): void {
  const config = HARNESS_OPTIONS[harness];
  if (!config) return;

  const epoch = catalogEpochs.get(harness) ?? 0;
  // Run discovery async without blocking
  discoverHarnessModelsDetailed(harness)
    .then(({ models, discovered }) => {
      if (discovered && epoch === (catalogEpochs.get(harness) ?? 0)) {
        persistentModelCache.set(harness, models);
      }
    })
    .catch(() => {
      // Silently ignore background refresh failures
    });
}

function isCommandAvailable(command: string): boolean {
  const homeDir = app.getPath('home');
  const searchPaths = new Set<string>([
    process.cwd(),
    path.join(process.cwd(), 'node_modules', '.bin'),
    app.getAppPath(),
    path.join(app.getAppPath(), 'node_modules', '.bin'),
    ...userCliBinPaths(homeDir),
    ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean),
  ]);

  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT?.split(';').filter(Boolean) ?? ['.EXE', '.CMD', '.BAT', '.COM'])
    : [''];
  const candidates = path.extname(command) ? [command] : [command, ...extensions.map((ext) => `${command}${ext}`)];

  for (const searchPath of searchPaths) {
    for (const candidate of candidates) {
      const fullPath = path.isAbsolute(candidate) ? candidate : path.join(searchPath, candidate);
      try {
        fs.accessSync(fullPath, fs.constants.X_OK);
        return true;
      } catch {
        // continue searching
      }
    }
  }

  return false;
}

export function getAvailableHarnessOptions() {
  return Object.fromEntries(
    Object.entries(HARNESS_OPTIONS).filter(([, config]) => isCommandAvailable(config.command))
  );
}

// Re-export cache types for consumers
export type { ModelCache } from './modelCache';
export { InMemoryModelCache } from './modelCache';
