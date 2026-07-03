/**
 * One-time migration: moves gate localStorage favorites into
 * electron-store harnessDefaults.
 *
 * Merge order (deterministic):
 *   1. Store favorites are preserved in their existing order
 *   2. Legacy-only favorites (not already in store) are appended
 *      in their legacy order
 *   3. No silent reshuffling
 *
 * Completion: sets a localStorage marker so this never re-runs.
 *
 * Failure: non-fatal. console.warn with error details.
 * Legacy key remains so migration can be retried on next launch.
 *
 * Timing: This runs in a React effect in App.tsx, which mounts after
 * app.whenReady() has completed and IPC handlers are registered.
 * See MR-3 in plan risk analysis.
 */

import type { HarnessDefaultsMap } from '../../shared/types/store';

const LEGACY_KEY = 'clanker-grid-model-favorites';
const MIGRATION_MARKER = 'clanker-grid-migration-harness-defaults';

export async function migrateLegacyFavorites(): Promise<void> {
  // Check completion marker — if set, this migration already ran
  if (localStorage.getItem(MIGRATION_MARKER) === '1') return;

  // Check legacy data — if absent, nothing to migrate; set marker and return
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (!legacy) {
    localStorage.setItem(MIGRATION_MARKER, '1');
    return;
  }

  try {
    const legacyFavorites = JSON.parse(legacy) as Record<string, unknown>;
    const currentDefaults = await window.electronAPI.getHarnessDefaults();

    const merged: HarnessDefaultsMap = { ...currentDefaults };

    for (const [harness, favs] of Object.entries(legacyFavorites)) {
      if (!Array.isArray(favs)) continue; // Skip malformed entries

      if (merged[harness]) {
        // Deterministic merge: store order preserved, legacy-only appended
        const storeFavs = new Set(merged[harness].favorites);
        for (const fav of favs) {
          if (typeof fav === 'string' && !storeFavs.has(fav)) {
            merged[harness].favorites.push(fav);
          }
        }
      } else {
        merged[harness] = {
          model: '',
          favorites: favs.filter((f): f is string => typeof f === 'string'),
          flags: '',
          visible: true,
        };
      }
    }

    await window.electronAPI.setHarnessDefaults(merged);

    // Set completion marker AFTER successful write
    localStorage.setItem(MIGRATION_MARKER, '1');
    console.info('[clanker-grid] Legacy favorites migrated to electron-store');
  } catch (err) {
    // Non-fatal but debuggable
    console.warn('[clanker-grid] Failed to migrate legacy favorites:', err);
    // Do NOT set marker — retry on next launch
    // Do NOT remove legacy key — preserve data for retry
  }
}
