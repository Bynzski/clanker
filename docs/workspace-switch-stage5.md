# #176 Stage 5 — retained Explorer listings and bounded SSH reads

Base: accepted Stage 4/P2 `288229519ffdd32178648e1143272b4d1aed0a9d`.
Same branch/worktree; no Stage 6/7, merge, residency or startup changes.

## Audit and baseline

Read issue #176, Stage 1–4 documents, Explorer/index/tree/action handlers, workspace
store/snapshot helpers, checkout selection/epochs, local lifecycle coordinator,
renderer/main remote watcher, file IPC and SSH environment implementation before
production changes. All listing callers still enter the existing file-list IPC.

| Trigger | Existing owner / path |
|---|---|
| First load | Visible Explorer missing-root effect |
| Checkout change / reopening | Explorer identity/visibility effects |
| Manual Refresh | Root plus all expanded directories, immediately in a loop |
| SSH focus | Same refresh path; separate clean-editor reloads |
| Local tree event | Existing 100 ms per-directory debounce |
| SSH snapshot | Changed directories through same debounce; unchanged paths retry only when an error exists |
| Create / rename / delete | Existing successful-main action handlers refresh parent; rename/delete intentionally clear obsolete subtrees |

Read-start directory generation and synchronous selection epoch already reject late
answers, but failed listings overwrite entries with `[]`. Root errors replace the
whole tree; nested loading/errors replace children. Repeated focus/manual loops have
no global physical-IPC limit. Watcher debounce waits while loading, then rereads;
that waiting policy can add redundant work rather than safely express a successor.

Before production edits, the new disposable Electron fixture measured a real SSH-like
file IPC workload: root plus eight expanded folders, one Refresh plus five focus
notifications, gated real listing commands, then one failed root read. Initial probe
observed 54 overlapping listings and root failure removed all visible names. Final
paired baseline below repeats the accepted commit with the corrected identical runner
in a temporary `git archive` (no additional Git worktree/branch or registration).

## Data, acquisition and ownership

Directory entries remain workspace-owned, keyed by absolute POSIX paths; no separate
cache, persistence or Git-cache coupling. Presence of a map key (including `[]`)
means there is historical data; absence means no successful listing is known.
`explorerVerifiedByPath` records the accepted selection epoch. Loading clears that
proof but not entries/errors. Successful acquisition atomically replaces entries,
clears its error/loading and records the current epoch. Failed/throwing reads retain
entries (including a previously verified empty listing), store an actual error and
settle loading. Errors remain visible during retry until success or deliberate reset.
Ingestion clears verification proof; ordinary activation retains maps/references,
with a new selection epoch making older proof historical. Missing/released contexts
still purge their tree caches through the existing checkout retirement helper.

Derived states: never requested; cold loading; refreshing history; current success
(including authoritative empty); failed cold; failed history. These are derived from
existing loading/error collections plus the small verification map, not a generic
resource framework. A failed cold read does not create an empty entry key or start
an automatic retry loop. Every new visible selection/reopening explicitly reacquires
root and expanded folders, including cached roots. StrictMode cleanup/replay is safe.

Tree keys remain absolute entry paths; no tree remount was added. Compact directory-
local notices keep root and nested rows visible: `Last known · Refreshing…`, or last
known plus the actual error and Retry. Cold reads retain loading/error placeholders.
Historical empty lists say `No entries in previous listing`, not current `No files`.
Successful empty lists show the ordinary empty state. Filter/hidden state, expansion,
selection and keyboard traversal continue over the visible historical names; the tree
container stays mounted. Styles use existing theme tokens (dark/light/Slate).

## Explorer-only request policy

`ExplorerDirectoryScheduler`, instantiated once by the directory-loader module, is
limited to **three physical SSH listing IPCs across all Explorer controllers/hosts**.
A component-local bound would lose permits on switching/remount. Local listing IPCs
are not throttled by the SSH cap. No filesystem mutation, editor read, Git read or
remote metadata snapshot is added to this scheduler. The value three is deliberately
modest: the paired fixture proves useful independent folder progress with peak three,
versus 54 before. This is a safety choice, not a live-network throughput optimum.

Keys: workspace ID + environment ID + checkout context + canonical selected root +
synchronous selection epoch + directory. Root and explicit navigation are priority 0;
expanded-folder/watch background refresh is priority 1. FIFO ties retain fairness;
an explicit expansion can overtake queued background work, never the already-running
IPC. Priorities are promoted when equivalent queued demand arrives.

Equivalent safe requests share one promise. A forced request overlapping running work
supersedes its presentation and queues **one successor**; repeated force/focus/watch
requests share that successor, rather than inheriting possibly older running data.
Already queued work has not started its acquisition and can safely absorb more demand.
There is no per-event backlog: at most one running and one queued job per directory,
with pending size bounded by actual distinct requested directories. We do not truncate
user-expanded folders to the remote snapshot poller's separate target limit.

Retirement removes queued work immediately and settles it as retired; active requests
lose publication eligibility and their loading ownership, but retain physical permits
until their underlying promise actually settles. Root/environment/registration-derived
selection, active workspace, visibility, mounted lifetime and epoch are checked before
dispatch and again before publication. Synchronous store/attention subscriptions prune
invalid queued work even before React cleanup, so A→B→A cannot revive old callbacks.
An old completion cannot clear another owner's loading marker. Rejection/throw paths
settle permits and continue draining other directories. Nothing cancels an IPC by
pretending its underlying command stopped.

## Watchers, mutations and authority

One local Explorer watcher, same-checkout no-ops, the existing main-owned batched SSH
snapshot poller, its limits/backoff/cancellation, dirty-editor protections and checkout
reconciliation with queued follow-up remain unchanged. The existing 100 ms directory
debounce remains. Instead of rescheduling timers while a read is active, its callback
requests one forced successor through the same scheduler. Changed snapshot demand may
require that successor; unchanged-path retry remains conditional on the stored error.
Focus/manual events and watcher demand can share an already queued successor safely.
Editor focus reloads remain separate; their concurrency is a Stage 6 question.

`explorerRevisionByPath` tracks deliberate post-main mutation/subtree writes, not
listing refreshes. A read captures directory and ancestor revisions at dispatch and
cannot publish after a confirmed rename/delete changed them. Thus an older listing
cannot resurrect a removed/renamed entry or repopulate a deliberately cleared subtree.
Parent post-mutation demand is forced. Confirmed optimistic parent updates survive a
failed follow-up. Accepted lists do not invalidate unrelated concurrent child reads.
Transient menus/create/rename/delete controls reset before a new selection commits;
a captured action additionally checks the live selection before/after async boundaries.
If retirement occurs during pre-operation editor unwatch, the existing rewatch path is
restored. Styled destructive confirmation and main file-operation guards are retained.

**History grants no authority.** Names/type hints support navigation, not existence or
permissions. Open/Enter still use current store-backed editor scope and main read IPC;
create/rename/delete retain workspace/context/root requests and current scope guards.
Main resolves only registered owning contexts, validates containment and actual host
filesystem state/permissions; no main authorization code was changed. Missing,
unregistered, unauthorized and historical-disagreement selections show existing recovery
guidance, not historical-tree access or silent fallback. Main refuses a retired-context
rename and out-of-root listing in the real fixture. No drag/drop path was introduced.

## Paired measurements

Linux 7.2.9-2-cachyos, Node 26.11.1/npm 12.2.0, Electron 41.10.7, React 19.2.4.
Headless native Electron + development Vite/StrictMode, disposable profile/HOME and
local fixture directories. The **real renderer → preload → file IPC → registered
SshEnvironment → Python filesystem scripts** run, with only the executor transported
to owned local subprocesses. No target is contacted, no successful listing is fabricated.
The existing snapshot poller also executes its real bounded script through that fixture
executor. A bounded eight-second listing gate and one owned command rejection inject
latency/failure. All gates release in `finally`. Counts are environment listing method
starts/occupancy, not snapshot subprocesses or all SSH work.

Same workload: root + eight expanded folders (17 visible names with hidden files off),
manual Refresh plus five focus events while first reads are held, release, failure,
retry, then held A→B→A and main authorization checks.

| Metric | Accepted Stage 4 | Stage 5 |
|---|---:|---:|
| Controlled listing starts | 54 | 12 |
| Peak physical listing overlap | 54 | 3 |
| Coalesced demands | 0 | 42 |
| Queued forced successors | 0 | 3 |
| Visible names immediately after Refresh | 9 at 38 ms | 17 at 62 ms |
| Visible names while held | 9 at 212 ms | 17 at 240 ms |
| Current root observed | 473 ms | 447 ms |
| Entire requested set settled/current | 475 ms | 449 ms |
| Visible names after root failure | 0 | 17, visibly last-known |

The remaining 12 are three already-running reads plus nine current acquisitions:
queued directories absorb repeated demand; the three active directories each need a
successor. Unit integration asserts all nine directories receive new proof, not just
that peak stays low. Observation times include Playwright/IPC overhead and 40 ms polling,
not compositor presentation. Useful names are already present before requesting refresh;
we claim **continuous visibility**, not a measured faster first paint. Current root
and drain times vary across runs and do not establish a general speedup. Intermediate
probe marks that did not await async predicates were discarded; the final runner awaits
explicit evaluated booleans and verifies scheduler/physical drain and all-directory proof.

Existing warm workspace-switch runner (Explorer collapsed) retains 5 invokes and
3/4/3/3/3 App commits in both versions. Frames, before → after, ms:
cold 35.6/33.9 → 43.6/43.2; warm 30.5/31.5/30.6 → 31.7/31.3/47.9.
No switching latency or CPU/GC/production/compositor speedup is claimed from these
small samples. Three-surface residency, terminal/cache and Browser ownership are unchanged.

## Verification, reproduction and limitations

Targeted Explorer/filter/keyboard/action/watcher/checkout/main file IPC suites:
**215 tests / 12 files**. New deferred-promise tests cover cold/empty/history/error/retry,
thrown failures, nested retention, filtering/hidden names/selection/dirty buffers,
3-permit priority, safe sharing and forced successors, repeated focus/watch/manual,
rejection/throw release, retirement without false permit release, queued cancellation,
A→B→A, same-textual-path environments, unavailable contexts and confirmed mutation
ordering using existing action handlers. Main authorization tests are unchanged.

All six Electron runners passed: new Explorer refresh fixture, checkout presentation,
workspace-switch measurement, workspace-page/Browser, launch race, Source Control.
Owned Stage 1 teardown verified PTY exits and natural Electron close; the Explorer
fixture has no PTYs. No user processes/paths/registrations are used or modified.
Final `npm run validate` passed branding, lint, typecheck, Fallow (no baseline changes),
security audit (existing documented dev-only exception), build and **7,800 tests / 399 files**.

```sh
npm run build
npm run diagnose:explorer-refresh
node scripts/checkout-presentation-smoke.cjs
node scripts/workspace-switch-measure.cjs
node scripts/workspace-page-browser-renderer-smoke.cjs
node scripts/workspace-launch-race-smoke.cjs
node scripts/source-control-management-smoke.cjs
npm run validate
```

Evidence: `/tmp/176-stage5-explorer-{before,after}.json` (+ `.err`),
`/tmp/176-stage5-switch-{before,after}.json`, `/tmp/176-stage5-{checkout,browser,launch,source}.log`,
`/tmp/176-stage5-targeted-final.log`, `/tmp/176-stage5-validate.log`.
Opt-in development diagnostics reuse the 512-event Stage 1 stream with fixed scheduler
event labels and active/queued counts only; no paths, contents, credentials or telemetry
persistence. The disposable runner explicitly exports these counters.

No authorized live SSH fixture was supplied, so live latency/transport behavior is
unverified; no arbitrary host was contacted. Large-repository, compositor/production,
long-run allocation/GC and network-throughput optimum remain unmeasured. Stage 6 may
review cross-resource focus/editor/session-policy interaction and snapshot/watch
redundancy; this stage adds no application coordinator, daemon, helper, poller,
history warmup, startup work or broader watcher/residency redesign. Stop for review.
