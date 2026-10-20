# Next dev-build review (#189)

Reviewed on 2026-10-19 (Eastern; the capture ends on Oct 20 UTC). This is a bounded review of retained local evidence and isolated native smokes, not a claim that every native workflow or either field incident has been resolved. Runtime code and lifecycle/checkout authority are unchanged.

## Evidence and build coverage

The three attention rotations were copied to a mode-0700 temporary directory before review, with mode-0600 files. The corresponding systemd user journal was read locally. Raw records, journal text, minidumps, prompts, credentials, session/turn/terminal identities and checkout paths are not included in this repository or PR.

| Source | Coverage |
| --- | --- |
| Attention rotations | 2026-10-18 23:21:10.811 → 2026-10-20 00:32:31.077 UTC; 10,580 records, no malformed lines. Rotation truncates the beginning of some registrations. |
| Record distribution | 5,744 broker; 3,010 main-loop samples; 1,406 renderer receipts; 285 publications; 43 checkout observations; 42 anomalies; 37 renderer-state; eight startup; five transport rejections. |
| User journal | Same bounded window, 15,137 entries / 25,464,307 bytes, spanning multiple processes. This is not one uninterrupted app run. |
| Version evidence | Startup markers include `0.12.0-dev.aae8ba8`, `0.12.0-dev.5160ce3` and an unqualified `0.12.0`. The identified dev SHAs predate #211. The unqualified version supplies no source SHA, so this capture cannot certify field verification of #211. |
| Fresh checks | Built from `5774c3c` plus this PR's smoke/documentation changes. Installed Pi 1.3.0, Claude Code 2.1.303, OpenCode 2.0.26; Electron 41.10.7, Linux x64. Native model fixtures use loopback responses and isolated homes, without paid inference or user configuration. |

## Findings and disposition

| Question from #189 | Result | Evidence and limit |
| --- | --- | --- |
| Unattributed authentication rejections | **Attribution verified for this capture** | All five `rejected-auth` records are `retired-credential`: four Pi `session_shutdown`, one Claude `SessionEnd`. They arrived 1, 2, 2, 5 and 161 ms after retirement. There are no unknown-credential or harness-mismatch auth rejections in these files. Timing/events are consistent with teardown; they do not establish the cause of the historical 52 rejections. |
| Pi self-retirement and Running state | **Not reproduced within this capture/native test** | No Pi `release-without-settlement` in the retained records. All four such records belong to Codex registrations, with close/shutdown nearby; these are not evidence of the previous Pi self-retirement defect. Fresh native Pi TUI smoke passes ten consecutive turns, three `/reload` boundaries, `/new`, resume/fork through native extension APIs, confirmation wait/resolution, API failure, Esc interruption and subsequent turn/handoff. Picker interaction and arbitrary user extensions are not exercised. |
| Renderer delivery/presentation | **No recorded disagreement** | No `renderer-receipt-missing`, `renderer-merge-disagreement` or `renderer-running-indicator-none` anomaly; 630 Running receipts select Running. The 42 anomalies consist of 33 lifecycle mismatches, five late-retired deliveries and four releases while active. Receipts establish selector/instrumentation observations, not rendered pixels or universal delivery. |
| Lifecycle mismatches | **Retained as rejected evidence** | 40 `rejected-mismatch` broker records across six terminals: seven SessionStart, 18 UserPromptSubmit, 15 Stop. Journal correlation identifies all six registrations as Codex. These native event names alone do not identify a different harness or prove an invalid root replacement should be accepted. No relaxation of identity/session checks is justified; native session-boundary intent would be needed for a separate reproduction. |
| Checkout recovery — #192 | **Matching mechanism verified in native fixture; original incident remains open** | All 43 relationship records agree with the registered launch checkout: launch registered, observed context launch, resolution agrees, resolved inside launch. Provenance is current 40 times, last-reported twice, unavailable once; registration agreement does not override unavailable provenance. Fresh Claude/Bash/Git smoke reproduces an external tool cwd becoming unregistered and verifies correction by root Stop, while Stop remains provisional. Fresh Electron presentation smoke covers main/two worktrees, focus, historical/unregistered refusal and explicit main launch. This is not the original main-checkout field sequence, latest-build field acceptance, or native Claude worktree attachment/restart verification. |
| Renderer crash — #196 | **Recovery/capture verified; root cause unresolved** | No main-renderer-gone, child-process-gone, destroyed-browser or navigationHistory storm marker in the captured journal, and no renderer-state `gone`. The new repeatable native smoke deliberately crashes only its disposable renderer, accepts the real native Reload dialog, verifies one reload restores the shell, and checks a local MDMP dump (157,088 bytes in the successful run). This is X11 with GPU disabled, not a reproduction/symbolization of the Wayland field segfault. |
| OpenCode 2.x bridge with attention off | **Native startup verified** | Installed 2.0.26 real-TUI private-server smoke authenticates/discovers Clanker MCP tools, preserves fixture config and verifies credential revocation, with zero model requests. This is startup only. |
| OpenCode 2.x native turns, permission/form, Esc, `/new`, resume | **No field coverage; deferred native validation** | No OpenCode registration/native event is attributable in this retained capture. The existing `smoke:attention:opencode` is a 1.x server/API fixture and is not evidence of 2.x TUI coverage. A dedicated 2.x real-TUI/loopback fixture remains necessary; #212's compatibility guards must not be described as implementation of unsupported native features. |
| OpenCode 2.x over SSH | **Deferred compatibility work** | Not exercised. The current remote adapter uses the 1.x plugin contract. A target-bound remote version probe and verified adapter/native smoke need a separate scoped change if remote 2.x is required. Local startup success proves nothing about SSH. |
| Claude live permission/question/compaction/interrupt | **Partial native verification; interactive coverage deferred** | Fresh stream-json native smoke verifies ten turns and an independent Stop hook continuing with a real Read in the same turn. Stop stays provisional, records no completion and refuses handoff. An injected authentication failure does not emit StopFailure within five seconds, so it is not labelled Done. Real TUI permission waits, AskUserQuestion, compaction and interrupt are not verified by that test or this capture. |
| Destroyed Browser trigger | **Not reproduced within the captured window** | No destroyed-WebContents marker or navigationHistory exception storm. Existing destruction/recreation regression coverage remains; the page action that caused the historical destruction is unknown. |
| Antigravity identity mismatch | **No attributable recurrence in this capture** | No new attributable Antigravity evidence. No diagnosis is inferred from the Codex-registered mismatches above. |

No new product defect with a demonstrated root cause was established by this pass. In particular, late shutdown frames must remain rejected, and a location observation must not grant checkout authority.

## Repeatable verification

- `npm run build` — built the production renderer/main used by the smokes.
- `npm run smoke:attention:pi-tui` — installed Pi, real PTY/native events, loopback model.
- `npm run smoke:attention:claude` — installed Claude, provisional Stop/continuation, loopback model; stream-json, not TUI.
- `npm run smoke:attention:claude-checkout` — installed Claude, real Bash/Git and root Stop cwd correction.
- `npm run smoke:checkout-presentation` — built Electron, real Git/PTY/IPC/React and authenticated explicit location fixture; four fixture PTYs exited and Electron closed cleanly.
- `npm run smoke:attention:electron` — built Electron/real PTY fixture; foreground/background/minimized/page/focus transitions, restart/reload, hydration deadlines and persisted diagnostic privacy assertions passed. It is not a native provider test.
- `npm run smoke:bridge:opencode` — installed OpenCode 2.x real TUI, attention disabled, no prompt/model call.
- `npm run smoke:crash-recovery` — new repeatable native dialog/minidump smoke; requires Linux/X11 and xdotool. It is separate from headless validation and retains only failed private fixtures.

The PR records the final `npm run validate` result (branding, lint, typecheck, Fallow, security audit, build and full Vitest suite). Native smokes supplement that gate rather than replacing it.

## Remaining ownership

Keep **#192** open for latest-build field recovery/attachment/focus/restart confirmation, and **#196** open for a private usable recurrence dump or reproducible workload plus exact-version symbolization. Neither issue is closed by this review or by a deliberately injected crash.

The unexercised OpenCode 2.x and Claude interactive cases above are explicit follow-up validation boundaries. Do not silently mark them passed, introduce remote compatibility work under a capture review, or keep repeating already successful smokes as a substitute for those missing native cases. #189's field review can be assessed independently of future native feature implementation, with these outstanding coverage limits visible to the reviewer.
