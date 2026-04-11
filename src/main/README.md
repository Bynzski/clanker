# src/main/ — Electron Main Process

This directory contains all Electron main process code. The main process runs in Node.js and owns system resources: PTY processes, WebContentsView (browser panel), git CLI operations, file I/O, credential storage, and VCS provider HTTP calls.

## Directory Layout

```
src/main/
├── main.ts                  # App entry point, window creation, IPC orchestration
├── preload.ts               # Context bridge (window.electronAPI surface)
├── windowManager.ts         # BrowserWindow creation, renderer URL resolution
├── security.ts              # Path and URL validation
├── gitService.ts            # Git CLI wrapper
├── aiCommit.ts              # AI commit message generation
├── harnessLaunch.ts         # Harness spawn argument construction
├── harnessCatalog.ts        # Harness availability and model discovery
├── fileService.ts           # File read/write operations
├── fileWatcher.ts           # File system watching (couples to GitService)
├── modelCache.ts            # Model availability caching
├── terminalUtils.ts          # Terminal buffer constants (shared with renderer)
├── ipc/                     # IPC handler registrations
├── credential/              # SSH key and PAT credential management
└── vcs/                     # VCS provider abstraction (GitHub, GitLab, Bitbucket)
```

## Subdirectory Purposes

### `ipc/`

All IPC handler registrations. Each file corresponds to a domain:

| File | Handles |
|------|---------|
| `settingsIpc.ts` | Store schema, AI commit, harness options, window controls (zoom, minimize, maximize, close) |
| `terminalIpc.ts` | PTY spawn, write, resize, kill, buffer read, clipboard write |
| `gitIpc.ts` | Git polling, status, branch operations, stash, merge, history, diff, remotes, push/pull/fetch |
| `browserIpc.ts` | WebContentsView navigation, back/forward, bounds, external link handling |
| `fileIpc.ts` | File read, write, watch, unwatch, create, delete, rename |
| `credentialIpc.ts` | SSH key generation/retrieval/deletion, PAT management, SSH host configuration |
| `vcsIpc.ts` | VCS provider context, PR info, deep links |

**Adding new IPC handlers:** Register in the module matching the domain. If no module exists for the domain, create a new `*Ipc.ts` file here and add the registration call to `main.ts`.

### `credential/`

Credential lifecycle management:

- `credentialService.ts` — PAT management per VCS provider (save, get, delete, status)
- `sshKeyService.ts` — SSH key generation, public key retrieval, deletion
- `types.ts` — Credential service types

The public interface is through `ipc/credentialIpc.ts`. Do not call credential modules directly from outside `src/main/`.

### `vcs/`

VCS provider abstraction layer:

- `baseProvider.ts` — Abstract base class (`BaseVcsProvider`) defining the provider contract. Extend this for new VCS providers.
- `githubProvider.ts` — GitHub API integration (PR status, CI checks, deep links)
- `gitlabProvider.ts` — GitLab API integration
- `bitbucketProvider.ts` — Bitbucket API integration
- `providerRegistry.ts` — Maps remote URLs to provider instances
- `providerDetector.ts` — Detects which provider a remote URL belongs to
- `contextService.ts` — Aggregates context from the active provider

**Adding a new VCS provider:** Create a new file in `providers/`, extend `BaseVcsProvider`, implement all abstract methods, register in `providerRegistry.ts`, export from `providers/index.ts`.

## Root Files

| File | Purpose |
|------|---------|
| `main.ts` | Entry point. Creates the BrowserWindow, registers all IPC handlers, manages global state (terminals map, browserViews map). |
| `preload.ts` | Context bridge. Exposes `window.electronAPI` with all IPC bindings. |
| `windowManager.ts` | `createMainWindow()` function. Handles renderer URL resolution (dev vs prod) and icon path. |
| `security.ts` | `resolveExistingDirectory()` for path validation, `isUrlAllowed()` for browser URL allowlist. |
| `gitService.ts` | GitService class — git CLI wrapper. All git operations go through this class. |
| `aiCommit.ts` | AI commit message generation. Builds prompts and executes harness commands. |
| `harnessLaunch.ts` | Harness launch helpers — preserves argument construction and manages the generated wrapper script used for harness PTY spawning. |
| `harnessCatalog.ts` | `getAvailableHarnessOptions()` and `discoverHarnessModels()` — detects installed harnesses and available models. |
| `fileService.ts` | File read/write operations. Used by `fileIpc.ts`. |
| `fileWatcher.ts` | FileWatcherService — watches files and reports changes. Couples to GitService for external-change git status updates. |
| `modelCache.ts` | Model availability caching to avoid repeated harness calls. |
| `terminalUtils.ts` | `MAX_TERMINAL_BUFFER_BYTES` and `TERMINAL_SCROLLBACK_LINES` constants, `trimBuffer()` utility. |

## Key Constraints

- **No renderer imports.** `src/main/` modules must not be imported from `src/renderer/`. The preload bridge is the only communication path.
- **IPC channel names from `src/shared/ipcChannels.ts`.** Never hard-code channel strings.
- **Path validation before use.** Use `security.ts` `resolveExistingDirectory()` before any file system access.
- **Test exports are internal.** `main.ts` exports `terminals`, `browserViews`, `gitService`, `store`, `killAllTerminals` for test access only. Do not build new features on these exports.