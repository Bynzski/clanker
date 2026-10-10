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

## Checkpoint 3 — native contracts and Electron evidence (2026-10-09)

This checkpoint verifies acquisition and provider semantics; it does **not** establish that
all providers can prove successful foreground settlement. The intermittent field failure
has not been reproduced. There is still one main broker, provider-owned interpretation,
strict root/turn correlation and no output/silence detector. Renderer retirement is unchanged.

### Confirmed defects and corrections

- Presentation hid confirmed Needs Input or Running behind a later signal-health warning.
  Lifecycle facts now retain their icon and precedence, with a separate small warning icon,
  tooltip and accessible description. With no displayable lifecycle fact, unavailable or
  degraded health remains visible. Completion acknowledgement is unchanged. Broker-backed
  regressions cover rejected events after input/work, accepted-boundary recovery, unavailable
  before activity and acknowledged completion.
- Antigravity's persistent guard retained only a 64 KiB stdin prefix **before** the shared
  8 MiB parser. A large legitimate JSON payload disappeared, and valid JSON followed by
  excessive whitespace could be accepted as a misleading truncated transition. The guard
  now streams stdin with backpressure into the bounded shared intake. The total guard
  deadline includes input that never ends. Oversized stdout fails open as a whole, rather
  than accepting its prefix. Persistent ownership checks and neutral response/exit 0 remain.
  Tests execute the installed guard with a ~1.4 MiB response, oversized valid-prefix input,
  recovery, unterminated stdin, oversized stdout, missing files, crashes and hangs.
- OMP `session_stop` is an awaited **control** callback, not a final notification. Another
  extension can block/continue it. Its post-maintenance `agent_end` notification carries
  `willContinue`; only the final main-agent notification settles the epoch. Error/abort
  assistant outcomes no longer announce Done; a final notification without an assistant
  outcome reports uncertainty rather than inventing success or interruption. Explicit `session_switch` ends the known old
  root before a new root can bind; an unrelated session cannot close the current epoch.
- Pi/OMP extension bookkeeping could switch its private root after an idle turn, or clear
  it on an unrelated shutdown, while the broker correctly rejected that session. A later
  valid turn could then be suppressed locally. Deterministic regressions reproduce this
  sequence; the bound root now survives until its own native shutdown/explicit switch.
  This does not prove installed CLIs emit those unrelated callbacks.
- OpenCode's `session.error` previously disappeared, and the ensuing idle announced Done
  for failures/aborts. The provider now retains a per-turn candidate outcome in
  its existing epoch map, settles it only at native idle, and clears it on native resumed
  busy/successful assistant completion. Context-overflow errors can precede successful
  compaction, so an error alone is deliberately not a final lifecycle boundary.
- Hermes's `post_llm_call` is an output callback, not reliable outcome evidence. The SSH
  plugin now uses `on_session_end` and its explicit `completed`/`failed`/`interrupted` flags,
  tied to an already-known turn and proven root/compression lineage. Interrupted wins over
  failed, which wins over completed; absent evidence produces no outcome. The exact prior
  owned plugin artifact is accepted for upgrades; user plugins/configuration are not replaced.
- Claude stale StopFailure no longer overwrites a newer prompt's wait bookkeeping.
  Claude/Codex unrelated SessionEnd no longer clears the current wait; private correlation
  includes session identity. Generated command/socket regressions cover subsequent resolution.
- Claude `AskUserQuestion` can request input without a `PermissionRequest`. Its native
  `PreToolUse` now opens the existing turn-level wait; the matching prompt's `PostToolBatch`
  resolves it. Other tools do not infer an input wait.
- Claude, Codex and Antigravity Stop handlers run **before** other handlers can request
  continuation. No verified post-decision native success hook was found in their supported
  contracts. Candidate Stop now reports `settlement-unverified` and does **not** clear a
  confirmed wait or announce Done. Running/Needs Input remains visible with a health warning;
  a fresh native start recovers observed health. Agy starts a fresh epoch after a provisional
  Stop, preserving stale-resolution rejection. Explicit Agy error/max-step exhaustion is
  failed; undocumented cancellation labels are not guessed. This is a deliberate capability
  limitation: normal successful turns in these three providers currently have no Done alert.
- Codex `--remote` app-server TUI clients do not forward launch-owned hook configuration or
  environment. Both local and SSH preparation now reject that mode instead of claiming an
  attached integration. User hook/profile conflicts still fail closed.

### Evidence levels and economical execution

Versions were read from installed binaries again: the inventory below is unchanged from
Checkpoint 2. Native smoke scripts use **installed upstream CLIs**, normal Clanker launch
attachment preparation, generated hooks/extensions, the real local socket/ACK transport and
broker. Disposable HOME/profile/session directories isolate all fixture settings; no user
credentials/configuration are read into the child. Model API traffic goes to loopback
protocol fixtures returning tiny responses: **zero external model inference or paid calls**.
These are actual native hook emissions, not hand-emitted lifecycle events, but do not prove
real-model compaction, complex tools, permission policy or interactive TUI behavior.

The Electron script instead uses an explicitly-labelled lifecycle fixture executable over
real PTYs. It proves app ownership/IPC/rendering, not upstream Pi semantics. Deterministic
unit fixtures exercise provider scripts directly and are not counted as native runs.

| Provider / installed version | Actual native signals and repeated turns | Session boundaries | Local / SSH coverage | Correction / remaining limitation |
| --- | --- | --- | --- | --- |
| Claude 2.1.296 | Installed stream-json CLI: 10 consecutive foreground prompts, native `UserPromptSubmit`/`Stop`; a separate fixture Stop hook actually forces continuation (11 successful responses for 10 prompts). No premature Done. A fixture authentication error retried and emitted no `StopFailure` within a bounded 5 s probe; it stayed Running without Done. | Native replacement, manual compaction, cancellation and interactive approval not exercised. Deterministic fixtures cover stale prompts, child scope, SessionEnd, StopFailure, batch waits and AskUserQuestion. | Native local; SSH generated hook/OSC regressions only. | Candidate Stop explicitly unverified; AskUserQuestion intake fixed. StopFailure is supported/documented but not natively proven by this failure probe. Successful settlement and interruption remain acquisition gaps. |
| Codex 0.162.0 | Installed `exec/resume`: 10 sequential foreground invocations of the same conversation. Native SessionStart/UserPromptSubmit/Stop/SessionEnd arrive on every trusted invocation. Final SessionEnd leaves unverified, never a fabricated completion. Fresh unreviewed hooks emitted **zero** events. | Native resume across exec invocations passed; not 10 turns in one interactive TUI. Permission, interrupt, compact and TUI replacement remain owner smoke. | Native local exec; SSH parser/OSC regressions only. | Stop provisional; unsupported app-server client refused. Explicit runtime trust bypass used **only in disposable fixture**, never production. Production requires `/hooks` review; prepared does not mean observed. |
| Pi 1.1.0 | Installed RPC process: 10 consecutive turns, native `agent_start` → `agent_settled`; native `ui_prompt_start/end` via a fixture `ctx.ui.confirm` produces Needs Input → Running → idle. API failure and abort produce failed/interrupted, not Done. | Native `new_session`, `switch_session` resume and fork, each followed by a successful foreground turn; native `session_shutdown`/`session_start` recover binding. | Native local; shared extension SSH isolation regressions only. | Existing native settlement verified; unrelated-root bookkeeping hardened. UI confirm is a proven human wait, **not** proof of a permission-specific approval. Built-in non-extension dialogs and model compaction remain unverified. |
| OMP 18.4.10 | Installed RPC process: 10 turns, native main `agent_start/agent_end`. Separate `session_stop` fixture blocks once; broker has no completion when the continuation API request begins. Final completion follows post-maintenance notification. Native API failure/abort classify correctly. | Native new session and resume via session switch, with subsequent turns passed. Fork not exercised. | Native local; shared extension SSH fixtures only. | Stop-control race fixed; main/child and `willContinue` fixtures pass. No native human-input subscription. Real background-agent/task-drain scenarios remain source/fixture coverage. |
| OpenCode 1.18.34 | Installed native server/plugin: 10 consecutive busy/idle foreground turns. Native bash permission ask/reply and question ask/reply each produce Needs Input → Running → idle. Actual API failure → failed, actual abort → interrupted. | Unrelated root rejected; original root recovers on next turn; native deletion ends the old root, then replacement root tracks its next turn. | Native local server, not interactive TUI; SSH plugin isolation fixtures only. | Error/abort outcome fixed. Approval/question APIs verified; interactive UI, nested subagents and context-overflow recovery remain deterministic/source coverage. |
| Antigravity 1.3.2 | Installed version/help and official hook contract inspected. No native inference run: no isolated loopback model-provider route or assured free authenticated configuration established. Guard execution is real Node child-process testing, **not** native Antigravity emission. | No native session-end signal established; unrelated conversations stay rejected. Session replacement remains an explicit gap. | Local persistent-guard and SSH command/OSC fixtures, no native session. | Intake truncation fixed; explicit failures distinguished; candidate success unverified. Ask tools and multi-turn guard dispatch tested with fixtures. Cancellation labels remain undocumented/unverified. |
| Hermes 0.21.5+5751.g4097709 | Installed CLI/source inspected at upstream 4097709b. `turn_finalizer.py` invokes output hooks before outcome settlement, then `on_session_end` with final flags. Plugin Python execution fixtures cover outcomes/approvals/child turns/compression lineage. No native Hermes model session. | Compression continuation and finalize proven only by source + deterministic fixtures. | Local remains **unsupported**; SSH plugin generated/executed in fixtures, no SSH host. | Final outcome hook corrected. Finalizer omits on_session_end when persistence is disabled; that mode cannot prove settlement. CLI plugin enable persists configuration; no safe local per-launch enable contract established. No local support manufactured. |

Source evidence (versions pinned where available):

- [Claude command hooks](https://code.claude.com/docs/en/hooks): Stop continuation,
  stop_hook_active, PreToolUse/AskUserQuestion, batch and failure hooks.
- [Codex 0.162.0 hook runtime](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/core/src/hook_runtime.rs)
  and [hook discovery/trust](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/hooks/src/engine/discovery.rs):
  candidate Stop aggregation, hook review, and embedded-versus-remote client behavior.
- [OMP 18.4.10 session maintenance](https://github.com/can1357/oh-my-pi/blob/v18.4.10/packages/coding-agent/src/session/agent-session.ts):
  emitSessionStopEvent → control decisions → emitAgentEndNotification/willContinue.
- Pi's installed 1.1.0 `dist/core/agent-session.js`, session runtime and RPC implementation:
  settled notification, UI brackets and session shutdown/start around replacement.
- [OpenCode 1.18.34 processor](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/session/processor.ts)
  and [plugin events](https://opencode.ai/docs/plugins/): error/abort before idle and recoverable compaction.
- [Antigravity hooks](https://antigravity.google/docs/hooks): PreInvocation, ask tools,
  fullyIdle, terminationReason and Stop continuation. No cancellation reason is assumed.
- [Hermes finalizer at inspected revision](https://github.com/NousResearch/hermes-agent/blob/4097709b/agent/turn_finalizer.py):
  output hooks versus final outcome flags; installed CLI plugin-enable/configuration handling.

### Subscriptions versus available control hooks

The implemented subscriptions are listed in `docs/harness-integration.md`'s provider table
and each provider's generated source. Important intentionally unused native signals:

- Codex's inspected 0.162.0 enum also exposes PreCompact, PostCompact and SubagentStart.
  None is final foreground settlement; they cannot substitute for a post-Stop decision.
- Claude's documented compaction and notification hooks are not turn-settlement or
  request-resolution evidence. StopFailure/SessionEnd are subscribed; user interruption has
  no established native hook here. PreToolUse is now subscribed specifically for AskUserQuestion.
- Pi's agent_end and session_before_switch/fork/compact are lower-level/control notifications.
  They are not agent_settled or successful replacement. The adapter observes start/shutdown,
  message_end, session_compact_failed and UI brackets instead.
- OMP's session_stop is control, agent_end is the post-maintenance notification. The adapter
  subscribes start/end/start-session/switch/shutdown; no approval hook is manufactured.
- OpenCode delivers its event bus to the plugin. Only parentage/session metadata, busy/idle,
  question/permission pairs, error/assistant outcome and native deletion are interpreted.
- Agy registers PreInvocation, PostInvocation, ask-tool Pre/PostToolUse and Stop. PostInvocation
  is intentionally a no-event intake, not completion; other tools do not imply human input.
- Hermes subscribes pre_llm_call, on_session_end, approval pairs and on_session_finalize.
  post_llm_call and child stop notifications cannot prove a root outcome. No local observer is enabled.

### Real Electron matrix

`scripts/attention-electron-smoke.cjs` passed twice against the built Electron app with its
own profile, real main-process PTYs, preload IPC, app-level attention listener and mounted
React UI. It records only bounded lifecycle diagnostics; no screen scraping determines state.

| Scenario | Result / evidence |
| --- | --- |
| Two simultaneous workspaces; switch during Running | Passed; both terminal snapshots retain native revisions. |
| Background completion, then another turn | Passed; unseen completion then a newer Running revision. |
| Four workspaces, forcing cold unmount/remount | Passed; cold workspace's terminal remains owned, no local tombstone; remount displays current indicator. |
| Input while backgrounded, resolution and revisit | Passed; confirmed request/Running survive; indicator is mounted on return. |
| Minimize agent, another turn, restore agent | Passed; terminal stays tracked and restored pane uses current revision. |
| Hidden page, background completion and subsequent turn | Passed; page membership does not retire terminal. |
| Previously viewed workspace restored from cold residency | Passed; snapshot/hydration and renderer revision current. |
| Close terminal and genuine PTY exit | Passed; authoritative retirement/tombstones remain effective. |
| App restart / saved-workspace restoration | Not included in this live smoke; existing deterministic restoration/hydration tests remain. |

No real workspace transition reproduced a same-revision retirement defect. The first script
attempt incorrectly polled the deprecated empty buffer accessor; switching readiness to the
actual terminal-data IPC fixed the smoke itself. This was not an app attention failure.
Do not change renderer retirement or add workspace-dependent detection on this evidence.

### Reproduction, validation and owner smoke

After `npm run build`, optional native suites (require the listed installed harnesses):

```sh
node scripts/native-attention-smoke.cjs       # Pi and OMP; optional argument: pi or omp
node scripts/claude-attention-smoke.cjs
node scripts/codex-attention-smoke.cjs
node scripts/opencode-attention-smoke.cjs
node scripts/attention-electron-smoke.cjs     # desktop display and Playwright/Electron required
```

All successful final smoke results are lifecycle-only JSON summaries. Native CLI stdout and
raw prompts/responses are consumed locally and not logged. Fixed fixture settings and session
files are deleted with each fixture directory. Shared input remains limited to 8 MiB; native
batch/tool responses can exceed this bound and are diagnosed, never truncated into an event.
No fixture establishes that an arbitrarily large upstream event fits this bound.

No configured SSH test host was available. No native SSH session was run; one-way remote OSC
write success is still **not** broker acceptance. Existing remote credential stripping,
preparation/conflict/ownership, filtering, real generated script/PTY OSC and cleanup regressions
remain required. There is no daemon, callback endpoint or desktop credential forwarding.

Owner interactive smoke still needed:

1. Use `CLANKER_DEBUG_ATTENTION=1`; review Codex hooks via `/hooks` without replacing owned
   settings. Confirm observed receipt rather than inferring it from prepared capability.
2. Claude: real approval and AskUserQuestion (including parallel/large PostToolBatch), manual
   compact, interrupt, session replacement and Stop continuation. Candidate-stop warning is
   expected; successful Done is currently unsupported, not a claimed fixed lifecycle.
3. Codex interactive TUI: multiple prompts, permissions/denials, interrupt, compact and
   continue/new session; native Stop remains unverified even when the model finishes.
4. Pi/OMP: interactive replacements, real background tasks, OMP continuation extensions and
   non-extension waits. OpenCode: real questions/approval and child agents/compaction.
5. Antigravity: actual persistent plugin across ten turns, ask tools, errors/cancel and
   conversation replacement. Hermes: SSH finalizer outcome and compression/approval lifecycle.
6. Repeat the workspace matrix with real providers, then saved-workspace/app restart; capture
   existing terminal diagnostics if a state disappears. Supply an authorized SSH fixture target
   to verify native remote emission and desktop acceptance separately.

Validation also exposed a shared renderer-test cleanup race: Radix FocusScope deferred its
unmount event until after jsdom realm teardown, causing cross-realm Event errors in different
dialog test files. Shared cleanup now awaits one real zero-delay timer after unmount. It does
not suppress exceptions, drain arbitrary fake timers or change production UI. Unrestricted
worker parallelism also timed out the existing 5 s real-repository history integration; it
passed in isolation. Final validation limits workers to four without changing test timeouts.

Final verification passed: `VITEST_MAX_WORKERS=4 npm run validate` exited 0, including
branding, lint, typecheck, Fallow regression check, security audit, build and **367 test files /
7,581 tests**, with no unhandled errors. All five optional smoke commands exited 0 on the
final implementation: Pi/OMP native, Claude native, Codex exec/resume native, OpenCode native
(including approval and question tools), and real Electron. The native model fixtures made
zero external inference calls. Initial obsolete Stop-as-completion assertions were corrected
to test real interruption/fresh-boundary recovery; poison/stale protections were retained.
The final run retains the documented dev-only electron-builder security exception.

No PR/merge; stop for independent review. Remaining native gaps are explicit rather than
papered over with synthetic completion or a second observer.

## Checkpoint 4 — provisional settlement and approval resolution (2026-10-09)

This section supersedes Checkpoint 3's presentation of provisional Stop as ordinary Running/Needs Input. It does not claim reproduction of the original intermittent workspace-switch field failure.

### Confirmed defects and corrections

- Claude, Codex and Antigravity candidate Stops previously emitted only `settlement-unverified` diagnostics. The broker consequently kept claiming active execution or an actionable approval indefinitely. Their adapters now emit **correlated `turn_provisional`**. The broker validates root, session and live turn before setting canonical `runtime.status = provisional`. It retains turn identity and historical requests; requests gain `resolutionUnknown: true`. No completion, idle/Ready state, or successful outcome is invented. OMP's final notification without an assistant outcome also uses provisional settlement.
- The shared renderer projects **Stopped · outcome unverified** with a request-resolution explanation when applicable. Signal health remains separate. Provisional settlement is visible across pane mounting, acknowledgement and hydration, but is neither an actionable input alert nor a completion notification/navigation target. Matching resolution can retire request history; a new native turn/request restores confirmed evidence; failure/interruption/session end clears it normally. A stale Stop cannot affect a newer turn.
- **Installed Codex TUI confirmed an additional approval-correlation defect.** Its native Bash PreToolUse has `{command}`, while PermissionRequest adds `description` from the escalation justification. Hashing the complete input made accepted approvals unresolvable. The adapter now ignores only that documented Bash decoration, keeps exact command equality, and preserves the all-calls-done rule for identical parallel calls. Unknown extra input fields remain fail-closed. No command, justification, prompt or response is stored or logged.
- Continuation regression: after provisional Stop, Claude’s old pending boolean and Codex’s old denied/overflowed call cache could suppress a fresh human request. Claude now permits a newly observed request after Stop; Codex resets only its candidate-batch correlation cache, retaining broker request history. Old call results cannot clear a fresh request, including one with identical command text. Deterministic continuation tests cover both adapters.
- Native Codex hook denial produced **no PostToolUse**. Its pending request now becomes resolution-unknown on the correlated Stop instead of remaining actionable Needs Input. Cancellation/Escape and interruption/Ctrl-C emitted Interrupt, cleared the wait, and never produced Done. There is still no subscribed native approval-response event proving a denial immediately before a later Stop/Interrupt. Default command approval in this version offers Cancel rather than a continuing Decline option; the denial test therefore uses an explicitly owned fixture hook, not a claimed human denial.
- Provisional settlement blocks annotation handoff and `markSubmitted`. The handoff dialog and IPC failure explain the uncertainty and offer continuing/copying in the agent terminal. A checkout move awaiting completion is cancelled with a bounded existing notification; the source and checkout remain. A request made while already provisional is refused before checkout creation. Handoff is never granted from provisional evidence. Continue in the source terminal or launch a separate agent in the intended checkout. Closing and resuming from History restores tracking in the conversation’s attributed checkout; History does not offer arbitrary relocation. Moving the same conversation under uncertain settlement is not currently supported through this automatic workflow.
- The downstream audit found **session-end cancellation could leave a scheduled move stuck**: the handler returned on the now-null session id before processing the session-end outcome. A canonical session end/replacement now cancels the old-root move, so later requests can schedule again. No new root can execute the old request.
- Codex's versioned native `SessionStart.source=clear` contract can explicitly replace a root. The adapter names its prior stored root; the broker requires an exact previous-root match and root scope before clearing old turn/request authority. Ordinary startup/resume/fork never rebinds. This is source/fixture coverage, **not** verified emission from installed `/new` (see below).

### Native evidence and limitations

All installed versions were rechecked unchanged from Checkpoint 3. Native tests below use real installed CLIs and normal Clanker attachment preparation/socket delivery, with disposable homes/profiles and loopback protocol model fixtures. There is no paid inference, real account credential, user configuration mutation, terminal-output completion detector, or SSH daemon. Tiny protocol responses test upstream event emission, not model quality or behavior under a real service's latency.

| Provider / installed version | Checkpoint 4 native evidence | Settlement / approval result | Session / transport coverage and remaining work |
| --- | --- | --- | --- |
| Claude 2.1.296 | Stream-json CLI: ten turns; a separate native Stop hook requests continuation; a fixture authentication failure is also exercised | Stop is provisional, never Done. No later documented aggregate-success hook was found. PostToolBatch remains the turn-level resolution contract, including denied/parallel calls; AskUserQuestion uses PreToolUse. | Local print execution verified; TUI approvals, AskUserQuestion, cancellation, compaction and replacement remain owner smoke. Fixture 401 retries did not emit StopFailure within the bounded five-second observation. No SSH native execution. |
| Codex 0.162.0 | **Interactive TUI + real PTY**: accepted command approval, native hook denial, Escape cancellation, Ctrl-C interruption, two distinct parallel calls, two identical parallel calls, ten subsequent foreground turns, manual compaction and a subsequent prompt. Command execution markers prove accepted calls ran and denied/cancelled/interrupted calls did not. Separate exec/resume suite verifies ten resumed turns and hook trust gating. | Accepted approval emits exactly one correlated input resolution; denied hook emits none, Stop becomes provisional; Interrupt clears requests without Done. Stop still runs before aggregate continuation and cannot prove success. | **Actual `/new` gap confirmed:** emits SessionStart `source=startup`, without SessionEnd or a previous-root link. New root events are rejected and health visibly degrades; no arbitrary rebinding was added. Explicit source=clear replacement is source/fixture-only. Exec/resume SessionEnd verified; full interactive quit/resume remains owner smoke. All trusted runs bypass hook review only inside the disposable fixture; production trust was not bypassed. No SSH native execution. |
| Pi 1.1.0 | Ten foreground turns; real UI confirmation/resolution; error/abort; new session, resume and fork; next turns | agent_settled proves settlement; UI prompt end proves response. No stale prompt issue found in this controlled native matrix. | Local RPC verified; remote OSC remains deterministic coverage. |
| OMP 18.4.10 | Ten turns; Stop-control continuation; error/abort; session switch/new/resume | post-maintenance agent_end with willContinue false proves settlement when the final assistant outcome exists. Missing outcome is now provisional. No subscribed human-input hook is claimed. | Local RPC verified; UI waits/fork and native SSH remain gaps. |
| OpenCode 1.18.34 | Ten busy/idle turns; native approval and question/reply; failure/abort; rejected unrelated session, recovery and native deletion/replacement | Root idle with classified error/abort proves the appropriate outcome. Existing permission.replied/question.replied/question.rejected correlation is retained; rejection is source/fixture coverage, not newly claimed interactive denial. | Local native serve/plugin verified. Native SSH and broader TUI rejection remain owner smoke. |
| Antigravity 1.3.2 | Version, documented hook contract, deterministic interpreter and persistent guard tests (including large/oversized intake); no authenticated upstream inference session | Fully-idle Stop with explicit error/exhaustion proves failure. Success/unknown Stop remains provisional. Ask-tool PostToolUse resolves its known request; missing results become resolution-unknown at Stop. No success/cancellation outcome is manufactured. | Persistent guard forwarding is tested, but repeated upstream TUI plugin execution, asks, interruption and conversation replacement remain unverified. No proven isolated free model route was established; no paid run attempted. No SSH native execution. |
| Hermes 0.21.5+5751.g4097709 | Installed source inspection and existing deterministic Python plugin/OSC fixtures | Known-root on_session_end finalizer flags prove completion/failure/interruption when the hook runs. pre/post approval callbacks correlate responses; compression ancestry remains strict. Persist-disabled upstream execution skips finalizer hooks. | Local native attention remains unsupported. No safe per-launch local enable contract was established without user config changes. Actual SSH approval/compression/finalizer delivery remains unverified. |

Codex source evidence: tag `rust-v0.162.0`, `core/src/tools/handlers/unified_exec/exec_command.rs` (PreToolUse shape), `core/src/tools/sandboxing.rs` and `tools/approvals.rs` (permission description and decision handling), `tools/registry.rs` (successful-only PostToolUse), `hooks/src/events/session_start.rs` / `core/src/session/session.rs` (clear source), and `tui/src/approval_events.rs` (default command decisions). The installed TUI probe recorded only bounded enum source names: `startup`, `compact`, `startup` for initial start, compaction and `/new`. That disproves assuming `/new` emits the available `clear` contract. The broker correctly rejects it; tracking that replacement safely needs an upstream correlated boundary or a fresh Clanker launch. This is a real native limitation, not reproduction of the intermittent workspace-switch report.

Rechecked primary hook references: [Claude hooks](https://code.claude.com/docs/en/hooks), [Antigravity hooks](https://antigravity.google/docs/hooks). No documented post-aggregate success hook was established for their current Stop integrations. Claude PermissionDenied is an auto-mode decision hook, not a universal user-response callback; per-tool failure must not clear an unrelated parallel wait. Pi's UI bracketing and OpenCode/Hermes explicit response events remain provider-owned. No equivalent provider transition was added based on terminal output or timing.

No configured suitable SSH test target was available in this checkout/session. No unrelated remote host was changed or probed. Remote preparations, frame filtering, credential isolation, ordering, provider semantics and provisional delivery remain covered by deterministic SSH regressions only. One-way OSC writes still do not prove broker acceptance.

### Electron and deterministic verification

The built Electron application smoke uses real main PTYs, preload IPC and mounted React with an **explicit lifecycle fixture**, not an upstream provider. The two-workspace/background matrix and four-workspace cold unmount/remount matrix pass, including active switching, provisional Stop, provisional Stop after a wait, fresh turn recovery, minimized agents, hidden pages, background completion followed by work, restored panes, genuine PTY exit and terminal close. Renderer revisions remain current and live membership is not retired on a switch. No workspace ownership defect was reproduced.

Restart now tests four persisted workspaces in the same disposable profile, absence of old attention authority, and fresh launch/hydration/subsequent turns in a restored workspace. The first test attempt restarted before Chromium storage was flushed; explicitly flushing the fixture session before shutting down made persistence deterministic. This was a smoke-fixture correction, not a production restoration fix. Existing PTYs are not expected to survive app restart.

Focused regressions cover provisional Running/input states, request-resolution uncertainty, new turn/request recovery, later proven outcomes, interruption/session end, stale/rejected stop and replacement evidence, accepted approval decoration, denial without PostToolUse, parallel-call safety, renderer hydration/revision/acknowledgement, background aggregates/navigation, annotation refusal/explanation and checkout cancellation/retry. The persistent guard and SSH provider bridge assertions now expect canonical provisional events.

Vitest concurrency is now bounded to four workers **in the committed shared configuration**, inherited by local and CI main/renderer projects. Checkpoint 3's uncapped high-core real-Git timeout risk is therefore addressed at the default execution policy, rather than relying on a local environment override or raising every test timeout. Explicitly overriding the limit can still overload the host; that configuration is not the supported validation default.

Final verification (default configuration; no VITEST_MAX_WORKERS environment override):

- `npm run validate` **passed**, including branding, lint, typecheck, Fallow, security audit, build and all **367 files / 7,597 tests** (63.57 s final test phase). The preceding full default run passed 367 / 7,595 before the two continuation regressions were added; no uncaught test exception remained.
- `npm run smoke:attention:native` **passed** (Pi + OMP, ten turns each and the native cases above).
- `npm run smoke:attention:claude` **passed** (ten prompts, Stop continuation, provisional settlement; bounded StopFailure emission limitation reported).
- `npm run smoke:attention:codex` **passed** (ten exec/resume turns, unreviewed hooks produced zero receipts, trusted fixture hooks delivered SessionEnd).
- `npm run smoke:attention:codex-tui` **passed** its verified scenarios and its explicit fail-closed `/new` limitation assertion: accepted approval, native hook denial without PostToolUse, cancel, interrupt, distinct/identical parallel calls, ten subsequent turns, native compaction and next prompt; 40 local protocol requests in the final run. This pass does **not** mean `/new` tracking is supported.
- `npm run smoke:attention:opencode` **passed** (ten turns, approval/question, failure/abort and session boundaries; 21 local requests).
- `npm run smoke:attention:electron` **passed**, including four-workspace restart/restoration and the provisional presentation matrix. Lifecycle source remains the explicit PTY fixture.
- Focused Codex/OpenCode checkout tests **passed**, 57 tests, including provisional cancellation, native session-end retry and unrelated-session guard protection. SSH adapter/guard tests passed in the full suite; no native remote session was run.

No PR was opened or merge performed. The checkpoint is committed and pushed on the existing branch for owner review.

### Owner review and PR recommendation

This checkpoint is ready for independent review. **Do not treat it as unconditional PR readiness for all interactive harnesses.** In particular, installed Codex `/new` lacks the root-transition evidence required by the strict identity policy; owner testing cannot justify arbitrary rebinding. Review the explicit degraded presentation and decide whether the documented continue/new-agent workflow is acceptable pending an upstream boundary. Native Stop-only providers cannot support successful-completion notifications or after-turn checkout movement through their current hooks.

Owner-only smoke still needs real-account Claude TUI approval/AskUserQuestion/compaction/interruption/continuation; Codex native hook trust review, user denial surfaces where available and interactive resume; Antigravity persistent multi-turn plugin/asks/replacement; Hermes SSH finalizer/approval/compression; at least one authorized genuine SSH harness session. Repeat the Electron matrix against real agents and real model-service latency. Do not mistake protocol fixtures, deterministic payloads, guard tests or Electron lifecycle fixtures for that coverage.
