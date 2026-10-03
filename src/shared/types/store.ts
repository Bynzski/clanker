import type { WorkspaceRecipe } from './recipes';
import type { SshEnvironmentConfig } from './environments';
import type { ThemeId } from './theme';
import type { WorkspaceNavigationMode } from './workspaceNavigation';
import type { KeybindingOverrides } from '../keybindings';
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
 * AI commit provider allowlist.
 * Inlined here to keep shared/types/ self-contained and avoid a main→shared import.
 * The canonical descriptor metadata supplies persisted and renderer IDs; main
 * derives its internal provider type from registered implementations.
 */
export type AiCommitProvider = import('../harnessDescriptors').AiCommitHarnessId;

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
  /** Whether this harness appears in launch/top-bar pickers. */
  visible: boolean;
  /** Opt in to per-turn attention signals for launches of this harness. */
  attentionEnabled?: boolean;
  /** Show this harness in the Usage panel (only meaningful for harnesses with a usage capability). Default true. */
  usageVisible?: boolean;
}

/** Map of harness ID → defaults. */
export type HarnessDefaultsMap = Record<string, HarnessDefaults>;

/** Persisted before host dispatch; released only after a definite host result. */
export interface RemoteWorktreeRemovalRecord {
  operationId: string;
  environmentId: string;
  resourceId: string;
  workspacePath: string;
  worktreePath: string;
}

/** Top-level store schema. */
export interface StoreSchema {
  theme: ThemeId;
  workspaceNavigationMode?: WorkspaceNavigationMode;
  workspaceSidebarWidth?: number;
  /** Last non-collapsed sidebar width, kept while the rail is shown so Expand can restore it. */
  workspaceSidebarExpandedWidth?: number;
  lastWorkspace: string;
  baseDirectory: string;
  aiCommitEnabled: boolean;
  aiCommitProvider: AiCommitProvider;
  aiCommitModel: string;
  harnessDefaults: HarnessDefaultsMap;
  workspaceRecipes: WorkspaceRecipe[];
  sshEnvironments: SshEnvironmentConfig[];
  remoteWorktreeRemovals?: RemoteWorktreeRemovalRecord[];
  /** Only deviations from the keybinding registry defaults; absent command = default, null = unbound. */
  keybindingOverrides?: KeybindingOverrides;
}
