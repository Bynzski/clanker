import type Store from 'electron-store';
import type { StoreSchema } from '../shared/types/store';

/**
 * Legacy `taskSessions` key. Workspace Tasks (#43) persisted a durable record
 * for every harness launch; the feature was removed from the product.
 */
export const LEGACY_TASK_SESSIONS_KEY = 'taskSessions';

/**
 * electron-store keeps unknown keys in the persisted JSON, so dropping a key
 * from StoreSchema alone would leave every stale task record on disk forever.
 * Delete the legacy key once at startup instead.
 *
 * Idempotent: a store that never had the key is left untouched.
 * Returns true when a legacy key was actually removed.
 */
export function purgeLegacyTaskSessions(store: Store<StoreSchema>): boolean {
  // The key is intentionally absent from StoreSchema, so it can only be
  // addressed through the untyped legacy surface.
  const legacyStore = store as unknown as {
    has(key: string): boolean;
    delete(key: string): boolean;
  };
  if (!legacyStore.has(LEGACY_TASK_SESSIONS_KEY)) return false;
  legacyStore.delete(LEGACY_TASK_SESSIONS_KEY);
  return true;
}
