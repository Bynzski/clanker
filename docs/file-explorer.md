# File Explorer

Navigate and manage files in your workspace with the integrated file explorer.

## Opening the Explorer

Click the **Explorer** button in the header toolbar to toggle the file explorer sidebar.

## Features

### File Tree

- Recursive directory tree rendering
- Expand/collapse directories
- Selected file highlighting
- Git status indicators (modified, untracked)

### Context Menu

Right-click on any file or directory to access:

| Action | Description |
|--------|-------------|
| **Open in Editor** | Open file in the editor pane |
| **Reveal in System Explorer** | Open containing folder in OS file manager |
| **New File** | Create a new file in the selected directory |
| **New Folder** | Create a new subdirectory |
| **Rename** | Rename the selected file or directory |
| **Delete** | Delete the selected file or directory |

### Keyboard Navigation

| Action | Shortcut |
|--------|----------|
| Expand/Collapse | `Enter` or `→` / `←` |
| Select Next | `↓` |
| Select Previous | `↑` |

## File Operations

### Creating Files

1. Right-click a directory in the explorer
2. Select **New File**
3. Enter the filename
4. The file is created and opened in the editor

### Creating Directories

1. Right-click a directory in the explorer
2. Select **New Folder**
3. Enter the directory name
4. The directory is created

### Renaming

1. Right-click a file or directory
2. Select **Rename**
3. Enter the new name
4. The file/directory is renamed

### Deleting

1. Right-click a file or directory
2. Select **Delete**
3. Confirm the deletion
4. The file/directory is removed

## Git Integration

The file explorer integrates with git to show file status:

- **Modified files** — Display with a git status indicator
- **Untracked files** — Visually distinguished from tracked files
- **Real-time updates** — File changes are detected via the file watcher

## Editor Integration

Double-click a file or select **Open in Editor** to:

- Open the file in a new editor tab
- Switch to an existing tab if the file is already open
- Display syntax highlighting based on file type

## State Persistence

The explorer state is preserved per workspace:

- Expanded directory paths
- Last selected file path
- Directory entries cache

## Technical Details

The file explorer is implemented in `src/renderer/components/FileExplorer/`:

- `index.tsx` — Main explorer component
- `FileTree.tsx` — Recursive directory tree rendering
- `ContextMenu.tsx` — Right-click context menu
- `fileTypeConfig.ts` — File type icons and classification

Explorer state (expanded paths, selected path, directory entries) is managed in `workspaceStore.ts`.
