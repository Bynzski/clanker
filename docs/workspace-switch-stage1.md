# #176 Stage 1 — workspace switch measurements

Scope: diagnostics and narrow renderer subscriptions only. Activation sanitization,
three warm surfaces, resource owners, Git polling/generations, checkout authority,
Explorer refresh/concurrency and restoration are unchanged.

## Enable and inspect

- Development only: `CLANKER_SWITCH_DEBUG=1 npm run dev` (PowerShell: set the
  environment variable first). In renderer DevTools run
  `window.clankerSwitchDebug.enable()`; this remembers only the opt-in preference.
- `window.clankerSwitchDebug.clear()` clears events and starts a new IPC peak
  interval, preserving in-flight requests. Select a workspace, then inspect
  `window.clankerSwitchDebug.snapshot()`. `enable(false)` disables renderer events.
- Renderer console: `[workspace-residency]`. Main console: `[workspace-reads]`.
  Main/preload counters require both development mode and the environment opt-in;
  packaged apps strip the opt-in. Production renderer exposes no diagnostics.
- Automated local fixture (port 1420 must be free): `npm run build`, then
  `node scripts/workspace-switch-measure.cjs > /tmp/switch.json`
  (`npm run diagnose:workspace-switch` is the same runner).
  It starts Vite and real headless Electron, uses disposable HOME/profile/Git repos,
  launches two ordinary shell PTYs for checkout focus tests, stops those PTYs,
  and removes its fixture. No user's workspace, SSH configuration or credentials.

## Metric definitions and limits

- `switch_start`: inside successful explicit `selectWorkspace` changing the active ID, before sanitization
  and Zustand publication. Not a click timestamp, mount timestamp or startup trace.
  Warm/cold describes the target's **pre-selection runtime surface residency**,
  not disk/OS/Git cache warmth. Bootstrap exceptions remain unchanged.
- `first_usable_shell_frame.elapsedMs`: selection → first checked visible,
  non-inert, nonzero-sized active surface containing the actual pane layout,
  ready at two consecutive requestAnimationFrame checks (a paint opportunity
  between checks). Retries missing/lazy layout for
  at most five seconds. Cancelled/superseded selections do not report completion.
  This is an **interactive shell frame proxy**, not GPU presentation proof:
  empty workspace layout is usable; Git/Explorer freshness, terminal prompt
  readiness and native Browser pixels need not be ready. It is neither a mount
  nor an effect-only measurement. Hidden windows cannot report it.
- `react_commit`: root App React Profiler commit, including parked descendants.
  `actualDuration` is React render CPU milliseconds for that commit; it excludes
  layout/paint, effects and backend work. Counts include resource-driven commits
  in the fixed observation interval, not only commits caused directly by selection.
  IDs and phase identify repeated commits; use React DevTools to attribute expensive
  root commits to individual components. Development StrictMode remains enabled.
- IPC: cumulative **invoke starts** by canonical channel; subtract snapshots for
  interval counts. Watch/poll setup and mutation invocations are not filesystem reads.
  `active`/`peak` count unresolved invoke promises, including carry-in from earlier
  work; sends/subscription events and backend polling reads are not invoke starts.
- Backend: cumulative `GitService.getStatus` starts (`git-status`, including polling
  and mutation refresh), SSH environment directory listings (`ssh-list`), file reads
  (`ssh-read`) and batched metadata snapshots (`ssh-snapshot`). One operation may
  execute multiple Git commands or read multiple files. Counts include failures.
  Backend `active`/`peak` measure overlap of these instrumented operations only,
  not all host I/O. Completion, including rejection, decrements active once.
- Events are capped at 512; counters have fixed internal operation/channel labels.
  No credentials, request arguments, paths, file contents, terminal data or responses
  are retained. IDs correlate lifecycle only; editor filenames are stripped.
  Nothing is transmitted or persisted as telemetry. Exporting JSON is explicit.
- Checkout focus does not remount the workspace shell: no new workspace-frame
  latency is claimed for it. The fixture waits for current branch presentation,
  then captures the same one-second commit/request window.

## Conditions and raw observations

Linux 7.2.9-2-cachyos, Node 26.11.1, npm 12.2.0, Electron 41.10.7,
React 19.2.4. Real native Electron renderer, headless Ozone, development StrictMode;
no CPU throttling. Four tiny committed local repos, tabs navigation, Explorer visible,
empty pane layouts during workspace switches. Open A/B/C/D with one-second settles;
A and then B are evicted/cold. Subsequent A/B/A are warm. Every selection captures
through shell-frame completion plus one second. No speedup target; small samples,
dev logging and frame scheduling introduce noise. This is not a representative
large-project/browser/dirty-editor workload or a production benchmark.

Initial baseline was recorded **before changing subscriptions**, against
`74f54d134779b531f53ab229c8700dbd8aa7c4a8` plus instrumentation: cold frames
35.4/36.6 ms; warm A/B/A frames 32.6/30.8/32.2 ms; commit counts 4/5/4/4/4.
To compare the final hardened frame checks and expanded checkout fixture identically,
the five original whole-store subscription forms were temporarily restored for a
repeat baseline, then the optimized selectors restored and measured again. The
following tables are that final paired repeat, with identical final instrumentation
and fixture. Individual observations, not averages; CPU columns are sum / largest
App commit; all times are milliseconds.

| Selection | Before frame | After frame | Before commits | After commits | Before CPU | After CPU |
|---|---:|---:|---:|---:|---:|---:|
| D → A cold | 43.5 | 35.9 | 4 | 4 | 40.6 / 18.2 | 33.3 / 16.4 |
| A → B cold | 45.9 | 42.5 | 5 | 5 | 45.1 / 20.2 | 39.3 / 17.2 |
| B → A warm | 33.4 | 30.1 | 4 | 4 | 31.6 / 20.6 | 28.0 / 17.3 |
| A → B warm | 31.6 | 30.1 | 4 | 4 | 29.6 / 18.6 | 28.2 / 17.2 |
| B → A warm | 31.2 | 31.0 | 5 | 4 | 33.3 / 18.9 | 28.7 / 17.3 |

**Every row, before and after:** 7 invoke starts: Explorer start-watch 1,
Git remotes 2, Git start-poll 2, Git stop-poll 2. Peak unresolved IPC 7;
backend Git status operations 2, peak measured backend reads 1. No SSH reads.
StrictMode's effect replay is included; these counts do not establish multiple
simultaneously active Git pollers.

The same final paired runs include checkout-only selection. Main → isolated → main
uses two real shell panes in A, a Git-listed
isolated worktree adopted through normal New Agent, and actual terminal focus.
No synthetic timings or fabricated paint measurements:

| Focus | Before commits | After commits | Before CPU | After CPU | IPC peak before / after |
|---|---:|---:|---:|---:|---:|
| isolated → main | 4 | 6 | 40.1 / 25.3 | 36.4 / 22.2 | 10 / 10 |
| main → isolated | 4 | 5 | 37.1 / 25.0 | 27.6 / 17.3 | 10 / 9 |
| isolated → main | 4 | 5 | 37.5 / 26.1 | 27.6 / 16.8 | 10 / 9 |

Each checkout row again has the same 7 categorized invoke starts, 2 backend status
operations and backend read peak 1. IPC peaks include pending earlier invocations.
Checkout freshness/first-frame latency was not measured separately.

**Interpretation:** no reliable switching latency or commit-count improvement has
been established. Render CPU was lower in these samples, but not enough repetitions
or workload coverage to claim a performance speedup. Regression tests establish the
narrower claim: unrelated store-only changes no longer render the affected consumers.
Selection still reconstructs workspace references and immediately restarts Git data
acquisition; measurements justify retaining those as follow-up investigation, not
changing them in Stage 1.

## Verification and remaining coverage

- Targeted regression suites: App, EditorPane, WorkspaceTabs, Git management,
  WorkspaceHost residency, observed checkout presentation/races, instrumentation
  cancellation/bounds and operation concurrency: initial targeted run 162 passed;
  final full suite includes two additional rapid-selection/backend-gating cases.
- `npm run validate`: passed — branding, lint, typecheck, both Fallow baselines,
  security audit (only the existing documented dev-only exception), build and
  7,710 tests across 392 files after the shutdown follow-up.
- Real Electron checkout-presentation smoke: all assertions and result JSON passed
  (main/two worktrees, dirty matrices, two-agent focus, generations, historical and
  unavailable observations, retirement). The original Stage 1 run timed out at close;
  the follow-up below establishes the pre-existing cause and corrects fixture teardown.
  The corrected runner now completes with exit 0 and verified PTY/Electron exit.
- Real workspace-page Browser renderer smoke: passed, exit 0 (24 transitions,
  native state/visibility, stale geometry, persistence, disposal).
- Real workspace launch-race smoke: passed, exit 0 (PTY startup/cache, late-spawn
  kill, page identity/drag/layout).
- SSH before/after: **not measured**; no authorized disposable SSH environment was
  provided. No host was contacted. SSH read counters are implemented but their
  runtime performance/concurrency coverage remains for a configured test host.
- Not measured: compositor/GPU first paint, nonempty workspace switch latency,
  production timings, large/dirty editor workload, long-run percentiles or native
  harness cwd movement. Existing checkout smoke uses explicit authenticated fixtures.

## Shutdown verification follow-up

**Cause confirmed, not inferred:** an observation wrapper around the original runner
captured main's terminal table and a `before-quit` event after the production handler,
then inspected the real close prompt. It waited 1.5 seconds with `app.close()` pending.
Identical evidence was collected for Stage 1 HEAD and for a disposable `git archive`
of its base, built against the same dependencies (no branch/worktree changes):

| Runtime | Live PTYs before / after quit request | Quit prevented | Shutdown started | Prompt |
|---|---:|---|---|---|
| `423d134` | 4 / 4 | yes | no | Close Clanker? |
| `74f54d1` (original Stage 1 base) | 4 / 4 | yes | no | Close Clanker? |

The four were the OpenCode fixture PTY, two Pi fixture PTYs and the explicitly
launched main shell. `send('exit')` exits the OpenCode **agent** and retires its
attention observation; `harness-wrapper.sh` then execs the fallback interactive
shell in the same PTY. Thus retired attention is not terminal exit evidence.
`AppCloseGuard` correctly sees `terminals.size > 0` and requires consent. No test
answers that prompt, and its timeout cancels rather than authorizing shutdown.
Both probes recovered with exit 0 by cancelling the prompt, retiring only fixture
terminals via normal IPC, and retrying ordinary close. This predates Stage 1.

**Fix:** both runners now invoke shared `scripts/lib/smoke-fixture-cleanup.cjs`
in `finally`, including early launch/assertion failures. Cleanup captures only local
terminals whose launch cwd exactly matches the runner's allowed roots, retains
references to their real `exited` promises, retires them through existing
`killTerminal` IPC, waits for actual PTY exit and verifies the main table is empty
before ordinary `app.close()`. No production guard, authority, terminal lifecycle
or Git code was changed. The existing-checkout variant still performs its file,
status, worktree-registration and zero-inference preservation checks after cleanup.
Renderer failure diagnostics no longer delay reaching `finally`.

Each launched process inherits a fresh UUID `CLANKER_SMOKE_RUN` tag. On Linux,
bounded final cleanup checks that exact tag plus process start identity before
individual SIGTERM/SIGKILL signals; it ignores unrelated processes and zombies.
Vite is also stopped through its exact owned ChildProcess, and the native-Pi
loopback server is closed. No process-name/group-wide kill, user checkout deletion,
Git unregister/remove operation, close authorization or automatic confirmation.
Every normal IPC/exit/close step has a five-second deadline; child and tagged-process
termination waits are bounded to one-second TERM and two-second KILL phases.
Failures remain failures even when emergency reaping succeeds; unresolved cleanup
retains the disposable fixture instead of deleting it. Non-Linux emergency
descendant verification is not claimed; unsupported/incomplete cleanup fails.

The development runner also exposed a separate stdio-drain detail: Electron exited
naturally with code 0 in 29 ms, while Playwright's close promise stayed pending until
owned dependents were reaped (observed close at 5,097 ms in the diagnostic run).
Cleanup now recognizes natural Electron exit, reaps tagged dependents, then awaits
Playwright's close/stdio drain. A guard-blocked live Electron process cannot take
that success path. This ordering has a dedicated regression test.

**Final checks:**
- `node scripts/checkout-presentation-smoke.cjs`: all existing assertions passed,
  verified all remaining registered PTY exits (3–4 across runs), natural Electron
  exit, exit **0**.
- `node scripts/workspace-switch-measure.cjs`: valid JSON containing all 5
  workspace transitions and 3 checkout transitions, verified 2 PTY exits and
  natural Electron exit, exit **0**. Cleanup summaries go to stderr, not metric JSON.
- Both commands with `--fail-after-launch`: expected exit **1** for the injected
  assertion failure, verified 3/2 PTY exits respectively, natural Electron exit;
  no timeout or lingering tagged processes. These are reproducible failure-path checks.
- Targeted teardown, guard/prompt, terminal retirement and harness-wrapper suites:
  **50 tests passed**. New cases cover scope refusal, missing exit evidence,
  delayed stdio close, failed IPC, SIGKILL escalation and an unrelated live process
  left untouched. `npm run validate`: **7,710 tests passed**, all other gates passed.
- Native guard smoke: `env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron
  --ozone-platform=wayland scripts/app-close-guard-smoke.cjs`: **passed, exit 0**
  (idle/exited close, live cancellation, repeated requests, approved PTY drain).
  Headless direct-script attempts hit an environment-specific Electron startup
  SIGSEGV; the Wayland run completed all guard assertions.

Stage 1's requested smoke verification now has clean exits. SSH and performance
coverage limitations above are unchanged. No Stage 2+ changes. Review representative
live workloads before relying on these numbers for subsequent optimization decisions.
