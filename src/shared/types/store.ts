/**
 * Shared store schema types.
 *
 * This is the single canonical location for StoreSchema and related types.
 * All main-process files that need StoreSchema import from here.
 * The renderer accesses store data via IPC channels (getHarnessDefaults / setHarnessDefaults),
 * not by importing from this file directly.
 *
 * For electron-store use in the main process, import StoreSchema from this file
 * and use it as the type parameter: new Store<StoreSchema>({ ... }).
 *
 * When adding new store fields, update this file only.
 */

/**
 * AI commit provider — limited to 3 supported providers.
 * Inlined here to keep shared/types/ self-contained and avoid a main→shared import.
 * aiCommit.ts defines and exports its own AiCommitProvider for internal use.
 */
export type AiCommitProvider = 'codex' | 'opencode' | 'pi';

/**
 * Per-harness default settings.
 * Stored under harnessDefaults in electron-store.
 */
export interface HarnessDefaults {
  /** Default model ID. Empty string = harness picks its own default. */
  model: string;
  /** Pinned model IDs — used by UI pickers only, never at runtime. */
  favorites: string[];
  /** CLI flags string (e.g., "--yolo", "--pure"). */
  flags: string;
}

/** Map of harness ID → defaults. */
export type HarnessDefaultsMap = Record<string, HarnessDefaults>;

/** Top-level store schema. */
export interface StoreSchema {
  lastWorkspace: string;
  baseDirectory: string;
  aiCommitEnabled: boolean;
  aiCommitProvider: AiCommitProvider;
  aiCommitModel: string;
  harnessDefaults: HarnessDefaultsMap;
}
