# Keyboard Shortcuts

This page lists shortcuts that are currently implemented in the app.

Use `Cmd` on macOS and `Ctrl` on Windows/Linux for the primary modifier.

## App / Window

| Action | Shortcut | Notes |
|--------|----------|-------|
| Zoom in | `Cmd/Ctrl+=` | Applies to the app UI when focus is outside the embedded browser |
| Zoom out | `Cmd/Ctrl+-` | Applies to the app UI when focus is outside the embedded browser |
| Reset zoom | `Cmd/Ctrl+0` | Resets app UI zoom when focus is outside the embedded browser |
| Fit all panes | `Cmd/Ctrl+Shift+F` | Works from both app UI focus and browser focus |

## Browser Panel

| Action | Shortcut | Notes |
|--------|----------|-------|
| Zoom in | `Cmd/Ctrl+=` | Applies to the active browser tab when the browser has focus |
| Zoom out | `Cmd/Ctrl+-` | Applies to the active browser tab when the browser has focus |
| Reset zoom | `Cmd/Ctrl+0` | Resets zoom for the active browser tab when the browser has focus |
| Toggle DevTools | `Cmd/Ctrl+Shift+I` | Opens detached DevTools for the active browser tab |
| Toggle DevTools (alt) | `F12` | Browser focus |
| Fit all panes | `Cmd/Ctrl+Shift+F` | Available while the browser has focus |

## Editor

| Action | Shortcut | Notes |
|--------|----------|-------|
| Save file | `Cmd/Ctrl+S` | Saves the active editor tab |

## Terminal

| Action | Shortcut | Notes |
|--------|----------|-------|
| Copy selection | `Ctrl+Shift+C` | Copies the current xterm selection |
| Mouse selection copy | Select text | Selected terminal text is copied automatically |

## Workspace Gate

These shortcuts work in the workspace picker when focus is not inside an input field.

| Action | Shortcut |
|--------|----------|
| Select 1 terminal | `1` |
| Select 2 terminals | `2` |
| Select 4 terminals | `4` |
| Plain shell | `B` |
| Codex harness | `C` |
| OpenCode harness | `O` |
| Pi harness | `P` |
| Antigravity harness | `A` |

## SSH Remote Directory Chooser

| Action | Shortcut |
|--------|----------|
| Move through directory entries | `↑` / `↓` |
| Open focused directory | `Enter` |
| Navigate to parent directory | `Backspace` or `←` when focus is outside the New Folder input |
| Select the current directory | `Enter` when the chooser itself has focus |
| Close the chooser | `Escape` |
| Cancel the New Folder form | `Escape` while its input is focused |

In the remote path field, `↑` / `↓` move through suggestions, `Enter` accepts a highlighted suggestion or launches the workspace, and `Escape` dismisses visible suggestions.
