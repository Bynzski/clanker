# Terminals & AI Harnesses

## Terminals

- Backed by real PTY processes (node-pty)
- Full ANSI color support via xterm.js; xterm.js owns scrollback (10,000 lines)
- Resize-aware: bidirectional resize confirmation loop, coalesced via 100 ms lock
- Session continuity across workspace/tab switches — xterm instances are cached and reused, not remounted blank
- Startup uses a bounded 16 KB buffer + `TERMINAL_READY` renderer handshake to protect early PTY output
- Copy/paste support
- `handleFlowControl: false` is set on all PTY spawns (re-enabling is a separate future readiness concern, not part of the workspace residency plan)

### Terminal Actions

| Action | Location |
|--------|----------|
| New Terminal | Header toolbar button |
| Kill Terminal | Right-click → Kill or × |
| Resize | Drag pane divider |

## AI Harnesses

Launch integrated AI coding agents directly in your workspace.

Harness terminals use a generated wrapper script in the main process so the harness runs without the old inline `bash -i -c` command wrapper. When a harness exits, the terminal falls back to an interactive shell so the pane stays usable.

### Supported Harnesses

| Harness | Command | Description |
|---------|---------|-------------|
| Plain Shell | `bash`/`zsh` | Standard terminal — no wrapper, direct PTY spawn |
| Codex | `codex` | OpenAI Codex CLI |
| Claude | `claude` | Anthropic Claude |
| OpenCode | `opencode` | Open source agent |
| Pi | `pi` | Mario Zechner agent |

**Harness launch model:** Harnesses use one unified wrapper-based spawn strategy. The harness runs as the direct PTY foreground job via a generated shell script (`~/.clanker-grid/harness-wrapper.sh`), not via an inline `bash -i -c` command. When a harness exits, the wrapper script replaces itself with an interactive shell so the terminal pane stays usable. This preserves existing product behavior while fixing the shell-layer signal/TUI issues.

### Harness Flags

Each harness supports configurable CLI flags stored in `electron-store`:

| Harness | Flag | Toggle Label | Behavior |
|---------|------|--------------|----------|
| Codex | `--yolo` | Enable yolo mode | Auto-approve actions |
| OpenCode | `--pure` | Enable pure mode | Skip confirmations |

Flags are configured per-harness in the header settings dropdown. The UI exposes a boolean checkbox for known flags; the store field (`flags: string`) supports future extensibility for additional CLI arguments.

**Flags ownership:**
- Static harness config owns `command`, `env`, `modelArg`
- Store (`harnessDefaults`) owns user-configurable `flags` string
- The renderer only maps known boolean toggles to known flag strings (via `harnessFlagsFromToggle`)

### Harness Default Models

Each harness can have a global default model set in the header settings dropdown. This model is pre-selected when launching a workspace with that harness.

- **Default model** — set in settings, used at spawn time when no workspace-level model is specified
- **Favorites** — pinned models shown in the gate model picker; these are UX-only and never influence automatic launch behavior

### Session History

The **Chat History** button (message icon) in the header opens a dropdown that discovers and displays past AI harness sessions from all supported harnesses:

| Harness | Storage Location |
|---------|------------------|
| Claude Code | `~/.claude/projects/` (JSONL session files) |
| Codex | `~/.codex/sessions/` (session_index.jsonl + JSONL files) |
| OpenCode | `opencode session list --format json` |
| Pi | `~/.pi/agent/sessions/` (JSONL session files) |

**Features:**
- Sessions are grouped by harness type with collapsible sections
- Sessions are filtered by the current workspace path (shows only sessions from the workspace or its subdirectories)
- Sessions display title (first user message), relative timestamp, and harness type
- Click any session to resume it in a new terminal (respects harness default flags from settings)
- Sessions are cached for 60 seconds to avoid repeated file system scans
- Orphaned sessions (sessions not in the index) are automatically discovered and included

**Workspace filtering:** The feature uses path-boundary matching to avoid false positives. For example, `/home/jay/dev/projects/foo` will match `/home/jay/dev/projects/foo/src` but not `/home/jay/dev/projects/foo-old`.

### Selecting a Harness

1. Click the **Harness** pill in the header
2. Choose from available CLIs (unavailable ones are hidden)
3. Some harnesses support model selection

### Gate Model Picker

When creating a workspace, the gate provides a compact model selection flow:

1. **Model pill** — shows the current default model (or "Default model")
2. **Click the pill** — opens the favorites picker showing pinned models
3. **Browse all models** — opens a discovery popover with search across all available models
4. **Select a model** — updates the pill and uses that model for launch

Unresolved models (no longer discoverable) are shown with a warning indicator.

### Terminal Count Presets

When creating a workspace:
- **1** — Single terminal
- **2** — Side-by-side split
- **4** — 2×2 grid

## Editor Pane

The editor pane provides file editing with syntax highlighting:

- CodeMirror-based editor
- Support for JavaScript, TypeScript, Markdown, and more
- Tab-based file management
- Side-by-side diff viewing for git changes
- File change watching with auto-reload prompts
