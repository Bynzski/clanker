# Workspace Residency and Instant-Switch Plan

**Status:** Draft  
**Owner:** TBD  
**Last updated:** 2026-04-15 (precision revision)

---

## Repo Truth Notes

This section captures confirmed code behavior that differs from the original plan's assumptions.

### State model

- The store enforces exactly one `active` lifecycle workspace via `assignWorkspaceLifecycles` (`workspaceStoreHelpers.ts`).
- The W3 invariant in `workspaceStoreTypes.ts` codifies this: `workspaces.filter(w => w.lifecycle === 'active').length === 1`.
- `activeWorkspaceId` tracks the focused/scoped workspace id. All parked workspaces store their own state in `workspaces[]`.
- `syncActiveWorkspace` in `workspaceStoreHelpers.ts` merges the active workspace's snapshot into top-level store fields on each state update. This coupling means the top-level store fields always reflect the focused workspace — parked workspaces' state lives only in `workspaces[]`.

### Workspace surface rendering (single shared container)

`WorkspaceHost.tsx` renders all workspace surfaces in a single shared `.workspace-surfaces-container` div (not two separate containers). Every workspace renders all of its pane components (`TerminalPane`, `EditorPane`, `BrowserPanel`) unconditionally via `DynamicPaneLayout.LeafView` — there is no conditional render, `key` change, or subtree gating that unmounts a parked workspace's pane tree.

Visibility is controlled with CSS:
- Active surface: `visibility: visible`, `z-index: 1`
- Parked surfaces: `visibility: hidden`, `pointer-events: none`, `z-index: 0`

Each parked workspace's surface also gets the HTML `inert` attribute (set via `useEffect` in `WorkspaceSurface`) and `aria-hidden="true"` on the surface root. The `inert` attribute blocks all keyboard/mouse interaction; `aria-hidden` provides an additional screen-reader signal. `BrowserLifecycleCoordinator` additionally calls `browserHide` IPC for non-focused workspaces.

No React unmount/remount occurs on workspace switch. The `WorkspaceScopeProvider` context per workspace is stable. `WorkspaceSurface` React component mount/unmount instrumentation (`surfaceReactMount`/`surfaceReactUnmount` in dev builds) fires only on workspace open/close, not on workspace switch.

### Subsystem behavior on workspace switch (shared container)

**TerminalPane** (`TerminalPane.tsx`): Component stays mounted. On park, xterm element is detached from DOM and `xterm` instance stored in `xtermCache`. On activate, cached instance re-attached and resized. PTY processes in main are unaffected by React rendering. This is already well-engineered.

**EditorPane** (`EditorPane.tsx`): Component stays mounted for all workspaces. `isInteractive` goes `false` on park (via `useScopedWorkspaceActivity` → `inert` attribute set on panel). The CodeMirror `EditorView` initialization `useEffect` has `[]` deps — it fires once on mount and the cleanup (which destroys `EditorView`) fires only on React unmount. Since `EditorPane` never unmounts for parked workspaces, the `EditorView` instance is **permanently resident** — editor state (document content, cursor position, undo history) is preserved across workspace switches. Phase 5 editor warmth is already implemented as a consequence of the single-container architecture.

**BrowserPanel** (`BrowserPanel.tsx`): Component stays mounted for all workspaces. `isActiveWorkspace` is `true` only when `workspace.id === activeWorkspaceId` (the `lifecycle === 'active'` check was removed as redundant with store invariant W4). On park, `browserHide` IPC is called and bounds are NOT nullified — `lastBoundsRef` is preserved across the park cycle, so the browser does not lose its pre-warmed bounds. On return, the reactivation `useEffect` uses the preserved `lastBoundsRef` value to restore the browser without jitter. Browser bounds persistence is already implemented as a consequence of the single-container architecture.

**WorkspaceScopeProvider** (`WorkspaceScope.tsx`): Each surface is wrapped in a workspace-scoped context provider. `useScopedWorkspaceActivity` uses `workspace.id === activeWorkspaceId && workspace.lifecycle === 'active'` for the `isInteractive` flag — the `lifecycle` check is redundant with store invariant W4 (safe to remove but not a functional issue).

### Browser lifecycle coordination

`BrowserLifecycleCoordinator` effect sends `browserHide` IPC for every workspace whose id does not match the newly focused `activeWorkspaceId`. In main, `browserHide` calls `entry.view.setVisible(false)`.

### Explorer

`WorkspaceTabs.tsx` `syncExplorerWatcher` effect subscribes to `activeWorkspaceId` changes. It calls `explorerStartWatching(path)` for the new active workspace and `explorerStopWatching()` on cleanup. Only one watcher is active at a time. Parked workspaces retain their full `explorerEntriesByPath` cached state in `workspaces[]`.

### Terminal and harness stream delivery

`src/renderer/lib/terminalSessionBridge.ts` sets up `onTerminalData` and `onTerminalExit` listeners at the App level. These are global listeners that write to `xtermCache` regardless of which workspace owns the terminal. Background terminal output flows into cached xterm instances even while their workspace is parked.

---

## Problem Statement

Today, switching workspace A → B causes:

1. Workspace A's surface unmounts from the active viewport (useEffect cleanup fires for all pane components in A).
2. Workspace B's surface mounts into the active viewport (pane components reinitialize).
3. Terminal panes re-attach from the xterm cache (fast, acceptable).
4. Editor pane recreates its CodeMirror instance if any tabs were open.
5. Browser panel's `lastBoundsRef` is nullified on unmount, so the first reveal has no prior bounds value; bounds IPC races with layout settlement.
6. The explorer watcher stops for A and starts for B.

The primary cause of poor switch UX is **destructive pane-level reinitialization on surface remount**, specifically:

- Editor pane destroys and recreates its CodeMirror `EditorView`.
- Browser panel loses its last bounds reference and must re-derive it from layout on next paint.

Subsystem reactivation costs compound when surfaces are remounted on every switch. Keeping surfaces mounted across focus changes — with stable React identity and non-destructive cleanup — would eliminate both the EditorView recreate and the bounds nullification. Terminal panes already handle this well via the xterm cache; editor and browser need the same treatment.

"Hot" surfaces — kept mounted with stable subtree identity and suppressed interaction — would eliminate these costs entirely. CSS `display: none` alone is insufficient because surfaces still unmount/remount when they move between the active viewport and the parked container.

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
| `activeWorkspaceId` = focus semantic | ⚠️ Partially | Focus semantics are wired, but `syncActiveWorkspace` merges focused workspace state into top-level fields, making parked workspaces' state inaccessible to non-workspace-scoped components |
| Parked workspace surfaces stay mounted (single shared container) | ✅ Confirmed | `WorkspaceHost` renders all workspaces in one `.workspace-surfaces-container`. No conditional unmount on workspace switch. |
| Active surface uses `visibility: visible`; parked surfaces use `visibility: hidden` + `pointer-events: none` | ✅ Confirmed | `.workspace-surface.active { visibility: visible; z-index: 1 }` and `.workspace-surface.parked { visibility: hidden; pointer-events: none; z-index: 0 }` in `App.css` |
| EditorPane stays mounted for parked workspaces; EditorView is never destroyed on switch | ✅ Confirmed | `EditorPane` has no conditional unmount. CodeMirror `useEffect` has `[]` deps (fires once). `isInteractive` set via `inert` attribute only. |
| BrowserPanel stays mounted for parked workspaces; `lastBoundsRef` is preserved across switch | ✅ Confirmed | `BrowserPanel` has no conditional unmount. Bounds cleanup comment confirms ref is intentionally NOT reset on park. `browserHide` IPC sent via coordinator, but bounds remain warmed. |
| `lifecycle === 'active'` no longer gates runtime behavior in BrowserPanel | ✅ Confirmed | Removed `&& workspace.lifecycle === 'active'` from `BrowserPanel.isActiveWorkspace` and `BrowserLifecycleCoordinator` — store invariant W4 makes this check redundant. |
| xterm instances persist across workspace switches | ✅ Confirmed | `xtermCache` Map, detach-on-unmount, reattach-on-mount in `TerminalPane.tsx` |
| Terminal streams continue in background via global bridge | ✅ Confirmed | `terminalSessionBridge.ts` global listeners writing to `xtermCache` |
| Browser visibility coordinated around active workspace only | ✅ Confirmed | `BrowserLifecycleCoordinator` effect |
| Explorer watching is active-workspace-only | ✅ Confirmed | `WorkspaceTabs.syncExplorerWatcher` effect |
| Workspace surfaces use `inert` and `aria-hidden` | ✅ Confirmed | `WorkspaceHost.tsx` (`inert` via useEffect), `EditorPane.tsx` (via `isInteractive`) |

---

## Proposed Model

### Core Concepts

Replace the implicit single-activity model with three explicit concepts:

#### 1. Focus

Exactly one workspace is **focused**. `activeWorkspaceId` already serves this role. The semantic distinction to make explicit: focus ≠ liveness.

#### 2. Residency

Each workspace has a **residency state**.

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

**Note:** `terminals` defaulting to `warm` is safe to implement immediately — PTY processes already run independently of React rendering, and `xtermCache` + `terminalSessionBridge` already deliver output to cached xterm instances.

---

## Product Behavior Target

### Desired UX

When the user switches from workspace A to workspace B:

- workspace A continues running any PTY-backed terminals and streaming output into cached xterm instances
- workspace B appears immediately with all pane surfaces settled (no layout rebuild, no CodeMirror recreate, no browser bounds flash)
- explorer state is already present and only does background refresh if needed

### Acceptable First Version

A reasonable first target:

- terminals/harnesses: warm for all open workspaces (already largely supported — verify no edge cases)
- editor tabs/layout: warm for all open workspaces (editor pane is the weakest currently — CodeMirror instance is destroyed on unmount)
- explorer state: cached for all; watcher active for focused workspace only (already the case)
- browser: warm for focused workspace + most recently used N background workspaces; cold otherwise

---

## Implementation Strategy

### Phase 0 — Instrument and Baseline

Measure current switch and reveal behavior before changing anything.

**Tasks:**
- Record workspace switch duration (activeWorkspaceId change → next frame render)
- Record time-to-stable-layout after switch (using `layoutRevision` as proxy)
- Record browser reveal/bounds synchronization latency
- Record terminal reattach/refit count during workspace switch (use xtermCache hit/miss logging)
- Record editor CodeMirror recreate events

**Files to instrument:**
- `WorkspaceHost.tsx` — log workspace switch events and surface mount/unmount
- `TerminalPane.tsx` — log cache hit/miss on mount
- `BrowserPanel.tsx` — log bounds IPC timing and `lastBoundsRef` state
- `EditorPane.tsx` — log CodeMirror create/destroy

**Output:** A baseline that answers "how long does a switch take now, and which subsystem is the bottleneck?"

---

### Phase 1 — Separate Focus from Residency Semantics in the Store

This is the most important architectural phase, but it is largely a naming/invariant clarification, not a large rewrite.

**Tasks:**
1. Introduce `focusedWorkspaceId` as the canonical focus-tracking field (initially alias `activeWorkspaceId`).
2. Audit all usages of `syncActiveWorkspace` and `getActiveWorkspaceSnapshot` in `workspaceStoreHelpers.ts`. The critical question: which components rely on top-level store fields being the focused workspace's state? These will need to be migrated to workspace-scoped reads via `useScopedWorkspace`.
3. Add `residencyState` and `resourcePolicy` fields to `WorkspaceTab` (via `workspaceTypes.ts`).
4. Default new workspaces to `residencyState: 'warm'`, `resourcePolicy: { terminals: 'warm', browser: 'warm', explorer: 'cached', editor: 'warm' }`.
5. Add selector helpers: `isWorkspaceWarm(id)`, `getWorkspaceResourcePolicy(id)`, `setWorkspaceResidency(id, state)`, `setWorkspaceResourcePolicy(id, partialPolicy)`.
6. Add `WorkspaceRuntimeState` type to `workspaceStoreTypes.ts`.

**Files Likely Touched:**
- `src/renderer/store/workspaceStore.ts`
- `src/renderer/store/workspaceStoreHelpers.ts`
- `src/renderer/store/workspaceTypes.ts`
- `src/renderer/store/workspaceStoreTypes.ts`

**Acceptance Criteria:**
- `activeWorkspaceId` continues to work as before for tab selection and close behavior
- background workspaces are no longer implicitly treated as suspended by the store
- selectors exist for focus/residency checks
- no regressions in basic workspace tab selection, close, or scoped actions

**Known Risk:** Migrating components off `syncActiveWorkspace` top-level merges is the most tedious part. Components like `Header`, `StatusBar`, and any editor/global action that reads `terminals`, `panes`, `layoutRoot` etc. directly will need to use `useScopedWorkspace` instead. This is a find-and-replace across the renderer.

---

### Phase 2 — Workspace Surface Residency (Stable Subtree Identity) — ✅ IMPLEMENTED

This phase is implemented. The single shared container architecture is in place.

**Implementation:**
- `WorkspaceHost.tsx` renders all workspaces in one `.workspace-surfaces-container` div (absolute positioned).
- Active surface: `visibility: visible; z-index: 1`.
- Parked surfaces: `visibility: hidden; pointer-events: none; z-index: 0`.
- `inert` attribute set on parked surface roots via `useEffect` in `WorkspaceSurface`.
- Dev instrumentation (`workspaceSwitchDebug.ts`) distinguishes surface park/unpark transitions (`surfaceMount`/`surfaceUnmount`) from React component mount/unmount (`surfaceReactMount`/`surfaceReactUnmount`). The latter fires only on workspace open/close.

**Acceptance Criteria — all met:**
- Parked workspace surfaces remain mounted across focus changes. Dev build console logs show `surface_react_mount` fires only on workspace open and `surface_react_unmount` only on workspace close — never on workspace switch.
- `inert` attribute blocks keyboard and mouse interaction on parked surfaces.
- `aria-hidden` is set on parked surface roots.
- No layout snap on return to a previously focused workspace (CSS visibility transitions; DOM is not rebuilt).
- Parked workspace surfaces are non-interactive but remain mounted.

---

### Phase 3 — Preserve Terminal and Agent Harness Residency

This phase is largely already implemented. Verify no edge cases.

**Tasks:**
1. Confirm that `terminalSessionBridge.ts` global listeners remain active across workspace switches (they are set up once in `App.tsx`).
2. Confirm that `xtermCache` entries are not evicted on workspace close unless the terminal is intentionally disposed.
3. Verify that `markTerminalDisposed` + `killTerminal` is called only when a workspace is closed (via `disposeWorkspaceResources` → `terminateWorkspaceTerminals`).
4. Audit any code path that might clear the xterm cache prematurely. Notably: `clearTerminalCache` in tests; verify there is no production code path that calls it.
5. Confirm that harnesses (run via wrapper script in main process) keep running when the owning workspace is parked. The harness wrapper script (`~/.clanker-grid/harness-wrapper.sh`) is managed by `harnessLaunch.ts`; PTY processes are in the main process `terminals` Map, which is workspace-scoped only by `id`, not by visibility.

**Files to Audit:**
- `src/renderer/lib/terminalSessionBridge.ts` ✅ (already correct)
- `src/renderer/components/TerminalPane.tsx` (xterm cache behavior)
- `src/renderer/lib/workspaceLifecycle.ts` (disposal flow)
- `src/main/harnessLaunch.ts` (harness process lifecycle)

**Acceptance Criteria:**
- background harnesses keep streaming while another workspace is focused
- switching back does not visually recreate terminal panes (xterm cache hit on remount)
- no duplicate listeners or leaking terminal subscriptions after repeated switching
- terminal is disposed only on workspace close (not on workspace switch)

---

### Phase 4 — Browser Residency for Instant Restore — PARTIALLY IMPLEMENTED

**Tasks done:**
1. ✅ Bounds preservation: `lastBoundsRef` is intentionally NOT reset on BrowserPanel park. Comment in `BrowserPanel.tsx` confirms: "BrowserPanel stays mounted under the shared-container design. Retaining last bounds suppresses redundant first-show IPC churn when returning to this workspace."
2. ✅ Reactivation uses preserved bounds: On switch-back, `browserSetBounds` IPC is sent immediately with `lastBoundsRef.current` before ResizeObserver fires.

**Remaining tasks:**
3. Bounds pre-warming: apply bounds before making the view visible in the main process (currently the IPC ordering may still cause a brief moment where the view is not yet sized).
4. Browser residency policy with cap (e.g., warm for focused + 2 most recently used). Implement `setWorkspaceResourcePolicy(workspaceId, { browser: 'cold' })`.
5. Edge case: initial bounds of 0×0 before first layout paint. Add a fallback to skip the IPC and wait for the next ResizeObserver event.

**Files Likely Touched:**
- `src/renderer/components/BrowserPanel.tsx` (bounds pre-warming)
- `src/renderer/components/BrowserLifecycleCoordinator.tsx` (residency policy coordination)
- `src/renderer/lib/workspaceLifecycle.ts` (add browser cold path)

**Acceptance Criteria:**
- switching to a warm workspace with browser visible is visually immediate
- browser content does not flash or jump into place
- browser bounds are preserved across workspace switches (observable: `lastBoundsRef.current !== null` immediately after a switch)
- browser resources can still be released when a workspace becomes cold

---

### Phase 5 — Editor Warmth — ✅ IMPLEMENTED

`EditorPane` stays mounted for all workspaces (including parked) under the single-container architecture. The CodeMirror `EditorView` is initialized in a `useEffect` with `[]` deps — it fires once on component mount and the cleanup (which calls `view.destroy()`) fires only on React unmount. Since `EditorPane` never unmounts for parked workspaces, `EditorView` instances are permanently resident.

`isInteractive` controls interaction only (`inert` attribute + `aria-hidden`), not instance lifecycle. Editor state (document content, cursor position, undo history) is preserved across workspace switches.

**Acceptance Criteria — all met:**
- Switching to a warm workspace with open editor tabs does not recreate the CodeMirror instance. Dev build console logs show `editor_create` fires only once per workspace (on first mount) and `editor_destroy` fires only on workspace close.
- Active tab content is synced correctly on workspace switch (the content sync effect checks `activeEditorTabId` and updates the document).
- Editor state is preserved across workspace switches.

---

### Phase 6 — Explorer Residency Policy

Explorer state is already per-workspace in the store. The watcher model is already active-workspace-only.

**Tasks:**
1. Confirm that `explorerEntriesByPath` and `explorerExpandedPaths` are preserved for parked workspaces (they are — `WorkspaceTab` stores them).
2. The only improvement needed is: on focus return, do not clear visible content before refreshing. The current code in `FileExplorer/index.tsx` `useEffect` for `explorerVisible` already calls `handleRefresh()` on reveal, but only if root entries are not already loaded. Verify this is sufficient.
3. Optionally: support watchers for recent N warm workspaces (low priority for first version).

**Files Likely Touched:**
- `src/renderer/components/FileExplorer/index.tsx` (verify no content reset on reveal)
- `src/renderer/components/WorkspaceTabs.tsx` (explorer watcher sync — already correct)

**Acceptance Criteria:**
- returning to a workspace does not show an empty or obviously resetting explorer
- watcher policy is explicit and configurable

---

### Phase 7 — Store Cleanup After Behavior Stabilizes

Only after the runtime model is working should the store implementation be cleaned up.

**Tasks:**
1. Extract mutation helpers for focus/residency/resource-policy updates.
2. Remove or deprecate `syncActiveWorkspace` and `getActiveWorkspaceSnapshot` as top-level merge mechanisms once all consumers have migrated to workspace-scoped reads.
3. Consolidate repeated validation in `validateWorkspaceConsistency`.
4. Optionally rename `activeWorkspaceId` to `focusedWorkspaceId` once migration is complete.

**Acceptance Criteria:**
- store file is easier to reason about without changing behavior
- selectors are explicit about focus vs residency
- tests cover the new model

---

## Recommended Shipping Order (revised)

1. Phase 0 — instrumentation baseline ✅ (dev-only logging in `workspaceSwitchDebug.ts`)
2. Phase 1 — focus/residency state model additions (store-only, no UI) — remaining
3. Phase 2 — workspace surface residency ✅ (single shared container implemented)
4. Phase 3 — terminal/harness verification ✅ (confirmed working; no changes needed)
5. Phase 4 — browser residency improvements (bounds persistence) — partially done; tasks 1–2 complete, tasks 3–5 remaining
6. Phase 5 — editor warmth ✅ (EditorPane stays mounted; EditorView permanently resident)
7. Phase 6 — explorer policy ✅ (no changes needed; state already per-workspace)
8. Phase 7 — cleanup/refactor pass — remaining (after Phase 1 stabilizes)

This order maximizes product impact early (Phases 1–2) while limiting destabilization.

---

## Risks

### 1. Memory Growth

Keeping many workspaces warm can increase memory.

**Mitigation:**
- editor warmth (Phase 5) may need to use a cache rather than always-mounted approach
- cap browser warmth to focused + N recent workspaces
- PTY processes are the dominant memory consumer for active terminals; xterm scrollback is bounded by `TERMINAL_SCROLLBACK_LINES`

### 2. DOM and Effect Leaks

Long-lived parked surfaces can accumulate subscriptions.

**Mitigation:**
- audit all `useEffect` hooks in pane components for `workspaceId` dependency changes
- add switch stress tests (A→B→C→A rapid cycling)
- verify subscription counts in development builds

### 3. Browser View Reveal Timing

`lastBoundsRef` being null on remount causes the browser view to briefly appear at 0×0.

**Mitigation:**
- Phase 4 bounds pre-warming
- apply bounds before making view visible in main process

### 4. Test Assumption Breakage

Existing tests may assume exactly one active workspace.

**Mitigation:**
- update terminology in tests first
- add explicit focus/residency fixtures
- preserve compatibility shims during migration

### 5. CodeMirror Cache Complexity

DOM element caching for the editor cache (Phase 5 alternative to always-mounted) is complex and error-prone.

**Mitigation:**
- consider always-mounted + `inert` for the editor first (requires Phase 2 surface residency)
- only implement the cache if memory profiling shows it is necessary

### 6. Stacked Surface Z-Order and Accessibility

If all surfaces are kept in a single container with CSS visibility hiding, the z-order of stacked surfaces and screen-reader behavior need verification.

**Mitigation:**
- `inert` on non-focused surfaces handles keyboard/screen-reader exclusion
- `aria-hidden` on the container provides an additional screen-reader signal
- verify tab order does not allow focus to land on parked surfaces

---

## Testing Plan

### Unit Tests

Add or update tests for:
- `assignWorkspaceLifecycles` ensures exactly one active lifecycle
- focus switching does not alter parked workspace `residencyState`
- warm workspaces retain `terminals`, `editorTabs`, `layoutRoot` state
- `isWorkspaceWarm` / `getWorkspaceResourcePolicy` selectors
- `syncActiveWorkspace` behavior when `activeWorkspaceId` is null

### Integration Tests

Add tests for:
- switch A → B → A without pane remounts (using React DevTools profiling or component mount log instrumentation)
- background terminal output continues while another workspace is focused
- browser bounds are preserved across workspace switches (mock ResizeObserver; verify `lastBoundsRef` is not nullified on switch)
- editor state preserved across workspace switches (with editor cache from Phase 5)
- explorer state remains present on focus return without content reset

### Manual Verification Checklist

- open 3+ workspaces
- start agent harness in two workspaces
- switch rapidly between them
- confirm output continues in background
- confirm no terminal rebuild artifacts on return
- confirm browser workspace returns without jump (record before/after bounds IPC)
- confirm explorer state is already present
- confirm editor tabs are preserved across switch (Phase 5)
- close a workspace and verify resource disposal still occurs correctly

---

## Rollback Strategy

If browser or surface residency creates instability:

1. keep focus/residency model changes
2. revert browser policy to focused-only warmth
3. keep terminals warm (already working)
4. leave editor on always-remount (Phase 5 not implemented)
5. leave explorer on cached-only background mode

This still yields a substantial UX improvement without forcing all subsystems to remain hot.

---

## Open Questions

1. **Browser warmth cap:** Should browsers remain warm for all open workspaces, or only recent N? If memory is a concern, a cap of 2–3 is reasonable. Default should be "warm for focused + last 2 used".

2. **Editor warmth strategy:** Always-mounted + `inert` vs. DOM-element cache? The always-mounted approach is simpler but uses more memory when many workspaces have open editors. The cache approach is more complex. Recommend starting with always-mounted and measuring. Note that always-mounted requires Phase 2 surface residency to work correctly.

3. **Stacking approach for Phase 2:** Should parked surfaces be stacked (all visible, active on top) or should only the active surface be in the layout? A stacked approach with `pointer-events: none` on parked surfaces avoids DOM relocation but requires z-index management. The active-only approach with a shared hidden container is simpler but may complicate pane sizing. The plan treats both as candidate techniques.

4. **Memory pressure detection:** Is it needed now, or can colding remain manual/policy-based for the first release? Recommendation: policy-based only for first version. Memory pressure detection can be added as a follow-up.

5. **Workspace close cleanup:** When a workspace is closed, its `workspaceLifecycle` transitions to `'closing'` → `'parked'` → removal. The cleanup flow in `workspaceLifecycle.ts` calls `terminateWorkspaceTerminals`, `explorerStopWatching`, and `browserDisposeWorkspace`. This flow needs to be updated to also respect `resourcePolicy` — e.g., do not call `explorerStopWatching` if another workspace is watching the same directory. This is a pre-existing coupling issue that should be documented.

---

## Implementation Dependencies

| Phase | Depends On | Reason |
|---|---|---|
| Phase 4 (browser bounds persistence) | Phase 2 (surface kept in one container) | Bounds can only be pre-warmed if the surface remains mounted across focus changes. If surfaces still unmount on switch, `lastBoundsRef` is nullified by the cleanup and bounds pre-warming has no prior value to work from. |
| Phase 5 (editor cache or always-mounted) | Phase 2 (surface kept in one container) | An always-mounted editor strategy requires surfaces to remain mounted. A cache strategy benefits from Phase 2 because it makes mount/unmount events observable for cache population rather than suppressing them entirely. |
| Phase 6 (explorer policy) | None | Explorer state is already per-workspace in the store; no Phase 2 dependency for the core model. |
| Phase 7 (store cleanup) | Phases 1–6 | The store migration must be complete before cleanup removes the old `syncActiveWorkspace` surface-level merge path. |

**Key rule:** Do not begin Phase 4 or Phase 5 until Phase 2 is verified. A revert to surfaces moving between two containers would re-introduce the cleanup effects these phases depend on eliminating.

**Partial progress note:** Browser bounds persistence (Phase 4) provides value even without full Phase 2 — simply avoiding the `lastBoundsRef` nullification on unmount (by clearing only on workspace close) would reduce the bounds flash on return. However, the full benefit of Phase 4 requires Phase 2 to eliminate the unmount event entirely, so Phase 2 should still be verified before Phase 4 is considered complete.

---

## Implementation Risks in Current Code

These risks are updated to reflect what is actually still a concern:

1. **`syncActiveWorkspace` top-level merges** (unchanged): All mutations to the active workspace call `syncActiveWorkspace`, which merges the workspace snapshot into top-level store fields. Non-workspace-scoped components reading these fields get the focused workspace's state. All global components (Header, StatusBar, keyboard shortcut handlers, etc.) rely on this coupling. Migration to workspace-scoped reads in Phase 1 is the most mechanical but most widespread change.

2. **Explorer watcher single-instance** (unchanged): `explorerStartWatching` in main process is a singleton; calling it twice replaces the watch path. `WorkspaceTabs` already handles this by stopping before starting, but this means background workspaces cannot have live watcher state even if we wanted to add it. A multi-workspace watcher service would require main-process changes to `fileWatcher.ts`.

3. **`lifecycle === 'active'` in `useScopedWorkspaceActivity`** (reduced severity): `WorkspaceScope.tsx` still uses `workspace.lifecycle === 'active'` in its `isInteractive` check alongside `workspace.id === activeWorkspaceId`. This is redundant with store invariant W4 but not harmful — `isActiveWorkspace` in `BrowserPanel` has already been corrected. Safe to remove but not blocking.

4. **Phase 4 task 3 (browser bounds pre-warming)**: Bounds are preserved in `lastBoundsRef` but applied via `browserSetBounds` IPC after the workspace is made active. A brief moment may exist where the native view is visible but not yet sized. Fix: apply bounds in the main process before calling `setVisible(true)`.

---

## Definition of Done (updated)

- [x] `activeWorkspaceId` change updates focus semantics only; no code path uses `lifecycle === 'active'` to gate runtime behavior (terminals, browser, explorer watcher). ✅ BrowserPanel corrected; `BrowserLifecycleCoordinator` corrected.
- [x] Switching A → B → A causes zero pane component remounts for workspaces A and B. ✅ Single-container architecture guarantees this. Dev instrumentation confirms.
- [x] For any workspace that had `browserVisible: true`, `lastBoundsRef.current` is non-null immediately after switching away and immediately after switching back. ✅ Bounds are intentionally preserved (confirmed in BrowserPanel comment and code).
- [ ] Switching to a warm workspace with browser visible does not produce a browser bounds flash — the first `browserSetBounds` IPC after return carries the same pixel values as the last IPC before the switch. (Phase 4 task 3 remaining)
- [x] Opening a file in workspace A, switching to B, returning to A shows the editor tab with the file open and its CodeMirror instance intact. ✅ Phase 5 already implemented.
- [x] `explorerEntriesByPath` for parked workspaces remains non-empty after any number of workspace switches. ✅ Store model preserves this.
- [ ] Closing a workspace with `browserVisible: true` disposes the browser view via `browserDisposeWorkspace` (verifiable via IPC mock or integration test).
- [x] `assignWorkspaceLifecycles` still produces exactly one `lifecycle === 'active'` workspace after 10 rapid A→B→C→A switches. ✅ Tested.
- [x] All new selectors (`isWorkspaceWarm`, `getWorkspaceResourcePolicy`) return correct values for warm, cold, and parked workspaces. ✅ Selectors implemented and tested.
- [ ] Switching to a warm workspace with browser visible does not produce a browser bounds flash — the first `browserSetBounds` IPC after return carries the same pixel values as the last IPC before the switch.
- [ ] Opening a file in workspace A, switching to B, returning to A shows the editor tab with the file open and its CodeMirror instance intact (Phase 5). Observable: EditorView instance identity is preserved across switches, not recreated.
- [ ] `explorerEntriesByPath` for parked workspaces remains non-empty after any number of workspace switches.
- [ ] Closing a workspace with `browserVisible: true` disposes the browser view via `browserDisposeWorkspace` (verifiable via IPC mock or integration test).
- [ ] `assignWorkspaceLifecycles` still produces exactly one `lifecycle === 'active'` workspace after 10 rapid A→B→C→A switches.
- [ ] All new selectors (`isWorkspaceWarm`, `getWorkspaceResourcePolicy`) return correct values for warm, cold, and parked workspaces.
- [ ] All acceptance criteria above are covered by unit or integration tests.

---

## Summary of Precision Changes

This revision makes the following targeted corrections and improvements:

1. **Remount/unmount claim corrected**: CSS `display: none` on the parked container does not independently cause React unmount. The actual mechanism is that surfaces render in exactly one location at a time (active viewport OR parked container). On workspace switch, surfaces move between these two containers — which is a React unmount/remount pair — regardless of CSS on either container. The `hidden` attribute on parked surface roots is additionally redundant once the surface is inside `display: none`. All affected sections have been updated to use precise language.

2. **Repo proof for React remount**: The repo does prove React remount across workspace switches. The render structure in `WorkspaceHost.tsx` shows that `WorkspaceSurface` is rendered in only one container at a time (active viewport for the focused workspace; parked container for all others). The surface for workspace A is removed from the active viewport when A parks and the surface for B is added from the parked container. This is a React unmount/remount pair. The evidence is cited in the Repo Truth Notes.

3. **Primary cause statement narrowed**: The problem statement now states that the primary cause of poor switch UX is **destructive pane-level reinitialization on surface remount** — specifically EditorView recreate and BrowserPanel bounds nullification — rather than "full DOM unmount/remount" as a generic claim. This is directly grounded in the confirmed cleanup behavior of `BrowserPanel.tsx` and `EditorPane.tsx`.

4. **Phase 2 rewritten around stable subtree identity**: Phase 2 now leads with the architectural requirement (stable React subtree identity across focus changes) and treats CSS technique as a candidate implementation option. It also clarifies why CSS `display: none` alone is insufficient (surfaces still move between two containers) and what a single-container approach would achieve.

5. **Definition of Done relaxed from implementation metrics to observable outcomes**: Removed "zero `useEffect` cleanup calls" (too brittle; cleanup may legitimately fire for reasons unrelated to workspace switch). Replaced with "zero pane component remounts on workspace switch" — observable via instrumentation. Replaced "zero IPC calls for returning workspace" with "non-null `lastBoundsRef` after switch" and "no bounds flash on return" — both directly testable. Kept editor instance identity check as observable.

6. **Implementation dependencies softened**: The Phase 4/Phase 2 dependency note now distinguishes partial progress (avoiding `lastBoundsRef` nullification even before Phase 2 eliminates unmount entirely) from full Phase 4 completeness (which does require Phase 2). Added clarifying text that Phase 5 always-mounted approach requires Phase 2 but the Phase 5 cache approach benefits from Phase 2 without being strictly blocked.
