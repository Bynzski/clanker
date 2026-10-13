# #176 Stage 7A — startup restoration decision gate

Accepted baseline: `8c9b5dbb519229df84f76ceeb4696e455fb79761` (Stages 1–6).
**Investigation only. No production restoration, authorization, resource-owner, residency,
session discovery or close-guard code changed.**

## Decision: INCONCLUSIVE for progressive restoration; retain Option A now

Local shell preparation scales modestly in this fixture: median publication 57/77/85 ms
for 1/4/8 workspaces; usable-frame proxy 319/316/328 ms. This does **not** justify progressive
publication complexity for local startup. Controlled slow-workspace cases establish a
real blocking mechanism: an unrelated 1,500 ms delay postpones publication even when the
remembered active workspace registered in 6 ms. Option B alone cannot solve that under
atomic publication. Option C could avoid that wait, but its real-world benefit/prevalence
is not established by injected latency.

No implementation is recommended/authorized now. Missing evidence: representative packaged
cold-process starts, real slow/unavailable authorized SSH connections and their frequency,
large repositories/session profiles, and user task/compositor readiness rather than dev
frame proxies. The native fixture below measures **cold renderer restoration in a fresh
owned Electron process**, after an empty harness setup navigation; it is not an OS/process
launch-to-window benchmark. Those limitations prevent a global GO or a categorical claim
that slow remote startup is harmless.

Independent review may accept this as a deferred, explicitly unproven startup optimization
and proceed to cross-stage acceptance of #176; do not equate that with closing the issue or
proving overall switching speedup. This is an INCONCLUSIVE gate, not an automatic NO-GO
waiver of remote startup acceptance. No Option B/C code should follow without new evidence
and explicit approval.

## Source audit: actual sequence and critical path

Reviewed the full revised issue and Stage 1–6 evidence, `App`, `workspaceStartup`,
`openWorkspace`, `openWorkspaceStorage`, `workspacePageStorage`, store hydration/activation/
sanitizer helpers, `WorkspaceHost`, `workspaceWarmth`, diagnostics, local/SSH environment
validation, `WorkspaceRegistry`, Git registration/inventory IPC, main window boot and
restoration/persistence/cancellation tests.

1. Main creates the window. `windowManager` shows it after the static boot splash's
   ready-to-show, with renderer ready IPC as fallback. Window availability does not imply a
   registered workspace. Renderer bootstrap loads React/App/settings and independent app
   services. No complete workspace runtime is deserialized here.
2. App's mount effect calls `startWorkspaceRestoration`; development StrictMode immediately
   disposes its first invocation and starts a second. `readOpenWorkspaceState` synchronously
   parses versioned localStorage: ordered environment/path identities and remembered active
   identity only. Invalid records are reported; duplicate normalized textual identities are
   eliminated. This parser does not establish filesystem authority.
3. One mount owns a sequential loop and a persistence fence. For each saved identity,
   restoration checks live + already prepared shells before allocating a random runtime ID.
4. `prepareWorkspaceShell` sends REGISTER_OPEN_WORKSPACE. Main checks remote recovery state,
   resolves the environment, records pending ownership, checks removal reservations, validates
   the actual directory, rechecks cancellation/removal, stores a RegisteredWorkspace and
   creates its main CheckoutContext. Local IPC also registers the validated root in GitService.
5. Canonical identity is returned by main; renderer checks environment/path and derived main
   context identity. **Qualification:** local `resolveExistingDirectory` uses `path.resolve`
   plus stat, not realpath. SSH validation runs `test -d … && cd … && pwd -P`. Do not assume
   both have identical symlink canonicalization behavior (native observation below).
6. Local generated `*-worktrees` containers are checked/refused through the existing owner
   lookup. Other ordinary fixture roots skip that special lookup. All shells then await
   scoped `gitListWorktrees`, describing whether the selected root is linked, its branch and
   project relationship. Non-Git/failing lookup is allowed and yields no metadata.
7. SSH shells additionally await real `sshEnvironmentList` IPC (desktop saved config, **not
   an SSH round trip**); missing/failed label lookup falls back to environment ID.
8. Construct an empty parked shell: no terminal, panes, editor tabs, Browser pane or layout;
   Explorer hidden. Read bounded V1/V2 page preferences synchronously. They restore page IDs/
   topology only against already-present resources; terminal slots never create/rebind future
   chats, absent utilities/Browsers are not resurrected, live resources cannot be overwritten.
9. Recheck canonical duplicates against the current live/prepared collection; keep the live
   object, unregister an extra prepared registration. Track remembered active identity using
   its saved identity, even if main returned a canonical alias. Track closures and intervening
   user selection while the loop continues; failed shells are omitted and later warned.
10. After the whole loop, filter user-closed roots, choose remembered survivor or first
    survivor unless a user selection superseded it, then hydrate once, with no intervening
    await. Zustand merges live manual opens, normalizes new shells at ingestion, maps a
    selected duplicate ID to the live object and assigns exactly one active lifecycle.
11. Only then lift the persistence fence and serialize the complete surviving ordered list,
    remembered active identity and page preferences. Existing behavior intentionally removes
    failed saved identities after this completed attempt, with a warning; retry is a new
    explicit open, not a retained automatic startup retry slot.
12. React mounts the active Workspace surface and at most two parked warm surfaces, with
    lazy layout/Explorer chunks. Remaining section wrappers are cold. Empty restored shells
    create no terminal/editor/Browser runtime instances. Existing pending-terminal bootstrap
    exception is irrelevant to these empty startup shells.
13. Existing Header Git controller starts the one active main poller, local Explorer lifecycle
    aligns its watcher, remote target synchronization remains separately owned. Hidden Explorer
    does not list directories; no editor files exist to read. SSH snapshot owner only monitors
    relevant registered active targets. Reconciliation skips without worktree contexts. Local
    optional history warmup is still delayed three seconds, not a readiness prerequisite.
14. The active DOM shell becomes usable independently of Git/Explorer freshness. The `done`
    promise includes cleanup of prepared but unpublished shells. Dispose prevents publication/
    persistence and unsubscribes, but does not pretend that an outstanding host call ended;
    its late registration/preparation must complete and be unregistered.

**Critical path:** sequential awaited shell preparation → atomic store publication → React/
lazy layout readiness. Registration authority is essential. Git-linked classification is
currently awaited descriptive information (useful for correct labels/linked checkout
presentation), not permission to access a sibling. Environment label is optional local
metadata. Neither optional item should be silently treated as root authority in a future
optimization. Starting registration earlier is not making a workspace visible earlier.

## Method, repetitions and limitations

`npm run build && npm run diagnose:workspace-startup` runs the accepted production path with
fixture-only timing wrappers. Eight tiny committed Git repositories, owned temporary HOME/
profiles, no terminal/harness/inference/external-service launches. Each sample uses a fresh
native Electron/headless process; after empty harness setup, a cold renderer navigation seeds
version-1 saved identities before App executes. Real App/StrictMode/renderer/preload/IPC/main
registry/Git/persistence run, with the same source and sequential/atomic behavior.

A Playwright route annotates the served development startup module's existing boundaries,
without editing production files, adding awaits, changing branch decisions or calling a
replacement restoration algorithm. It asserts the expected source markers to avoid silently
missing an instrumentation boundary. The first StrictMode attempt's cancellation remains real.
Main wrappers time real registration, environment validation, Git inventory/commands, label
handler and unregister calls. SSH-like roots use a real registered SshEnvironment whose
executor runs the actual sh/Git/Python commands only against owned local paths. No successful
registration/discovery/list is fabricated; no host is contacted. A genuinely absent directory
supplies the unavailable case. Saved-label handler/response remain real (fallback ID is valid).

Three repetitions of every scenario, reversed scenario order on the middle pass; active-first
and active-last orders explicitly varied. 12 scenarios / 36 timing samples, plus one native
cancellation sample. This is small-sample medians/ranges, not p95s or a population study. Hot
OS Git/filesystem caches, dev compilation/effect replay/logging and route-disabled browser
cache are limitations. Empty harness navigation precedes the measured cold renderer startup;
initial settings/CLI probes may carry into it. Initial setup registrations are zero. Rejected
probe runs (failed load gating/source-marker/teardown setup and symlink expectation) are not
measurements and are excluded.

Time zero = first actual restoration invocation, including its cancelled StrictMode attempt.
Main and renderer timestamps align via performance.timeOrigin + performance.now; sub-ms
cross-clock differences should not be overinterpreted. Root App commits/IPC starts reuse
Stage 1 diagnostics. Main trace contains fixed operation labels, fixture ordinals, timings/
booleans only; no paths, credentials, request arguments, session contents or responses. Bounds:
512 main records/sample, existing 512 renderer events, 1–10 repetitions, native subprocess
5-second timeouts, owned cleanup deadlines. Raw export is explicit; no production telemetry.

Milestones:
- **First registration:** earliest successful main registration, including an ultimately
  unpublished StrictMode registration. First prepared shell is later, after metadata.
- **Active registration:** earliest successful registration of remembered surviving physical
  target. Aliases map to the first canonical survivor; unavailable saved target would use
  fallback (here the remembered active is the valid local survivor).
- **Publication:** one synchronous transition exposing the validated eligible collection;
  NOT proof of DOM/task readiness. Native publisher observers deduplicate this one transition.
- **Active React commit:** first root App Profiler commitTime after publication; may initially
  contain Suspense fallback, so NOT first usable layout.
- **Frame:** two consecutive rAF checks for visible, non-inert, positive-sized active surface
  containing actual dynamic layout, matching Stage 1's checks. Startup has no selectWorkspace
  switch trace, so fixture observes this without invoking production selection. Proxy only,
  not GPU/compositor presentation or terminal prompt readiness.
- **All done:** last restoration done callback, including cancelled-attempt cleanup; observer
  settlement can be delayed by synchronous React/effects. Shell publication precedes this.
- **Git current:** first current toolbar DOM diagnostic, independent of usable layout.

The native app window is already available before the measured navigation; an empty App
shell can render while waiting, and after publication lazy layout may show Loading workspace
layout. No process-launch/window-ready latency is claimed. A cold **packaged first navigation**
with persisted profile is still needed before extrapolating these numbers to full startup.

## Scenario timings

Milliseconds from restoration beginning, **median (min–max)**, n=3. Tables deliberately
separate publication, mounting, usable frame, resource freshness and completed restoration.

| Scenario | First registration | Active registration | Publication | Active React commit | Usable frame proxy | All done | Git current |
|---|---:|---:|---:|---:|---:|---:|---:|
| One local | 4.7 (4.7–5.4) | 4.7 (4.7–5.4) | 57.1 (56.2–58.7) | 74.5 (74.1–77.8) | 318.6 (313.5–324.1) | 85.1 (83.6–98.3) | 114.5 (113.8–118.1) |
| Four local, active last | 4.9 (4.7–5.4) | 70.6 (69.2–71.5) | 76.6 (74.6–76.9) | 95.7 (94.2–95.8) | 316.3 (314.4–321.1) | 104.6 (102.7–105.6) | 131.7 (129.0–134.7) |
| Eight local, active last | 4.7 (4.1–5.2) | 78.4 (77.9–82.2) | 84.9 (83.7–87.1) | 105.9 (104.7–108.2) | 328.4 (317.0–329.0) | 116.3 (113.6–118.3) | 144.1 (139.7–144.9) |
| Slow Git first, active last (four local) | 5.1 (4.6–8.9) | 1556.3 (1552.2–1556.7) | 1560.5 (1556.5–1560.7) | 1584.3 (1577.2–1584.9) | 1906.2 (1897.2–1916.7) | 1600.6 (1590.4–1601.8) | 1627.2 (1612.1–1629.4) |
| Active first, slow Git last (four local) | 5.7 (5.2–6.5) | 5.7 (5.2–6.5) | 1572.0 (1568.7–1583.9) | 1591.7 (1588.8–1609.4) | 1917.0 (1915.7–1939.2) | 1607.3 (1602.6–1625.8) | 1629.8 (1625.9–1650.3) |
| Slow SSH-like validation + local active | 1513.2 (1509.3–1513.6) | 1520.8 (1516.2–1521.5) | 1525.3 (1521.0–1526.3) | 1547.8 (1542.6–1547.9) | 1869.6 (1866.5–1880.1) | 1558.5 (1551.5–1558.7) | 1582.5 (1577.6–1583.9) |
| Slow SSH-like Git + local active | 14.9 (12.3–16.8) | 1546.9 (1544.0–1553.8) | 1551.5 (1548.0–1560.4) | 1573.5 (1569.9–1583.1) | 1901.6 (1889.5–1910.4) | 1584.6 (1580.8–1594.0) | 1611.2 (1607.2–1616.7) |
| Slow desktop SSH label handler + local active | 14.5 (12.5–15.5) | 1554.3 (1553.9–1557.4) | 1562.2 (1559.3–1566.7) | 1584.7 (1581.6–1590.6) | 1913.7 (1913.6–1917.5) | 1595.7 (1593.2–1601.9) | 1621.9 (1618.9–1625.4) |
| Missing SSH-like root after slow validation + local active | 1511.9 (1510.3–1517.1) | 1511.9 (1510.3–1517.1) | 1517.3 (1517.0–1524.4) | 1540.6 (1535.3–1547.5) | 1867.5 (1858.3–1872.5) | 1551.9 (1544.2–1558.9) | 1575.8 (1565.2–1582.3) |
| Mixed local/SSH-like/local/SSH-like, no delay | 4.6 (4.5–4.7) | 63.5 (60.2–64.5) | 77.5 (75.1–79.5) | 95.7 (93.2–97.8) | 321.5 (315.0–327.3) | 104.9 (102.2–106.7) | 134.2 (129.3–136.8) |
| Textual duplicate + canonical lexical alias + same-text SSH | 5.1 (5.0–6.8) | 5.1 (5.0–6.8) | 74.3 (71.2–89.8) | 91.4 (88.9–108.5) | 322.3 (316.0–325.7) | 100.0 (97.3–117.7) | 125.4 (123.5–145.6) |
| Local real path + symlink (existing behavior) | 4.4 (4.2–4.8) | 55.7 (50.3–58.8) | 63.3 (56.4–67.1) | 81.9 (75.8–85.8) | 320.2 (318.3–321.6) | 91.4 (84.9–94.2) | 115.2 (109.9–118.4) |

Slow tests insert 1,500 ms **before** the real operation. They demonstrate sensitivity,
not real remote latency. Label delay is particularly artificial: current saved config lookup
is desktop-local and normally immediate, so no claim that it dominates actual SSH startup.

## Requests, physical work and breakdown

Counts from restore through current Git + 250 ms settling; one current poller, not one per
saved workspace. Same counts across repetitions unless ranges shown. Register/worktree counts
match real preload invoke counters and main entries. Git commands are actual `execGit` dispatches
(one command per worktree inventory/status here), not IPC events; SSH commands are the fixture
executor's physical sh/Git calls, with failures counted. Peak SSH includes StrictMode overlap.

| Scenario | Published shells | Registration IPC | Worktree IPC/read | Backend Git commands | SSH-like commands / peak | Label IPC | Unregister cleanup | App commits |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Local 1 | 1 | 2 | 2 | 4 | 0 / 0 | 0 | 1 | 12–13 |
| Local 4 | 4 | 5 | 5 | 7 | 0 / 0 | 0 | 1 | 12 |
| Local 8 | 8 | 9 | 9 | 11 | 0 / 0 | 0 | 1 | 12 |
| Slow first / active first | 4 | 5 | 5 | 7 | 0 / 0 | 0 | 1 | 11–13 / 12 |
| Slow SSH-like validation/Git/labels | 2 | 3 | 3 | 5 | 4 / 2 | 2 | 1 | 11–13 |
| Unavailable SSH-like | 1 | 3 | 1 | 3 | 2 / 1–2 | 0 | 0 | 12 |
| Mixed | 4 | 5 | 5 | 7 | 4 / 1 | 2 | 1 | 12 |
| Aliases | 2 | 4 | 4 | 6 | 2 / 1 | 1 | 2 | 10–11 |
| Local symlink | 2 | 3 | 3 | 5 | 0 / 0 | 0 | 1 | 10–11 |

Each ordinary scenario has two actual active status acquisitions (StrictMode start/stop replay),
not background status acquisition for all restored shells. The extra registration/inventory
above N comes from the first disposed StrictMode attempt, which completes metadata then cleans
its registration. No new deduplication is suggested here. The unavailable case emits one
warning after the valid local shell survives; failed registration leaves no registered root
and needs no explicit unregister. All other scenarios have zero discovery warnings. Alias
cleanup includes one duplicate and one disposed attempt. Teardown is separately verified.

Main method occupied-time union before publication, median ms (overlap counted once per
category; **do not sum nested categories**):

| Scenario | Registration (includes canonical) | Canonical validation | Worktree acquisition (includes Git/delay) | Labels | Store call | Publication→frame | Publication→current Git |
|---|---:|---:|---:|---:|---:|---:|---:|
| Local 1 | 0.4 | 0.1 | 7.4 | 0 | 0.8 | 259.9 | 57.6 |
| Local 4 | 0.7 | 0.3 | 17.5 | 0 | 1.4 | 241.7 | 54.8 |
| Local 8 | 0.9 | 0.3 | 30.9 | 0 | 1.1 | 241.3 | 57.8 |
| Slow first Git | 0.6 | 0.2 | 1513.4 | 0 | 1.3 | 345.5 | 66.7 |
| Active first, slow last Git | 0.7 | 0.3 | 1519.3 | 0 | 1.9 | 347.0 | 57.8 |
| Slow SSH validation | 1508.2 | 1507.9 | 7.5 | 0.1 | 1.2 | 345.5 | 57.2 |
| Slow SSH Git | 9.1 | 8.9 | 1509.6 | 0.1 | 1.3 | 350.0 | 59.2 |
| Slow label | 10.5 | 10.2 | 11.9 | 1501.0 | 1.8 | 354.3 | 59.6 |
| Unavailable SSH | 1506.4 | 1506.1 | 2.7 | 0 | 1.8 | 348.1 | 57.9 |
| Mixed | 9.2 | 8.7 | 16.1 | 0.2 | 1.0 | 242.0 | 57.3 |

Representative four-local trace: registration 0 completes at 4.7 ms, its second StrictMode
registration at 7.5 ms; inventory starts at 44.5/47.4 and completes at 50.4/50.9; first prepared
shells return around 58.8/59.1; disposed registration cleaned at 59.2. Later registration/
inventory pairs complete near 65.1, 69.7 and 74.7; publication 76.6, App commit 95.7,
all-done callback 105.6, current Git 131.7, usable layout frame 314.4. This explains why
main registration wall time alone does not account for the whole renderer preparation interval.
IPC delivery/renderer bootstrap and effect scheduling remain residual, not attributed to
canonicalization or Git CPU without additional profiling. Post-publication lazy module/
React/layout delivery dominates the ordinary frame interval; this dev fixture does not isolate
production chunk loading, render CPU and frame scheduling enough to nominate a new optimization.

All shells are available in Zustand before the usable frame in every sample. Increasing 1→8
adds ~28 ms median preparation/publication, not a demonstrated material first-usable regression.
Injected delay dominates preparation but still has another ~345 ms post-publication dev frame
interval. Progressive publication would not automatically remove that later interval.

## Answers and alternatives

1. **Unrelated work delays active presentation:** yes under a slow awaited stage. Active-first
   registration at 5.7 ms still waits until 1,572 ms publication; same atomic barrier applies
   to unavailable remote roots and optional metadata.
2. **Sequential registration itself meaningful?** Main local registration <1 ms aggregate;
   no. Whole sequential preparation includes IPC/Git and has measurable cumulative cost.
3. **Dominant stage?** Ordinary local: inventory plus renderer/IPC residual, with post-publish
   layout proxy later still. Injected cases: precisely the delayed stage. Real SSH dominance
   unmeasured; label normally local, not a network bottleneck.
4. **Slowest determines all startup?** It gates publication; multiple serial slow roots would
   sum, not merely take the maximum. It does not block the static window or manual open UI.
5. **How often unavailable SSH blocks locals?** All three injected unavailable runs did so;
   actual user frequency/timeouts unknown. Failures are isolated in outcome, not latency.
6. **Active-first reorder alone?** No, under current atomic commit. Better registration timing
   without presentation is not a UX gain. No new reorder was implemented to manufacture one.
7. **Progressive publication necessary?** To expose a prepared shell before an unrelated
   in-flight registration completes, yes; not necessary for this small local scaling cost.
   Deferring optional classification/labels is another narrower avenue to investigate only
   if real slow metadata is measured; it cannot bypass directory validation or silently
   mislabel/adopt a linked root. Not an implementation proposal/authorization here.
8. **6–8 workspaces worse?** Eight has more physical inventory, 85 vs 57 ms publication;
   frame ranges largely overlap. No significant overall speedup target inferred.
9. **Concurrency risky?** Exact pending registration/removal ownership, canonical duplicate
   reconciliation, interactive opens, persisted complete list and disposal all rely on current
   order/lifetime assumptions; parallel preparations increase live authority/cleanup races.
10. **Prolonged blank?** Not an entirely blank window: static splash/empty shell/navigation
    can appear. Slow cases do prolong absence of restored project content to ~1.9 s in the
    injected workload. Ordinary layout proxy arrives after all shells, so progressive shells
    are not the main measured ordinary dev readiness interval.

| Option | Expected benefit from evidence | Risks / recommendation |
|---|---|---|
| A: sequential + atomic | Preserves current fast local publication, complete persistence and deterministic ownership; no new performance benefit claimed | Remote slow-stage coupling remains. Retain now pending representative evidence |
| B: prepare active first, atomic | Earlier authority registration only; **no credible first-presentation gain** while waiting for remaining shells | Reorder/saved-active alias semantics must remain stable, extra complexity without measured UX benefit. Do not implement |
| C: early active publication + bounded remaining prep | Could remove roughly the injected 1.5 s unrelated wait if active itself is quick; this is a conditional opportunity, **not measured implementation improvement**. Ordinary removable tail at most tens of ms in this fixture | Requires new lifetime/persistence protocol; marginal local benefit unproven and remote prevalence missing. Do not implement without a GO follow-up |

No numeric target was selected in advance; no Option B/C prototype or workers were built.
With a future GO, the credible design would remain restoration-local, not a global task
scheduler: keep an ordered saved-identity ledger and generation, prepare/validate active shell,
merge it without stealing newer user selection, then limit remaining preparations (possibly
one to avoid starting with concurrency changes). Unknown/failed/unpublished slots must remain
in the persistence ledger until deliberate final reconciliation; real registrations remain
owned until publication or verified unregister. This describes safeguards to evaluate, **not
approved implementation scope**. The number of mounted surfaces/resources stays separate.

## Risk and test map

| Invariant | Already covered | Additional requirement if progressive behavior is approved |
|---|---|---|
| Main roots/context validation | WorkspaceRegistry/main IPC tests: environment validation, pending cancellation, local/remote removal reservations/rechecks, derived main context; renderer invalid context/environment refusal | No prepared shell published before authority; cancellation at every await; equivalent-host/removal overlap while concurrent slots complete |
| Duplicate/alias/environment identity | workspaceShells: normalized dedup, canonical duplicate cleanup, active alias mapping, live duplicate runtime mapping; native lexical alias + identical local/SSH text | Canonical alias races resolving in either order, interactive open versus concurrent prep, idempotent cleanup, branch/context lifetime; no path-only cross-environment reuse |
| Local symlinks | Native fixture observes two shells for real path + symlink; source confirms local lexical validation | Decide separately whether physical dedup is desired. Do not silently change registration rules as a startup optimization. This pre-existing discrepancy is documented, not fixed |
| Selection/closure | Tests: manual opens win selection, same-root manual open merges, closed roots do not resurrect; Assistant navigation independent | Late slot cannot steal focus, manual selection before active prep returns, active fails while user selects survivor, close a progressively published shell then late alias completion |
| Disposal/authority cleanup | Tests: no hydration/persistence on dispose, prepared and canonical extras unregister; native slow cancelled registration finishes and cleans | Unmount/shutdown during every pending phase, cleanup failure/retry, unknown SSH result, retain real ownership until settled; no false cancellation releasing a live host permit |
| Failure/retry | Tests: bad/missing mixed identities omitted independently, first survivor fallback, bounded warning, explicit open failure not persisted | Per-slot progress/failed state truthful, retry cannot overlap old registration or resurrect closed identity; keep intentional failure-persistence policy explicit |
| Persistence/order/active identity | Tests: never truncate saved set while later shell pending, one collection transition, continuous reorder/select/close, storage exceptions; real App remount | Fence every partial publication, persist complete ledger including pending slots through crash/close/restart, ordered canonical dedup with out-of-order completions; page preference writes must not drop parked slots |
| Pages and runtime independence | V1/V2 page/storage/layout tests; no terminals/Browsers/editor instances created; native empty-runtimes assertion | User creates pages/dirty buffers/new terminal while remaining shells prepare; later shell ingestion must preserve live state/resources, not apply preferences over new runtime |
| Residency/resources | Host/warmth/activation/store tests; native ≤3 warm surfaces, one active status controller; Stage 1–6 owner tests | Early active shell plus changing list cannot evict/bootstrap unnecessarily, restart watchers on same checkout, poll parked shells, orphan Browser lease/PTYS or discard dirty buffers; reconciliation retains required follow-up |

Native cancellation uses **the real returned dispose API** for both StrictMode invocations
while a 1,500 ms SSH-like validation is outstanding: zero publication, saved two identities
unchanged, two registrations and inventories finish, both unregister, main registry empty,
no runtime instances, ordinary Electron close verified. It takes about 1,522 ms to drain in
this sample; dispose is not instant host cancellation. Existing main pending-unregister
cancellation and process shutdown are tested separately; no live SSH disconnect/shutdown
unknown-outcome claim is made. Closing/crashing midway through partial publication would
require new tests because today's atomic model never exposes that partial collection.

## Verification, evidence and final objectives

Relevant restoration/open/persistence/page/layout/residency/activation/close/store/main-registry
regressions: **212 tests / 10 files passed**. Existing workspace-switch native measurement
passed all five whole-workspace and three checkout transitions with verified owned PTY/
Electron teardown; counts remain five invokes/two status acquisitions per selection. Startup
native scenarios all pass identity/active selection/empty-runtimes/warm-cap checks; canonical
alias yields two shells (one local + one SSH), symlink yields two local shells. No arbitrary
SSH connection or user workspace touched. Each sample has a distinct cleanup owner; the Vite
owner is separate so sample teardown cannot kill shared fixture infrastructure. Cleanup uses
accepted Stage 1 real exit/ordinary close logic; failures keep the fixture rather than deleting
unverified resources. No close prompt auto-approval.

Final `npm run validate` passed branding, lint, typecheck, Fallow (no baseline/exemption edits),
security (existing documented dev-only exception), build and **7,824 tests / 400 files**.
The final hardened diagnostic rerun also passed all 12 scenarios plus cancellation with
verified ordinary Electron exits. No production instrumentation was needed: existing
commits/IPC stream plus fixture-only startup/main boundary wrappers provide the milestones.

Reproduce (port 1420 free):

```sh
npm run build
npm run diagnose:workspace-startup > /tmp/startup-assessment.json
# Default three repetitions; CLANKER_STARTUP_REPETITIONS=1–10 is bounded.
node scripts/workspace-switch-measure.cjs > /tmp/switch-assessment.json
npm run test -- tests/renderer/unit/workspaceShells.test.ts tests/renderer/integration/appWorkspaceOpen.real.test.tsx tests/renderer/unit/workspacePageStorage.test.ts tests/renderer/unit/workspaceLayoutStorage.test.ts tests/renderer/unit/workspaceWarmth.test.ts tests/renderer/unit/WorkspaceHost.test.tsx tests/renderer/unit/workspaceActivation.test.ts tests/renderer/unit/workspaceClose.test.ts tests/renderer/integration/workspaceStore.test.ts tests/main/unit/workspaceRegistry.test.ts
npm run validate
```

Evidence: `/tmp/176-stage7-startup.json` + `.err`, `/tmp/176-stage7-switch.json` + `.err`,
`/tmp/176-stage7-tests.log`, `/tmp/176-stage7-validate.log`,
`/tmp/176-stage7-startup-final-contract.json` + `.err`. Tables use the successful three-pass
baseline, not rejected setup probes. Narrow script hardening/cleanup/assertion rerun is
recorded separately so timing variability is not selectively substituted.

Issue #176's demonstrated gains remain truthful refresh ownership, fewer duplicate backend
reads, retained clearly stale descriptions, independently usable Source Control sections,
bounded Explorer SSH fan-out and forced-fresh session discovery. Neither prior stages nor
this assessment establish a significant general workspace-switching speedup. Progressive
startup is a separate latency/risk decision, not an architecture needed to complete a checklist.
**Stop after this assessment; retain current production startup and await independent review.**
