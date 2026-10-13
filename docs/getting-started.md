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
2. Clanker shows its normal shell immediately, including navigation and Settings
3. Click **Open Workspace** (`+`) and choose **This PC**, then type an absolute local directory or use **Choose Folder…**; alternatively select a saved SSH environment and enter/browse an absolute remote directory
4. Click **Open Workspace**. The workspace opens empty
5. Choose **New Agent**, select **Terminal** or an installed AI harness, confirm its checkout (the project checkout is the default), and launch. Configure local harness defaults in **Settings → Harnesses**.

On subsequent launches Clanker revalidates and reopens the previously open workspace identities in their saved order, with the previously active workspace selected. It does not revive terminals, agents, conversations, Browser views, editor tabs or Notes visibility. Saved workspace page arrangements are revalidated without creating missing runtime resources. Notes content is retained. Failed restores produce a compact warning and are removed from the saved open set; the first surviving workspace becomes active if the saved active workspace failed.

## Opening Workspaces

Click **Open Workspace** (`+`) in the Workspaces sidebar, collapsed rail, or tab strip. Local paths can be typed with directory suggestions or selected with the operating-system folder picker; the gear chooses the local starting directory. For SSH, use **Add server…** or **Server settings…** to manage environments and **Browse remote directories** to navigate or create a direct child folder. Clanker starts at the saved default root when accessible, then `$HOME/workspaces`, then `$HOME`.

Remote workspaces require system OpenSSH access to a Linux/POSIX host and Python 3 on that host. Opening only registers the root; harness discovery and runtime launch belong to the normal Header. See [SSH Workspaces](workspaces.md#remote-workspaces-ssh) for setup and limitations.

## Navigation

New installs use **Sidebar** navigation. Choose **Tabs** under **Settings → Workspaces & Layout** to switch; installs that already existed before the sidebar was introduced keep Tabs until you change it.

| Element | Sidebar mode (default) | Tabs mode |
|---------|------------------------|-----------|
| Title Bar | Top — brand, window controls, and the docked workspace toolbar | Top — brand, workspace tabs, window controls |
| Workspace list | Left sidebar, **WORKSPACES** section; each workspace expands to show its agents | Tab chips in the title bar |
| Workspace toolbar | Docked in the title bar, beside the sidebar | Its own row below the title bar |
| File explorer | **FILES** section pinned to the bottom of the sidebar (collapsed until opened) | Toggle in the toolbar opens a resizable Explorer dock |
| Main Area | Terminals, browser, editor, and notes panes | Terminals, browser, editor, and notes panes |
| Status Bar | Bottom | Bottom |

The toolbar uses **New Agent** to start a Terminal or AI harness in the project checkout or an explicitly chosen worktree. **Git** opens Source Control's permanent pages; layout controls, Browser, Notes, Chat History and Settings remain available as appropriate. **Usage** is in the status bar. Launch Recipes are temporarily disabled, with saved data retained. Agent rows can run [local checkout dev servers](dev-services.md). Enabled Hermes Assistants remain available with no workspace open; their toolbar has Browser and Settings only. Tabs mode also has an **Explorer** toggle. For the `1`, `2`, `+` page controls and pane minimize/restore, see [Workspace pages](workspace-pages.md). Drag the sidebar's edge narrow (or use **Collapse sidebar**) to shrink it to an icon rail; drag it out or use **Expand sidebar** to restore it. See [Workspaces](workspaces.md#managing-workspaces).

## Quick Commands

| Command | Action |
|---------|--------|
| `npm run dev` | Start development |
| `npm run build` | Build for production |
| `npm run test` | Run tests |
| `npm run validate` | Full validation |
