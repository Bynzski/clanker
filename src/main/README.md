# src/main/ — Electron Main Process

This directory contains all Electron main process code. The main process runs in Node.js and owns system resources: PTY processes, WebContentsView (browser panel), local and SSH-backed Git and file operations, credential storage, and VCS provider HTTP calls.

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
├── harnessCatalog.ts       # Harness availability and model discovery
├── workspaceRegistry.ts     # Runtime workspace ID to environment and canonical root
├── environment/             # Local and SSH workspace environment resolution
├── remote/                  # Bounded OpenSSH commands and SSH filesystem implementation
├── sessionHistory.ts       # Chat history discovery and caching
├── fileService.ts           # File read/write operations
├── fileWatcher.ts           # File system watching (couples to GitService)
├── explorerWatcher.ts       # File explorer state watcher
├── modelCache.ts            # Model availability caching
├── terminalUtils.ts         # Terminal buffer constants (shared with renderer)
├── harnessDefaultsValidation.ts # Harness defaults validation
├── assistants/             # Optional Hermes Assistants (served Bot Chat)
│   ├── assistantSettings.ts       # {enabled, autoStart} validation and tolerant legacy read
│   ├── hermesAssistantService.ts  # Roster, canonical Bot Chat, /api/pty sessions, owned-service lifecycle
│   ├── hermesBackend.ts           # Backend adoption (bounded token bootstrap) and `hermes serve` start/readiness
│   └── hermesTransport.ts         # Injectable WebSocket + small JSON-RPC client
├── browserOwner.ts          # Browser owner validation (workspace vs Assistant)
├── ipc/                     # IPC handler registrations
│   ├── settingsIpc.ts      # Store schema, AI commit, harness options, window
│   ├── terminalIpc.ts       # PTY spawn, write, resize, kill, clipboard
│   ├── gitIpc.ts           # Git polling, status, branch, stash, merge, diff
│   ├── browserIpc.ts       # WebContentsView navigation, bounds
│   ├── fileIpc.ts          # File read, write, watch, create, delete, rename
│   ├── credentialIpc.ts    # SSH key, PAT management, SSH host config
│   ├── vcsIpc.ts           # VCS provider context, PR info, deep links
│   ├── aiCommitIpc.ts      # AI commit message generation
│   ├── sessionIpc.ts       # Session history IPC
│   ├── assistantIpc.ts     # Narrow Assistant bridge (opaque ids only)
│   ├── sshEnvironmentIpc.ts # Saved SSH targets, remote browsing and folder creation
│   ├── windowIpc.ts        # Window controls (zoom, minimize, maximize)
│   └── ptySpawn.ts         # PTY spawning utilities
├── annotation/             # Browser annotation feature
│   ├── annotationController.ts # Annotation lifecycle management
│   ├── annotationRuntime.ts   # Injected JS runtime in web content
│   ├── annotationIpc.ts        # Annotation IPC handlers
│   └── index.ts             # Public exports
├── credential/              # SSH key and PAT credential management
│   ├── credentialService.ts # PAT management per VCS provider
│   ├── sshKeyService.ts    # SSH key generation, retrieval, deletion
│   ├── types.ts            # Credential service types
│   └── index.ts            # Public exports
└── vcs/                     # VCS provider abstraction
    ├── providers/          # Provider implementations
    │   ├── baseProvider.ts      # Abstract base class
    │   ├── githubProvider.ts    # GitHub REST API
    │   ├── gitlabProvider.ts    # GitLab REST API
    │   ├── bitbucketProvider.ts # Bitbucket API
    │   └── index.ts             # Provider exports
    ├── providerDetector.ts  # Detects provider from remote URL
    ├── providerRegistry.ts  # Maps remotes to provider instances
    ├── contextService.ts   # Aggregates context from provider
    ├── types.ts            # VCS type definitions
    └── index.ts            # Public exports
```

## Subdirectory Purposes

### `ipc/`

All IPC handler registrations. Each file corresponds to a domain:

| File | Handles |
|------|---------|
| `settingsIpc.ts` | Persisted settings and harness defaults |
| `terminalIpc.ts` | PTY spawn, write, resize, kill, startup handshake, clipboard write |
| `gitIpc.ts` | Git polling, status, branch operations, stash, merge, history, diff, remotes, push/pull/fetch |
| `assistantIpc.ts` | Assistant settings/refresh, opening a surface, PTY write/resize; no generic Hermes RPC, URL or token channel |
| `browserIpc.ts` | WebContentsView navigation, back/forward, bounds, external link handling |
| `fileIpc.ts` | File read, write, watch, unwatch, create, delete, rename |
| `credentialIpc.ts` | SSH key generation/retrieval/deletion, PAT management, SSH host configuration |
| `vcsIpc.ts` | VCS provider context, PR info, deep links |
| `aiCommitIpc.ts` | AI commit message generation pipeline |
| `sessionIpc.ts` | Session history discovery and retrieval |
| `sshEnvironmentIpc.ts` | Saved SSH targets, remote directory browsing and folder creation |
| `windowIpc.ts` | Window controls (zoom, minimize, maximize) |
| `ptySpawn.ts` | PTY spawning utilities and session bridge |

**Adding new IPC handlers:** Register in the module matching the domain. If no module exists for the domain, create a new `*Ipc.ts` file here and add the registration call to `main.ts`.

### `credential/`

Credential lifecycle management:

- `credentialService.ts` — PAT management per VCS provider (save, get, delete, status)
- `sshKeyService.ts` — SSH key generation, public key retrieval, deletion
- `types.ts` — Credential service types
- `index.ts` — Public exports for credential module

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
- `index.ts` — Public exports for VCS module

**Adding a new VCS provider:** Create a new file in `providers/`, extend `BaseVcsProvider`, implement all abstract methods, register in `providerRegistry.ts`, export from `providers/index.ts`.

### `annotation/`

Browser annotation feature for capturing structured element descriptions:

- `annotationController.ts` — Annotation lifecycle management (enable, disable, capture, format)
- `annotationRuntime.ts` — Injected JavaScript runtime in web content (hover highlights, element selection, in-page popup)
- `annotationIpc.ts` — Annotation IPC handlers
- `index.ts` — Public exports

**Annotation workflow:** Main process injects runtime into WebContentsView, handles element selection, captures bounds/attributes/context, formats as Markdown for clipboard export.

## Root Files

| File | Purpose |
|------|---------|
| `main.ts` | Entry point. Creates the BrowserWindow, registers all IPC handlers, manages global state (terminals map, browserViews map). |
| `preload.ts` | Context bridge. Exposes `window.electronAPI` with all IPC bindings. |
| `windowManager.ts` | `createMainWindow()` function. Handles renderer URL resolution (dev vs prod) and icon path. |
| `security.ts` | `resolveExistingDirectory()` for path validation, `isUrlAllowed()` for browser URL allowlist. |
| `gitService.ts` | GitService class — git CLI wrapper. All git operations go through this class. |
| `aiCommit.ts` | AI commit message generation. Builds prompts and executes harness commands. |
| `harnessLaunch.ts` | Harness launch helpers. On Linux/macOS, manages the generated `~/.clanker-grid/harness-wrapper.sh` used for PTY spawning. On Windows, skips wrapper generation and uses `resolveHarnessPtySpawn()` (backed by `environment/boundedSpawn.ts`) for PTY launches so npm-installed `.cmd` shims still resolve while argument boundaries and `cmd.exe` metacharacters are handled by the one canonical planner; `resolveHarnessSpawn()` remains the legacy `cmd.exe /c` form for non-PTY callers; local session resume/fork also uses `resolveHarnessPtySpawn()`, planned after attention mutates the argv. |
| `platformShell.ts` | Single source of truth for default shell (`powershell.exe` on Windows, `$SHELL`/`bash` elsewhere) and `~/.local/bin` PATH prepending. |
| `harnessCatalog.ts` | `getAvailableHarnessOptions()` and `discoverHarnessModels()` — detects installed harnesses and available models. |
| `sessionHistory.ts` | Chat history discovery from Claude, Codex, OpenCode, Pi, and OMP session stores. Caches results for 60 seconds. |
| `fileService.ts` | File read/write operations. Used by `fileIpc.ts`. |
| `fileWatcher.ts` | Watches open editor files for external changes. |
| `explorerWatcher.ts` | Watches the active workspace's explorer tree for file changes. |
| `modelCache.ts` | Model availability caching to avoid repeated harness calls. |
| `terminalUtils.ts` | Re-exports shared terminal constants and deprecated compatibility helpers. |
| `harnessDefaultsValidation.ts` | Validation logic for harness default flags and model preferences. |

## Key Constraints

- **No renderer imports.** `src/main/` modules must not be imported from `src/renderer/`. The preload bridge is the only communication path.
- **IPC channel names from `src/shared/ipcChannels.ts`.** Never hard-code channel strings.
- **Path validation before use.** Validate untrusted workspace paths with `security.ts` and enforce the appropriate file-operation boundary for each IPC handler.
- **Workspace identity.** Resolve runtime `workspaceId` through `WorkspaceRegistry`; use its environment ID and canonical root for remote terminals, files, and Git. A path alone identifies only a legacy local request. The remote pre-workspace chooser is permission-bound by the SSH user; registered workspace operations remain root-confined.
- **Test exports are internal.** `main.ts` exports `terminals`, `browserViews`, `gitService`, `store`, `killAllTerminals` for test access only. Do not build new features on these exports.
- **Canonical IPC paths are POSIX.** Convert local paths to native (`path.sep`) at the main-process boundary and return forward slashes to the renderer. Keep SSH paths as POSIX paths on the remote host. Use the helpers in `src/shared/pathNormalize.ts`. See `AGENTS.md` Maintainability section.
- **Platform branching.** Use `src/main/platformShell.ts` for default-shell selection and `harnessLaunch.resolveHarnessPtySpawn()` for local PTY harness command resolution (`resolveHarnessSpawn()` is legacy, non-PTY only). Do not add ad-hoc `process.platform === 'win32'` branches; centralize them in these helpers.

## Hermes Assistants

`assistants/` is the whole optional Hermes Assistants integration; ordinary Hermes launching (`harnesses/hermes/`) is unrelated and never touches it. Main owns the Hermes service token, raw profile slugs, session IDs and backend/PTY connections; the renderer only ever holds opaque Assistant IDs and display-safe state. `browserOwner.ts` is main's authority for Browser ownership: an Assistant's Browser owner (`assistant-browser:<id>`) is local and valid only while `HermesAssistantService` resolves the id, so a fabricated id never creates a view. See [harness integration](../../docs/harness-integration.md#hermes-assistants) for the architecture.
