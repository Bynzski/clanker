# Windows Notes

This project supports **Windows 10 1809+**.

## Git for Windows

Install Git for Windows for local development. Husky hooks rely on the `sh` bundled with Git for Windows.

## UNC workspaces and file watching

Explorer file watching automatically enables polling mode for UNC workspaces (`\\server\share\...`) on Windows. You can also force polling with:

```bash
CLANKER_GRID_WATCHER_POLLING=1
```

## Long path support

Some toolchains and nested dependency trees can exceed the legacy Windows path limit. Enable long paths in Windows:

- Group Policy: **Enable Win32 long paths**
- Or registry: `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled=1`

After enabling, restart the machine.

## Git line endings (`core.autocrlf`)

Recommended contributor setting on Windows:

```bash
git config --global core.autocrlf input
```

This keeps working trees predictable for mixed-platform collaboration while still preserving explicit CRLF/LF behavior in files where it matters.

## SSH home/config lookup on Windows

Credential code now prefers `%USERPROFILE%` for `.ssh` resolution on Windows, with fallback to `HOME` and then `os.homedir()`. This avoids common toolchain cases where `HOME` is set to a non-user-profile location.

## App data / electron-store location

App settings and persisted state use Electron `app.getPath('userData')` + `electron-store`, which resolve under `%APPDATA%\Clanker Grid` on Windows.

## Raw `fs.watch` status (editor file watcher)

The editor watcher uses raw `fs.watch` (not chokidar) with rewatch-on-rename behavior for Windows atomic-save semantics. This was verified in unit coverage during Phase 5 (`tests/main/unit/fileWatcher.test.ts`) and remains the intended implementation.
