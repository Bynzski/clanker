# #176 Stage 2 — activation versus normalization

Starting point: accepted Stage 1 `2651d543e343d5b94dc2ad8a678e898dc61b1487`.

## Contract review (recorded before implementation)

| Boundary | Required invariants / responsibility |
|---|---|
| `addWorkspace` | Merge Explorer/editor/notes defaults, name terminals, normalize browser tabs, runtime metadata, checkout backfill and layouts/pages once; activate the registered shell. |
| `hydrateWorkspaceShells` | Normalize new prepared shells; preserve live canonical duplicates; choose identity by environment + root. |
| `prepareWorkspaceShell` / restoration | Main validates root/environment/context; restore bounded V1/V2 page preferences on an empty shell; store ingestion performs final normalization. Restoration ordering/persistence remains unchanged. |
| `sanitizeWorkspace` | Copy ingestion arrays/maps; backfill contexts and terminal launch bindings without overwriting recorded IDs; repair browser tabs/defaults and runtime policies; build/prune layout and synchronize pages. These are ingestion/repair operations, not normal activation. |
| `patchWorkspaceById` / `syncActiveWorkspace` | Live writes synchronize page membership, active-page projection, browser ownership, minimized/maximized state and pending terminal IDs at the mutation boundary. Scoped parked writes must not replace the active global projection. |
| Page/terminal actions | Page selection projects its layout, Browser and terminal focus; explicit terminal reveal can restore a minimized pane, switch pages and clear file focus/maximization. This is real state change and still needs synchronization. |
| Ordinary activation | Select existing workspace, assign exactly one active lifecycle, project that workspace's current references; preserve global viewport. Never rebind contexts, promote observations, move PTYs or reset dirty buffers/browser/cache/history. |
| Test/embedding `setState` | Legacy partial snapshots bypass ingestion; retain a structural compatibility repair path, not a permanent normalized flag. Untrusted persisted data must still use the ingestion APIs. |

Runtime writers were reviewed for reliance on activation repair: workspace/page actions
use synchronization helpers; terminal add binds checkout IDs; removal/reservations and
late page writes preserve ownership/selection; direct Host/TerminalPane writes change
only residency or readiness. Page preferences explicitly refuse replacing live panes.
The dev consistency validator checks lifecycle, pane membership/layout, Browser,
editor and active-terminal state; reference identity and full page projections need
additional targeted coverage.

## Implemented activation boundary

`prepareWorkspaceActivation` returns the same live object when its initialized page,
projection, arrays/maps, environment/runtime metadata and checkout/terminal bindings
are present. It compares projection references/scalars, scans page/context/terminal
identity fields, and does not walk/rebuild layouts, Browser tabs, caches or editor
contents. It is a **compatibility shape check**, not a deep validator for arbitrary
persisted bytes. Raw persisted data must use add/hydrate even if it already has pages.
Legacy direct `setState` snapshots with missing metadata/pages/bindings or inconsistent
projections still run the full sanitizer once; repeated selection then uses the live path.
No durable normalized bit or reference cache was introduced.

Ordinary selection no longer runs terminal binding/backfill, browser/tab reconstruction,
runtime-policy normalization, layout rebuilding, page pruning/synchronization, or the
array/map copies for terminals, panes, editor tabs, Explorer, Git changes and undo.
`assignWorkspaceLifecycles` is unchanged: only roots with changed lifecycle are shallow
copied. The active snapshot projects the actual selected lifecycle-assigned workspace.
The viewport and other global state survive Zustand's partial-state merge. Same-active
selection retains the workspace object but still publishes selection and leaves an
Assistant as before; avoiding publication would change externally observable behavior.

A supplied valid terminal still uses `revealTerminal` and `synchronizePages`, including
page changes, minimized restoration, maximization exit and file-focus clearing. That
real mutation can replace pages/minimized/pending-ID arrays; IDs and resource objects
remain owned by the same workspace. Missing, foreign or invalid terminal IDs retain the
requested workspace's focus/state. Unknown workspace IDs do not select another root.

Normalization was not moved to another always-run selection helper: add/hydrate already
owned full normalization and retain it. Their sanitizer now supplies missing legacy
Explorer/editor/notes arrays and basic pane/browser defaults before accessing them;
add's terminal naming tolerates a missing terminal list. Default filling is centralized
in the sanitizer rather than duplicated in add, so hydration/repair receives the same
legacy defaults. Restoration authority,
identity/deduplication, V1/V2 parsing, persistence and preparation order are unchanged.
No legitimate live mutation was found to require full activation-time sanitization;
existing mutation/page repair helpers remain in place.

The consistency validator now recognizes Browser pane IDs owned by every page (not
only the selected singleton) and checks terminal/revision/undo/Browser projection,
including placement hints. This fixes false invalid-membership warnings for parked
Browsers and supplements the previous layout-only projection check. The established
helpers module is now about 840 lines: the small compatibility guard stays beside its
sanitizer/snapshot contract deliberately, rather than introducing a new state layer.

## Reference and invariant regression coverage

`workspaceActivation.test.ts` adds 17 cases (including parameterized invalid IDs):
repeated A/B/A with deeply frozen input graphs, already-active selection/publication,
five workspaces with cold reactivation, cross-page minimized/maximized terminal reveal,
invalid/missing/foreign targets, dirty content and original baselines, independent
multi-page Browsers/layouts/undo, Explorer cache/expansion preservation, local and SSH
identities at the **same textual root**, main/isolated contexts, partial add/hydrate,
legacy direct-set repair, inconsistent projection repair, parked mutations and rapid
page changes with pending launch reservations. Ordinary activation asserts identity of
18 nested fields plus unchanged resources. Legitimate parked editor/Explorer writes
produce new references; a scoped React selector renders for a content mutation but
not for later activation. The input freeze checks prohibit in-place mutation.

Existing warm-cap/eviction, restoration/race/V1/V2, checkout authority/provenance,
page movement and dirty-buffer suites also remain unchanged and pass. Every normalized
selection in the new suite checks `validateWorkspaceConsistency` and the active global
projection. A legacy recorded isolated launch ID is never rebound to main, even when
its context is not registered/descriptively present.

## Paired live measurements against accepted Stage 1

Reproduce: `npm run build`, then `npm run diagnose:workspace-switch` (or
`node scripts/workspace-switch-measure.cjs > /tmp/stage2.json` for pure JSON).
Port 1420 must be free. See `workspace-switch-stage1.md` for opt-in inspection,
frame/commit/IPC/backend definitions and corrected owned fixture cleanup.

Before was **2651d54**, with only the new bounded dev-only `activation_references`
event added; no subscription or normalization behavior changed for that measurement.
After used Stage 2 and exactly the same instrumentation/runner. This event compares
16 fixed nested field references synchronously inside selection, before resource
effects, and records only changed **field names** and opaque IDs. It is not an allocation
profiler or count of later mutation-driven replacements. Production remains disabled.

Same Linux 7.2.9-2-cachyos / Node 26.11.1 / npm 12.2.0 / Electron 41.10.7 /
React 19.2.4; development StrictMode, headless Ozone, disposable HOME/profile, four
small Git repos; A/B/C/D opened with one-second settles, then cold A/B and warm A/B/A.
Workspace switches have empty pane layouts. Explorer dock exists, but the unchanged
runner does **not** expand it or directories (default collapsed; the Stage 1 note's
“Explorer visible” shorthand does not mean an expanded file-tree workload).
Each selection observes frame completion plus one second. Checkout focus uses two
real shell PTYs and waits for current branch presentation, then one second. No
throttling, randomized run order, long-run percentiles or production benchmark.

Raw individual observations, milliseconds; CPU = sum / largest root App commit:

| Selection | Stage 1 frame | Stage 2 frame | Commits 1 / 2 | CPU Stage 1 | CPU Stage 2 | Replaced refs 1 / 2 |
|---|---:|---:|---:|---:|---:|---:|
| D → A cold | 46.3 | 31.8 | 4 / 4 | 44.4 / 18.8 | 29.1 / 13.0 | 13 / 0 |
| A → B cold | 39.7 | 40.1 | 5 / 5 | 35.4 / 16.4 | 38.6 / 17.1 | 13 / 0 |
| B → A warm | 33.6 | 31.5 | 4 / 5 | 31.2 / 19.5 | 24.0 / 14.0 | 13 / 0 |
| A → B warm | 35.2 | 25.9 | 4 / 5 | 31.9 / 18.8 | 23.6 / 14.1 | 13 / 0 |
| B → A warm | 27.5 | 26.9 | 6 / 6 | 29.4 / 14.1 | 27.9 / 13.3 | 13 / 0 |

In Stage 1 all five selections replaced terminals, panes, editorTabs, Explorer's
expanded/cache/loading/error collections, pages, layoutUndoStack, checkoutContexts,
runtimeState, gitChanges and minimizedPanes. Stage 2 replaced none of those 16 checked
fields. Empty fixture layoutRoot/browserPane and absent pending IDs cannot demonstrate
nonempty-tree/tab preservation; the populated reference tests cover those separately.

**Every row, both versions:** 7 invoke starts: Explorer start-watch 1, Git remotes 2,
Git start-poll 2, Git stop-poll 2. Peak unresolved invoke promises 7; backend Git status
operations 2, peak instrumented backend read concurrency 1. No directory/file or SSH
reads in these switch windows. StrictMode effect replay remains included; no new poller
or cache owner was introduced.

Checkout-only selection (no new workspace-shell frame metric; unchanged action path):

| Focus | Commits 1 / 2 | CPU Stage 1 | CPU Stage 2 | IPC peak 1 / 2 |
|---|---:|---:|---:|---:|
| isolated → main | 7 / 6 | 32.8 / 18.6 | 37.1 / 21.0 | 10 / 10 |
| main → isolated | 5 / 4 | 39.6 / 23.9 | 33.0 / 21.6 | 9 / 9 |
| isolated → main | 6 / 4 | 33.3 / 20.1 | 36.7 / 21.5 | 9 / 9 |

Again 7 identical categorized IPC starts, 2 backend status operations, backend read
peak 1 for every checkout row. IPC peaks include earlier pending invokes. Terminal-pane
focus uses its existing action; there is no workspace activation-reference event here.

**Conclusion:** eliminated synchronous normalization/replacement is measured directly
and backed by reference tests. These small timing/CPU samples vary (one cold switch
and two checkout-focus CPU totals got slower), so no general latency or percentage-speedup claim
is justified. Git data acquisition, watchers and other resource-triggered renders still
run; their remaining costs belong to later stages, not this change.

## Verification and limitations

- Targeted nine existing/new suites: **375 tests passed**; full validation is
  **7,727 tests across 393 files**, with branding, lint, typecheck, both Fallow baselines,
  security check (only its documented dev-only exception) and build passing.
- Real Electron workspace-page/Browser smoke: **exit 0**, all 24 transitions and
  native identity/form/JS state, stale geometry, movement, minimization and persistence
  assertions passed.
- Workspace launch-race smoke: **exit 0**, startup/cache/late-spawn kill and page/drag/
  layout assertions passed.
- Checkout presentation: **exit 0**, all main/two-worktree, dirty matrices, generation,
  observation/unavailable/historical, sidebar focus and retirement assertions passed.
- Workspace-switch fixture: **exit 0**, all 5 workspace and 3 checkout transitions;
  fixture PTY exit and natural Electron close verified. Accepted Stage 1 teardown
  helper is unchanged; no assertion-only shutdown success or timeout.
- SSH is tested in renderer identity/checkout simulations only. No authorized
  disposable SSH fixture was supplied; no host was contacted. Live SSH filesystem,
  latency and concurrency remain unverified. No authority/IPC/main-process code changed.
- Compatibility repair is not a substitute for validated ingestion of arbitrary raw
  persisted bytes. Raw embedding clients should use add/hydrate (or sanitize first).
  Nonempty live switch timings, production/compositor paint, long-run allocation/GC
  profiling and representative large/dirty projects remain unmeasured.

No Git cache, Source Control loading/refresh changes, Explorer watcher/concurrency
changes, resource coordinator, session discovery/startup redesign, warm-cap expansion
or close-guard change. Stop after Stage 2.
