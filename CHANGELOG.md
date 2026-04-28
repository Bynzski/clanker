# Changelog

All notable changes to Clanker Grid are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-04-27

Initial public release.

### Added

- **Workspace tabs** — multi-workspace UI with per-workspace working directory and pane layout.
- **Workspace gate** — startup picker for working directory and initial layout / harness with single-key shortcuts.
- **Terminal grid** — multiple xterm.js terminal panes in flexible split layouts, backed by node-pty.
- **Terminal clipboard** — `Ctrl+Shift+C` to copy, mouse-selection auto-copy, paste via IPC bridge.
- **AI harness launchers** — start Claude, Codex, OpenCode, or Pi directly inside a terminal pane.
- **Harness catalog** — auto-detection of installed harnesses and their available models.
- **Harness defaults** — per-harness model selection, command flags, and favourites.
- **Session history** — resume past harness sessions from a searchable chat history dropdown.
- **Git tools** — branches, stash, merge, history, and remotes, all from inside the app.
- **AI-assisted commits** — generate commit messages from the commit dialog.
- **Diff viewer** — side-by-side diffs using CodeMirror MergeView.
- **VCS provider integration** — PR status, CI checks, and quick links for GitHub, GitLab, and Bitbucket.
- **Embedded browser panel** — browser tab alongside terminals, with zoom and DevTools controls.
- **Browser annotation** — select page elements to capture structured descriptions for AI agents.
- **Editor pane** — CodeMirror editor with syntax highlighting and tabbed buffers.
- **External change detection** — file watcher prompts to reload edited files when changed on disk.
- **File explorer** — tree view with context menu for create, rename, and delete operations.
- **Credential management** — SSH key generation and encrypted personal-access-token storage.
- **Linux AppImage build** — distributable produced via electron-builder.

### Known limitations

- macOS and Windows packaging targets are configured but not produced or tested in this release.

[Unreleased]: https://github.com/Bynzski/clanker/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Bynzski/clanker/releases/tag/v0.1.0
