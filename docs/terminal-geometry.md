# Terminal sizing and startup

`TerminalPane` uses `lib/terminalGeometry.ts` for initial mount, cached xterm
reattachment, container and window resizing, resize confirmations, and font zoom.
It observes the outer `.terminal-content` container rather than xterm's screen.

Fits coalesce over 50 ms without postponing indefinitely during continuous
splitter dragging. PTY resizes coalesce over 100 ms, never overlap asynchronous
IPC calls, and skip unchanged rows/columns. Detached, zero-size, and explicitly
disposed terminals do not fit or send geometry. A cached terminal gets a new
observer on its new container; its xterm and scrollback stay alive.

The renderer installs input listeners, fits a visible terminal, awaits its PTY
resize, and then sends `TERMINAL_READY`. This avoids flushing startup output and
starting recipe commands before Clanker has synchronized its terminal geometry.
Later layout changes still use the same sizing path.

xterm 6 uses its own scrollbar. The terminal theme supplies slider colors, and
FitAddon reserves its actual gutter. Avoid forcing the internal screen to 100%
height, suppressing scrollbars, or adding right padding to compensate for stale
column counts.

## Ordinary history resume (#131, superseding #114)

Previously several mount/interaction timers sent redundant resizes after
readiness. The sizing coordinator removes redundant geometry IPC and orders
readiness after the first visible PTY resize. The default startup buffer remains
unchanged; no transcript renderer or larger buffer is added.

Ordinary history resume now reserves a real empty destination pane (not a fake
terminal or process) before invoking main. Its visible xterm publishes measured
rows/columns through `terminalPaneGeometry.ts`; dimensions must remain unchanged
for 100 ms, with a five-second preparation timeout. Closing/hiding the pane or
closing the dropdown cancels preparation. No process starts without a measurement.

`sessionResume.ts` passes that sizing hint through `SessionInvokeOptions` before
native PTY creation, locally and over SSH. Main snapshots and bounds the hint
(2–1000 columns, 1–1000 rows); it conveys no cwd/session/checkout authority.
The real returned terminal attaches to the reserved pane atomically, without
inserting another split. Offers/errors remove the empty reservation, and a PTY
that cannot be recorded is killed. A dispatched launch may finish in its original
live workspace after a switch; its startup output waits for a receiver there.
Replacement lifecycle resumes still use source geometry, not a renderer hint.

Startup output now uses bounded Node socket backpressure: newer bytes cannot
stream ahead of the held prefix. READY drains the prefix before resuming reads;
this is not XON/XOFF and does not increase the ordinary startup buffer.

This does **not** guarantee calm native transcript restoration. User-driven layout
or font changes during discovery can still require a later resize, and harnesses
own their native replay/alternate-screen behavior. Deliberately long real
OpenCode/Pi comparisons and the full native local/SSH readiness matrix remain in
#131; neither fixtures nor measured geometry prove visual improvement.

## Verification

Run the focused Vitest suites for terminal geometry, TerminalPane, measured session
resume, local/remote session IPC, PTY spawn, terminal IPC, terminal theme, and the
app-level terminal session bridge. A real POSIX PTY regression verifies that its
child sees 120×40 from startup and delivers 100 KB in exact order after READY.

For a real Electron/xterm check on a desktop display:

```sh
npx electron scripts/terminal-geometry-smoke.cjs /tmp/terminal-geometry.png
```

The script uses a temporary Electron profile and a short-lived window. It checks
container-only resizing, the final column and scrollbar bounds, resize-callback/xterm
agreement, hidden-pane geometry, and cached reattachment with scrollback. The
optional screenshot captures the final state. It never starts an agent or reads
the application's user profile. The separate POSIX PTY regression checks actual
child startup dimensions and socket delivery.

On 2026-10-07 this desktop smoke passed at widths 500/300/750 px (62/36/94
columns, 26 rows), with five resize callbacks and readiness after the first fit
and cached reattachment. This is Electron/xterm sizing evidence, not a long native
OpenCode/Pi transcript comparison.

Manual follow-up: restart the dev main process, resume a long OpenCode/Pi conversation
into a new split locally and on SSH, and compare initial redraw/scrollback to the
previous checkpoint. Also close the empty pane or dropdown during preparation,
switch workspaces after dispatch, and try a removed-checkout offer/cancel/retry.
Expected: no orphan process or extra split, no lost/reordered output, and only the
owning workspace receives the resumed terminal. Record harness versions and observed
repaints; do not infer native visual improvement from the geometry tests.
