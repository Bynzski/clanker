# Clanker agent attention — independent architecture assessment

Baseline: `fix/152-pi-attention-follow-up` @ `7d17343` (identical to `main` @ `f2f40a0` in `src/`; the branch adds only tests, docs and a Pi TUI smoke script).
Method: source reading of every stage; the attention test suites (292 passing, the SSH suite needs the Electron binary); the repo's own Pi TUI native smoke against real Pi 1.1.0 with a loopback model fixture (passes); Pi 1.1.0 source inspection; Claude Code 2.1.296 binary inspection (hook schemas only); two new experiments against the compiled broker, observer and renderer selector (scripts and run instructions in [`experiments/`](experiments/README.md)). No paid inference was used, and nothing in the repository was changed.

---

## 1. Bottom line

1. **"Working → nothing" is mostly by design, not a fault.** For a pane the user is looking at, a completed turn is acknowledged the moment it arrives and the icon disappears (`terminalSessionBridge.ts:49`, `agentAttentionStore.ts:74`). Switching to a background workspace acknowledges it the same way (`terminalSessionBridge.ts:62-70`). Idle, unknown, acknowledged-done and interrupted all render identically: as nothing. The user cannot tell a healthy finished agent from a broken integration. This alone explains a large share of the field reports, including the apparent link to workspace switching.
2. **"…and never resumes" has a confirmed structural cause.** The broker binds each terminal to one native root session and rejects every event from any other session (`agentAttentionBroker.ts:635`). Only an explicit `session_ended` for the old root releases the binding. The design has no recovery path. Any session change without that exact event leaves the terminal blind for the life of the PTY. This is **natively confirmed for Codex 0.162 `/new`** (the repo's own TUI smoke asserts it). It holds in code for OpenCode's new-session flow, and it follows from a single lost boundary delivery for Pi.
3. **Claude, Codex and Antigravity can never show "Finished".** Every normal turn ends in `provisional` ("Stop observed · outcome unknown"). That state also refuses annotation handoff after every turn, and it cancels every Codex after-turn checkout move.
4. **Clanker has no trustworthy source of truth for the end-to-end chain.** Three independent state machines must agree: the provider adapter, the broker and the renderer's seen-watermarks. They exchange edge-triggered events with no resynchronization, so one lost or rejected edge is never repaired. The provider adapter ignores the broker's verdict, so the adapter and the broker can disagree indefinitely.
5. The subsystem is over-engineered for what it delivers: about 3.6k lines of source, about 6k lines of tests and about 2.7k lines of docs. The complexity sits in the wrong places. Identity strictness and delivery bookkeeping are elaborate, while recovery, state visibility and the "Finished" state are missing.

---

## 2. Current architecture: event flow and state ownership

```
 HARNESS PROCESS (in PTY)                         ELECTRON MAIN                                 RENDERER
 ─────────────────────────                        ─────────────                                 ────────
 Pi / OMP / OpenCode / AGY                        AgentAttentionBroker (agentAttentionBroker.ts)
   in-process plugin           ──emit()──┐        Registration per terminal (token):
   STATE #1: epoch, open,                │ TCP      rootSessionId   (strict lock)
   root, pending (module vars)           │ 127.0.0.1 activeTurnId, retiredTurns[32]
                                         │ 2 KiB,    status: unverified|idle|starting|
 Claude / Codex                          │ ACK       running|provisional|failed
   native hook -> new `node` proc        │ verdict   pending[] (+resolutionUnknown)
   command.mjs (attentionSources.ts)     ├───────►   lastCompletion / lastOutcome
   lock dir + STATE #2 file              │           signal health, location (+provenance)
   (.clanker-state-<hash>.json)          │           revision (monotonic, floors LRU 1024)
   + poison marker                       │                │
   interpreter.mjs (per provider)  ──────┘                │ onChange(full snapshot | tombstone)
                                                          ▼
 SSH: same code, observer writes                  main.ts:147 webContents.send ─────────► terminalSessionBridge.ts
   OSC 777 to /dev/tty (O_NONBLOCK),              (dropped if window unavailable;          applyChange(change, isForeground)
   no ACK ─► PTY stream ─► createRemote-          hydrate on renderer start)                agentAttentionStore.ts
   AttentionFilter (main) ─► receiveRemote                                                    STATE #3: snapshot, revision floor,
                                                                                             seen{completion,request} watermarks
 Wrapper (local POSIX): harness exits ─►                                                     deriveAttention() ─► icon | null
   `command.mjs --ended` ─► agent_exited ─► broker.release() (tombstone)                      (TerminalPane, Rail, Navigator,
 PTY exit / kill / retire ─► launch attachments dispose ─► broker.release()                   workspace badge, navigation)
 Renderer: terminal exit or membership loss ─► store.retire()
```

**Owners.** Main's broker owns the canonical lifecycle. The provider adapters own the native-to-canonical mapping, plus their *own* private lifecycle state (#1 and #2). The renderer owns acknowledgement, which decides whether "Done" is visible at all.

**What can invalidate state:**

- `release()` from PTY exit, `agent_exited`, retirement or failed launch (`attentionLaunchStep.ts:56`, `terminalIpc.ts:582,591`, `main.ts:174,609`).
- `session_ended`, `session_replaced` and `markLifecycleLost` (`main.ts:528`).
- Renderer `retire()` on terminal exit or on loss of workspace membership.
- Foreground and visibility acknowledgement.

**Can components disagree?** Yes, permanently. The Pi extension's `emit()` result is discarded, so an extension that believes it is reporting turn 3 of session S2 never learns that the broker rejects all of S2. The hook bridge's state file is reset by different rules from the broker's registration. The renderer can hold a revision the broker never sees.

---

## 3. Findings (ranked)

Severity reflects user impact. Confidence: **Confirmed** means shown by code plus an executed experiment or a native run. **Code-confirmed** means deterministic from the source. **Plausible** means a mechanism exists but the trigger is unproven.

| # | Sev | Confidence | Finding |
|---|---|---|---|
| F1 | Critical | **Confirmed** (Codex native, repo smoke) / Code-confirmed (OpenCode) / Confirmed-if-lost (Pi) | **Permanent root lockout.** `apply()` rejects any event whose `sessionId` differs from `rootSessionId` (`agentAttentionBroker.ts:635`). Only `session_ended` for the old root clears it (`:650`). `session_started` cannot rebind (`:640`). Codex 0.162 TUI `/new` emits `SessionStart source=startup` with no `SessionEnd` (asserted by `scripts/codex-attention-tui-smoke.cjs`). OpenCode emits `session_ended` only on `session.deleted` (`opencode/attention.ts` `classify`), so a new session in the same TUI is rejected. Pi re-imports the extension per session (`moduleCache:false`, Pi `loader.js:478`), so one lost `session_shutdown` delivery for `/new`, `/resume` or `/fork` locks the terminal out. Experiment B2–B4: every later turn returns `rejected-mismatch`. The background UI keeps showing the stale state; the foreground shows only a small "degraded" badge. Tests assert this as correct (`agentAttentionBroker.test.ts:192` "root stays bound"). |
| F2 | High | **Confirmed** (code + B6) | **Done is invisible for the focused pane and vanishes on switch.** Foreground changes are acknowledged on arrival (`terminalSessionBridge.ts:49` → `merge(..., foreground)`). Becoming visible acknowledges (`:62-70`, `:79-85`). `deriveAttention` shows `turn_complete` only while unseen (`agentAttentionPresentation.ts:178-181`). Unverified, idle, acknowledged and interrupted all return `null`. This is the most common way a user sees "spinner → nothing", and it is why the problem *appears* tied to workspace switching. |
| F3 | High | Code-confirmed | **Claude, Codex and Antigravity have no completion state.** `Stop` maps to `turn_provisional` (`claude/attention.ts:80-85`, `codex/attention.ts:111-118`, `agy/attentionPlugin.ts:47-51`), and nothing emits `turn_completed` for a root turn. Consequences: (a) the "Stop observed · outcome unknown" alert appears after every turn; (b) `canHandoff` is false (`agentAttentionBroker.ts:401-404`), so annotation handoff is refused after every turn (`terminalIpc.ts:521-524`); (c) every Codex `after-turn` checkout move is cancelled (`isolatedCheckoutService.ts:243-246`). History: before `f9806df` Stop was a completion; between `f9806df` and `e17e1d4` turns stayed Running forever; since `e17e1d4` they end provisional. |
| F4 | High | **Confirmed** (B1; reproduced natively in the Pi TUI by `74c84df`) | **No resynchronization: one lost edge persists until the next edge.** A lost settle leaves Running until the next prompt (B8). A lost start blanks that turn (B7). A lost Pi `session_ended` on `/reload` silences the next *N* turns (N = old epoch, up to 32): the new module instance reuses turn IDs "1", "2", … that are still in `retiredTurns` and returns `ignored-stale` (B1, 5 turns ignored). Edge-triggered events with provider-owned counters and no state echo make every loss sticky. |
| F5 | Medium | **Confirmed** (Experiment A) | **Delivery depends on Electron main's event-loop latency.** The observer has a 500 ms total deadline and the server has a 1 s socket timeout (`attentionSources.ts:39`, `agentAttentionBroker.ts:188`). Measured with an out-of-process hook: a main stall of 0–300 ms delivers. **700 ms**: the event is applied but the hook sees failure, which poisons the bridge. **1500 ms**: the event is **lost**, because the timer destroys the socket before the data is read. No production evidence yet shows such stalls. |
| F6 | Medium | Code-confirmed | **Claude interrupts are unrepresentable.** Claude has no interrupt hook, so after Esc the pane shows Running until the next prompt (documented in the adapter). Any lost Stop has the same effect. |
| F7 | Medium | Plausible | **SSH frames can be lost or corrupted silently.** `O_NONBLOCK` `writeSync` to `/dev/tty` (`remoteAttentionTransport.ts:52-53`) throws `EAGAIN` when the remote tty buffer is full, which drops the event. A partial write leaves an unterminated frame, and the filter (`:23-35`) can then swallow the *next* valid frame. There is no ACK, so neither failure is visible. |
| F8 | Medium | Code-confirmed | **"Unknown" is not a displayed state.** `unverified` renders nothing (`agentAttentionPresentation.ts:169-185`), so the requirement "report unknown" is unmet. Only signal-health warnings (degraded/lost/unavailable) are visible, and only as a 10 px badge. |
| F9 | Low | Plausible | Pi runs extension handlers serially and awaited (Pi `runner.js:813-839`). A hung handler in a user extension delays or blocks Clanker's handler. Pi's own errors are isolated. |
| F10 | Low | Code-confirmed | Stale-ready handoff: after F1 lockout, `handoffState` can still read `ready` from the frozen snapshot, so a message can be pasted into an agent that is actually busy. |
| F11 | Low | Code-confirmed | Dead complexity: `receiveFallback`/`attentionAuthority.ts` has no producer ("Nothing in production produces this yet"). The poison marker affects only `input_resolved`. The verdict taxonomy is used mainly for diagnostics. |
| F12 | Medium | Code-confirmed (from `74c84df`, re-verified) | **Acknowledgement ignores OS-window focus.** `isForeground` (`terminalSessionBridge.ts:41-47`) checks the active workspace, terminal and page, but never whether the Clanker window has focus. A completion or request in the active pane of a minimized or unfocused window is marked seen immediately, so the user never sees it. |
| F13 | Medium | Plausible (from `74c84df`, code re-read) | **The OpenCode plugin's event queue can stall permanently.** Events are serialized through one promise chain (`opencode/attention.ts` `queue = queue.then(...)`). `isRoot` awaits `client.session.get` with no timeout. One hung metadata lookup blocks every later event for that terminal, and nothing reports it. |
| F14 | Low | Code-confirmed, rarely reachable (from `74c84df`, re-verified) | **Location acceptance is coupled to lifecycle acceptance.** An unresolvable `cwd` rejects the whole event (`agentAttentionBroker.ts:492-495`), including a turn start or settle. Reachability is low: the resolver only rejects non-absolute, oversized or control-character paths (`agentLocation.ts` `canonicalAgentLocation`), and the observer already drops oversized and control-character `cwd` values (`attentionSources.ts:18`). The coupling should still go, because location is descriptive. |

**Not found (bounded):** no code path ties broker state to workspace switching. Main never sees the active workspace; the renderer's workspace logic affects only acknowledgement (F2) and `retire` on actual membership loss. I did not reproduce renderer-side membership flapping, and the prior Electron matrix also did not observe it.

---

## 4. "Working → nothing, never resumes": which mechanisms produce exactly that

| Path | Shows | Resumes? |
|---|---|---|
| Foreground or just-switched pane completes (F2) | nothing | yes, next turn shows Running. The user perceives "it stopped" if the next turn's spinner is brief or missed |
| Codex `/new`, OpenCode new session (F1) | foreground: degraded badge or nothing; background: stale ✓ | **never** (until the PTY exits) |
| Pi `/new`, `/resume` or `/fork` with lost `session_shutdown` delivery (F1 + F5) | same | **never** |
| Pi `/reload` with lost shutdown (F4) | nothing for N turns | after N turns |
| Lost start (F4, F5) | nothing for that turn | next turn |
| Claude fork, or any provider session change without a paired end | same as F1 | never (Claude fork `SessionEnd` emission is unverified) |
| `agent_exited` or `release()` while the harness is alive | nothing; all events `rejected-auth` | never. I found no path that triggers this while alive; listed for the instrumentation plan |

---

## 5. Harness matrix

| Harness | Authoritative native signals | Clanker today | Shared vs specific problems |
|---|---|---|---|
| **Pi 1.1.0** | `agent_start`; `agent_settled` (always emitted in `_runAgentPrompt` finally, `agent-session.js:1380-1413`); `ui_prompt_start/end`; `session_shutdown` → `session_start` (old runner first, then a fresh module) | Correct mapping; native smoke passes (10 turns, reload, new, resume, fork, wait, fail, abort) | Native contract is sound. Field failures come from shared F1, F2 and F4 (epoch reuse after re-import) and F5 |
| **OMP** | `agent_start`; `agent_end` with `willContinue=false` | Completes; provisional if no assistant message | Same epoch and lockout pattern as Pi (`omp/attention.ts:21-24`) |
| **OpenCode** | `session.status` busy/idle, `permission.*`, `question.*` | Completes | New session in the same TUI → F1 permanent lockout |
| **Claude 2.1.296** | `UserPromptSubmit` (`prompt_id` is process-global and "absent until the first user input"), `Stop` (candidate), `StopFailure`, `PermissionRequest`/`PostToolBatch`, `SessionEnd` (reasons: clear, resume, logout, prompt_input_exit, other) | Never Done (F3); stuck Running after Esc (F6) | Stop is Claude's documented "finished responding" signal. Clanker treats it as unknowable because *another* Stop hook might continue the turn |
| **Codex 0.162** | `UserPromptSubmit`, `Stop` (candidate), `Interrupt`, `SessionStart`/`SessionEnd`, permission hooks | Never Done (F3); `/new` → permanent lockout (F1, natively confirmed) | Hooks need user trust review; unreviewed hooks emit nothing, which looks identical to "idle" (F8) |
| **Antigravity** | `Stop` with `fullyIdle` | Never Done (F3) | — |
| **Hermes** | SSH only (`pre/post_llm_call`) | Local: unsupported, no indicator | Must render Unknown/unsupported, not nothing |
| **SSH (any)** | Same as local | One-way OSC, no ACK | F7 adds silent loss |
| **Generic terminal** | None | None | Correctly no inference; should show nothing, which is fine because no agent is claimed |

---

## 6. Why extensive passing tests have not established reliability

1. **They verify the model against itself.** `attentionProviderLifecycle.test.ts` (74 cases) feeds *hand-written* "native" payloads through the real interpreters and broker, with `emit` replaced by an in-memory recorder that always returns `true`. Transport loss, timing and real emission order are absent by construction.
2. **They encode the defect as the specification.** F1's lockout is asserted as correct behavior (`agentAttentionBroker.test.ts:192` and the `rejected-mismatch` expectations). The Codex TUI smoke *passes by asserting the permanent degradation*. A green suite therefore means "the strictness works", not "the user sees the right state".
3. **Native smokes use idealized conditions.** A loopback model answers instantly. Pi runs with `--no-extensions` and `retry: false, compaction: false` (`native-attention-smoke.cjs:41`). There is one terminal, a bare broker with no Electron main load (so F5 cannot appear), no renderer and no focus handling. They cover the happy boundaries, not *a lost* boundary.
4. **Nothing tests the user-visible outcome.** No test asserts "after a turn ends, the focused pane shows Finished", so F2 and F3 pass silently. Presentation tests assert the current precedence rules, which are themselves the problem.
5. **Unit coverage is per-component; failure is compositional.** Every failure in §4 needs two components to disagree, for example the Pi module re-import together with the broker's `retiredTurns`. Each is tested alone.

---

## 7. Is there a trustworthy source of truth?

No single one exists today. Authority is split three ways and the copies are not reconciled. What is **actually authoritative**:

- **Agent alive or gone:** PTY and harness process exit (the wrapper `--ended`, `pty.onExit`). Fully trustworthy.
- **Turn state:** the harness's *own* runtime. For in-process plugins (Pi, OMP, OpenCode, AGY) the plugin can read it directly (`open`, epoch, pending dialog, session ID); that state is the truth and the broker should mirror it. For hook providers (Claude, Codex) the truth is the ordered hook stream itself, and `Stop` is the provider's own end-of-response statement.
- **Needs input:** Pi `ui_prompt_*`, OpenCode `permission/question.*`, Claude `PermissionRequest` and `AskUserQuestion`, Codex `PermissionRequest`. These are authoritative at start and approximate at resolution.
- **Not authoritative:** session-ID continuity across terminals (irrelevant: the token already proves the terminal), turn-ID uniqueness across plugin instances (Clanker fabricates these IDs), renderer focus, and screen output.

The source of truth should be **"latest authenticated provider state for this terminal"**, held in main, with the terminal token as identity, and nothing more.

---

## 8. Proposed minimal architecture

**Principle:** level-triggered, terminal-scoped and last-writer-wins, with Unknown as a first-class state.

```
provider adapter ──(state report: {session, turn, phase, request?, seq})──► main AttentionTable[terminalId]
     ▲ any native event re-sends the FULL current state                         │  phase ∈ working | needs_input | finished | unknown
     │                                                                          │  + since, lastSignalAt, sourceHealth
PTY exit ───────────────────────────────────────────────────────────────────────► delete row (tombstone revision)
                                                                                ▼
                                                                renderer: mirror + per-row "seen" flag (highlight only)
```

1. **Identity = terminal token, plus a declared session model per provider.** Keep root/child scope (the provider decides). Replace the blanket session lockout with a capability:
   - *Single foreground session per process* (Pi, OMP, Claude TUI, Codex TUI). A root report for a different session supersedes the old one when it is a session or turn *start*. Non-start reports from a non-current session are dropped as late. This fixes `/new`, `/resume`, `/fork` and `/clear`, plus lost boundaries, uniformly. Ordering per terminal is already serialized (in-process plugins, and the hook lock).
   - *Multi-session server* (OpenCode). A new parentless session is **not** a replacement: one server can run several root sessions, so blanket supersede would be wrong (point taken from `74c84df`). Supersede only on an explicit selected-session signal. Without one, report Unknown with the reason "another session selected", never a frozen old state.
2. **State reports, not edges.** Each emission carries the adapter's complete current view, plus a per-instance nonce and a sequence number. The broker adopts the newest. A lost report is healed by the next one, so F4 disappears and epoch collisions cannot happen (turn IDs become `nonce:epoch`).
3. **Four phases**, mapped per provider:
   - Pi/OMP/OpenCode: settle → `finished`.
   - Claude/Codex/AGY: `Stop` → `finished`, reopened to `working` by any same-turn activity. Degrade to "Stopped (may continue)" *only* when Clanker detects the user has other Stop hooks configured, a fact it can read from settings.
   - Claude Esc (no hook): stays `working`, but the indicator carries "last signal Xs ago". That is factual staleness, not inference.
   - Not attached, unsupported, after a session end without a start, or directory gone → `unknown`, shown explicitly.
4. **Presentation:** `finished` persists (muted) until the next turn starts. "Unseen" is only an extra highlight and badge count. Handoff is allowed in `finished` and `unknown`-after-finished.
5. **Transport:** keep loopback TCP locally, but process whatever arrives (raise the server timeout, never destroy before reading; client deadline about 2 s). ACKs are kept for diagnostics only. Delete the poison marker. Keep the per-terminal hook lock (it provides ordering). SSH: retry `EAGAIN` briefly; only ever write a whole frame.
6. **Remove:** fallback arbitration (no producer), the `provisional`/`resolutionUnknown`/`lastCompletion` vs `lastOutcome` revision interplay, `session_continued`/`session_replaced` (subsumed by supersede), and location provenance from the attention channel (move checkout-location observation to its own small table so attention bugs cannot break checkout safety and vice versa).

Harness adapters remain necessary and small: one state-report mapping per provider, and, for Claude/Codex, the existing permission correlation.

---

## 9. Reproduction and instrumentation strategy

**Instrument first (always on, bounded, no content):**

- A per-terminal ring buffer in main (about 64 entries): `{t, nativeEvent, semantic, sessionHash8, turn, verdict, revisionBefore→after, status}`, plus counters for received, rejected-mismatch and ignored-stale. This mostly exists behind `CLANKER_DEBUG_ATTENTION`; make it always on and add **"Copy attention trace"** on the terminal context menu.
- Add the renderer's cached revision and seen-watermarks to the same trace, so IPC or renderer loss shows up as main revision ≠ renderer revision.
- Add a main event-loop lag monitor (`perf_hooks.monitorEventLoopDelay`), recording max lag per minute in the trace (correlates with F5).
- Add an adapter-side journal: a bounded per-terminal file in the resources dir listing every native event and its emit verdict. This separates "never fired" from "fired, not delivered" from "delivered, rejected".

**Classify each field report from one trace:**

- Counters frozen: the native event never fired, or was never delivered (check the journal).
- `rejected-mismatch` rising: F1.
- `ignored-stale` rising after a reload: F4.
- `rejected-auth`: the registration was released.
- Main revision > renderer revision: IPC or renderer problem.
- Status `idle` with completion seen: F2. Not a fault.

**Reproductions (no paid inference except the last):**

1. Codex TUI `/new`: the existing `npm run smoke:attention:codex-tui` already reproduces F1.
2. OpenCode TUI `/new` with the loopback fixture: expect permanent `rejected-mismatch`.
3. Pi TUI `/new` and `/reload` with a test-only broker hook that stalls more than 1 s or drops `session_ended`: reproduces F1/F4 natively (B1/B2 already reproduce them deterministically).
4. Electron: a focused Pi pane completes, then switch workspaces. Record the icon (F2).
5. Owner-only, minimal paid run: Claude TUI turn → Esc → wait; Claude fork; Claude with user Stop hooks.

---

## 10. Recommended correction sequence (smallest viable first)

1. **Presentation truth (renderer only, low risk):** keep `finished` visible until the next turn, render `unknown` explicitly, and render Stop-provisional as "Finished (unconfirmed)" rather than an alert. Allow handoff after Stop. This immediately removes the largest perceived failure (F2, F3, F8) and makes real failures distinguishable.
2. **Always-on trace plus a copy action** (§9). Ship it before any further behavior change so the next field report is diagnosable.
3. **Broker: start-supersedes instead of root lockout, for single-session providers** (F1, §8.1). About 15 lines in `apply()` plus a provider capability flag. OpenCode instead gets an explicit "selected session" signal, or Unknown. Rewrite the tests that assert lockout as correct.
4. **Namespace epoch turn IDs with a per-instance nonce** in the Pi, OMP, OpenCode and AGY adapters (F4 reload collision). About one line each.
5. **Transport timing** (F5): server processes regardless of client timeout; client deadline about 2 s.
6. **Level-triggered state reports** (§8.2), then delete the poison marker, fallback arbitration and redundant facts.
7. **Claude/Codex Stop as Finished** with a detected-Stop-hook degradation (§8.3). Then re-enable after-turn moves for Codex.

Steps 1–4 are small, independent and individually revertible.

---

## 11. Tradeoffs, limits and where Clanker must say "unknown"

- **Start-supersedes** accepts that a *different* root session in the same terminal is the new foreground agent. The token already binds reports to this PTY's process tree. The remaining risk is a nested agent that both inherits the env *and* loads Clanker's hooks; launch configuration is not inherited by nested CLIs, so this risk is small. Today's alternative is guaranteed blindness.
- **Stop as Finished** can briefly show Finished while a user-configured Stop hook continues the turn without tool calls. Detecting user Stop hooks narrows this. When they exist, show "Stopped (may continue)".
- **Must report Unknown, never invent:**
  - Claude after Esc (no interrupt hook).
  - Codex hooks not yet trusted.
  - Any harness with attention disabled, unsupported (local Hermes) or conflicting with user config.
  - After a session end with no new start.
  - After the agent's directory is removed (Codex).
  - SSH when frames are known to be dropped.

  Staleness ("last signal 12 min ago") is a fact Clanker may show. It must never be converted into Working or Finished.
- **Not verified here:**
  - Claude interactive behavior (paid).
  - Real SSH hosts.
  - Codex/OpenCode beyond source and the repo's recorded runs.
  - Whether production Electron main actually stalls for more than 1 s.
  - Renderer membership flapping (no evidence found).

---

## 12. Cross-check with the independent assessment in `74c84df`

`docs/agent-attention-independent-assessment.md` (commit `74c84df`) was produced separately against the same baseline. I re-read the code behind each of its claims rather than taking them on trust.

**Independent agreement (raises confidence):**
- Pi `/reload` with a lost `session_ended` suppresses later turns as `ignored-stale`. My F4/B1 showed this deterministically; they **reproduced it in the real Pi TUI** by withholding that one delivery, and recovery depended on the retained epoch count. Confidence in F4 is now *Confirmed native*.
- A lost Pi shutdown before a new session leads to permanent rejection (my F1/B2). Codex `/new` rejection: both of us confirmed it with the installed TUI smoke.
- Foreground acknowledgement makes "Working → nothing" the expected success path; Unknown is absent (F2, F8).
- Claude/Codex never prove completion; handoff and Codex after-turn moves are blocked (F3).
- Tests validate the implementation's own assumptions; native smokes run with retry, compaction and extensions disabled (§6).
- No mechanism in main ties broker state to workspace switching. Renderer membership retirement is an authority leak, but neither of us saw it fire in practice.

**Adopted from `74c84df`:**
- F12 (OS-window focus), F13 (OpenCode queue stall), F14 (location/lifecycle coupling), added to §3.
- The §8.1 identity rule is narrowed. Blanket start-supersede is wrong for OpenCode's multi-session server.
- Generation fencing for in-process adapters. Namespacing epoch turn IDs (§10 step 4) prevents collisions. The broker should *also* track the newest observer instance per terminal and drop reports from an older instance, so a late in-flight report from a disposed Pi module cannot regress state.
- Test gaps not in my §6:
  - The Pi/OpenCode "late settle cannot close the next turn" tests replay an already-numbered wire event. They never inject a late *native* (unnumbered) callback, which would pick up the adapter's current epoch.
  - `npm run validate` does not run any native or Electron smoke.
  - The Electron smoke drives a fake Pi that emits canonical events, so it bypasses the real adapters.
- Instrumentation details for §9:
  - Record silent adapter returns (events deliberately not emitted), not just broker rejections.
  - Registration counters are lost on `release()`; keep the last trace after retirement.
  - Querying main and then the renderer is not an atomic snapshot; compare revisions, not values.
- Version drift risk: they report the existing OpenCode smoke failing with HTTP 405 on POST `/session` with OpenCode 2.0.26, before any lifecycle step. I did not verify this. If it holds, the plugin's `client.session.get` contract also needs re-verification on 2.x, and installed-version checks belong in the capability contract.

**Remaining difference: how to present a candidate Stop (Claude, Codex, Antigravity).**
- `74c84df`: candidate Stop is **Unknown** ("stop observed; finality unverified"). Handoff and after-turn operations should be gated on a declared "can prove settlement" capability.
- This report (§8.3): show it as Finished unless the user has their own Stop hooks configured.

Both agree the current *alert* presentation and "Working" are wrong. The defensible middle is a calm, distinct **"Stopped"** state that claims neither success nor ongoing work, with the finality caveat in its tooltip. Its handoff policy is the owner's decision:
- Allowing handoff matches what the user can already do by typing into the terminal.
- Refusing it after every turn makes the feature unusable for Claude/Codex.

Keep conservative cancellation for *automatic* after-turn checkout moves, where an unproven finish has real consequences.

**What this report adds to theirs:**
- A measured main-loop stall threshold. 700 ms: applied but reported failed. 1500 ms: lost (F5, Experiment A); their fault matrix lists this as untested.
- The SSH partial-write mechanism that can swallow the following valid frame (F7).
- Stale-ready handoff after a lockout (F10).
- Quantified size of the subsystem (§1).

---

## Appendix: experiments

All experiments ran against `dist/` built from `7d17343` (`npm run build:shared && npm run build:main`); the working tree stayed clean.

- `experiments/a_transport_stall.cjs`: the real `OBSERVER` in a child process against the real broker, with a main-loop stall injected on connection. Result: 0/300 ms → `accepted-changed`, applied. 700 ms → hook sees `false` but the broker applied it. 1500 ms → hook sees `false` and the broker did **not** apply it.
- `experiments/b_sequences.cjs`: exact provider emission sequences through the real broker and the bundled renderer `deriveAttention`. B1 Pi reload with lost end: 5 subsequent turns `ignored-stale`. B2 Pi `/new` with lost end, B3 Codex `/new`, B4 OpenCode new session: all later turns `rejected-mismatch`. B5 Claude/Codex turn end: `provisional`. B6 foreground completion: renders nothing. B7/B8: lost start or lost settle.
- `npm run smoke:attention:pi-tui` with Pi 1.1.0 (`@earendil-works/pi-coding-agent`, installed in scratch with scripts disabled): passes.
- Attention vitest suites: 292 passed. `sshAgentAttention.test.ts` did not run (Electron binary not installed).
