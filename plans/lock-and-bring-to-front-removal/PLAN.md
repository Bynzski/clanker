# Lock Pane & Bring-to-Front Removal Plan

**Author:** Jay  
**Date:** 2026-04-29  
**Status:** Draft | In Review  
**Version:** 1.2

---

## 1. Purpose

Remove two undermaintained features from the codebase:

1. **Lock Pane** — The `locked` field on panes was never fully enforced. Users who lock panes expecting protection from accidental closure get no such guarantee. GitHub issue #4 tracks this bug. Rather than fix all the enforcement points, we will remove the lock feature entirely.

2. **Bring-to-Front** (`bringPaneIntoView`, `bringBrowserIntoView`, `bringEditorIntoView`) — Allows users to "focus" a hidden/parked pane by bringing it into view. This predates the enhanced drop zones and workspace residency model. With `parked` workspaces now kept alive and visible with `visibility: hidden`, this function is no longer necessary. `bringEditorIntoView` is the editor equivalent of the terminal/browser variants and is also removed.

Both features leave significant dead code when removed. This plan ensures complete removal with no regression.

---

## 2. Scope

### In-Scope

| # | Item | Priority |
|---|------|----------|
| 0 | Remove lock icon + toggle logic from `TerminalPane.tsx` | P0 |
| 1 | Remove lock icon + toggle logic from `BrowserPanel.tsx` | P0 |
| 2 | Remove lock icon + toggle logic from `EditorPane.tsx` | P0 |
| 3 | Remove `locked` field from `Pane`, `BrowserPaneState`, `EditorPaneState` types | P0 |
| 4 | Remove `togglePaneLock`, `toggleBrowserLock`, `toggleEditorLock` store actions | P0 |
| 5 | Remove lock guards in `addTerminal`, `toggleBrowser`, `toggleEditorPane` | P0 |
| 5a | Update `findTargetPaneForInsert` in `workspaceLayout.ts` after removing `findLargestUnlockedLeaf` | P0 |
| 6 | Remove `isLeafLocked`, `isSubtreeLocked` helpers from `DynamicPaneLayout.tsx` | P0 |
| 7 | Remove `findPaneLock`, `hasUnlockedLeaf`, `findLargestUnlockedLeaf` from `workspaceLayout.ts` | P0 |
| 8 | Remove `bringPaneIntoView`, `bringBrowserIntoView`, `bringEditorIntoView` store actions | P0 |
| 9 | Remove `bringPaneIntoView` and `bringBrowserIntoView` UI from all pane components | P0 |
| 10 | Remove `bringPaneIntoView`, `bringBrowserIntoView`, `bringEditorIntoView`, `canAddPane` from `workspaceStoreTypes.ts` | P0 |
| 11 | Clean `locked` assignments from `workspaceStoreHelpers.ts` and store actions | P0 |
| 12 | Remove `canAddPane` call sites in `Header.tsx` and `FileExplorer/index.tsx` | P0 |
| 13 | Update INVARIANTS.md | P0 |
| 14 | Update existing tests / remove lock-specific test cases | P0 |
| 15 | Run `npm run validate` | P0 |

### Out-of-Scope

- Removing `RESIZE_LOCK_MS` (100ms coalescing for pane resize) — unrelated to lock pane feature
- Toast/notification implementation for lock (never existed)
- Any VCS/credential domain changes
- New features or refactoring outside this removal scope

---

## 3. What Already Exists (Do Not Recreate)

| Item | File | Notes |
|------|------|-------|
| `togglePaneLock`, `toggleBrowserLock`, `toggleEditorLock` | `workspaceStore.ts` | To be removed |
| `bringPaneIntoView`, `bringBrowserIntoView`, `bringEditorIntoView` | `workspaceStore.ts` | To be removed |
| `canAddPane` | `workspaceStore.ts` | To be removed (uses `hasUnlockedLeaf`, gates removed lock guards) |
| `hasUnlockedLeaf`, `findLargestUnlockedLeaf` | `workspaceLayout.ts` | To be removed |
| `findPaneLock` | `workspaceLayout.ts` | To be removed |
| `isLeafLocked`, `isSubtreeLocked` | `DynamicPaneLayout.tsx` | To be removed |
| Lock icon buttons | `TerminalPane.tsx`, `BrowserPanel.tsx`, `EditorPane.tsx` | To be removed |
| Bring-to-front buttons (`LocateFixed`) | `TerminalPane.tsx`, `BrowserPanel.tsx` | To be removed |
| `locked` field | `Pane`, `BrowserPaneState`, `EditorPaneState` | To be removed from types |
| Lock guards | `addTerminal`, `toggleBrowser`, `toggleEditorPane` | To be removed |
| `locked` assignments | `workspaceStoreHelpers.ts` (3 places) | To be removed (will cause TS errors if skipped) |
| `locked` assignments in store actions | `workspaceStore.ts` (5 places) | To be removed (will cause TS errors if skipped) |
| `RESIZE_LOCK_MS` | `TerminalPane.tsx` | Unrelated; keep |
| `resizeLockRef` | `TerminalPane.tsx` | Unrelated; keep |

---

## 4. Audit Findings

### 4a. Lock Feature — Complete Inventory

#### Types (to be removed from `workspaceTypes.ts`)

| Type | Field | Line |
|------|-------|------|
| `Pane` | `locked?: boolean` | ~20 |
| `BrowserPaneState` | `locked: boolean` | ~28 |
| `EditorPaneState` | `locked: boolean` | ~37 |

#### Helpers with `locked` assignments (to be cleaned in `workspaceStoreHelpers.ts`)

| Function | Line | Assignment | Notes |
|---------|------|-----------|-------|
| `createDefaultBrowserPane` | ~89 | `locked: false` | Must remove; causes TS error after `locked` removed from type |
| `sanitizeBrowserPane` | ~67 | `locked: pane.locked ?? false` | Must remove; causes TS error after `locked` removed from type |
| `sanitizeWorkspace` | ~236 | `locked: workspace.editorPane.locked ?? false` | Must remove; causes TS error after `locked` removed from type |

#### Store Actions (to be removed from `workspaceStore.ts`)

| Action | Line | Dependencies |
|--------|------|---------------|
| `bringPaneIntoView` | 1140 | `findPaneLock`, layout traversal |
| `bringBrowserIntoView` | 1171 | `swapPaneIdsInLayout` |
| `togglePaneLock` | 1202 | `findPaneLock`, `workspace` |
| `toggleBrowserLock` | 1220 | `browserPane.locked` |
| `canAddPane` | 1379 | `hasUnlockedLeaf` (removed in Phase 3); only used to gate lock guards |
| `toggleEditorLock` | 1737 | `editorPane.locked` |
| `bringEditorIntoView` | 1754 | `swapPaneIdsInLayout` |

> **Note on action line ordering:** Actions are defined in document order in `workspaceStore.ts`. The line numbers above are from the current file and were verified against the source.

#### `locked` Assignments in Store Actions (must be removed — cause TS errors after type removal)

| Function | Line | Assignment | Notes |
|----------|------|-----------|-------|
| `toggleBrowser` | 475, 481 | `locked: nextBrowserPane.locked ?? false` in browserPane spread (two separate return paths) | Causes TS error after `locked` removed from type |
| `updateBrowserPosition` | 1052 | `locked: state.browserPane.locked ?? false` in browserPane spread | Causes TS error after `locked` removed from type |
| `openFileInEditor` | ~1449 | `locked: false` in `nextEditorPane` fallback object | Causes TS error after `EditorPaneState.locked` removed; not listed in original plan |
| `toggleEditorPane` | ~1664 | `locked: false` in `nextEditorPane` fallback object | Causes TS error after `EditorPaneState.locked` removed; adjacent to the lock guard at line 1673 |
| `toggleBrowserLock` | 1228 | `locked: !workspace.browserPane.locked` | Part of action body; removed with action |
| `toggleEditorLock` | 1745 | `locked: !workspace.editorPane.locked` | Part of action body; removed with action |
| `togglePaneLock` | 1210 | `locked: !(pane.locked ?? false)` | Part of action body; removed with action |

#### Lock Guards in Store (to be removed)

| Function | Line | Purpose |
|----------|------|---------|
| `addTerminal` guard | 340 | Prevent terminal creation when all panes locked; includes `console.warn` |
| `toggleBrowser` show guard | 452 | Prevent browser show when all panes locked; includes `console.warn` |
| `toggleEditorPane` show guard | 1673 | Prevent editor show when all panes locked; includes `console.warn` |

> **Note:** Line numbers for the three lock guards were verified. The `addTerminal` guard is at line 340; the `toggleBrowser` guard is at line 452. Both guards appear in the same general area but at distinct lines.

#### UI Components (lock buttons to be removed)

| Component | Lock icon lines | Toggle handler |
|-----------|----------------|----------------|
| `TerminalPane.tsx` | ~264 | `handleToggleLock` → `togglePaneLock` |
| `BrowserPanel.tsx` | ~N/A | `handleToggleLock` → `toggleBrowserLock` |
| `EditorPane.tsx` | ~N/A | `handleToggleLock` → `toggleEditorLock` |

#### Layout Helpers (to be removed from `workspaceLayout.ts`)

| Function | Line | Purpose |
|----------|------|---------|
| `findPaneLock` | 139 | Returns lock state for a pane; used by `hasUnlockedLeaf` and `findLargestUnlockedLeaf` |
| `hasUnlockedLeaf` | 151 | Checks if any leaf in layout is unlocked; **exported** from `workspaceLayout.ts` |
| `findLargestUnlockedLeaf` | 515 | Finds largest unlocked leaf for insertion; **not exported** (private) |

> **Note on `findTargetPaneForInsert`:** This function (line ~537) calls `findLargestUnlockedLeaf`. After removing `findLargestUnlockedLeaf`, `findTargetPaneForInsert` must be updated (see Phase 3b) or it will fail to compile. The plan includes this update in Phase 3b.

#### Layout Helpers (to be removed from `DynamicPaneLayout.tsx`)

| Function | Lines | Purpose |
|----------|-------|---------|
| `isLeafLocked` | ~38 | Check if leaf pane is locked |
| `isSubtreeLocked` | ~52 | Check if subtree is locked; used in `Panel disabled` prop |

### 4b. Bring-to-Front — Complete Inventory

| Item | File | Line | Notes |
|------|------|------|-------|
| `bringPaneIntoView` type | `workspaceStoreTypes.ts` | — | To be removed |
| `bringPaneIntoView` action | `workspaceStore.ts` | 1140 | To be removed |
| `handleBringIntoView` + `LocateFixed` button | `TerminalPane.tsx` | — | Button click handler; to be removed |
| `bringBrowserIntoView` type | `workspaceStoreTypes.ts` | — | To be removed |
| `bringBrowserIntoView` action | `workspaceStore.ts` | 1171 | To be removed (swaps browser pane to front) |
| `handleBringIntoView` + `LocateFixed` button | `BrowserPanel.tsx` | — | Button click handler; to be removed |
| `bringEditorIntoView` type | `workspaceStoreTypes.ts` | 178 | To be removed |
| `bringEditorIntoView` action | `workspaceStore.ts` | 1754 | To be removed (swaps editor pane to front) |

> **Note:** `bringEditorIntoView` was missing from the original plan. It follows the same pattern as `bringPaneIntoView` and `bringBrowserIntoView` but operates on the editor pane. There is no UI button for it, so only the store action and type need removal. It is included in Phase 1b (types), Phase 1d (action), and Phase 4 (tests).

### 4c. Existing Tests to Review

| Test File | Lock/Bring-related Tests |
|-----------|--------------------------|
| `workspaceStore.test.ts` (integration) | Tests may use `locked` field in fixtures; tests for `togglePaneLock`, `toggleBrowserLock`, `bringPaneIntoView`, `bringBrowserIntoView`, `canAddPane` |
| `editorStore.test.ts` | Tests for `toggleEditorLock` and `bringEditorIntoView` |
| `workspaceLayout.test.ts` | Tests for `hasUnlockedLeaf`, `findLargestUnlockedLeaf` |
| `DynamicPaneLayout.test.tsx` | Tests for `isLeafLocked`, `isSubtreeLocked` |
| `workspaceStoreHelpers.test.ts` | Test for `sanitizeBrowserPane` lock behavior |
| `Header.test.tsx` | Tests for `canAddPane` gating of New Terminal button |

---

## 5. Implementation Plan

### Phase 0 | Audit & Verification ✅ (Done)

- Confirmed lock feature inventory across types, store, UI, layout helpers
- Confirmed `bringPaneIntoView` and `bringBrowserIntoView` inventory
- Identified dead code that will be removed
- Identified `workspaceStoreHelpers.ts` and `workspaceStore.ts` assignments that must be cleaned to avoid TypeScript errors

### Phase 1 | Type & Store Action Removal

**Phase 1a** — Remove `locked` field from types in `workspaceTypes.ts`:
- Remove `Pane.locked?: boolean`
- Remove `BrowserPaneState.locked: boolean`
- Remove `EditorPaneState.locked: boolean`

**Phase 1b** — Remove bring-to-front and `canAddPane` types from `workspaceStoreTypes.ts`:
- Remove `bringPaneIntoView: (paneId: string, workspaceId?: string) => void;`
- Remove `bringBrowserIntoView: (workspaceId?: string) => void;`
- Remove `bringEditorIntoView: (workspaceId?: string) => void;`
- Remove `canAddPane: () => boolean;`

**Phase 1c** — Remove lock-related helpers and exports from `workspaceLayout.ts`:
- Remove `findPaneLock` function definition
- Remove `hasUnlockedLeaf` function definition (exported at line 151)
- Remove `findLargestUnlockedLeaf` function definition (private, not exported)

> **Note on import ordering:** Do not remove the `hasUnlockedLeaf` import from `workspaceStore.ts` in this phase — it is still used by lock guards and `canAddPane` in Phase 1d. Remove the import in Phase 1d alongside the lock guards.

**Phase 1d** — Remove lock actions, bring-to-front actions, and `locked` assignments from `workspaceStore.ts`:
- Remove `hasUnlockedLeaf` import (from Phase 1c deferral — now safe to remove as guards using it are gone)
- Remove `bringPaneIntoView` action definition (line 1140)
- Remove `bringBrowserIntoView` action definition (line 1171)
- Remove `togglePaneLock` action definition (line 1202)
- Remove `toggleBrowserLock` action definition (line 1220)
- Remove `canAddPane` action definition (line 1379)
- Remove `toggleEditorLock` action definition (line 1737)
- Remove `bringEditorIntoView` action definition (line 1754)
- Remove `addTerminal` lock guard and `console.warn('All panes are locked...')` (line 340)
- Remove `toggleBrowser` lock guard and `console.warn('All panes are locked...')` (line 452)
- Remove `toggleEditorPane` lock guard and `console.warn('All panes are locked...')` (line 1673)
- Remove `locked: nextBrowserPane.locked ?? false` from `toggleBrowser` browserPane spread (lines 475, 481 — two separate return paths)
- Remove `locked: state.browserPane.locked ?? false` from `updateBrowserPosition` browserPane spread (line 1052)
- Remove `locked: false` from `openFileInEditor` nextEditorPane fallback object (line ~1449)
- Remove `locked: false` from `toggleEditorPane` nextEditorPane fallback object (line ~1664)

**Phase 1e** — Clean `locked` assignments from `workspaceStoreHelpers.ts` (TypeScript errors will result if skipped after Phase 1a):
- `createDefaultBrowserPane`: Remove `locked: false` from returned object (line ~125)
- `sanitizeBrowserPane`: Remove `locked: pane.locked ?? false` from returned object (line ~107); also remove the `- Defaults "locked" to false.` bullet point from the JSDoc comment above the function (around line 77) — this is dead documentation after the field is removed
- `sanitizeWorkspace`: Remove `locked` from editorPane spread (line ~236)

> **Note on Phase 1 ordering:** Complete Phase 1a → 1e in sequence. Phase 1e must be done before any TypeScript compilation check. Skipping Phase 1e will result in TypeScript errors in `workspaceStoreHelpers.ts` even though types have been updated.

### Phase 2 | UI Component Lock & Bring-to-Front Removal

**Phase 2a** — Remove lock button and bring-to-front UI from `TerminalPane.tsx`:
- Remove `Lock`, `Unlock` imports from lucide-react
- Remove `LocateFixed` import from lucide-react
- Remove `paneLocked` selector (from store destructuring)
- Remove `togglePaneLock` selector (from store destructuring)
- Remove `bringPaneIntoView` selector (from store destructuring)
- Remove `handleToggleLock` callback function
- Remove `handleBringIntoView` callback function
- Remove the `LocateFixed` button (the "Bring into view" button)
- Remove the lock toggle button JSX element

**Phase 2b** — Remove lock button and bring-to-front UI from `BrowserPanel.tsx`:
- Remove `Lock`, `Unlock`, `LocateFixed` imports from lucide-react
- Remove `bringBrowserIntoView` selector (from store destructuring)
- Remove `toggleBrowserLock` selector (from store destructuring)
- Remove `handleToggleLock` function
- Remove `handleBringIntoView` function
- Remove the `LocateFixed` button (the "Bring browser into view" button)
- Remove the lock toggle button JSX element (the button with `handleToggleLock`)
- Remove the small lock indicator in the header: `{browserLocked ? <Lock .../> : null}`

**Phase 2c** — Remove lock button from `EditorPane.tsx`:
- Remove `Lock`, `Unlock` imports from lucide-react
- Remove `editorLocked` selector
- Remove `toggleEditorLock` selector
- Remove `handleToggleLock` function
- Remove lock button JSX element

**Phase 2d** — Remove `canAddPane` call sites from `Header.tsx` and `FileExplorer/index.tsx`:
- `src/renderer/components/Header.tsx`:
  - Remove `canAddPane` from the store destructuring (line ~23)
  - Remove the `if (!canAddPane())` guard (line ~270)
  - Remove the `disabled={!canAddPane()}` attribute from the New Terminal button (line ~471)
  - **Rationale:** After removing lock guards, there is no scenario where the New Terminal button should be disabled. All panes can receive new terminal insertions.
- `src/renderer/components/FileExplorer/index.tsx`:
  - Remove `canAddPane` from the `useWorkspaceStore.getState()` destructuring (line ~494)
  - Remove the `if (!canAddPane()) { return; }` guard (lines ~495–497)

> **Critical:** Phase 2d must be completed in the same sitting as Phase 1d. If `canAddPane` is removed from the store but the call sites remain, the app will crash at runtime with `canAddPane is not a function`.

### Phase 3 | Layout Helper Removal

**Phase 3a** — Remove lock helpers and their usage from `DynamicPaneLayout.tsx`:
- Remove `isLeafLocked` function
- Remove `isSubtreeLocked` function
- Remove `disabled={!isInteractive || (workspace ? isSubtreeLocked(node.first, workspace) : false)}` from the first `Panel` in `SplitView` (around line 271)
- Remove `disabled={!isInteractive || (workspace ? isSubtreeLocked(node.second, workspace) : false)}` from the second `Panel` in `SplitView` (around line 280)

> **Note:** After removing `isSubtreeLocked`, the `disabled` prop on `Panel` components should simply be `disabled={!isInteractive}`. Confirmed: `isLeafLocked` is at line 38, `isSubtreeLocked` at line 52, Panel disabled props at lines 271 and 280.

**Phase 3b** — Remove lock helpers and update `findTargetPaneForInsert` in `workspaceLayout.ts`:
- Remove `findPaneLock` function
- Remove `hasUnlockedLeaf` function
- Remove `findLargestUnlockedLeaf` function
- **Update `findTargetPaneForInsert`** (line ~540): This function has two branches — the active-terminal branch and the `findLargestUnlockedLeaf` fallback. After removing `findLargestUnlockedLeaf`, replace the fallback branch with a local helper that finds the largest leaf by area (without any lock gating). The simplest approach is to inline the largest-leaf logic directly:

  ```typescript
  function findTargetPaneForInsert(layoutRoot, state) {
    if (state.activeTerminalId !== null) {
      const activePane = state.panes.find((pane) => pane.terminalId === state.activeTerminalId);
      if (activePane) {
        const leafIds = collectLeafPaneIds(layoutRoot);
        if (leafIds.includes(activePane.id)) return activePane.id;
      }
    }
    // Fallback: find the largest leaf by area (no lock gating)
    const leaves = getLeafAreaMap(layoutRoot);
    if (leaves.length === 0) return null;
    return leaves.reduce((best, leaf) => leaf.area > (best?.area ?? -1) ? leaf : best, null as { paneId: string; area: number } | null)?.paneId ?? null;
  }
  ```

  > **Critical:** Do not simply return `null` in the fallback — that would prevent new pane insertion when there is no active terminal, which is a behavioral regression. The fallback must still find a suitable insertion point.

  > **Behavioral change (intentional):** The active-terminal branch no longer gates on lock state (previously checked `!findPaneLock(state, activePane.id)`). After removal, the active-terminal branch returns the active pane if it exists in the layout without checking lock — this is correct and intentional, since the lock feature is being removed and the active pane should always be prioritized when it is present.

### Phase 4 | Test Cleanup

**Phase 4a** — Review and update `tests/setup/fixtures.ts`:
- Remove `locked: false` from `createPaneFixture` (around line 48)
- Remove `locked: false` from `createBrowserPaneFixture` (around line 36)

**Phase 4b** — Update unit component tests:
- `tests/renderer/unit/TerminalPane.test.tsx`:
  - Remove `locked` parameter from `createPane()` and `setupStoreWithTerminal()` helpers
  - Remove `bringPaneIntoView` and `togglePaneLock` from store mock objects
  - Remove `describe('lock state')` block (around lines 235–252)
  - Remove `it('calls bringPaneIntoView...')` test (around lines 259–268)
  - Remove `it('calls togglePaneLock...')` test (around lines 272–278)
  - Update `describe('header buttons')` — remove lock button and bring-into-view button assertions
- `tests/renderer/unit/BrowserPanel.test.tsx`:
  - Remove `describe('lock state')` block (around lines 239–268)
  - Remove `describe('lock button')` block (around lines 552–580)
  - Remove `describe('toggleBrowserLock')` block (around lines 598–610)
  - Remove `it('calls bringBrowserIntoView...')` test if present
  - Update all `browserPane` fixtures (remove `locked` field from all object literals)
- `tests/renderer/unit/EditorPane.test.tsx`:
  - Remove `describe('lock button')` block (around lines 252–285)
  - Update all `editorPane` fixtures from `{ id, locked: false }` to `{ id }`
- `tests/renderer/unit/Header.test.tsx`:
  - Remove `describe('pane locked state')` block (around lines 341–356)
  - Update pane fixtures (remove `locked` field)
- `tests/renderer/unit/App.test.tsx`:
  - Update pane fixtures (remove `locked` field)
- `tests/renderer/unit/editorStore.test.ts`:
  - Remove `describe('bringEditorIntoView')` block with both tests (around lines 413–437)
  - Remove `it('toggles editor pane lock state')` test (around lines 387–401)
  - Update all inline `editorPane` fixtures: remove `locked` field

**Phase 4c** — Update unit layout tests:
- `tests/renderer/unit/DynamicPaneLayout.test.tsx`:
  - Remove `describe('isLeafLocked')` block (around lines 1389–1430)
  - Remove `describe('isSubtreeLocked')` block (around lines 1442–1475)
  - Update all pane fixtures (remove `locked` property)
  - Remove any `isSubtreeLocked`-related disabled tests
- `tests/renderer/unit/workspaceLayout.test.ts`:
  - Remove `hasUnlockedLeaf` import
  - Remove `locked` param from `makePane()` and `makeBrowser()` helpers
  - Remove `describe('hasUnlockedLeaf')` block (around lines 331–370)
  - Remove `describe('findLargestUnlockedLeaf')` block if present
  - Update `insertPaneIntoLayout` tests (remove `findPaneLock` usage)
- `tests/renderer/unit/workspaceStoreHelpers.test.ts`:
  - Remove `describe('sanitizeBrowserPane - locked')` block (around lines 309–328)
  - Update all pane/browser/editor fixtures (remove `locked` field from object literals). This affects many fixture definitions throughout the file, not just lines 855/866. Search for `locked:` and remove it from every inline fixture object.
  - Remove `locked: false` from `EditorPaneState` fixtures (lines ~855, ~866)

**Phase 4e** — Update integration tests:
- `tests/renderer/integration/workspaceStore.test.ts`:
  - Remove `it('toggleBrowserLock toggles browser pane locked state')` (around lines 541–547)
  - Remove `it('togglePaneLock toggles locked state')` (around lines 1003–1009)
  - Remove `it('bringPaneIntoView swaps...')` and `it('bringPaneIntoView is no-op...')` (around lines 1084–1097)
  - Remove `it('bringBrowserIntoView swaps...')` and `it('bringBrowserIntoView is no-op...')` (around lines 1100–1110)
  - Remove `it('canAddPane returns false when all panes are locked')` and `it('canAddPane returns true when there are unlocked panes')` (around lines 1171–1181)
  - Update all pane/browser/editor fixtures (remove `locked` field from object literals)

### Phase 5 | Documentation & Invariants Update

**Phase 5a** — Update `INVARIANTS.md`:
- Verify no lock-related documentation exists (INVARIANTS.md currently contains no lock references — this is a verification pass, not a removal pass)
- Add a note in the layout or resource policy sections confirming the lock feature has been removed
- Review any other project documentation (e.g., README) for lock feature references and remove them

**Phase 5b** — Update README or additional documentation if the lock feature was documented anywhere else in the project.

### Phase 6 | Validation

```bash
npm run lint
npm run typecheck
npm run build
npm run test
npm run validate
```

All must pass.

---

## 6. Phase Dependencies

```
Phase 0 (Audit) ──→ Phase 1 (Types & Store Actions)
                            │
                            ├── Phase 2 (UI Lock Removal)
                            │          │
                            │          └── Phase 3 (Layout Helpers)
                            │                     │
                            │                     └── Phase 4 (Test Cleanup)
                            │                                │
                            └── Phase 5 (Documentation) ◄────┘
                                       │
                                       └── Phase 6 (Validate)
```

Phase 2 and Phase 5 can be started in parallel after Phase 1 is complete.

> **Phase 1e is critical:** `workspaceStoreHelpers.ts` must be updated in Phase 1e before any TypeScript typecheck. Skipping it will cause type errors in helpers that reference the removed `locked` field.

---

## 7. File List

| File | Changes |
|------|---------|
| `src/renderer/store/workspaceTypes.ts` | Remove `locked` from `Pane`, `BrowserPaneState`, `EditorPaneState` |
| `src/renderer/store/workspaceStoreTypes.ts` | Remove `bringPaneIntoView`, `bringBrowserIntoView`, `bringEditorIntoView`, `canAddPane` types |
| `src/renderer/store/workspaceStore.ts` | Remove actions: `togglePaneLock`, `toggleBrowserLock`, `toggleEditorLock`, `bringPaneIntoView`, `bringBrowserIntoView`, `bringEditorIntoView`, `canAddPane`; remove `hasUnlockedLeaf` import; remove lock guards and `console.warn` statements; remove `locked` assignments in `updateBrowserPosition`, `toggleBrowser` (two spreads), `openFileInEditor`, `toggleEditorPane` |
| `src/renderer/store/workspaceStoreHelpers.ts` | Remove `locked` assignments from `createDefaultBrowserPane`, `sanitizeBrowserPane`, `sanitizeWorkspace` |
| `src/renderer/store/workspaceLayout.ts` | Remove `findPaneLock`, `hasUnlockedLeaf`, `findLargestUnlockedLeaf`; update `findTargetPaneForInsert` to remove `findLargestUnlockedLeaf` call (replace with inline largest-leaf logic) |
| `src/renderer/components/TerminalPane.tsx` | Remove `Lock`, `Unlock`, `LocateFixed` imports; remove `paneLocked`, `togglePaneLock`, `bringPaneIntoView` selectors; remove `handleToggleLock` and `handleBringIntoView` functions; remove lock button and bring-into-view button JSX |
| `src/renderer/components/BrowserPanel.tsx` | Remove `Lock`, `Unlock`, `LocateFixed` imports; remove `bringBrowserIntoView`, `toggleBrowserLock` selectors; remove `handleToggleLock` and `handleBringIntoView` functions; remove lock button, bring-browser-into-view button, and lock indicator JSX |
| `src/renderer/components/EditorPane.tsx` | Remove `Lock`, `Unlock` imports; remove `editorLocked`, `toggleEditorLock` selectors; remove `handleToggleLock` function; remove lock button JSX |
| `src/renderer/components/DynamicPaneLayout.tsx` | Remove `isLeafLocked`, `isSubtreeLocked` functions; restore `Panel disabled` props to `disabled={!isInteractive}` |
| `src/renderer/components/Header.tsx` | Remove `canAddPane` selector, guard, and disabled attribute |
| `src/renderer/components/FileExplorer/index.tsx` | Remove `canAddPane` guard |
| `src/renderer/store/INVARIANTS.md` | Remove lock feature documentation |
| `tests/setup/fixtures.ts` | Remove `locked: false` from `createPaneFixture` and `createBrowserPaneFixture` |
| `tests/renderer/unit/TerminalPane.test.tsx` | Remove lock/bring tests and helper params; update store mocks |
| `tests/renderer/unit/BrowserPanel.test.tsx` | Remove lock/bring test blocks; update all browserPane fixtures |
| `tests/renderer/unit/EditorPane.test.tsx` | Remove lock test block; update editorPane fixtures |
| `tests/renderer/unit/DynamicPaneLayout.test.tsx` | Remove `isLeafLocked`, `isSubtreeLocked` test blocks; update pane fixtures |
| `tests/renderer/unit/workspaceLayout.test.ts` | Remove `hasUnlockedLeaf` import and test block; update helper functions |
| `tests/renderer/unit/workspaceStoreHelpers.test.ts` | Remove `sanitizeBrowserPane - locked` test block; update all fixtures (remove `locked` from every pane/browser/editor fixture inline object) |
| `tests/renderer/unit/Header.test.tsx` | Remove lock test block; update pane fixtures |
| `tests/renderer/unit/App.test.tsx` | Update pane fixtures (remove `locked`) |
| `tests/renderer/unit/editorStore.test.ts` | Remove `toggleEditorLock` test and `bringEditorIntoView` test block; update editorPane fixtures |
| `tests/renderer/integration/workspaceStore.test.ts` | Remove lock/bring/canAddPane tests; update fixtures |

---

## 8. Testing Strategy

| Test | Type | Description |
|------|------|-------------|
| Lock icon removed from all three pane types | Manual | Verify no lock icons appear in terminal, browser, or editor panes |
| Bring-to-front button removed from terminal and browser | Manual | Verify no `LocateFixed` bring-into-view buttons appear |
| No `locked` field in TypeScript types | Type check | `npm run typecheck` |
| No lock-related warnings on pane operations | Manual | Open terminal/browser/editor normally; no "All panes are locked" warnings |
| Layout resize disabled state works | Manual | Drag dividers; panel resize should work without lock helpers (lock-based disabling removed) |
| `bringPaneIntoView`, `bringBrowserIntoView`, `bringEditorIntoView` removed | Type check | `npm run typecheck` |
| `canAddPane` removed | Type check | `npm run typecheck` |
| Layout operations work without lock helpers | Unit | `workspaceLayout.test.ts` passes |
| Workspace store operations work without lock state | Integration | `workspaceStore.test.ts` passes |

**Key regression scenarios:**
1. Opening a terminal/browser/editor when all panes are "unlocked" (formerly blocked by lock guards) — should now succeed without warnings
2. Closing any pane that was previously "lockable" — should work normally
3. Workspace residency switching (parked → active) — no change; parked workspaces remain with `visibility: hidden`
4. Panel resizing in `DynamicPaneLayout` — `Panel disabled` should now be `!isInteractive` only (lock-based disabling removed)

### Test Impact Analysis

| Test File | Tests to REMOVE | Tests to UPDATE |
|-----------|-----------------|-----------------|
| `tests/setup/fixtures.ts` | — | Remove `locked: false` from `createPaneFixture`, `createBrowserPaneFixture` |
| `tests/renderer/unit/TerminalPane.test.tsx` | `describe('lock state')` block; `it('calls bringPaneIntoView...')`; `it('calls togglePaneLock...')` | Update `setupStoreWithTerminal` (remove `locked` param); update store mock (remove `bringPaneIntoView`, `togglePaneLock`); update header button assertions |
| `tests/renderer/unit/BrowserPanel.test.tsx` | `describe('lock state')` block; `describe('lock button')` block; `describe('toggleBrowserLock')` block; any `bringBrowserIntoView` test | Update all `browserPane` fixtures (remove `locked` field) |
| `tests/renderer/unit/EditorPane.test.tsx` | `describe('lock button')` block | Update all `editorPane` fixtures to `{ id }` (no `locked` field) |
| `tests/renderer/unit/DynamicPaneLayout.test.tsx` | `describe('isLeafLocked')` block; `describe('isSubtreeLocked')` block | Update all pane fixtures (remove `locked` property); remove any `isSubtreeLocked`-related disabled test assertions |
| `tests/renderer/unit/workspaceLayout.test.ts` | `describe('hasUnlockedLeaf')` block; any `findLargestUnlockedLeaf` block | Remove `hasUnlockedLeaf` import; update `makePane` and `makeBrowser` helpers (remove `locked` param); remove `findPaneLock` usage |
| `tests/renderer/unit/workspaceStoreHelpers.test.ts` | `describe('sanitizeBrowserPane - locked')` block | Update **all** pane/browser/editor fixtures throughout the file (remove `locked` from every inline fixture object; not limited to lines 855/866); remove `locked` from `EditorPaneState` fixtures |
| `tests/renderer/unit/Header.test.tsx` | `describe('pane locked state')` block | Update pane fixtures (remove `locked` field) |
| `tests/renderer/unit/editorStore.test.ts` | `it('toggles editor pane lock state')` test; `describe('bringEditorIntoView')` block | Update editorPane fixtures (remove `locked` field) |
| `tests/renderer/unit/App.test.tsx` | — | Update pane fixtures (remove `locked` field) |
| `tests/renderer/integration/workspaceStore.test.ts` | `toggleBrowserLock...` test; `togglePaneLock...` test; `bringPaneIntoView...` tests; `bringBrowserIntoView...` tests; `canAddPane...` tests | Update all pane/browser/editor fixtures (remove `locked` field) |

### Specific Test Changes by File

#### `tests/setup/fixtures.ts`
- `createBrowserPaneFixture`: Remove `locked: false` from returned object (~line 36)
- `createPaneFixture`: Remove `locked: false` from returned object (~line 48)

#### `tests/renderer/unit/TerminalPane.test.tsx`
- `createPane()` helper: Remove `locked` parameter (was at ~line 85)
- `setupStoreWithTerminal()`: Remove `locked` parameter (was at ~line 87)
- Store mock objects: Remove `bringPaneIntoView: vi.fn()` and `togglePaneLock: vi.fn()` (was at ~lines 102, 110, 128)
- `describe('header buttons')`: Remove lock button and bring-into-view button assertions (was at ~lines 221–223)
- `describe('lock state')`: DELETE entire block (was at ~lines 235–252)
- `it('calls bringPaneIntoView...')`: DELETE (was at ~lines 259–268)
- `it('calls togglePaneLock...')`: DELETE (was at ~lines 272–278)

#### `tests/renderer/unit/BrowserPanel.test.tsx`
- `describe('lock state')`: DELETE entire block (was at ~lines 239–268)
- `describe('lock button')`: DELETE entire block (was at ~lines 552–580)
- `describe('toggleBrowserLock')`: DELETE entire block (was at ~lines 598–610)
- Any `it('calls bringBrowserIntoView...')` test: DELETE
- All inline `browserPane` fixture objects: Remove `locked: false` or `locked: true` from each

#### `tests/renderer/unit/EditorPane.test.tsx`
- `describe('lock button')`: DELETE entire block (was at ~lines 252–285)
- All `editorPane` fixtures: Change `{ id: 'editor-1', locked: false }` to `{ id: 'editor-1' }`

#### `tests/renderer/unit/DynamicPaneLayout.test.tsx`
- `describe('isLeafLocked')`: DELETE entire block (was at ~lines 1389–1430)
- `describe('isSubtreeLocked')`: DELETE entire block (was at ~lines 1442–1475)
- All pane fixtures in test file: Remove `locked` property
- Any test asserting `disabled` based on `isSubtreeLocked`: DELETE or update to assert `disabled={!isInteractive}`

#### `tests/renderer/unit/workspaceLayout.test.ts`
- Remove `hasUnlockedLeaf` import (was at ~line 12)
- `makePane()` helper: Remove `locked` parameter (was at ~line 64)
- `makeBrowser()` helper: Remove `locked` parameter (was at ~line 68)
- `describe('hasUnlockedLeaf')`: DELETE entire block (was at ~lines 331–370)
- Any `describe('findLargestUnlockedLeaf')`: DELETE block
- All `insertPaneIntoLayout` test cases that pass a `locked` pane: remove `locked` from pane fixture
- Any test using `findPaneLock` directly: remove or update

#### `tests/renderer/unit/workspaceStoreHelpers.test.ts`
- `describe('sanitizeBrowserPane - locked')`: DELETE entire block (was at ~lines 309–328)
- All pane/browser/editor fixture objects: Remove `locked` field from inline objects
- `EditorPaneState` fixture objects (around lines 855, 866): Remove `locked: false`

#### `tests/renderer/unit/Header.test.tsx`
- `describe('pane locked state')`: DELETE entire block (was at ~lines 341–356)
- All pane fixtures: Remove `locked: false`

#### `tests/renderer/unit/editorStore.test.ts`
- `it('toggles editor pane lock state')`: DELETE (was at ~lines 387–401)

#### `tests/renderer/integration/workspaceStore.test.ts`
- `it('toggleBrowserLock toggles browser pane locked state')`: DELETE (was at ~lines 541–547)
- `it('togglePaneLock toggles locked state')`: DELETE (was at ~lines 1003–1009)
- `it('bringPaneIntoView swaps...')`: DELETE (was at ~lines 1084–1097)
- `it('bringPaneIntoView is no-op...')`: DELETE (was at ~lines 1084–1097)
- `it('bringBrowserIntoView swaps...')`: DELETE (was at ~lines 1100–1110)
- `it('bringBrowserIntoView is no-op...')`: DELETE (was at ~lines 1100–1110)
- `it('canAddPane returns false when all panes are locked')`: DELETE (was at ~lines 1171–1181)
- `it('canAddPane returns true when there are unlocked panes')`: DELETE (was at ~lines 1171–1181)
- All pane/browser/editor fixture objects: Remove `locked` field

---

## 9. Rollback Plan

If issues arise during implementation:

1. **Phase 1 rollback:** Restore types, store actions, and UI components from git
2. **Phase 2–3 rollback:** Restore layout helpers, lock guards, and UI components
3. **Phase 4 rollback:** Restore test fixtures from git

No database migrations or persistence concerns exist (lock state not persisted).

---

## 10. Quality Checklist

- [ ] Phase 0 audit complete
- [ ] Phase 1a: Types updated (`locked` removed from `Pane`, `BrowserPaneState`, `EditorPaneState`)
- [ ] Phase 1b: Types updated (`bringPaneIntoView`, `bringBrowserIntoView`, `bringEditorIntoView`, `canAddPane` removed)
- [ ] Phase 1c: `workspaceLayout.ts` helpers removed (`findPaneLock`, `hasUnlockedLeaf`, `findLargestUnlockedLeaf`)
- [ ] Phase 1d: `workspaceStore.ts` actions removed (`bringPaneIntoView`, `bringBrowserIntoView`, `bringEditorIntoView`, `togglePaneLock`, `toggleBrowserLock`, `toggleEditorLock`, `canAddPane`) + lock guards removed (`addTerminal` line 340, `toggleBrowser` line 452, `toggleEditorPane` line 1673) + `locked` spreads removed (`toggleBrowser` lines 475/481, `updateBrowserPosition` line 1052, `openFileInEditor` line ~1449, `toggleEditorPane` line ~1664) + `hasUnlockedLeaf` import removed
- [ ] Phase 1e: `workspaceStoreHelpers.ts` cleaned (`createDefaultBrowserPane`, `sanitizeBrowserPane`, `sanitizeWorkspace` — no `locked` assignments)
- [ ] Phase 2: `TerminalPane.tsx` — lock button and bring-into-view button removed
- [ ] Phase 2: `BrowserPanel.tsx` — lock button, lock indicator, and bring-into-view button removed
- [ ] Phase 2: `EditorPane.tsx` — lock button removed
- [ ] Phase 2: `Header.tsx` — `canAddPane` selector and all usages removed
- [ ] Phase 2: `FileExplorer/index.tsx` — `canAddPane` guard removed
- [ ] Phase 3: `DynamicPaneLayout.tsx` — `isLeafLocked`, `isSubtreeLocked` removed; `Panel disabled` props restored to `!isInteractive`
- [ ] Phase 3: `workspaceLayout.ts` helpers removed + `findTargetPaneForInsert` updated to use inline largest-leaf logic (no regression in pane insertion)
- [ ] Phase 4: `tests/setup/fixtures.ts` updated
- [ ] Phase 4: `TerminalPane.test.tsx` updated
- [ ] Phase 4: `BrowserPanel.test.tsx` updated
- [ ] Phase 4: `EditorPane.test.tsx` updated
- [ ] Phase 4: `DynamicPaneLayout.test.tsx` updated
- [ ] Phase 4: `workspaceLayout.test.ts` updated
- [ ] Phase 4: `workspaceStoreHelpers.test.ts` updated
- [ ] Phase 4: `Header.test.tsx` updated
- [ ] Phase 4: `App.test.tsx` updated
- [ ] Phase 4: `editorStore.test.ts` updated (removed `toggleEditorLock` test and `bringEditorIntoView` block; updated fixtures)
- [ ] Phase 4: `workspaceStore.test.ts` (integration) updated
- [ ] Phase 5: `INVARIANTS.md` updated
- [ ] No new `any` types introduced
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `npm run test` passes
- [ ] `npm run validate` passes
