# Plan Quality Checklist — Segmented Edge Drop Zones

Review checklist for `plans/segmented-drop-zones/PLAN.md` v1.2.
First review completed 2026-04-23. Second review completed 2026-04-23.

---

## Plan Document (PLAN.md)

### Header
- [x] Author name filled in — Pi + Jay
- [x] Date is current — 2026-04-22 (original), reviewed 2026-04-23
- [x] Status is correct — Draft
- [x] Version is set — 1.1

### Purpose
- [x] Clear problem statement — replace monolithic edge drop zones with segmented zones
- [x] Explains why this work matters — precise insertion at specific vertical/horizontal position
- [x] No implementation details in purpose section

### Scope
- [x] In-scope items are clearly defined — 7 items with priorities
- [x] Out-of-scope items are explicit — 5 items listed
- [x] Priorities assigned — P0 and P1

### What Already Exists
- [x] All existing components documented — 12 rows including `workspaceStoreHelpers.ts`
- [x] Locations are accurate — all file paths verified to exist
- [x] Status indicators are current — ✅ on all, with line numbers where relevant

### Implementation Plan
- [x] Phase order is logical — Phase 0–5 with dependency chain
- [x] Each phase has clear deliverables — scope checklists per phase
- [x] Phase scopes don't overlap — pure functions (0,1) → component (2) → wiring (3) → CSS (4) → testing (5)
- [x] No phase is too large — each phase is 1–3 files, pure function phases are well-bounded

### Phase Details (per phase)

**Phase 0 — Edge Terminal Detection**
- [x] Scope items are checkable — 5 items including type export, two functions, edge cases, tests
- [x] Out-of-scope prevents gold-plating — 4 items (no React, DOM, store, CSS)
- [x] Files to modify listed — `workspaceLayout.ts`
- [x] New files listed — None
- [x] Context files relevant — `workspaceLayout.ts`, `workspaceTypes.ts`, test file
- [x] Algorithm notes included — references orientation semantics section

**Phase 1 — Edge Gap Insertion Mutation**
- [x] Scope items are checkable — 3 items (function, tests, ratio)
- [x] Out-of-scope prevents gold-plating — 3 items (no React, DOM, CSS)
- [x] Files to modify listed — `workspaceLayout.ts`
- [x] New files listed — None
- [x] Context files relevant — `workspaceLayout.ts` (existing mutation patterns), test file
- [x] Algorithm outline provided — 6-step pseudocode

**Phase 2 — Dynamic Segmented DockEdgeTargets**
- [x] Scope items are checkable — 9 items including component, zones, IDs, memoization, imports
- [x] Out-of-scope prevents gold-plating — 3 items (no mutations, store, CSS animations)
- [x] Files to modify listed — `DynamicPaneLayout.tsx`
- [x] New files listed — None (with extraction option noted)
- [x] Context files relevant — `DynamicPaneLayout.tsx`, CSS, `WorkspaceScope.tsx`
- [x] DnD ID convention specified — format and parsing logic documented

**Phase 3 — Store Integration + DnD Wiring**
- [x] Scope items are checkable — 8 items including action signature, full store pattern, imports, handlers, state
- [x] Out-of-scope prevents gold-plating — 2 items (no CSS, no new layout operations)
- [x] Files to modify listed — `DynamicPaneLayout.tsx`, `workspaceStore.ts`, `workspaceStoreTypes.ts`
- [x] New files listed — None
- [x] Context files relevant — `workspaceStore.ts` (action pattern), `workspaceStoreHelpers.ts`, `workspaceStoreTypes.ts`, `DynamicPaneLayout.tsx`

**Phase 4 — CSS Polish**
- [x] Scope items are checkable — 8 items (positioning, sizing, transitions, feedback, edge cases)
- [x] Out-of-scope prevents gold-plating — 2 items (no functional changes, no animation framework)
- [x] Files to modify listed — `DynamicPaneLayout.css`
- [x] New files listed — None
- [x] Context files relevant — `DynamicPaneLayout.css`

**Phase 5 — Validation and Final Testing**
- [x] Scope items are checkable — 5 items (validate, tests, smoke tests)
- [x] Out-of-scope prevents gold-plating — 2 items (no new features, no visual changes)
- [x] Files to modify listed — `workspaceLayout.test.ts`
- [x] New files listed — None
- [x] Context files relevant — all modified files from previous phases

### File Structure
- [x] All existing files marked ✅
- [x] Files to modify marked 🔧
- [x] New files marked 🆕 — none needed
- [x] File locations accurate — all verified to exist
- [x] Read-only files noted — `workspaceStoreHelpers.ts`, `workspaceTypes.ts`

### Dependencies
- [x] Dependencies documented — `@dnd-kit/core`, `react-resizable-panels`, layout tree
- [x] Dependency status accurate — all Ready

### Testing Strategy
- [x] Unit tests defined — `getEdgeTerminals`, `getEdgeGaps`, `insertPaneAtEdgeGapInLayout`
- [x] Integration tests defined — store action test
- [x] Smoke tests defined — 5 manual scenarios

### Related Documents
- [x] Links to existing patterns — `AGENTS.md`, source files
- [x] Links to gap analysis — `GAP-ANALYSIS.md`

---

## Agent Prompt (AGENT-PROMPT.md)

### Phase Definitions
- [x] All phases defined — 6 phases in summary table
- [x] Scope matches PLAN.md — verified per-phase scope descriptions
- [x] Out-of-scope matches PLAN.md — references plan for details
- [x] No duplicate tasks across phases — clear separation

### Context Files
- [x] Paths accurate — references `workspaceLayout.ts`, `workspaceStore.ts`, etc.
- [x] Enough context to execute — naming convention table, phase summary with files
- [x] Not overwhelming — summary table + references to PLAN.md details

### Rules
- [x] Follows AGENTS.md principles — references it explicitly
- [x] Clear about layering expectations — naming convention table (pure vs store)
- [x] Testing requirements explicit — `npm run validate` in rules

### Commit Format
- [x] Type choices make sense — `feat(segmented-drop-zones)`
- [x] Scope is clear — `segmented-drop-zones`
- [x] Format is repeatable — template provided

### Hard Stops
- [x] Covers critical failure modes — validation failure, design flaws, missing references, out-of-scope fixes
- [x] Instructions to report, not hide problems

---

## Progress Tracking (PROGRESS.md)

### Phase Status
- [x] All 6 phases listed
- [x] Status symbols are correct — all 🔲
- [x] Phase descriptions match PLAN.md — verified scope summaries

### Initial State
- [x] All phases show 🔲 (not started)
- [x] Phase 0 is first — correct (no prereq phase)

### Notes
- [x] Plan version is current — v1.1
- [x] Blocking issues documented — None

### Phase Details
- [x] Each phase has scope, files, and context matching PLAN.md
- [x] Phase 0 mentions `DockEdge` type extraction
- [x] Phase 1 uses `insertPaneAtEdgeGapInLayout` (correct naming)
- [x] Phase 3 references full store action pattern and `workspaceStoreHelpers.ts`
- [x] Phase 2 references DnD ID convention and `edgeFriendlyCollisionDetection`

---

## README

### Index
- [x] All documents listed — 5 files (PLAN, PROGRESS, AGENT-PROMPT, CHECKLIST, GAP-ANALYSIS)
- [x] Status matches actual status — Draft
- [x] Version is current — 1.1

### Scope
- [x] Brief summary — one-paragraph summary
- [x] Phase order matches PLAN.md — same 6 phases in same order

---

## General Quality

### Clarity
- [x] Someone unfamiliar with the codebase could execute this — orientation semantics, algorithm outlines, code patterns provided
- [x] No jargon unexplained — DnD, PTY, layout tree all explained in context
- [x] Acronyms expanded on first use

### Accuracy
- [x] All file paths verified to exist — 9 files checked
- [x] All function signatures verified — 12 functions checked
- [x] All line numbers verified — 7 references checked
- [x] No assumptions about future code — all references to existing code verified

### Completeness
- [x] Nothing is left as "TODO" or "TBD"
- [x] All placeholder values replaced
- [x] Naming convention explicit (`insertPaneAtEdgeGapInLayout` vs `insertPaneAtEdgeGap`)

### Feasibility
- [x] Each phase completable in reasonable time — 1–3 files per phase
- [x] No phase requires too many files to understand — context files listed per phase
- [x] Context loading is manageable — focused lists per phase

---

## Naming Consistency Check

Verified consistent usage across all plan documents:

| Name | Role | Used in |
|------|------|---------|
| `DockEdge` | Type alias | PLAN.md (Phase 0), PROGRESS.md (Phase 0), AGENT-PROMPT.md |
| `getEdgeTerminals` | Pure function | PLAN.md (Phase 0, 1, 2), PROGRESS.md (Phase 0, 1, 2), AGENT-PROMPT.md |
| `getEdgeGaps` | Pure function | PLAN.md (Phase 0, 1, 5), PROGRESS.md (Phase 0, 1), AGENT-PROMPT.md |
| `insertPaneAtEdgeGapInLayout` | Pure layout function | PLAN.md (Phase 1, 3), PROGRESS.md (Phase 1, 3), AGENT-PROMPT.md |
| `insertPaneAtEdgeGap` | Store action | PLAN.md (Phase 3), PROGRESS.md (Phase 3), AGENT-PROMPT.md |
| `SegmentedDockEdgeTargets` | Component | PLAN.md (Phase 2, 3), PROGRESS.md (Phase 2) |
| `dock-{edge}-gap-{index}` | DnD ID format | PLAN.md (Phase 2, 3) |
| `dock-{edge}-full` | DnD ID format | PLAN.md (Phase 2, 3) |
| `overGapIndex` | React state | PLAN.md (Phase 2, 3) |
| `EdgeTerminal` | Type | PLAN.md (Phase 0, 1) |
| `EdgeGap` | Type | PLAN.md (Phase 0, 1) |

---

## Second Review Checklist (v1.1 → v1.2)

### Test Coverage
- [x] DynamicPaneLayout.test.tsx identified in Phase 2 scope (Gap 13)
- [x] DynamicPaneLayout.test.tsx identified in Phase 3 scope (Gap 14)
- [x] Integration test location specified: workspaceStore.test.ts (Gap 19)
- [x] handleDragCancel cleanup covered (Gap 16)

### Import/Export Wiring
- [x] workspaceStore re-export added to Phase 0 scope (Gap 15)
- [x] useWorkspaceStore destructuring added to Phase 3 scope (Gap 20)
- [x] handleDragEnd dependency array update documented (Gap 23)

### Line Number Accuracy
- [x] Function line numbers corrected in GAP-ANALYSIS.md (Gap 17)
- [x] Phase 2 context line references corrected (Gap 18)
- [x] Store action pattern line range corrected to 1069–1095 (M7)
- [x] Import block reference corrected to lines 3–17 (M5)
- [x] workspaceStoreTypes action signature at line 146 (M6)

### DnD ID Scheme
- [x] Backward compatibility documented — complete replacement, no compat needed (Gap 21)
- [x] handleDragOver parsing fix documented (Gap 24)
- [x] Component extraction required in Phase 2 (Gap 22)

### Pattern References
- [x] getLeafAreaMap referenced as ratio-aware traversal pattern (M8)
- [x] clamp helper referenced for ratio constraints (M9)

---

## Sign-Off

- [x] Author has reviewed all sections
- [x] File paths have been verified against codebase (second pass — all correct)
- [x] Dependencies are resolved
- [x] All line numbers verified against current codebase
- [x] All test files accounted for in phase scope
- [ ] Status updated from Draft to Approved — pending human approval
