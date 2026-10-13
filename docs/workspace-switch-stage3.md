# #176 Stage 3 — checkout-keyed descriptive Git snapshots

Starting point: accepted Stage 2 `9f3452f009903ea938d84902019fc211fddc952c`.
Read the full revised issue and Stage 1/2 notes before implementation. This is a
presentation cache, not a resource coordinator or an alternative polling owner.

## Ownership, identity and lifetime

`checkoutGitStore` still has **exactly one active acquisition snapshot**. `begin`
creates a new monotonically increasing generation with `loading` and `result: null`,
even on a cache hit. Controller remount keys (workspace, scope, selection epoch),
cleanup/stop and main poll-start/stop validation are retained. Main code is unchanged:
`GitService.startPolling` stops the previous poller, and its existing bounded pending
poll rejects obsolete work. The cache has no timers, IPC calls or independent reads.

A separate in-memory array holds up to **32 descriptive entries**, LRU oldest first.
Selection hits and accepted acquisitions move an entry to the end; insertion evicts
oldest entries. Physical identity uses the **existing** `checkoutGitKey` tuple:
workspace ID + environment ID + checkout context ID + canonical selected root. An
omitted context means that workspace's derived main ID, not any arbitrary context.
The existing exact key and `sameWorkspacePath` echo/registration checks are reused;
no path-only, repository-wide or cross-environment sharing was introduced. Selection
epoch is **not** a physical key and is never retained in a description.

Stored: explicit physical identity/key, branch, detached/repository state, unique
changed-file count (partially staged paths count once), upstream/ahead/behind and
`acquiredAt` (renderer acceptance time). Upstream metadata is descriptive tooltip
text. Excluded: file-change lists/paths, status results, history, stashes, remotes/URLs,
provider context, credentials and historical presentation generations. No persistence.
The existing large `GitButton` integration point only gains hook/trigger wiring;
formatting is kept in the focused `GitLastKnown` component.
No TTL: every historical hit is stale regardless of its timestamp/age; an expiry is
not needed to establish freshness because only a new verified acquisition does that.

Only successful status with matching workspace/environment/root/context echoes and
presentation generation can update history. Cache updates also require a live,
non-missing renderer registration, the active workspace, and a current selection epoch.
For managed acquisitions `apply` now checks the live selection's physical key and
synchronous epoch as well as its existing generation/echo guards. This rejects an old
A answer even before effects have run after a React-batched A→B→A. Optional legacy
status fields keep their existing current-status contract, but missing scope/epoch
proof cannot seed the cache. Failure, invalidation and rejected results do not replace
a valid description or its acceptance timestamp.

A bounded metadata-only subscriber prunes history when workspace/context/root identity
disappears, changes environment/path or is marked missing. Reopening/re-adopting after
that notification starts cold. Closing a workspace drops its descriptions, not other
workspaces' same-path entries. Invalid/unregistered/historical-disagreement selection
uses the existing checkout-unavailable component; registered history may remain in
memory but is not shown through that selection. SSH connectivity failure alone does
not imply that a registered checkout disappeared; valid history remains explicitly
stale/unavailable. Missing/unregistered contexts never authorize a fallback to main.

## Presentation and authority

While a valid returning scope is loading, the toolbar displays e.g.
`main · 3 changes · Last known`, muted, with a `Refreshing Git…` title and accessible
`aria-description` identifying it as **not current**. Only the branch portion truncates;
the stale marker remains visible. Zero means `0 changes · Last known`, not verified
clean. Detached HEAD and previously confirmed non-repositories have explicit labels.
On acquisition failure the toolbar retains description with **Git unavailable**, and
includes a returned error in its tooltip. Checkout-unavailable takes precedence over
all history. New verified status removes the marker immediately and supplies the
existing current dirty badge/branch presentation, including changed counts or branches.

`checkoutGitAvailability` and `matchingCheckoutGit` still describe **current** status
only. A cache hit never sets `ready`/`statusKnown`, creates a result or actionable
changes list, sets local `isRepo`/branch/action state, or copies metadata into workspace
state. `GitLastKnown` has no action props and is used only in the toolbar/tooltip.
A returning controller keeps the existing disabled initialization/loading overview
until current polling arrives; staging/commit/branch/merge controls are not made
available by the cache. Main operation identity/root validation remains independent.
The existing Source Control section loading/error/action behavior is otherwise retained;
section independence and redundant post-mutation acquisitions remain Stage 4 work.

## Regression evidence

- `checkoutGitCache.test.ts`: physical-key isolation (same path local/two SSH
  environments/two workspaces; main/isolated contexts), A/B/A new generation,
  late A/B and batched round trips, rejection/required echoes, no current authority
  or workspace copying, LRU promotion/eviction/reacquisition, dirty↔clean/branch
  replacement, verified non-repo versus unknown, acquisition
  failure, closure, retirement/missing/unregistered contexts and no store-owned poll.
- `GitLastKnownToolbar.test.tsx`: actual stale text/title/accessibility, clean/dirty
  changes, detached/upstream description, failure, cached non-repo disabled init,
  actual disabled select/button and absent stage/commit/branch/merge controls,
  no mutation IPC, fresh replacement, dialog dismissal on batched switching,
  missing-checkout precedence, and unchanged controller start/stop ownership.
- Existing observed-checkout integration now expects stale toolbar presentation on
  returning scopes but still asserts loading/current/error authority, zero cached
  dirty badges/decorations, late-result protection and unchanged generations for
  agreeing historical evidence.
- Real checkout smoke revisits an adopted isolated worktree. An owned fixture-only
  wrapper holds the **real** next Git read (no fabricated result); the visible stale
  marker, zero current badge, new renderer/main generation and disabled/no mutation
  controls are checked before releasing it. Real acquisition then replaces history.
  The wrapper is restored/released in `finally`; all existing dirty/provenance and
  generation assertions remain. No production authority hook was modified.

## Paired live measurement against Stage 2

Reproduce after `npm run build`:
`node scripts/workspace-switch-measure.cjs > /tmp/stage3.json`.
Port 1420 must be free. Accepted Stage 2 was measured **before cache implementation**,
with only identical `git_presentation` layout-effect diagnostics and pre-click marks
added. Existing bounded opt-in events/counters remain production-disabled; added data
contains freshness/hit booleans, opaque IDs and generations, no Git payload or paths.

Same Linux 7.2.9-2-cachyos, Node 26.11.1/npm 12.2.0, Electron 41.10.7, React 19.2.4;
headless Ozone, dev StrictMode, disposable profile/HOME, four small local repositories.
Workspace layouts are empty; Explorer dock is default collapsed. Open A/B/C/D and
settle; cold A/B then warm A/B/A. Checkout rows have two actual shell PTYs and a
Git-listed adopted worktree. Observe through frame/current branch plus one second.

`git_presentation` is the toolbar **DOM layout commit**, not compositor paint or Git
command completion. Workspace times below start at `switch_start`; checkout times
start at the renderer's pre-click mark and include backend-counter query/Playwright
click overhead. CPU is root App Profiler sum/largest commit, milliseconds, including
resource renders. Initial-visit misses are additionally recorded after implementation;
that collection waits for first current status before the one-second settle. The old
baseline did not retain initial-visit traces. No throttling/randomized order/percentiles.

| Workspace selection | Stage 2 first current | Stage 3 last-known | Stage 3 current | Frame 2 / 3 | Commits 2 / 3 | CPU Stage 2 | CPU Stage 3 |
|---|---:|---:|---:|---:|---:|---:|---:|
| D→A cold | 43.4 | 19.6 | 49.5 | 38.8 / 43.3 | 4 / 4 | 34.3 / 16.7 | 38.7 / 17.2 |
| A→B cold | 37.4 | 18.2 | 47.7 | 32.5 / 41.4 | 5 / 5 | 30.3 / 13.9 | 37.7 / 16.8 |
| B→A warm | 32.5 | 19.1 | 36.9 | 33.9 / 30.6 | 5 / 4 | 24.9 / 14.1 | 28.5 / 17.8 |
| A→B warm | 34.7 | 18.2 | 35.8 | 27.3 / 30.0 | 6 / 4 | 25.6 / 14.9 | 27.8 / 16.8 |
| B→A warm | 29.1 | 18.3 | 37.6 | 30.4 / 29.5 | 5 / 5 | 21.7 / 12.7 | 29.4 / 16.7 |

All five after selections hit history, including cold surfaces: cache lifetime is not
React residency. Before had no last-known toolbar description; first generic loading
commits were 14.7/14.8/15.3/16.1/13.8 ms. Stage 3 first-visit A/B/C/D were all misses:
loading DOM at 55.3/54.6/49.3/72.5 ms, current at 123.2/126.3/115.9/150.7 ms from
submit's pre-click mark (includes workspace registration/preparation; not comparable
to existing-workspace selection times).

| Checkout focus | Stage 2 first current | Stage 3 last-known | Stage 3 current | Commits 2 / 3 | CPU Stage 2 | CPU Stage 3 | IPC peak 2 / 3 |
|---|---:|---:|---:|---:|---:|---:|---:|
| isolated→main | 89.6 | 64.2 | 83.2 | 4 / 6 | 35.9 / 22.3 | 35.7 / 21.3 | 9 / 10 |
| main→isolated | 73.6 | 57.9 | 77.3 | 5 / 5 | 27.5 / 17.5 | 28.9 / 16.5 | 9 / 9 |
| isolated→main | 73.7 | 60.8 | 81.7 | 4 / 4 | 25.7 / 16.5 | 34.8 / 21.9 | 9 / 9 |

All three after checkout rows hit history. No new workspace-shell frame applies.
Before's generic loading commits were 67.0/57.3/58.0 ms from the same pre-click mark.

**Every workspace and checkout row, both versions:** 7 invoke starts (Explorer
start-watch 1, Git remotes 2, Git start-poll 2, Git stop-poll 2), 2 backend status
operations, peak instrumented read concurrency 1. Workspace invoke peak 7 throughout;
checkout peaks include carry-in invokes. StrictMode replay remains included. No
SSH/file/directory reads in these measured windows; no cache-owned acquisitions.

Interpretation: useful **explicitly stale** metadata was committed before fresh
reacquisition in every revisited scope. This establishes the presentation benefit,
not faster verified status or a general switching speedup. Freshness and CPU were
usually slower in these individual samples; frame/commit counts varied. There are
only five workspace/three checkout observations per version, tiny local repos and
dev logging; representative large/dirty projects, production timings, compositor
paint, long-run allocation/GC and slow host measurements remain unverified.

## Verification and scope limits

All required Electron runners passed with **exit 0**: checkout presentation,
workspace-switch measurement, workspace-page/Browser (24 transitions), launch-race,
and Source Control management (real stage/unstage/commits, isolated checkout, context
switch, all sections/themes/sizes/zoom and native Browser suppression/restoration).
The Source Control runner now uses the accepted Stage 1 owned teardown helper because
it launches two shell PTYs; both real exit promises and natural Electron exit were
verified. No close guard, automatic approval, process-name kill or user-root cleanup.
The updated checkout and measurement fixtures also verified PTY/Electron exit.

`npm run validate` passed: branding, lint, typecheck, both Fallow identity baselines,
security check (only the documented dev-only exception), build, **7,760 tests across
395 files**. Targeted renderer/Git IPC suites passed 200 tests across six files;
main polling and real checkout-Git suites passed another 35 tests across two files.
The new cache/toolbar suites contribute 33 cases, including parameterized scopes/errors.

No live SSH fixture was authorized/provided, and no host was contacted; SSH identity/failure coverage is
mocked renderer coverage only. Existing main Git polling/IPC authority suites remain
in the full required validation. No Source Control section split, post-mutation read
removal, Explorer/watch change, refresh coordinator, session-history/startup change,
warm-cap expansion or production close-guard/authorization modification. Stop after
Stage 3; no merge or Stage 4.
