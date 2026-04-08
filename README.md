# Clanker Grid

> Developer workspace with terminal grid, AI harness launchers, git controls, and integrated browser.

[![Validate](https://github.com/clanker-grid/clanker-grid/actions/workflows/validate.yml/badge.svg)](https://github.com/clanker-grid/clanker-grid/actions/workflows/validate.yml)
[![Electron](https://img.shields.io/badge/Electron-41.x-47848F?logo=electron)](https://electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Features

| Feature | Description |
|---------|-------------|
| **Terminal Grid** | Multiple terminal panes with flexible split layouts |
| **AI Harnesses** | Launch Codex, Claude, OpenCode, or Pi directly in your workspace |
| **Multi-Workspace** | Work on multiple projects in separate tabs |
| **Git Tools** | Branch, stash, merge, diff, and AI-assisted commits |
| **VCS Integration** | GitHub, GitLab, Bitbucket PR status, CI checks, and quick links |
| **Browser Panel** | Embedded browser alongside your terminals |

## Quick Start

### Prerequisites

- Node.js 18+
- npm

### Install & Run

```bash
git clone https://github.com/clanker-grid/clanker-grid.git
cd clanker-grid
npm install
npm run dev
```

### Build

```bash
npm run build
npm run build:dist    # Creates distributable
```

## Documentation

- [Getting Started](docs/getting-started.md) — Installation and first launch
- [Workspaces](docs/workspaces.md) — Managing workspace tabs
- [Terminals & Harnesses](docs/terminals.md) — Terminal panes and AI integrations
- [Git Integration](docs/git-integration.md) — Built-in git tools with VCS provider support
- [VCS Providers](docs/vcs-providers.md) — Technical documentation for GitHub, GitLab, Bitbucket
- [Configuration](docs/configuration.md) — Settings and credentials
- [Keyboard Shortcuts](docs/keyboard-shortcuts.md) — Quick navigation

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| New Terminal | `Ctrl+Shift+T` |
| Close Workspace | `Ctrl+W` |
| Open Workspace | `Ctrl+O` |
| Toggle Browser | `Ctrl+B` |

## License

MIT
