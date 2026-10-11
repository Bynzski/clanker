# Agent attention final hardening (#152)

Baseline: `fix/152-pi-attention-follow-up` at `972e760`. This is a narrow safety correction, not a replacement of the broker or renderer architecture. **Draft-review status: safe automatic Codex `/new` recovery remains unresolved.**

## Shared-session ownership: what is established

The baseline broker permits a different root's `session_started` or `turn_started` to supersede an idle/provisionally stopped shared root. A deterministic broker regression demonstrates A completing → B starting → B running → A's next prompt rejected. This proves the broker failure mechanism; **the exact background sequence has not been reproduced in native Codex**.

Source inspection of installed Codex 0.162.1's matching [`rust-v0.162.1` tag](https://github.com/openai/codex/tree/rust-v0.162.1) establishes why a heuristic is not justified:

- [`hooks/src/schema.rs`](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/hooks/src/schema.rs), `SessionStartCommandInput` and `UserPromptSubmitCommandInput`: neither payload exposes the TUI-selected thread. `SessionStart.source` is a lifecycle reason (startup/resume/etc.), not selected-session ownership. Explicit spawned children have separate identity fields, but not all internal sessions do.
- [`core/src/hook_runtime.rs`](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/hook_runtime.rs), `run_pending_session_start_hooks`: non-SubAgent sources, including Internal, take the root SessionStart path. `inspect_pending_input` runs UserPromptSubmit for `TurnInput::UserInput` without a selected-TUI-session check. A hook's name alone is not proof of a human foreground submission.
- [`protocol/src/protocol.rs`](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/protocol/src/protocol.rs) distinguishes CLI/Exec/Internal/SubAgent sources internally. Reading a transcript's creation origin would still not prove current TUI selection. No transcript scanning or cwd/token/time/last-event ownership heuristic was added.
- OpenCode's existing plugin proves parentage from native session metadata, not which parentless session the terminal presents. Claude's current adapter likewise emits root/session/prompt identity, not a distinct selected-session transition. Pi/OMP observe one foreground runtime in-process and retain their `process` capability.

Correction: implicit supersession is restricted to `sessionModel: process`. Shared providers retain the bound root until a native end, explicit replacement naming that root, or continuation lineage is accepted. A malformed start without a turn ID cannot supersede even a process-scoped root. Child rejection, seeded-resume protection, stale turns, location provenance, and revisioned boundary publication remain intact. Rejected auxiliary reports do not poison broker ownership: subsequent bound-root prompts and Stops still work. Prepared integrations with identity rejection also refuse handoff from cached readiness until accepted turn evidence restores signal health.

### Deliberate limitation, not a passing claim

Codex 0.162.1 `/new` emits `SessionStart.source=startup` without `SessionEnd`. Its next prompt is indistinguishable, through these hooks, from an unrelated root prompt. Conservative rejection therefore prevents automatic tracking of that new conversation. Native TUI smoke remains **unchanged**, still requires recovery, and **fails** at `Turn after /new was not tracked`. This is an implementation/contract limitation, not an environmental failure or speculative native takeover claim.

The signal reports `degraded / identity-rejected`; launch a fresh Clanker agent or resume the desired conversation through Clanker to establish a new validated registration. The existing explicit Codex `source=clear` replacement remains covered by adapter fixtures, not a new native-selection claim. Shared-provider lost-boundary recovery and correction of an incorrectly bound first root cannot be guaranteed without provider-proven identity. Repeated root reports are not a recovery protocol. Pi/OMP lost-boundary recovery remains supported and tested.

This tradeoff means the requested `/new` acceptance criterion is **not met**. A safe selected-session contract or owner-approved product limitation is needed before calling the PR merge-ready; no generalized state layer or output parsing was introduced to conceal the gap.

## Stop presentation versus programmatic submission

Claude's existing loopback native fixture demonstrates Running → provisional Stop → real Read execution in the **same** prompt → another Stop. Another Stop hook requests continuation before the original turn is settled. Stop is therefore not authoritative readiness for an external prompt.

- Finished/unread presentation remains unchanged (`runtime.stopRevision`); same-turn activity restores Working, and a fresh approval restores Needs Input.
- `canHandoff` refuses provisional state. `markSubmitted` cannot retire that turn. The dialog disables Send and retains Copy; main rechecks readiness synchronously before its PTY write, including an already-pending dialog/message.
- Proven completion is still distinct (`lastCompletion`). Automatic after-turn checkout moves retain their existing conservative cancellation at provisional Stop. No checkout code changed.
- The existing explicit user-selected handoff to an unverified, non-active agent (including optional hooks disabled) remains available with its unverified notice. This is not an assertion of native completion/readiness.

## Regression coverage

- Broker: idle/provisional shared takeover rejection; correct root activity after rejected reports; seeded identity and explicit replacement; incorrect initial report requires proven recovery; stale starts/completions; malformed process start; no cached handoff after identity rejection; pending Stop handoff cannot retire correlation.
- Actual adapters: Codex startup rejection versus explicit clear, recovery on the bound conversation after a rejected auxiliary prompt, OpenCode parentless-background busy after idle, Pi missing outgoing boundary. Test registration now uses the provider's actual session model.
- IPC with real broker: pending annotation at Stop writes nothing; continued work and stale settlement still write nothing; a later proven completion permits exactly one submission.
- Renderer: provisional target disables Send and permits Copy. Existing focus, acknowledgement, workspace and revision tests remain.
- Native Claude smoke now asserts every candidate Stop refuses handoff, including its real continuation scenario. Pi TUI fixture optionally loses all three reload ends plus the `/new` end while retaining native start/settle and Running-publication assertions:
  `npm run smoke:attention:native -- pi-tui-lost-boundary`.
- Electron smoke retains the workspace/cold/minimize/page/exit/restart checks and strengthens Finished/readiness checks. The obsolete pre-baseline Stop-icon assertion is replaced with actual Finished semantics. Native focus assertions disable Playwright's always-focused-document emulation, then focus a disposable native window and restore the app; no mocked lifecycle/focus substitute is used. Cleanup retires **all** test-owned terminals (including ordinary shells) before close so the app's close guard cannot strand a native confirmation dialog. No app close-guard behavior changed.

## Verification

Environment: Linux, uid 1000 (`jay`), Node 26.11.1; Pi 1.1.0, Claude Code 2.1.296, Codex 0.162.1. All native models were disposable loopback fixtures, no paid inference or user profile mutation.

| Check | Result |
| --- | --- |
| `npm run validate` | Passed: branding, lint, typecheck, Fallow, security audit, build, **7,938 tests / 391 files**. No root-permission failures; run as the normal non-root user. |
| Focused lifecycle/transport/SSH/checkout/renderer tests | Passed (467 before the final extra cached-readiness regression; all covered again by full validation). |
| `npm run smoke:attention:native -- pi` | Passed: ten turns, new/resume/fork, UI wait, failure/interrupt. |
| `npm run smoke:attention:pi-tui` | Passed: ten turns, three `/reload`s, new/resume/fork, wait/failure/abort and subsequent turns/handoff. |
| `npm run smoke:attention:native -- pi-tui-lost-boundary` | Passed: **four deliberately discarded native ends**, including same-session reload and changed-session `/new`; subsequent turns still publish Running and complete. |
| `npm run smoke:attention:claude` | Passed: ten turns and native same-turn Read after a blocking Stop hook; no candidate Stop authorized handoff, no proven completion synthesized. StopFailure was not emitted within five seconds of the fixture authentication error. |
| `npm run smoke:attention:codex` | Passed: ten exec/resume turns, native root hooks. |
| `npm run smoke:attention:codex-tui` | **Failed at `/new` recovery**, intentionally retaining the baseline smoke's requirement. Earlier approvals, ten repeated turns and compaction passed before that failure. |
| `npm run smoke:attention:electron` (native X11 selected from `DISPLAY`) | Passed: real Electron/PTY/IPC/React; four-workspace cold switching, unread Finished while unfocused, selecting/focusing the agent acknowledges it, Stop handoff refused, same-turn continuation, minimize/pages, retirement, restart, current renderer revisions. |
| Explicit headless Electron focus run | Failed: `Window did not lose focus`, even with Playwright focus emulation disabled. Not reported as passing. Electron and node-pty do run here; unavailable headers are **not** this environment's blocker. |

Electron smoke selects X11 when `DISPLAY` exists, otherwise headless; `CLANKER_ATTENTION_SMOKE_OZONE_PLATFORM` overrides it. Native X11 uses the existing `XAUTHORITY` along with the display variables. Headless cannot certify native window focus and does not skip that assertion.

Unverified: naturally occurring Codex auxiliary takeover sequence; safe automatic shared-session selection without explicit identity; other harness versions, native Windows, live SSH hosts, owner extensions and paid-model behavior. Electron exercises explicit PTY lifecycle fixtures, not real harness integration inside the mounted app. The original field incident is not attributed to one universal cause.
