# Agent Directive: Execute Segmented Drop Zones Plan Phase

Self-contained instructions for an agent to execute one phase of the Segmented Edge Drop Zones plan.

---

## Plan Identity

- **Plan path:** `plans/segmented-drop-zones/`
- **Plan name:** Segmented Edge Drop Zones
- **Plan version:** 1.2
- **Full plan:** `plans/segmented-drop-zones/PLAN.md`

---

## How It Works

1. **Read progress** — Load `plans/segmented-drop-zones/PROGRESS.md`. Find the first phase with status:
   - 🔲 (not started) → this is the next phase
   - 🔧 (in progress) → resume this phase

2. **Read plan** — Load `plans/segmented-drop-zones/PLAN.md`. Study the target phase section:
   - Scope: what to do
   - Out of scope: what NOT to do
   - Files: what to create/modify
   - Context: what patterns to follow

3. **Read architecture** — Load `AGENTS.md`. Follow all rules.

4. **Execute** — Implement the phase per plan scope.

5. **Validate** — Run `npm run validate` (lint → typecheck → build → test).

6. **Commit** — Commit with format:
   ```
   feat(segmented-drop-zones): phase <N> — <short description>

   <bullet list of changes>

   Phase <N> of plans/segmented-drop-zones/PLAN.md
   ```

7. **Update progress** — Mark phase as ✅ with commit hash in `plans/segmented-drop-zones/PROGRESS.md`.

---

## Phase Summary

| Phase | Scope | Files |
|-------|-------|-------|
| 0 | Add `DockEdge` type export, `getEdgeTerminals()`, `getEdgeGaps()` + re-export in `workspaceStore.ts` + tests | `workspaceLayout.ts`, `workspaceStore.ts`, `workspaceLayout.test.ts` |
| 1 | Add `insertPaneAtEdgeGapInLayout()` + tests | `workspaceLayout.ts`, `workspaceLayout.test.ts` |
| 2 | Extract `SegmentedDockEdgeTargets` to `DockEdgeTargets.tsx`, replace `DockEdgeTargets`, update tests | `DynamicPaneLayout.tsx`, `DockEdgeTargets.tsx` (new), `DynamicPaneLayout.test.tsx` |
| 3 | Store action + DnD wiring (`insertPaneAtEdgeGap` action, `handleDragEnd`/`handleDragOver`/`handleDragCancel` update) + test updates | `workspaceStore.ts`, `workspaceStoreTypes.ts`, `DynamicPaneLayout.tsx`, `DynamicPaneLayout.test.tsx` |
| 4 | CSS for segmented zones, hover, transitions | `DynamicPaneLayout.css` |
| 5 | Full validation, additional tests, integration test, smoke testing | `workspaceLayout.test.ts`, `workspaceStore.test.ts` |

---

## Naming Convention

This plan introduces two new functions with specific naming following the existing codebase convention:

| Layer | Function | Location |
|-------|----------|----------|
| Pure layout function | `insertPaneAtEdgeGapInLayout` | `workspaceLayout.ts` |
| Store action | `insertPaneAtEdgeGap` | `workspaceStore.ts` |

This follows the existing pattern: `dockPaneToEdgeInLayout` (pure) → `dockPaneToEdge` (store action).

---

## Rules

1. Read ALL context files listed in the current phase of PLAN.md before writing code.
2. Execute ONLY the scope defined in the current phase. Do NOT:
   - Modify files outside phase scope
   - Refactor unrelated code
   - Add features not in scope
3. Follow all rules in `AGENTS.md`. If unsure, re-read it.
4. Use existing codebase patterns — do not invent new patterns. See "Existing Patterns to Follow" and "Layout Tree Orientation Semantics" sections in PLAN.md.
5. Run `npm run validate` frequently. Fix errors immediately.
6. If blocked, report immediately. Do NOT work around blockers silently.

---

## Hard Stops

Stop immediately and report if:

- `npm run validate` fails and you cannot fix it within the phase scope
- You discover a design flaw in the plan that prevents implementation
- The plan references a file or function that doesn't exist in the codebase
- A Phase 0 or Phase 1 pure function test fails and the fix requires changes outside the current phase scope

---

## Completion

When the phase is complete and validation passes:

```
## Phase <N> Complete

### Files Changed
- <file>: <what>

### New Files
- <file>: <purpose>

### Validation
- lint: PASS/FAIL
- typecheck: PASS/FAIL
- build: PASS/FAIL
- test: PASS/FAIL

### Commit
<hash>

### Ready for Next Phase
YES/NO
```

Then update `plans/segmented-drop-zones/PROGRESS.md`:
- Set completed phase status to ✅ with commit hash
- Set next phase status to 🔲 (or 🔧 if running in a loop)

---

## Invocation

```
Execute the next phase of the segmented-drop-zones plan.
PLAN_PATH: plans/segmented-drop-zones/
```
