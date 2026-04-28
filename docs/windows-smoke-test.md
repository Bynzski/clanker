# Windows Smoke Test — Phase 2

Manual verification checklist for running Clanker Grid on a real Windows 10/11 host.
Run these steps after `npm run build` and `npm run start` on Windows.

## Prerequisites

- Windows 10 1809+ or Windows 11
- Git for Windows installed and on PATH
- Node.js 22+ and npm 10+
- PowerShell 7 (`pwsh.exe`) or Windows PowerShell 5.1 (`powershell.exe`)

## Build & Launch

```powershell
npm ci
npm run build
npm run start
```

The Electron window should open without errors. Check the DevTools console for any native-module errors (especially `node-pty`).

## Checklist

### 1. Terminal — PowerShell via ConPTY

- [ ] Open a new terminal pane (click the `+` button or use the keyboard shortcut).
- [ ] Verify PowerShell prompt appears (not a blank window).
- [ ] Verify the prompt shows the current directory (e.g., `PS C:\Users\you\projects\clanker-grid>`).
- [ ] **Arrow keys:** Press Up/Down to cycle history. Left/Right to move cursor.
- [ ] **Ctrl+C:** Run `dir` then press Ctrl+C mid-output — should cancel cleanly.
- [ ] **Resize:** Drag the terminal pane border. The prompt should reflow (no garbled output).
- [ ] **Colors:** Run `Get-ChildItem` — directories should appear in a different color than files.
- [ ] **256-color test:** Run this PowerShell snippet:
  ```powershell
  0..15 | ForEach-Object { Write-Host "$("  {0,3}  " -f $_)" -Fore White -Back $_ }; Write-Host ""
  ```
  You should see 16 colored blocks.
- [ ] **Unicode:** Run `[char]0x2764` — should display a heart character (or the platform's Unicode rendering of it).

### 2. Terminal — Exit Code

- [ ] Run `exit` in the terminal pane.
- [ ] Verify the pane closes or shows an exit message (no lingering `conhost.exe` zombie).
- [ ] Open Task Manager → Details tab. After closing all terminal panes, confirm no orphaned `conhost.exe` processes tied to Clanker Grid.

### 3. Harness Launch (if a harness is installed)

- [ ] Open the harness launcher (e.g., click the Codex or Claude icon in the sidebar).
- [ ] Verify the harness spawns and shows its prompt/interface in the terminal pane.
- [ ] Type a simple message (e.g., "hello") and verify you get a response.
- [ ] Exit the harness (Ctrl+C or its exit command).
- [ ] Verify the fallback shell activates — you should see a PowerShell prompt after the harness exits.

### 4. TERM / COLORTERM Environment

- [ ] In a terminal pane, run:
  ```powershell
  $env:TERM
  $env:COLORTERM
  $env:TERM_PROGRAM
  ```
  Expected: `xterm-256color`, `truecolor`, `clanker-grid`.

### 5. node-pty Native Module

- [ ] Confirm no errors in the DevTools console about `node-pty` failing to load.
- [ ] If `node-pty` fails, check that `@electron/rebuild` ran during `npm ci`. Run manually:
  ```powershell
  npx electron-rebuild -f -w node-pty
  ```
  Then re-run `npm run start`.

## Known Issues to Watch For

| Symptom | Likely Cause | Action |
|---------|-------------|--------|
| Blank terminal pane | ConPTY not initializing; check `node-pty` version | File a bug with the DevTools console output |
| Arrow keys produce `[A`, `[B` etc. | xterm key encoding mismatch | File a bug with the exact key and expected behavior |
| Colors don't render | `COLORTERM` not set or PowerShell ignoring it | Verify env vars (checklist item 4) |
| `conhost.exe` zombies | PTY exit not cleaning up | File a bug with process tree screenshot |
| Harness spawns but no output | PTY data buffering issue | Check DevTools console for `TERMINAL_DATA` events |

## Reporting Results

After completing the checklist, report:
1. Which items passed ✅ and which failed ❌
2. Any console errors or warnings
3. Windows version (run `winver` to get exact build)
4. PowerShell version (run `$PSVersionTable`)
5. Screenshots of any failures

Results go back to the agent so it can determine if code fixes are needed or if Phase 2 can be marked complete.
