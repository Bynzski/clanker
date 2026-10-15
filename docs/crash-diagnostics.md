# Local native crash diagnostics (#196)

Clanker starts Electron's Crashpad reporter before creating renderers. Capture is enabled by default for unpackaged runs and packaged versions carrying the `-dev` prerelease marker. Stable packaged releases default off. The startup environment override wins:

```bash
CLANKER_CRASH_DUMPS=1 npm run dev
CLANKER_CRASH_DUMPS=1 ./Clanker-Grid.AppImage
CLANKER_CRASH_DUMPS=0 ./Clanker-Grid.AppImage
```

Use your actual AppImage filename. PowerShell: set `$env:CLANKER_CRASH_DUMPS='1'` before launching. This is independent of attention logging, DevTools, and `NODE_ENV`.

## Storage and privacy

- Dumps stay local: `uploadToServer: false`, no submission URL, and no Clanker upload service. OS crash reporting remains enabled and follows the host's own configuration.
- Startup logs the exact directory returned by Electron's `app.getPath('crashDumps')`. It is normally `<userData>/Crashpad` (usually `~/.config/clanker-grid/Crashpad` on Linux). Platform/profile overrides can change it; use the logged path rather than assuming a location.
- Search that directory recursively for `.dmp` files; Crashpad's internal database layout is platform-dependent. Do not alter its database while Clanker is running.
- These are native minidumps, not intentionally requested full-memory core dumps. Nevertheless, **they can contain sensitive process memory**, including terminal/conversation text, file contents or secrets. Do not attach dumps to public issues. Share privately only after consent.
- Turning capture off does not delete existing dumps. Clanker adds no retention policy or hard disk quota over Crashpad's own database management. Review disk usage and, with Clanker closed, remove old diagnostics when no longer needed.

## Investigating a crash

Keep the dump privately together with the exact Clanker build/version, Electron version, OS/architecture, display backend (Wayland/X11), crash time, renderer reason/exit code, and a short description of the workload. Record whether it followed heavy terminal output or attention events; correlation alone is not causation.

A minidump needs native stack analysis with symbols matching the **exact Electron version and architecture** (and applicable OS libraries). Minidumps are best-effort: hard kills, reporter failure and some system failures produce none. JavaScript exceptions are not native crashes and do not produce these dumps. Existing systemd core dumps can remain useful as additional evidence.

The renderer recovery prompt addresses the frozen-window aftermath. It stops existing workspace resources and reloads through normal startup on consent; it neither preserves live PTYs nor fixes the native fault. A symbolized stack or reproducible workload is needed before attributing the fault to V8, GPU/Wayland, or application event pressure.

Reference: [Electron crashReporter API](https://www.electronjs.org/docs/latest/api/crash-reporter).
