/**
 * Canonical list of known harness IDs.
 *
 * Used by:
 * - Store defaults (main.ts): initialises harnessDefaults entries
 * - HARNESS_FLAG_MAP (renderer/lib/harnessFlags.ts): maps harness → known boolean flag
 * - Validation (main/harnessDefaultsValidation.ts): strips unknown harness IDs
 *
 * Adding a new harness requires updating this file only.
 */
export const KNOWN_HARNESS_IDS = ['codex', 'opencode', 'pi', 'claude'] as const;
export type HarnessId = typeof KNOWN_HARNESS_IDS[number];
