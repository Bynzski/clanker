# Dev-build diagnostics review: `0.12.0-dev.f7602b0` (#186, #152)

Read-only review of the owner's running Linux AppImage, its persisted attention diagnostics, its systemd user journal and the native harness stores on the same machine, followed by fixes for every stage that could be reproduced. Times are UTC. Terminals are aliased; no session/turn identity, credential, prompt, response or checkout path is reproduced here.

## Sources and coverage

| Source | Window | Volume | Notes |
| --- | --- | --- | --- |
| `attention.1.jsonl` + `attention.jsonl` (rotated once since the first #186 pass) | Oct 13 21:57 → Oct 15 02:52 | 6,599 records: 3,478 main-loop samples, 1,959 broker, 868 renderer receipts, 170 publications, 99 transport rejections, 18 anomalies, 12 renderer-state, 3 startup | Mode 0700/0600; no malformed lines; startup records for the dev build plus two short `0.12.0` runs sharing the profile. |
| systemd user journal for the running dev process | same | 5,242 entries | Main stdout/stderr including per-decision `[clanker-grid] attention` lines (these carry the harness, which broker JSONL records did not). |
| Native stores, read locally only | same | Pi session JSONL, OpenCode SQLite + log, one Claude transcript, Antigravity CLI logs | Used only to correlate native activity with Clanker's records. Nothing was uploaded. |

`-dev` builds default `CLANKER_DEBUG_ATTENTION=1`; `--debug`/`--enable-logging` were not set. The first #186 pass covered Oct 13 21:57 → Oct 14 18:20; this pass adds about 8.5 hours and the native-store correlation.

## Findings

| # | Observation | Earliest failing stage | Classification | Fixed by |
| --- | --- | --- | --- | --- |
| 1 | Pi terminals B (Oct 14 13:13:00) and C (18:58:45) retired with `release-without-settlement` while Running; Pi kept working after both | Wrapper `--ended` sent by a **test run inside the agent** with the agent's inherited credentials | **Confirmed root cause, reproduced** | Launcher-PID guard on the wrapper; credentials dropped from main's and the test runner's environment |
| 2 | Every OpenCode launch (7 terminals) registered and never sent a native event | OpenCode 2.0.26 runs plugins in a shared background service that never loads Clanker's plugin or sees the launch credentials | **Confirmed root cause, reproduced** | OpenCode 2.x adapter: `--standalone` + additive `OPENCODE_CONFIG` + 2.x plugin contract, verified against the real binary |
| 3 | 381 `can-go-back` + 381 `can-go-forward` exceptions, Oct 14 12:03:35–12:06:50 (`reading 'navigationHistory'` of undefined) | Browser tab entry kept after its `WebContents` was destroyed; renderer polls every 500 ms | Confirmed defect; trigger (what destroyed the WebContents) not captured | Entry pruned on `destroyed`; navigation handlers use only a live `WebContents` |
| 4 | 4 `git-stop-polling` errors, "Workspace identity is no longer registered" | Workspace close unregisters (and stops the poller) before the renderer's own stop request | Confirmed benign race producing error noise | Late stop for an unregistered workspace is a quiet no-op |
| 5 | 99 `rejected-auth` envelopes, 84+ previously unattributable | Main intake | Partly explained (finding 1, late shutdown hooks); 52 in Oct 14 01:05–01:37 remain unattributed | Every rejection now records `attribution` (`retired-credential` / `harness-mismatch` / `unknown-credential`), terminal, harness and native event name |
| 6 | Antigravity terminal A: five `PreInvocation → turn_started` rejected as `rejected-mismatch` (Oct 14 00:10–00:24) | Broker identity validation | Confirmed symptom; native cause inconclusive | Not changed (no proven native boundary); carried to follow-up |
| 7 | 170/170 expected publications had matching push receipts (max 41 ms) | — | Evidence against renderer delivery loss in this window | — |

### 1. Pi "stuck" turns were the agent retiring itself

Terminal C, a Pi agent working in this repository:

- 18:51:32 registered, `session_start` accepted. 18:55:41 `agent_start` accepted → Running.
- 18:58:01 Pi's own tool started `npm run validate` (Pi session log).
- 18:58:45 broker: `release-without-settlement` → `released` → `agent_exited` (no native event name; the wrapper's `--ended` path).
- 18:59:37–19:00:10 Pi continued; its turn ended at 19:00:10.589 (Pi session log). Clanker logged `rejected-auth` at 19:00:10: the real `agent_settled`, sent with the now-retired credential.

Terminal B, a Pi agent in a sibling worktree: `agent_start` 13:06:20, `npm run validate` 13:12:26, retired 13:13:00, Pi continued (session log through later turns). The owner reported this agent as stuck and not closed.

Reproduction: running `vitest run tests/main` with fake `CLANKER_ATTENTION_PORT/TOKEN/HARNESS/COMMAND` in the environment invoked the attention command once, as `--ended`, from the PTY integration test (`tests/main/integration/terminalPTY.test.ts`), which runs the real harness wrapper. Inside a Clanker agent terminal those variables are the agent's own, so the test sent a genuine `agent_exited` and the broker retired the live agent. Every later event (and the renderer indicator) was gone until a new launch.

The two Pi terminals reported in the `b554732` journal (retired while Running) fit the same pattern, but their native logs were not re-checked; that attribution is plausible, not verified.

Fix: main adds `CLANKER_ATTENTION_LAUNCHER_PID` (its own PID) to the launch credentials, and the wrapper emits `agent_exited` only when `$PPID` equals it. The PTY's wrapper is forked directly by main; a wrapper run by an agent's tools has another parent. Main also drops inherited `CLANKER_ATTENTION_*` / `CLANKER_REMOTE_ATTENTION_*` / `CLANKER_MCP_*` at startup (a dev build started from an agent terminal must not act as that agent), and the Vitest setup does the same. Regression: `wrapper never retires an agent it was not launched for`; `drops inherited attention and bridge credentials in place`.

### 2. OpenCode 2.x never loaded Clanker's plugin

- Seven registered terminals never produced any native event or diagnostic. Three line up with OpenCode sessions created about a minute after registration (22:54→22:55, 23:13→23:15, 13:25→13:35).
- Installed OpenCode is `@opencode/cli` 2.0.26. Its log shows each TUI as a client of `opencode serve --service`, a background service started on Oct 12 21:54 that loads plugins from its own (unrelated) environment; the TUI's `OPENCODE_CONFIG_DIR` and attention credentials never reach it.
- 2.x also replaced the plugin contract (`export default { id, setup(ctx) }`, `ctx.event.subscribe()` yielding `{ type, data }`, `session.execution.*`, `permission.*`, `form.*`), so the 1.x plugin would not have worked even if loaded.
- With `OPENCODE_CONFIG_DIR` on a private 2.x server, the user's global config directory was replaced, not merged; `OPENCODE_CONFIG` pointing at `{ "plugins": ["<dir>"] }` is additive.

Fix: Clanker probes the `opencode` major version (cached by real path + mtime). On 2.x it launches with `--standalone` and `OPENCODE_CONFIG`, and ships a 2.x plugin with the same parentage, epoch and request rules as 1.x. A user-chosen `--server` or their own `OPENCODE_CONFIG` declines attention. Verified end to end with the real 2.0.26 binary, a private server, a local OpenAI-compatible stub and the real broker: two consecutive turns (distinct turn IDs) went Running → Idle and a provider error went Running → Failed. Permission/form mapping is covered by schema reading and fixtures, not a live run. 1.x launches are unchanged; SSH OpenCode still uses the 1.x contract.

### 3. Browser `navigationHistory` storm

The rate (about 2 per second for each handler) matches the renderer's 500 ms `canGoBack`/`canGoForward` poll against the active tab. Accessing `view.webContents` yielded `undefined`, so the tab's `WebContents` had been destroyed while main kept the entry. The capture does not show what destroyed it (a page-initiated close or a crash are candidates). Main now forgets an entry whose `WebContents` emits `destroyed`, so the next activation recreates the tab, and navigation/refresh/stop handlers act only on a live `WebContents`. Regression: `a tab whose WebContents was destroyed is forgotten and recreated on activation`.

### 5. Authentication rejections

Attributable in this window: rejections within a second of a terminal's retirement (late shutdown hooks; 11 recorded as `late-retired-delivery`) and the Pi self-retirement in finding 1. The 52 rejections between 01:05 and 01:37 arrived in pairs a few seconds apart while one Claude agent in another project was running tests; that agent's own hooks were accepted at the same time, and no other agent transcript was active. Clanker's Antigravity usage probe (`agy -p=/usage`, every 3 minutes) does not line up with the bursts. Their sender is not established. The new `attribution` field (see `docs/attention-field-diagnostics.md` → Late credentials) will name the retired terminal or harness mismatch on the next build.

### 6. Antigravity identity mismatch

As in the first pass: after two accepted turns, five later `PreInvocation` events carried a different conversation and were rejected; the terminal showed `signal_degraded` until it exited. No native evidence establishes a new conversation in the same terminal, so root rebinding stays disallowed. Antigravity is not a current focus harness.

### Other signals

- Renderer: 170 expected publications, 170 matching push receipts, no `renderer-receipt-missing` or merge disagreement. `acknowledged` and `selector-none` suppression are expected projection outcomes.
- Main loop: maximum event-loop delay sample 275 ms; no sustained stall.
- Journal: Wayland color-management warnings, one `fs.Stats` deprecation warning, one loopback `ERR_CONNECTION_REFUSED` preview load. No `[diag] child process gone`, crash or watcher ASAR error.
- Claude: 19 accepted turn starts, 17 provisional Stops (expected contract), no rejections. Pi: 26 accepted starts, 22 completions, 1 failure; apart from the two self-retirements, every started turn settled or was still running at the end of the capture.

## Disposition

- The owner-reported Pi failure and the absent OpenCode attention are root-caused, fixed and covered by regressions; the OpenCode fix is verified against the real 2.0.26 binary.
- The Browser storm and `git-stop-polling` noise are fixed at the failing stage.
- Unattributed auth rejections and the Antigravity identity mismatch are not explained by the available evidence; the next dev build records attribution for the former.
- Follow-up evidence collection for the next dev build is tracked in a new issue.
