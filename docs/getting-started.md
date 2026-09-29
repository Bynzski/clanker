# Getting Started

## Supported platforms

| Platform | Release artifact status |
|----------|-------------------------|
| Linux (x64) | AppImage |
| Windows 10 1809+ / Windows 11 (x64) | Supported by the codebase; release artifacts are produced when a Windows build is cut |

macOS, ARM64, and WSL are not supported in this release. WSL users should run the Linux AppImage. See [Windows Notes](windows.md) for Windows-specific setup (long paths, line endings, UNC workspaces, SmartScreen).

## Installing a release build

Download the artifact for your platform from [GitHub releases](https://github.com/Bynzski/clanker/releases). Some patch releases are Linux-only; check the release assets before expecting Windows installers.

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
5. For a local workspace with a selected harness, choose a model from its picker when available
6. Choose terminal count (1, 2, or 4)
7. Click **Launch Workspace**

### Model Selection in the Gate

For local workspaces, selecting a harness shows model selection controls:

- Click the model pill to open favorites and browse/search models supplied by the harness
- If a harness cannot supply models, the app may show only configured models
- **Selected model** is used for workspace launch

The default model for each harness can be configured in the header settings dropdown (gear icon).

## Creating Workspaces

From the gate or workspace tabs:
- Click **Open Workspace** (`+`) beside the tabs
- For **Local**, enter a local directory path or use the operating-system folder picker
- For **SSH Remote**, add a target in **Manage SSH Targets** if needed, select it, and browse directories over SSH or enter an absolute POSIX path. **New Folder** in the remote chooser creates a directory on the remote host. Clanker starts at `$HOME/workspaces` when it exists and is accessible, otherwise at `$HOME`.

Remote workspaces require system OpenSSH access to a Linux/POSIX host and Python 3 on that host. The SSH account must have permission to access the selected directory. Remote harnesses must be installed on the host; the launcher shows harnesses discovered there. Remote worktree management and optional host-side Agent Attention are supported. Remote recipes, native session recovery, and automatic port forwarding remain unavailable. See [SSH Workspaces](workspaces.md#remote-workspaces-ssh) for setup and the complete limitations list.

## Navigation

| Element | Location |
|---------|----------|
| Title Bar | Top — window controls |
| Workspace Tabs | Below title bar |
| Header Toolbar | Tabs → main content |
| Main Area | Terminals, browser, editor, and file explorer |
| Status Bar | Bottom |

## Quick Commands

| Command | Action |
|---------|--------|
| `npm run dev` | Start development |
| `npm run build` | Build for production |
| `npm run test` | Run tests |
| `npm run validate` | Full validation |
