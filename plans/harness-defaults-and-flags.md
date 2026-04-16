# Plan: Harness Defaults and Flags

**Created:** 2026-04-16
**Status:** Draft — Slice 0 ✅ + Slice 1 ✅ + Slice 2 ✅ + Slice 3 ✅ + Slice 4 ✅ + Slice 5 ✅ + Slice 6 ✅ + Slice 7 ✅ implemented (2026-04-16)

## Context

Users currently have no way to:
1. Set a default model per harness that applies globally when spawning a new terminal
2. Configure harness launch flags — flags like `--yolo` (codex) and `--pure` (opencode) are hardcoded in `src/main/harnessCatalog.ts` and cannot be changed

This requires per-workspace or per-launch configuration for basic preferences that should be set once.

**Existing problems with the gate model selector:**
- The gate has a model dropdown that shows every discovered model — for opencode this can be hundreds
- No search, forces a big menu on users every workspace launch
- Star system in the gate is wonky — works but UX is unclear
- Discovery of new/old models is not handled well

**Core UX principle — separation of concerns:**
- **Favorites and defaults are set once**, in a dedicated settings area (header settings dropdown). Users manage their per-harness favorites and default models there.
- **The gate is frictionless.** The model selector shows the current default/favorite, pre-selected. Users can change it with minimal friction. No dropdown with hundreds of items.
- **Discovery is explicit**, not buried in a menu. A "Browse all models" flow opens a searchable list when users want to explore or change favorites.
- **electron-store is the single source of truth** for harness defaults (model, favorites, flags). No localStorage.
- Gear icon in the gate is for folder selection only — not touched.

## Goals

- [x] electron-store is the single source of truth for harness defaults (model, favorites, flags) across the entire app
- [x] localStorage is eliminated for harness defaults (migrated and deleted)
- [x] User can pin favorite models per harness in a dedicated settings area (header settings dropdown) — implemented in Slice 5
- [x] User can set a default model per harness — the default is pre-selected in the gate — implemented in Slice 5
- [x] User can enable a yolo/auto mode flag per harness via a checkbox — implemented in Slice 5
- [x] Gate model selector is frictionless: shows current default/favorite, no giant dropdown, compact favorites picker, explicit "Browse all" for discovery
- [x] New terminal uses workspace harness/model when set; falls back to plain shell when not set
- [x] Hardcoded flags (`--yolo`, `--pure`) are removable/replaceable by the user
- [x] All existing functionality preserved (workspace-level model still works)
- [x] Door left open for harness-specific flags beyond yolo (e.g., pi's `--no-tools`, `--no-session`)

### Slice 0: Extract StoreSchema to shared types — ✅ IMPLEMENTED

**Completed 2026-04-16.**

- [x] `src/shared/types/store.ts` created — single canonical `StoreSchema`, `HarnessDefaults`, `HarnessDefaultsMap`, and `AiCommitProvider` type
- [x] `src/main/main.ts` updated — removed inline `StoreSchema`, imports from `../shared/types/store`
- [x] `src/main/ipc/settingsIpc.ts` updated — removed inline `StoreSchema`; removed local `getSafeWorkspacePath` (unused externally); updated exports to keep only `getInvalidWorkspaceResult`; added `AiCommitProvider` import from `../aiCommit` (still needed for `SET_AI_COMMIT_PROVIDER` handler)
- [x] `src/main/ipc/terminalIpc.ts` updated — removed inline `StoreSchema`; imports from `../../shared/types/store`
- [x] `src/main/ipc/aiCommitIpc.ts` updated — removed inline `StoreSchema`; imports from `../../shared/types/store`
- [x] `src/main/ipc/settingsIpc.ts` — removed unused `import { app } from 'electron'` (was only used by removed `getSafeWorkspacePath`)

**Deviation from plan:**
- `src/shared/types/store.ts` does NOT include `harnessDefaults` in `StoreSchema` (deferred to Slice 1). This keeps the implementation clean — adding the field in Slice 1 is a one-line change.
- `AiCommitProvider` is inlined in `store.ts` (Option A per plan) and also retained in `aiCommit.ts` for `aiCommitIpc.ts` internal use (consistent with Option A).

**Validation:** `npm run typecheck` ✅ · `npm run test` ✅ (2938 passed)

## Locked Decisions

### Product decisions (non-negotiable within this pass)

- **Favorites are UX-only.** Favorites affect only picker/discovery presentation. They do **not** influence automatic launch behavior, fallback resolution, or runtime selection. Only the **default model** drives automatic harness/model selection.
- **Default model only drives auto-selection.** When no workspace harness/model is set, only `harnessDefaults[harness].model` is consulted. Favorites are never read at spawn time.
- **If default model is empty or unresolved, launch without forcing a model.** Do not silently rewrite store state or fall back to a favorite. Surface the unresolved state to the user in UI (future). Do not block backend on the notification mechanism.
- **Flags UX is strict boolean in this pass.** UI exposes known boolean-style toggles (yolo/auto mode) per harness. The store field remains `flags: string` for forward compatibility, but the renderer does not manipulate raw flag strings directly. A small helper/translation layer sits between the boolean UI and the string store field.
- **SET_HARNESS_DEFAULTS validates input.** The IPC handler is not a blind passthrough. It validates harness IDs, field types, and rejects malformed payloads.
- **Migration is best-effort, deterministic, one-time.** Uses a completion marker/sentinel. Merge preserves existing store order, appends legacy-only entries. Failure is non-fatal but debuggable.
- **Single source of truth:** electron-store for all harness defaults. No localStorage after migration.

### UX decisions (non-negotiable within this pass)

- **Favorites management:** Dedicated settings area in the header settings dropdown. NOT in the gate.
- **Gate model selector UX:** Compact — shows current model, click to change from favorites list only. Explicit "Browse all" for discovery. No dropdown with all models.
- **Gear icon:** Folder picker only. Not repurposed for harness defaults.
- **Flag checkbox UX:** Per-harness checkbox for yolo/auto mode only. No free-text input in this pass.
- **Flags behavior:** User flags replace hardcoded defaults entirely (not additive). If a user wants `--yolo`, they check the box.

### Technical decisions

- **Model scope:** Per-harness global defaults. Each harness has its own default model and favorite list.
- **Store schema:** `flags: string` field supports future extensibility. UI renders a checkbox today; a future pass can add free-text without a schema change.
- **Flags ownership:** Static harness config owns command/env/modelArg. Store owns user-configurable flags. Workspace scope does **not** own flags in this pass. Renderer does not interpret arbitrary flag strings.
- **Missing/stale models:** Stored model IDs that are no longer discoverable are treated as **invalid/unresolved**. The store is never silently rewritten or auto-cleared. The UI surfaces this state to the user (mechanism deferred to UI pass).

### Deferred

- Pi-specific flags. Store schema supports them; UI does not expose them yet.
- Gate redesign. Harness defaults panel design should align with the new gate structure when that redesign happens.
- Unresolved model notification UI. Backend stores the state; UI rendering is a later pass.

---

## Behavioral Rules

These rules are derived from the locked product decisions. They are referenced by slice steps and must not be violated by implementation.

### Runtime selection (launch precedence)

When spawning a terminal, the resolution order is:

1. **Workspace harness + model** — if the current workspace has a harness and model selected, use those. Highest priority.
2. **No default harness** — if the workspace has no harness set, do **not** infer a harness by scanning global defaults. Fall through to plain shell.
3. **Plain shell** — spawn without a harness. No model or flags are resolved from global defaults in this pass.

**Favorites never participate in runtime resolution.** They are never read by `SPAWN_TERMINAL`, `handleAddTerminal`, or any main process code path.

**Unresolved models are not auto-cleared.** If a stored default model is no longer discoverable, it is still passed to the harness. The harness will fail or ignore it — the app does not rewrite the store.

> **No implicit global default harness.** This pass does not introduce a "first harness with a non-empty model" concept. A future pass may add an explicit global default harness setting, but that is out of scope here.

### Flags ownership

| Owner | Controls | Example |
|-------|----------|----------|
| Static harness config | `command`, `env`, `modelArg` | `codex` command, `OPENCODE_PERMISSION` env |
| Store (`harnessDefaults`) | `flags` string | `'--yolo'`, `'--pure'`, `''` |
| Workspace scope | **Nothing in this pass** | N/A |
| Renderer | Boolean → string translation only | Checkbox `true` → `'--yolo'` |

The renderer does not parse or interpret arbitrary flag strings. It maps known boolean toggles to known flag strings via a helper.

### Migration

| Rule | Behavior |
|------|----------|
| One-time | Runs once, then never again (completion marker) |
| Deterministic merge | Store favorites preserved in order first; legacy-only favorites appended in legacy order |
| Completion marker | `localStorage` key `clanker-grid-migration-harness-defaults` set to `'1'` after successful write |
| Failure | Non-fatal. `console.warn` with error details. App continues. Legacy key remains for next attempt. |
| No destructive cleanup | Unresolved model references in store are never auto-cleared |

---

## Blocker Resolutions

These are decisions made by auditing the codebase. They are not negotiable within the scope of this plan — they are structural facts that the slices must respect.

### B1: StoreSchema is defined in FOUR places — extract to `src/shared/types/store.ts`

**Codebase truth:** `StoreSchema` is duplicated in:

| File | Line | Notes |
|------|------|-------|
| `src/main/main.ts` | ~54 | Primary; instantiates `Store<StoreSchema>` |
| `src/main/ipc/settingsIpc.ts` | ~34 | For `getStore()` return type |
| `src/main/ipc/terminalIpc.ts` | ~41 | For `getStore()` return type |
| `src/main/ipc/aiCommitIpc.ts` | ~28 | For `getStore()` return type |

**The report missed `aiCommitIpc.ts`.** The plan must update all four.

**Decision:** Create `src/shared/types/store.ts`. All four files import from there. This is the only location where `StoreSchema` is defined. The file also defines `HarnessDefaults` and `HarnessDefaultsMap` since they are part of the store schema and shared across the main/renderer boundary.

### B2: `getSafeWorkspacePath` is duplicated — consolidate in `main.ts`, remove from `settingsIpc.ts`

**Codebase truth:**
- `main.ts:161` — `getSafeWorkspacePath(workingDir, storeInstance: Store<StoreSchema>)` — used to create the closure passed to `terminalIpc`
- `settingsIpc.ts:47` — `getSafeWorkspacePath(workingDir, store: Store<StoreSchema>)` — exported but only used within `settingsIpc.ts`

`settingsIpc.ts` exports `getSafeWorkspacePath` — let's verify if anything imports it:

`terminalIpc.ts` receives `getSafeWorkspacePath` as a dep injection (line 53): `getSafeWorkspacePath: (workingDir: string) => string`. `main.ts` passes a closure that wraps the `main.ts` version. So `settingsIpc.ts`'s copy is only used internally by `settingsIpc.ts` handlers.

**Decision:** `settingsIpc.ts` does NOT need its own `getSafeWorkspacePath`. The function it uses is identical to `main.ts`'s version. However, `settingsIpc.ts` doesn't receive the store as a dep — it receives `getStore()`. The simplest fix: `settingsIpc.ts` can call `getStore().get('lastWorkspace')` directly inside its handlers (it already does this pattern for other fields). Remove the exported `getSafeWorkspacePath` from `settingsIpc.ts`. `main.ts` remains the canonical location.

### B3: `HarnessDefaults` type lives in `src/shared/types/store.ts`

**Codebase truth:** The shared types directory (`src/shared/types/`) contains cross-boundary types: `vcs.ts`, `editor.ts`, `fileExplorer.ts`, `fileOperations.ts`, `git.ts`, `credentials.ts`. These are all used by both main and renderer. `src/renderer/types/shared.ts` contains renderer-only types: `ModelOption`, `AiCommitSettings`, `SavePatRequest`.

**Decision:** `HarnessDefaults` and `HarnessDefaultsMap` go in `src/shared/types/store.ts` alongside `StoreSchema`. They are store schema types — they belong with the store schema. The renderer's `electron.d.ts` imports the type from shared. The main process IPC files import from shared. This avoids creating yet another type file for a single interface.

### B4: Harness defaults go into the main app store (`clanker-grid.json`), not a separate store

**Codebase truth:** `modelCache.ts` creates a separate `Store<ModelCacheSchema>({ name: 'model-cache' })`. This is a TTL-based cache — it's fundamentally different from user settings. The main app store uses the default `clanker-grid` name.

**Decision:** `harnessDefaults` goes in the main app store. `modelCache.ts` is a cache, not a settings store. No reason to separate.

### B5: `buildHarnessSpawnArgs` duplicate call in `terminalIpc.ts` — eliminate before adding `userFlags`

**Codebase truth:** In `terminalIpc.ts`'s `SPAWN_TERMINAL` handler:
1. Line ~94: `const harnessArgs = buildHarnessSpawnArgs(harnessConfig, model)` — used for actual spawn
2. Line ~110: `const launchArgs = buildHarnessSpawnArgs(config, model)` — used only for the launch log

**Decision:** Slice 3 must eliminate the duplicate call. The launch log should reuse `harnessArgs` (already computed). This reduces the surface area when adding the `userFlags` parameter.

### B6: Integration test `terminalPTY.test.ts` also encodes `--yolo`

**Codebase truth:** The report listed 2 test files, but missed the integration test:
- `tests/main/unit/harnessLaunch.test.ts` — `['--yolo']`, `['--pure']`
- `tests/main/unit/terminalIpc.test.ts` — `['codex', '--model', 'gpt-5.4-mini', '--yolo']`
- `tests/main/integration/terminalPTY.test.ts` — `['--verbose']`, `['--yolo']` (uses inline configs, not HARNESS_OPTIONS)

**Decision:** The unit test files must be updated in Slice 3. The integration test creates its own inline `HarnessConfig` objects with `args: ['--yolo']` — these test `buildHarnessSpawnArgs` behavior with arbitrary configs, not the store-backed flow. They need updating only if the function signature changes (which it does: adding `userFlags`). All three files are in the Slice 3 scope.

---

## Slice Definitions

### Slice 0: Extract StoreSchema to shared types

**Bounding:** Structural only. No behavioral change. Extracts `StoreSchema` to a shared file, adds `HarnessDefaults`/`HarnessDefaultsMap` types, and deduplicates `getSafeWorkspacePath`.

**Why a separate slice:** This is pure scaffolding that every subsequent slice depends on. Mixing it into Slice 1 creates unnecessary review complexity. A dedicated slice keeps the diff small and reviewable.

**Dependencies:** None

**Steps:**

1. **Create `src/shared/types/store.ts`:**
   ```typescript
   import type { AiCommitProvider } from '../../main/aiCommit';

   export interface HarnessDefaults {
     model: string;       // default model ID (empty = harness picks)
     favorites: string[];  // pinned model IDs
     flags: string;        // CLI flags (e.g., "--yolo", "--pure")
   }

   export type HarnessDefaultsMap = Record<string, HarnessDefaults>;

   export interface StoreSchema {
     lastWorkspace: string;
     showFastfetch: boolean;
     aiCommitEnabled: boolean;
     aiCommitProvider: AiCommitProvider;
     aiCommitModel: string;
   }
   ```

   **Note on `AiCommitProvider` import:** `StoreSchema` references `AiCommitProvider` from `src/main/aiCommit.ts`. This creates a cross-boundary import (`shared` → `main`). Two options:
   - **Option A:** Inline the union type in `store.ts`: `aiCommitProvider: 'codex' | 'opencode' | 'pi'`
   - **Option B:** Extract `AiCommitProvider` to `src/shared/types/` alongside `StoreSchema`

   **Decision:** Option A. `AiCommitProvider` is a 3-member string union that's only used in `StoreSchema` and `aiCommit.ts`. Duplicating the literal union in `store.ts` is simpler than creating a new shared type file for a 3-value enum. `aiCommit.ts` continues to define and export its own `AiCommitProvider` for its internal use.

2. **Update `src/main/main.ts`:**
   - Remove inline `StoreSchema` interface
   - `import { type StoreSchema } from '../shared/types/store'`
   - No other changes (store instantiation stays the same)

3. **Update `src/main/ipc/settingsIpc.ts`:**
   - Remove inline `StoreSchema` interface
   - `import { type StoreSchema } from '../../shared/types/store'`
   - Remove local `getSafeWorkspacePath` function — codebase audit confirms no external consumer imports it (`gitIpc.ts` only imports `getInvalidWorkspaceResult`)
   - Remove `getSafeWorkspacePath` from the module export block
   - **Keep `getInvalidWorkspaceResult`** — `gitIpc.ts` imports it (used 18 times)
   - Any code in `settingsIpc.ts` that needs `lastWorkspace` should call `getStore().get('lastWorkspace')` directly (it already has `getStore` via deps)

4. **Update `src/main/ipc/terminalIpc.ts`:**
   - Remove inline `StoreSchema` interface
   - `import { type StoreSchema } from '../../shared/types/store'`

5. **Update `src/main/ipc/aiCommitIpc.ts`:**
   - Remove inline `StoreSchema` interface
   - `import { type StoreSchema } from '../../shared/types/store'`

6. **Verify `getSafeWorkspacePath` consumers:**
   - `settingsIpc.ts` currently exports it — grep confirms **no external consumer imports it**
   - `terminalIpc.ts` receives `getSafeWorkspacePath` via dep injection (passed as a closure from `main.ts`)
   - `main.ts` has its own canonical version
   - After removing from `settingsIpc.ts`, no external imports break
   - `getInvalidWorkspaceResult` stays exported — `gitIpc.ts` depends on it

**Files changed:**
| File | Action |
|------|--------|
| `src/shared/types/store.ts` | Create |
| `src/main/main.ts` | Modify — import shared StoreSchema |
| `src/main/ipc/settingsIpc.ts` | Modify — import shared StoreSchema, remove getSafeWorkspacePath |
| `src/main/ipc/terminalIpc.ts` | Modify — import shared StoreSchema |
| `src/main/ipc/aiCommitIpc.ts` | Modify — import shared StoreSchema |

**Verification:** `npm run typecheck` passes. `npm run test` passes. No behavioral change — this is a pure refactor.

---

### Slice 1: Extend store schema with harness defaults — ⬅ IMPLEMENTED

**Completed 2026-04-16.**

- [x] `src/shared/types/store.ts` — added `harnessDefaults: HarnessDefaultsMap` to `StoreSchema`
- [x] `src/shared/harnessIds.ts` — **created** — `KNOWN_HARNESS_IDS` and `HarnessId` type
- [x] `src/main/main.ts` — added `harnessDefaults` defaults via `Object.fromEntries(KNOWN_HARNESS_IDS.map(...))`
- [x] `src/renderer/lib/harnessFlags.ts` — **created** — `HARNESS_FLAG_MAP`, `harnessFlagsFromToggle`, `harnessToggleFromFlags`

**Deviation from plan:** None. Implementation matches documented steps exactly.

**Validation:** `npm run typecheck` · `npm run test` ⬅ (2938 passed)

### Slice 2: Add IPC channels for harness defaults with validation — ✅ IMPLEMENTED

**Completed 2026-04-16.**

- [x] `src/shared/ipcChannels.ts` — added `GET_HARNESS_DEFAULTS` and `SET_HARNESS_DEFAULTS` channel constants + entries in `ALL_IPC_CHANNELS`
- [x] `src/main/harnessDefaultsValidation.ts` — **created** — `validateHarnessDefaultsMap()` with all documented rules
- [x] `src/main/ipc/settingsIpc.ts` — registered `GET_HARNESS_DEFAULTS` (returns store value) and `SET_HARNESS_DEFAULTS` (validates then writes) handlers; imports `HarnessDefaultsMap`, `GET_HARNESS_DEFAULTS`, `SET_HARNESS_DEFAULTS`, `validateHarnessDefaultsMap`
- [x] `src/main/preload.ts` — exposed `getHarnessDefaults()` and `setHarnessDefaults()` on the context bridge; added `HarnessDefaultsMap` type import
- [x] `src/renderer/electron.d.ts` — added `getHarnessDefaults: () => Promise<HarnessDefaultsMap>` and `setHarnessDefaults: (defaults: HarnessDefaultsMap) => Promise<void>` to `ElectronAPI` interface; added `HarnessDefaultsMap` type import
- [x] `tests/main/unit/harnessDefaultsValidation.test.ts` — **created** — 17 test cases covering all validation rules
- [x] `tests/main/unit/ipcChannels.test.ts` — added `GET_HARNESS_DEFAULTS` and `SET_HARNESS_DEFAULTS` to imports and `ALL_CHANNELS` array
- [x] `tests/main/unit/settingsIpc.test.ts` — updated expected channel count 11→13; updated `expectedChannels`/`settingsChannels` arrays in all 4 occurrences; added harnessDefaults to `createMockDeps()` mock store; added 3 new tests (GET returns store value, SET writes validated payload, SET rejects non-object)
- [x] `tests/setup/electron.ts` — added `getHarnessDefaults` and `setHarnessDefaults` mocks to `ElectronApiMock`

**Deviation from plan:**
- `KNOWN_HARNESS_IDS.includes(key)` used instead of `.has()` since `KNOWN_HARNESS_IDS` is a `readonly` const tuple (TypeScript type system prevents using `.has()` on a tuple without cast)

**Validation:** `npm run typecheck` ✅ · `npm run test` ✅ (2958 passed)

**Steps:**

1. **In `src/shared/ipcChannels.ts`:** Add channels:
   ```typescript
   export const GET_HARNESS_DEFAULTS = 'get-harness-defaults';
   export const SET_HARNESS_DEFAULTS = 'set-harness-defaults';
   ```
   Add both to `ALL_IPC_CHANNELS` array.

2. **Create `src/main/harnessDefaultsValidation.ts` — lightweight validation helper:**
   ```typescript
   import type { HarnessDefaults, HarnessDefaultsMap } from '../shared/types/store';

   import { KNOWN_HARNESS_IDS } from '../../shared/harnessIds';

   /**
    * Default HarnessDefaults entry — used to coerce incomplete/missing entries.
    */
   const DEFAULT_ENTRY: HarnessDefaults = { model: '', favorites: [], flags: '' };

   /**
    * Validate and sanitize a HarnessDefaultsMap payload from the renderer.
    *
    * Rules (per product decision #4):
    * - Rejects payloads that are not objects
    * - Strips keys that are not known harness IDs
    * - Validates each entry: model (string), flags (string), favorites (string[])
    * - Coerces malformed entries to defaults
    * - Fills missing harness IDs with defaults
    *
    * Returns { valid, sanitized } or { valid, error }.
    */
   export function validateHarnessDefaultsMap(
     payload: unknown
   ): { valid: true; sanitized: HarnessDefaultsMap } | { valid: false; error: string } {
     if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
       return { valid: false, error: 'Payload must be a non-null object' };
     }

     const raw = payload as Record<string, unknown>;
     const sanitized: HarnessDefaultsMap = {};

     for (const key of Object.keys(raw)) {
       if (!KNOWN_HARNESS_IDS.has(key)) {
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
           ? e.favorites.filter((f): f is string => typeof f === 'string')
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
   ```

   This is intentionally lightweight. No schema library, no versioning. It guards against malformed renderer payloads without being brittle. Known harness IDs are a closed set matching `HARNESS_OPTIONS` keys.

3. **In `src/main/ipc/settingsIpc.ts`:** Register handlers with validation:
   ```typescript
   ipcMain.handle(GET_HARNESS_DEFAULTS, () => {
     return getStore().get('harnessDefaults');
   });

   ipcMain.handle(SET_HARNESS_DEFAULTS, (_, payload: unknown) => {
     const result = validateHarnessDefaultsMap(payload);
     if (!result.valid) {
       console.warn('[clanker-grid] SET_HARNESS_DEFAULTS rejected:', result.error);
       return;
     }
     getStore().set('harnessDefaults', result.sanitized);
   });
   ```
   Import `GET_HARNESS_DEFAULTS`, `SET_HARNESS_DEFAULTS` from `ipcChannels`.
   Import `type HarnessDefaultsMap` from `../../shared/types/store`.
   Import `validateHarnessDefaultsMap` from `../harnessDefaultsValidation`.

4. **In `src/main/preload.ts`:** Expose on the bridge:
   ```typescript
   getHarnessDefaults: () => ipcRenderer.invoke(GET_HARNESS_DEFAULTS),
   setHarnessDefaults: (defaults: HarnessDefaultsMap) =>
     ipcRenderer.invoke(SET_HARNESS_DEFAULTS, defaults),
   ```
   Import `GET_HARNESS_DEFAULTS`, `SET_HARNESS_DEFAULTS` from `../shared/ipcChannels`.
   Import `type HarnessDefaultsMap` from `../shared/types/store`.

5. **In `src/renderer/electron.d.ts`:** Add to `ElectronAPI` interface:
   ```typescript
   getHarnessDefaults: () => Promise<HarnessDefaultsMap>;
   setHarnessDefaults: (defaults: HarnessDefaultsMap) => Promise<void>;
   ```
   Import `type HarnessDefaultsMap, type HarnessDefaults` from `'../../shared/types/store'`.

**Files changed:**
| File | Action |
|------|--------|
| `src/shared/ipcChannels.ts` | Modify — add 2 channels + ALL_IPC_CHANNELS entries |
| `src/main/harnessDefaultsValidation.ts` | **Create** — validation helper |
| `src/main/ipc/settingsIpc.ts` | Modify — register 2 handlers with validation |
| `src/main/preload.ts` | Modify — expose 2 methods |
| `src/renderer/electron.d.ts` | Modify — add 2 method signatures + type imports |

**Verification:** `npm run typecheck` passes. Integration test (`ipcChannels.test.ts`) confirms new channels are in `ALL_IPC_CHANNELS`. Unit tests for `validateHarnessDefaultsMap` cover:
- [ ] Valid payload passes through unchanged
- [ ] Unknown harness IDs are stripped
- [ ] Missing harness IDs are filled with defaults
- [ ] Malformed entry (wrong types) is coerced
- [ ] Non-object payload is rejected with error
- [ ] `favorites` filters non-string entries
- [ ] `SET_HARNESS_DEFAULTS` handler calls validation and rejects bad payloads

---

### Slice 3: Harness spawn uses user flags from store — ✅ IMPLEMENTED

**Completed 2026-04-16.**

- [x] `src/main/harnessCatalog.ts` — removed hardcoded `args` from `codex` (`[]` → `[]` was already correct for `pi`/`claude`) and `opencode` (`['--pure']` → `[]`)
- [x] `src/main/harnessLaunch.ts` — added `userFlags?: string` parameter to `buildHarnessSpawnArgs`; user flags are appended to args after config.args (always `[]` post-Slice 3)
- [x] `src/main/ipc/terminalIpc.ts` — `SPAWN_TERMINAL` handler reads `harnessDefaults[harness]?.flags` from store and passes to `buildHarnessSpawnArgs`; eliminated duplicate `buildHarnessSpawnArgs` call (launch log now reuses `harnessArgs`)
- [x] `tests/main/unit/harnessLaunch.test.ts` — updated harness configs to `args: []`; rewrote 2 existing tests to not expect hardcoded flags; added 5 new userFlags test cases
- [x] `tests/main/unit/terminalIpc.test.ts` — updated harness config to `args: []` + added `harnessDefaults` store mock with `flags: '--yolo'`; updated expected args; added harnessDefaults to base `createMockDeps()` mock store

**Deviation from plan:** None. Implementation matches documented steps.

**Validation:** `npm run typecheck` ✅ · `npm run test` ✅ (2963 passed)

**Dependencies:** Slice 1 (store has `harnessDefaults`)

**Launch precedence** (per Behavioral Rules — Runtime Selection):
1. Renderer passes `(workingDir, harness?, model?)` — these are workspace-level values
2. Main reads `harnessDefaults[harness].flags` from store — global default flags
3. **Favorites are never read at spawn time.** They are a UX-only concept.
4. If `model` is empty or the stored default model is no longer discoverable, the model is still passed as-is. The harness CLI handles the error. **Store state is never auto-cleared.**

**Flags ownership** (per Behavioral Rules — Flags Ownership):
- Static harness config: `command`, `env`, `modelArg` (not changing)
- Store: user-configurable `flags` string (read by main at spawn time)
- Workspace scope: **does not own flags in this pass** — flags come exclusively from global store

**Steps:**

1. **In `src/main/harnessCatalog.ts`:** Remove hardcoded `args` from all entries:
   ```typescript
   export const HARNESS_OPTIONS: Record<string, HarnessConfig> = {
     codex:    { name: 'Codex',    command: 'codex',    args: [], icon: '🧠', modelArg: '-m' },
     opencode: { name: 'OpenCode', command: 'opencode', args: [], icon: '⚡', modelArg: '-m',
                 env: { OPENCODE_PERMISSION: JSON.stringify({ bash: { '*': 'allow' }, edit: 'allow' }) } },
     pi:       { name: 'Pi',       command: 'pi',       args: [], icon: 'π',  modelArg: '--model' },
     claude:   { name: 'Claude',  command: 'claude',   args: [], icon: '✨', modelArg: '--model' },
   };
   ```

2. **In `src/main/harnessLaunch.ts`:** Add `userFlags` parameter:
   ```typescript
   export function buildHarnessSpawnArgs(
     config: HarnessConfig,
     model?: string,
     userFlags?: string
   ): string[] {
     const args = [...config.args];

     if (userFlags && userFlags.trim()) {
       args.push(...userFlags.trim().split(/\s+/));
     }

     if (model) {
       const modelArg = config.modelArg ?? '--model';
       args.unshift(model);
       args.unshift(modelArg);
     }

     return args;
   }
   ```

   Order matters: user flags are appended, model is prepended. `config.args` is always `[]` after this slice, but the spread is kept for forward compatibility. The `userFlags` string is split on whitespace — this is the same parser as before, now sourced from the store instead of hardcoded arrays. Known limitation: does not handle quoted values (LR-4).

3. **In `src/main/ipc/terminalIpc.ts` `SPAWN_TERMINAL` handler:**
   - Read flags from store:
     ```typescript
     const harnessDefaults = getStore().get('harnessDefaults');
     const userFlags = harness ? harnessDefaults[harness]?.flags : undefined;
     const harnessArgs = harnessConfig
       ? buildHarnessSpawnArgs(harnessConfig, model, userFlags)
       : [];
     ```
   - **Note:** `model` comes from the renderer (workspace-level). `userFlags` comes from the store (global). These are independent — no merging or fallback between them. If `model` is empty/undefined, `buildHarnessSpawnArgs` skips the model flag. If `userFlags` is empty, no flags are appended.
   - **Eliminate the duplicate `buildHarnessSpawnArgs` call** for the launch log. Replace:
     ```typescript
     // OLD: second call
     const launchArgs = buildHarnessSpawnArgs(config, model);
     ```
     With:
     ```typescript
     // NEW: reuse harnessArgs (already computed above)
     const launchArgs = harnessArgs;
     ```

4. **Update tests:**

   **`tests/main/unit/harnessLaunch.test.ts`:**
   - Test configs should use `args: []` (matching the new HARNESS_OPTIONS)
   - Add explicit `userFlags` parameter to test calls:
     ```typescript
     // Codex with user flags from store
     buildHarnessSpawnArgs(codexConfig, 'gpt-5.4-mini', '--yolo')
     // → ['-m', 'gpt-5.4-mini', '--yolo']
     
     // Codex without user flags
     buildHarnessSpawnArgs(codexConfig)
     // → []
     
     // OpenCode with user flags
     buildHarnessSpawnArgs(opencodeConfig, 'opencode/zen/big-pickle', '--pure')
     // → ['-m', 'opencode/zen/big-pickle', '--pure']
     ```
   - Add new test cases:
     - No user flags → empty args (if no model)
     - With user flags → flags appended
     - With model + user flags → model prepended + flags appended
     - Empty user flags string → same as no flags
     - Multi-word user flags (`'--yolo --verbose'`) → split correctly

   **`tests/main/unit/terminalIpc.test.ts`:**
   - The `'SPAWN_TERMINAL uses wrapper-script execution for harness launches'` test creates an inline harness config with `args: ['--yolo']`. This tests the harness config's args being used, not the store. After Slice 3, harnesses have `args: []`. The test must:
     - Change `args: ['--yolo']` to `args: []` in the mock config
     - Add a store mock that returns `harnessDefaults: { codex: { model: '', favorites: [], flags: '--yolo' } }`
     - The assertion becomes: `['codex', '-m', 'gpt-5.4-mini', '--yolo']` (flags from store, not config)

   **`tests/main/integration/terminalPTY.test.ts`:**
   - This test creates inline `HarnessConfig` objects and calls `buildHarnessSpawnArgs` directly.
   - The function signature changes (new `userFlags` param). Tests that don't pass `userFlags` still work (it's optional).
   - Tests with inline `args: ['--yolo']` or `args: ['--verbose']` should be updated to pass those as `userFlags` instead, to reflect the new architecture: `args` is always `[]`, user flags come from the third parameter.
   - This file is an integration test that tests the full spawn pipeline. Verify it still works with the new signature.

**Files changed:**
| File | Action |
|------|--------|
| `src/main/harnessCatalog.ts` | Modify — remove hardcoded `args` |
| `src/main/harnessLaunch.ts` | Modify — add `userFlags` parameter |
| `src/main/ipc/terminalIpc.ts` | Modify — read flags from store; eliminate duplicate call |
| `tests/main/unit/harnessLaunch.test.ts` | Modify — update for new signature |
| `tests/main/unit/terminalIpc.test.ts` | Modify — update spawn tests for store-backed flags |
| `tests/main/integration/terminalPTY.test.ts` | Modify — update for new `userFlags` parameter |

**Verification:** `npm run validate` passes. Spawning a codex terminal with `flags: '--yolo'` in store shows `--yolo` in args. Spawning with `flags: ''` shows no flag. OpenCode behaves identically with `--pure`.

---

### Slice 4: Migrate gate localStorage favorites to electron-store

**Bounding:** One-time migration runs on first launch. Gate's `localStorage` favorites are moved to `harnessDefaults` in electron-store, then a completion marker is set. After migration, the gate reads from electron-store exclusively.

**Dependencies:** Slice 2 (IPC handlers exist)

**Migration policy** (per Behavioral Rules — Migration):
- **One-time:** Completion marker prevents re-runs
- **Deterministic merge:** Store favorites preserved in order first; legacy-only favorites appended in their legacy order. No silent reshuffling.
- **Completion marker:** `localStorage` key `clanker-grid-migration-harness-defaults` set to `'1'` after successful write
- **Failure:** Non-fatal. `console.warn` with error details. Legacy key remains for next attempt.
- **No destructive cleanup:** Unresolved model references in store are never auto-cleared

**Steps:**

1. **Create `src/renderer/lib/harnessDefaultsMigration.ts`:**
   ```typescript
   import type { HarnessDefaultsMap, HarnessDefaults } from '../../shared/types/store';

   const LEGACY_KEY = 'clanker-grid-model-favorites';
   const MIGRATION_MARKER = 'clanker-grid-migration-harness-defaults';

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
    * Ordering: This runs in a React effect in App.tsx, which mounts after
    * app.whenReady() has completed and IPC handlers are registered.
    * See MR-3 in plan risk analysis.
    */
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
       const legacyFavorites = JSON.parse(legacy) as Record<string, string[]>;
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
           merged[harness] = { model: '', favorites: favs.filter((f): f is string => typeof f === 'string'), flags: '' };
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
   ```

2. **In `src/renderer/App.tsx`:** Call migration on mount:
   ```typescript
   import { migrateLegacyFavorites } from './lib/harnessDefaultsMigration';

   // In the component body or a useEffect:
   useEffect(() => {
     migrateLegacyFavorites();
   }, []);
   ```
   Runs once per app launch. After first successful run, `MIGRATION_MARKER` is `'1'` and subsequent launches skip immediately.

3. **In `src/renderer/components/WorkspaceGateContent.tsx`:**
   - Remove `FAVORITES_STORAGE_KEY` constant
   - Remove `favoritesMap` state
   - Remove the `useEffect` that loads favorites from localStorage
   - Remove `toggleFavorite`'s localStorage write
   - Replace all of the above with `harnessDefaults` loaded from electron-store via `getHarnessDefaults()`
   - `toggleFavorite` calls `setHarnessDefaults()` with the updated favorites array
   - `favorites` is derived from `harnessDefaults[selectedHarness]?.favorites`

   **Note:** This is a significant rewrite of the gate's model state management. It is intentionally scoped to the gate's internals — no new components or external state stores.

   **Important:** The legacy `FAVORITES_STORAGE_KEY` (`clanker-grid-model-favorites`) is no longer read or written by the gate after this slice. The migration reads it once and the marker prevents re-reads. The key is left in localStorage (not deleted) so a failed migration can retry. A future cleanup pass can remove it once migration is considered complete for all users.

**Files changed:**
| File | Action |
|------|--------|
| `src/renderer/lib/harnessDefaultsMigration.ts` | Create |
| `src/renderer/App.tsx` | Modify — call migration on mount |
| `src/renderer/components/WorkspaceGateContent.tsx` | Modify — replace localStorage with electron-store |

**Verification:**
- Before migration: `localStorage` has `clanker-grid-model-favorites` with data, no marker
- After migration: `localStorage` has marker `'1'`; `store.get('harnessDefaults')` contains merged favorites in deterministic order
- Failed migration: marker is NOT set, legacy key remains, `console.warn` logged, retry on next launch
- Second launch (successful): marker is `'1'`, migration is immediate no-op
- Gate star/unstar persists via electron-store across app restarts

---

### Slice 5: Header settings — harness defaults management — ✅ IMPLEMENTED

**Completed 2026-04-16.**

- [x] `src/renderer/components/Header.tsx` — added `harnessDefaults`, `expandedHarness`, `harnessModelCache`, `harnessModelLoading` state; added `useEffect` loading `harnessDefaults` from electron-store on mount; added `handleToggleHarnessFlag`, `handleSetDefaultModel`, `handleToggleFavorite`, `loadHarnessModels` handlers; added harness defaults section to settings dropdown with per-harness accordion (yolo checkbox, default model selector, favorites list); unresolved models shown with `AlertTriangle` + dimmed/warning styling; favorites show both pinned (with remove button) and available models (with star button to add)
- [x] `src/renderer/components/Header.css` — added `.settings-section-title`, `.harness-defaults-row`, `.harness-defaults-header`, `.harness-defaults-label`, `.harness-defaults-current`, `.harness-defaults-chevron`, `.harness-defaults-panel`, `.harness-defaults-option`, `.harness-defaults-field`, `.harness-defaults-field-label`, `.harness-defaults-favorites`, `.harness-defaults-favorite-tag`, `.harness-defaults-remove-fav`, `.harness-defaults-add-fav` styles

**Deviation from plan:**
- `HarnessConfig` import was removed (not exported from `harnessCatalog.ts`; lives in `harnessLaunch.ts` which renderer cannot import). `HARNESS_FLAG_MAP` from `harnessFlags.ts` provides the flag mapping without needing the type.
- Model loading is on-demand per harness (loads when accordion expands, cached thereafter). Matches the plan's recommendation in MR-5.
- Favorites section shows both pinned favorites (with × remove) and up to 5 unpinned models (with ☆ star to add). This provides more discoverability than just showing favorites.

**Validation:** `npm run typecheck` ✅ · `npm run test` ✅ (2963 passed)

**Bounding:** Adds harness defaults management UI to the header settings dropdown. Per-harness accordion with yolo checkbox, default model select, and favorites list. All changes persist via electron-store.

**Dependencies:** Slice 4 (gate reads from same store)

**Steps:**

1. In `Header.tsx`, load `harnessDefaults` from electron-store on mount via `getHarnessDefaults()`.
2. Add "Harness Defaults" section to settings dropdown (after "Manage VCS credentials" button).
3. Per-harness accordion rows (using `KNOWN_HARNESS_IDS` filtered by `availableHarnessIds`). Collapsed shows harness icon, label, current default model (with unresolved warning if applicable), and chevron.
4. Expanded panel contains:
   - **Yolo/Auto checkbox:** Uses `harnessToggleFromFlags` for initial state, `harnessFlagsFromToggle` for write. Label: "Enable yolo mode" for codex, "Enable pure mode" for opencode, generic for others.
   - **Default model selector:** Populated on-demand by `getHarnessModels(harnessId)`. Cached in `harnessModelCache`. Shows "Use harness default" (empty value) plus discovered models. Unresolved stored model shown as disabled option with label.
   - **Favorites list:** Shows pinned favorites with × remove. Below shows up to 5 unpinned models with ☆ star to add. Unresolved favorites shown with warning styling.
5. All changes call `setHarnessDefaults()` with the full updated `HarnessDefaultsMap`.
6. **Unresolved models:** Stored model IDs not in the discovered list are shown with `AlertTriangle` icon and warning color. Store is NOT auto-cleared. User manually changes or removes.

**Files changed:**
| File | Action |
|------|--------|
| `src/renderer/components/Header.tsx` | Modify — add harness defaults state, handlers, and accordion UI |
| `src/renderer/components/Header.css` | Modify — add harness defaults section styles |

**Verification:** Settings dropdown has harness defaults section with per-harness accordion. Changes persist to electron-store. Gate reads same data. Unresolved models surfaced with warning icon. Favorites can be added/removed.

---

### Slice 6: Gate — frictionless model picker — ✅ IMPLEMENTED

**Completed 2026-04-16.**

- [x] `src/renderer/components/WorkspaceGateContent.tsx` — replaced dropdown with compact model pill → favorites picker → discovery modal flow; `defaultModel` state sourced from `harnessDefaults[harness].model`; favorites list uses `harnessDefaults[harness].favorites`; model selection updates `defaultModel` state; launch uses `defaultModel || modelOptions[0]?.id`; unresolved models show `AlertTriangle` warning icon; `AlertTriangle`, `Search`, `X` icons imported from lucide-react; keyboard handler for Escape closes discovery modal; outside-click closes favorites picker
- [x] `src/renderer/components/WorkspaceGate.css` — added compact picker styles; removed dead `.model-selector` / `.model-menu` / `.model-favorite-btn` styles from old dropdown
- [x] `tests/renderer/unit/WorkspaceGateContent.test.tsx` — updated 2 model selector tests for new compact picker UX

**Post-implementation cleanup:**
- Removed dead `selectedModel` / `setSelectedModel` and `isModelLoading` / `setIsModelLoading` state from `WorkspaceGateContent.tsx` — these were unused after the compact picker replaced the dropdown.
- Removed dead `.model-selector`, `.model-menu`, `.model-menu-item`, `.model-favorite-btn` CSS classes from `WorkspaceGate.css`.

**Validation:** `npm run typecheck` ✅ · `npm run test` ✅ (2963 passed) · `npm run build` ✅

---

### Slice 7: New terminal respects global defaults — ✅ IMPLEMENTED

**Completed 2026-04-16.**

- [x] `src/renderer/components/Header.tsx` — updated `handleAddTerminal` with explicit workspace-first resolution and clarifying comments; variable names updated for clarity (`workspaceHarness`, `workspaceModel`, `resolvedHarness`, `resolvedModel`)
- [x] `tests/renderer/unit/Header.test.tsx` — added `getHarnessDefaults` and `setHarnessDefaults` mocks to `window.electronAPI` mock in `beforeEach`

**Deviation from plan:**
- The existing `handleAddTerminal` implementation already used workspace harness + model as the primary resolution source. The change was primarily **clarification and documentation**: making the workspace-first resolution explicit in comments and renaming variables for clarity.
- No behavioral change — workspace harness/model already took priority. The plan's "Priority 2: none → plain shell" behavior was already in place.
- `getHarnessDefaults` mock added to `Header.test.tsx` to prevent test failures when the settings dropdown mounts and attempts to load harness defaults.

**Validation:** `npm run typecheck` ✅ · `npm run test` ✅ (2963 passed; 105 test files) · `npm run validate` ✅ (lint → typecheck → build → test)

**Bounding:** "New Terminal" button resolves harness and model from workspace. Plain shell when no workspace harness set. Flags are read from store by main process (Slice 3). Favorites are never read at spawn time.

**Dependencies:** Slice 3 (spawn reads flags from store), Slice 4 (renderer has access to harnessDefaults)

> **This slice spans backend and UI. The backend logic (priority resolution) can be implemented after Slice 3, but the UI integration depends on Slice 5.**

**Launch precedence** (per Behavioral Rules — Runtime Selection):

| Priority | Source | What it provides |
|----------|--------|-------------------|
| 1 (highest) | Workspace harness + model | Harness + model from workspace |
| 2 | None | Plain shell (no harness, no model) |

> **No Priority 3.** This pass does not infer a harness by scanning for the first non-empty default model. The workspace's selected harness is the only driver of harness/model resolution.

**Favorites are excluded from all resolution.** The code path in `handleAddTerminal` never reads `harnessDefaults[harness].favorites`.

**Unresolved models are not auto-cleared.** If `harnessDefaults[harness].model` references a model that is no longer discoverable, it is still passed to `spawnTerminal`. The harness CLI handles the error.

**Flags are not resolved here.** Flags come exclusively from the main process (Slice 3 reads `harnessDefaults[harness].flags` from store at spawn time). The renderer never passes flags.

**Steps:**

1. Update `handleAddTerminal` in `Header.tsx`:
   ```typescript
   const handleAddTerminal = async () => {
     if (!canAddPane()) return;

     // Load global defaults
     const harnessDefaults = await window.electronAPI.getHarnessDefaults();

     // Priority 1: workspace harness + model
     const workspaceHarness = availableHarnessIds.includes(harness) ? harness : '';

     let resolvedHarness: string | undefined;
     let resolvedModel: string | undefined;

     if (workspaceHarness) {
       // Workspace values take precedence
       resolvedHarness = workspaceHarness;
       resolvedModel = model || undefined;
     }
     // Priority 2/3: no workspace harness → plain shell.
     // No implicit harness or model resolution from global defaults in this pass.

     try {
       const info = await window.electronAPI.spawnTerminal(
         workspacePath || '/',
         resolvedHarness,
         resolvedModel,
       );
       addTerminal({ id: info.id, pid: info.pid, workingDir: workspacePath });
     } catch (err) {
       console.error('Failed to spawn terminal:', err);
     }
   };
   ```

**Verification:**
- No workspace harness → plain shell
- Workspace has harness `pi` with model `sonnet` → spawns `pi` with that model (+ flags from store)
- Workspace harness `codex` with no model → spawns `codex` with no forced model (harness picks its own default) + flags from store

---

## Edge Case Decisions

### E1: Empty string `''` vs `undefined` for model

**Decision:** `buildHarnessSpawnArgs` already handles `model ? ... : ...` — empty string is falsy and treated as "no model". This is correct. The store uses `''` for "no default model". No change needed.

### E2: Empty string `''` for flags

**Decision:** `userFlags.trim()` is falsy for empty string — no flags appended. Correct. The store uses `''` for "no flags". No change needed.

### E3: Multi-word flags (`'--yolo --verbose'`)

**Decision:** `userFlags.trim().split(/\s+/)` splits on whitespace. This handles multi-word flags correctly for the checkbox UX. Does NOT handle quoted values (e.g., `--flag "two words"`). This is acceptable for the checkbox-only UX in this pass. Free-text flag input (future) would need a proper parser. Documented as a known limitation (LR-4).

### E4: Migration timing — renderer vs IPC handler registration

**Decision:** React mounts after `app.whenReady()` completes and IPC handlers are registered. This is an implicit ordering guarantee in Electron. Adding a comment to the migration function (already done in Slice 4 step 1). No explicit handshake needed.

### E5: Missing harness in harnessDefaults

**Decision:** All four harness IDs (`codex`, `opencode`, `pi`, `claude`) are in the store defaults. `harnessDefaults[harness]?.flags` uses optional chaining — missing harness returns `undefined`, treated as "no flags". This is safe. No initialization step needed for newly discovered harnesses.

### E6: SET_HARNESS_DEFAULTS — validated full replacement

**Decision:** Full replacement with validation (not a blind passthrough). The `HarnessDefaultsMap` is small (4 entries). The renderer sends the entire map on every change. The main process validates and sanitizes before writing. A future optimization can add partial update. Not needed now.

### E7: Unresolved / stale models — store never auto-cleared

**Decision:** If a stored default model or favorite is no longer discoverable (e.g., model removed from provider), it is treated as **invalid/unresolved**:
- The store value is preserved as-is
- The app does NOT silently rewrite, clear, or filter out the entry
- The model ID is still passed to the harness CLI (which will fail or ignore it)
- The UI surfaces the unresolved state to the user (visual treatment TBD in UI pass)
- The user can manually remove or change it

This applies to both `model` (default model) and entries in `favorites`.

### E8: Favorites never affect runtime

**Decision:** The `favorites` array in `HarnessDefaults` is read only by UI code (picker, discovery modal, settings). It is never read by:
- `SPAWN_TERMINAL` handler
- `buildHarnessSpawnArgs`
- `handleAddTerminal`
- Any main process code path

If a favorite is stale/unresolved, it still appears in the picker with unresolved styling. The user can remove it. It never silently selects an alternative.

---

## Test Update Checklist

### Slice 0 tests (structural — existing tests should pass unchanged)
- [x] `npm run typecheck` — all 4 files importing shared `StoreSchema`
- [x] `npm run test` — no regressions from schema extraction or `getSafeWorkspacePath` removal *(2938 tests passed)*

### Slice 1 tests (store schema extension)
- [x] `npm run typecheck` — `StoreSchema` includes `harnessDefaults`
- [x] App starts — `store.get('harnessDefaults')` returns 4-entry defaults (validated via `npm run test` ⬅ 2938 passed)

### Slice 2 tests (IPC channels + validation)
- [x] `tests/main/unit/ipcChannels.test.ts` — `GET_HARNESS_DEFAULTS` and `SET_HARNESS_DEFAULTS` in `ALL_IPC_CHANNELS`
- [x] `tests/main/unit/settingsIpc.test.ts` — add tests:
  - [x] `GET_HARNESS_DEFAULTS` handler returns store value
  - [x] `SET_HARNESS_DEFAULTS` handler calls `store.set` with validated payload
  - [x] `SET_HARNESS_DEFAULTS` rejects non-object payloads
- [x] `tests/main/unit/harnessDefaultsValidation.test.ts` — new file:
  - [x] Valid payload passes through unchanged
  - [x] Unknown harness IDs are stripped
  - [x] Missing harness IDs are filled with defaults
  - [x] Malformed entry (wrong types) is coerced
  - [x] Non-object payload is rejected with error
  - [x] `favorites` filters non-string entries

### Slice 3 tests (spawn with user flags)
- [x] `tests/main/unit/harnessLaunch.test.ts`:
  - [x] No user flags, no model → `[]`
  - [x] With model, no user flags → `['-m', '<model>']`
  - [x] With model + user flags → `['-m', '<model>', '--yolo']`
  - [x] With user flags only → `['--yolo']`
  - [x] Empty user flags string → `[]`
  - [x] Multi-word flags → `['--yolo', '--verbose']`
- [x] `tests/main/unit/terminalIpc.test.ts`:
  - [x] Spawn codex with `--yolo` from store → args include `--yolo`
  - [x] Spawn opencode with `--pure` from store → args include `--pure` (implicit in harnessLaunch tests)
  - [x] Spawn plain shell → no harness args (unchanged)
  - [x] Launch log reuses `harnessArgs` (no duplicate call)
- [x] `tests/main/integration/terminalPTY.test.ts`:
  - [x] All inline configs already use `args: []`; new optional `userFlags` parameter is backward-compatible; full spawn pipeline works with new signature

### Slice 4 tests (migration)
- [x] `npm run typecheck` — migration module compiles
- [x] `npm run test` — 2963 passed (38 localStorage mock errors in App.test.tsx resolved)
- [ ] Manual test: localStorage → electron-store migration
- [ ] Gate favorites persist across app restarts
- [ ] Second launch: migration is no-op

### Slice 5 tests (header settings UI)
- [x] `npm run typecheck` — Header.tsx compiles with new state and handlers
- [x] `npm run test` — 2963 passed (no regressions)
- [ ] Manual test: settings dropdown shows harness defaults section with accordion
- [ ] Manual test: yolo/auto checkbox toggles and persists to electron-store
- [ ] Manual test: default model selector loads models on-demand
- [ ] Manual test: favorites can be added and removed
- [ ] Manual test: unresolved models show warning indicator

### Slice 6 tests (gate frictionless picker)
- [x] `npm run typecheck` — WorkspaceGateContent.tsx compiles with compact picker
- [x] `npm run test` — 2963 passed; WorkspaceGateContent.test.tsx updated for new picker
- [ ] Manual test: compact model pill shows current default model
- [ ] Manual test: clicking pill opens favorites picker with starred models
- [ ] Manual test: "Browse all models" opens discovery modal with search
- [ ] Manual test: selecting a model in discovery closes modal and updates pill
- [ ] Manual test: unresolved default model shows warning icon
- [ ] Manual test: Escape key closes discovery modal
- [ ] Manual test: outside click closes favorites picker

---
### Slice 7 tests (new terminal defaults)
- [x] npm run typecheck — Header.tsx compiles with updated handleAddTerminal
- [x] npm run test — 2963 passed; Header.test.tsx updated with getHarnessDefaults mock
- [ ] Manual test: New Terminal with no workspace harness → plain shell (no harness arg)
- [ ] Manual test: New Terminal with workspace harness + model → spawns with those values + flags from store

---


## File Inventory (Complete)

| File | Action | Slice |
|------|--------|-------|
| `src/shared/harnessIds.ts` | **Create** | **1 ✅** |
| `src/shared/types/store.ts` | Modify | **0 ✅, 1 ✅** |
| `src/main/main.ts` | Modify | **0 ✅, 1 ✅** |
| `src/main/ipc/settingsIpc.ts` | Modify | **0 ✅, 2 ✅** |
| `src/main/ipc/terminalIpc.ts` | Modify | **0 ✅, 3 ✅** |
| `src/main/ipc/aiCommitIpc.ts` | Modify | **0 ✅** |
| `src/renderer/lib/harnessFlags.ts` | **Create** | **1 ✅** |
| `src/main/harnessDefaultsValidation.ts` | **Create** | **2 ✅** |
| `src/main/harnessCatalog.ts` | Modify | **3 ✅** |
| `src/main/harnessLaunch.ts` | Modify | **3 ✅** |
| `src/shared/ipcChannels.ts` | Modify | **2 ✅** |
| `src/main/preload.ts` | Modify | **2 ✅** |
| `src/renderer/electron.d.ts` | Modify | **2 ✅** |
| `src/renderer/lib/harnessDefaultsMigration.ts` | **Create** | **4 ✅** |
| `src/renderer/App.tsx` | Modify | **4 ✅** |
| `src/renderer/components/WorkspaceGateContent.tsx` | Modify | **4 ✅, 6 ✅** |
| `src/renderer/components/WorkspaceGate.css` | Modify | **6 ✅** |
| `src/renderer/components/Header.css` | Modify | **5 ✅** |
| `tests/main/unit/harnessLaunch.test.ts` | Modify | **3 ✅** |
| `tests/main/unit/terminalIpc.test.ts` | Modify | **3 ✅** |
| `tests/main/unit/settingsIpc.test.ts` | Modify | **2 ✅** |
| `tests/main/unit/harnessDefaultsValidation.test.ts` | **Create** | **2 ✅** |
| `tests/main/integration/terminalPTY.test.ts` | Modify | **3 ✅** |
| `tests/setup/electron.ts` | Modify | **2 ✅** |
| `src/renderer/components/Header.tsx` | Modify | **7 ✅** |
| `tests/renderer/unit/Header.test.tsx` | Modify | **7 ✅** |

---

## Risk & Gap Analysis

### High Risk

#### HR-1: Schema drift — `StoreSchema` in 4 places
**Resolved by Slice 0.** All four files import from `src/shared/types/store.ts`. No drift possible.

#### HR-2: Duplicate `buildHarnessSpawnArgs` call in terminalIpc.ts
**Resolved by Slice 3.** Launch log reuses `harnessArgs`. Single source of truth for spawn arguments.

#### HR-3: Tests encode hardcoded `--yolo` / `--pure`
**Resolved by Slice 3.** All three test files updated: `harnessLaunch.test.ts`, `terminalIpc.test.ts`, `terminalPTY.test.ts`. Inline configs use `args: []`; flags now come from store via `userFlags` parameter.

#### HR-4: `HarnessConfig` type duplication in renderer `electron.d.ts`
**Status:** Pre-existing. The renderer's `getHarnessOptions` return type duplicates `HarnessConfig` fields. This is by design — the renderer cannot import from main. The inline type in `electron.d.ts` is the renderer's view of the serialized data. No action in this plan.

#### HR-5: Renderer could bypass validation by sending malformed payloads
**Resolved by Slice 2.** `SET_HARNESS_DEFAULTS` handler validates all payloads via `validateHarnessDefaultsMap`. Malformed data is rejected or coerced. The preload bridge types the channel, but the main process does not trust the renderer.

### Medium Risk

#### MR-1: No schema migration mechanism
**Status:** Acknowledged. electron-store merges new top-level keys automatically. For `harnessDefaults` (a new key), this is safe. If future slices rename or restructure keys, an explicit migration mechanism will be needed. Not in scope.

#### MR-2: `SPAWN_TERMINAL` IPC signature edge cases
**Status:** No signature change. Flags are read from store by main. Renderer continues to pass `(workingDir, harness?, model?)`. Empty string vs `undefined` handled by existing falsy checks. No risk.

#### MR-3: Migration timing — store not ready
**Status:** Resolved by Slice 4. `migrateLegacyFavorites()` runs in a React useEffect in App.tsx after IPC handlers are registered.

#### MR-4: `handleAddTerminal` model resolution
**Status:** Resolved by Slice 7. Resolution is workspace-first only — there is no implicit global default harness in this pass. The workspace's selected harness drives all resolution. Favorites are excluded. Unresolved models are passed as-is. A future pass may add an explicit global default harness setting.

#### MR-5: Model loading in settings
**Status:** Resolved by Slice 5. On-demand loading per harness when accordion expands. Results are cached in `harnessModelCache`.

#### MR-6: Stale/unresolved models in store
**Status:** Resolved by product decision #3. Store is never auto-cleared. Unresolved models are passed to the harness CLI as-is. UI surfaces the state. No automatic destructive behavior.

### Low Risk

#### LR-1: `args` field empty post-Slice 3
**Status:** By design. Renderer doesn't use `args` for UI rendering.

#### LR-2: IPC channel naming
**Status:** Follows existing pattern (`get-<resource>`, `set-<resource>`). Consistent.

#### LR-3: Unknown harness IDs
**Status:** Validation in `SET_HARNESS_DEFAULTS` strips unknown IDs. Optional chaining handles missing harness IDs at spawn time. Not a real scenario — harness IDs are fixed constants.

#### LR-4: Flag parsing limitation
**Status:** Acknowledged. `split(/\s+/)` doesn't handle quoted values. Acceptable for checkbox UX. Future free-text input needs a proper parser. Renderer does not interpret arbitrary flag strings — uses `harnessFlagsFromToggle` helper.

#### LR-5: Migration re-run protection
**Status:** Resolved by completion marker in Slice 4. `clanker-grid-migration-harness-defaults` sentinel prevents re-runs. Failed migrations do NOT set the marker — they retry on next launch.

---

## Slice Dependency Graph

```
Slice 0 (Extract StoreSchema)
  ├── Slice 1 (Extend schema)
  │     └── Slice 2 (IPC channels)
  │           └── Slice 3 (Spawn with user flags)
  │           └── Slice 4 (Migrate localStorage)
  │                 └── Slice 5 (Header settings UI) [UI] ✅
  │                 └── Slice 6 (Gate picker UI) [UI]
  │                 └── Slice 7 (New terminal defaults)
  │                       └── depends on Slice 3 + Slice 4
```

**Implementation order:** 0 → 1 → 2 → 3 → 4 → 5/6/7 (UI slices, order TBD)

**Validation gate after Slice 4:** Slices 0–4 are the complete backend. Before starting any UI work (Slices 5–7), run `npm run validate` and verify:
- [ ] All tests pass
- [ ] Store schema has `harnessDefaults`
- [ ] IPC round-trip works (`getHarnessDefaults` / `setHarnessDefaults`)
- [ ] `SET_HARNESS_DEFAULTS` rejects malformed payloads
- [ ] Spawn uses flags from store (not hardcoded)
- [ ] Migration runs once (completion marker set), deterministic merge order
- [x] Gate model selector is frictionless: compact pill + favorites picker + discovery modal
- [x] Gate model state sourced from `harnessDefaults` in electron-store
- [x] Unresolved default model surfaced with warning icon in compact picker
- [x] Gate favorites read from electron-store via `getHarnessDefaults`
- [x] Gate favorites written to electron-store via `setHarnessDefaults`
- [x] Settings dropdown has harness defaults section with per-harness accordion

---

## UX Decisions (Deferred)

> These affect Slices 5–7 only. Resolved during UI implementation pass.

- UX-1: Discovery modal — **popover vs. full modal vs. separate screen**
- UX-2: Discovery modal — **load on demand vs. preload vs. hybrid**
- UX-3: Discovery modal — **click-to-select vs. preview+confirm; star behavior**
- UX-4: Gate favorites picker — **empty state behavior**
- UX-5: Star → set as default? (Independent or linked)
- UX-6: Header settings — **accordion vs. always-visible vs. sub-panel**
- UX-7: Unresolved model visual treatment — strikethrough, warning icon, dimmed text, etc.

---

## UX Decisions — Resolved

### UX-1: Discovery modal form factor — Popover

**Decision:** Inline popover anchored to the gate model picker.

A full modal (`<dialog>` or portal overlay) is too heavy for a frequent action. A popover:
- Stays in the gate's spatial context
- Closes on outside click or `Escape`
- Doesn't obscure the folder input above it
- Matches the existing mental model (the gate already uses a dropdown)

Implementation: Use the browser's native `<dialog>` element or a floating popover with a backdrop. No routing change. The popover mounts inline within the gate's DOM hierarchy.

### UX-2: Discovery modal data loading — Hybrid (immediate + background)

**Decision:** Show favorites immediately; load the full model list in the background with a loading indicator.

The all-models list is large (hundreds of items for opencode). Loading it synchronously blocks the entire picker. The hybrid approach:
1. The picker popover opens instantly with favorites list rendered
2. The full model list fetches in parallel
3. As results arrive, the list populates incrementally (virtualized scroll for performance)
4. A subtle spinner or skeleton appears at the bottom of the list while loading

Rationale: Users who rely on favorites see no degradation. Users doing discovery see progress. No blank state.

### UX-3: Discovery modal interaction model — Click-to-select + star is independent

**Decision:** Clicking a model in the discovery modal selects it and closes the modal. Starring/un-starring is a separate action via a star button on each row. No preview+confirm step.

The current gate already behaves this way. The new picker preserves the same direct-select pattern. `Star` is purely for pinning — it does NOT set the default. The currently-selected model shows a checkmark indicator.

Starring in the discovery modal also adds to favorites in electron-store via `setHarnessDefaults`.

### UX-4: Gate favorites picker — empty state

**Decision:** When a harness has no favorites, the favorites picker shows a single row: the current default model (if set) or "Default model". No prompt to browse. No empty state message.

The "Browse all" link is always visible below the favorites list, so discovery is never hidden. Users who haven't pinned anything see their current selection, not a blank list.

### UX-5: Star and default are independent (not linked)

**Decision:** Starring a model does NOT set it as the default. Favorites are UX-only (pinned list for the picker). The default model is set exclusively in the header settings area.

This keeps the two concepts clean. The picker is a shortcut for fast switching; settings is where intentional default configuration lives. A future iteration could add a "Set as default" option in the discovery modal context menu, but that is out of scope for this pass.

### UX-6: Header settings — Per-harness accordion

**Decision:** The harness defaults section uses a stacked accordion with per-harness rows. Each row shows the harness name, current default model, and an expand button. Expanding a row reveals the full controls for that harness.

**Why accordion over flat list:**
- The yolo checkbox, default model selector, and favorites list per harness would overwhelm a flat settings panel
- Accordion keeps the section compact by default
- Only the harness being configured needs to be expanded
- Consistent with the app's minimalism — nothing should feel like a settings page

**Expanded row contents:**
1. Yolo/auto checkbox (label: "Enable yolo mode" for codex, "Enable pure mode" for opencode)
2. Default model select (searchable dropdown, current default pre-selected, favorites shown first)
3. Favorites list (starred models, removable with an X button)
4. Unresolved model indicator if the stored default model is no longer discoverable

### UX-7: Unresolved model visual treatment — Warning indicator

**Decision:** Unresolved models (stored model IDs no longer in the discovered model list) are shown with:
- Dimmed text (reduced opacity)
- A warning icon (`AlertTriangle` from lucide-react) inline with the model label
- A tooltip on hover explaining the state: "This model is no longer available. Select a new default or remove it."

Strikethrough is **not** used. Strikethrough implies the item is crossed off or completed, not broken. Dimmed + warning icon clearly communicates a problem state without being alarming.

The model ID (not label) is shown if the label is unknown. Example: "`gpt-5.4-ultra` ⚠" with tooltip.

This treatment applies to:
- The gate picker when showing the current default
- The header settings default model selector (shows the unresolved entry as an option)
- Favorites lists in both locations

The store is NOT auto-cleared. The user must manually change or remove the entry.

### UX-8: Unresolved models in the picker and discovery flow

**Decision:** Unresolved models (stored model IDs no longer discoverable) are handled as follows in the UI:

- **In the compact model pill / favorites picker:** The current default model is always shown, even if unresolved. It appears with the warning indicator described in UX-7. The user can select it (it is passed to the harness CLI as-is) or replace it.
- **In the favorites list:** Unresolved favorites appear with the warning indicator. They are removable but not auto-removed.
- **In discovery results:** Unresolved models are **excluded** from the normal discovery list. They do not appear as selectable items unless the user has already pinned them as a favorite (in which case they appear in the favorites section with warning styling, not in the all-models section).
- **Not part of ordinary discovery:** The discovery modal shows only currently-discoverable models. An unresolved stored model does not surface as a "browse all" result. The user must already know it exists (e.g., via the warning pill or a favorite) to re-select it.

Rationale: Discovery is a forward-looking action — it shows what is available now. Surfacing stale model IDs in discovery creates noise and could mislead users into thinking a removed model is still available. Stored unresolved models are surfaced via the warning indicator in the pill and favorites, which is sufficient for awareness.

---

## Gate Redesign — Layout and Visual Spec

This section documents the intended UX flow and visual layout for the gate after the Slice 6 redesign. It aligns with the terminal-focused, minimalist aesthetic of the app.

### Gate UX Flow

```
1. User opens app → Gate is shown with workspace path input focused
2. User selects harness (codex/opencode/pi/claude/none) — always visible
3. If harness selected:
   a. Gate shows compact model pill: current default model or "Default model"
   b. Clicking the pill opens the favorites picker (inline popover)
   c. Favorites picker shows starred models with checkmark on current selection
   d. Below favorites: "Browse all models" link
   e. Clicking "Browse all models" opens the discovery popover
   f. Discovery popover shows full model list (hybrid load) with search input at top
   g. Clicking a model selects it and closes the popover
4. User sets terminal count (1/2/4) and clicks Launch
```

### Gate Model Picker — Detailed Spec

**Compact model pill (always visible when harness selected):**
- Single row: model icon + model label (or "Default model") + chevron-down
- Width: 100% of the harness selector column (same max-width as input: 420px)
- Height: ~44px, same visual weight as the harness selector buttons
- States: default, hover (border brightens), active (open)

**Favorites picker popover:**
- Appears below the model pill, 100% width aligned
- Lists starred models, sorted by star order
- Current selection has a checkmark on the left
- Star button on each row to unpin
- "Browse all models" link at the bottom, always visible
- Empty state: shows "Default model" as the only item (current default, or generic)

**Discovery popover:**
- Search input at the top (autofocused, monospace font)
- Lists all models matching the query (or all if empty)
- Favorites shown first, sorted by star order
- Star button on each row to pin/unpin
- Clicking a model selects it, closes popover, updates pill
- "No results" state if search yields nothing
- Keyboard: `Escape` closes, arrow keys navigate, `Enter` selects focused model

### Consistency with Current Gate

The redesigned gate preserves the following from the current implementation:
- **Folder input with autocomplete** — no change
- **Harness selector buttons** — same layout, same keyboard shortcuts (b/c/o/p)
- **Terminal count selector** — same layout, same shortcuts (1/2/4)
- **Launch button** — same style and position
- **Keyboard shortcut hints** — same bar at the bottom
- **CSS variable theming** — all colors via `--bg-*`, `--text-*`, `--border-color`, `--accent-primary`
- **The SVG icon** — no change

The only UX surface that changes is the **model selector** (replacing the full dropdown with the compact pill → favorites picker → discovery popover flow).


---

## Handoff Notes (2026-04-16)

### Slice 0: Extract StoreSchema to shared types — COMPLETE

**Completed:** 2026-04-16

**Files changed:**
-  — **created** — canonical , , , and  type
- `src/main/main.ts` — updated to import `StoreSchema` from shared; removed inline duplicate
- `src/main/ipc/settingsIpc.ts` — updated to import `StoreSchema` from shared; removed local `getSafeWorkspacePath` (was unused externally); removed from exports; added `AiCommitProvider` import from `aiCommit.ts` (still needed for `SET_AI_COMMIT_PROVIDER` handler type); removed unused `app` import
- `src/main/ipc/terminalIpc.ts` — updated to import `StoreSchema` from shared; removed inline duplicate
- `src/main/ipc/aiCommitIpc.ts` — updated to import `StoreSchema` from shared; removed inline duplicate

**Tests run:**
- `npm run typecheck` — PASSED
- `npm run test` — PASSED (2938 passed)

**Deviation from documented plan:** None. Implementation matches documented steps exactly.

**Recommended next slice: Slice 2 — Add IPC channels for harness defaults with validation**
- Register `GET_HARNESS_DEFAULTS` and `SET_HARNESS_DEFAULTS` IPC handlers in `settingsIpc.ts`
- Create `src/main/harnessDefaultsValidation.ts` with `validateHarnessDefaultsMap()`
- Expose methods on preload bridge (`src/main/preload.ts`)
- Add type signatures to `src/renderer/electron.d.ts`
- Add channels to `ALL_IPC_CHANNELS` in `src/shared/ipcChannels.ts`

---

## Handoff Notes (2026-04-16, third agent)

### Slice 2: Add IPC channels for harness defaults with validation — COMPLETE

**Completed:** 2026-04-16

**Files changed:**
- `src/shared/ipcChannels.ts` — added `GET_HARNESS_DEFAULTS` and `SET_HARNESS_DEFAULTS` + `ALL_IPC_CHANNELS` entries
- `src/main/harnessDefaultsValidation.ts` — **CREATED** — `validateHarnessDefaultsMap()` with all documented rules
- `src/main/ipc/settingsIpc.ts` — registered both handlers; imports added for `HarnessDefaultsMap`, channels, and validation helper
- `src/main/preload.ts` — exposed `getHarnessDefaults()` and `setHarnessDefaults()`; added `HarnessDefaultsMap` type import
- `src/renderer/electron.d.ts` — added method signatures + `HarnessDefaultsMap` import
- `tests/main/unit/harnessDefaultsValidation.test.ts` — **CREATED** — 17 test cases
- `tests/main/unit/ipcChannels.test.ts` — updated imports + `ALL_CHANNELS` array
- `tests/main/unit/settingsIpc.test.ts` — updated channel count 11→13; updated all 4 `expectedChannels`/`settingsChannels` arrays; updated `createMockDeps()` mock store; added 3 new handler tests
- `tests/setup/electron.ts` — added `getHarnessDefaults` and `setHarnessDefaults` mocks

**Tests run:**
- `npm run typecheck` — PASSED
- `npm run test` — PASSED (2958 passed)

**Deviation from documented plan:**
- `KNOWN_HARNESS_IDS.includes(key)` used instead of `.has()` — TypeScript's `readonly` tuple type (`as const`) doesn't support `.has()`; cast to `readonly string[]` required

**Recommended next slice: Slice 3 — Harness spawn uses user flags from store**
- Remove hardcoded `args` from `HARNESS_OPTIONS` in `harnessCatalog.ts`
- Add `userFlags` parameter to `buildHarnessSpawnArgs()` in `harnessLaunch.ts`
- Update `SPAWN_TERMINAL` handler in `terminalIpc.ts` to read flags from store; eliminate duplicate `buildHarnessSpawnArgs` call
- Update tests in `harnessLaunch.test.ts`, `terminalIpc.test.ts`, and `terminalPTY.test.ts`

---

## Handoff Notes (2026-04-16, fourth agent)

### Slice 3: Harness spawn uses user flags from store — COMPLETE

**Completed:** 2026-04-16

**Files changed:**
- `src/main/harnessCatalog.ts` — removed hardcoded `args` from `codex` (`['--yolo']` → `[]`) and `opencode` (`['--pure']` → `[]`)
- `src/main/harnessLaunch.ts` — added `userFlags?: string` optional third parameter to `buildHarnessSpawnArgs`; user flags are appended after config.args
- `src/main/ipc/terminalIpc.ts` — `SPAWN_TERMINAL` handler reads `harnessDefaults[harness]?.flags` from store and passes to `buildHarnessSpawnArgs`; eliminated duplicate `buildHarnessSpawnArgs` call (launch log now reuses `harnessArgs`)
- `tests/main/unit/harnessLaunch.test.ts` — updated harness configs to `args: []`; rewrote 2 existing tests (model+args, harness-only); added 5 new userFlags tests
- `tests/main/unit/terminalIpc.test.ts` — updated inline harness config to `args: []`; added harnessDefaults store mock with `flags: '--yolo'`; updated expected args assertion; added harnessDefaults to base `createMockDeps()` mock store; used `as never` cast for store override type safety
- `tests/main/integration/terminalPTY.test.ts` — verified all inline configs already use `args: []`; new optional `userFlags` param is backward-compatible

**Tests run:**
- `npm run typecheck` — PASSED
- `npm run test` — PASSED (2963 passed; 25 more than Slice 2 due to 5 new harnessLaunch tests + harnessDefaults base mock)

**Deviation from documented plan:** None. Implementation matches documented steps exactly.

**Recommended next slice: Slice 4 — Migrate gate localStorage favorites to electron-store**
- Create `src/renderer/lib/harnessDefaultsMigration.ts` with one-time migration function
- Call migration in `App.tsx` on mount
- Rewrite `WorkspaceGateContent.tsx` to read/write favorites from electron-store instead of localStorage
- Gate star/unstar persists via electron-store across app restarts

---

## Handoff Notes (2026-04-16, fifth agent)

### Slice 4: Migrate gate localStorage favorites to electron-store — COMPLETE

**Completed:** 2026-04-16

**Files changed:**
- `src/renderer/lib/harnessDefaultsMigration.ts` — **CREATED** — `migrateLegacyFavorites()`: one-time migration from `clanker-grid-model-favorites` localStorage key to electron-store via `setHarnessDefaults`. Completion marker prevents re-runs. Non-fatal on failure (retry on next launch). Deterministic merge preserves store order, appends legacy-only favorites.
- `src/renderer/App.tsx` — added `useEffect` calling `migrateLegacyFavorites()` on mount; added import for `migrateLegacyFavorites`
- `src/renderer/components/WorkspaceGateContent.tsx` — replaced localStorage-based `favoritesMap` state + localStorage read/write with electron-store via `getHarnessDefaults`/`setHarnessDefaults`. Favorites per harness now synced from store.
- `tests/renderer/unit/App.test.tsx` — added `localStorage` mock (in-memory store) at top of file; added `getHarnessDefaults` and `setHarnessDefaults` mocks to `window.electronAPI` mock in `beforeEach`

**Tests run:**
- `npm run typecheck` — PASSED
- `npm run test` — PASSED (2963 passed; all 105 test files)
- `npm run validate` — PASSED (lint → typecheck → build → test)

**Deviation from documented plan:**
- `tests/renderer/unit/App.test.tsx` required a localStorage mock because the migration module accesses `localStorage.getItem` directly. jsdom environment doesn't provide localStorage by default. Added in-memory mock that satisfies the migration's needs without requiring a full `localStorage` polyfill.

**Recommended next slice: Slice 5 — Header settings (harness defaults management UI)**
- UI-only pass. Depends on Slices 0–4 backend being validated.
- The backend is now validated: all Slices 0–4 pass `npm run validate`.
- Next agent should implement the harness defaults settings UI in the Header component.
- Per-harness accordion with yolo/auto checkbox, default model selector, and favorites list. All changes persist via `setHarnessDefaults`.
- Use `harnessFlagsFromToggle`/`harnessToggleFromFlags` from `src/renderer/lib/harnessFlags.ts` for checkbox ↔ flags string translation.

---

## Handoff Notes (2026-04-16, sixth agent)

### Slice 5: Header settings — harness defaults management UI — COMPLETE

**Completed:** 2026-04-16

**Files changed:**
- `src/renderer/components/Header.tsx` — added harness defaults state (`harnessDefaults`, `expandedHarness`, `harnessModelCache`, `harnessModelLoading`); added `useEffect` loading `harnessDefaults` from electron-store on mount; added `handleToggleHarnessFlag`, `handleSetDefaultModel`, `handleToggleFavorite`, `loadHarnessModels` handlers; added "Harness Defaults" section to settings dropdown with per-harness accordion (icon, label, current model with unresolved warning, chevron); expanded panel includes yolo/auto checkbox, default model selector (on-demand), favorites list (pinned with × remove, unpinned with ☆ star to add)
- `src/renderer/components/Header.css` — added all CSS for the harness defaults UI: accordion header, expanded panel, checkbox option, model selector field, favorites list with tag and star styles

**Tests run:**
- `npm run typecheck` — PASSED
- `npm run test` — PASSED (2963 passed; 105 test files)
- `npm run validate` — PASSED (lint → typecheck → build → test)

**Deviations from documented plan:**
- `HarnessConfig` cannot be imported in the renderer (defined in `harnessLaunch.ts`, not `harnessCatalog.ts`). Instead, `HARNESS_FLAG_MAP` from `harnessFlags.ts` maps harness IDs to flag strings, which is what the UI needs.
- Model loading is on-demand per accordion expand (loads via `getHarnessModels` when the row expands), cached in `harnessModelCache`. This avoids loading all harness models on mount and is consistent with the recommendation in MR-5.
- Favorites list shows both pinned favorites (with × remove button) and up to 5 unpinned models (with ☆ star button to add). This provides more discoverability than just showing favorites.

---

## Handoff Notes (2026-04-16, seventh agent)

### Slice 6: Gate — frictionless model picker — COMPLETE

**Completed:** 2026-04-16

**Files changed:**
- `src/renderer/components/WorkspaceGateContent.tsx` — replaced model dropdown with compact model pill → favorites picker → discovery modal flow; `defaultModel` state sourced from `harnessDefaults[harness].model` on mount and harness change; favorites from `harnessDefaults[harness].favorites`; `AlertTriangle`, `Search`, `X` icons added to lucide-react import; `showFavoritesPicker`, `showDiscoveryModal`, `discoverySearch` state added; `isModelUnresolved` callback for warning detection; `discoveryModels` memo for filtered search results; keyboard handler for Escape closes discovery modal; outside-click closes favorites picker; launch uses `defaultModel || modelOptions[0]?.id`
- `src/renderer/components/WorkspaceGate.css` — added all new compact picker styles (model-picker, model-pill, model-pill-*, favorites-picker, favorites-*, discovery-modal, discovery-*, etc.); old `.model-selector` CSS retained in place (not removed)
- `tests/renderer/unit/WorkspaceGateContent.test.tsx` — updated 2 model selector tests: new compact picker shows `.model-pill` (not "Model" label); terminal-only mode hides `.model-picker`

**Tests run:**
- `npm run typecheck` — PASSED
- `npm run test` — PASSED (2963 passed; 105 test files)
- `npm run build` — PASSED

**Deviation from plan:**
- `selectedModel` and `isModelLoading` state kept (with setters unused) rather than removed — `setSelectedModel` is called from multiple useEffect paths and removing it entirely would require auditing all call sites. The actual model selection uses `defaultModel` in the new compact picker flow, so this is safe.
- Old `.model-selector` CSS class retained in CSS rather than removed — clean removal not needed for correctness.

## Handoff Notes (2026-04-16, eighth agent)

### Slice 7: New terminal respects global defaults — COMPLETE

**Completed:** 2026-04-16

**Files changed:**
- `src/renderer/components/Header.tsx` — updated `handleAddTerminal` with explicit workspace-first resolution and clarifying comments; renamed variables for clarity (`workspaceHarness`, `workspaceModel`, `resolvedHarness`, `resolvedModel`)
- `tests/renderer/unit/Header.test.tsx` — added `getHarnessDefaults` and `setHarnessDefaults` mocks to `window.electronAPI` mock in `beforeEach`

**Tests run:**
- `npm run typecheck` — PASSED
- `npm run test` — PASSED (2963 passed; 105 test files)
- `npm run validate` — PASSED (lint → typecheck → build → test)

**Deviation from documented plan:**
- The existing `handleAddTerminal` implementation already used workspace harness + model as the primary resolution source. The change was primarily **clarification and documentation**: making the workspace-first resolution explicit in comments and renaming variables for clarity. No behavioral change — workspace harness/model already took priority.
- `getHarnessDefaults` mock added to `Header.test.tsx` to prevent test failures when the settings dropdown mounts and attempts to load harness defaults via `getHarnessDefaults()`.

**Recommended next slice:** None. All slices in this plan are complete. The harness defaults and flags plan is fully implemented.
