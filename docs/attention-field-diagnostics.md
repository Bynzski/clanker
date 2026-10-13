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
- Main publication revision/status and renderer availability, including hydration snapshots.
- Renderer receipt: received/stored revision, merge classification, snapshot presence, foreground state, and the shared indicator selector's result. Reports follow pushes/hydration and acknowledgement/focus/workspace/page changes. These describe the selector, not proof that pixels were painted. Duplicate receipts are suppressed in main.
- Main-loop samples every approximately 30 seconds and on delayed diagnostic ticks. Histogram values are cumulative since monitor startup; tick delay can include scheduling or system suspend, not just expensive application work.
- Automatic anomaly records containing the latest 24 broker entries plus event-loop summary: rejected attributed events, release while an accepted turn is active, renderer merge disagreement, or absence of an agreeing receipt after five seconds. Anomaly capture is limited to once per terminal per five seconds and tracks at most 64 terminals. The newest publication supersedes older pending receipt checks.

A receipt is **not** user acknowledgement and **never** supplies lifecycle, location, handoff or checkout authority. IPC requires the app's main renderer frame and a strict metadata allowlist. Main accepts attribution only for its tracked publications. A renderer can be wrong or unresponsive; its receipt remains observational evidence, not ground truth. Diagnostic timers never change attention state or retry/replay events.

## Late credentials

On release, the broker keeps at most 64 full SHA-256 credential digests with main-owned terminal/harness/transport metadata. For 60 seconds an exact matching late delivery can produce `late-retired-delivery` in the old terminal's diagnostic trace. Raw retired tokens are not retained, digests are not written to logs, and these deliveries **still return `rejected-auth`**. Wrong harness/transport/remote terminal, unknown tokens and expired matches remain unattributed. Expired entries are ignored on intake and pruned on subsequent releases; the bounded table is cleared at shutdown. Replacement registrations do not acquire authority from old credentials.

`release-without-settlement` means a registration was released while its accepted runtime was active. It can result from termination, replacement or cleanup; it is not proof of a lost completion callback or provider failure.

## Separate watcher correction

`ExplorerWatcherService` previously passed glob strings to Chokidar 4, which removed glob support. Field logs showed it traversing `node_modules` and encountering Electron ASAR errors. It now supplies a checkout-relative predicate that prunes ignored directory names (including the directory itself), dot entries and `.pyc` files before descendant traversal. The watched checkout root is never ignored even if its own name matches. Tests assert actual negative events as well as an allowed-file positive control. No causal connection between this watcher defect and attention loss has been demonstrated.

## Remaining gaps / review boundary

- This first layer does **not** persist hook-side callback/adapter/send outcomes before an envelope reaches main. A callback that never runs, a provider-interpreter failure before delivery, and an entirely lost send can still require provider-side instrumentation.
- It does not independently certify upstream native event semantics or fix unsupported completion/session boundaries.
- It does not automatically submit diagnostics anywhere or poll conversations/PTY text.
- Small bounded logs may rotate before an incident is reviewed. Copy the three files promptly; local review should correlate terminal IDs and incident times, and distinguish expected shutdown rejections from live failures.

Regression coverage includes receipt schema and sender/frame validation, actual renderer push/hydration/stale/tombstone receipts, retired-credential expiry/transport isolation, writer rotation/overflow/private permissions/symlink refusal, receipt anomalies, and Chokidar's excluded directories.
