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
| **Git Tools** | Branch, stash, merge, diff, remotes, and AI-assisted commits |
| **VCS Integration** | GitHub, GitLab, Bitbucket PR status, CI checks, and quick links |
| **Browser Panel** | Embedded browser alongside your terminals |
| **Editor Pane** | CodeMirror-based file editor with syntax highlighting |
| **File Explorer** | Tree view with context menu for file operations |
| **Credential Management** | SSH key generation and PAT storage for VCS authentication |

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
- [Browser Annotation](docs/browser-annotation.md) — Element selection and structured export for AI agents
- [Git Integration](docs/git-integration.md) — Built-in git tools with VCS provider support
- [VCS Providers](docs/vcs-providers.md) — Technical documentation for GitHub, GitLab, Bitbucket
- [File Explorer](docs/file-explorer.md) — File tree navigation and operations
- [Configuration](docs/configuration.md) — Settings and credentials
- [Keyboard Shortcuts](docs/keyboard-shortcuts.md) — Quick navigation
- [Contributing](CONTRIBUTING.md) — Development setup and PR guidelines
- [Agent Guidance](AGENTS.md) — Coding agent instructions and architecture

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| New Terminal | `Ctrl+Shift+T` |
| Close Workspace | `Ctrl+W` |
| Open Workspace | `Ctrl+O` |
| Toggle Browser | `Ctrl+B` |

## Architecture

Single-window Electron app with React renderer. State is split: main process owns system resources (PTY, browser, git CLI), renderer owns UI and user-facing state.

```
src/
├── main/                      # Electron main process (Node.js)
│   ├── ipc/                   # IPC handler registrations by domain
│   ├── credential/            # SSH key and PAT credential management
│   └── vcs/                   # VCS provider abstraction (GitHub, GitLab, Bitbucket)
├── renderer/                  # React frontend (browser)
│   ├── components/            # UI components
│   ├── store/                 # Zustand state management
│   └── lib/                   # Utilities
└── shared/                    # Types and constants for main/renderer
```

Main ↔ Renderer communication via preload bridge (`src/main/preload.ts`). Never import main modules from renderer.

## License

MIT
