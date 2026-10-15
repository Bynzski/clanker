# Automatic attention field diagnostics (#152)

## Why

The owner's `0.12.0-dev.b554732` journal showed normal broker decisions alongside 79 unattributed auth rejections. Publication logs said the renderer was available, but could not prove store merge or indicator presentation. Two Pi terminals were retired while the last accepted turn was Running. These observations do not establish a root cause.

This change automatically preserves the evidence needed to distinguish broker rejection, missing renderer delivery, equal-revision tombstones, and acknowledgement/presentation suppression. It does not repair a provider lifecycle gap or infer completion from silence.

## Capture and retention

When `CLANKER_DEBUG_ATTENTION=1` (default for unpackaged and packaged `-dev` runs), main writes:

- `<userData>/attention-diagnostics/attention.jsonl`
- `attention.1.jsonl` and `attention.2.jsonl` in the same directory (older rotations)

On a normal Linux install this is `~/.config/clanker-grid/attention-diagnostics/`. No shell redirection or DevTools query is necessary. `CLANKER_DEBUG_ATTENTION=0` disables new persistent capture and the receipt monitor; it does not delete existing logs. Stable packaged builds remain off by default. Existing bounded in-memory broker diagnostics remain available independently.

Files are capped at 1 MiB each; the writer queues at most 256 records, reports discarded records, serializes asynchronous filesystem work, and fails closed if its directory/files are symlinks or not regular files. POSIX directories/files use 0700/0600; Windows uses inherited ACLs. A write failure disables file logging for that run with a fixed console warning. Quit waits at most two seconds for the diagnostic drain. Logs are best effort: hard crashes, queue overflow, rotation and a failed/stalled disk can lose evidence.

Only explicit content-free schemas enter the writer; it does not intercept console output. Records contain terminal IDs, bounded event/verdict names, revisions, lifecycle/presentation states, short session/turn hashes and timing—not credentials, prompts, responses, tool payloads, or raw workspace/checkout paths. Do not attach arbitrary provider logs or an unredacted manual explanation assuming they have the same guarantees.

## Recorded stages

- Startup app version/platform.
- Broker registration, decisions, release, and transport rejection verdicts. Existing console diagnostics remain intact.
- Main publication revision/status, WebContents availability, and `deliveryExpected`. An available WebContents alone does not establish that the app bridge has subscribed.
- Separate `hydration` records for snapshot queries, including whether a receipt is expected. Only the subscribed app bridge passes the diagnostic `forBridge: true` marker; default read-only queries neither establish readiness nor create deadlines. This marker changes diagnostics only, not the returned snapshots or authority.
- `renderer-state` records delimit unavailable periods (main-document navigation/reload, renderer loss, window close, shutdown, or an unavailable publication). A main-owned `rendererEpoch` groups evidence; it is diagnostic metadata only.
- Renderer receipt: source (`push`, `hydration`, or cached `presentation`), received/stored revision, merge classification, snapshot presence, foreground state, eligibility, suppression reason, and the existing shared presentation selector's result. Reports follow pushes/hydration and acknowledgement/focus/workspace/page changes. These describe the selector, not proof that pixels were painted. Duplicate receipts are suppressed in main.
- Main-loop samples every approximately 30 seconds and on delayed diagnostic ticks. Histogram values are cumulative since monitor startup; tick delay can include scheduling or system suspend, not just expensive application work.
- Automatic anomaly records containing the latest 24 broker entries plus event-loop summary: rejected attributed events, release while an accepted turn is active, renderer merge disagreement, unexpected eligible Running suppression, or an overdue expected receipt after five seconds. Anomaly capture is limited to once per terminal per five seconds and tracks at most 64 terminals. Detailed receipt/publication records remain available even when an anomaly is rate-limited.

### Receipt deadlines and renderer boundaries

A missing-receipt check starts only for an actual push to an available, subscribed app renderer or an instrumented bridge hydration. Unavailable publications are preserved with `deliveryExpected: false`, without a receipt deadline. Full main-document navigation (not in-page/subframe navigation), renderer loss, window close and admitted app shutdown cancel the old renderer's outstanding checks and clear old delivery acknowledgements. Native broker state is untouched. The recreated bridge subscribes, then requests tracked hydration; actual redelivery starts a fresh check in the new epoch. Shutdown cannot rearm it.

For the same terminal/revision within one renderer epoch, repeated hydration and duplicate pushes preserve the **first outstanding deadline**, any receipt already recorded, and whether a missing-receipt anomaly was already reported. A newer main-owned revision supersedes the older check; stale hydration/receipts cannot regress it or satisfy it. A late current receipt remains evidence and stops further missing checks. A read-only snapshot query never starts or extends a deadline.

A current push/hydration receipt proves receipt was reported even when merge failed: diagnose `renderer-merge-disagreement`, **not** a later `renderer-receipt-missing`. Cached presentation observations do not themselves prove receipt of a delivery. “Missing” means no current delivery receipt was recorded by the deadline; it does not prove IPC loss, failure of the native hook, or a permanently absent indicator.

### Reading suppression evidence

| Evidence | Diagnostic interpretation |
| --- | --- |
| Expected Running publication, no current receipt by deadline | `renderer-receipt-missing`: delivery receipt is overdue. |
| Current receipt, stored revision/snapshot or merge disagrees | `outcome: merge-disagreement`, with a bounded anomaly; reception and merge failure are separate facts. |
| Current receipt and matching stored snapshot, `indicator: none` | `outcome: stored-indicator-none`: inspect `eligible`, `suppression`, `foreground` and `publishedStatus`. |
| `eligible: false`, `suppression: ineligible` | Intentionally gated (capability disabled or terminal absent), including a main Running snapshot; not a missing delivery or unexpected suppression alarm. |
| `eligible: true`, `suppression: acknowledged` | The same selector shows a view without seen watermarks but none with them; explains an acknowledged finish/Stop. A prior acknowledgement may persist when no longer foreground. |
| Eligible main Running snapshot, correct revision/presence, `indicator: none` | `renderer-running-indicator-none`: unexpected observational disagreement, even if foreground or claiming acknowledgement. Acknowledgement cannot hide Running in the shared selector. |
| `suppression: selector-none` / `no-snapshot` | Existing selector produced no view even without acknowledgement, or no snapshot was stored. Do not infer completion. |

Suppression description reuses `deriveAttention()` (including a counterfactual without seen watermarks only to identify acknowledgement). There is no second presentation selector and no new lifecycle state. In-memory `window.clankerAttention.explain()` uses the same description; its legacy `suppressed` strings remain available.

A receipt is **not** user acknowledgement and **never** supplies lifecycle, location, handoff or checkout authority. IPC requires the app's main renderer frame and a strict metadata allowlist. Main accepts attribution only for its tracked publications. A renderer can be wrong or unresponsive; its receipt remains observational evidence, not ground truth. Diagnostic timers never change attention state or retry/replay events.

## Late credentials

On release, the broker keeps at most 256 full SHA-256 credential digests with main-owned terminal/harness/transport metadata. Raw retired tokens are not retained, digests are not written to logs, and every delivery with a retired credential **still returns `rejected-auth`**. Replacement registrations do not acquire authority from old credentials.

Every `rejected-auth` `transport-rejection` record carries an `attribution`:

| `attribution` | Meaning | Extra fields |
| --- | --- | --- |
| `retired-credential` | A credential Clanker issued and already retired: the agent's process, or a child of it, outlived its registration. | `terminalId`, `harness` (registered), `retiredForMs` |
| `harness-mismatch` | A live credential reported as a different harness: typically a nested harness launched from an agent's tools inherited its credentials. | `terminalId`, `harness` (registered) |
| `unknown-credential` | No credential issued by this process (another Clanker instance, a stale build, or garbage). | none |

All three may add the envelope's own `reportedHarness` (only if it is a plain harness name), wire `event` (only a known event) and `nativeEvent` (only the bounded native-name pattern). Session/turn IDs, paths and content are never recorded. Within 60 seconds of release an exact same-harness/transport late delivery additionally produces `late-retired-delivery` in the old terminal's own trace. `broker` records with `semantic: registered` carry the registered `harness`.

`release-without-settlement` means a registration was released while its accepted runtime was active. It can result from termination, replacement or cleanup; it is not proof of a lost completion callback or provider failure.

## Separate watcher correction

`ExplorerWatcherService` previously passed glob strings to Chokidar 4, which removed glob support. Field logs showed it traversing `node_modules` and encountering Electron ASAR errors. It now supplies a checkout-relative predicate that prunes ignored directory names (including the directory itself), dot entries and `.pyc` files before descendant traversal. The watched checkout root is never ignored even if its own name matches. Tests assert actual negative events as well as an allowed-file positive control. No causal connection between this watcher defect and attention loss has been demonstrated.

## Remaining gaps / review boundary

- This first layer does **not** persist hook-side callback/adapter/send outcomes before an envelope reaches main. A callback that never runs, a provider-interpreter failure before delivery, and an entirely lost send can still require provider-side instrumentation.
- It does not independently certify upstream native event semantics or fix unsupported completion/session boundaries. The built-Electron smoke uses an explicit owned PTY lifecycle fixture, not actual Codex/Claude/Pi/OpenCode/OMP/Antigravity native hooks. No real SSH harness lifecycle or remote receipt timing was verified in this follow-up.
- Frame/source/revision validation improves attribution but does not prove the renderer's report is truthful, nor that an indicator was painted. Missing receipts can also mean delayed/failed instrumentation. Suppression alarms are evidence of disagreement, not instructions to repair or rebind tracking.
- It does not automatically submit diagnostics anywhere or poll conversations/PTY text.
- Small bounded logs may rotate before an incident is reviewed. Copy the three files promptly; local review should correlate terminal IDs and incident times, and distinguish expected shutdown rejections from live failures.

Regression coverage includes unavailable/startup/loading/closed/gone/shutdown boundaries, in-page/subframe navigation exclusions, original deadlines across repeated tracked/read-only hydration, delayed/stale/tombstone receipts, renderer recreation without inherited receipts, failed-merge versus missing-delivery classification, legitimate Running eligibility suppression, unexpected eligible Running suppression, and foreground acknowledgement. Receipt schema/sender/frame validation, retired-credential isolation, rotation/overflow/private permissions/symlink refusal, and actual Chokidar exclusions remain covered.

The real built-Electron smoke additionally reloads a Running fixture, verifies fresh renderer hydration without altering native registration, repeats read-only snapshot queries, waits beyond the five-second grace period, and checks persisted logs across restart/shutdown for false missing-receipt anomalies and raw identity/path leakage. Current-main workspace loading/refresh code is preserved; this follow-up adds only observational diagnostic integration.
