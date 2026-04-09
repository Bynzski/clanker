/**
 * Model Discovery Cache
 *
 * Persists harness model lists to electron-store with TTL support.
 * Prevents re-running CLI discovery commands (6s timeout each) on every app restart.
 *
 * per S3.1.
 */

import Store from 'electron-store';
import type { ModelOption } from './harnessCatalog';

/** Default TTL for cached model lists: 1 hour in milliseconds. */
export const DEFAULT_MODEL_CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
  /** Serialised model list. */
  models: ModelOption[];
  /** Unix timestamp (ms) when this entry was written. */
  cachedAt: number;
}

interface ModelCacheSchema {
  models: Record<string, CacheEntry>;
}

/**
 * In-memory interface for the model cache.
 * Implementations can be in-memory (for tests) or persisted via electron-store.
 */
export interface ModelCache {
  /**
   * Retrieve cached models for a harness, or null if missing or expired.
   * @param harness  Harness identifier (e.g. 'codex', 'pi')
   * @param ttlMs   Maximum age in ms before the entry is considered stale
   * @returns Cached models, or null if not present or stale
   */
  get(harness: string, ttlMs: number): ModelOption[] | null;

  /**
   * Persist a model list for a harness with the current timestamp.
   * @param harness  Harness identifier
   * @param models  Array of model options to cache
   */
  set(harness: string, models: ModelOption[]): void;
}

/** In-memory cache for unit testing. */
export class InMemoryModelCache implements ModelCache {
  private readonly store = new Map<string, CacheEntry>();

  get(harness: string, ttlMs: number): ModelOption[] | null {
    const entry = this.store.get(harness);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > ttlMs) return null;
    return entry.models;
  }

  set(harness: string, models: ModelOption[]): void {
    this.store.set(harness, { models, cachedAt: Date.now() });
  }
}

/**
 * Persistent model cache backed by electron-store.
 * Entries are stored with a timestamp and automatically expire after ttlMs.
 */
export class ElectronStoreModelCache implements ModelCache {
  private readonly store: Store<ModelCacheSchema>;

  constructor() {
    this.store = new Store<ModelCacheSchema>({
      name: 'model-cache',
      defaults: { models: {} },
    });
  }

  get(harness: string, ttlMs: number): ModelOption[] | null {
    const allEntries = this.store.get('models');
    const entry = allEntries?.[harness];
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > ttlMs) return null;
    return entry.models;
  }

  set(harness: string, models: ModelOption[]): void {
    const allEntries = this.store.get('models') ?? {};
    allEntries[harness] = { models, cachedAt: Date.now() };
    this.store.set('models', allEntries);
  }
}
