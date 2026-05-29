# Clanker Grid — Technical Specification

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Electron Main                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐  │
│  │ Window  │  │  PTY    │  │ Browser │  │   GitService    │  │
│  │ Manager │  │ Pool    │  │ View    │  │   (git CLI)     │  │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────────┬────────┘  │
│       │            │            │                 │           │
│       └────────────┴────────────┴─────────────────┘           │
│                           │ IPC (preload bridge)              │
└───────────────────────────┼───────────────────────────────────┘
                            │
┌───────────────────────────┼───────────────────────────────────┐
│                    Renderer Process                           │
│  ┌──────────────┐  ┌─────┴──────┐  ┌────────────────────────┐  │
│  │ React App    │  │ Zustand    │  │ Components (xterm.js)  │  │
│  │ (Vite)       │  │ Store      │  │                        │  │
│  └──────────────┘  └────────────┘  └────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

## Stack

| Layer | Technology |
|-------|------------|
| Shell | Electron 41.x |
| Renderer | React 19, TypeScript 6, Vite |
| State | Zustand 5.x |
| Terminal | node-pty + @xterm/xterm |
| Layout | react-resizable-panels + @dnd-kit |
| Storage | electron-store |
| Browser | WebContentsView (native) |

## Data Models

### Workspace

```typescript
interface Workspace {
  id: string;
  name: string;
  path: string;
  harness: HarnessId;
  harnessModel?: string;
  terminals: Terminal[];
  panes: PaneTree;
  browser: BrowserState;
  activeTerminalId: string | null;
}

interface BrowserState {
  visible: boolean;
  url: string;
  paneLocked: boolean;
}
```

### Pane Tree

```typescript
type PaneTree = 
  | { type: 'leaf'; paneId: string }
  | { type: 'split'; orientation: 'horizontal' | 'vertical'; ratio: number; children: [PaneTree, PaneTree] };
```

### Terminal

```typescript
interface Terminal {
  id: string;
  pid: number;
  cwd: string;
}
```

### Git Types

```typescript
interface GitStatusResult {
  success: boolean;
  isRepo: boolean;
  currentBranch: string | null;
  isDetached: boolean;
  changes: GitStatus[];
  upstream: string | null;
  ahead: number;
  behind: number;
}

interface GitStash {
  hash: string;
  ref: string;
  message: string;
}
```

## IPC Channels

All IPC channel names are defined as constants in `src/shared/ipcChannels.ts`. Never hard-code channel strings.

### Terminal

| Channel | Direction | Payload |
|---------|-----------|---------|
| `spawn-terminal` | renderer → main | `{ cwd, harness?, model? }` |
| `write-terminal` | renderer → main | `{ id, data }` |
| `resize-terminal` | renderer → main | `{ id, cols, rows }` |
| `kill-terminal` | renderer → main | `id` |
| `get-terminal-buffer` | renderer → main | `{}` → `''` (deprecated, no-op) |
| `terminal-ready` | renderer → main | `id` |
| `write-clipboard` | renderer → main | `text` |
| `terminal-data` | main → renderer | `{ id, data }` |
| `terminal-exit` | main → renderer | `{ id, code }` |
| `terminal-resized` | main → renderer | `{ id, cols, rows }` |
| `terminal:cleanup-workspace` | renderer → main | `ids[]` |

### Git

| Channel | Direction | Payload |
|---------|-----------|---------|
| `git-start-polling` | renderer → main | `workspacePath` |
| `git-stop-polling` | renderer → main | `{}` |
| `git-get-branch-state` | renderer → main | `workspacePath` |
| `git-get-operation-state` | renderer → main | `workspacePath` |
| `git-get-stashes` | renderer → main | `workspacePath` |
| `git-get-history` | renderer → main | `workspacePath` |
| `git-get-diff` | renderer → main | `workspacePath` |
| `git-get-file-diff` | renderer → main | `{ path, oldPath?, newPath? }` |
| `git-stage` | renderer → main | `{ workspacePath, pattern }` |
| `git-unstage` | renderer → main | `{ workspacePath, pattern }` |
| `git-commit` | renderer → main | `{ workspacePath, message }` |
| `git-create-branch` | renderer → main | `{ workspacePath, name }` |
| `git-switch-branch` | renderer → main | `{ workspacePath, name }` |
| `git-delete-branch` | renderer → main | `{ workspacePath, name, force? }` |
| `git-merge-branch` | renderer → main | `{ workspacePath, branch }` |
| `git-abort-operation` | renderer → main | `workspacePath` |
| `git-stash` | renderer → main | `{ workspacePath, message? }` |
| `git-apply-stash` | renderer → main | `{ workspacePath, ref }` |
| `git-pop-stash` | renderer → main | `{ workspacePath, ref }` |
| `git-drop-stash` | renderer → main | `{ workspacePath, ref }` |
| `git-clear-stashes` | renderer → main | `workspacePath` |
| `git-refresh` | renderer → main | `workspacePath` |
| `git-init` | renderer → main | `workspacePath` |
| `git-get-remotes` | renderer → main | `workspacePath` |
| `git-add-remote` | renderer → main | `{ workspacePath, name, url }` |
| `git-remove-remote` | renderer → main | `{ workspacePath, name }` |
| `git-rename-remote` | renderer → main | `{ workspacePath, oldName, newName }` |
| `git-fetch` | renderer → main | `workspacePath` |
| `git-pull` | renderer → main | `workspacePath` |
| `git-push` | renderer → main | `workspacePath` |
| `git-status-update` | main → renderer | `GitStatusResult` |

### Browser

| Channel | Direction | Payload |
|---------|-----------|---------|
| `browser-set-bounds` | renderer → main | `{ x, y, width, height }` |
| `browser-hide` | renderer → main | `{}` |
| `browser-navigate` | renderer → main | `url` |
| `browser-back` | renderer → main | `{}` |
| `browser-forward` | renderer → main | `{}` |
| `browser-refresh` | renderer → main | `{}` |
| `browser-stop` | renderer → main | `{}` |
| `browser-dispose-workspace` | renderer → main | `workspaceId` |
| `browser-get-url` | renderer → main | `workspaceId` |
| `browser-save-url` | renderer → main | `{ workspaceId, url }` |
| `open-external` | renderer → main | `url` |
| `reveal-in-file-manager` | renderer → main | `path` |
| `can-go-back` | renderer → main | `{}` |
| `can-go-forward` | renderer → main | `{}` |
| `browser-url-updated` | main → renderer | `{ workspaceId, url }` |

### Session History

| Channel | Direction | Payload |
|---------|-----------|---------|
| `session-discover` | renderer → main | `workspacePath?` → `HarnessSession[]` |
| `session-invoke` | renderer → main | `{ session, fork? }` → terminal info |

### Annotation

| Channel | Direction | Payload |
|---------|-----------|---------|
| `annotation-enable` | renderer → main | `workspaceId` |
| `annotation-disable` | renderer → main | `{}` |
| `annotation-capture` | renderer → main | `{}` |
| `annotation-get-state` | renderer → main | `{}` |
| `annotation-export` | renderer → main | `{ annotation }` → Markdown string |
| `annotation-check-escaped` | renderer → main | `{}` |
| `annotation-escape` | main → renderer | `{}` |
| `annotation-trigger-copy` | renderer → main | `{}` |

### Credentials

| Channel | Direction | Payload |
|---------|-----------|---------|
| `credential:generate-ssh-key` | renderer → main | `{}` |
| `credential:get-public-key` | renderer → main | `{}` |
| `credential:delete-ssh-key` | renderer → main | `{}` |
| `credential:check-exists` | renderer → main | `{}` |
| `credential:save-pat` | renderer → main | `{ provider, token, scope }` |
| `credential:get-pat` | renderer → main | `provider` |
| `credential:delete-pat` | renderer → main | `provider` |
| `credential:get-status` | renderer → main | `provider` |
| `credential:get-global-status` | renderer → main | `{}` |
| `credential:configure-ssh-host` | renderer → main | `host` |

### VCS

| Channel | Direction | Payload |
|---------|-----------|---------|
| `vcs:get-context` | renderer → main | `workspacePath` |
| `vcs:get-pr-info` | renderer → main | `workspacePath` |
| `vcs:get-deep-links` | renderer → main | `workspacePath` |
| `vcs:get-deep-link` | renderer → main | `{ type, provider, context }` |
| `vcs:open-deep-link` | renderer → main | `url` |

### Settings

| Channel | Direction | Payload |
|---------|-----------|---------|
| `get-last-workspace` | renderer → main | `{}` |
| `get-ai-commit-settings` | renderer → main | `{}` |
| `set-ai-commit-enabled` | renderer → main | `boolean` |
| `set-ai-commit-provider` | renderer → main | `provider` |
| `set-ai-commit-model` | renderer → main | `model` |
| `generate-commit-message` | renderer → main | `workspacePath` |
| `get-harness-options` | renderer → main | `{}` |
| `get-harness-models` | renderer → main | `harness` |
| `get-harness-defaults` | renderer → main | `{}` |
| `set-harness-defaults` | renderer → main | `{ harness, defaults }` |
| `open-directory-dialog` | renderer → main | `{}` |
| `read-directory` | renderer → main | `path` |
| `file-list-directory` | renderer → main | `path` |

### Editor & File Operations

| Channel | Direction | Payload |
|---------|-----------|---------|
| `file-read` | renderer → main | `path` |
| `file-write` | renderer → main | `{ path, content }` |
| `file-changed` | main → renderer | `path` |
| `file-watch` | renderer → main | `path` |
| `file-unwatch` | renderer → main | `path` |
| `file-create` | renderer → main | `{ path, isDirectory }` |
| `file-delete` | renderer → main | `path` |
| `file-rename` | renderer → main | `{ oldPath, newPath }` |
| `explorer-tree-changed` | main → renderer | `{ workspaceId, tree }` |
| `explorer-start-watching` | renderer → main | `workspaceId` |
| `explorer-stop-watching` | renderer → main | `workspaceId` |

### Window Controls

| Channel | Direction | Payload |
|---------|-----------|---------|
| `minimize-window` | renderer → main | `{}` |
| `toggle-maximize-window` | renderer → main | `{}` |
| `close-window` | renderer → main | `{}` |
| `is-maximized-window` | renderer → main | `{}` |
| `zoom-in-window` | renderer → main | `{}` |
| `zoom-out-window` | renderer → main | `{}` |
| `reset-zoom-window` | renderer → main | `{}` |

## Security

- Context isolation enabled
- Renderer sandbox enabled
- URL schemes restricted (http/https for browser)
- External links restricted (http/https/mailto)
- Directory paths validated before use
- Git operations use argument-safe invocation

## Build Output

| Directory | Contents |
|-----------|----------|
| `dist/main/` | Compiled main process |
| `dist/renderer/` | Vite production bundle |
| `dist/shared/` | TypeScript declarations |
| `release/` | electron-builder output (AppImage on Linux; NSIS installer + portable executable on Windows) |
| `coverage/` | Test coverage reports |

## Supported platforms

| Platform | Target |
|----------|--------|
| Linux x64 | AppImage |
| Windows 10 1809+ / Windows 11 x64 | NSIS installer + portable executable (unsigned) |

macOS, ARM64, and WSL are not produced. Each platform must be built on its own host — there is no cross-compilation.

## CLI Commands

```bash
npm run dev              # Dev mode (renderer + main)
npm run build            # Production build
npm run validate         # lint + typecheck + build + test
npm run build:dist       # Create distributable
```
