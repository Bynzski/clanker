# AGENTS.md

## Versions & Requirements

- **TypeScript:** 6.0.2
- **Electron:** 41.1.1
- **React:** 19.2.4
- **Node.js:** 22.12+ (required by current Vite/Electron rebuild tooling)
- **npm:** 10+

## Task Completion Requirements

- All `npm run lint`, `npm run typecheck`, and `npm run build` must pass before considering tasks completed.
- NEVER run bare `npm test`. Always use `npm run test` (runs Vitest).
- Run `npm run validate` as the final check — it runs lint → typecheck → build → test.

## Project Snapshot

Clanker Grid is a desktop developer workspace combining:
- Multi-pane terminal grid with PTY-backed shells
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
- **Canonical IPC path form** — All paths crossing IPC use POSIX separators. Main converts to native on entry and back to POSIX on return. Renderer assumes POSIX everywhere.

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
│   ├── gitService.ts       # Git CLI wrapper (1484 lines)
│   ├── terminalUtils.ts    # Terminal constants
│   ├── sessionHistory.ts   # Chat history discovery and caching
│   ├── harnessCatalog.ts   # Harness availability and model discovery
│   ├── harnessLaunch.ts    # Harness spawn argument construction
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
│   │   │   ├── GitButton.tsx        # Main git button/menu container
│   │   │   ├── GitBranchesSection.tsx
│   │   │   ├── GitStashSection.tsx
│   │   │   ├── GitMergeSection.tsx
│   │   │   ├── GitHistorySection.tsx
│   │   │   ├── GitRemotesSection.tsx
│   │   │   ├── ProviderBadge.tsx     # PR/MR status badge
│   │   │   └── ProviderMenu.tsx      # VCS quick links
│   │   └── FileExplorer/  # File tree explorer
│   ├── store/              # Zustand state
│   │   ├── workspaceStore.ts        # Main state (1688 lines)
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

Native `WebContentsView` in main, toolbar state in renderer. Only `http:`/`https:` URLs allowed. Annotation: element selection with injected JS runtime; escape handling via main process and runtime; re-inject on navigation.

### Git Integration

All operations via `src/main/gitService.ts` using `child_process.spawn` with argument arrays. Polling for status. AI commit in `aiCommit.ts`.

### State Management

- **`workspaceStore.ts`** (1688 lines) — owns all state: terminals, panes, editor, explorer, browser, git changes.
- **`workspaceStoreHelpers.ts`** — helpers for store.
- **`workspaceLayout.ts`** — layout tree operations.
- **`workspaceStoreTypes.ts`** & **`workspaceTypes.ts`** — type definitions.
- **`vcsStore.ts`** — VCS provider state.
- **`INVARIANTS.md`** — state contract documentation.
- **electron-store** persists: workspace, settings, harness defaults.

### Editor, Explorer, VCS Providers, Credentials

- Editor: CodeMirror with syntax highlighting, watched file changes.
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
npm run validate   # All of the above
```

## File Size Thresholds

Files over ~800 lines need justification. Currently oversized:

| File | Lines | Reason |
|------|-------|--------|
| `workspaceStore.ts` | 1688 | 50+ state actions with invariants |
| `gitService.ts` | 1484 | Git CLI wrapper, well-tested |
| `GitButton.tsx` | — | Refactored into modular components in `src/renderer/components/git/` |

## Testing

Tests split by environment (node vs jsdom) in config:
- `tests/main/**/*.test.ts` → node
- `tests/renderer/**/*.test.tsx` → jsdom

Use `installElectronApiMock()` for renderer tests. Renderer integration tests live in `workspaceStore.test.ts` and `appWorkspaceOpen.real.test.tsx`.

## Key Constraints

- **Harness wrapper** — Harnesses spawn via `~/.clanker-grid/harness-wrapper.sh` (generated by `harnessLaunch.ts`). Wrapper execs shell on exit to keep terminal usable.
- **Terminal continuity** — xterm instances cached in `TerminalPane.tsx` across workspace/tab switches.
- **Flow control disabled** — `handleFlowControl: false` on all PTY spawns to avoid startup stalls.
- **Harness flags** — Stored in `electron-store` under `harnessDefaults[harness].flags`, applied at spawn time.
- **Pane locking** — Respect lock state in layout operations.
- **Shared types** — IPC channels in `ipcChannels.ts`, types in `src/shared/types/`, store schema in `store.ts`.
- **Main exports internal** — `terminals`, `browserViews`, `gitService`, `store` exported for tests only.
