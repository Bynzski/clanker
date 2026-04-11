# Terminals & AI Harnesses

## Terminals

- Backed by real PTY processes
- Full ANSI color support via xterm.js
- Resize-aware (resizes with pane)
- Copy/paste support

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
| Plain Shell | `bash`/`zsh` | Standard terminal |
| Codex | `codex` | OpenAI Codex CLI |
| Claude | `claude` | Anthropic Claude |
| OpenCode | `opencode` | Open source agent |
| Pi | `pi` | Mario Zechner agent |

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
