/**
 * Validation helper for HarnessDefaultsMap payloads received from the renderer.
 *
 * Per product decision: SET_HARNESS_DEFAULTS is not a blind passthrough.
 * It validates harness IDs, field types, and rejects malformed payloads.
 *
 * This module is intentionally lightweight — no schema library, no versioning.
 * It guards against malformed renderer payloads without being brittle.
 */

import type { HarnessDefaults, HarnessDefaultsMap } from '../shared/types/store';

import { KNOWN_HARNESS_IDS } from '../shared/harnessIds';

/** Default entry — used to coerce incomplete/missing entries. */
const DEFAULT_ENTRY: HarnessDefaults = {
  model: '',
  favorites: [],
  flags: '',
};

/**
 * Validate and sanitize a HarnessDefaultsMap payload from the renderer.
 *
 * Rules:
 * - Rejects payloads that are not objects
 * - Strips keys that are not known harness IDs
 * - Validates each entry: model (string), favorites (string[]), flags (string)
 * - Coerces malformed entries to defaults
 * - Fills missing harness IDs with defaults
 *
 * Returns { valid, sanitized } or { valid, error }.
 */
export function validateHarnessDefaultsMap(
  payload: unknown,
): { valid: true; sanitized: HarnessDefaultsMap } | { valid: false; error: string } {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { valid: false, error: 'Payload must be a non-null object' };
  }

  const raw = payload as Record<string, unknown>;
  const sanitized: HarnessDefaultsMap = {};

  for (const key of Object.keys(raw)) {
    if (!(KNOWN_HARNESS_IDS as readonly string[]).includes(key)) {
      continue; // Strip unknown harness IDs
    }

    const entry = raw[key];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      sanitized[key] = { ...DEFAULT_ENTRY };
      continue;
    }

    const e = entry as Record<string, unknown>;
    sanitized[key] = {
      model: typeof e.model === 'string' ? e.model : '',
      favorites: Array.isArray(e.favorites)
        ? (e.favorites.filter((f): f is string => typeof f === 'string'))
        : [],
      flags: typeof e.flags === 'string' ? e.flags : '',
    };
  }

  // Ensure all known harness IDs are present
  for (const id of KNOWN_HARNESS_IDS) {
    if (!sanitized[id]) {
      sanitized[id] = { ...DEFAULT_ENTRY };
    }
  }

  return { valid: true, sanitized };
}
