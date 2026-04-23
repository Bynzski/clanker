# Workspaces

Workspaces provide isolated development environments within a single window.

## Creating a Workspace

1. Click **Open Workspace** in the header
2. Enter or browse to a local directory
3. The workspace opens in a new tab

## Managing Tabs

- **Switch workspaces**: Click a workspace tab
- **Rename**: Double-click a tab name
- **Close**: Click the × on a tab or press `Ctrl+W`
- **Badge**: Tab shows terminal count

## Per-Workspace State

Each workspace retains:
- Terminal list and count
- Pane layout arrangement
- Browser URL (when enabled)
- Editor tabs and active tab
- File explorer state (expanded paths, selected path)
- Selected harness and model
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
| **Drag** | Rearrange panes via drag handle |
| **Dock** | Drop onto edge to create a full-edge split |
| **Dock (segmented)** | Target a specific pane on an edge to insert adjacent to it |
| **Swap** | Drag to swap pane positions |
| **Lock** | Right-click pane → Lock to prevent reflow |

### Docking Panes

When dragging a pane to an edge, Clanker Grid shows two types of drop targets:

- **Full-edge zone** — A prominent target on the outer edge of the layout. Dropping here creates a split that spans the full height (left/right) or width (top/bottom) of the adjacent edge column.
- **Segment zones** — Smaller targets aligned to each pane's position along the active edge. Dropping on a segment inserts the dragged pane directly adjacent to that pane.

Segment zones appear dynamically based on the current layout. Up to 4 segments are shown per edge. They are only visible during an active drag, and highlight when the cursor hovers over them.

#### Dock behavior

| Drop target | Result |
|-------------|--------|
| Full-edge zone | Full split along the edge column |
| Segment zone | Pane inserted adjacent to the target pane |
| Pane | Swapped with the target pane |

## Persistence

Workspaces are restored on app restart:
- Last workspace path
- Terminal state
- Layout preferences
