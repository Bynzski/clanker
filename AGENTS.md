# AGENTS.md

## Versions & Requirements

- **TypeScript:** 6.0.2
- **Electron:** 41.10.7
- **React:** 19.2.4
- **Node.js:** 22.12+ (required by current Vite/Electron rebuild tooling)
- **npm:** 10+

## Task Completion Requirements

- All `npm run lint`, `npm run typecheck`, and `npm run build` must pass before considering tasks completed.
- NEVER run bare `npm test`. Always use `npm run test` (runs Vitest).
- Run `npm run validate` as the final check — it runs lint → typecheck → security-check (`npm audit --audit-level=high`) → build → test.

## Project Snapshot

Clanker Grid is a desktop developer workspace combining:
- Multi-pane terminal grid with PTY-backed shells
- Local and SSH workspace environments with remote files, Git, terminals, and harness discovery
- AI harness launcher (Codex, Claude, OpenCode, Pi)
- Integrated native browser panel with element annotation
- Built-in git tools (branch, stash, merge, commit, history)
- AI-assisted commit message generation

Single-window Electron app with React renderer. State is split: main process owns system resources (PTY, browser, git CLI), renderer owns UI and user-facing state.

## Core Priorities

1. **Security first** — Browser URLs, external links, and directory paths are validated. Never bypass security constraints.
2. **Reliability over features** — If a tradeoff is required, choose correctness and robustness over short-term convenience.
3. **Predictable under load** — Session state, terminal processes, and git operations must behave predictably during failures.

## Maintainability

Long-term maintainability is a core priority:

- **Duplicate logic is a code smell** — Check for existing modules before adding local logic.
- **Main/renderer separation** — System resources (PTY, git, browser) live in `src/main/`. UI lives in `src/renderer/`. Never import main modules from renderer.
- **IPC bridge only** — Renderer communicates with main via preload bridge. No direct Node.js access in renderer.
- **Extract shared logic** — When adding features, first check if shared utilities belong in a separate module under `src/renderer/lib/`.
- **Canonical IPC path form** — All paths crossing IPC use POSIX separators. Main converts local paths to native on entry and back to POSIX on return; SSH paths stay POSIX on the remote host. Renderer assumes POSIX everywhere.

## Windows Support

Windows 10 1809+ is a supported platform. Key patterns:

- **Default shell:** `powershell.exe` (via `src/main/platformShell.ts:defaultShell()`). Never pass `-i` — PowerShell is interactive by default.
- **Harness spawn:** npm-installed CLI tools are `.cmd` wrappers on Windows. Use `resolveHarnessSpawn()` from `harnessLaunch.ts` which wraps commands in `cmd.exe /c` for extension resolution. Never spawn harness commands directly on Windows.
- **Path separators:** Main process uses native `path.sep` (`\` on Windows). Renderer normalizes to forward slashes (`/`). Paths crossing IPC must be normalized at the boundary.
- **Path-keyed maps:** All `Map`/`Set` keys in the renderer must use forward-slash paths. Normalize entry paths from IPC responses before storing.
- **No wrapper script:** `ensureHarnessWrapperScript()` returns `null` on Windows. The POSIX wrapper only applies to Linux/macOS.
- **SSH permissions policy:** On Windows, rely on inherited NTFS ACLs under `%USERPROFILE%\.ssh`; do not treat POSIX `mode/chmod` as effective. Keep explicit POSIX modes only on non-Windows.
- **Process kill:** `node-pty.kill()` may emit a SIGTERM warning on Windows before falling back to `TerminateProcess`. Wrap in try-catch.
- **Husky hooks on Windows:** Git hooks run via the `sh` bundled with Git for Windows. Windows contributors must install Git for Windows and run commits through that Git installation.

## Package Structure

```
src/
├── main/                    # Electron main process
│   ├── main.ts             # Entry point, window lifecycle
│   ├── preload.ts          # IPC context bridge
│   ├── gitService.ts       # Git CLI wrapper
│   ├── terminalUtils.ts    # Terminal constants
│   ├── sessionHistory.ts   # Chat history discovery and caching
│   ├── harnessCatalog.ts   # Harness availability and model discovery
│   ├── harnessLaunch.ts    # Harness spawn argument construction
│   ├── workspaceRegistry.ts # Workspace ID → environment and canonical root
│   ├── environment/       # Local and SSH environment resolution
│   ├── remote/            # OpenSSH command executor and remote filesystem
│   ├── ipc/                # IPC handler registrations by domain
│   │   ├── settingsIpc.ts  # Store schema, AI commit, harness options, window
│   │   ├── terminalIpc.ts  # PTY spawn, write, resize, kill
│   │   ├── gitIpc.ts       # Git operations, polling, branch, stash
│   │   ├── browserIpc.ts   # WebContentsView navigation and bounds
│   │   ├── fileIpc.ts      # File read, write, watch, operations
│   │   ├── credentialIpc.ts # SSH key and PAT management
│   │   ├── vcsIpc.ts       # VCS provider context and PR info
│   │   ├── aiCommitIpc.ts  # AI commit message generation
│   │   ├── sessionIpc.ts   # Session history IPC
│   │   ├── sshEnvironmentIpc.ts # Saved targets, remote browsing, folder creation
│   │   └── windowIpc.ts    # Window controls (zoom, minimize, maximize)
│   ├── annotation/         # Browser annotation feature
│   │   ├── annotationController.ts # Annotation lifecycle
│   │   ├── annotationRuntime.ts    # Injected JS runtime
│   │   └── annotationIpc.ts         # Annotation IPC handlers
│   ├── credential/         # SSH key and PAT management
│   │   ├── credentialService.ts    # PAT encrypted storage
│   │   └── sshKeyService.ts        # SSH key generation
│   └── vcs/                # VCS provider abstraction
│       ├── providers/      # Provider implementations
│       │   ├── baseProvider.ts      # Abstract base class
│       │   ├── githubProvider.ts    # GitHub REST API
│       │   ├── gitlabProvider.ts    # GitLab REST API
│       │   └── bitbucketProvider.ts # Bitbucket API
│       ├── providerDetector.ts      # URL → provider detection
│       ├── providerRegistry.ts     # Provider instance management
│       └── contextService.ts        # API call orchestration
├── renderer/               # React frontend
│   ├── components/         # UI: Terminal, Editor, Git, Browser, FileExplorer
│   │   ├── git/            # Modular git UI components
│   │   │   ├── GitBranchesSection.tsx
│   │   │   ├── GitStashSection.tsx
│   │   │   ├── GitMergeSection.tsx
│   │   │   ├── GitHistorySection.tsx
│   │   │   ├── GitRemotesSection.tsx
│   │   │   ├── ProviderBadge.tsx     # PR/MR status badge
│   │   │   └── ProviderMenu.tsx      # VCS quick links
│   │   └── FileExplorer/  # File tree explorer
│   ├── store/              # Zustand state
│   │   ├── workspaceStore.ts        # Main state
│   │   ├── workspaceStoreHelpers.ts # State action helpers
│   │   ├── workspaceLayout.ts       # Layout tree operations
│   │   ├── workspaceStoreTypes.ts   # Type definitions
│   │   └── vcsStore.ts              # VCS provider state
│   ├── lib/                # Utilities: harness, editor, workspace lifecycle
│   └── styles/             # Global CSS
├── shared/                 # Cross-boundary types
│   ├── ipcChannels.ts      # IPC channel constants (canonical reference)
│   ├── harnessIds.ts       # Harness ID constants
│   └── types/              # Shared data types
└── dist/                   # Build output (generated)
```

## Key Implementation Details

### IPC Communication

Channel names are **constants in `src/shared/ipcChannels.ts`** — never hard-code strings. Register handlers in `src/main/ipc/*Ipc.ts` files by domain (Settings, Terminal, Git, Browser, Annotation, File, Credentials, VCS). The `ALL_IPC_CHANNELS` array verifies registration in tests.

### Terminal Architecture

PTY processes in main via `node-pty`, stream via IPC to renderer (@xterm/xterm 6.0.0). Session continuity via xterm instance caching in `TerminalPane.tsx`. Startup handshake protects init window. Resize via bidirectional loop. Flow control disabled. Pane resizes coalesce via 100ms lock.

### Browser & Annotation

Browser visibility belongs to the workspace explicitly activated through `BROWSER_ACTIVATE`, which reconciles its renderer-selected tab. Background create/switch/close/reorder/bounds operations cannot claim visibility; bounds remain non-authoritative for established tab selection. Async tab actions must respect newer selections and workspace switches.

Native `WebContentsView` in main, toolbar state in renderer. Web-initiated navigation is limited to `http:`/`https:`; trusted app navigation also accepts local `file:` URLs and absolute paths. External-open URLs are separately validated. Annotation: element selection with injected JS runtime; escape handling via main process and runtime; re-inject on navigation.

### Git Integration

All operations via `src/main/gitService.ts`, scoped to the registered workspace. Local Git uses `child_process.spawn` with argument arrays; remote Git executes through system SSH on the workspace host. Polling for status. AI commit in `aiCommit.ts` is local-only in V1.

### SSH Workspaces

- **Identity:** `environmentId` plus canonical workspace path. Runtime requests use `workspaceId` to resolve the authoritative environment and root through `WorkspaceRegistry`. Legacy path-only records are local.
- **Transport:** System OpenSSH; the remote host must be Linux/POSIX with Python 3 for filesystem operations. SSH environments are saved by ID, and an in-use target cannot be edited or deleted.
- **Pre-workspace browsing:** The application-rendered remote chooser lists directories the SSH account may access, prefers an accessible saved `defaultWorkspaceRoot`, falls back to `$HOME/workspaces` then `$HOME`, and can create a direct child folder. This broader browsing scope does not change root confinement after workspace registration.
- **V1 limits:** No remote recipes, submodule worktree removal, model discovery, native session recovery, AI commit generation, native push file watchers, or automatic port discovery. Remote checkouts may be discovered, created, or inspected from registered SSH repositories in the launcher and opened in the same environment. Read-only inspection verifies repository membership and canonical paths, includes ignored/untracked files in initialized submodules recursively (overriding submodule ignore settings, with a 128-repository limit), and derives active paths from registered workspaces and remote terminal launch directories sharing the same SSH target string (including duplicate saved environments). Creation uses a focused SSH collaborator with exclusive destination reservation and preserves partial output on failure. Remote removal (`worktrees: true`) rechecks branch, cleanliness, and activity; it reserves original/staging/recovery paths, preserves checkout files in a private host recovery folder, and keeps the branch. Submodule removal fails closed. Unknown SSH outcomes keep reservations until the host completion journal is verified. Registration rechecks reservations after SSH validation; pending terminal spawns recheck registration and reservations before PTY creation. The active SSH workspace uses one batched metadata poll for up to 128 editor files and 128 visible/expanded directories, with at most 2,000 direct children per directory. Polls run about every three seconds without overlap and back off on SSH failures. Clean tabs reload safely; dirty buffers are preserved and flagged. Focus/manual refresh remains available. Remote task records become `unavailable` on terminal exit or app shutdown.
- **Remote Agent Attention:** Optional per-harness launch hooks carry bounded lifecycle-only OSC frames over the existing SSH PTY. Main creates fresh remote-only credentials and validates both the terminal and credential; desktop listener credentials are never forwarded. Codex, Claude, OpenCode, Pi, OMP, Antigravity, and Hermes have adapters, with only their native events supported. Conflicting hook/profile configuration fails closed. Node.js is needed for Codex/Claude/Pi/OMP/Antigravity hooks; OpenCode uses its own runtime and Hermes uses Python. Antigravity and Hermes install owned, inert-without-launch-credentials observer plugins; Hermes enables its plugin using the native CLI. Launch files are cleaned on harness/terminal exit where SSH remains reachable. Local Hermes attention and remote annotation handoff remain unsupported.
- **SSH browser previews:** Explicit ports use a focused forwarding collaborator through the registered environment. One preview per workspace, at most 16 managed previews; only local/remote IPv4 loopback and ports 1024–65535. Main reserves ports during startup/cleanup and rejects stale registrations. Owned SSH clients avoid multiplexing/forking, preserve host-key checks, and strip attention credentials. Startup checks the remote service, connects through the local listener, and requires SSH confirmation of a direct-tcpip channel before reporting readiness. Forwarding rejections during startup or later use close the client and surface an error; no helper installation or remote daemon. Configured SSH forwards are rejected. Stop/workspace close/window close/shutdown clean up; switching/hiding keeps the tunnel. Rules are not persisted or auto-restored.
- **Live testing:** Follow `docs/remote-vps-smoke-test.md`; destructive checks use a unique temporary fixture and preserve `clanker-test`.

### State Management

- **`workspaceStore.ts`** — owns workspace UI state: terminals, panes, editor, explorer, browser, git changes.
- **`workspaceStoreHelpers.ts`** — helpers for store.
- **`workspaceLayout.ts`** — layout tree operations.
- **`workspaceStoreTypes.ts`** & **`workspaceTypes.ts`** — type definitions.
- **`vcsStore.ts`** — VCS provider state.
- **`INVARIANTS.md`** — state contract documentation.
- **electron-store** persists: workspace, settings, harness defaults.

### Editor, Explorer, VCS Providers, Credentials

- Editor: CodeMirror with syntax highlighting, local watched file changes, and bounded polling of active SSH workspace files. Automatic reloads recheck dirty state before applying results.
- Explorer: File tree, context menu, type icons.
- VCS: Extend `baseProvider.ts` for new providers (GitHub, GitLab, Bitbucket).
- Credentials: SSH keys and PATs via `credentialService.ts` and `sshKeyService.ts`.

## Code Standards

- TypeScript strict mode (6.0.2)
- ESLint enforced (9.38.0)
- Functional React components with hooks
- No `any` without justification
- Tests in `tests/` directory

## Validation Pipeline

```bash
npm run lint       # ESLint
npm run typecheck  # TypeScript
npm run build      # Vite + tsc
npm run test       # Vitest
npm run security-check # npm audit --audit-level=high
npm run validate   # lint, typecheck, security-check, build, test
```

## File Size Thresholds

Files over ~800 lines need justification. Keep new behavior in focused modules where possible; `workspaceStore.ts` and `gitService.ts` are large, established integration points.

## Testing

Tests split by environment (node vs jsdom) in config:
- `tests/main/**/*.test.ts` → node
- `tests/renderer/**/*.test.tsx` → jsdom

Use `installElectronApiMock()` for renderer tests. Renderer integration tests live in `workspaceStore.test.ts` and `appWorkspaceOpen.real.test.tsx`.

## Key Constraints

- **Harness wrapper** — Local POSIX harnesses spawn via `~/.clanker-grid/harness-wrapper.sh` (generated by `harnessLaunch.ts`). Remote harnesses use SSH and return to a remote login shell on exit. Windows local harnesses use `cmd.exe /c`.
- **Terminal continuity** — xterm instances cached in `TerminalPane.tsx` across workspace/tab switches.
- **Flow control disabled** — `handleFlowControl: false` on all PTY spawns to avoid startup stalls.
- **Harness flags** — Stored in `electron-store` under `harnessDefaults[harness].flags`, applied at spawn time.
- **Pane locking** — Removed from the product; do not add lock-state gating to layout or pane actions.
- **Shared types** — IPC channels in `ipcChannels.ts`, types in `src/shared/types/`, store schema in `store.ts`.
- **Main exports internal** — `terminals`, `browserViews`, `gitService`, `store` exported for tests only.
