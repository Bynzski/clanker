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

Current flag and argument behavior is intentionally preserved. A future redesign of the harness argument system is out of scope.

### Selecting a Harness

1. Click the **Harness** pill in the header
2. Choose from available CLIs (unavailable ones are hidden)
3. Some harnesses support model selection

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
