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
git clone <repo-url>
cd <repo-directory>
npm install
```

Requires Node.js 22.12+ and npm 10+. On Windows, also install **Git for Windows** so husky pre-commit hooks can execute.

## First Launch

1. Run `npm run dev`
2. The workspace gate opens if no workspaces exist
3. Select or enter a directory path
4. Optionally select an AI harness
5. If a harness is selected, choose a model (picker for discoverable harnesses, free text for Claude)
6. Choose terminal count (1, 2, or 4)
7. Click **Launch**

### Model Selection in the Gate

When a harness is selected, the gate shows model selection controls:

- **Discoverable harnesses (e.g., Codex):** click the model pill to open favorites and browse/search all discovered models
- **Claude:** enter the model as free text
- **Selected model** is used for workspace launch

The default model for each harness can be configured in the header settings dropdown (gear icon).

## Creating Workspaces

From the gate or header toolbar:
- Click **Open Workspace**
- Enter a local directory path
- Directory autocomplete is available

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
