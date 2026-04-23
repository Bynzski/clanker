# Gap Analysis — Segmented Edge Drop Zones Plan v1.1

**Reviewer:** Pi (automated review)
**Date:** 2026-04-23
**Plan version reviewed:** 1.0 → 1.1 (first review), 1.1 → 1.2 (second review)
**Status:** Second review found 12 new gaps and 5 minor issues. See New Gaps below.

---

## First Review Summary (v1.0 → v1.1)

The plan was well-structured with clear phase boundaries, correct file paths, and reasonable scope per phase. First review found 12 gaps and 4 minor issues. All resolved in PLAN.md v1.1.

---

## Second Review Summary (v1.1 → v1.2)

Second review deep-verified every line number, function signature, import path, and test file against the repo. Found **12 new gaps** and **5 minor issues**. Several are P0/P1 — specifically the missing test file updates, missing re-export wiring, and line number inaccuracies that will mislead an executing agent.

**Verdict:** Plan needs targeted updates before safe execution. The phase structure and algorithms are sound, but the file-level details have drift.

---

## New Gaps (Second Review)

### Gap 13 — `DynamicPaneLayout.test.tsx` Missing from Phase 2 Scope (P0)

**What's missing:** Phase 2 replaces `DockEdgeTargets` with `SegmentedDockEdgeTargets`, but doesn't list `tests/renderer/unit/DynamicPaneLayout.test.tsx` in "Files to Modify". This file has 1239 lines and 93 tests, including a dedicated `DockEdgeTargets` test section at line 670 with 7 tests:

- `renders four dock edges`
- `overlay does not have dragging class initially`
- `overlay gets dragging class when drag starts`
- `shows over class on left edge` (also right, top, bottom)

**Repo truth:**
```
tests/renderer/unit/DynamicPaneLayout.test.tsx (1239 lines, 93 tests)
  describe('DockEdgeTargets', () => { ... })    // line 670
```

These tests directly query DOM elements like `screen.getByText('Dock left')`, `.dock-edge-overlay`, `.dock-left.over`, etc. When `DockEdgeTargets` is replaced with `SegmentedDockEdgeTargets`, ALL of these tests will break.

**Impact:** Phase 2 validation (`npm run validate`) will fail immediately. The agent will be blocked.

**Resolution:** Add `tests/renderer/unit/DynamicPaneLayout.test.tsx` to Phase 2 "Files to Modify". Add scope item: `[ ] Update DockEdgeTargets test section to test SegmentedDockEdgeTargets rendering and zone visibility`. Add context file reference.

---

### Gap 14 — `DynamicPaneLayout.test.tsx` Missing from Phase 3 Scope (P0)

**What's missing:** Phase 3 modifies `handleDragEnd` and `handleDragOver` in `DynamicPaneLayout.tsx`, but doesn't mention updating the corresponding tests. The test file has dedicated test sections:

- `describe('handleDragOver', () => { ... })` — line 779, tests `dock-` prefix parsing
- `describe('handleDragEnd', () => { ... })` — line 852, tests `dock-` prefix routing to `dockPaneToEdge`

**Repo truth:**
```
tests/renderer/unit/DynamicPaneLayout.test.tsx
  describe('handleDragOver', () => { ... })     // line 779
  describe('handleDragEnd', () => { ... })      // line 852
```

Current `handleDragEnd` test:
```typescript
it('calls dockPaneToEdge when dropped on dock zone', () => {
  const mockDock = vi.fn();
  setupStoreWithLayout(createLeaf('n1', 'p1'), { dockPaneToEdge: mockDock });
  render(<DynamicPaneLayout />);
  act(() => {
    mocks.dndCallbacks.onDragEnd({ active: { id: 'p1' }, over: { id: 'dock-left' } });
  });
  expect(mockDock).toHaveBeenCalledWith('p1', 'left');
});
```

After Phase 3, `dock-left` is no longer a valid droppable ID. The IDs become `dock-left-full` and `dock-left-gap-0`, etc. This test (and others in the same section) will fail.

**Impact:** Phase 3 validation will fail.

**Resolution:** Add `tests/renderer/unit/DynamicPaneLayout.test.tsx` to Phase 3 "Files to Modify". Add scope items for updating handler tests to use new ID format and testing both `dock-{edge}-full` and `dock-{edge}-gap-{index}` routing.

---

### Gap 15 — Missing `workspaceStore.ts` Re-export in Phase 0/2 (P0)

**What's missing:** Phase 2 says "Import `getEdgeTerminals`, `getEdgeGaps`, `DockEdge` from `../store/workspaceStore` (re-exported from `workspaceLayout.ts`)" — but `workspaceStore.ts` does NOT re-export anything from `workspaceLayout.ts`. It only imports functions for internal use.

**Repo truth (`workspaceStore.ts`):**
```typescript
// Line 3-17: imports from workspaceLayout (internal use only)
import { buildWorkspaceLayout, collectLeafPaneIds, dockPaneToEdgeInLayout, ... } from './workspaceLayout';

// Line 56-69: re-exports from workspaceTypes only
export type { BrowserPaneState, LayoutNode, ... } from './workspaceTypes';

// Line 70: re-exports everything from workspaceStoreHelpers
export * from './workspaceStoreHelpers';
```

There is no `export ... from './workspaceLayout'` statement. `DynamicPaneLayout.tsx` currently imports types from `../store/workspaceStore` (which re-exports from `workspaceTypes`), but functions like `dockPaneToEdgeInLayout` are NOT available through the store — they're only imported by the store internally.

**Impact:** Phase 2 will get a compile error when trying to import `getEdgeTerminals` from `../store/workspaceStore`.

**Resolution:** Add to Phase 0 scope: `[ ] Add re-export of new types and functions from workspaceLayout.ts in workspaceStore.ts: export type { DockEdge, EdgeTerminal, EdgeGap } from './workspaceLayout'; export { getEdgeTerminals, getEdgeGaps } from './workspaceLayout';`. Alternatively, Phase 2 can import directly from `../store/workspaceLayout` — but this breaks the import convention documented in the plan. The re-export approach is consistent with the existing pattern for `workspaceTypes` and `workspaceStoreHelpers`.

---

### Gap 16 — `handleDragCancel` Missing `overGapIndex` Cleanup in Phase 3 (P1)

**What's missing:** Phase 3 adds `overGapIndex` state and mentions updating `handleDragEnd` and `handleDragOver`, but doesn't mention `handleDragCancel`.

**Repo truth (`DynamicPaneLayout.tsx` line 442):**
```typescript
const handleDragCancel = useCallback(() => {
  setActivePaneId(null);
  setOverPaneId(null);
  setOverDockEdge(null);
}, []);
```

When a drag is cancelled, `overGapIndex` must also be cleared, or the next drag will show stale gap highlighting.

**Impact:** Visual bug — cancelled drag leaves a gap zone highlighted.

**Resolution:** Add to Phase 3 scope: `[ ] Clear overGapIndex in handleDragCancel (setOverGapIndex(null))`.

---

### Gap 17 — Line Number Inaccuracies in GAP-ANALYSIS.md Function Table (P1)

**What's wrong:** The "Function Signatures Verified" table in the first review has incorrect line numbers for 8 of 12 functions. These will mislead an agent trying to navigate to function locations.

**Corrected line numbers (verified against current codebase):**

| Function | Listed Line | Actual Line |
|----------|-------------|-------------|
| `collectLeafPaneIds` | 89 | **111** |
| `removePaneFromLayout` | 194 | **205** |
| `swapPaneIdsInLayout` | 213 | **230** |
| `dockPaneToEdgeInLayout` | 256 | 256 ✅ |
| `setSplitRatioInLayout` | 290 | **288** |
| `findFirstLeafPaneId` | 314 | **315** |
| `insertPaneIntoLayout` | 354 | **366** |
| `normalizeLayoutRoot` | 371 | **383** |
| `buildWorkspaceLayout` | 415 | **431** |
| `resolveWorkspaceByScope` | 250 | 250 ✅ |
| `patchWorkspaceById` | 366 | 366 ✅ |
| `validateWorkspaceConsistency` | 415 | 415 ✅ |

**Resolution:** Update the function signatures table in this document.

---

### Gap 18 — Phase 2 Context Line Reference "DnD setup (line 358)" is Wrong (P2)

**What's wrong:** Phase 2 context files say "DnD setup (`DndContext`, `PointerSensor`, collision detection) — `src/renderer/components/DynamicPaneLayout.tsx`" with implied line 358.

**Repo truth:**
- Line 358 = `const isInteractive = useScopedWorkspaceActivity(workspaceId);`
- `DndContext` is at line 460
- Sensor setup is at lines 367-372
- `edgeFriendlyCollisionDetection` is at line 351 ✅

**Resolution:** Update Phase 2 context to use correct line references: sensors at 367, DndContext at 460.

---

### Gap 19 — Integration Test Location Not Specified (P1)

**What's missing:** The plan's Testing Strategy lists "Integration Tests: Store action `insertPaneAtEdgeGap` correctly updates layout and triggers re-render" but doesn't specify where. Phase 5 only lists `workspaceLayout.test.ts`.

**Repo truth:**
`tests/renderer/integration/workspaceStore.test.ts` — existing integration tests for store actions including `dockPaneToEdge`. This is the natural location.

**Resolution:** Add `tests/renderer/integration/workspaceStore.test.ts` to Phase 3 or Phase 5 "Files to Modify". Add scope item for store action integration test.

---

### Gap 20 — `useWorkspaceStore()` Destructuring Not Mentioned in Phase 3 (P1)

**What's missing:** Phase 3 says to wire the new action but doesn't mention adding `insertPaneAtEdgeGap` to the `useWorkspaceStore()` destructuring in `DynamicPaneLayout.tsx`.

**Repo truth (`DynamicPaneLayout.tsx` line 359):**
```typescript
const { swapPanes, dockPaneToEdge } = useWorkspaceStore();
```

After Phase 3, this needs to become:
```typescript
const { swapPanes, dockPaneToEdge, insertPaneAtEdgeGap } = useWorkspaceStore();
```

**Impact:** Compile error — `insertPaneAtEdgeGap` is undefined in the component.

**Resolution:** Add to Phase 3 scope: `[ ] Add insertPaneAtEdgeGap to useWorkspaceStore() destructuring in DynamicPaneLayout.tsx (line 359)`.

---

### Gap 21 — DnD ID Backward Compatibility Not Documented (P1)

**What's missing:** The plan introduces `dock-{edge}-full` as the new full-edge zone ID, replacing the current `dock-{edge}` IDs. But it doesn't explicitly call out that this is a **breaking change** to the DnD ID scheme. The transition needs to be documented.

**Current IDs:** `dock-left`, `dock-right`, `dock-top`, `dock-bottom`
**New IDs:** `dock-left-full`, `dock-right-full`, `dock-top-full`, `dock-bottom-full` + gap zones

This affects:
1. `handleDragEnd` — currently parses `overId.slice(5)` to get edge
2. `handleDragOver` — currently parses `overId.slice(5)` to get edge
3. `DockEdgeTargets` — currently uses `id: 'dock-left'` etc.
4. All tests referencing these IDs

**Impact:** An agent might try to keep both old and new IDs, or fail to understand the full scope of changes.

**Resolution:** Add a note to Phase 2/3: "This is a complete replacement of the DnD ID scheme. Old IDs (`dock-left` etc.) are replaced with `dock-{edge}-full` and `dock-{edge}-gap-{index}`. No backward compatibility needed."

---

### Gap 22 — Phase 2 Component Extraction Should Be Required (P1)

**What's missing:** Phase 2 says "Consider extracting SegmentedDockEdgeTargets to a separate file if the component grows large." This is too vague.

**Repo truth:** `DynamicPaneLayout.tsx` is already 479 lines. The current `DockEdgeTargets` is 20 lines. The new `SegmentedDockEdgeTargets` will be significantly larger (computing zones per edge, rendering 5+ droppable elements per edge, memoization logic). Adding it inline would push the file well over 550 lines, approaching the 800-line threshold from AGENTS.md.

**Impact:** Code maintainability risk.

**Resolution:** Make extraction a firm requirement. Add to Phase 2 scope: `[ ] Extract SegmentedDockEdgeTargets to new file src/renderer/components/DockEdgeTargets.tsx`. Update "New Files" to include this file. This keeps `DynamicPaneLayout.tsx` focused on layout rendering and DnD orchestration.

---

### Gap 23 — `handleDragEnd` Dependency Array Missing in Phase 3 (P2)

**What's missing:** Phase 3 adds `insertPaneAtEdgeGap` to `handleDragEnd`, but doesn't mention updating the `useCallback` dependency array.

**Repo truth (`DynamicPaneLayout.tsx` line 440):**
```typescript
}, [dockPaneToEdge, isInteractive, swapPanes, workspaceId]);
```

After adding `insertPaneAtEdgeGap`, this must become:
```typescript
}, [dockPaneToEdge, insertPaneAtEdgeGap, isInteractive, swapPanes, workspaceId]);
```

**Impact:** Stale closure bug — `insertPaneAtEdgeGap` would be captured with an old reference.

**Resolution:** Add to Phase 3 scope: `[ ] Add insertPaneAtEdgeGap to handleDragEnd useCallback dependency array`.

---

### Gap 24 — `handleDragOver` Needs New Parsing Logic for `overDockEdge` (P0)

**What's missing:** The plan mentions adding `overGapIndex` state and parsing for `handleDragOver`, but doesn't call out that the existing `overDockEdge` parsing will BREAK with the new IDs.

**Repo truth (`DynamicPaneLayout.tsx` lines 389-392):**
```typescript
if (overId.startsWith('dock-')) {
  setOverDockEdge(overId.slice(5) as DockEdge);  // "dock-left" → "left"
  setOverPaneId(null);
  return;
}
```

With new IDs like `dock-left-gap-0`, `overId.slice(5)` produces `left-gap-0`, which cannot be cast to `DockEdge`. The `handleDragOver` needs the SAME new parsing logic as `handleDragEnd` to extract the edge portion.

**Impact:** `handleDragOver` will cast `left-gap-0` as `DockEdge`, causing incorrect active edge state and broken visual feedback.

**Resolution:** Add to Phase 3 scope: `[ ] Update handleDragOver dock- ID parsing to extract edge from new ID format (dock-{edge}-gap-{index} or dock-{edge}-full). Use same parsing logic as handleDragEnd.`

---

## Minor Issues (Second Review)

### M5 — Phase 3 Context Line "import pattern from `./workspaceLayout` (line 16)" Imprecise

The workspaceLayout import block spans lines 3-17 in `workspaceStore.ts`. Line 16 is `removePaneFromLayout,` — a middle entry in the import list, not a meaningful reference point.

**Resolution:** Change to "import block from `./workspaceLayout` (lines 3–17)" or just "import from `./workspaceLayout`".

---

### M6 — Phase 3 Context Line "workspaceStoreTypes.ts action signatures at lines 145–147"

`dockPaneToEdge` is at line 146. But the section containing layout action signatures spans a larger range. A more useful reference would be: "action signature at line 146".

**Resolution:** Update to specific line.

---

### M7 — PLAN.md "Existing Patterns" Store Action Line Range

Plan says "Store action pattern (`workspaceStore.ts` lines 1069–1092)". The actual `dockPaneToEdge` action spans lines 1069-1095 (the closing `})` is at 1095). The range is approximately right but slightly off.

**Resolution:** Update to "lines 1069–1095".

---

### M8 — `getLeafAreaMap` Not Referenced as Pattern for `getEdgeTerminals`

The existing `getLeafAreaMap` function (line 150) traverses the tree accumulating area ratios — which is very similar to what `getEdgeTerminals` needs to do (traverse edge subtree accumulating perpendicular offsets/spans). Referencing this pattern would help the implementing agent.

**Resolution:** Add to Phase 0 context: "Reference `getLeafAreaMap` (line 150) as a pattern for ratio-aware tree traversal."

---

### M9 — `clamp` Helper Not Mentioned for Ratio Computation

The `clamp` function at line 29 is used by `createLayoutSplit` to constrain ratios to [0.1, 0.9]. The new `insertPaneAtEdgeGapInLayout` function will need to produce ratios for new splits, and should use `clamp` for the same constraint.

**Resolution:** Add to Phase 1 context: "Use `clamp` helper (line 29) for ratio constraints in new splits, consistent with `createLayoutSplit`."

---

## First Review Gaps (v1.0 → v1.1) — Preserved for History

| # | Gap | Priority | Status |
|---|-----|----------|--------|
| 1 | Layout orientation semantics | P0 | ✅ Resolved in v1.1 |
| 2 | Store action pattern | P0 | ✅ Resolved in v1.1 |
| 3 | Missing file in existence table | P1 | ✅ Resolved in v1.1 |
| 4 | DnD ID parsing convention | P0 | ✅ Resolved in v1.1 |
| 5 | layoutRevision increment | P0 | ✅ Resolved in v1.1 |
| 6 | workspaceStoreTypes action signature | P0 | ✅ Resolved in v1.1 |
| 7 | Type import path note | P1 | ✅ Resolved in v1.1 |
| 8 | DockEdge type extraction | P1 | ✅ Resolved in v1.1 |
| 9 | Phase 1 algorithm outline | P0 | ✅ Resolved in v1.1 |
| 10 | validateWorkspaceConsistency in scope | P1 | ✅ Resolved in v1.1 |
| 11 | No-op guard | P1 | ✅ Resolved in v1.1 |
| 12 | Active gap zone state | P0 | ✅ Resolved in v1.1 |
| M1 | Context file omission | P1 | ✅ Resolved in v1.1 |
| M2 | Collision detection note | P2 | ✅ Resolved in v1.1 |
| M3 | File size concern | P2 | ✅ Resolved in v1.1 |
| M4 | Test import pattern | P2 | ✅ Resolved in v1.1 |

---

## Action Items (Second Review)

| # | Gap | Priority | Status | Resolution Target |
|---|-----|----------|--------|-------------------|
| 13 | DynamicPaneLayout.test.tsx missing from Phase 2 | P0 | 🔲 Open | Phase 2 scope + files |
| 14 | DynamicPaneLayout.test.tsx missing from Phase 3 | P0 | 🔲 Open | Phase 3 scope + files |
| 15 | workspaceStore re-export missing | P0 | 🔲 Open | Phase 0 scope |
| 16 | handleDragCancel overGapIndex cleanup | P1 | 🔲 Open | Phase 3 scope |
| 17 | Line number inaccuracies | P1 | 🔲 Open | This document |
| 18 | DnD setup line reference wrong | P2 | 🔲 Open | Phase 2 context |
| 19 | Integration test location unspecified | P1 | 🔲 Open | Phase 5 scope + files |
| 20 | useWorkspaceStore destructuring | P1 | 🔲 Open | Phase 3 scope |
| 21 | DnD ID backward compat documentation | P1 | 🔲 Open | Phase 2/3 notes |
| 22 | Component extraction should be required | P1 | 🔲 Open | Phase 2 scope + new file |
| 23 | handleDragEnd dependency array | P2 | 🔲 Open | Phase 3 scope |
| 24 | handleDragOver parsing for overDockEdge | P0 | 🔲 Open | Phase 3 scope |
| M5 | Import block line reference | P2 | 🔲 Open | Phase 3 context |
| M6 | workspaceStoreTypes line reference | P2 | 🔲 Open | Phase 3 context |
| M7 | Store action line range | P2 | 🔲 Open | PLAN.md patterns |
| M8 | getLeafAreaMap pattern reference | P2 | 🔲 Open | Phase 0 context |
| M9 | clamp helper reference | P2 | 🔲 Open | Phase 1 context |

---

## Files Verified to Exist

| File | Lines | Status |
|------|-------|--------|
| `src/renderer/store/workspaceTypes.ts` | — | ✅ Exists — defines `LayoutNode`, `LayoutLeaf`, `LayoutSplit` |
| `src/renderer/store/workspaceStoreTypes.ts` | — | ✅ Exists — `WorkspaceState` interface, `dockPaneToEdge` at line 146 |
| `src/renderer/store/workspaceLayout.ts` | 447 | ✅ Exists — layout tree operations |
| `src/renderer/store/workspaceStore.ts` | 1688 | ✅ Exists — Zustand store, `dockPaneToEdge` at line 1069 |
| `src/renderer/store/workspaceStoreHelpers.ts` | 515 | ✅ Exists — helpers |
| `src/renderer/store/INVARIANTS.md` | — | ✅ Exists — state invariant docs |
| `src/renderer/components/DynamicPaneLayout.tsx` | 479 | ✅ Exists — DnD layout component |
| `src/renderer/components/DynamicPaneLayout.css` | 271 | ✅ Exists — layout styles |
| `src/renderer/components/WorkspaceScope.tsx` | — | ✅ Exists — scoped hooks |
| `tests/renderer/unit/workspaceLayout.test.ts` | 992 | ✅ Exists — 185 test cases |
| `tests/renderer/unit/DynamicPaneLayout.test.tsx` | 1239 | ✅ Exists — 93 test cases |
| `tests/renderer/integration/workspaceStore.test.ts` | — | ✅ Exists — store action tests |

## Function Signatures Verified (Corrected)

| Function | Location | Correct Line |
|----------|----------|-------------|
| `collectLeafPaneIds` | `workspaceLayout.ts` | **111** |
| `removePaneFromLayout` | `workspaceLayout.ts` | **205** |
| `swapPaneIdsInLayout` | `workspaceLayout.ts` | **230** |
| `dockPaneToEdgeInLayout` | `workspaceLayout.ts` | **256** |
| `setSplitRatioInLayout` | `workspaceLayout.ts` | **288** |
| `findFirstLeafPaneId` | `workspaceLayout.ts` | **315** |
| `insertPaneIntoLayout` | `workspaceLayout.ts` | **366** |
| `normalizeLayoutRoot` | `workspaceLayout.ts` | **383** |
| `buildWorkspaceLayout` | `workspaceLayout.ts` | **431** |
| `getLeafAreaMap` | `workspaceLayout.ts` | **150** (private) |
| `resolveWorkspaceByScope` | `workspaceStoreHelpers.ts` | **250** |
| `patchWorkspaceById` | `workspaceStoreHelpers.ts` | **366** |
| `validateWorkspaceConsistency` | `workspaceStoreHelpers.ts` | **415** |

## DynamicPaneLayout.tsx Verified Line Map

| Element | Correct Line |
|---------|-------------|
| `DockEdge` type | **30** |
| `DockEdgeTargets` component | **327** |
| `edgeFriendlyCollisionDetection` | **351** |
| `DynamicPaneLayout` function | **356** |
| `useWorkspaceStore()` destructuring | **359** |
| Sensors setup | **367** |
| `handleDragStart` | **373** |
| `handleDragOver` | **382** |
| `handleDragEnd` | **405** |
| `handleDragCancel` | **442** |
| `<DndContext>` JSX | **460** |
| `<DockEdgeTargets>` JSX | **473** |
