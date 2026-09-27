/**
 * Canonical list of known harness IDs.
 *
 * Used by:
 * - Store defaults (main.ts): initialises harnessDefaults entries
 * - Validation (main/harnessDefaultsValidation.ts): strips unknown harness IDs
 *
 * New harnesses also need main/renderer catalogs and capability-specific adapters;
 * see docs/harness-integration.md.
 */
export const KNOWN_HARNESS_IDS = ['codex', 'opencode', 'pi', 'omp', 'claude'] as const;
export type HarnessId = typeof KNOWN_HARNESS_IDS[number];
