# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.2.0] - 2026-04-20

### Added

- **Clipboard Copy/Paste** — Terminal selections can be copied to clipboard; paste support via IPC bridge
- **Session History** — Resume past AI harness sessions from a searchable dropdown (Claude, Codex, OpenCode, Pi)
- **Custom Window Icon** — Externalized app icon with image file support
- **Harness Defaults & Flags** — Per-harness global defaults for model selection, flags (--yolo, --pure), and favorites
- **Harness Catalog** — Automatic detection of installed AI coding harnesses and available models
- **Git Branch in Status Bar** — Current branch displayed in status bar for quick reference
- **Browser Annotation** — Select elements in the browser panel to capture structured descriptions for AI agents
- **Workspace Residency** — Resource policy system for managing browser and terminal lifecycle on workspace switch
- **Editor File Watching** — File watcher integration for detecting external changes with auto-reload prompts
- **Terminal Write Capability** — Pipe data to PTY processes for harness interactions
- **ErrorBoundary** — Graceful React error handling with error dialog
- **DiffViewer** — Side-by-side diff viewing for git changes using CodeMirror MergeView
- **Commit Dialog Enhancement** — AI-generated commit messages with configurable provider and model

### Fixed

- Browser bounds flash on workspace switch (applied before setVisible)
- Browser lifecycle issues and editor pane styling
- Terminal micro-jitter in bounds IPC updates
- Explorer subtree state cleanup after rename/delete
- Terminal process cleanup on exit
- Production renderer path correction
- Global shortcut access when window is closed
- Secure storage requirement for credentials

### Restructured

- Modular GitButton split into dedicated components (Branches, Stash, Merge, History, Remotes sections)
- Terminal session management extracted into dedicated bridge module
- Workspace lifecycle management into dedicated modules
- Workspace layout into WorkspaceHost component
- Workspace scope management into dedicated component
- File system watching with improved test coverage
- Browser and window IPC with improved test coverage
- Window and AI commit IPC handlers extracted from settingsIpc
- WorkspaceStore helpers and types into separate modules
- Language detection to shared module
- Header and WorkspaceTabs styles to CSS files
- Commit dialog action buttons with flex layout
- Terminal buffer constants centralized
- Store invariants validation added
- Credential and git types moved to shared types

## [0.1.0] - 2026-04-07

### Added

- Multi-workspace terminal grid with PTY-backed terminals
- AI harness launcher (Codex, Claude, OpenCode, Pi)
- Integrated native browser panel
- Git integration (branch, merge, stash, commit, history, diff)
- AI-assisted commit message generation
- Drag-and-drop pane layout
- Persistent workspace state
- File explorer with context menus
- VCS provider integration (GitHub, GitLab, Bitbucket)
- SSH key generation and PAT storage

### Technical

- Electron 41 + React 19 + TypeScript 6
- Vite build system
- Vitest test framework
- Zustand state management
- node-pty + @xterm/xterm for terminals
