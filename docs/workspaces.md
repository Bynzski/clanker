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

The app remembers the last workspace path. Layout topology and split sizes are stored separately for each workspace path and restored when the current pane set is compatible. Pane IDs are regenerated safely and are not persisted directly.

Terminal processes and their runtime state are not reconstructed from layout persistence.

## Workspace Launch Recipes

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
| **Unavailable** | The task cannot be resumed (e.g. workspace directory was deleted, harness is uninstalled, or harness does not support resume). | Inspect reason / Delete |

### Native Conversation Resume

Clicking **Resume** attaches a new PTY process directly to the AI harness's existing native conversation (e.g., `codex resume <id>`, `claude --resume <id>`, `opencode --session <id>`, `pi --session <path>`, `omp --resume <path>`, `agy --conversation <id>`).

- **No Prompt Replay**: The user's original prompt is never replayed or re-executed upon restart.
- **Graceful Failure**: If a session was deleted from disk or a harness is removed, Clanker marks the task `unavailable` with an explanatory reason without affecting the workspace or losing metadata.
