import type Store from 'electron-store';
import type { StoreSchema } from '../shared/types/store';
import { type WorkspaceNavigationMode } from '../shared/types/workspaceNavigation';
import { KNOWN_HARNESS_IDS } from '../shared/harnessIds';

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

/**
 * Sidebar became the default navigation mode, but installs that predate it were running the tab
 * strip and never stored a preference. Fresh vs existing cannot be read from store content:
 * electron-store (conf) merges `defaults` into the file on construction, so keys such as
 * `lastWorkspace` exist even on a brand-new install. The only durable signal is whether the backing
 * config file existed *before* the store was constructed, which the caller must capture.
 *
 * Call once at startup. An explicit stored value (valid or corrupt) is never touched; corrupt
 * values keep falling through to normalization (the default). Persisting the choice means this
 * decision is made exactly once, so later launches of an upgraded install cannot be mistaken for fresh.
 * Returns the mode that was seeded, or null when nothing changed.
 */
export function seedWorkspaceNavigationMode(
  store: Store<StoreSchema>,
  storeFileExistedBeforeOpen: boolean,
): WorkspaceNavigationMode | null {
  if (store.get('workspaceNavigationMode') !== undefined) return null;
  const mode: WorkspaceNavigationMode = storeFileExistedBeforeOpen ? 'tabs' : 'sidebar';
  store.set('workspaceNavigationMode', mode);
  return mode;
}

/**
 * Agent attention is opt-in per harness, but a brand-new install should start with it on.
 * Same fresh-vs-existing signal as `seedWorkspaceNavigationMode`: only a config file that did not
 * exist before the store was constructed counts as a first load. Existing installs are never
 * touched, because a stored `false` cannot be told apart from a deliberate opt-out. Later launches
 * see the file, so a user's own toggles are never overwritten.
 *
 * Call once at startup. Returns true when attention was seeded.
 */
export function seedHarnessAttention(
  store: Store<StoreSchema>,
  storeFileExistedBeforeOpen: boolean,
): boolean {
  if (storeFileExistedBeforeOpen) return false;
  const current = store.get('harnessDefaults') ?? {};
  store.set('harnessDefaults', Object.fromEntries(
    KNOWN_HARNESS_IDS.map((id) => [
      id,
      { ...(current[id] ?? { model: '', favorites: [], flags: '', visible: true }), attentionEnabled: true },
    ]),
  ));
  return true;
}
