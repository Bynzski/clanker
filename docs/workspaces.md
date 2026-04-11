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

## Layout Controls

| Action | Description |
|--------|-------------|
| **Fit All** | Reset panes to balanced sizes |
| **Drag** | Rearrange panes via drag handle |
| **Dock** | Drop onto edge to resize |
| **Swap** | Drag to swap pane positions |
| **Lock** | Right-click pane → Lock to prevent reflow |

## Persistence

Workspaces are restored on app restart:
- Last workspace path
- Terminal state
- Layout preferences
