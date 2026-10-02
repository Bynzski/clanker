# Workspaces

Workspaces provide isolated development environments within a single window.

## Creating a Workspace

1. Click **Open Workspace** (`+`) beside the workspace tabs
2. Enter or browse to a local directory
3. The workspace opens in a new tab

For local workspaces, the native directory picker can create a new directory before opening the workspace on platforms that support it. SSH workspaces use Clanker's own remote chooser and **New Folder** action.

### Task worktrees

Click the **Worktree** side of the launch button to slide from the workspace launcher to the task worktree options. Use **Back to workspace** to return to the normal launcher. To make a separate checkout for a task:

1. Select a Git repository directory and click **Load repository**.
2. Choose a base ref and enter a task branch name.
3. Click **Create and open worktree**. Clanker creates the checkout beside the repository, then opens it as a normal workspace with its own terminals, editor, browser, and Git state. For a new branch, Clanker creates it from the base ref. If the branch already exists without a checkout, Clanker uses that branch, which also lets you retry after a failed checkout.

If a local branch and tag share a name, the base ref uses the branch. Enter `refs/tags/<name>` to use the tag.

The launcher also lists existing linked worktrees. Click **Open** to use one without recreating it. Several conversations or terminals can share a worktree workspace; create another worktree when work needs separate files and a branch.

For SSH worktrees, first open a repository workspace on the remote host. In **New Workspace → SSH Remote**, select the same saved target and click **Worktree**. Choose an open SSH repository to discover its existing checkouts, then click **Open** beside a checkout. Discovery uses that repository's registered workspace identity, and the selected checkout opens in the same SSH environment after remote path validation. **Refresh worktrees** retries discovery or reloads the list after changes made on the host. Missing checkouts cannot be opened; a Git worktree lock does not prevent opening.

To create an SSH worktree, enter a **Base ref** and **Worktree branch**, then click **Create and open worktree**. New branches start from the base ref (default `HEAD` of the selected repository workspace); existing branches keep their current commit. As with local creation, a branch takes precedence over a tag with the same name. The remote checkout is created in `<repository>-worktrees` beside the main repository, using a unique directory name derived from the branch. Existing destinations and symlinked parent directories are rejected. If SSH disconnects or creation fails, refresh the list before retrying: Git may have completed the checkout, and partial files or branches are preserved.

Click **Inspect** beside a remote linked checkout to check whether it has tracked changes, untracked files, or ignored files. Inspection checks repository identity and reports locked or missing checkouts. It checks initialized submodules recursively, including ignored files, and overrides submodule ignore settings. Inspection is limited to 128 repositories including the parent checkout; incomplete inspection reports an error rather than a clean result. Close workspaces and stop terminals using the checkout before checking removal readiness; Clanker includes workspace and terminal directories from equivalent OpenSSH destinations, including duplicate saved environments and matching aliases, even if a terminal outlives its workspace registration. Results describe the checkout at inspection time. Inspection is read-only. To remove a clean remote checkout, click **Remove…** and confirm the displayed checkout path and branch. Clanker rechecks cleanliness, branch identity, open workspaces, and active terminal directories before removal. Main, locked, missing, dirty, and submodule-containing checkouts cannot be removed through this flow.

Remote removal preserves checkout files under `<checkout-parent>/.clanker-worktree-recovery/removed-<id>/checkout` and records the original path and branch in `recovery.json` beside that folder. The preserved folder is a file recovery copy, not a registered Git worktree; its old `.git` pointer is no longer valid. The branch remains available, so you can create a new worktree for it and copy needed files from the recovery folder. Recovery and operation-journal folders must be owned by the SSH account with private permissions (`0700`). Existing unsafe folders are rejected before the checkout is moved; Clanker does not change their permissions. Recovery folders are not automatically purged. If SSH loses the removal result, paths stay reserved until **Refresh worktrees** verifies that operation's completion journal on the host. If verification cannot complete, Clanker shows the staging and recovery paths for manual host inspection. Do not reopen them while the operation may still be running.

Closing a workspace tab stops its live terminals and closes its UI; it leaves the checkout and branch on disk. To remove a local checkout, return to **Task worktree**, load the repository, and choose **Remove…** on a closed worktree. Clanker checks for uncommitted, untracked, and ignored files, then asks you to confirm the exact path and branch. Removal moves the checkout to the system Trash and unregisters it from Git, preserving files written during removal. The branch remains.

New worktrees contain Git tracked files from the base commit. Local ignored files such as `.env` and installed dependencies are not copied automatically; set up those files in the new checkout as needed.

Removal safeguards share an opaque resource identity for saved SSH aliases whose effective OpenSSH hostname, user, port, and proxy route match. Workspace tabs and task records retain their separate saved environment identities. Different destination names (for example, a DNS name and its numeric IP) or different proxy routes are not assumed equivalent; use one saved environment when accessing the same repository through those routes.

Pending removal records are saved before dispatch and restored when Clanker restarts. After an interrupted removal, open the owning repository and use **Refresh worktrees** to verify the host completion journal. Until verification succeeds, conflicting opens and terminal launches remain blocked. A missing or incomplete journal requires host inspection; loss of SSH connectivity never proves that removal finished.

## Remote Workspaces (SSH)

Clanker supports opening workspaces on remote Linux/POSIX development machines reachable via SSH. The local Clanker desktop app provides the editor, terminal grid, and Git interface, while the remote development machine owns the filesystem, Git checkout, shell processes, and coding agents.

### Local vs. SSH Environments

- **Local environment (`local`)**: The default built-in environment. Files, terminals, worktrees, and processes run directly on the machine running Clanker.
- **SSH Remote environments**: Configured targets pointing to remote Linux/POSIX servers (such as a public VPS, cloud instance, homelab machine, or Tailscale node).

### Selecting a Remote Directory

Choose a saved SSH environment in the launcher. In **Manage SSH Targets**, add or edit a target's optional **Default workspace root** using an absolute remote path, such as `/srv/repos`. Clanker starts there when it is accessible, resolving symlinks to the canonical path. If the setting is blank or unavailable, it falls back to `$HOME/workspaces`, then `$HOME`. Clearing the field restores that automatic choice. Targets cannot be edited or deleted while an open or registering workspace uses them, or a pending worktree removal protects them. **Browse remote directories** opens an application-rendered chooser, not an operating-system folder dialog. It lists remote directories over SSH, lets you navigate to parent folders, create a remote folder with **New Folder**, and select a target folder. The path field also offers debounced remote directory suggestions; an absolute path can still be entered manually. The default root is a browsing preference; workspace file operations remain confined to their registered root.

Pre-workspace browsing and folder creation are resolved from the saved SSH environment ID and can reach directories the SSH account is allowed to access. Browsing returns directory names and canonical paths only; it cannot read file contents. Folder creation validates name safety and creates only a direct child of the selected canonical parent when that directory is writable. After selection, workspace registration validates and canonicalizes the root. All subsequent filesystem requests remain confined to that registered root.

### Workspace Identity

Workspace identity is composite:

```text
environmentId + canonical workspace path
```

This ensures that a workspace on `dev-vps:/home/jay/Projects/clanker` is a distinct identity from `local:/home/jay/Projects/clanker`. Both can be open simultaneously in the same window without layout or notes state collision. SSH paths are canonicalized on the remote host before registration, and subsequent file, Git, and terminal requests use that registered location.

Tab labels clearly display the environment prefix (e.g., `Local · clanker` vs. `dev-vps · clanker`).

### OpenSSH Transport & Credentials

Clanker uses the system OpenSSH client (`ssh`). It respects:
- `~/.ssh/config` (Host aliases, Port, User, ProxyJump, IdentityFile)
- Active `ssh-agent` keys
- Known hosts verification
- Tailscale SSH and MagicDNS hostnames

Clanker **never** stores SSH passwords or private keys in application state, nor does it disable host-key verification. Saved SSH targets only store non-secret metadata (a label and the connection target string).

Saved SSH targets cannot be edited or deleted while an open workspace uses them. Close the workspace first, then update or remove the target.


### Remote Prerequisites & Platform Support

- **Supported Remote Platforms**: Linux and POSIX-compatible operating systems (x86_64, ARM64). Remote Windows hosts are not supported in V1.
- **Prerequisites**: OpenSSH server running on the remote host, with key-based authentication or ssh-agent configured for noninteractive background operations. Python 3 is required on the remote host for root-confined filesystem operations and atomic writes.

Remote harness commands are discovered and executed on the remote host using its shell environment. Configured harness flags and applicable harness environment settings are applied to new remote terminals; local CLI installations and desktop Agent Attention credentials are not forwarded. Remote attention uses host-side adapters when enabled in harness defaults. Remote model discovery and selection are deferred in V1, so Clanker does not pass a locally selected default model to a remote harness.

### Remote Agent Attention

Enable **Agent attention** in the harness defaults before launching a new SSH agent terminal. The existing pane and workspace badges show native lifecycle events. Main decides which events are authoritative: each is correlated to the terminal's root agent session and current foreground turn, so subagent, child-session, background and stale completions never show Turn complete. Events contain only lifecycle names and bounded session/turn IDs; prompts, tool arguments, and model output are excluded. They use the existing SSH terminal connection, with a fresh credential bound to that terminal. No desktop listener secret, additional listener, port forward, or remote daemon is used.

| Harness | Native events used |
| --- | --- |
| Codex | Native hooks: prompt submission, permission requests, tool completion, root stop (subagent stop is ignored), and session end. |
| Claude | Prompt submission, permission requests, input notifications, tool completion, root stop (only when no background work is pending), and session end. |
| OpenCode | Busy/idle of the verified top-level session (child sessions are ignored), permission/question requests and replies, and session deletion. |
| Pi | Agent start, agent settled, and session shutdown. |
| OMP | Main-agent start, main-session stop (after background jobs drain), and session shutdown. |
| Antigravity | Initial invocation, interactive ask-tool requests/replies, and stop only when fully idle for the root conversation. |
| Hermes | Root turn start/completion, human approval requests/replies (smart approvals and child sessions are ignored), and session finalize through observer hooks. |

A native session change in a live agent (clear, switch) keeps attention registered and lets the new session bind; harness exit retires attention before the fallback shell. Resuming a session seeds its host-validated ID for providers that keep it; forks start unbound. Missing native events remain unknown; terminal output is never interpreted as an agent state. Codex, Claude, Pi, OMP, and Antigravity require Node.js on the host for hooks. OpenCode uses its own JavaScript runtime; Hermes uses Python and must support its observer plugin API.

Clanker refuses launches with attention enabled when hook configuration conflicts: Codex profiles or existing hook configuration, Claude explicit settings/bare/safe mode, OpenCode a custom config directory/pure mode/attached server, Pi/OMP disabled extensions, or Hermes custom profiles. Disable attention to use those launch modes. Existing user hook files are preserved.

Antigravity installs an owned plugin at `~/.gemini/config/plugins/clanker-grid-remote-attention`; Hermes installs one at `~/.hermes/plugins/clanker-grid-remote-attention` and enables it with `hermes plugins enable`. These plugins remain installed and are inert without Clanker's per-launch environment. Antigravity hooks return an empty response when the launch credentials are absent; Clanker upgrades the exact prior owned hook configuration and refuses unrelated edits. Clanker refuses unowned/conflicting files and writable-by-other-users plugin folders. Hermes settings retain the enabled plugin entry; to uninstall, disable it through Hermes before removing that owned plugin directory. Other launch files use private temporary folders and are cleaned after exit where SSH remains available; interrupted connections can leave private temporary folders for manual cleanup.

Local Hermes attention remains unsupported. Remote annotation handoff remains unavailable.

Renderer crashes release workspace registrations, polling, terminals, and previews. App quit waits for managed preview SSH clients to terminate and for started terminal cleanup to finish. Private host launch files are cleaned where SSH remains reachable.

### SSH session history

Open **Chat history** in an SSH workspace to browse that host's sessions for the workspace and its subdirectories. Clanker discovers installed Codex, Claude, OpenCode, Pi, OMP, and Antigravity harnesses and reads their native metadata remotely. Desktop history is never used for an SSH workspace. Antigravity requires a conversation with an explicit matching workspace path. Hermes session history remains unsupported.

Click a remote history entry to resume its conversation in a new SSH terminal in the same environment. Clanker re-reads the host session before launching and validates the workspace, working directory, installed harness, and session file. A missing session, conflicting session-selection flags in harness defaults, or a closed/removed workspace produces an error. Switching workspaces while a resume is pending attaches the terminal to the original workspace; closing that workspace cancels or cleans up the launch. Clanker keeps no record of the launch itself, so the history shown is always the host's own current metadata. SSH/discovery failures appear in the history menu; close and reopen it to retry. Switching workspaces closes the menu and discards pending results from the previous workspace.

Discovery uses bounded metadata reads and omits messages beyond the first 256 KiB of each JSONL file. OpenCode requests up to 4,097 rows to detect histories beyond the 4,096-row scan limit; it does not rely on the CLI default page. Conflicting metadata for the same harness/session ID reports an error. Large histories can exceed the scan/result limits and report an error. Custom session-store locations are not supported in this slice.

### SSH browser previews

Start a development server on the SSH host, then open the workspace's **Browser** pane. The small **Remote preview** server icon in the existing toolbar exposes detected HTTP/HTTPS services. Its menu is closed by default; there is no permanent preview panel. A single workspace-owned service forwards and opens automatically; choose **Open** for multiple services or an unscoped listener. **Detect services** requests a fresh scan. **Forward port manually…** is a fallback asking only for the remote port and protocol. Clanker chooses the desktop port, preferring the matching port when available and retrying conflicts automatically.

Workspace ownership comes from the listener process's canonical working directory, or a loopback URL printed by that workspace's SSH terminal. A port number alone never establishes ownership. Listener discovery uses `ss`, then `lsof`, or eight conventional development ports when neither utility exists. It probes at most 32 loopback endpoints, four at a time, with short deadlines and bounded output. IPv4/IPv6 loopback and wildcard listeners are supported; the desktop listener always binds to `127.0.0.1`.

Discovery is demand-driven by the visible, active Browser. Workspaces on the same resolved SSH host share one inventory command. Startup uses a short adaptive burst, then backs off to one scan per minute; terminal URLs and **Detect services** accelerate scanning. Hiding Browser or switching away releases the discovery lease. Managed tunnels remain alive and health checks use the existing local forward rather than additional SSH commands.

SSH transport readiness and web-service readiness are separate. **Waiting for remote service** means the tunnel is established but the application is unavailable. Delayed startup and server restarts recover automatically on the same tunnel and reopen the selected preview. A newly detected workspace-owned port can replace the previous automatic preview. SSH forwarding policy rejection, authentication/host-key failures and disconnects are transport errors; restore connectivity/policy and choose **Open** again. Low-level SSH diagnostics are not displayed in Browser.

Each workspace supports four independent forwards, with at most 16 across the app. **Stop** in the preview menu, workspace close, window close, renderer loss and app shutdown release connections. Browser URLs may persist, but forwarding rules do not. Managed previews retain normal host-key verification and reject targets with preconfigured forwards. They use system OpenSSH `-N` and bounded ephemeral discovery commands: no Clanker daemon, installed helper or persistent remote service is introduced. Privileged ports and persisted forwarding rules remain unsupported.

### Remote limits and refresh behavior

Remote capabilities have the following limits in V1:

1. **Submodule Worktree Removal**: Remote worktrees containing submodules cannot be removed through Clanker. Other clean remote checkouts can be removed with a preserved file recovery copy; discovery, creation, and inspection are available from open SSH repositories.
2. **Launch Recipes**: Creating, editing, or launching recipes for SSH workspaces is unavailable in V1. Legacy recipes without an environment ID remain local recipes.
3. **Reveal in File Manager**: Disabled for remote paths, preventing passing remote paths to desktop OS file managers.
4. **File Refresh**: One batched SSH poll checks the active workspace about every three seconds. It monitors up to 128 open editor files and 128 visible/expanded Explorer directories, scanning only direct directory children (up to 2,000 entries per directory). Changes refresh Explorer and reload clean editor tabs; dirty tabs keep their buffers and receive an external-change indicator. Polls do not overlap, back off after connection failures, and stop when their workspace closes. Parked workspaces are checked again when activated. Manual Refresh and the existing desktop-focus refresh remain available for larger directories and immediate updates.
5. **Remote Session Recovery**: Host discovery, manual resume, known-ID verification, and conservative association of newly launched tasks are supported for six harnesses. Legacy tasks, failed pre-launch scans, and ambiguous matches need manual session selection. Hermes history remains unsupported.
6. **Persisted Forwarding Rules**: SSH web service discovery and automatic forwarding are supported while Browser is active; saved forwarding rules remain deferred.
7. **Remote Process Persistence**: Remote PTY processes terminate on workspace closure or app exit; PTY daemons are not installed on the remote machine.
8. **AI Commit Generation**: Disabled for SSH workspaces; manual Git commits work remotely. Local model/CLI discovery is never used to represent a remote host.

## Managing Tabs

- **Switch workspaces**: Click a workspace tab
- **Reorder**: Drag a tab onto another tab, or focus it and press `Alt+Shift+Left/Right`. The saved order is restored when workspaces reopen.
- **Rename**: Double-click a tab name
- **Close**: Click the × on a tab
- **Attention badge**: Shows agents needing input or completed turns when agent attention is enabled
- **Worktree label**: Linked worktrees show their branch

## Per-Workspace State

Each workspace retains:
- Terminal list and count
- Pane layout arrangement
- Browser tabs and active URL (when enabled)
- Editor tabs and active tab
- File explorer state (expanded paths, selected path)
- Selected harness and model
- Notes pane visibility and content
- Active terminal selection

### Harness and Model Selection

Workspaces store their own harness and model selection independently:

- **Workspace harness + model** — highest priority at spawn time
- **No harness set** — spawns a plain shell; global harness defaults are not inferred
- **Flags** — read from global store defaults (not per-workspace)

Global harness defaults (model, favorites, flags, visibility, agent attention) are configured in the header settings dropdown. For local workspaces, the model is preselected in the launcher when a harness is chosen, and flags and attention settings apply to new harness terminals. For SSH workspaces, configured flags apply, and Agent Attention can be enabled per harness, while remote model selection remains unavailable. See [Configuration](configuration.md#harness-defaults).

## Layout Controls

| Action | Description |
|--------|-------------|
| **Fit All** | Reset panes to balanced sizes |
| **Drag** | Rearrange terminal, Browser, Editor, and Notes panes from their drag grip |
| **Dock** | Drop onto a workspace edge or one side of a pane to create a split |
| **Swap** | Drop onto the center of another pane to swap positions |
| **Undo** | Restore the previous layout arrangement |

### Docking Panes

Dragging a pane reveals two levels of drop targets:

- **Workspace edges** — Four bands along the outer edge. Dropping here creates a full-height or full-width split, with the moved pane initially taking 30% of the workspace.
- **Pane zones** — Each pane has left, right, top, bottom, and center zones. Edge zones split that specific pane; the center swaps the two panes.

The preview rectangle shows the exact destination before the drop. Dragging uses a lightweight preview card, and native browser content is temporarily hidden so it cannot cover the docking targets.

The Explorer is a separate, resizable left sidebar and does not join the pane layout tree.

#### Dock behavior

| Drop target | Result |
|-------------|--------|
| Workspace edge | Full split along the outer edge |
| Pane edge | Pane inserted beside that specific pane |
| Pane center | Pane positions swapped |

## Persistence

The app remembers the last workspace path. Layout topology, split sizes, note content, and notes visibility are stored separately by environment and canonical workspace path; old path-only local data is restored for local workspaces and migrated on the next write. Pane IDs are regenerated safely and are not persisted directly. Workspace tabs can be dragged or moved with `Alt+Shift+←/→`; their chosen order is remembered by workspace identity when those workspaces are reopened. The app does not automatically reopen all tabs after restart.

Terminal processes and their runtime state are not reconstructed from layout persistence.

## Workspace Launch Recipes

Launch recipes are available for local workspaces only in V1. SSH workspace recipes are rejected rather than executed locally.

Workspace launch recipes allow saving repeatable development workspace configurations. A recipe captures:

- **Workspace Path** — Canonical normalized directory path.
- **Launch Steps** — Sequential list of shell commands and AI agent harnesses (with optional model selections).
- **Browser Preview URL** — Optional local or remote web address to navigate on launch.
- **Pane Layout** — Associated layout topology.

### Storage & Security

- Recipes are persisted in `electron-store` under `workspaceRecipes`.
- **Explicit Trust Boundary**: Opening a workspace or selecting a recipe **never automatically executes commands**. Commands and harnesses are explicitly presented in an inspection preview before launch.
- Execution requires an intentional user action ("Launch Recipe").
- Recipe terminal commands run inside standard PTY shells using Clanker's existing terminal architecture and security boundaries.
- Browser preview URLs are sanitized using trusted URL validation (`http:`, `https:`, local `file:`).
- **Partial Failure Handling**: If a specific command or browser preview fails, successful terminals remain open and running. Failures are reported with structured per-step error diagnostics without destroying the workspace.
- **Launch Safety**: Explicit recipe slots require an empty workspace. A populated target is left untouched and the launch returns a clear error. Legacy recipes without slots still fill missing plain terminals up to `terminalCount`.
- **Startup and Preview Results**: Command steps report an immediate exit when observed through the existing PTY; long-running commands are marked started after a short observation window. Local preview ports are checked before command launch for a busy port and retried briefly after launch for readiness. Recipe browser navigation observes `loadURL()` failure.

## Conversation History & Resume

Chat History lists each harness's own conversations for the active workspace. Clanker keeps no durable record of a launch: the entries you see are the harness-native session metadata that already exists on the environment that owns them.

### Runtime vs. Process Separation

- **PTY processes do not survive application restarts**. Clanker does not implement terminal daemons or pretend disconnected PTYs are alive.
- **Conversations do survive**, because the harness writes them, not Clanker. Resuming always starts a fresh process attached to that native conversation.
- **Remote Process Persistence Proposal**: SSH process persistence/reconnect is not implemented. The [architecture proposal](remote-process-persistence-design.md) evaluates transports and recommends opt-in tmux sessions with separate process and attachment lifetimes. It defines disconnect/stop behavior, worktree protections, and the Agent Attention release gate; this is a design for review, not an available launch setting.

### Native Conversation Resume

Selecting a history entry attaches a new PTY process directly to the AI harness's existing native conversation (e.g., `codex resume <id>`, `claude --resume <id>`, `opencode --session <id>`, `pi --session <path>`, `omp --resume <path>`, `agy --conversation <id>`).

Native conversation resume is supported locally and over SSH for the harnesses above. Main re-validates the workspace, working directory, installed harness, and harness-specific session metadata before spawning; a missing session, conflicting session-selection flags, or a closed/removed workspace produces an error in the dropdown rather than an empty history. Supported native forks create a new conversation on the host. This never reconnects the original process.

- **No Prompt Replay**: The user's original prompt is never replayed or re-executed.
- **Scoped Launch**: The resumed terminal is attached to the workspace that owns the conversation. Switching workspaces mid-resume does not move it, and closing that workspace kills the orphaned terminal.

See [Workspace Launch Recipes and Native Conversation History](recipes.md#6-conversation-history) for the discovery, resume, and provider-capability contracts.

SSH Browser tabs share a private in-memory session per workspace. Cookies/storage are isolated from other SSH workspaces and local browsing. Ordinary browsing inside an SSH workspace also uses that private session; closing the workspace clears it. Local Browser sessions retain existing persistent global logins.

HTTPS discovery/health can identify self-signed development servers, but the embedded Browser still requires a trusted certificate valid for the forwarded hostname (`127.0.0.1`). A certificate only for `localhost`, or a development CA trusted only on the SSH host, is insufficient. A rejected certificate appears in the remote-preview menu; it does not stop the SSH tunnel. Use HTTP or configure suitable desktop trust/hostname coverage. Clanker does not bypass Chromium certificate validation.
