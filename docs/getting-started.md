# Getting Started

## Supported platforms

| Platform | Release artifact status |
|----------|-------------------------|
| Linux (x64) | AppImage |
| Windows 10 1809+ / Windows 11 (x64) | Supported by the codebase; release artifacts are produced when a Windows build is cut |

macOS, ARM64, and WSL are not supported in this release. WSL users should run the Linux AppImage. See [Windows Notes](windows.md) for Windows-specific setup (long paths, line endings, UNC workspaces, SmartScreen).

## Installing a release build

Download the artifact for your platform from [GitHub releases](https://github.com/Bynzski/clanker/releases). Some releases are Linux-only; check the release assets before expecting Windows installers.

### Linux

```bash
chmod +x 'Clanker Grid-X.Y.Z.AppImage'
./'Clanker Grid-X.Y.Z.AppImage'
```

### Windows — installer

Only available on releases that include Windows artifacts.

1. Run `Clanker Grid Setup X.Y.Z.exe`.
2. Windows SmartScreen will display "Windows protected your PC" because the installer is unsigned. Click **More info → Run anyway**.
3. Complete the installer; Clanker Grid is added to the Start Menu.

### Windows — portable

Only available on releases that include Windows artifacts.

Run `Clanker Grid X.Y.Z.exe` directly. No installation step. SmartScreen will still warn on first launch.

## Building from source

```bash
git clone https://github.com/Bynzski/clanker.git
cd clanker
npm install
npm run dev
```

Requires Node.js 22.12+ and npm 10+. On Windows, also install **Git for Windows** so husky pre-commit hooks can execute.

## First Launch

1. Open the installed app, or run `npm run dev` from a source checkout
2. The workspace gate opens if no workspaces exist
3. Select **Local** and enter or browse for a directory, or select **SSH Remote** and choose a saved SSH target and remote directory
4. Optionally select an AI harness
5. With a selected harness, choose a model from its picker when available. Local workspaces use the harness's local catalog; SSH workspaces show a picker only when the host returns a real model list, otherwise the host's own default applies
6. Choose terminal count (1, 2, or 4)
7. Click **Launch Workspace**

### Model Selection in the Gate

For local workspaces, selecting a harness shows model selection controls:

- Click the model pill to open favorites and browse/search models supplied by the harness
- If a harness cannot supply models, the app may show only configured models
- **Selected model** is used for workspace launch

The default model for each harness can be configured in the header settings dropdown (gear icon). A locally saved default is not applied to SSH launches.

## Creating Workspaces

From the gate, or from the navigation you are using:
- Click **Open Workspace** (`+`): in the **WORKSPACES** sidebar header (or under the open workspaces when the sidebar is collapsed to its rail), or beside the tabs in Tabs mode
- For **Local**, enter a local directory path or use the operating-system folder picker
- For **SSH Remote**, add a target in **Manage SSH Targets** if needed, select it, and browse directories over SSH or enter an absolute POSIX path. **New Folder** in the remote chooser creates a directory on the remote host. Clanker starts at `$HOME/workspaces` when it exists and is accessible, otherwise at `$HOME`.

Remote workspaces require system OpenSSH access to a Linux/POSIX host and Python 3 on that host. The SSH account must have permission to access the selected directory. Remote harnesses must be installed on the host; the launcher shows harnesses discovered there. Remote worktree management, optional host-side Agent Attention, and automatic SSH web service previews are supported. Remote session history and native conversation recovery are available for supported harnesses. Remote recipes and persistent processes remain unavailable. See [SSH Workspaces](workspaces.md#remote-workspaces-ssh) for setup and the complete limitations list.

## Navigation

New installs use **Sidebar** navigation. Choose **Tabs** under **Settings → Appearance → Workspaces** to switch; installs that already existed before the sidebar was introduced keep Tabs until you change it.

| Element | Sidebar mode (default) | Tabs mode |
|---------|------------------------|-----------|
| Title Bar | Top — brand, window controls, and the docked workspace toolbar | Top — brand, workspace tabs, window controls |
| Workspace list | Left sidebar, **WORKSPACES** section; each workspace expands to show its agents | Tab chips in the title bar |
| Workspace toolbar | Docked in the title bar, beside the sidebar | Its own row below the title bar |
| File explorer | **FILES** section pinned to the bottom of the sidebar (collapsed until opened) | Toggle in the toolbar opens a resizable Explorer dock |
| Main Area | Terminals, browser, editor, and notes panes | Terminals, browser, editor, and notes panes |
| Status Bar | Bottom | Bottom |

The toolbar holds the new-terminal launchers and Git, then layout undo, Fit All, launch recipes, the **Browser** and **Notes** toggles, Chat History, Usage, and Settings. In Tabs mode it also has an **Explorer** toggle. Drag the sidebar's edge narrow (or use **Collapse sidebar**) to shrink it to an icon rail; drag it out or use **Expand sidebar** to restore it. See [Workspaces](workspaces.md#managing-workspaces).

## Quick Commands

| Command | Action |
|---------|--------|
| `npm run dev` | Start development |
| `npm run build` | Build for production |
| `npm run test` | Run tests |
| `npm run validate` | Full validation |
