<p align="center"><img src="src/assets/branding/clanker-wordmark.png" alt="Clanker Grid" width="560" /></p>

# Clanker Grid

> A developer workspace for the terminal-native era.

Clanker Grid is a single-window desktop app that brings your terminals, AI coding agents, git tools, and a browser together in one focused workspace. It's built for developers who live in the terminal and want their tools to live there too.

[![Electron](https://img.shields.io/badge/Electron-41.x-47848F?logo=electron)](https://electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## What it does

- **Terminal grid** — multiple terminal panes in flexible split layouts, with proper copy/paste.
- **AI harnesses** — launch Claude, Codex, OpenCode, Pi, OMP, Antigravity, or Hermes straight into a pane. Search and resume supported harness conversations locally or on an SSH host.
- **Optional Hermes Assistants** — connect your named Hermes profiles through `hermes serve`, keep each one's persistent Bot Chat open, and pair it with its own embedded Browser. Ordinary Hermes launching is unchanged and needs none of this.
- **Harness usage** — check subscription usage and remaining quota for Codex, Claude, OMP, Hermes, and Antigravity in the active local or SSH workspace. The Usage popover refreshes while open; choose which providers appear in Harness Defaults.
- **Git, built in** — branches, stashes, merges, diffs, remotes, and AI-assisted commits without leaving the app.
- **VCS at a glance** — PR status, CI checks, and quick links from GitHub, GitLab, and Bitbucket.
- **Embedded browser** — keep docs, dashboards, or your local app open right next to your code.
- **Editor & file tree** — CodeMirror-backed editing with syntax highlighting, Markdown preview, and a familiar explorer.
- **Multi-workspace** — every project gets its own workspace in a collapsible sidebar (or optional tabs); reorder them and switch context without losing it.
- **SSH workspaces** — open a remote Linux/POSIX directory with the built-in SSH directory chooser; terminals, Git, and installed AI harnesses run on that host, while Explorer and the editor monitor its remote files. Manage remote worktrees, track agent attention, resume supported conversations, and preview workspace-owned web services in the embedded Browser with automatic discovery and desktop loopback forwarding. Manual forwarding remains available as a fallback.
- **Credentials handled** — SSH key generation and encrypted PAT storage built in.

## Supported platforms

- **Linux (x64)** — primary development and required CI platform; AppImage build, tested on current desktop distributions. This is the actively produced release artifact for the current release.
- **Windows 10 1809+ / Windows 11 (x64)** — best-effort supported, without a native Windows CI or release gate. Compatibility code, tests and packaging remain; Windows artifacts may lag Linux releases. When produced, Windows builds are unsigned; SmartScreen will display a warning on first launch — choose **More info → Run anyway** to continue.

macOS, ARM64, and WSL are not produced in this release. WSL users should run the Linux AppImage.

SSH workspaces connect from the desktop app to remote Linux/POSIX hosts. Automatic web preview forwarding requires no Clanker daemon or helper on the host. Remote Windows hosts remain unsupported; see [SSH Workspaces](docs/workspaces.md#remote-workspaces-ssh).

## Install

Pre-built artifacts are attached to each [GitHub release](https://github.com/Bynzski/clanker/releases):

- `Clanker Grid-X.Y.Z.AppImage` — Linux. `chmod +x` and run.
- `Clanker Grid Setup X.Y.Z.exe` — Windows installer (NSIS), when a Windows artifact is produced. Adds Start Menu and uninstaller entries.
- `Clanker Grid X.Y.Z.exe` — Windows portable, when a Windows artifact is produced. Run without installing.

See [docs/getting-started.md](docs/getting-started.md) for first-launch walkthrough and [docs/windows.md](docs/windows.md) for Windows-specific notes (long paths, line endings, UNC workspaces, SSH lookup).

## Quick start (development)

```bash
git clone https://github.com/Bynzski/clanker.git
cd clanker
npm install
npm run dev
```

Requires **Node.js 22.12+** and **npm 10+**.

**Windows contributors:** install **Git for Windows**. Husky pre-commit hooks execute through the `sh` that ships with Git for Windows. Native modules (`node-pty`) are rebuilt against the Electron ABI on first `npm install`.

To build a distributable for the current platform:

```bash
npm run build
npm run build:dist
```

On Linux this produces an AppImage in `release/`. On Windows it produces an NSIS installer and a portable executable in `release/`. There is no cross-compilation — each platform must be built on its own host. See [RELEASING.md](RELEASING.md) for the release flow, including Linux-only releases.

## Documentation

The full docs are in [`docs/`](docs/):

- [Getting Started](docs/getting-started.md) — installation and first launch
- [Workspaces](docs/workspaces.md) — opening, switching, and managing workspaces (sidebar or tabs)
- [SSH Workspaces](docs/workspaces.md#remote-workspaces-ssh) — remote setup, directory browsing, and V1 limits
- [Terminals & Harnesses](docs/terminals.md) — terminal panes and AI integrations
- [Harness Usage](docs/terminals.md#subscription-usage) — quota windows, refresh behavior, and provider visibility
- [Git Integration](docs/git-integration.md) — built-in git tools
- [VCS Providers](docs/vcs-providers.md) — GitHub, GitLab, Bitbucket
- [Browser Tabs & History](docs/browser-tabs.md) — tabs, navigation, and DevTools
- [Browser Annotation](docs/browser-annotation.md) — element selection for AI agents
- [File Explorer](docs/file-explorer.md) — tree navigation and file operations
- [Configuration](docs/configuration.md) — settings and credentials
- [Keyboard Shortcuts](docs/keyboard-shortcuts.md) — quick navigation
- [Windows Notes](docs/windows.md) — Git for Windows, UNC watcher behavior, and long-path setup

For development setup, see [CONTRIBUTING.md](CONTRIBUTING.md). For codebase architecture and agent guidance, see [AGENTS.md](AGENTS.md).

## License

MIT
