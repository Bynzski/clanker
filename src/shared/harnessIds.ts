/**
 * Canonical list of known harness IDs.
 *
 * Used by:
 * - Store defaults (main.ts): initialises harnessDefaults entries
 * - Validation (main/harnessDefaultsValidation.ts): strips unknown harness IDs
 *
 * New harnesses register one descriptor and one main provider;
 * see docs/harness-integration.md.
 */
export const KNOWN_HARNESS_IDS = ['codex', 'opencode', 'pi', 'omp', 'claude', 'hermes', 'agy'] as const;
export type HarnessId = typeof KNOWN_HARNESS_IDS[number];
