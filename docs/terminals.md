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

When a harness exits, the terminal falls back to an interactive shell so the pane stays usable.

### Supported Harnesses

| Harness | Command | Description |
|---------|---------|-------------|
| Plain Shell | `bash`/`zsh` (Linux/macOS) or `powershell.exe` (Windows) | Standard terminal — direct PTY spawn |
| Codex | `codex` | OpenAI Codex CLI |
| Claude | `claude` | Anthropic Claude |
| OpenCode | `opencode` | Open source agent |
| Pi | `pi` | Mario Zechner agent |

**Harness launch model — Linux / macOS:** Harnesses run as the direct PTY foreground job via a generated shell script (`~/.clanker-grid/harness-wrapper.sh`). When the harness exits, the wrapper script replaces itself with an interactive shell so the pane stays usable.

**Harness launch model — Windows:** No wrapper script is generated. Harnesses are spawned through `cmd.exe /c <harness>` so npm-installed `.cmd` shims resolve correctly. When the harness exits, the pane is replaced by a fresh PowerShell session.

### Harness Flags

Harness flags are configured per-harness in settings as free text and stored in `electron-store`.

Examples:
- Codex: `--yolo`
- Claude: `--dangerously-skip-permissions`
- OpenCode: `--pure` (if desired)

Flags are passed through as entered.

### Harness Default Models

Each harness can have a global default model set in the header settings dropdown. This model is pre-selected when launching a workspace with that harness.

- **Visible** — controls whether the harness appears in the header and workspace gate; enabled by default
- **Default model** — set in settings, used at spawn time when no workspace-level model is specified
- **Favorites** — pinned models shown in the gate model picker; these are UX-only and never influence automatic launch behavior

Hidden harnesses are launch-surface preferences only. They can still resume previous chats when the underlying harness command is installed and available.

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
- Sessions are shown only for harness commands that are currently installed and available
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
3. **Browse all models** — opens a discovery popover with search across available models for harnesses that support discovery
4. **Select a model** — updates the pill and uses that model for launch

Notes:
- Codex models are discovered from the CLI.
- Claude uses free-text model input (no model-list command).
- Unresolved models are shown with a warning indicator.

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
