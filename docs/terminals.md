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

**Harness launch model — Windows:** No wrapper script is generated. The command is resolved via `PATH`/`PATHEXT` (`resolveHarnessPtySpawn()`): `.exe` files launch directly, npm-installed `.cmd` shims go through `cmd.exe /d /s /c` with escaped arguments, and unsafe arguments (`%`, CR/LF) or an unresolvable command fail closed. When the harness exits, the pane is replaced by a fresh PowerShell session.

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

Terminal panes get short Grateful Dead inspired names such as Samson, Delilah, Jerry, and Bobby, picked at random from a list of more than 80 and unique within a workspace (a numeric suffix appears only if a workspace uses every name). Recently assigned names are avoided so they spread across workspaces. Names identify panes in the UI; they are independent of the harness and its session ID.

In **Settings → Harness Defaults**, expand a harness and enable **Agent attention** for future launches. Clanker then uses that harness's supported hooks to show running, needs input, or turn complete in the pane header. Background needs-input and completed turns also mark the workspace (its badge on the sidebar row or tab), each agent row in the sidebar shows its own state, and the collapsed sidebar rail shows a dot on each agent's harness icon and a badge on the workspace mark. The bell button (in the sidebar header or rail, or beside the tabs in Tabs mode) jumps to the next agent needing attention. A working agent shows a spinner, a question waiting for you shows yellow, and a finished turn shows green until you focus that agent; an idle agent shows nothing. Plain shells have no agent status.

Agent attention is opt-in per harness and affects only new terminals. With attention off, the pane has no agent status label. With attention on, the pane shows nothing until a supported event arrives, and returns to nothing when the agent is idle again (after a completed turn has been seen, an interrupt, or exit). It does not parse terminal screen text. Only events from the agent's root session and current foreground turn change the status: subagent, child-session, background and stale events are ignored. Codex, Claude, OpenCode, Antigravity and Hermes (SSH) report running, needs input and turn complete; Pi also reports supported foreground extension dialog waits; its final settled outcome distinguishes completed, interrupted and failed turns. Not all built-in prompts are covered. OMP reports a turn complete only on its main-session `session_stop` (after background jobs drain), not on `agent_end`. Antigravity reports `Stop` only when fully idle. A user-interrupted Codex turn clears the status without a completion alert; Claude has no interrupt hook, so an interrupted Claude turn stays running until the next prompt. A Claude turn that ends on an API error (`StopFailure`) shows as Failed, never as a completed turn. Process exit retires attention. See the lifecycle contract in `harness-integration.md`. Hook availability can vary with CLI version and user configuration.
Hermes has a remote observer adapter; its attention toggle applies to SSH launches. Local Hermes attention remains unavailable. Chat history, resume/fork, and AI commit are not integrated for Hermes. For Antigravity, chat history is discovered from its SQLite store and resumes via `--conversation`, AI commit message generation is supported via noninteractive piped invocation, and agent attention is fully integrated.

**Remote terminals and Agent Attention:** SSH launches support host-side adapters for all seven harnesses when enabled in harness defaults. Native lifecycle events update the existing badges over the SSH terminal connection. See [Remote Agent Attention](workspaces.md#remote-agent-attention) for events, prerequisites, configuration conflicts, and installed plugin details.
### Harness Default Models

Each harness can have a local default model set in **Settings → Harness Defaults**. Opening a workspace does not select a harness or start it.

- **Visible** — controls whether the harness appears in the Header and isolated-agent picker; enabled by default
- **Default model** — used by local launches when no explicit launch model is specified
- **Favorites** — pinned choices in the settings model picker; never an automatic model selection

Hidden harnesses are launch-surface preferences only. They can still resume previous chats when the underlying harness command is installed and available.

### Subscription usage

Click the **Usage** gauge icon between Chat History and Settings to check subscription usage and quota for the active workspace. Codex, Claude, Oh My Pi, Hermes, and Antigravity are supported. OpenCode and Pi are omitted because they do not expose a safe canonical harness-level quota interface. A supported harness that is not installed in the workspace's environment (the local machine or the SSH host) is hidden and is never probed. Installed providers stay listed with a status when they are unavailable, for example “Not signed in” or “Usage temporarily unavailable”.

For local workspaces, probes use the local harness CLI and its authentication. For SSH workspaces, they use the registered host's installed CLI and authentication; there is no fallback to desktop accounts. Clanker usage adapters do not read credential/auth files. Antigravity requires a safely recognized stable CLI version of at least 1.1.11; older or ambiguous versions are not probed. Claude's probe disables hooks, MCP, and IDE integration and does not start a model turn.

- Providers load independently, so a slow or failing provider does not delay other rows.
- Quota windows show remaining capacity, reset times, and when they were checked. Progress bars represent remaining capacity.
- Opening requests current readings, subject to caching. For local workspaces, a best-effort background read shortly after the workspace opens (only when the app is idle) lets the first opening show results immediately; SSH workspaces are never probed in the background. Polling runs about every 60 seconds while open and stops when closed or when switching workspaces.
- **Refresh** requests fresh readings subject to provider minimum intervals and failure backoff. It is disabled while any selected provider request is in flight or all resolved entries are waiting for their next allowed refresh. Entries without a refresh deadline can be rechecked once loading finishes.
- Failed refreshes preserve last-good measurements with a **Stale** marker. Switching workspaces clears the previous workspace's readings and discards late responses.

In **Settings → Harness Defaults**, expand a supported harness and toggle **Show in Usage**. This is enabled by default and independent of launch visibility. Hidden usage providers are not queried; when no provider is both installed here and enabled, the popover shows “No usage providers available”. The trigger waits for saved preferences to load before allowing the popover to open.

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
- Sessions include the workspace, its subdirectories and attributable linked-worktree conversations (labelled by branch, including removed checkouts)
- Sessions are shown only for harness commands that are currently installed and available
- Sessions display a stored title or first user message, relative timestamp, and harness type
- Click any session to resume it in a new terminal (respects harness default flags from settings)
- Opening history refreshes native metadata; local idle warm-up may use a 60-second cache, while SSH history is read from the registered host
- Provider failures show warnings alongside usable conversations; a failed refresh keeps the last useful list
- Orphaned sessions (sessions not in the index) are automatically discovered and included

**Workspace filtering:** Path-boundary matching avoids false positives: `/projects/foo` matches `/projects/foo/src`, not `/projects/foo-old`. Sibling worktrees require main-owned Git, checkout or provenance evidence; a `*-worktrees` directory name alone is not proof.

**Removed checkouts:** Live worktree conversations resume into their validated checkout. If it is gone, Claude, Codex and OMP can resume in the main checkout with a notice; Pi, OpenCode and Antigravity need confirmed recreation from the original branch or report why it cannot be recreated. Resume rechecks native metadata before any launch.

**Remote session isolation:** SSH Chat history discovers supported harness conversations on the registered host and never scans desktop session files. Resume revalidates the selected conversation and its canonical working directory before opening an SSH terminal. Clanker keeps no record of a launch, so history always reflects the host's own current metadata; a conversation finished through Clanker appears there like any other. Hermes history and remote process persistence remain unavailable. See [SSH session history](workspaces.md#ssh-session-history) for supported harnesses and limits.

### Hermes Assistants

Hermes Assistants are an **optional** feature for people who already use named Hermes profiles. They are separate from the ordinary Hermes launcher in the toolbar, which keeps working exactly as before (including with only the default profile, and without `hermes serve`).

**Turning it on.** The feature is hidden entirely when the Hermes CLI is not installed. Otherwise, open **Settings → Hermes Assistants** and enable it. By default Clanker only connects to a Hermes service that is already running locally. Turn on **Start Hermes service when needed** to let Clanker start `hermes serve` itself; Clanker stops only a service it started and never one you were already running. Hover the info icon for the current connection state.

**Who appears.** Every named Hermes profile appears under **ASSISTANTS** in the sidebar (and as icons in the collapsed sidebar or a compact row in Tabs mode). The raw `default` profile intentionally does not appear, because the toolbar's Hermes launcher already represents it. There is no pinning and no Add Profile screen: create and configure profiles in Hermes, and a Bot title or description set there is used as the display name.

**Opening an Assistant.** Click a name such as Fred to open that profile's persistent Hermes **Bot Chat**. Each profile has exactly one, so coming back later resumes the same conversation. If a profile has never had one, Clanker creates it on first open without sending any message to the model. The profile keeps its own working directory; opening Fred from different workspaces does not move it.

**The Assistant surface.** Hermes' own terminal UI is the main content. The Browser toolbar button opens an embedded Browser as a right-hand companion panel that you can resize and close. That Browser belongs to the Assistant: it is independent of any workspace's Browser. Switching to a workspace and back leaves Fred's terminal and Browser exactly as they were, and opening a new workspace while Fred is active simply takes you to the new workspace while Fred stays ready. Turning Assistants off closes these surfaces.

**What is not available in Assistant mode.** Assistants are not workspaces, so the toolbar shows only what applies: Browser and Settings. Files, Git and worktrees, Notes, Launch Recipes, the terminal launchers, isolated agents, workspace chat history, workspace usage and the layout Fit/Undo tools are hidden rather than acting on whichever workspace you used last.

**Starting without a workspace.** The normal app shell always mounts. Enabled Assistants are reachable through the sidebar or Tabs-mode strip even with no workspace open. Choosing one creates no dummy workspace or folder. Open a workspace later with **Open Workspace**: it becomes active while the Assistant stays parked. If opening fails, you stay on the Assistant. Disabling Assistants with no workspace leaves the empty normal shell, not a separate startup launcher.

### Launching and choosing models

Click a visible, installed harness in the Header to launch one terminal into the current registered checkout. Use **New isolated agent** for a different working copy, or an explicit local recipe for multiple launch steps. Open Workspace itself has no harness, model or terminal-count controls.

Local defaults are configured in **Settings → Harness Defaults**. Supported model catalogs offer search and favorites there; Claude supports a manually entered model ID. OMP catalogs may include models requiring credentials, and OMP history currently scans only its default session directory.

Hermes discovers provider-aware models through its local `model.options` gateway. **Refresh Hermes models** in Settings requests live connector catalogs (up to 45 seconds) and preserves previous choices if it fails. Catalog choices preserve model and provider; manually entered IDs pass only the model. Leave the default empty to let Hermes choose.

SSH Header launchers use the host CLI's configured model, never the desktop default. Remote model discovery remains a provider capability for supported runtime callers, not a model picker in Open Workspace.

### Optional Clanker bridge

Enable **Clanker bridge (MCP)** in Harness Defaults for local Claude, Codex, OpenCode or Pi launches. The authenticated loopback bridge exposes read-only workspace context and never edits project or user MCP configuration. Pi receives context only. Claude, Codex and OpenCode can also receive isolated-checkout lifecycle tools when native attention is enabled: these resume the same conversation at the new root, not the same live turn. SSH and other harnesses are unsupported.

See the [harness integration playbook](harness-integration.md) for capability contracts.

## Editor Pane

The editor pane provides file editing with syntax highlighting:

- CodeMirror-based editor
- Support for JavaScript, TypeScript, Markdown, and more
- Tab-based file management
- Side-by-side diff viewing for git changes
- File change watching with auto-reload prompts
