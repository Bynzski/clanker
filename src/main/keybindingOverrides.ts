/**
 * Main-process source of truth for persisted keybinding overrides.
 *
 * Browser shortcuts run in main (`before-input-event`), so they cannot ask the
 * renderer per keystroke. This service validates what is stored, caches the
 * result, and is the only writer, keeping the cache coherent with the store.
 */

import type Store from 'electron-store';
import type { StoreSchema } from '../shared/types/store';
import {
  findAllConflicts,
  platformFromString,
  sanitizeKeybindingOverrides,
  type KeybindingOverrides,
} from '../shared/keybindings';

export class KeybindingOverridesService {
  private cache: KeybindingOverrides | null = null;

  constructor(
    private readonly getStore: () => Store<StoreSchema>,
    private readonly platform = platformFromString(process.platform),
  ) {}

  /** Validated overrides; untrusted store contents are never returned as-is. */
  get(): KeybindingOverrides {
    if (this.cache === null) {
      const store = this.getStore();
      const stored = sanitizeKeybindingOverrides(store.get('keybindingOverrides'));
      // Well-formed but ambiguous stored data fails closed: never pick a winner.
      if (findAllConflicts(stored, this.platform).length > 0) {
        store.delete('keybindingOverrides');
        this.cache = {};
      } else {
        this.cache = stored;
      }
    }
    return this.cache;
  }

  /** Validate and persist a complete override map. Rejects ambiguous configurations. */
  set(raw: unknown): { success: true; overrides: KeybindingOverrides } | { success: false; error: string } {
    const overrides = sanitizeKeybindingOverrides(raw);
    const conflicts = findAllConflicts(overrides, this.platform);
    if (conflicts.length > 0) {
      return { success: false, error: `Conflicting keybindings: ${conflicts[0][0]} and ${conflicts[0][1]}` };
    }
    const store = this.getStore();
    if (Object.keys(overrides).length === 0) {
      store.delete('keybindingOverrides');
    } else {
      store.set('keybindingOverrides', overrides);
    }
    this.cache = overrides;
    return { success: true, overrides };
  }
}
