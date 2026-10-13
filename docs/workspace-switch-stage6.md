# #176 Stage 6 — session discovery single-flight and refresh policy

Base: accepted Stage 5 `538623a7c3d46620ed394f3dfc00d2e1c04f3cf0`.
Same branch/worktree; Stage 6 only, no Stage 7 or merge.

## Audit and duplication established before implementation

Read the full issue/revised implementation order and Stage 1–5 evidence. Traced Header →
useConversationHistory → preload SESSION_DISCOVER → registered workspace → checkout plan →
local provider/cache or SSH discovery, plus independent session invocation/rediscovery.
Also reviewed idleWarmup, History UI, managed-account source/generation, sessionWorktrees,
checkout reconciliation, Explorer lifecycle/index/loader/scheduler, renderer/main remote
watcher, editor reload/watcher operations, worktree section/New Agent demand, Git poller/
resource/action contracts and opt-in diagnostics.

The concrete gap is **publication tokens without physical sharing**: `activeScans` stops
older local scans writing a newer cache, but equivalent requests still execute provider
parsers independently. SESSION_DISCOVER also independently re-lists worktrees/branches to
build each plan. The disposable native fixture, before production changes, found 24
provider starts for two ordinary requests, 36 for three forced requests and 48 for ordinary
plus three forced requests (six native providers × two scopes per workspace × callers).
Opening real History during its delayed warmup added another 12 concurrently active provider
reads. No general refresh-coordinator problem was inferred from mere method names.

## Ownership matrix (retained specialized owners)

| Resource / resulting state owner | Activation | Focus | Explicit manual / panel demand | External change / mutation | Sharing, identity and failure policy |
|---|---|---|---|---|---|
| Current Git status: main GitService poller → checkoutGitStore; toolbar descriptions: bounded Stage 3 cache | Existing selection/epoch-keyed controller starts the one poller; stale descriptions are display-only | No new focus poll owner | Changes Refresh asks for current scoped status | Main stage/unstage/commit publish/return one acquisition; other mutation families retain required notifications/read paths | Main loop coalesces one pending poll; renderer acquisition sequence/physical key/epoch/generation reject older results. Failure is unavailable, not clean; explicit recovery remains independent |
| Source Control metadata: controller-local Stage 4 resources | No mount remotes/metadata bundle | No global metadata refresh | Page open requests declared resources; revisit reuses, Refresh/Retry forces section dependencies independently; close retires requests | Targeted head/index/stash/remote invalidation, truthful mutation outcome separate from refresh failure | Resource generations and exact checkout/controller/dialog identity; historical rows marked and cannot authorize mutation; metadata requests are not broadly shared across controllers |
| Explorer directory entries: workspace store; directory loader + Stage 5 scheduler | Visible selection/root/reopening reacquires root and expanded directories without hiding history | Visible active SSH Explorer forces the same path set; local watcher is independent | Manual Refresh/Retry forces root/target; expansion requests its directory | Existing 100 ms local/SSH event debounce; changed snapshot requests successor, unchanged paths retry stored errors; confirmed file operations refresh parent and revise cleared subtrees | Three physical SSH permits across lifetimes, local unthrottled; workspace/environment/context/root/epoch/directory keys. One forced successor; retirement never pretends IPC stopped. Failure preserves last-known listings/errors |
| Local tree watcher: ExplorerLifecycleCoordinator + main chokidar owner | Align with active local root, same-checkout no-op | No extra watcher | Showing tree requests listings; watcher lifetime separate | Directory notifications drive Explorer owner | Identity-keyed one watcher; neither History nor refresh sharing alters subscriptions. Setup failure is reported; later identity change retries |
| Remote metadata watcher: renderer sync/pending changes + one main RemoteFileWatcher | Align active SSH checkout/targets; parked tabs outside that root remain parked | No additional snapshot owner; Explorer focus is a distinct freshness demand | Manual file/directory reads independent of metadata snapshot | Bounded files/directories snapshot about every 3s, non-overlap; backoff/abort on retired transport; unchanged entries retry existing errors only | Same-checkout request no-op; exact registration/context/generation and target validation. Snapshot failure is not deletion; editor change queue retains newer notifications through outstanding reads/operations |
| Editor buffers: workspace store + editorFileWatcher/automaticEditorReloads | Preserve contents/dirty tabs; align watchers, no broad editor re-fetch | Active visible SSH Explorer asks clean tabs to reload | Tab Reload/read/save remains individually checkout-bound | Local/remote file notifications preserve dirty buffers and newer change demand; save has priority | Automatic reads already share active ownership with one rerun; idle retry does not request rerun. Environment/file pending-operation guards, captured tab checkout and dirty rechecks; read failure flags external change/deletion only under existing rules |
| Checkout reconciliation: renderer requestCheckoutReconciliation → main registry authority → store | Active workspace change, only with worktree contexts | Focus active workspace | Worktree menu reload explicitly reconciles after descriptive inventory; removal/release have their own main checks | Agent turn end/exit, terminal close, scoped watcher errors | Per-workspace running promise **plus one queued follow-up**, not simple promise sharing. A later event may reflect changed Git. Identity checks on apply; failure changes nothing and next trigger retries |
| Worktree inventory/plans: section/New Agent/main scoped Git consumers | openWorkspace preparation still performs its existing descriptive inventory; no new activation work | No broad inventory focus owner (reconciliation is separate) | New Agent and Source Control each own opening/reload; session discovery owns its own plan | Create/remove/unlock/prune refresh their owned inventory and authoritative reconciliation | Session callers now share their whole plan flight; no global Git-worktree cache or adoption shortcut. Descriptive list cannot substitute for registry/removal/resume preflight; failures retain existing recovery behavior |
| Conversation history: renderer 8-workspace memory; main sessionHistory 16-entry/60s cache | Local Header schedules optional 3s delayed idle warmup only without complete remembered history | No session-history focus trigger | History opening/reopening always forces; closing retires visible token; no new UI refresh button | No new file/Git subscriptions; next opening forces rediscovery; account generation/cache clear invalidate old inputs | Session-specific whole-workspace flight including plan; direct provider API has same policy but is bypassed when IPC owns queue. Detailed diagnostics retained; ordinary results projected. Partial/failure never cached as complete; last-good visible history marked unverified and retriable |

Assistant destinations, Browser leases/visibility, terminal continuity, three warm surfaces,
startup restoration and production close guard are unchanged. Workspace-only owners keep
their existing active-destination checks; no new parked-workspace demand is introduced.

### Common policy by trigger

- **Activation:** acquire only useful active status/files. Panel metadata stays on demand;
  local history warmup is not an activation prerequisite. No SSH session warmup.
- **Focus:** check resources that can change while unfocused through their existing owners.
  Bursts may share eligible work; later change demand is not discarded indefinitely.
- **Manual:** forced freshness is not a TTL hit. Join an eligible forced acquisition, or
  arrange one successor after an ordinary read. Do not silently inherit an older ordinary scan.
- **Mutation:** invalidate/reacquire affected resources and report actual command outcome.
  Refresh failure is not mutation failure. No refresh policy grants filesystem/launch authority.
- **External change:** preserve later notifications and ordering through read/save overlap.
  A required watcher/reconciliation successor is not a duplicate to optimize away.
- **Idle:** optional, delayed and best effort. Renderer idleness does not prove main I/O idle;
  it still keeps warmup off the immediate activation burst. A running scan is not forcibly
  cancelled by panel closure or a switch.

## Single-flight implementation and identity

`SessionDiscoveryFlights` is a small session-only, promise-lifetime map. No timers, priority
bus, data cache, cancellation claims or global resource coordinator. Ordinary/detailed
requests with equivalent identity share one acquisition. Forced requests during an equivalent
forced flight share that fresh acquisition. An ordinary caller can use that same detailed
result. Force during an ordinary flight waits for it (success **or failure**) then executes
**one forced successor**; all later forced callers share it. Ordinary callers arriving after
that successor is scheduled join the successor too, rather than receiving an intermediate
cache result. The map drops each entry after actual settlement; no per-event queue builds up.

The primary owner is **SESSION_DISCOVER**, before checkout-plan acquisition, for both local
and SSH workspaces. This shares worktree/branch inventory as well as expensive providers.
The key captures main-owned inputs, not caller-controlled identities:

- Requested registered workspace ID, canonical location/environment, exact registration
  object identity and environment/discovery-method identity (WeakMap IDs, never logged).
- Current validated checkout-context descriptions, including root/branch/missing state,
  which can alter plan inputs; Git's plan itself is acquired once inside the flight.
- Sorted available harness options (commands/arguments/configuration) and provider discovery
  implementation identities/orders; trusted managed account-set generation and target IDs.
- Session cache invalidation generation. Different hosts, replacements or configurations
  never join merely because their textual paths agree.

Manual successors rebuild the checkout plan: external Git state changing after ordinary
plan acquisition is not assumed equivalent. Local cache scope additionally includes the
actual derived main/container/linked/generated/remembered roots, so different scan plans
cannot reuse path-equal cached provider results. Available/account configuration and
registration are rechecked before dispatch, after plan acquisition and after discovery;
closed/replaced/configuration-invalidated IPCs reject instead of publishing obsolete data.

Local `discoverSessionsDetailed` also shares direct API consumers under normalized native
scan path + provider configuration + managed generation/targets + trusted scope + cache
invalidation generation. `discoverSessions` projects that detailed result. **IPC passes
`coordinated: true`**, so provider reads bypass the inner flight queue: there is exactly
one successor owner per call graph, not competing nested coordinators. Local cache/token
publication protection remains in force on this path. Resume's independent rediscovery
uses its own existing direct API/provider path; it does not read History's UI memory.

Default-only and empty managed-target sets remain equivalent provider-only scans; an IPC
request with a configured but unavailable managed set still captures its account generation
in the whole-workspace identity. Trusted generation represents owned account homes/bindings;
new per-call binding closures do not accidentally prevent sharing. Detailed results are
always acquired internally, even for ordinary IPC callers, preserving independent provider
diagnostics; only the ordinary return shape is projected to sessions.

## Cache, publication, failures and UI

Retained: 60s TTL, 16-entry LRU bound, account provenance, POSIX output, provider-independent
allSettled and successful-empty versus failed/partial distinctions. Cache identities now
also include provider implementation/configuration and trusted checkout scope. Force deletes
the prior complete cache on demand and again on successor start; a preceding ordinary result
cannot satisfy that force or leave a failed refresh apparently current.

Read-start `activeScans` tokens and cache generation still guard publication. Cache clear
(all/workspace) advances generation: old physical work continues, but cannot refill cleared
cache. New-generation force may complete before old ordinary work; older completion cannot
overwrite the newer token/result. Queued old-generation successors reject instead of
starting stale work. Tests and native fixture control this otherwise impossible ordering
under the normal serial-successor policy. Partial scans retain independent diagnostics and
usable sessions but never become complete/empty cache hits; rejected providers settle the
flight and permit retry. SSH keeps its existing on-host bounds/timeouts; provider exceptions
and timeouts remain visible through capability diagnostics, not cached absence.

Renderer still remembers at most eight history scopes, now separated by workspace ID,
environment and root. Delayed local warmup remains optional and quiet on failure; partial
warmup stays retryable on reactivation. Visible callbacks additionally check synchronous
checkout selection epoch and scope, so batched A→B→A cannot publish an earlier response.
Panel close/unmount/workspace change voids UI tokens, not the underlying scan. Reopening can
reuse a still-eligible forced flight only under the declared main freshness contract.

Useful prior history remains visible during refresh or rejection. A compact notice says
`Last known history · not freshly verified` (and Refreshing while pending), with actionable
existing discovery error text. Partial manual discovery cannot replace a complete last-good
list with a misleading incomplete list; without last-good data its fresh partial sessions
and warnings remain useful. Successful acquisition clears the last-known marker; a successful
empty result is real empty history. Existing session grouping and launch controls are retained.

**Discovery is not launch authority.** SESSION_INVOKE, default/managed session rediscovery,
account binding, current registered checkout and authoritative resume/recreation routing,
flag validation and pre-PTY identity checks were not redesigned. The native fixture discovers
history then sends a forged Pi ID/cwd/file path; main refuses it before any PTY/inference.
Existing real-Git resume/adoption/removal and managed-account/SSH resume suites still pass.

## Other candidates deliberately left unchanged

- Reconciliation deferred test: three overlapping requests cause **one current + one later
  reconciliation**, not three. The second protects changes after the first read started;
  activation/focus/turn-end sharing must not discard it.
- Stage 5 SSH Explorer controlled Refresh/five-focus workload remains **12 listing starts,
  peak 3**, coalescing 42 demands with three forced successors. Changed watcher notifications
  can justify those successors; no second directory scheduler is added.
- Automatic editor reload already retains one rerun; watcher pending changes retain a newer
  event through manual read/save. Focus is currently conservative change demand, not idle
  retry. Removing its successor without source/timing proof could lose an edit, so left alone.
- Worktree menu listing followed by main reconciliation is two different contracts:
  descriptive inventory versus authority reconciliation. Reusing renderer data for the latter
  is unsafe. Only equivalent **session discovery callers' main-owned plans** are shared here.
- Switch measurements still show two StrictMode status acquisitions, peak measured Git read
  1, one owned poll loop, no mount metadata reads. Stage/unstage/commit single notified/returned
  acquisition remains intact. No general status coalescer or poller change was justified.

## Paired native measurements

Linux 7.2.9-2-cachyos, Node 26.11.1/npm 12.2.0, Electron 41.10.7/React 19.2.4.
Same headless native Electron/dev StrictMode/Vite, owned temporary HOME/profile/local Git,
real SESSION_DISCOVER IPC/registry/checkout plans and native provider parsers. Tiny real Pi
JSONL files supply sessions; owned CLI stand-ins answer availability/empty session lists,
never inference. Wrappers count actual provider method entries and hold **real acquired
outputs**, not fabricated successful discoveries. Gates auto-release at eight seconds and
release/restore in finally. Baseline was captured before production edits and then repeated
against an identical final runner in a temporary `git archive` of Stage 5; no new worktree.

Six native discovery providers, two scopes before linked worktree creation; adding a real
external linked checkout makes three scopes. Per-scope provider fan-out is unchanged.

| Workload | IPC discovery requests (both) | Whole plan reads before→after | Provider starts before→after | Pi starts before→after | Provider overlap peak before→after |
|---|---:|---:|---:|---:|---:|
| Two ordinary, overlapping | 2 | 2→1 | 24→12 | 4→2 | 24→12 |
| Three forced, overlapping | 3 | 3→1 | 36→12 | 6→2 | 36→12 |
| Ordinary then three forced while held | 4 | 4→2 | 48→24 | 8→4 | 48→12 |
| Two forced with real linked checkout | 2 | 2→1 | 36→18 | 6→3 | 36→18 |

After fixed policy counters: shared hits 1/2/2/1, forced successors 0/0/1/0;
local per-scope cache misses 2/2/4/3. These are **not** IPC counts. The one forced successor
sees a real session file created after the ordinary output was captured; the baseline's
already-running forced scans all return the older captured view. After invalidation, fresh
force finishes before the held old output: main rejects old publication, newer data remains
cached. One subsequent ordinary cached call has **0 provider starts, 1 plan read** in both
versions (three after cache-hit counters); it is not claimed as eliminated work.

Real Header warmup waits its existing three-second delay. Opening while held:
provider starts/active peak 12→24 before, stays 12 until successor dispatch after.
Its plan marks include one unrelated openWorkspace registration listing (2 before opening,
3 after opening before; 2/2 after); do not mistake those for two history scans.
Remembered visible session observation 87→85 ms; fresh UI observation 479→469 ms in the final
sample, including clicks, group expansion, injected hold interval and Source Control visit.
Whole paired workload drain observations before→after, ms: 218→264, 204→255, 207→278, 205→252.
No latency speedup is claimed: serial freshness costs a later acquisition, method accounting/
headless dev overhead varies, and these are controlled gates rather than normal throughput.
Source Control remains operable while History is held; History closes on workspace switch,
late completions cannot recreate its panel. No compositor paint measurement is made.

Four-workspace switch runner, cold reactivation then warm A→B→A, Explorer collapsed:
frames before→after ms = 46.4/32.2→35.5/45.2 cold; 24.7/25.6/31.4→30.3/30.9/31.8 warm.
All rows retain 5 invoke starts, 2 Git status acquisitions, 3/4/3/3/3 App commits and read
peak 1. Warmup does not start in the immediate switch windows. No statistically demonstrated
startup/activation regression or improvement, production render/CPU/GC/network speedup is
claimed. Startup-specific serial shell preparation remains a Stage 7 investigation, not
implemented here. This stage adds no startup waits, restoration work or residency expansion.

## Verification and remaining limits

Targeted history/cache/order, IPC, managed accounts, SSH discovery, History UI,
reconciliation, Explorer and Source Control suites: **431 tests / 20 files**. Additional
real-Git lifecycle/ordering/diagnostic suites: **45 tests / 5 files** (overlapping targeted
coverage). Full `npm run validate`: **7,824 tests / 400 files**, branding/lint/types/Fallow
(no baseline edits)/security (existing documented dev-only exception)/build all passed.
One integration fixture had constructed a fresh provider function on every catalog lookup;
made that stub stable like the production fixed registry, retaining all lifecycle assertions.

Deferred coverage includes ordinary/forced equivalent sharing, one eligible forced successor,
late ordinary after new-generation force, cache invalidation/clear-and-new, account generations,
distinct scope sets, same-path SSH hosts, partial/exception/timeout/retry/empty discovery,
whole plan sharing, workspace closure/replacement/configuration change, actual History consumers,
warmup/open/close/reopen/A→B→A and retained failure presentation. Existing authoritative resume,
managed binding, SSH transport/metadata bounds and reconciliation follow-up suites are preserved.

Seven native runners passed with clean owned teardown: new session-discovery fixture,
workspace switch, checkout presentation, Explorer refresh, Source Control, launch race,
workspace-page Browser. Existing Stage 1 cleanup verified PTY exits/natural Electron exit;
new history runner launches no PTYs and modifies only its owned provider wrappers. No close
prompt auto-approval, process-name kill or user registration/root interference. Temporary
baseline archive is removed after verification.

Reproduce after `npm run build`:

```sh
npm run diagnose:session-discovery
node scripts/workspace-switch-measure.cjs
node scripts/checkout-presentation-smoke.cjs
npm run diagnose:explorer-refresh
node scripts/source-control-management-smoke.cjs
node scripts/workspace-launch-race-smoke.cjs
node scripts/workspace-page-browser-renderer-smoke.cjs
npm run validate
```

Evidence `/tmp/176-stage6-history-{before,after}.json` (+ `.err`),
`/tmp/176-stage6-switch-{before,after}.json`, `/tmp/176-stage6-{checkout,source,launch,browser}.log`,
`/tmp/176-stage6-explorer.json`, `/tmp/176-stage6-{targeted,ordering-final,validate}.log`.
Main opt-in Stage 1 counters add fixed discovery/provider/local-scan/shared/successor/cache
labels only; no session/account contents, titles, paths, credentials, request keys or responses
are logged. Packaged/production collection remains disabled; data are not persisted telemetry.

No authorized live SSH fixture or native managed-account credentials were supplied. SSH-host
identity/discovery/resume and managed-account isolation are unit/integration verification,
not live-network/authenticated-account performance claims. Local filesystem provider I/O has
its existing completion behavior; a hung ordinary read can delay its forced successor. No
fictional timeout/process cancellation was added. No cross-workspace discovery concurrency cap
is claimed, nor is the existing six-provider/per-scope work removed. Representative large
session stores, long-run allocations/GC, production startup/compositor and network throughput
remain unmeasured. Stop for independent review before Stage 7.
