# File Explorer

Navigate and manage files in your workspace with the integrated file explorer.

## Opening the Explorer

In **Sidebar** navigation (the default), files live in the **FILES** section pinned to the bottom of the workspace sidebar. It starts collapsed; click **Files** to open it, and it grows upward to at most half the sidebar. FILES shows the active workspace's focused checkout. From the collapsed sidebar rail, **Show Files** expands the sidebar and opens FILES.

In **Tabs** navigation, click the **Explorer** button in the header toolbar to toggle a separate, resizable Explorer dock.

`Cmd/Ctrl+B` toggles either one.

## Checkout selection

Focusing a terminal selects its registered launch checkout for Explorer; focusing an editor tab selects that tab's pinned checkout instead. Terminal focus clears the editor override. Missing, released or unknown checkout contexts fall back to the workspace root. A harness's printed or reported cwd does not grant Explorer access to another directory.

Editor tabs pin their checkout when opened: saving, reloading and relative Markdown links use that root regardless of later focus changes. Files with the same relative name in different checkouts remain separate tabs. If a checkout is released, dirty buffers remain available with an unavailable-checkout notice; operations cannot silently switch to the main checkout.

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
| **Reveal in System Explorer** | Open containing folder in OS file manager (local workspaces only) |
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
| Rename selected entry | `F2` |
| Focus file filter | `/` |

## File Operations

File and folder names are validated before submission. The validator rejects:

- Empty names, names longer than 255 UTF-8 bytes
- Trailing dots or spaces
- Characters illegal on Windows: `< > : " / \ | ? *`
- Windows reserved device names with or without extensions: `CON`, `PRN`, `AUX`, `NUL`, `COM1–9`, `LPT1–9` (e.g. `CON.txt` is rejected)

These rules are enforced on every platform so a workspace authored on Linux still opens cleanly on Windows.

### Deletion

In a local workspace, deleting a file or folder first tries the OS recycle bin (`shell.trashItem`). If trash integration is unavailable, the app falls back to permanent deletion. In an SSH workspace, deletion happens on the remote host and is permanent; there is no remote trash integration. Check the confirmation dialog before proceeding.

For local files held open by an editor or another process, the app surfaces a `File is in use` prompt instead of a generic permission error — close the file and retry. Remote filesystem errors are reported from the SSH host.

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

## Git Integration

The file explorer integrates with git to show file status:

- **Modified files** — Display with a git status indicator
- **Untracked files** — Visually distinguished from tracked files
- **File updates** — Local Explorer watches follow the selected checkout; local editor tabs retain individual watches across checkouts. The active SSH workspace uses one batched poll about every three seconds for its focused checkout, up to 128 editor files and 128 visible/expanded directories (at most 2,000 direct children each). Other-checkout tabs are parked until that checkout is focused. Clean tabs reload; dirty buffers are preserved and flagged. SSH failures back off without treating files as deleted. Remote contents also refresh after Clanker-managed mutations and on desktop focus while Explorer is visible. Use Refresh for immediate updates or directories beyond the polling limits.

## Editor Integration

Double-click a file or select **Open in Editor** to:

- Open the file in a new editor tab
- Switch to an existing tab if the file is already open
- Display syntax highlighting based on file type

## Markdown preview

Markdown tabs offer **Edit** and **Preview**. Preview renders the current buffer, including unsaved edits, without saving or replacing editor history. Tables, task lists and code blocks are supported. HTTP(S) links open externally; relative file links stay inside the tab's pinned checkout and use normal validated file reads. Raw HTML is disabled, unsafe/outside-root links are unavailable, and images show alt-text placeholders rather than loading files or remote resources.

## Runtime state

Expanded paths, selection and directory caches are retained while the workspace is open, using absolute paths to distinguish checkouts. Released checkouts lose their tree caches, not dirty editor buffers. Explorer state and editor tabs are not reopened after an app restart.

## Technical Details

The file explorer is implemented in `src/renderer/components/FileExplorer/`:

- `index.tsx` — Main explorer component
- `FileTree.tsx` — Recursive directory tree rendering
- `ContextMenu.tsx` — Right-click context menu
- `fileTypeConfig.ts` — File type icons and classification

Explorer state (expanded paths, selected path, directory entries) is managed in `workspaceStore.ts`.
