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

## Resume scope (#114)

Previously several mount/interaction timers sent redundant resizes after
readiness. The sizing coordinator removes redundant geometry IPC and orders
readiness after the first visible PTY resize. The default startup buffer remains
unchanged; no transcript renderer or larger buffer is added.

This does **not** guarantee calm native transcript restoration. Local and SSH
PTYs still spawn before the new pane's final dimensions are known. Native TUIs
can render at their initial geometry before the first renderer resize.

A separate buffer-ordering problem also remains: output beyond the startup bound
can stream before the held prefix, which is released later on readiness. Simply
flushing the prefix early would risk losing it when xterm is not mounted yet.
Resolving that requires a bounded delivery/backpressure design with coverage for
unmounted receivers, not an eager flush. These remaining startup limitations and
real long-session OpenCode/Pi comparisons belong to #114; that issue remains open.

## Verification

Run the focused Vitest suites for terminal geometry, TerminalPane, PTY spawn,
terminal IPC, terminal theme, and the app-level terminal session bridge.

For a real Electron/xterm check on a desktop display:

```sh
npx electron scripts/terminal-geometry-smoke.cjs /tmp/terminal-geometry.png
```

The script uses a temporary Electron profile and a short-lived window. It checks
container-only resizing, the final column and scrollbar bounds, PTY/xterm
agreement, hidden-pane geometry, and cached reattachment with scrollback. The
optional screenshot captures the final state. It never starts an agent or reads
the application's user profile.
