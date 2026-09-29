# Workspaces

Workspaces provide isolated development environments within a single window.

## Creating a Workspace

1. Click **Open Workspace** (`+`) beside the workspace tabs
2. Enter or browse to a local directory
3. The workspace opens in a new tab

On platforms whose native directory picker supports it, the folder picker can create a new directory before opening the workspace.

### Task worktrees

Click the **Worktree** side of the launch button to slide from the workspace launcher to the task worktree options. Use **Back to workspace** to return to the normal launcher. To make a separate checkout for a task:

1. Select a Git repository directory and click **Load repository**.
2. Choose a base ref and enter a task branch name.
3. Click **Create and open worktree**. Clanker creates the checkout beside the repository, then opens it as a normal workspace with its own terminals, editor, browser, and Git state. For a new branch, Clanker creates it from the base ref. If the branch already exists without a checkout, Clanker uses that branch, which also lets you retry after a failed checkout.

If a local branch and tag share a name, the base ref uses the branch. Enter `refs/tags/<name>` to use the tag.

The launcher also lists existing linked worktrees. Click **Open** to use one without recreating it. Several conversations or terminals can share a worktree workspace; create another worktree when work needs separate files and a branch.

Closing a workspace tab stops its live terminals and closes its UI; it leaves the checkout and branch on disk. To remove a checkout, return to **Task worktree**, load the repository, and choose **Remove…** on a closed worktree. Clanker checks for uncommitted, untracked, and ignored files, then asks you to confirm the exact path and branch. Removal moves the checkout to the system Trash and unregisters it from Git, preserving files written during removal. The branch remains.

New worktrees contain Git tracked files from the base commit. Local ignored files such as `.env` and installed dependencies are not copied automatically; set up those files in the new checkout as needed.

## Remote Workspaces (SSH)

Clanker supports opening workspaces on remote Linux/POSIX development machines reachable via SSH. The local Clanker desktop app provides the editor, terminal grid, and Git interface, while the remote development machine owns the filesystem, Git checkout, shell processes, and coding agents.

### Local vs. SSH Environments

- **Local environment (`local`)**: The default built-in environment. Files, terminals, worktrees, and processes run directly on the machine running Clanker.
- **SSH Remote environments**: Configured targets pointing to remote Linux/POSIX servers (such as a public VPS, cloud instance, homelab machine, or Tailscale node).

### Selecting a Remote Directory

Choose a saved SSH environment in the launcher. Clanker asks that account for its canonical home directory and starts at `$HOME/workspaces` when that directory exists, or `$HOME` otherwise. Use **Browse remote directories** to explore remote directories, navigate up to parent folders, create new project folders directly from the picker, and select a target folder. The path field also offers debounced remote directory suggestions; an absolute path can still be entered manually.

Pre-workspace browsing and folder creation are scoped operations resolved from the saved SSH environment ID. Browsing is read-only and returns directory names and canonical paths only; it cannot read file contents. Folder creation validates name safety and only creates new subdirectories inside existing writable directories. After selection, workspace registration validates and canonicalizes the root. All subsequent filesystem requests remain confined to that registered root.

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

Remote harness commands are discovered and executed on the remote host using its shell environment. Configured harness flags and applicable harness environment settings are applied to new remote terminals; local CLI installations and local Agent Attention adapters are not forwarded. Remote model discovery and selection are deferred in V1.

### Features Intentionally Deferred / Unavailable Remotely in V1

To maintain reliability and safety, the following capabilities are local-only in V1:

1. **Task Worktrees**: Creating or removing Git worktrees is disabled for remote workspaces. Opening existing remote checkouts directly as workspaces is fully supported.
2. **Launch Recipes**: Creating, editing, or launching recipes for SSH workspaces is unavailable in V1. Legacy recipes without an environment ID remain local recipes.
3. **Reveal in File Manager**: Disabled for remote paths, preventing passing remote paths to desktop OS file managers.
4. **Local File Watching**: Chokidar file watching is not attached to remote paths. Remote explorer and editor state refreshes on mutations and focus events.
5. **Agent Attention & Remote Native Session Discovery**: Remote terminals run without local attention hooks. On remote terminal exit, local session history scanning is bypassed, and tasks are marked unavailable with a clear diagnostic explanation.
6. **Automatic Port Forwarding**: VPS development servers listening on `localhost:3000` are remote to that machine. Automatic port forwarding is deferred to a future release.
7. **Remote Process Persistence**: Remote PTY processes terminate on workspace closure or app exit; PTY daemons are not installed on the remote machine.
8. **AI Commit Generation**: Disabled for SSH workspaces; manual Git commits work remotely. Local model/CLI discovery is never used to represent a remote host.

## Managing Tabs

- **Switch workspaces**: Click a workspace tab
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

Global harness defaults (model, favorites, flags, visibility, agent attention) are configured in the header settings dropdown. The model is preselected in the launcher when a harness is chosen; flags and attention settings apply to new harness terminals. See [Configuration](configuration.md#harness-defaults).

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

The app remembers the last workspace path. Layout topology, split sizes, note content, and notes visibility are stored separately by environment and canonical workspace path; old path-only local data is restored for local workspaces and migrated on the next write. Pane IDs are regenerated safely and are not persisted directly.

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

## Agent Task & Session Recovery

Clanker tracks agent coding tasks and harness sessions durably to survive application restarts, workspace closures, and terminal exits.

### Runtime vs. Process Separation

Clanker makes a strict distinction between process persistence and metadata recovery:
- **PTY processes do not survive application restarts**. Clanker does not implement terminal daemons or pretend disconnected PTYs are alive.
- **Task metadata is persistent**. What survives restart is:
  - The workspace identity
  - The task description and timestamps
  - The harness and model used
  - The harness-native conversation session ID and path

### Recovery States

When a workspace is restored or the task list is opened, previous tasks are classified into distinct states:

| State | Meaning | Available Action |
|-------|---------|------------------|
| **Running** | The PTY is currently active in this running Clanker process. | Jump to terminal |
| **Resumable** | The previous PTY has exited or the app restarted, but a native conversation session was recorded on disk. | **Resume** |
| **Needs Session** | Task metadata exists, but Clanker cannot safely correlate a unique native conversation ID. | Select from discovered sessions |
| **Unavailable** | The task cannot be resumed (e.g. workspace directory was deleted, harness is uninstalled, session was deleted from disk, or resume invocation failed). | Inspect reason / Retry / Delete |

### Native Conversation Resume

Clicking **Resume** attaches a new PTY process directly to the AI harness's existing native conversation (e.g., `codex resume <id>`, `claude --resume <id>`, `opencode --session <id>`, `pi --session <path>`, `omp --resume <path>`, `agy --conversation <id>`).

- **No Prompt Replay**: The user's original prompt is never replayed or re-executed upon restart.
- **Graceful Failure**: If a session was deleted from disk, a harness is removed, or resume invocation fails, Clanker marks the task `unavailable` with an explanatory reason without affecting the workspace or losing metadata. The UI provides a **Retry** option to retry failed resume attempts or attach an alternative session.
