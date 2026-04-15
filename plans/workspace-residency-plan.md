# Workspace Residency and Instant-Switch Plan

**Status:** Active (most milestones implemented)  
**Owner:** TBD  
**Last updated:** 2026-04-15 (reconciliation pass)

---

## Current Implementation Status

The plan has been substantially executed. The following summarizes what is done, what is partially done, and what remains.

### Completed

| Phase | Status | Evidence |
|---|---|---|
| Runtime metadata groundwork (Phase 1 types + helpers) | ✅ Done | `WorkspaceRuntimeState`, `WorkspaceResidencyState`, `WorkspaceResourcePolicy` defined in `workspaceTypes.ts`; `sanitizeRuntimeState`, `DEFAULT_RUNTIME_STATE`, `DEFAULT_RESOURCE_POLICY` in `workspaceStoreHelpers.ts`; `isWorkspaceWarm`, `getWorkspaceResourcePolicy`, `setWorkspaceResidency`, `setWorkspaceResourcePolicy` actions in store |
| Instrumentation baseline (Phase 0) | ✅ Done | `workspaceSwitchDebug.ts` — dev-only structured logging distinguishes React mount/unmount from surface park/unpark; `surfaceReactMount`/`surfaceReactUnmount` fire only on workspace open/close |
| Single shared-container surface residency (Phase 2) | ✅ Done | `WorkspaceHost` renders all workspaces in one `.workspace-surfaces-container`; surfaces never unmount on workspace switch; `inert` + `aria-hidden` on parked surfaces; CSS `visibility` + `z-index` for visibility control |
| Terminal warmth (Phase 3) | ✅ Done | `xtermCache` + `cacheTerminalInstance`; detach on park, reattach on activate; `terminalSessionBridge.ts` global listeners deliver background output; `markTerminalDisposed` only on explicit close |
| Browser bounds persistence (Phase 4 task 1–2) | ✅ Done | `lastBoundsRef` intentionally NOT reset on park; reactivation sends `browserSetBounds` IPC immediately with preserved value |
| Editor warmth (Phase 5) | ✅ Done | `EditorPane` stays mounted; `EditorView` `useEffect` has `[]` deps, fires once, cleanup (destroy) only on React unmount; `isInteractive` via `inert` attribute |
| Explorer per-workspace state (Phase 6) | ✅ Done | `explorerEntriesByPath`, `explorerExpandedPaths` stored per workspace; watcher is active-workspace-only via `WorkspaceTabs.syncExplorerWatcher` |

### Remaining Work

| Item | Classification | Description |
|---|---|---|
| Phase 4 task 3: bounds pre-warming in main | Deferred | Apply bounds in main process before calling `setVisible(true)`; currently bounds IPC fires after renderer reactivation effect |
| Phase 4 task 4: browser warmth cap | Deferred / optional | Warm for focused + N most-recently-used background workspaces; cold for the rest |
| Phase 4 task 5: initial 0×0 bounds fallback | Deferred / optional | Skip IPC and wait for next ResizeObserver when bounds are 0×0 |
| Phase 1 alias: `focusedWorkspaceId` | Deferred / future | Rename `activeWorkspaceId` → `focusedWorkspaceId` once all consumers migrated off `syncActiveWorkspace` top-level merges |
| Phase 7: store cleanup | Deferred / future | Remove `syncActiveWorkspace` + `getActiveWorkspaceSnapshot` as merge mechanisms once workspace-scoped reads are universal; extract named mutation helpers |

### Minor / Non-blocking

- `useScopedWorkspaceActivity` in `WorkspaceScope.tsx` still checks `workspace.lifecycle === 'active'` alongside `workspace.id === activeWorkspaceId`. Store invariant W4 makes this redundant. Safe to remove but not a functional issue.

---

## Repo Truth Notes

This section captures confirmed code behavior as it exists now.

### State model

- The store enforces exactly one `active` lifecycle workspace via `assignWorkspaceLifecycles` (`workspaceStoreHelpers.ts`).
- The W3 invariant in `workspaceStoreTypes.ts` codifies this: `workspaces.filter(w => w.lifecycle === 'active').length === 1`.
- `activeWorkspaceId` tracks the focused workspace id. All parked workspaces store their own state in `workspaces[]`.
- `syncActiveWorkspace` merges the active workspace's snapshot into top-level store fields on each state update. Parked workspaces' state lives only in `workspaces[]`.
- New workspaces get `runtimeState: { residencyState: 'warm', resourcePolicy: { terminals: 'warm', browser: 'warm', explorer: 'cached', editor: 'warm' } }` via `sanitizeRuntimeState`. Older persisted workspaces are backfilled on load.

### Workspace surface rendering (single shared container)

`WorkspaceHost.tsx` renders all workspace surfaces in a single shared `.workspace-surfaces-container` div. Every workspace renders all of its pane components unconditionally — no conditional render, `key` change, or subtree gating that unmounts a parked workspace's pane tree.

Visibility is controlled with CSS:
- Active surface: `visibility: visible`, `z-index: 1`
- Parked surfaces: `visibility: hidden`, `pointer-events: none`, `z-index: 0`

Parked surfaces also get the HTML `inert` attribute (set via `useEffect` in `WorkspaceSurface`) and `aria-hidden="true"`. `BrowserLifecycleCoordinator` additionally calls `browserHide` IPC for non-focused workspaces.

`WorkspaceSurface` React component mount/unmount instrumentation (`surfaceReactMount`/`surfaceReactUnmount` in dev builds) fires only on workspace open/close — never on workspace switch.

### Subsystem behavior on workspace switch

**TerminalPane**: Stays mounted. On park, xterm element is detached from DOM and instance stored in `xtermCache`. On activate, cached instance re-attached and resized. PTY processes are unaffected.

**EditorPane**: Stays mounted for all workspaces. `isInteractive` goes `false` on park (via `inert` attribute). CodeMirror `EditorView` initialization `useEffect` has `[]` deps — cleanup (destroy) fires only on React unmount. `EditorView` instance is permanently resident.

**BrowserPanel**: Stays mounted for all workspaces. `isActiveWorkspace` checks `workspace.id === activeWorkspaceId` only (no redundant lifecycle check). On park, `browserHide` IPC is called; `lastBoundsRef` is preserved. On return, preserved bounds are sent immediately to restore the browser.

**WorkspaceScopeProvider**: Each surface is wrapped in a workspace-scoped context. The context is stable across switches.

**Explorer**: Watcher is active-workspace-only. Parked workspaces retain cached directory contents.

---

## Problem Statement

The original problem was destructive pane-level reinitialization on workspace switch:

1. Workspace A's surface unmounted from the active viewport.
2. Workspace B's surface mounted into the active viewport.
3. Editor `EditorView` was destroyed and recreated.
4. Browser `lastBoundsRef` was nullified on unmount.

**This problem is solved.** Phase 2 (single shared container) is implemented. All pane surfaces stay mounted across workspace switches. Editor `EditorView` instances are permanently resident. Browser bounds are preserved.

The remaining work is incremental browser polish (bounds pre-warming, warmth cap) and the Phase 1 store migration to remove the `syncActiveWorkspace` top-level merge coupling.

---

## Goals

1. Preserve exactly one **focused** workspace for interaction.
2. Allow multiple workspaces to remain **warm** in memory.
3. Keep PTY-backed terminal streams alive for warm workspaces.
4. Make workspace switching visually immediate — no CodeMirror recreate, no browser bounds flash.
5. Avoid a large destabilizing store rewrite before the state model is corrected.
6. Introduce explicit subsystem residency policy rather than ad hoc hiding rules.

---

## Non-Goals

- splitting the app into multiple stores as a first step
- rewriting the layout tree algorithms
- changing the PTY ownership model
- making every subsystem permanently hot with no memory controls
- solving every performance issue in one pass

---

## Current State Observations (Grounded)

| Observation | Status | Evidence |
|---|---|---|
| Store treats workspace lifecycle as singularly active with parked alternatives | ✅ Confirmed | `assignWorkspaceLifecycles`, W3 invariant |
| `activeWorkspaceId` = focus semantic | ✅ Confirmed | Focus semantics wired; `syncActiveWorkspace` merges focused workspace into top-level fields |
| Parked workspace surfaces stay mounted (single shared container) | ✅ Confirmed | `WorkspaceHost` renders all workspaces in one container; dev instrumentation confirms no React remount on switch |
| Active surface uses `visibility: visible`; parked surfaces use `visibility: hidden` + `pointer-events: none` | ✅ Confirmed | CSS in `App.css` |
| `inert` and `aria-hidden` on parked surfaces | ✅ Confirmed | `WorkspaceHost.tsx` `useEffect`, `aria-hidden` attribute |
| EditorPane stays mounted; EditorView is never destroyed on switch | ✅ Confirmed | `useEffect` with `[]` deps; dev instrumentation confirms `editorReactMount` fires once per workspace open |
| BrowserPanel stays mounted; `lastBoundsRef` preserved across switch | ✅ Confirmed | Comment in `BrowserPanel.tsx`; `lastBoundsRef` not reset on park; reactivation sends preserved bounds |
| xterm instances persist across workspace switches | ✅ Confirmed | `xtermCache`, detach-on-unmount, reattach-on-mount |
| Terminal streams continue in background via global bridge | ✅ Confirmed | `terminalSessionBridge.ts` global listeners writing to `xtermCache` |
| Browser visibility coordinated around active workspace only | ✅ Confirmed | `BrowserLifecycleCoordinator` effect |
| Explorer watching is active-workspace-only | ✅ Confirmed | `WorkspaceTabs.syncExplorerWatcher` effect |
| Runtime metadata (`residencyState`, `resourcePolicy`) exists and is defaulted | ✅ Confirmed | `sanitizeRuntimeState`, `DEFAULT_RUNTIME_STATE`, tests in `workspaceStoreHelpers.test.ts` |
| `lifecycle === 'active'` no longer gates runtime behavior | ✅ Confirmed | Removed from `BrowserPanel.isActiveWorkspace` and `BrowserLifecycleCoordinator` |

---

## Proposed Model

### Core Concepts

#### 1. Focus

Exactly one workspace is **focused**. `activeWorkspaceId` serves this role.

#### 2. Residency

Each workspace has a **residency state**:

| State | Meaning |
|---|---|
| `warm` | mounted and preserved for instant return |
| `cold` | state retained in store; expensive surfaces/resources may be released |
| `closing` | shutdown/disposal in progress |
| `errored` | workspace tracked but some resources failed |

#### 3. Subsystem Policy

Per-workspace, per-subsystem runtime policy:

```ts
interface WorkspaceRuntimeState {
  residencyState: 'warm' | 'cold' | 'closing' | 'errored';
  resourcePolicy: {
    terminals: 'warm' | 'cold';
    browser: 'warm' | 'cold';
    explorer: 'watching' | 'cached';
    editor: 'warm' | 'cold';
  };
}
```

All types and helpers are implemented. New workspaces default to warm.

---

## Implementation Phases

### Phase 0 — Instrument and Baseline ✅

Dev-only structured logging in `workspaceSwitchDebug.ts`. Distinguishes:
- React component mount/unmount (`surfaceReactMount`, `browserReactMount`, `editorReactMount` etc.) — fires only on workspace open/close
- Surface park/unpark transitions (`surfaceMount`, `surfaceUnmount`) — fires on workspace switch
- EditorView create/destroy events

Output: instrumented baseline answers "how long does a switch take, and which subsystem is the bottleneck?"

---

### Phase 1 — Focus/Residency State Model Additions — Partially Done

**Tasks done:**
1. ✅ `residencyState` and `resourcePolicy` added to `WorkspaceTab` via `runtimeState: WorkspaceRuntimeState`.
2. ✅ Default new workspaces to `residencyState: 'warm'`, all subsystems warm except explorer (`cached`).
3. ✅ `isWorkspaceWarm(id)`, `getWorkspaceResourcePolicy(id)`, `setWorkspaceResidency(id, state)`, `setWorkspaceResourcePolicy(id, partialPolicy)` implemented in store.
4. ✅ `sanitizeRuntimeState` backfills missing runtime metadata for older persisted workspaces.
5. ✅ `WorkspaceRuntimeState`, `WorkspaceResidencyState`, `WorkspaceResourcePolicy` types defined in `workspaceTypes.ts`.

**Remaining tasks:**
6. ~~Introduce `focusedWorkspaceId` as canonical focus-tracking field~~ — deferred. `activeWorkspaceId` continues to work; rename requires completing the migration of all consumers off `syncActiveWorkspace` top-level merges.
7. Audit usages of `syncActiveWorkspace` and `getActiveWorkspaceSnapshot` — components reading top-level store fields get the focused workspace's state. Migrate global components (Header, StatusBar) to workspace-scoped reads via `useScopedWorkspace`. This is the main remaining mechanical change for Phase 1.
8. Extract named mutation helpers — `setWorkspaceFocus`, `setWorkspaceResidency`, `setWorkspaceResourcePolicy` with consistent signatures.

**Files Likely Touched:** `workspaceStore.ts`, `workspaceStoreHelpers.ts`, consumer components

**Acceptance Criteria:**
- `activeWorkspaceId` continues to work as before for tab selection and close behavior
- selectors exist for focus/residency checks
- no regressions in workspace tab selection, close, or scoped actions
- all Phase 4+ work is unblocked by the current partial state

---

### Phase 2 — Workspace Surface Residency (Stable Subtree Identity) — ✅ IMPLEMENTED

- `WorkspaceHost.tsx` renders all workspaces in one `.workspace-surfaces-container` div (absolute positioned).
- Active surface: `visibility: visible; z-index: 1`.
- Parked surfaces: `visibility: hidden; pointer-events: none; z-index: 0`.
- `inert` attribute set on parked surface roots via `useEffect`.
- Dev instrumentation distinguishes surface park/unpark transitions from React component mount/unmount.

**Acceptance Criteria — all met:**
- Parked workspace surfaces remain mounted across focus changes. Dev build shows `surface_react_mount` only on workspace open, `surface_react_unmount` only on workspace close — never on workspace switch.
- `inert` blocks keyboard and mouse interaction on parked surfaces.
- No layout snap on return to a previously focused workspace.

---

### Phase 3 — Preserve Terminal and Agent Harness Residency — ✅ IMPLEMENTED

1. ✅ `terminalSessionBridge.ts` global listeners remain active across workspace switches.
2. ✅ `xtermCache` entries are not evicted on workspace switch — only on explicit `markTerminalDisposed`.
3. ✅ `disposeWorkspaceResources` → `terminateWorkspaceTerminals` called only on workspace close.
4. ✅ No production code path calls `clearTerminalCache`.

**Acceptance Criteria — all met:**
- Background harnesses keep streaming while another workspace is focused.
- Switching back does not visually recreate terminal panes (cache hit on remount).
- Terminal is disposed only on workspace close.

---

### Phase 4 — Browser Residency for Instant Restore — Partially Done

**Tasks done:**
1. ✅ Bounds preservation: `lastBoundsRef` is intentionally NOT reset on park. Comment in `BrowserPanel.tsx` confirms this.
2. ✅ Reactivation uses preserved bounds: On switch-back, `browserSetBounds` IPC is sent immediately with `lastBoundsRef.current` before ResizeObserver fires.

**Remaining tasks:**
3. Bounds pre-warming: apply bounds in main process before calling `setVisible(true)`. Currently the renderer sends bounds IPC after its reactivation effect runs; the view may briefly appear at 0×0. Fix: move the bounds application to `browserShow` IPC in main before `setVisible`.
4. Browser warmth cap: warm for focused + N most-recently-used background workspaces; cold otherwise. Implement via `setWorkspaceResourcePolicy(workspaceId, { browser: 'cold' })` when cap is exceeded.
5. Initial 0×0 bounds fallback: add a fallback to skip the IPC and wait for the next ResizeObserver event when bounds are 0×0 (before first layout paint).

**Files to Touch:**
- `src/renderer/components/BrowserPanel.tsx` (task 3, 5)
- `src/main/ipc/browserIpc.ts` (task 3 — apply bounds before `setVisible`)
- `src/renderer/lib/workspaceLifecycle.ts` (task 4 — cold path)

**Acceptance Criteria:**
- switching to a warm workspace with browser visible is visually immediate
- browser content does not flash or jump into place
- `lastBoundsRef.current !== null` immediately after a switch (✅ already true)
- browser resources can still be released when a workspace becomes cold

---

### Phase 5 — Editor Warmth — ✅ IMPLEMENTED

`EditorPane` stays mounted for all workspaces. CodeMirror `EditorView` is initialized in a `useEffect` with `[]` deps — cleanup (which calls `view.destroy()`) fires only on React unmount. Since `EditorPane` never unmounts for parked workspaces, `EditorView` instances are permanently resident.

`isInteractive` controls interaction only (`inert` attribute + `aria-hidden`), not instance lifecycle. Editor state (document content, cursor position, undo history) is preserved across workspace switches.

**Acceptance Criteria — all met:**
- Dev build shows `editor_create` fires only once per workspace and `editor_destroy` only on workspace close.
- Active tab content is synced correctly on workspace switch (the content sync effect checks `activeEditorTabId`).
- Editor state is preserved across workspace switches.

---

### Phase 6 — Explorer Residency Policy — ✅ IMPLEMENTED

`explorerEntriesByPath` and `explorerExpandedPaths` are preserved for parked workspaces in `WorkspaceTab`. The watcher is active-workspace-only via `WorkspaceTabs.syncExplorerWatcher`. No changes needed.

**Acceptance Criteria — all met:**
- Returning to a workspace does not show an empty explorer.
- Watcher policy is explicit and active-workspace-only.

---

### Phase 7 — Store Cleanup After Behavior Stabilizes — Deferred / Future

Only after Phase 1 migration is complete.

**Tasks:**
1. Extract named mutation helpers for focus/residency/resource-policy updates.
2. Remove or deprecate `syncActiveWorkspace` and `getActiveWorkspaceSnapshot` as top-level merge mechanisms once all consumers have migrated to workspace-scoped reads.
3. Consolidate repeated validation in `validateWorkspaceConsistency`.
4. Optionally rename `activeWorkspaceId` to `focusedWorkspaceId` once migration is complete.

**Acceptance Criteria:**
- store file is easier to reason about without changing behavior
- selectors are explicit about focus vs residency

---

## Recommended Shipping Order (revised)

1. ~~Phase 0 — instrumentation baseline~~ ✅ Done
2. Phase 1 — focus/residency state model additions — **partially done; remaining is mechanical migration work**
3. ~~Phase 2 — workspace surface residency~~ ✅ Done
4. ~~Phase 3 — terminal/harness verification~~ ✅ Done; no changes needed
5. Phase 4 — browser residency improvements — partially done; tasks 3–5 remaining
6. ~~Phase 5 — editor warmth~~ ✅ Done
7. ~~Phase 6 — explorer policy~~ ✅ Done; no changes needed
8. Phase 7 — cleanup/refactor pass — deferred until Phase 1 stabilizes

---

## Risks

### 1. Memory Growth

Keeping many workspaces warm can increase memory.

**Mitigation:** cap browser warmth to focused + N recent workspaces (Phase 4 task 4). PTY processes are the dominant memory consumer for active terminals; xterm scrollback is bounded by `TERMINAL_SCROLLBACK_LINES`.

### 2. DOM and Effect Leaks

Long-lived parked surfaces can accumulate subscriptions.

**Mitigation:** audit all `useEffect` hooks in pane components for `workspaceId` dependency changes; add switch stress tests.

### 3. Browser View Reveal Timing (Phase 4 task 3)

The renderer sends `browserSetBounds` IPC after its reactivation effect runs. A brief moment may exist where the native view is visible but not yet sized.

**Mitigation:** Phase 4 task 3 — apply bounds in main process before `setVisible(true)`.

### 4. Test Assumption Breakage

Existing tests may assume exactly one active workspace.

**Mitigation:** update terminology in tests; add explicit focus/residency fixtures; preserve compatibility shims during migration.

### 5. `syncActiveWorkspace` Coupling (Phase 1 remaining work)

All mutations to the active workspace call `syncActiveWorkspace`, which merges the workspace snapshot into top-level store fields. Global components rely on this coupling. Migration to workspace-scoped reads in Phase 1 is the most mechanical but most widespread change.

---

## Testing Plan

### Unit Tests

- `assignWorkspaceLifecycles` ensures exactly one active lifecycle ✅
- `sanitizeRuntimeState` backfill for missing runtime metadata ✅
- `isWorkspaceWarm` for warm/cold/closing/errored workspaces ✅
- `getWorkspaceResourcePolicy` returns correct defaults ✅
- `setWorkspaceResidency` / `setWorkspaceResourcePolicy` preserve other fields ✅
- `withWorkspaceResidency` / `withWorkspaceResourcePolicy` ✅
- Focus switching does not alter parked workspace `residencyState` — needs test

### Integration Tests

- switch A → B → A without pane component remounts (dev instrumentation)
- background terminal output continues while another workspace is focused ✅ (confirmed in code)
- browser bounds are preserved across workspace switches (verify `lastBoundsRef` non-null)
- editor state preserved across workspace switches (dev instrumentation)

### Manual Verification Checklist

- open 3+ workspaces
- start agent harness in two workspaces
- switch rapidly between them
- confirm output continues in background
- confirm no terminal rebuild artifacts on return
- confirm browser workspace returns without jump
- confirm explorer state is already present
- confirm editor tabs are preserved across switch
- close a workspace and verify resource disposal still occurs correctly

---

## Rollback Strategy

If browser or surface residency creates instability:

1. keep focus/residency model changes
2. revert browser policy to focused-only warmth
3. keep terminals warm (already working)
4. keep editor always-mounted (Phase 5 already implemented)

This still yields a substantial UX improvement without forcing all subsystems to remain hot.

---

## Open Questions

1. **Browser warmth cap** — warm for focused + last 2 used. Recommend "warm for focused + last 2" as default. Phase 4 task 4.

2. **Phase 1 migration scope** — the `syncActiveWorkspace` migration (Phase 1 task 7) is mechanical but touches many files. Recommend doing it as a focused refactor pass once Phase 4 is complete, rather than interleaving it with new feature work.

3. **Phase 4 task 3 (bounds in main before visible)** — requires main-process change to `browserIpc.ts`. Confirm the ordering: `browserSetBounds` must apply dimensions before `setVisible(true)` in main. The current renderer-side reactivation already sends bounds IPC, but the main-process timing matters for the brief-flash window.

4. **Memory pressure detection** — Is it needed now, or can colding remain manual/policy-based? Recommendation: policy-based only for first version.

5. **Workspace close cleanup** — When a workspace is closed, cleanup flow calls `terminateWorkspaceTerminals`, `explorerStopWatching`, and `browserDisposeWorkspace`. This flow works for the current single-watcher model. Future multi-workspace watchers would need to check `resourcePolicy` before stopping watchers that another workspace is using.

---

## Implementation Dependencies

| Phase | Depends On | Reason |
|---|---|---|
| Phase 4 (browser bounds pre-warming) | None (partial progress without Phase 2) | Bounds preservation (task 1–2) works independently. Full bounds pre-warming (task 3) requires main-process ordering. |
| Phase 5 (editor warmth) | Phase 2 | EditorPane must stay mounted for `EditorView` to survive switches. Phase 2 single-container is what guarantees this. |
| Phase 6 (explorer policy) | None | Explorer state is already per-workspace; no Phase 2 dependency for the core model. |
| Phase 7 (store cleanup) | Phase 1 migration complete | `syncActiveWorkspace` removal requires all consumers migrated first. |

---

## Definition of Done

- [x] `activeWorkspaceId` change updates focus semantics only; no code path uses `lifecycle === 'active'` to gate runtime behavior (terminals, browser, explorer watcher). ✅ BrowserPanel corrected; `BrowserLifecycleCoordinator` corrected. Minor: `useScopedWorkspaceActivity` still has redundant check.
- [x] Switching A → B → A causes zero pane component remounts for workspaces A and B. ✅ Single-container architecture. Dev instrumentation confirms.
- [x] For any workspace that had `browserVisible: true`, `lastBoundsRef.current` is non-null immediately after switching away and immediately after switching back. ✅ Bounds preserved in `lastBoundsRef`.
- [ ] Switching to a warm workspace with browser visible does not produce a browser bounds flash — the first `browserSetBounds` IPC after return carries the same pixel values as the last IPC before the switch. (Phase 4 task 3 remaining — requires main-process bounds application before `setVisible`)
- [x] Opening a file in workspace A, switching to B, returning to A shows the editor tab with the file open and its CodeMirror instance intact. ✅ Phase 5 implemented.
- [x] `explorerEntriesByPath` for parked workspaces remains non-empty after any number of workspace switches. ✅ Store model preserves this.
- [ ] Closing a workspace with `browserVisible: true` disposes the browser view via `browserDisposeWorkspace` (verifiable via IPC mock or integration test).
- [x] `assignWorkspaceLifecycles` still produces exactly one `lifecycle === 'active'` workspace after 10 rapid A→B→C→A switches. ✅ Tested.
- [x] All new selectors (`isWorkspaceWarm`, `getWorkspaceResourcePolicy`) return correct values for warm, cold, and parked workspaces. ✅ Tests exist.
- [ ] All acceptance criteria above are covered by unit or integration tests. (Residency-switch stress test and bounds-flash test still needed)
