# Workspaces

Workspaces provide isolated development environments within a single window.

## Opening a Workspace

1. Click **Open Workspace** (`+`) in the **WORKSPACES** sidebar header (in the collapsed rail it sits directly under the open workspaces), or beside the workspace tabs in Tabs mode
2. Select **This PC** and type an absolute local directory (with directory suggestions) or use **Choose Folder…**; alternatively choose an SSH environment and enter/browse its absolute remote path
3. Click **Open Workspace**. An empty workspace is added to the sidebar (or the tab strip); launch terminals afterward from the Header

The path-field gear sets the starting directory: choose a folder locally, or save the entered path for the selected SSH server. This preference does not grant access beyond a registered workspace root.

For local workspaces, the native directory picker can create a new directory before opening the workspace on platforms that support it. SSH workspaces use Clanker's own remote chooser and **New Folder** action.

### Isolated agents and linked worktrees

Use **New isolated agent** beside the Header harness pills to select a harness and working copy, then **Launch**. Choose a new branch, an existing local branch with no worktree, or an existing linked worktree. Selection alone runs nothing. Reusing a checkout lets multiple agents share it; creation and adoption attach a validated checkout context without widening the workspace root. Missing and locked checkouts offer **Repair…** rather than launch.

Agents show the branch of their native reported location when available, otherwise their launch checkout. Labels do not change launch authority. Git changes made outside Clanker are reconciled on focus, lifecycle events and worktree refresh; gone checkouts show `branch · removed`. Unused attached checkouts remain in the sidebar until explicitly removed or safely retired after Git no longer lists them.

Manage linked worktrees through the [Git menu](git-integration.md#worktrees), with activity, cleanliness and removal protections. A linked worktree can also be opened directly as an empty standalone workspace by choosing its checkout folder. Generated `*-worktrees` containers are not workspace roots.

Remote removal preserves checkout files under `<checkout-parent>/.clanker-worktree-recovery/removed-<id>/checkout` and records the original path and branch in `recovery.json` beside that folder. The preserved folder is a file recovery copy, not a registered Git worktree; its old `.git` pointer is no longer valid. The branch remains available, so you can create a new worktree for it and copy needed files from the recovery folder. Recovery and operation-journal folders must be owned by the SSH account with private permissions (`0700`). Existing unsafe folders are rejected before the checkout is moved; Clanker does not change their permissions. Recovery folders are not automatically purged. If SSH loses the removal result, paths stay reserved until **Refresh worktrees** verifies that operation's completion journal on the host. If verification cannot complete, Clanker shows the staging and recovery paths for manual host inspection. Do not reopen them while the operation may still be running.

Closing a workspace stops its live terminals and closes its UI; it leaves the checkout and branch on disk. Remove linked worktrees through the Git menu after their terminals are closed. Local removal checks uncommitted, untracked and ignored files, confirms the path and branch, preserves checkout files through the protected removal flow and keeps the branch.

New worktrees contain Git tracked files from the base commit. Local ignored files such as `.env` and installed dependencies are not copied automatically; set up those files in the new checkout as needed.

Removal safeguards share an opaque resource identity for saved SSH aliases whose effective OpenSSH hostname, user, port, and proxy route match. Workspaces retain their separate saved environment identities. Different destination names (for example, a DNS name and its numeric IP) or different proxy routes are not assumed equivalent; use one saved environment when accessing the same repository through those routes.

Pending removal records are saved before dispatch and restored when Clanker restarts. After an interrupted removal, open the owning repository and use **Refresh worktrees** to verify the host completion journal. Until verification succeeds, conflicting opens and terminal launches remain blocked. A missing or incomplete journal requires host inspection; loss of SSH connectivity never proves that removal finished.

### Remembered workspace identities

Clanker continuously remembers the current open set, order and active workspace. Closing a workspace removes it from that set. Each restart registers every saved root again through main, independently. Valid roots become empty shells; failed identities are omitted, removed from persistence, and reported in a warning. If the active root fails, the first surviving workspace in saved order is selected.

Runtime work is explicit: terminals, agents, resumed conversations, Browser views, editor tabs, Notes visibility and pane topology are not restored. Durable Notes content remains available when you open Notes. Recipes in the normal workspace toolbar can explicitly launch work and apply their captured layout.

## Remote Workspaces (SSH)

Clanker supports opening workspaces on remote Linux/POSIX development machines reachable via SSH. The local Clanker desktop app provides the editor, terminal grid, and Git interface, while the remote development machine owns the filesystem, Git checkout, shell processes, and coding agents.

### Local vs. SSH Environments

- **Local environment (`local`)**: The default built-in environment. Files, terminals, worktrees, and processes run directly on the machine running Clanker.
- **SSH Remote environments**: Configured targets pointing to remote Linux/POSIX servers (such as a public VPS, cloud instance, homelab machine, or Tailscale node).

### Selecting a Remote Directory

Choose a saved SSH environment in **Open Workspace**. In **Server settings…**, add or edit a target's optional **Default workspace root** using an absolute remote path, such as `/srv/repos`. Clanker starts there when it is accessible, resolving symlinks to the canonical path. If the setting is blank or unavailable, it falls back to `$HOME/workspaces`, then `$HOME`. Clearing the field restores that automatic choice. Targets cannot be edited or deleted while an open or registering workspace uses them, or a pending worktree removal protects them. **Browse remote directories** opens an application-rendered chooser, not an operating-system folder dialog. It lists remote directories over SSH, lets you navigate to parent folders, create a remote folder with **New Folder**, and select a target folder. The path field also offers debounced remote directory suggestions; an absolute path can still be entered manually. The default root is a browsing preference; workspace file operations remain confined to their registered root.

Pre-workspace browsing and folder creation are resolved from the saved SSH environment ID and can reach directories the SSH account is allowed to access. Browsing returns directory names and canonical paths only; it cannot read file contents. Folder creation validates name safety and creates only a direct child of the selected canonical parent when that directory is writable. After selection, workspace registration validates and canonicalizes the root. All subsequent filesystem requests remain confined to that registered root.

### Workspace Identity

Workspace identity is composite:

```text
environmentId + canonical workspace path
```

This ensures that a workspace on `dev-vps:/home/jay/Projects/clanker` is a distinct identity from `local:/home/jay/Projects/clanker`. Both can be open simultaneously in the same window without identity or Notes content collision. SSH paths are canonicalized on the remote host before registration, and subsequent file, Git, and terminal requests use that registered location.

SSH workspaces are marked with their environment (for example `SSH · dev-vps`): as a prefix on the tab in Tabs mode, and as a server icon on the sidebar row (with the environment in its tooltip) or a dot on the rail mark. Local workspaces carry no marker.

### OpenSSH Transport & Credentials

Clanker uses the system OpenSSH client (`ssh`). It respects:
- `~/.ssh/config` (Host aliases, Port, User, ProxyJump, IdentityFile)
- Active `ssh-agent` keys
- Known hosts verification
- Tailscale SSH and MagicDNS hostnames

Clanker **never** stores SSH passwords or private keys in application state, nor does it disable host-key verification. Saved SSH targets only store non-secret metadata (a label and the connection target string).

Saved SSH targets cannot be edited or deleted while an open workspace uses them. Close the workspace first, then update or remove the target.

**Connection errors.** When OpenSSH itself fails (exit code 255), Clanker shows a short explanation instead of the raw output: authentication failed (check key, agent, account), host-key verification failed or changed (check `known_hosts`), host could not be resolved, connection refused (check sshd and port), host unreachable (check network/VPN/Tailscale), connection timed out, or connection lost. Any other OpenSSH failure shows a generic "SSH connection failed" line with its first diagnostic. A remote command that fails with an ordinary exit code is reported as that command's error, not as a connection problem. The raw output is kept for diagnostics. Use **Test** on a saved target to re-check it; the remote directory chooser retries a failed listing, and the initial remote-home lookup in the launcher has a **Retry** button that keeps any path you already typed. Clanker does not keep a persistent connection state or reconnect automatically.


### Remote Prerequisites & Platform Support

- **Supported Remote Platforms**: Linux and POSIX-compatible operating systems (x86_64, ARM64). Remote Windows hosts are not supported in V1.
- **Prerequisites**: OpenSSH server running on the remote host, with key-based authentication or ssh-agent configured for noninteractive background operations. Python 3 is required on the remote host for root-confined filesystem operations and atomic writes.

Remote harness commands are discovered and executed on the remote host using its shell environment. Configured harness flags and applicable harness environment settings are applied to new remote terminals; local CLI installations and desktop Agent Attention credentials are not forwarded. Remote attention uses host-side adapters when enabled in harness defaults. SSH Header launchers use the host CLI's configured model; a locally saved default model is never applied. Open Workspace has no model picker. Codex, OpenCode, Pi, OMP and Antigravity expose remote model-discovery capabilities for supported runtime callers; these use the host CLI without desktop cache or static fallback. Claude has no reliable list command and Hermes is not queried remotely.

### Remote Agent Attention

Enable **Agent attention** in the harness defaults before launching a new SSH agent terminal. The existing pane and workspace badges show native lifecycle events. Main decides which events are authoritative: each is correlated to the terminal's root agent session and current foreground turn, so subagent, child-session, background and stale completions never show Turn complete. Events contain only lifecycle names and bounded session/turn IDs; prompts, tool arguments, and model output are excluded. They use the existing SSH terminal connection, with a fresh credential bound to that terminal. No desktop listener secret, additional listener, port forward, or remote daemon is used.

| Harness | Native events used |
| --- | --- |
| Codex | Native hooks: prompt submission, permission requests correlated with tool start/completion, root stop (subagent stop is ignored), user interrupt, and session end. Codex asks you to review the hooks once (`/hooks`) before it runs them. |
| Claude | Prompt submission, permission requests (resolved when the tool batch completes), root stop or explicit API failure, and session end. Child events are ignored; background tasks do not hold the foreground turn open. Needs Claude Code 2.1.196+ for prompt IDs. |
| OpenCode | Busy/idle of the verified top-level session (child sessions are ignored), permission/question requests and replies, and session deletion. |
| Pi | Agent start, foreground extension-owned dialog waits, final settled outcome (completed, interrupted or failed), and session shutdown. Not every built-in prompt emits a supported event. |
| OMP | Main-agent start, main-session stop (after background jobs drain), and session shutdown. |
| Antigravity | Initial invocation, interactive ask-tool requests/replies, and stop only when fully idle for the root conversation. |
| Hermes | Root turn start/completion (child turns are ignored; a compression session rotation is followed only when proven), human approval requests/replies tied to their turn (smart approvals and child sessions are ignored), and session finalize through observer hooks. |

A native session change in a live agent (clear, switch) keeps attention registered and lets the new session bind; harness exit retires attention before the fallback shell. Resuming a session seeds its host-validated ID for providers that keep it; forks start unbound. Missing native events remain unknown; terminal output is never interpreted as an agent state. Codex, Claude, Pi, OMP, and Antigravity require Node.js on the host for hooks. OpenCode uses its own JavaScript runtime; Hermes uses Python and must support its observer plugin API.

Clanker refuses launches with attention enabled when hook configuration conflicts: Codex profiles or existing hook configuration, Claude explicit settings/bare/safe mode, OpenCode a custom config directory/pure mode/attached server, Pi/OMP disabled extensions, or Hermes custom profiles. Disable attention to use those launch modes. Existing user hook files are preserved.

Antigravity installs an owned plugin at `~/.gemini/config/plugins/clanker-grid-remote-attention`; Hermes installs one at `~/.hermes/plugins/clanker-grid-remote-attention` and enables it with `hermes plugins enable`. These plugins remain installed and are inert without Clanker's per-launch environment. Antigravity hooks return an empty response when the launch credentials are absent; Clanker upgrades the exact prior owned hook configuration and refuses unrelated edits. Clanker refuses unowned/conflicting files and writable-by-other-users plugin folders. Hermes settings retain the enabled plugin entry; to uninstall, disable it through Hermes before removing that owned plugin directory. Other launch files use private temporary folders and are cleaned after exit where SSH remains available; interrupted connections can leave private temporary folders for manual cleanup.

Local Hermes attention remains unsupported.

Browser annotation **Send to agent** works for remote agent terminals that Agent Attention has registered and that the broker reports as ready or unverified. Main checks the registered workspace, environment and remote launch directory (inside the canonical remote root) before writing to the existing SSH terminal; no extra SSH connection is made. Plain remote shells, closed or busy agents, and mismatched workspaces fail closed; use **Copy message** instead.

Renderer crashes release workspace registrations, polling, terminals, and previews. App quit waits for managed preview SSH clients to terminate and for started terminal cleanup to finish. Private host launch files are cleaned where SSH remains reachable.

### SSH session history

Open **Chat history** in an SSH workspace to browse that host's sessions for the workspace and its subdirectories. Clanker discovers installed Codex, Claude, OpenCode, Pi, OMP, and Antigravity harnesses and reads their native metadata remotely. Desktop history is never used for an SSH workspace. Antigravity requires a conversation with an explicit matching workspace path. Hermes session history remains unsupported.

Click a remote history entry to resume its conversation in a new SSH terminal in the same environment. Clanker re-reads the host session before launching and validates the workspace, working directory, installed harness, and session file. A missing session, conflicting session-selection flags in harness defaults, or a closed/removed workspace produces an error. Switching workspaces while a resume is pending attaches the terminal to the original workspace; closing that workspace cancels or cleans up the launch. Clanker keeps no record of the launch itself, so the history shown is always the host's own current metadata. SSH/discovery failures appear in the history menu alongside usable results where available; reopen it to refresh. Failed refreshes keep the last useful list. Switching workspaces closes the menu and discards pending results from the previous workspace.

Discovery uses bounded metadata reads and omits messages beyond the first 256 KiB of each JSONL file. OpenCode requests up to 4,097 rows to detect histories beyond the 4,096-row scan limit; it does not rely on the CLI default page. Conflicting metadata for the same harness/session ID reports an error. Large histories can exceed the scan/result limits and report an error. Custom session-store locations are not supported in this slice.

### SSH browser previews

Start a development server on the SSH host, then open the workspace's **Browser** pane. The small **Remote preview** server icon in the existing toolbar exposes detected HTTP/HTTPS services. Its menu is closed by default; there is no permanent preview panel. A single workspace-owned service forwards and opens automatically; choose **Open** for multiple services or an unscoped listener. **Detect services** requests a fresh scan. **Forward port manually…** is a fallback asking only for the remote port and protocol. Clanker chooses the desktop port, preferring the matching port when available and retrying conflicts automatically.

Workspace ownership comes from the listener process's canonical working directory, or a loopback URL printed by that workspace's SSH terminal. A port number alone never establishes ownership. Listener discovery uses `ss`, then `lsof`, or eight conventional development ports when neither utility exists. It probes at most 32 loopback endpoints, four at a time, with short deadlines and bounded output. IPv4/IPv6 loopback and wildcard listeners are supported; the desktop listener always binds to `127.0.0.1`.

Discovery is demand-driven by the visible, active Browser. Workspaces on the same resolved SSH host share one inventory command. Startup uses a short adaptive burst, then backs off to one scan per minute; terminal URLs and **Detect services** accelerate scanning. Hiding Browser or switching away releases the discovery lease. Managed tunnels remain alive and health checks use the existing local forward rather than additional SSH commands.

SSH transport readiness and web-service readiness are separate. **Waiting for remote service** means the tunnel is established but the application is unavailable. Delayed startup and server restarts recover automatically on the same tunnel and reopen the selected preview. A newly detected workspace-owned port can replace the previous automatic preview. SSH forwarding policy rejection, authentication/host-key failures and disconnects are transport errors; restore connectivity/policy and choose **Open** again. Low-level SSH diagnostics are not displayed in Browser.

Each workspace supports four independent forwards, with at most 16 across the app. **Stop** in the preview menu, workspace close, window close, renderer loss and app shutdown release connections. Browser views and forwarding rules are not restored on application startup. Managed previews retain normal host-key verification and reject targets with preconfigured forwards. They use system OpenSSH `-N` and bounded ephemeral discovery commands: no Clanker daemon, installed helper or persistent remote service is introduced. Privileged ports and persisted forwarding rules remain unsupported.

### Remote limits and refresh behavior

Remote capabilities have the following limits in V1:

1. **Submodule Worktree Removal**: Remote worktrees containing submodules cannot be removed through Clanker. Other clean remote checkouts can be removed with a preserved file recovery copy; discovery, creation, and inspection are available from open SSH repositories.
2. **Launch Recipes**: Creating, editing, or launching recipes for SSH workspaces is unavailable in V1. Legacy recipes without an environment ID remain local recipes.
3. **Reveal in File Manager**: Disabled for remote paths, preventing passing remote paths to desktop OS file managers.
4. **File Refresh**: One batched SSH poll checks the active workspace's focused checkout about every three seconds. It monitors up to 128 editor files in that checkout and 128 visible/expanded Explorer directories, scanning only direct children (up to 2,000 entries per directory). Clean tabs reload; dirty buffers are preserved and flagged. Other-checkout tabs are parked until their checkout is focused. Polls do not overlap and back off after connection failures without inferring deletion. Manual Refresh and desktop-focus refresh remain available.
5. **Remote Conversation Resume**: Host-native discovery and manual resume are supported for six harnesses, including attributable linked-worktree conversations. No durable launch/task record or original process is restored. Hermes history remains unsupported.
6. **Persisted Forwarding Rules**: SSH web service discovery and automatic forwarding are supported while Browser is active; saved forwarding rules remain deferred.
7. **Remote Process Persistence**: Remote PTY processes terminate on workspace closure or app exit; PTY daemons are not installed on the remote machine.
8. **AI Commit Generation**: Disabled for SSH workspaces; manual Git commits work remotely. Local model/CLI discovery is never used to represent a remote host.

## Managing Workspaces

Clanker lists open workspaces in one of two navigation modes, chosen under **Settings → Appearance → Workspaces**. New installs use **Sidebar**; installs that predate it keep **Tabs** until you switch. The setting changes only how workspaces are listed; workspaces, terminals, and layouts are unaffected.

### Sidebar (default)

The left sidebar has a **WORKSPACES** section above a **FILES** section pinned to the bottom (see [File Explorer](file-explorer.md)). The workspace toolbar is docked in the title bar beside it; there is no separate toolbar row.

- **Switch workspaces**: Click a workspace row. Expand a row (chevron) to list its agents and click one to focus that terminal; the active workspace expands automatically.
- **Reorder**: Drag a row onto another row, or focus it and press `Alt+Shift+Up/Down`. The saved order is restored when workspaces reopen.
- **Rename**: Double-click the name, or use the rename button on hover
- **Close**: Use the × on a row (shown on hover)
- **Open Workspace**: `+` in the section header; **Collapse sidebar** and the section chevron live beside it
- **Attention**: A workspace row shows a badge for agents needing input or completed turns when agent attention is enabled, each agent row shows its own state icon, and the bell jumps to the next agent needing attention
- **Worktree label**: Linked worktrees show their branch
- **Resize and collapse**: Drag the sidebar's right edge to resize it (the width is shared by all workspaces). Dragging it narrow, or choosing **Collapse sidebar**, shrinks it to an icon rail; drag the edge out or choose **Expand sidebar** to restore the previous width.

The collapsed rail shows a two-letter mark per workspace (with a dot for SSH workspaces and a branch glyph for linked worktrees), followed by its agents' harness icons with live attention dots. It also has Open Workspace, the attention bell, and **Show Files**, which expands the sidebar to open FILES. Selecting items in the rail behaves like the expanded sidebar.

### Tabs

Workspaces appear as tab chips centred in the title bar, with the toolbar on its own row below.

- **Switch workspaces**: Click a workspace tab
- **Reorder**: Drag a tab onto another tab, or focus it and press `Alt+Shift+Left/Right`. The saved order is restored when workspaces reopen.
- **Rename**: Double-click a tab name
- **Close**: Click the × on a tab
- **Attention badge**: Shows agents needing input or completed turns when agent attention is enabled; the bell beside the tabs jumps to the next agent needing attention
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

Opening a workspace starts no harness and selects no model. Click a Header harness pill to launch that installed CLI into the current checkout; the Terminal pill launches a plain shell. **New isolated agent** chooses a harness and working copy without switching the main checkout.

Global harness defaults (model, favorites, flags, visibility, attention and bridge opt-in) are configured in Settings. Local launches use the harness default unless an explicit runtime launch, such as a recipe, provides a model. SSH Header launches use the host CLI's model configuration; saved flags and supported remote attention settings still apply. See [Configuration](configuration.md#harness-defaults).

## Layout Controls

| Action | Description |
|--------|-------------|
| **Fit All** | Rebalance split sizes, keeping the pane arrangement |
| **Drag** | Rearrange terminal, Browser, Editor, and Notes panes from their drag grip |
| **Dock** | Drop onto a workspace edge or one side of a pane to create a split |
| **Swap** | Drop onto the center of another pane to swap positions |
| **Undo** | Restore the previous layout arrangement |

### Docking Panes

Dragging a pane reveals two levels of drop targets:

- **Workspace edges** — Four bands along the outer edge. Dropping here creates a full-height or full-width split, with the moved pane initially taking 30% of the workspace.
- **Pane zones** — Each pane has left, right, top, bottom, and center zones. Edge zones split that specific pane; the center swaps the two panes.

The preview rectangle shows the exact destination before the drop. Dragging uses a lightweight preview card, and native browser content is temporarily hidden so it cannot cover the docking targets.

The Explorer never joins the pane layout tree: in Sidebar mode it is the FILES section of the sidebar, and in Tabs mode it is a separate, resizable left dock.

#### Dock behavior

| Drop target | Result |
|-------------|--------|
| Workspace edge | Full split along the outer edge |
| Pane edge | Pane inserted beside that specific pane |
| Pane center | Pane positions swapped |

## Persistence

The app remembers the open workspace identities, their order and active selection, then revalidates and reopens them as empty shells on restart. Closing a workspace removes it from that saved set. Invalid or unavailable roots are omitted with a warning.

Terminal processes, conversations, dev servers, Browser views, editor tabs, Explorer presentation, Notes visibility and pane topology are not restored. Notes content remains keyed by environment and canonical workspace path, with legacy local Notes migration retained. Old ordinary-workspace layout and Notes-visibility records are ignored. Recipes can still explicitly launch their steps and apply captured layouts.

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
- **No process reconnect**: SSH process persistence is not implemented. Native resume starts a fresh process; it does not reconnect a surviving remote terminal.

### Native Conversation Resume

Selecting a history entry attaches a new PTY process directly to the AI harness's existing native conversation (e.g., `codex resume <id>`, `claude --resume <id>`, `opencode --session <id>`, `pi --session <path>`, `omp --resume <path>`, `agy --conversation <id>`).

Native conversation resume is supported locally and over SSH for the harnesses above. History includes linked-worktree conversations proven by Git, registered checkouts or remembered worktree provenance, not arbitrary sibling directories. Live worktree sessions resume into that validated checkout. For a removed checkout, Claude, Codex and OMP can resume in the main checkout with a notice; Pi, OpenCode and Antigravity require confirmed recreation from the original branch or report why it is unavailable.

Main revalidates native identity, checkout routing, installed harness and session metadata before spawning; missing sessions, conflicting flags or closed workspaces produce an error. Supported native forks create a new conversation on the host. This never reconnects the original process.

- **No Prompt Replay**: The user's original prompt is never replayed or re-executed.
- **Scoped Launch**: The resumed terminal is attached to the workspace that owns the conversation. Switching workspaces mid-resume does not move it, and closing that workspace kills the orphaned terminal.

See [Workspace Launch Recipes and Native Conversation History](recipes.md#6-conversation-history) for the discovery, resume, and provider-capability contracts.

SSH Browser tabs share a private in-memory session per workspace. Cookies/storage are isolated from other SSH workspaces and local browsing. Ordinary browsing inside an SSH workspace also uses that private session; closing the workspace clears it. Local Browser sessions retain existing persistent global logins.

HTTPS discovery/health can identify self-signed development servers, but the embedded Browser still requires a trusted certificate valid for the forwarded hostname (`127.0.0.1`). A certificate only for `localhost`, or a development CA trusted only on the SSH host, is insufficient. A rejected certificate appears in the remote-preview menu; it does not stop the SSH tunnel. Use HTTP or configure suitable desktop trust/hostname coverage. Clanker does not bypass Chromium certificate validation.
