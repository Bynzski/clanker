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
