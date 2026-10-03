# Keyboard Shortcuts

Use `Cmd` on macOS and `Ctrl` on Windows/Linux for the primary modifier.

## Who owns a keystroke

Clanker has four input surfaces. Each one receives its own keyboard events, so each one decides what it handles:

| Surface | Receives keys from | Handles |
|---------|--------------------|---------|
| **App** (toolbar, panels, dialogs) | Renderer DOM | `app` commands |
| **Editor** (CodeMirror) | Renderer DOM | `editor` and `app` commands, plus CodeMirror's own editing keys |
| **Terminal** (xterm) | xterm's key handler | `terminal` commands only; every other key goes to the shell/TUI |
| **Browser** (native view) | Electron `before-input-event` in the main process | `browser` commands only; everything else goes to the page |

A command only runs on a surface listed in its contexts. In particular, application commands never take keys from a focused terminal or browser page: with a terminal focused, `Ctrl+S`, `Ctrl+B`, `Ctrl+T`, `Ctrl+W`, and the like reach the terminal untouched.

## Default shortcuts

These are the configurable commands (see [Customizing shortcuts](#customizing-shortcuts)).

| Command | Default | Works in |
|---------|---------|----------|
| Open Settings | `Cmd/Ctrl+,` | App, editor |
| Fit All Panes | `Cmd/Ctrl+Alt+F` | App, editor, browser |
| Toggle Explorer | `Cmd/Ctrl+B` | App, editor |
| Save File | `Cmd/Ctrl+S` | Editor only |
| Zoom In | `Cmd/Ctrl+=` (`Cmd/Ctrl+Shift+=` also works until you rebind it) | App, editor, terminal, browser |
| Zoom Out | `Cmd/Ctrl+-` | App, editor, terminal, browser |
| Reset Zoom | `Cmd/Ctrl+0` | App, editor, terminal, browser |
| Focus Address Bar | `Cmd/Ctrl+L` | Browser |
| New Tab | `Cmd/Ctrl+T` | Browser |
| Close Tab | `Cmd/Ctrl+W` | Browser |
| Refresh | `Cmd/Ctrl+R` | Browser |
| Next Tab | `Ctrl+Tab` | Browser |
| Previous Tab | `Ctrl+Shift+Tab` | Browser |

On macOS the tab-cycling defaults use the literal `Control` key (`Ctrl+Tab`), because `Cmd+Tab` belongs to the operating system.

Fit All Panes used to be `Cmd/Ctrl+Shift+F`. That binding is no longer active; the new default is `Cmd/Ctrl+Alt+F`.

The browser commands run only while the native browser view has focus. Focus Address Bar moves keyboard focus to the Clanker address field of the active tab and selects it. New Tab, Close Tab, and Next/Previous Tab use the same actions as the tab strip: the last tab cannot be closed, and tab cycling follows tab order, wraps around, and does nothing with a single tab.

## Zoom

Zoom follows focus:

| Focus | Keyboard zoom | `Ctrl`+wheel |
|-------|---------------|--------------|
| Browser page | Zooms that browser tab | Zooms that browser tab |
| Terminal | Zooms that terminal's font | Zooms that terminal's font |
| Anywhere else | Zooms the whole app | Zooms the whole app |

Keyboard zoom bindings are configurable. `Ctrl`+wheel zoom is not: it is a fixed mouse gesture, handled by each surface directly, and is not part of the keybinding system.

## Customizing shortcuts

Open **Settings → Keyboard shortcuts...** to search commands, see which differ from their defaults, change a binding, reset one command, or **Reset All**.

- Click **Edit**, then press the new shortcut. The pressed keys do not run anything while recording. `Esc` cancels, `Delete`/`Backspace` unbinds the command, and modifier keys alone are ignored.
- Each command has at most one binding. Bindings must include a non-modifier key.
- Only your changes are stored; a command you never change always follows the built-in default. Explicitly unbinding a command is remembered separately from "no change".

### Conflicts

Two commands conflict when they use the same keystroke **and** share a context. The same keystroke in non-overlapping contexts is allowed, which is why zoom keys are valid in terminal, browser, and app at once, and why `Cmd/Ctrl+R` can be Refresh in the browser while another command uses it elsewhere.

When a new binding conflicts, the dialog names the conflicting command and offers **Cancel** or **Replace**. Replace unbinds the other command (it does not fall back to its default), so the result is always unambiguous.

## What is not configurable

These are interaction semantics of individual components, not Clanker commands, and they stay fixed:

- `Esc` in dialogs, popovers, and inline create/rename fields; `Enter` to confirm
- File tree and list arrow-key navigation, `Enter`/`Space` activation
- Workspace tab accessibility and reorder keys (`Alt+Shift+←/→`)
- Workspace Gate and SSH directory chooser keys (below)
- CodeMirror's own editing keys: arrows, selection, `Cmd/Ctrl+Z` undo, `Cmd/Ctrl+Shift+Z`/`Cmd/Ctrl+Y` redo, and the rest of its standard keymap
- Terminal copy: `Ctrl+Shift+C` copies the xterm selection (selecting text also copies it)
- Browser DevTools: `Cmd/Ctrl+Shift+I` and `F12`
- `Ctrl`+wheel zoom

## Workspace Tabs

| Action | Shortcut | Notes |
|--------|----------|-------|
| Move focused workspace tab left or right | `Alt+Shift+←` / `Alt+Shift+→` | Also available by dragging a tab; does not activate an inactive tab |

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
