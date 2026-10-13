# #176 Stage 4 — independent Source Control resources

Base: accepted Stage 3 `cc0145bd2e55dfc431bc8e653abb7d71b0e3bca9`.

## Pre-change audit (recorded before production changes)

The full issue and Stage 1–3 documents were reviewed. Header owns one selection-keyed
GitController; main owns one polling loop. Source Control metadata is controller-local,
not authoritative registry state. The dialog starts on Changes. Changes uses the active
checkoutGitStore status, file review and commit composer; it does not require menu
branches/history/stashes/provider. Branches needs branch state and provider context;
Merge needs branch targets plus operation state; Overview displays status, operation,
remotes and provider; History needs a bounded list and explicitly selected summary;
Stashes and Remotes need their respective lists. Worktrees already owns its listing.

Before: controller mount reads remotes. Menu open bundles branch/operation/stash/history
with Promise.all, then remotes/provider; one generation and slowest completion gate all.
Branch failure invalidates unrelated current status. List failures may be swallowed by
main as empty history/stashes. refreshAfterAction reloads everything and status.

Post-stage/unstage/commit main calls getStatus and publishes GIT_STATUS_UPDATE even when
mutation fails. Renderer successful mutations additionally call gitRefresh/getStatus.
GitController is the sole renderer status subscriber; it feeds the active snapshot,
main workspace metadata, toolbar, Explorer/decorations/counts and commit composer. Manual
refresh applies its response without an event. Removing main notification would strand
other IPC callers; keeping main acquisition + returning its same scoped status is safer.
Both local and SSH use this same IPC handler through withWorkspace; transport differs,
not ownership. Preserve scope/epoch/generation checks and treat refresh outcome separately.

Controlled **real Electron/Git**, existing Source Control management fixture, with only
fixture backend counters and its existing poll timer paused (poll identity untouched):
mount = 1 remotes + 1 status. First Changes open = branches 1, operation 1, stashes 1,
history 1, remotes 3 (includes provider-internal reads), peak instrumented read overlap 4.
Per-file stage/all stage/per-file unstage/all unstage each = 1 mutation + **2 status**.
Commit staged = 1 commit + **2 status**; all-and-commit's initial aggregate showed
**4 status**. The final call-site-classified baseline distinguishes **3 required** reads
(stage notification, commit notification, renderer refresh); watcher work explains why
aggregate marks alone cannot establish mutation-owned counts.
History visit adds its explicitly selected diff, other section lists already acquired.
Worktree creation provokes another broad refresh. Raw baseline:
`/tmp/176-stage4-source-before.log`; switching: `/tmp/176-stage4-switch-before.json`.
These counts are method-level backend acquisitions, not events or IPC invokes. Failures
and partial staging require their own regression/live probes below. No general speedup
is inferred from this tiny local fixture.

## Ownership and demand

`useGitMenuResource` gives each controller-local acquisition its own
`not-requested/loading/ready/error`, last accepted data, error and request generation.
There is no new poller, timer, persistence or cross-checkout metadata cache.
GitButton remains the existing 821-line status/action/dialog integration point; new
resource lifecycle logic is extracted into small hooks rather than extending it. Revisit
reuses an acquired resource; explicit Refresh/Retry forces only that resource (or
that section's declared dependencies). Close invalidates outstanding requests,
returns to Changes and resets the bounded history window/diff selection. Physical
scope changes still remount the controller. Loading/errors never imply verified
empty data: previous rows remain explicitly last-known, with dependent mutations
disabled; discovery errors retain their own retry controls. Known unborn history is
still empty, but other history/stash read failures now reject rather than become `[]`.
The unused `selectedVcsCheckoutId` compatibility wrapper lost its last production
caller and was removed, without changing `currentVcsCheckoutId` or canonical selection.

| Surface | Demand / owner | Manual refresh |
|---|---|---|
| Toolbar, Explorer counts, Changes, composer | Existing active status snapshot / main poller | Changes reacquires status |
| Branches | Branch state + independent provider | Branch state; provider has its own Refresh/Retry |
| Merge | Branch targets + operation state | Both, independently |
| History | 10→25→40→50 list, explicit commit/working/staged summary | List + currently selected summary; failed paging does not advance window |
| Stashes | Stash list | List |
| Remotes | Repository remote configuration | Configuration |
| Overview | Existing status + operation/remotes/provider | Those dependencies independently |
| Worktrees | Existing section-owned inventory/lifecycle | Existing section reload, no bundled metadata acquisition |

Failed same-selection summary refresh preserves a marked last-known summary;
changing selection clears it and invalidates older callbacks. Resource settlement
checks dialog lifetime, exact scope and synchronous selection epoch; manual refresh
supersedes older same-resource requests. A→B→A, same path in different environments,
workspace closure and missing/released checkouts cannot resurrect old responses.
Other resources and current status are unaffected by metadata failure.

## Mutation invalidation and one status acquisition

Main retains its status notification after stage/unstage/commit and returns **that
same scoped result** with `GitChangeMutationResult`. Renderer consumes it without
calling `gitRefresh`. Mutation success/error is separate from `refreshError`, including
unexpected post-mutation exceptions or renderer delivery loss. Failed commands also
reacquire once because index writes/hooks may partially succeed. Stage-all-and-commit
retains its intermediate stage acquisition, then its commit acquisition: failed
commit reports staging's partial success and leaves the draft/index recoverable.
Successful commit + failed read settles the draft, shows the truthful warning and
disables mutations until explicit recovery; it never repeats the commit.

The main read-start `acquisitionSequence` orders same-generation status responses.
Both controller and active snapshot reject older/equal sequenced packets (including
event + returned-result duplicates); invalidation retains the sequence. Scope/context/
root echoes, registration checks, selection epochs and presentation generation remain
required. Legacy optional echoes remain compatible, but cannot seed Stage 3 history.
That 32-entry cache still supplies descriptions only, never current lists or authority.

| Mutation | Metadata invalidated / next demanded read |
|---|---|
| Stage / unstage | Status from same main result; file review/summary invalidated; no metadata bundle |
| Commit (including possible partial failure) | Branch/operation/history/provider + summary; not stashes/remotes |
| Create or switch branch | Head-related resources + worktree reconciliation/inventory (create uses `switch -c`) |
| Delete branch | Branches + worktree reconciliation/inventory only |
| Stash creation/apply/pop | Stashes + operation/status + summary; apply/pop returned failure also refreshes conflicts |
| Drop/clear stash | Stashes only; existing main notification retained |
| Merge/abort | Head-related resources/status; failed merge also inspects possible conflicts |
| Pull | Head-related resources/status |
| Fetch/push/publish | Provider/status; no history/stash/remote-config reload |
| Remote configuration edit | Remotes + provider |

Other mutation families retain their existing main notifications and necessary
renderer refreshes; this stage does **not** attempt universal status-read deduplication.
Worktree removal/reservations and filesystem watcher concurrency remain unchanged.

## Real Electron evidence

Same small local fixture and Linux/Node/Electron/React environment as Stage 3.
Source Control counters count actual backend method entries (including nested provider
remote reads), not IPC events or subprocess totals. Only the existing poll timer is
paused, preserving its identity. Native filesystem watcher acquisitions remain real
and are reported separately, not suppressed to improve numbers.

| Controlled action | Accepted Stage 3 | Stage 4 |
|---|---:|---:|
| Mount remote-config read | 1 | 0 |
| Open Changes: branch/operation/stash/history | 1 each | 0 each |
| Open Changes: remotes (incl. provider internals) | 3 | 0 |
| Stage or unstage file/all: required post-mutation status | 2 | 1 |
| Commit staged: required post-mutation status | 2 | 1 |
| Stage-all-and-commit: required post-mutation status | 3 | 2 |

History first visit now acquires one list and selected diff; Overview requests only
operation/remotes/provider. Already acquired section revisits do not reread. The full
fixture still visits all sections, so deferred work is not claimed as work eliminated.
Full-run method overlap peak was 5 before and 2–3 after across runs (nested entries
included). Final call-site counters confirm no renderer post-mutation read: file stage
and commit each have mutation=1/manual=0; all-and-commit mutation=2/manual=0 versus
baseline mutation=2/manual=1. Explicit manual recovery remains one separate read.

The bounded owned probe gates a **real Git log command**, then visits Branches. On
accepted Stage 3 (built from a temporary `git archive`, no branch/worktree registered),
Branches was still unavailable at the 392 ms observation; after it was ready at 73 ms
**while History remained held**. Held-probe peak method overlap: 4→2 in the final paired run (earlier after run: 3). This demonstrates
independence, not ordinary latency/paint improvement. Changes already had current
status before opening in both samples; there is no measured first-status speedup.

The same probe rejects exactly one owned fixture status command after a real successful
Stage. Before: two status acquisitions recovered current state, hiding the first error.
After: one mutation/one acquisition, actual index staged, explicit “Stage succeeded,
but status could not be refreshed”, disabled commit despite a non-empty draft, and one
explicit Refresh restored current data without another mutation. No successful status
or list was fabricated. The gate auto-releases within eight seconds and is released
and restored in `finally`.

Paired workspace/checkout switch measurements show **7→5 invoke starts** per row:
removing mount remotes eliminates two StrictMode invokes. Main status acquisitions
remain **2**, instrumented read peak **1**. Workspace invoke peak 7→5; checkout peaks
10/9/9→8/8/7 include concurrent terminal/usage work. Warm shell-frame samples were
32.9/32.6/31.6→30.8/30.1/30.8 ms; cold revisits 33.8/42.3→33.6/42.9 ms.
Current Git toolbar commits remained mixed (warm 31.0/31.0/37.5→37.0/35.9/36.9 ms).
These few headless dev StrictMode samples establish read suppression, **not a general
switching, CPU, allocation/GC, production or compositor-paint speedup**. All returning
scopes still displayed descriptive history before fresh status.

## Verification and reproduction

Regression coverage includes demand/revisit/manual refresh, slow history/fast branches,
fast history/failed stashes, remote/provider isolation, explicit retained rows,
independent retry, close/reopen, A→B→A/local-vs-SSH same path, workspace closure/missing
checkout, selected-summary races, selective stash/commit invalidation, one mutation
response, duplicate/older notifications, failed reacquisition and staging partial
success. Existing Changes/Source Control/initialization and real Git history/stash
contracts were updated for the same-result API and honest resource failure behavior.
Main IPC tests cover stage/unstage/commit success and failure with exactly one read.

All five Electron runners exited 0: Source Control management, checkout presentation,
workspace-switch measurement, workspace-page Browser and launch race. Source Control
verified real main/linked-worktree staging, commits, creation and Browser leases;
checkout smoke verified main/two worktrees, dirty matrices and stale-description
reacquisition. Owned cleanup verified PTY exit promises and natural Electron exit
(Source Control 2, checkout 4, measurement 2 PTYs), without changing production close
guard or touching user workspaces. No live SSH host was contacted: no authorized
disposable fixture was supplied. SSH transport/identity simulation remains unit coverage,
not a claim of live verification. Representative large/dirty repo and allocation/paint
profiling remain unverified.

Final `npm run validate` passed branding, lint, typecheck, Fallow (no baseline edits),
security audit (documented dev-only exception), build and **7,778 tests / 396 files**.

```sh
npm run build
node scripts/source-control-management-smoke.cjs
CLANKER_SOURCE_PROBE_ONLY=1 node scripts/source-control-management-smoke.cjs
node scripts/checkout-presentation-smoke.cjs
node scripts/workspace-switch-measure.cjs
node scripts/workspace-page-browser-renderer-smoke.cjs
node scripts/workspace-launch-race-smoke.cjs
npm run validate
```

Evidence: `/tmp/176-stage4-source-{before,baseline-final,final}.log`,
`/tmp/176-stage4-probe-before-final.log`, `/tmp/176-stage4-switch-{before,final}.json`,
`/tmp/176-stage4-{checkout,browser,launch}-final.log`, `/tmp/176-stage4-validate.log`.
Counters/gates exist only in disposable fixture scripts; production gains no telemetry,
coordinator, residency expansion, startup redesign or Stage 5 work.
