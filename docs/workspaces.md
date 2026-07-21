# Workspaces

Workspaces provide isolated development environments within a single window.

## Creating a Workspace

1. Click **Open Workspace** in the header
2. Enter or browse to a local directory
3. The workspace opens in a new tab

On platforms whose native directory picker supports it, the folder picker can create a new directory before opening the workspace.

## Managing Tabs

- **Switch workspaces**: Click a workspace tab
- **Rename**: Double-click a tab name
- **Close**: Click the × on a tab
- **Badge**: Tab shows terminal count

## Per-Workspace State

Each workspace retains:
- Terminal list and count
- Pane layout arrangement
- Browser URL (when enabled)
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

Global harness defaults (model, favorites, flags) are configured in the header settings dropdown and apply as defaults for new workspaces. See [Configuration](configuration.md#harness-defaults).

## Layout Controls

| Action | Description |
|--------|-------------|
| **Fit All** | Reset panes to balanced sizes |
| **Drag** | Rearrange terminals, Browser, Editor, Notes, and Explorer from their drag grip |
| **Dock** | Drop onto a workspace edge or one side of a pane to create a split |
| **Swap** | Drop onto the center of another pane to swap positions |
| **Undo** | Restore the previous layout arrangement |

### Docking Panes

Dragging a pane reveals two levels of drop targets:

- **Workspace edges** — Four bands along the outer edge. Dropping here creates a full-height or full-width split, with the moved pane initially taking 30% of the workspace.
- **Pane zones** — Each pane has left, right, top, bottom, and center zones. Edge zones split that specific pane; the center swaps the two panes.

The preview rectangle shows the exact destination before the drop. Dragging uses a lightweight preview card, and native browser content is temporarily hidden so it cannot cover the docking targets.

#### Dock behavior

| Drop target | Result |
|-------------|--------|
| Workspace edge | Full split along the outer edge |
| Pane edge | Pane inserted beside that specific pane |
| Pane center | Pane positions swapped |

## Persistence

The app remembers the last workspace path. Layout topology and split sizes are stored separately for each workspace path and restored when the current pane set is compatible. Pane IDs are regenerated safely and are not persisted directly.

Terminal processes and their runtime state are not reconstructed from layout persistence.
