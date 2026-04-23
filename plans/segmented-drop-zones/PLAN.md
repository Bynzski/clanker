# Segmented Edge Drop Zones

**Author:** Pi + Jay
**Date:** 2026-04-22 (reviewed 2026-04-23, re-reviewed 2026-04-23)
**Status:** Draft
**Version:** 1.2

---

## Purpose

Replace the four monolithic edge drop zones (left, right, top, bottom) with segmented zones that reflect the actual terminal layout along each edge. Currently, dragging a terminal to the left edge shows one full-height "Dock Left" target. After this change, the edge is subdivided into up to 4 gap zones (between edge terminals) plus a full-edge zone in the center, allowing precise insertion at a specific vertical/horizontal position within the edge column.

The segmented edge drop zones should appear at every valid insertion position along the active edge-aligned row/column, including before the first segment and after the last segment, while preserving the existing full-edge dock zone.

---

## Scope

### In Scope

| Item | Priority | Notes |
|------|----------|-------|
| Detect which terminals sit on each edge of the layout tree | P0 | Pure function over LayoutNode |
| Compute up to 4 segmented gap zones + 1 full-edge zone per edge | P0 | Capped at 4 segments via `maxSegments` param |
| Render dynamic segmented drop zones during drag | P0 | Replaces static `DockEdgeTargets` |
| New layout mutation: insert pane at edge gap position | P0 | `insertPaneAtEdgeGapInLayout` in `workspaceLayout.ts` |
| Wire DnD events to the new insertion operation | P0 | `DynamicPaneLayout.tsx` + store |
| CSS for segmented zones (positioning, hover, transition) | P1 | |
| Unit tests for edge detection and insertion | P0 | Pure functions are easily testable |

### Out of Scope

- Middle-of-grid drop zones (splitting between non-edge terminals)
- Drop zones inside panes (quad-split indicators on hover)
- Tab-based reordering within a pane
- Persistence of drop zone preferences
- Touch/gesture support beyond existing PointerSensor

---

## What Already Exists

| Component | Location | Status |
|-----------|----------|--------|
| Layout tree types (`LayoutLeaf`, `LayoutSplit`, `LayoutNode`) | `src/renderer/store/workspaceTypes.ts` | ✅ Exists |
| `WorkspaceState` interface (action signatures) | `src/renderer/store/workspaceStoreTypes.ts` | ✅ Exists |
| Layout tree operations (split, dock, swap, remove) | `src/renderer/store/workspaceLayout.ts` | ✅ Exists (447 lines) |
| Store helpers (resolve, patch, validate) | `src/renderer/store/workspaceStoreHelpers.ts` | ✅ Exists (515 lines) |
| Zustand store with layout actions | `src/renderer/store/workspaceStore.ts` | ✅ Exists (~1688 lines) |
| Edge dock function `dockPaneToEdgeInLayout` | `src/renderer/store/workspaceLayout.ts:256` | ✅ Exists — kept for full-edge zone |
| `DockEdgeTargets` component (static zones) | `src/renderer/components/DynamicPaneLayout.tsx:327` | ✅ Exists — will be replaced |
| `DockEdge` type alias | `src/renderer/components/DynamicPaneLayout.tsx:30` | ✅ Exists (local type) — needs extraction |
| DnD setup (`DndContext`, `PointerSensor`, collision detection) | `src/renderer/components/DynamicPaneLayout.tsx` | ✅ Exists — extended |
| CSS for current edge zones | `src/renderer/components/DynamicPaneLayout.css` | ✅ Exists — extended |
| Layout unit tests | `tests/renderer/unit/workspaceLayout.test.ts` | ✅ Exists (992 lines, 185 tests) — extended |
| DnD handler + component tests | `tests/renderer/unit/DynamicPaneLayout.test.tsx` | ✅ Exists (1239 lines, 93 tests) — extended |
| Store action integration tests | `tests/renderer/integration/workspaceStore.test.ts` | ✅ Exists — extended |
| Workspace scope hooks | `src/renderer/components/WorkspaceScope.tsx` | ✅ Exists — no changes needed |
| State invariant documentation | `src/renderer/store/INVARIANTS.md` | ✅ Exists — read only |

### Existing Patterns to Follow

#### Layout traversal pattern (`workspaceLayout.ts`)

```typescript
// Clone-and-return — never mutate in place
function collectLeafPaneIds(node: LayoutNode | null): string[] {  // line 111
  if (node == null) return [];
  if (node.type === 'leaf') return [node.paneId];
  return [...collectLeafPaneIds(node.first), ...collectLeafPaneIds(node.second)];
}
```

#### Ratio-aware tree traversal pattern (`workspaceLayout.ts`)

```typescript
// getLeafAreaMap (line 150) — traverses tree accumulating ratio-weighted areas
// Reference this pattern for getEdgeTerminals which needs similar ratio-aware traversal
function getLeafAreaMap(node, area = 100) {
  if (node.type === 'leaf') return [{ paneId: node.paneId, area }];
  return [
    ...getLeafAreaMap(node.first, area * node.ratio),
    ...getLeafAreaMap(node.second, area * (1 - node.ratio)),
  ];
}
```

#### Layout mutation pattern — clone-and-return, never mutate in place

```typescript
function removePaneFromLayout(node: LayoutNode | null, paneId: string): LayoutNode | null { ... }
```

#### Dock edge pattern — remove pane, then wrap

```typescript
function dockPaneToEdgeInLayout(layoutRoot, paneId, edge): LayoutNode | null { ... }
```

#### Store action pattern (`workspaceStore.ts` lines 1069–1095)

Every layout-mutating store action follows this exact pattern:

```typescript
dockPaneToEdge: (paneId, edge, workspaceId) => set((state) => {
  // 1. Resolve workspace
  const workspace = resolveWorkspaceByScope(state, workspaceId);
  if (workspace == null) return state;

  // 2. Call pure layout function
  const nextLayoutRoot = dockPaneToEdgeInLayout(workspace.layoutRoot, paneId, edge);
  if (nextLayoutRoot === workspace.layoutRoot) return state; // no-op guard

  // 3. Build next state with layoutRevision increment + patchWorkspaceById
  const nextState = {
    layoutRoot: nextLayoutRoot,
    layoutRevision: state.layoutRevision + 1,
    ...patchWorkspaceById(state, workspace.id, (currentWorkspace) => ({
      ...currentWorkspace,
      layoutRoot: nextLayoutRoot,
    })),
  };

  // 4. Dev-mode consistency validation
  if (import.meta.env.DEV) {
    const warnings = validateWorkspaceConsistency(nextState);
    if (warnings.length > 0) {
      console.warn('[Dev Only] Workspace consistency violation after dockPaneToEdge:', warnings);
    }
  }

  return nextState;
}),
```

Required imports from `workspaceStoreHelpers` (already available via `export * from './workspaceStoreHelpers'` in `workspaceStore.ts`):
- `resolveWorkspaceByScope` — resolve workspace by optional ID or active scope
- `patchWorkspaceById` — immutable update of workspace tab fields
- `validateWorkspaceConsistency` — dev-mode invariant checks

#### Type import convention

- `workspaceLayout.ts` imports types directly from `./workspaceTypes`
- `workspaceStore.ts` imports types from `./workspaceTypes`, re-exports them, and also imports `WorkspaceState` from `./workspaceStoreTypes`
- `DynamicPaneLayout.tsx` imports types from `../store/workspaceStore` (re-export path)
- Tests import types directly from `../../../src/renderer/store/workspaceTypes`

---

## Layout Tree Orientation Semantics

> **Critical reference for Phase 0 algorithm design.**

The layout tree is a binary split tree where each `LayoutSplit` node has an `orientation`:

| Orientation | First child | Second child | Visual |
|-------------|-------------|--------------|--------|
| `horizontal` | Left | Right | Side-by-side with vertical separator (`col-resize`) |
| `vertical` | Top | Bottom | Stacked with horizontal separator (`row-resize`) |

**Edge detection algorithm per edge:**

| Edge | Follow this child at the edge split | Recurse both children at |
|------|--------------------------------------|--------------------------|
| `left` | `first` of `horizontal` splits | `vertical` splits |
| `right` | `second` of `horizontal` splits | `vertical` splits |
| `top` | `first` of `vertical` splits | `horizontal` splits |
| `bottom` | `second` of `vertical` splits | `horizontal` splits |

**Computing offset/span (perpendicular axis, in [0,1]):**
- Start at the root with `offset = 0`, `span = 1`
- At a parallel split (same orientation as the edge axis): the edge child gets the full span, accumulate ratio
- At a perpendicular split: divide the span by the ratio, recurse into both children

---

## Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| `@dnd-kit/core` 6.3.1 | Ready | Already installed, supports dynamic droppables |
| `react-resizable-panels` 4.9.0 | Ready | Layout rendering, no changes needed |
| Existing layout tree structure | Ready | Binary split tree is sufficient |

---

## Implementation Plan

### Phase Order

| Phase | Description | Depends On |
|-------|-------------|------------|
| 0 | Edge terminal detection (pure functions + tests) | — |
| 1 | Edge gap insertion mutation (pure function + tests) | Phase 0 |
| 2 | Dynamic segmented `DockEdgeTargets` component | Phase 0 |
| 3 | Store integration + DnD wiring | Phase 1, Phase 2 |
| 4 | CSS polish, transitions, edge cases | Phase 3 |
| 5 | Validation and final testing | Phase 4 |

### Phase Details

#### Phase 0 — Edge Terminal Detection

**Purpose:** Pure functions that analyze the layout tree to determine which terminals sit on each edge and their relative positions. Fully testable without React.

**Scope:**
- [ ] Define and export `DockEdge` type from `workspaceLayout.ts` (currently a local type alias in `DynamicPaneLayout.tsx:30`)
- [ ] `getEdgeTerminals(node: LayoutNode | null, edge: DockEdge)` — returns ordered array of `{ paneId: string, offset: number, span: number }` where offset/span are in [0,1] representing the perpendicular axis
- [ ] `getEdgeGaps(edgeTerminals: EdgeTerminal[], maxSegments: number)` — computes up to `maxSegments` gap zones between edge terminals, returns `{ index: number, start: number, end: number, afterPaneId?: string, beforePaneId?: string }`
- [ ] Handle edge cases: single terminal (returns 2 gaps: before and after), empty layout (returns 0 terminals, 1 full gap), deep nesting
- [ ] Add re-export of new types and functions in `workspaceStore.ts`: `export type { DockEdge, EdgeTerminal, EdgeGap } from './workspaceLayout'; export { getEdgeTerminals, getEdgeGaps } from './workspaceLayout';` — required because `DynamicPaneLayout.tsx` imports from `workspaceStore` per the project's import convention
- [ ] Unit tests for all functions

**Out of Scope:**
- No React components
- No DOM measurement
- No store changes
- No CSS

**Files to Modify:**
- `src/renderer/store/workspaceLayout.ts` — add `DockEdge` type export, `getEdgeTerminals`, `getEdgeGaps`, and supporting types (`EdgeTerminal`, `EdgeGap`)
- `src/renderer/store/workspaceStore.ts` — add re-export of new types and functions from `workspaceLayout.ts`

**New Files:**
- None

**Context Files to Read:**
- `src/renderer/store/workspaceLayout.ts` — existing traversal patterns (`collectLeafPaneIds` at line 111, `getLeafAreaMap` at line 150 for ratio-aware traversal pattern)
- `src/renderer/store/workspaceTypes.ts` — `LayoutNode`, `LayoutSplit`, `LayoutLeaf` type definitions
- `src/renderer/store/workspaceStore.ts` — existing import/re-export pattern from `workspaceLayout.ts` (lines 3–17 import, no re-export currently)
- `tests/renderer/unit/workspaceLayout.test.ts` — test patterns (imports types from `workspaceTypes`, stubs `crypto.randomUUID`)

**Algorithm notes:**
- See "Layout Tree Orientation Semantics" section above for edge detection algorithm
- `getEdgeTerminals` walks the tree recursively, accumulating perpendicular offset/span
- `getEdgeGaps` computes gaps between consecutive edge terminals. For N terminals, there are N+1 gaps (before first, between each pair, after last), capped at `maxSegments`

---

#### Phase 1 — Edge Gap Insertion Mutation

**Purpose:** Pure function that takes a layout tree, a pane to insert, an edge, and a gap index, and returns a new layout tree with the pane inserted at that position.

**Scope:**
- [ ] `insertPaneAtEdgeGapInLayout(layoutRoot: LayoutNode | null, paneId: string, edge: DockEdge, gapIndex: number)` — new export from `workspaceLayout.ts` (follows `dockPaneToEdgeInLayout` naming convention)
- [ ] Unit tests: single terminal → inserts at gap (before/after); existing edge column → inserts at gap; move from one gap to another; all 4 edges; null/empty layout
- [ ] Ensure the new pane gets reasonable ratio (equal share of the gap space)

**Algorithm outline:**
```
insertPaneAtEdgeGapInLayout(layoutRoot, paneId, edge, gapIndex):
  1. Remove paneId from layout → trimmedLayout
  2. If trimmedLayout is null, return single leaf (paneId)
  3. Walk the edge subtree of trimmedLayout:
     - For left edge: follow 'first' of horizontal splits
     - For right edge: follow 'second' of horizontal splits
     - For top edge: follow 'first' of vertical splits
     - For bottom edge: follow 'second' of vertical splits
  4. If no edge-aligned split exists at root:
     - Create new root split with correct orientation (horizontal for left/right, vertical for top/bottom)
     - Insert pane as first/second child depending on edge
     - Place trimmedLayout as the other child
  5. If edge subtree exists:
     - Use getEdgeTerminals to find current edge terminals
     - Locate the gap at gapIndex
     - Insert new pane by restructuring the perpendicular splits at that position
     - Use equal ratio for the new split
  6. Return new root (clone-and-return, never mutate)
```

**Out of Scope:**
- No React components
- No DOM or visual logic
- No CSS

**Files to Modify:**
- `src/renderer/store/workspaceLayout.ts` — add `insertPaneAtEdgeGapInLayout`

**New Files:**
- None

**Context Files to Read:**
- `src/renderer/store/workspaceLayout.ts` — `dockPaneToEdgeInLayout` (line 256), `splitLeafByPaneId` (line 168), `removePaneFromLayout` (line 205), `createLayoutSplit` (line 56), `createLayoutLeaf` (line 48), `clamp` helper (line 29, use for ratio constraints), `getEdgeTerminals`, `getEdgeGaps` (from Phase 0)
- `tests/renderer/unit/workspaceLayout.test.ts` — test patterns for layout mutations

---

#### Phase 2 — Dynamic Segmented DockEdgeTargets

**Purpose:** Replace the static `DockEdgeTargets` component with a dynamic version that computes segmented zones from the current layout tree and renders positioned droppable elements.

**Scope:**
- [ ] Extract new `SegmentedDockEdgeTargets` component to `src/renderer/components/DockEdgeTargets.tsx` (required — DynamicPaneLayout.tsx is already 479 lines)
- [ ] `SegmentedDockEdgeTargets` receives `layoutRoot: LayoutNode | null`, `activeEdge: DockEdge | null`, `activeGapIndex: number | null`, `isDragging: boolean`
- [ ] For each edge, call `getEdgeTerminals` → `getEdgeGaps` to compute zones
- [ ] Render up to 4 gap zones + 1 full-edge zone per edge (only the active edge's zones are visible, others remain hidden)
- [ ] Each gap zone gets a unique droppable ID: `dock-{edge}-gap-{index}` (e.g., `dock-left-gap-0`)
- [ ] Full-edge zone ID: `dock-{edge}-full` (e.g., `dock-left-full`)
- [ ] Gap zone data includes `{ edge, gapIndex }` for use in `handleDragEnd`
- [ ] Component only re-renders when `layoutRoot` or drag state changes (memoize)
- [ ] Import `DockEdge`, `EdgeTerminal`, `EdgeGap`, `getEdgeTerminals`, `getEdgeGaps` from `../store/workspaceStore` (re-exported from `workspaceLayout.ts` by Phase 0)
- [ ] Update `DynamicPaneLayout.tsx` to import and use `SegmentedDockEdgeTargets` from `./DockEdgeTargets`
- [ ] Remove the old inline `DockEdgeTargets` function from `DynamicPaneLayout.tsx`
- [ ] Remove the local `DockEdge` type alias from `DynamicPaneLayout.tsx` (now imported from store)
- [ ] Update existing `DockEdgeTargets` tests in `DynamicPaneLayout.test.tsx` to test the new component
- [ ] **Note:** This is a complete replacement of the DnD ID scheme. Old IDs (`dock-left` etc.) are replaced with `dock-{edge}-full` and `dock-{edge}-gap-{index}`. No backward compatibility needed.

**DnD ID Convention:**
```
dock-{edge}-gap-{index}   → gap zone (e.g., dock-left-gap-0, dock-left-gap-3)
dock-{edge}-full          → full-edge zone (e.g., dock-left-full)

Parsing in handleDragOver/handleDragEnd:
  const prefix = 'dock-';
  if (overId.startsWith(prefix)) {
    const rest = overId.slice(prefix.length);  // e.g., "left-gap-0" or "left-full"
    const edgePart = rest.split('-')[0];        // e.g., "left"
    const typePart = rest.slice(edgePart.length + 1); // e.g., "gap-0" or "full"
    if (typePart === 'full') {
      // Route to existing dockPaneToEdge action
    } else if (typePart.startsWith('gap-')) {
      const gapIndex = parseInt(typePart.slice(4), 10);
      // Route to new insertPaneAtEdgeGap action
    }
  }
```

**Out of Scope:**
- No layout mutations (that's Phase 3)
- No store changes
- No CSS animations (that's Phase 4)

**Files to Modify:**
- `src/renderer/components/DynamicPaneLayout.tsx` — replace `DockEdgeTargets` import with `SegmentedDockEdgeTargets` from `./DockEdgeTargets`, remove old inline `DockEdgeTargets` function (line 327) and local `DockEdge` type (line 30)
- `tests/renderer/unit/DynamicPaneLayout.test.tsx` — update `DockEdgeTargets` test section (line 670) for new component and ID scheme

**New Files:**
- `src/renderer/components/DockEdgeTargets.tsx` — extracted `SegmentedDockEdgeTargets` component

**Context Files to Read:**
- `src/renderer/components/DynamicPaneLayout.tsx` — current `DockEdgeTargets` (line 327), `DockEdge` type (line 30), `edgeFriendlyCollisionDetection` (line 351), sensors (line 367), `<DndContext>` JSX (line 460)
- `src/renderer/components/DynamicPaneLayout.css` — current edge zone styles (`.dock-edge`, `.dock-edge-overlay`, `.dock-left/.dock-right/.dock-top/.dock-bottom`)
- `src/renderer/components/WorkspaceScope.tsx` — `useScopedWorkspace` and `useScopedWorkspaceActivity` hooks used in parent component
- `tests/renderer/unit/DynamicPaneLayout.test.tsx` — existing `DockEdgeTargets` tests (line 670), mock patterns

---

#### Phase 3 — Store Integration + DnD Wiring

**Purpose:** Connect the dynamic drop zones to the store's layout mutation functions and update the DnD event handlers.

**Scope:**
- [ ] Add `insertPaneAtEdgeGap` action signature to `WorkspaceState` interface in `workspaceStoreTypes.ts` (near line 146, next to `dockPaneToEdge`)
- [ ] Add `insertPaneAtEdgeGap` action to the store in `workspaceStore.ts` following the full store action pattern (lines 1069–1095):
  1. Resolve workspace with `resolveWorkspaceByScope`
  2. Call `insertPaneAtEdgeGapInLayout` pure function
  3. No-op guard: return unchanged state if layout reference is same
  4. Build `nextState` with `layoutRevision: state.layoutRevision + 1`
  5. Apply `patchWorkspaceById` to update workspace tab
  6. Dev-mode `validateWorkspaceConsistency` check
- [ ] Import `insertPaneAtEdgeGapInLayout` from `./workspaceLayout` in `workspaceStore.ts` (add to existing import block at lines 3–17)
- [ ] Update `handleDragEnd` in `DynamicPaneLayout.tsx` (line 405) to parse new DnD ID convention and route to correct action:
  - `dock-{edge}-full` → existing `dockPaneToEdge` action
  - `dock-{edge}-gap-{index}` → new `insertPaneAtEdgeGap` action
- [ ] Update `handleDragOver` (line 382) to use new parsing logic for both `overDockEdge` and `overGapIndex`:
  - Extract edge from new ID format (`dock-left-gap-0` → edge=`left`, gapIndex=0)
  - Current `overId.slice(5) as DockEdge` will NOT work with new IDs — must use the parsing convention from Phase 2
- [ ] Add `overGapIndex` state: `const [overGapIndex, setOverGapIndex] = useState<number | null>(null)`
- [ ] Clear `overGapIndex` in `handleDragCancel` (line 442): `setOverGapIndex(null)`
- [ ] Pass `activeGapIndex={overGapIndex}` to `SegmentedDockEdgeTargets`
- [ ] Add `insertPaneAtEdgeGap` to `useWorkspaceStore()` destructuring in `DynamicPaneLayout.tsx` (line 359)
- [ ] Add `insertPaneAtEdgeGap` to `handleDragEnd` useCallback dependency array (line 440)
- [ ] Preserve existing `edgeFriendlyCollisionDetection` function (line 351)
- [ ] Update DnD handler tests in `DynamicPaneLayout.test.tsx`:
  - Update `handleDragOver` tests (line 779) for new ID parsing
  - Update `handleDragEnd` tests (line 852) for `dock-{edge}-full` and `dock-{edge}-gap-{index}` routing
  - Add test for `insertPaneAtEdgeGap` being called with correct arguments

**Out of Scope:**
- No new CSS (Phase 4)
- No new layout operations

**Files to Modify:**
- `src/renderer/components/DynamicPaneLayout.tsx` — `handleDragEnd` (line 405), `handleDragOver` (line 382), `handleDragCancel` (line 442), `useWorkspaceStore()` destructuring (line 359), add `overGapIndex` state
- `src/renderer/store/workspaceStore.ts` — add `insertPaneAtEdgeGap` action, add `insertPaneAtEdgeGapInLayout` import (lines 3–17)
- `src/renderer/store/workspaceStoreTypes.ts` — add action signature to `WorkspaceState` interface (near line 146)
- `tests/renderer/unit/DynamicPaneLayout.test.tsx` — update `handleDragOver` tests (line 779), `handleDragEnd` tests (line 852) for new ID scheme

**New Files:**
- None

**Context Files to Read:**
- `src/renderer/store/workspaceStore.ts` — `dockPaneToEdge` action (line 1069), import block from `./workspaceLayout` (lines 3–17), `./workspaceStoreHelpers` (lines 33–55)
- `src/renderer/store/workspaceStoreHelpers.ts` — `resolveWorkspaceByScope` (line 250), `patchWorkspaceById` (line 366), `validateWorkspaceConsistency` (line 415)
- `src/renderer/store/workspaceStoreTypes.ts` — `WorkspaceState` interface, `dockPaneToEdge` signature at line 146
- `src/renderer/components/DynamicPaneLayout.tsx` — current handlers: `handleDragStart` (line 373), `handleDragOver` (line 382), `handleDragEnd` (line 405), `handleDragCancel` (line 442), `useWorkspaceStore()` destructuring (line 359)
- `tests/renderer/unit/DynamicPaneLayout.test.tsx` — `handleDragOver` tests (line 779), `handleDragEnd` tests (line 852), mock setup patterns

---

#### Phase 4 — CSS Polish, Transitions, Edge Cases

**Purpose:** Visual refinement of the segmented drop zones — positioning, hover states, transitions, and edge case handling.

**Scope:**
- [ ] CSS for segmented gap zones: positioned absolutely within the edge overlay, heights computed from gap percentages
- [ ] Gap zones: narrow strips (~8-12px) with subtle background, expanding on hover
- [ ] Full-edge zone: centered, same width/height as current dock edges
- [ ] Smooth transitions for zone appearance/disappearance
- [ ] Visual feedback when hovering a gap zone (highlight + preview line showing where the split will happen)
- [ ] Edge case: when there are fewer terminals than `maxSegments`, show only actual gaps
- [ ] Edge case: when a single terminal fills the edge, show gaps above/below (for left/right) or left/right (for top/bottom)
- [ ] Ensure zones don't overlap with pane content during drag

**Out of Scope:**
- No functional changes (all done in Phase 3)
- No animation framework

**Files to Modify:**
- `src/renderer/components/DynamicPaneLayout.css` — new zone styles

**New Files:**
- None

**Context Files to Read:**
- `src/renderer/components/DynamicPaneLayout.css` — existing dock-edge styles (`.dock-edge`, `.dock-left`, `.dock-right`, `.dock-top`, `.dock-bottom`, `.dock-edge-label`, `.dock-edge-overlay`)

---

#### Phase 5 — Validation and Final Testing

**Purpose:** Run full validation pipeline, add any missing tests, verify all edge cases.

**Scope:**
- [ ] `npm run validate` passes (lint, typecheck, build, test)
- [ ] Additional unit tests for `getEdgeGaps` edge cases (empty, 1 terminal, max segments cap)
- [ ] Additional unit tests for `insertPaneAtEdgeGapInLayout` edge cases
- [ ] Integration test for store action `insertPaneAtEdgeGap` in `workspaceStore.test.ts`
- [ ] Manual smoke test: drag terminal to each edge, verify zones appear correctly
- [ ] Manual smoke test: drop into each zone type, verify layout updates correctly

**Out of Scope:**
- No new features
- No visual changes

**Files to Modify:**
- `tests/renderer/unit/workspaceLayout.test.ts` — additional test cases
- `tests/renderer/integration/workspaceStore.test.ts` — store action integration test for `insertPaneAtEdgeGap`

**New Files:**
- None

**Context Files to Read:**
- All modified files from previous phases
- `tests/renderer/integration/workspaceStore.test.ts` — existing integration test patterns for store actions

---

## File Structure

Legend: ✅ exists, 🔧 modify, 🆕 new

```
src/renderer/
├── components/
│   ├── DynamicPaneLayout.tsx       ✅ → 🔧 (Phases 2, 3)
│   ├── DockEdgeTargets.tsx         🆕 (Phase 2 — extracted SegmentedDockEdgeTargets)
│   └── DynamicPaneLayout.css       ✅ → 🔧 (Phase 4)
├── store/
│   ├── workspaceLayout.ts          ✅ → 🔧 (Phases 0, 1)
│   ├── workspaceStore.ts           ✅ → 🔧 (Phases 0, 3)
│   ├── workspaceStoreTypes.ts      ✅ → 🔧 (Phase 3)
│   ├── workspaceStoreHelpers.ts    ✅ (read only, used in Phase 3 pattern)
│   └── workspaceTypes.ts           ✅ (read only, type definitions)
tests/renderer/
├── unit/
│   ├── workspaceLayout.test.ts              ✅ → 🔧 (Phases 0, 1, 5)
│   └── DynamicPaneLayout.test.tsx            ✅ → 🔧 (Phases 2, 3)
└── integration/
    └── workspaceStore.test.ts               ✅ → 🔧 (Phase 5)
```

---

## Testing Strategy

### Unit Tests
- [ ] `getEdgeTerminals` — all 4 edges, nested splits, single leaf, null
- [ ] `getEdgeGaps` — cap at maxSegments, 0/1/2/many terminals
- [ ] `insertPaneAtEdgeGapInLayout` — insert at each gap index, all 4 edges, move within same edge, move across edges
- [ ] Existing tests continue to pass (regression)

### Integration Tests
- [ ] Store action `insertPaneAtEdgeGap` correctly updates layout and triggers re-render

### Smoke Tests
- [ ] App launches without errors
- [ ] Dragging a terminal shows segmented zones on the nearest edge
- [ ] Dropping into a gap zone inserts the pane at the correct position
- [ ] Dropping into the full-edge zone behaves like the current dock behavior
- [ ] Swapping panes still works (no regression)

---

## Related Documents

- `AGENTS.md` — Architecture principles, validation pipeline
- `src/renderer/store/workspaceLayout.ts` — Existing layout operations
- `src/renderer/components/DynamicPaneLayout.tsx` — Current DnD implementation
- `GAP-ANALYSIS.md` — Detailed gap analysis (all 16 items resolved in v1.1)

---

## Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-04-22 | Pi + Jay | Initial draft |
| 1.1 | 2026-04-23 | Pi | Gap analysis — filled all 12 gaps and 4 minor issues; added orientation semantics section, store action pattern, DnD ID convention, type import notes, algorithm outlines |
| 1.2 | 2026-04-23 | Pi | Second review — 12 new gaps + 5 minor issues: added DynamicPaneLayout.test.tsx to Phases 2/3, required DockEdgeTargets.tsx extraction, added workspaceStore re-export to Phase 0, corrected line numbers, added handleDragCancel/overGapIndex cleanup, added handleDragOver parsing fix, added integration test location, corrected Phase 3 dependency array |
