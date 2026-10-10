# Issue #152: attention delivery review

## Checkpoint 1 — local ACK contract

Source reviewed and contract tests run on October 9, 2026. This checkpoint fixes shared
local delivery and its serialized hook recovery. It does **not** establish the root cause
of every reported missing indicator or complete issue #152.

### Observed loss stage

The loopback server formerly returned `ok` after every complete message, irrespective of
parse, authentication, transport or root/turn correlation. The observer interpreted that
as successful delivery. The serialized command could therefore clear its conservative
poison marker on a boundary the broker had rejected or ignored.

A concrete regression exposed this: the existing corrupt-state recovery test interrupted
`t1`, then attempted recovery by starting `t1` again. The broker retained `t1` as retired
and ignored the new start, yet the old unconditional ACK cleared poison. With truthful
ACKs the same test retains poison until a fresh accepted `t2` start. This proves a false
recovery at the transport/bridge boundary; it does not prove the native field symptom.

### Change

The local reply is one versioned line, `clanker-attention-v1:<verdict>\n`, with a fixed
vocabulary and a 96-byte intake bound:

| Verdict | Bridge behavior |
| --- | --- |
| `accepted-changed` | Accepted; an accepted turn/session-end boundary may recover poison |
| `accepted-idempotent` | Accepted duplicate; same boundary rule |
| `ignored-child`, `ignored-stale` | Harmless; neither poison nor recover |
| `rejected-invalid`, `rejected-auth`, `rejected-transport` | Failed delivery; poison lifecycle transaction |
| `rejected-mismatch`, `rejected-ambiguous` | Failed identity attribution; poison lifecycle transaction |
| Missing, unknown, truncated, oversized, old `ok`, or timed-out ACK | Failed delivery |

The provider-facing `emit` boolean remains true only for accepted events. The serialized
command asks for the detailed verdict. Read/interpret/write/deliver remains under its
existing exclusive lock. There are no retries, identity relaxation or fallback detectors.
Lost location-only reports retain the existing exemption from lifecycle poison.

The observer handles fragmented ACKs and uses a 500 ms total deadline, so a trickling
peer cannot extend the transaction by resetting an inactivity timeout. Oversized requests
are disconnected without an ACK. ACKs contain no credentials, paths or provider content.

Broker decision diagnostics now include the exact delivery verdict alongside terminal,
semantic event, revision and status. Existing `CLANKER_DEBUG_ATTENTION=1` logging also
reports parse/auth/transport rejection reason codes without echoing incoming data.
This is the broker/transport portion of diagnostics; attachment, renderer visibility and
IPC delivery diagnostics remain to be implemented. No new public diagnostics IPC exists.

### Evidence and limits

- Real child Node processes run the generated observer and serialized hook command
  against an actual loopback socket and broker, including overlapping transactions.
- A real observer/socket/broker path feeds the canonical change payload into the actual
  renderer attention store and presentation selector: start, duplicate, wrong root,
  ambiguous identity, child completion, completion/acknowledgement, second start, stale
  completion, proven session continuation, completion and authoritative retirement.
  Hydrating an older snapshot after retirement cannot resurrect it.
- Protocol regressions exercise malformed/sensitive payloads, authentication, local/remote
  transport separation, fragmented/unknown/truncated/oversized/legacy ACKs and a trickling
  peer. Hook regressions prove ignored boundaries cannot clear poison and a fresh accepted
  boundary can recover without restarting.
- The snapshot callback in this integration test is the IPC payload boundary. Electron
  IPC, mounted UI, workspace switching and actual upstream CLI emission are **not** tested
  by it. Fixtures do not prove native hooks fire.
- SSH remains one-way OSC over the existing PTY. Its observer's boolean means a successful
  tty write, **not** broker acceptance. No desktop ACK, endpoint or credential is forwarded.
  Remote broker intake returns the same verdict vocabulary for main-side diagnostics/tests.

## Native inventory and remaining checkpoints

Only `--version` was run for this checkpoint; **no model inference or native lifecycle
smoke run has been performed**. Use free or low-cost models for subsequent native checks.
Do not modify user-owned hooks/profile configuration to force coverage.

| Harness | Installed version | Native coverage in this checkpoint |
| --- | --- | --- |
| Claude | 2.1.296 | Pending |
| Codex | 0.162.0 | Pending |
| Pi | 1.1.0 | Pending |
| OMP | 18.4.10 | Pending |
| OpenCode | 1.18.34 | Pending |
| Antigravity | 1.3.2 | Pending |
| Hermes | 0.21.5+5751.g4097709 (upstream 4097709b) | Pending; local attention currently unsupported |

Next checkpoints:

1. Report requested versus actually attached native sources, including unavailable/conflict
   reasons, across local and SSH launch paths. Preserve user configuration.
2. Extend safe diagnostics through IPC/store/presentation and audit workspace membership
   retirement. Simple workspace switches have not been shown to remove terminal membership;
   do not call that hypothesis a reproduced race or change retirement on that assumption.
3. Verify versioned upstream contracts and native repeated-turn/session-boundary behavior.
   Prioritize OMP stop continuation, Hermes local capability/SSH interruptions, Claude large
   tool batches/human waits, then Pi replacement, Codex compaction, OpenCode abort/error and
   Antigravity outcomes. Keep strict root authority and a single main broker.
4. Run the Electron four-workspace/background/hidden-pane matrix and local/SSH native smoke
   matrix. Record unavailable hooks for the user's local smoke pass explicitly. The issue's
   full acceptance matrix remains open until these checks and independent review succeed.

No PR or merge is part of this checkpoint.

## Checkpoint 2 — attachment truth, bounded intake and signal diagnostics

Implemented October 9, 2026, on the accepted `512c554` baseline. This checkpoint
establishes acquisition and delivery evidence; it does not claim the original field
failure has one cause or that installed harnesses have passed native emission tests.

### Confirmed defects and corrections

- Local spawn/resume returned the user's enabled preference even when a provider declined
  its integration. For example, Claude `--bare`/user settings, Codex hook configuration
  and OpenCode configuration conflicts could launch without native hooks while reporting
  attention enabled. Public results and terminal metadata now derive from the existing
  launch attachment's `native-attention` provision. Optional acquisition failures and
  unsupported local Hermes are explicitly unavailable. Existing bridge grants use the
  same provision. No user settings are overwritten.
- SSH preparation previously propagated optional acquisition failures as launch failures.
  It now preserves the original harness argv and reports unavailable when preparation
  fails, including conflicting configuration. SSH has a coarse `preparation-failed`
  reason because its existing host preparation protocol does not return typed conflict
  reasons; exception/stderr content is deliberately not exposed. Successful host resource
  creation reports **prepared**, never observed. Normal/resume/checkout replacement and
  failure cleanup carry the same capability contract.
- The serialized bridge stopped retaining stdin after 65,536 bytes, then attempted to
  parse the retained prefix. A valid large Claude batch consequently produced no event;
  a valid JSON prefix followed by discarded bytes could also be interpreted incorrectly.
  Intake now requires the complete JSON object, with an **8 MiB byte bound**, and never
  interprets a truncated prefix. Oversized, malformed and incomplete/timed-out input
  generate separate fixed diagnostic codes. A legitimate interpreter returning no event
  generates `no-event`, distinct from no receipt. Invalid acquisition does not resolve a
  wait or fabricate completion; conservative poison recovers on an accepted native boundary.

Claude's documented [PostToolBatch contract](https://code.claude.com/docs/en/hooks)
includes every batch call's input and model-visible tool response, including response
strings and content-block arrays. It documents no aggregate byte ceiling. The fixture
uses Read and MCP-style results, multi-megabyte Unicode strings/content blocks and a
permission wait. It proves generated bridge processing with the actual Claude interpreter,
not installed Claude emission. PostToolBatch, and any provider hook carrying arbitrary
content, **cannot be guaranteed to fit** the 8 MiB bound. Beyond it we explicitly report
`input-oversized` and preserve lifecycle uncertainty. Raising a bound cannot make an
unbounded upstream contract reliable for every payload.

Intake has a 500 ms deadline, lock acquisition remains bounded to 1,200 ms and local
transport delivery to 500 ms, within configured 3 s hook timeouts (subject to normal
process scheduling/CPU overhead). Interpreter/provider meaning and serialized
interpret/state-write/delivery ordering are preserved. No raw payload is persisted or
logged; only existing bounded correlation state and fixed diagnostic codes survive.
The payload is necessarily held transiently for bounded JSON parsing. Hook diagnostics
are authenticated through the existing observer transport and cannot bind a session,
move an agent, start a turn or settle a wait. Native plugin callbacks that bypass the
serialized command retain their existing provider contracts.

### Capability and diagnostics contract

One optional capability lives on launch metadata and the existing broker registration:
requested or disabled, unavailable with a fixed reason, or prepared. Broker snapshots
add health: unverified, observed, degraded or lost. Health changes share its existing
revision stream; they do not create another lifecycle authority. An accepted lifecycle
signal proves observation; preparation alone and diagnostic-only receipts do not.
Concrete hook intake/state failures, root/turn rejection and authenticated invalid
envelopes degrade health. Accepted native boundaries recover it. The existing proven
removed-directory path marks lost. Silence never changes lifecycle or health.

The shared renderer selector uses hydrated broker capability ahead of launch metadata
or the legacy enabled flag. Unavailable/degraded integrations have a small warning with
an explanation. Acknowledged idle remains intentionally hidden. No provider-specific
status logic was added to components. Optional broker registration failure still has
static unavailable terminal metadata, so its explanation survives missing snapshots.

Launch with `CLANKER_DEBUG_ATTENTION=1`, then use the renderer developer console:

```js
await window.clankerAttention.explain(terminalId)
```

This gated query combines the existing broker explanation's safe delivery projection,
main terminal acquisition facts, broker/renderer revisions, runtime and signal health,
indicator state/suppression, workspace membership/residency and pane presentation.
Counters saturate; labels and codes are bounded. No session/turn IDs, cwd, arbitrary
provider content, credentials or error text are returned. Default debug decision logs
now omit native session/turn IDs, and publication logs report revision/runtime plus
whether a renderer was available. Repeated accepted events with no semantic change
remain visible in counters without revision churn.

Interpretation:

| Evidence | Meaning |
| --- | --- |
| unavailable attachment | Native integration never attached |
| prepared, received = 0 | No authenticated native envelope reached the broker; upstream emission is unproven |
| hook `no-event` | Hook bridge ran and delivered a diagnostic but interpreted no lifecycle event |
| rejected verdict | A native envelope reached the broker but could not apply |
| accepted-idempotent counter | Accepted event without a new authoritative fact |
| renderer revision below main | Renderer was behind at the sampled query; repeat to distinguish in-flight IPC |
| current, idle, acknowledged-idle | Renderer correctly hides acknowledged completion |
| degraded/lost | Concrete evidence is in the reason; no silence inference |

Malformed JSON, over-limit wire frames, invalid credentials and wrong transports cannot
be safely attributed to a terminal. They keep fixed global debug rejection codes rather
than altering a guessed registration. Bounded authenticated envelope validation failures
are attributed and counted. SSH OSC remains one-way: successful tty write is not desktop
receipt or broker acceptance. The query proves what desktop received, not that a remote
plugin emitted a frame that never arrived. Remote filter drops and complete transport
loss cannot be reconstructed from silence. No retry daemon or second observer was added.

### Renderer ownership audit

No ordinary workspace switch removes terminal membership. `selectWorkspace` and
residency changes preserve terminal IDs; WorkspaceHost cold unmount changes presentation,
not ownership. Page selection and minimizing preserve membership. Shell hydration for
an already-live workspace preserves its terminal collection. Terminal close kills main
before removing renderer membership. The unused production `clearTerminals` action is
not a demonstrated switch path.

A regression exercises four workspace selections, cold/warm residency, minimize/restore,
page selection, duplicate restored-shell hydration, equal-revision hydration and the next
native revision through the app-level bridge/store. It retains live attention throughout.
Thus the suspected same-revision local retirement race was **not reproduced** by these
paths; retirement and authoritative PTY-exit/stale-snapshot protections are unchanged.
This deterministic store test does not prove mounted Electron switching or IPC delivery.

### Verification and remaining work

Tests cover real generated child-process hook/socket/broker transactions (no model), large
Claude-style payloads, oversized/malformed/truncated/incomplete intake, no-event diagnostics,
poison recovery and serialized concurrency. Launch-path regressions cover normal and
resumed native preparation, user conflicts, optional registration failure, disabled and
unsupported local sources, SSH preparation/failure and cleanup. Broker tests cover
observation, rejected identity/envelopes, diagnostic-only non-authority, duplicate verdicts
and proven directory loss/recovery. Renderer tests cover capability precedence, safe
query gating, revision lag, acknowledged idle, retirement and restored workspace hydration.

An initial broad test run had outdated result assertions and one 5 s real-repository
integration timeout. Assertions were updated to require the capability contract; the
integration passed on isolated rerun without weakening its timeout or checks.
Final `npm run validate` passed: branding, lint, typecheck, Fallow regression check,
security audit, build and all **367 test files / 7,563 tests**. Security retained only the
repository's documented dev-only `GHSA-ch52-4w7c-c8xp` exception. No timeout or assertion
failed in the final full run.

No inference calls or paid native runs were used. Checkpoint 3 remains:

1. Verify installed version contracts and repeated native turns across the inventoried
   harnesses, using free/inexpensive models. Prioritize Claude batch/human waits, OMP stop
   continuation, Hermes SSH interruptions/local unsupported capability, Pi replacement,
   Codex compaction, OpenCode abort/error and Antigravity outcomes.
2. Exercise local and SSH native emission separately from resource preparation; record
   unavailable/conflicting hooks without modifying user-owned configuration. Consider
   typed remote acquisition reasons only if needed by native evidence.
3. Run the real Electron four-workspace/background/hidden-pane/restoration matrix and
   capture gated diagnostics at loss/recovery. Distinguish publication, renderer receipt,
   acknowledged idle and acquisition failure. Owner local smoke remains necessary where
   this environment cannot exercise installed harness hooks or native Electron behavior.
4. Review unbounded upstream payload events and remote one-way delivery limitations with
   that evidence before considering any additional observer or fallback detector.

Stop at the committed/pushed checkpoint for owner review; no PR or merge.
