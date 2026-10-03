# Terminals & AI Harnesses

## Terminals

- Backed by real PTY processes (node-pty)
- Full ANSI color support via xterm.js; xterm.js owns scrollback (10,000 lines)
- Resize-aware: bidirectional resize confirmation loop, coalesced via 100 ms lock
- Session continuity across workspace/tab switches — xterm instances are cached and reused, not remounted blank
- Startup uses a bounded 16 KB buffer + `TERMINAL_READY` renderer handshake to protect early PTY output
- Copy/paste support
- `handleFlowControl: false` is set on all PTY spawns

### Terminal Actions

| Action | Location |
|--------|----------|
| New terminal or AI harness | Click its terminal type in the header |
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
| Oh My Pi | `omp` | OMP coding agent |
| Hermes | `hermes --tui` | Hermes Agent interactive TUI |
| Antigravity | `agy` | Antigravity CLI |

**Harness launch model — Linux / macOS:** Harnesses run as the direct PTY foreground job via a generated shell script (`~/.clanker-grid/harness-wrapper.sh`). When the harness exits, the wrapper script replaces itself with an interactive shell so the pane stays usable.

**Harness launch model — Windows:** No wrapper script is generated. Harnesses are spawned through `cmd.exe /c <harness>` so npm-installed `.cmd` shims resolve correctly. When the harness exits, the pane is replaced by a fresh PowerShell session.

**Harness launch model — Remote Workspaces (SSH):** Remote terminal panes execute on the remote machine via local `node-pty` invoking system `ssh` with interactive pseudo-terminal allocation (`ssh -t`). The remote command changes into the workspace directory and executes the remote harness CLI, then leaves `${SHELL:-/bin/bash} -l` running when the harness exits. Harness availability is probed remotely on the target host; only installed remote CLIs are offered for launch. The remote shell and harness receive no local Agent Attention variables.
### Harness Flags

Harness flags are configured per-harness in settings as free text and stored in `electron-store`.

Examples:
- Codex: `--yolo`
- Claude: `--dangerously-skip-permissions`
- OpenCode: `--pure` (if desired)
- Hermes: `--reasoning low` (if desired)

Flags are passed through as entered.

### Agent attention and pane names

Terminal panes get short Grateful Dead inspired names such as Samson, Delilah, Jerry, and Bobby. Names identify panes in the UI; they are independent of the harness and its session ID.

In **Settings → Harness Defaults**, expand a harness and enable **Agent attention** for future launches. Clanker then uses that harness's supported hooks to show running, needs input, or turn complete in the pane header. Background needs-input and completed turns also mark the workspace tab. The bell button beside the tabs jumps to the next agent needing attention. A working agent shows a spinner, a question waiting for you shows yellow, and a finished turn shows green until you focus that agent; an idle agent shows nothing. Plain shells have no agent status.

Agent attention is opt-in per harness and affects only new terminals. With attention off, the pane has no agent status label. With attention on, the pane shows nothing until a supported event arrives, and returns to nothing when the agent is idle again (after a completed turn has been seen, an interrupt, or exit). It does not parse terminal screen text. Only events from the agent's root session and current foreground turn change the status: subagent, child-session, background and stale events are ignored. Codex, Claude, OpenCode, Antigravity and Hermes (SSH) report running, needs input and turn complete; Pi reports running and settled turns. OMP reports a turn complete only on its main-session `session_stop` (after background jobs drain), not on `agent_end`. Antigravity reports `Stop` only when fully idle. A user-interrupted Codex turn clears the status without a completion alert; Claude has no interrupt hook, so an interrupted Claude turn stays running until the next prompt. A Claude turn that ends on an API error (`StopFailure`) shows as settled, which does not imply success. Process exit retires attention. See the lifecycle contract in `harness-integration.md`. Hook availability can vary with CLI version and user configuration.
Hermes has a remote observer adapter; its attention toggle applies to SSH launches. Local Hermes attention remains unavailable. Chat history, resume/fork, and AI commit are not integrated for Hermes. For Antigravity, chat history is discovered from its SQLite store and resumes via `--conversation`, AI commit message generation is supported via noninteractive piped invocation, and agent attention is fully integrated.

**Remote terminals and Agent Attention:** SSH launches support host-side adapters for all seven harnesses when enabled in harness defaults. Native lifecycle events update the existing badges over the SSH terminal connection. See [Remote Agent Attention](workspaces.md#remote-agent-attention) for events, prerequisites, configuration conflicts, and installed plugin details.
### Harness Default Models

Each harness can have a global default model set in the header settings dropdown. This model is pre-selected when launching a workspace with that harness.

- **Visible** — controls whether the harness appears in the header and workspace gate; enabled by default
- **Default model** — set in settings, used at spawn time when no workspace-level model is specified
- **Favorites** — pinned models shown in the gate model picker; these are UX-only and never influence automatic launch behavior

Hidden harnesses are launch-surface preferences only. They can still resume previous chats when the underlying harness command is installed and available.

### Subscription usage

Click the **Usage** gauge icon between Chat History and Settings to check subscription usage and quota for the active workspace. Codex, Claude, Oh My Pi, Hermes, and Antigravity are supported. OpenCode and Pi are omitted because they do not expose a safe canonical harness-level quota interface. Supported providers remain listed when not installed or unavailable, with a status explaining the result.

For local workspaces, probes use the local harness CLI and its authentication. For SSH workspaces, they use the registered host's installed CLI and authentication; there is no fallback to desktop accounts. Clanker usage adapters do not read credential/auth files. Antigravity requires a safely recognized stable CLI version of at least 1.1.11; older or ambiguous versions are not probed. Claude's probe disables hooks, MCP, and IDE integration and does not start a model turn.

- Providers load independently, so a slow or failing provider does not delay other rows.
- Quota windows show remaining capacity, reset times, and when they were checked. Progress bars represent remaining capacity.
- Opening requests current readings, subject to caching. Polling runs about every 60 seconds while open and stops when closed or when switching workspaces.
- **Refresh** requests fresh readings subject to provider minimum intervals and failure backoff. It is disabled while any selected provider request is in flight or all resolved entries are waiting for their next allowed refresh. Entries without a refresh deadline can be rechecked once loading finishes.
- Failed refreshes preserve last-good measurements with a **Stale** marker. Switching workspaces clears the previous workspace's readings and discards late responses.

In **Settings → Harness Defaults**, expand a supported harness and toggle **Show in Usage**. This is enabled by default and independent of launch visibility. Hidden usage providers are not queried; disabling every provider leaves the popover available with “No usage providers selected”. The trigger waits for saved preferences to load before allowing the popover to open.

Local probes were live-tested during issue #55. Full authenticated Codex/Claude usage on a real SSH host remains a non-blocking smoke-test follow-up: the available host did not have those CLIs installed/authenticated. See the [usage integration guide](harness-integration.md#usage-capability) for provider protocols, security boundaries, and execution limits.

### Session History

The **Chat History** button (message icon) in the header opens a dropdown that discovers and displays past AI harness sessions from all supported harnesses:

| Harness | Storage Location |
|---------|------------------|
| Claude Code | `~/.claude/projects/` (JSONL session files) |
| Codex | `~/.codex/sessions/` (session_index.jsonl + JSONL files) |
| OpenCode | `opencode session list --format json` |
| Pi | `~/.pi/agent/sessions/` (JSONL session files) |
| Oh My Pi | Default profile: `~/.omp/agent/sessions/` (JSONL session files) |
| Antigravity | `~/.gemini/antigravity-cli/conversation_summaries.db` (SQLite store) |

**Features:**
- Sessions are grouped by harness type with collapsible sections
- Sessions are filtered by the current workspace path (shows only sessions from the workspace or its subdirectories)
- Sessions are shown only for harness commands that are currently installed and available
- Sessions display a stored title or first user message, relative timestamp, and harness type
- Click any session to resume it in a new terminal (respects harness default flags from settings)
- Local sessions are cached for 60 seconds to avoid repeated file system scans; SSH history is read from the registered host
- Orphaned sessions (sessions not in the index) are automatically discovered and included

**Workspace filtering:** The feature uses path-boundary matching to avoid false positives. For example, `/home/jay/dev/projects/foo` will match `/home/jay/dev/projects/foo/src` but not `/home/jay/dev/projects/foo-old`.

**Remote session isolation:** SSH Chat history discovers supported harness conversations on the registered host and never scans desktop session files. Resume revalidates the selected conversation and its canonical working directory before opening an SSH terminal. Clanker keeps no record of a launch, so history always reflects the host's own current metadata; a conversation finished through Clanker appears there like any other. Hermes history and remote process persistence remain unavailable. See [SSH session history](workspaces.md#ssh-session-history) for supported harnesses and limits.

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

Model choices in the gate are scoped to the selected harness. Switching harnesses
uses the new harness's default or previously selected model, never a model from
the harness you switched away from.

The gate's model picker and local default model resolution apply to local workspaces. SSH workspaces discover installed harnesses on the host but do not discover or pass model selections in V1; the remote CLI uses its own configured default.

Notes:
- Codex models are discovered from the CLI.
- OMP models are discovered from `omp models --json`; the catalog may include models that require account credentials.
- OMP history currently scans the default session directory only. Sessions stored by profiles or session directory overrides do not appear in Clanker's history.
- Hermes discovers configured provider models through its local `model.options` gateway. The model ID appears before the provider so similarly named subscription variants remain visible; use **Refresh Hermes models** in settings or the workspace gate to query live connector catalogs instead of the fast cached listing. A refresh can take up to 45 seconds and retains prior choices if it fails. Settings and the gate support favorites and custom model IDs even when discovery is unavailable. A selected catalog model launches with `-m <model> --provider <provider>`; manually entered IDs still use `-m <model>`. Leave the default empty to let Hermes choose its own model. No Hermes shortcut is assigned in the workspace gate.
- Claude's model ID can be entered in **Settings → Harness Defaults**; the gate does not provide a free-text model field.
- Unresolved models are shown with a warning indicator.

See the [harness integration playbook](harness-integration.md) when adding another CLI.

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
