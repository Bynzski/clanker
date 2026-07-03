# Windows Notes

Reference for running and developing Clanker Grid on Windows.

**Supported:** Windows 10 1809+ and Windows 11, x64.
**Not supported:** ARM64, WSL (use the Linux AppImage instead).

## Installing a release build

Windows artifacts are produced only for releases that explicitly include a Windows build. Linux-only patch releases may ship only the AppImage.

When a Windows build is produced, it includes:

| File | Purpose |
|------|---------|
| `Clanker Grid Setup X.Y.Z.exe` | NSIS installer — adds Start Menu and uninstaller entries. |
| `Clanker Grid X.Y.Z.exe` | Portable executable — runs without installing. |

Both are **unsigned** in the current release. On first launch, Windows SmartScreen displays:

> Windows protected your PC. Microsoft Defender SmartScreen prevented an unrecognized app from starting.

Choose **More info → Run anyway** to continue. Code signing is planned for a follow-up release.

## App data location

App settings and persisted state live under:

```
%APPDATA%\Clanker Grid\
```

This resolves via Electron's `app.getPath('userData')` and is preserved across upgrades. Uninstalling the NSIS build does not by default clear this directory.

## Git for Windows

Install [Git for Windows](https://gitforwindows.org/) for any local development. The husky pre-commit hook (`.husky/pre-commit`) runs through the `sh` bundled with Git for Windows; without it, commits skip the hook silently.

After install, confirm:

```bash
git --version
sh --version
```

## Recommended Git settings

```bash
git config --global core.autocrlf input
```

Keeps the working tree LF-on-disk while still letting Windows tooling render CRLF where it expects it. Clanker Grid's editor preserves whatever line ending a file already has on save (CRLF stays CRLF, LF stays LF), so `core.autocrlf=input` avoids accidental rewrites in mixed-platform repos.

## Long path support

Some toolchains and nested dependency trees can exceed the legacy 260-character Windows path limit. Enable long paths via either:

- **Group Policy:** Computer Configuration → Administrative Templates → System → Filesystem → **Enable Win32 long paths**.
- **Registry:** set `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled` to `1`.

Restart the machine after enabling.

## UNC workspaces and file watching

Clanker Grid accepts UNC-style workspace paths (`\\server\share\project`) and Windows drive-letter paths (`C:\projects\foo`) in the workspace gate. Backslashes are normalized to forward slashes at the IPC boundary; you do not need to convert them by hand.

For UNC paths, the explorer file watcher automatically falls back to **polling** because native `fs.watch` events are unreliable across SMB. To force polling on any workspace (for example when debugging watcher issues on a local path):

```bash
set CLANKER_GRID_WATCHER_POLLING=1
```

Or, for PowerShell:

```powershell
$env:CLANKER_GRID_WATCHER_POLLING = "1"
```

## SSH home / `.ssh` lookup

Credential code resolves the SSH parent directory in this order on Windows:

1. `%USERPROFILE%\.ssh` (preferred — matches the OpenSSH default)
2. `$HOME\.ssh` (fallback — only if `%USERPROFILE%` is unavailable)
3. `os.homedir()\.ssh` (final fallback)

This avoids common toolchain cases (Git Bash, MSYS) that set `HOME` to a non-user-profile location.

## SSH key permissions

POSIX file modes (`mode 0600`, `chmod`) are no-ops on Windows NTFS. Clanker Grid relies on **inherited NTFS ACLs** under `%USERPROFILE%\.ssh`: as long as the parent `.ssh` directory has the standard "current-user-only" ACLs that OpenSSH for Windows applies, generated keys inherit safe permissions automatically.

If you have customized `.ssh` ACLs and need to lock them down, run `icacls` manually after key generation — Clanker Grid does not modify ACLs on Windows.

## Default shell

PowerShell (`powershell.exe`) is the default session shell on Windows. Clanker Grid does not pass `-i` (a bash-only flag) on Windows; PowerShell launches in interactive mode by default.

You can override by setting the `SHELL` environment variable before launching Clanker Grid (for example, to `pwsh.exe` or to the Git for Windows `sh.exe`).

## Harness launch on Windows

npm-installed CLI tools (Codex, Claude, OpenCode, Pi) are installed as `.cmd` shim scripts on Windows. Clanker Grid spawns these through `cmd.exe /c <harness>` so the `.cmd` extension resolves correctly under `node-pty`. No manual configuration is required.

The POSIX wrapper script that Clanker Grid generates on Linux/macOS (`~/.clanker-grid/harness-wrapper.sh`) is **not** generated on Windows — harnesses run directly.

## File watcher implementation

The editor's file watcher uses raw `fs.watch` (not chokidar) with rewatch-on-rename so atomic-save flows on Windows survive temp→target renames without flapping. The explorer watcher uses chokidar with platform-tuned `awaitWriteFinish` and an unlink+add collapse window so atomic saves do not produce visible flicker.

These are implementation details, not user-facing settings — they are documented here so contributors auditing watcher behavior on Windows know what is intentional.

## Reporting Windows-only issues

When filing a Windows-specific bug, please include:

- Windows edition and build (`winver`).
- PowerShell version (`$PSVersionTable`).
- Whether the workspace path is local, drive-letter, or UNC.
- Whether long-path support is enabled.
- DevTools console output if the issue affects the renderer.
