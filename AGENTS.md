# AGENTS.md

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

## Package Structure

```
src/
├── main/                      # Electron main process (Node.js)
│   ├── main.ts               # Entry point, window lifecycle, global state
│   ├── preload.ts            # Context bridge — all renderer-accessible IPC bindings
│   ├── windowManager.ts      # BrowserWindow creation and renderer URL resolution
│   ├── security.ts           # Path and URL validation
│   ├── gitService.ts         # Git CLI wrapper
│   ├── aiCommit.ts           # AI commit message generation
│   ├── harnessLaunch.ts     # Harness spawn argument construction
│   ├── harnessCatalog.ts     # Harness availability detection, model discovery
│   ├── fileService.ts        # File read/write operations
│   ├── fileWatcher.ts        # File system watching (couples to GitService)
│   ├── modelCache.ts         # Model availability caching
│   ├── terminalUtils.ts     # Terminal buffer constants (shared with renderer)
│   ├── annotation/           # Browser annotation feature
│   │   ├── annotationController.ts   # Main process controller
│   │   ├── annotationRuntime.ts      # Injected JS runtime (template string)
│   │   ├── annotationIpc.ts         # IPC handlers
│   │   └── index.ts         # Module exports
│   ├── ipc/                  # IPC handler registrations
│   │   ├── settingsIpc.ts    # Store, AI commit, harness, window controls
│   │   ├── terminalIpc.ts    # PTY spawn, write, resize, kill
│   │   ├── gitIpc.ts         # Git operations dispatch
│   │   ├── browserIpc.ts     # WebContentsView control
│   │   ├── fileIpc.ts         # File read/write/watch IPC
│   │   ├── credentialIpc.ts  # SSH key, PAT management
│   │   └── vcsIpc.ts         # VCS provider context and PR info
│   ├── credential/           # Credential management
│   │   ├── credentialService.ts
│   │   ├── sshKeyService.ts
│   │   ├── types.ts
│   │   └── index.ts
│   └── vcs/                  # VCS provider integration layer
│       ├── providerRegistry.ts
│       ├── providerDetector.ts
│       ├── contextService.ts
│       ├── types.ts
│       ├── index.ts
│       └── providers/        # GitHub, GitLab, Bitbucket providers
│           ├── baseProvider.ts   # Abstract base class — extend for new providers
│           ├── githubProvider.ts
│           ├── gitlabProvider.ts
│           ├── bitbucketProvider.ts
│           └── index.ts
│
├── renderer/                  # React frontend (browser)
│   ├── main.tsx              # React mount point
│   ├── App.tsx              # Root component, keyboard shortcuts
│   ├── electron.d.ts        # Ambient types for window.electronAPI
│   ├── components/          # UI components
│   │   ├── git/             # Git UI (Branches, Stash, History, Merge, Remotes)
│   │   ├── FileExplorer/    # File tree, context menu
│   │   ├── settings/        # Credential settings UI
│   │   ├── GitButton.tsx    # Git panel (see file size guidance)
│   │   ├── Header.tsx       # Toolbar, harness/settings dropdowns
│   │   ├── TerminalPane.tsx # xterm.js integration
│   │   ├── BrowserPanel.tsx # Browser overlay
│   │   ├── EditorPane.tsx   # CodeMirror editor pane
│   │   ├── EditorTabBar.tsx # Tab bar for open files
│   │   ├── CommitDialog.tsx # AI commit dialog
│   │   ├── DiffViewer.tsx   # Git diff display
│   │   ├── DynamicPaneLayout.tsx  # Resizable pane tree with drag-and-drop
│   │   ├── WorkspaceGate.tsx     # First-launch directory picker
│   │   ├── WorkspaceGateContent.tsx
│   │   ├── WorkspaceTabs.tsx
│   │   ├── TitleBar.tsx
│   │   ├── StatusBar.tsx
│   │   ├── ErrorBoundary.tsx
│   │   └── ConfirmCloseDialog.tsx
│   ├── store/               # Zustand state
│   │   ├── workspaceStore.ts     # All actions — terminals, panes, editor, explorer, workspaces
│   │   ├── workspaceStoreHelpers.ts  # Store helper functions
│   │   ├── workspaceStoreTypes.ts    # WorkspaceState interface and invariants
│   │   ├── workspaceLayout.ts       # Layout tree operations
│   │   ├── workspaceTypes.ts        # Shared type definitions (Pane, Terminal, etc.)
│   │   ├── vcsStore.ts              # VCS provider state
│   │   └── INVARIANTS.md            # State invariant documentation
│   ├── lib/                # Utilities
│   │   ├── harnessOptions.ts
│   │   ├── workspaceLifecycle.ts
│   │   ├── editorFileWatcher.ts
│   │   ├── editorLanguage.ts
│   │   ├── pathUtils.ts
│   │   └── keyboardShortcuts.ts
│   ├── types/
│   │   └── shared.ts
│   └── styles/
│       └── global.css
│
├── shared/                  # Types and constants shared by main and renderer
│   ├── ipcChannels.ts       # ⚠️ Canonical IPC channel constant reference
│   ├── terminal.ts           # Buffer size limits, trimBuffer utility
│   └── types/
│       ├── editor.ts         # File read/write/watch request/response types
│       ├── fileExplorer.ts   # FileExplorerEntry type
│       ├── fileOperations.ts # File create/delete/rename types
│       └── vcs.ts            # VCS context types
│
└── dist/                    # Build output (generated, gitignored)
    ├── main/
    ├── shared/
    └── renderer/
```

### Directory Ownership Notes

- **`src/main/ipc/`** — all IPC handler registrations live here. Register new handlers in the appropriate module by domain (see IPC Communication below).
- **`src/main/credential/`** — SSH key and PAT credential lifecycle. Public interface is through `credentialIpc.ts`.
- **`src/main/vcs/`** — VCS provider abstraction. `baseProvider.ts` defines the contract; add new providers (GitHub, GitLab, Bitbucket) by extending `BaseVcsProvider`.
- **`src/shared/`** — the only location for cross-boundary types used by both main and renderer.

## Key Implementation Details

### IPC Communication

Main ↔ Renderer communication via preload bridge (`src/main/preload.ts`):

**Canonical IPC channel reference:** All channel names are defined as named constants in `src/shared/ipcChannels.ts`. The `ALL_IPC_CHANNELS` array is used by integration tests to verify registration. Never hard-code channel name strings elsewhere.

| Module | Channels | Registration file |
|--------|----------|-------------------|
| Settings | last workspace, fastfetch, AI commit, harness options, window controls | `settingsIpc.ts` |
| Terminal | spawn, write, resize, kill, buffer, data, exit | `terminalIpc.ts` |
| Git | polling, status, stage, commit, branch, stash, merge, history, diff, remotes, push/pull/fetch | `gitIpc.ts` |
| Browser | navigate, back, forward, bounds, hide, dispose, external links | `browserIpc.ts` |
| Annotation | enable, disable, capture, get state, export, escape, trigger copy | `annotationIpc.ts` |
| File | read, write, watch, unwatch, changed, create, delete, rename | `fileIpc.ts` |
| Credentials | SSH keys, PAT management, SSH host configuration | `credentialIpc.ts` |
| VCS | context, PR info, deep links | `vcsIpc.ts` |
| Window | minimize, maximize, close, zoom, maximize-state | `settingsIpc.ts` |
| Clipboard | write | `terminalIpc.ts` |

**New IPC handler placement rule:** When adding a new IPC channel, register the handler in the module that matches the domain (see table above). If the domain has no existing module, add to the closest related module or create a new `*Ipc.ts` file under `src/main/ipc/`.

### Terminal Architecture

- PTY processes spawn in main via `node-pty` (owned in `terminals` Map in `main.ts`)
- Output streams to renderer via `TERMINAL_DATA` IPC event
- Renderer renders with `@xterm/xterm`; xterm owns the scrollback buffer
- Session continuity across workspace/tab switches via xterm instance caching (`xtermCache` Map in `TerminalPane.tsx`) — terminals are not remounted blank on switch-back
- Startup uses a bounded 16 KB buffer + `TERMINAL_READY` renderer handshake to protect the PTY init window (e.g., fish DA1 responses)
- Resize uses a bidirectional confirmation loop: `RESIZE_TERMINAL` IPC → PTY apply → `TERMINAL_RESIZED` event → renderer verifies geometry
- `handleFlowControl: false` is set on all PTY spawns (disabled as startup variable; re-enabling requires a Phase 2+ readiness plan)
- Terminal pane sizing syncs back to PTY on resize; rapid resize calls are coalesced via a 100 ms lock

### Browser Architecture

- Native `WebContentsView` managed in main process
- Renderer only controls toolbar state and bounds
- Security: only `http:`/`https:` URLs allowed
- New windows denied, redirected to system browser

### Browser Annotation

- Annotation mode enables element selection on web pages
- Runtime injected via `webContents.executeJavaScript()`
- In-page popup for note entry (not a React component)
- Selector ranking: `data-testid` → `id` → `role+aria-label` → `nth-of-type`
- Context extraction: UI region, element role, nearby text, ancestor context
- Two-layer escape handling: main process (`before-input-event`) + injected runtime
- Runtime re-injected on page navigation while annotation mode is active

### Git Integration

- All git operations via `src/main/gitService.ts`
- Uses Node.js `child_process.spawn` with argument-safe arrays
- Polling for status changes
- AI commit message generation in `src/main/aiCommit.ts`

### State Management

- **`workspaceStore.ts`** — owns all workspace state: active workspace, all workspaces, terminal list, pane layouts, browser, explorer, editor tabs, git changes. This file is large (~1532 lines) but well-documented with JSDoc invariants.
- **`workspaceStoreHelpers.ts`** — pure helper functions used by the store (sanitization, snapshot extraction, consistency validation in dev mode).
- **`workspaceLayout.ts`** — layout tree operations (insert, remove, swap, dock, normalize). Exports constants `GRID_COLS`, `GRID_ROWS`.
- **`workspaceStoreTypes.ts`** — the `WorkspaceState` interface with invariant `@invariant` JSDoc tags.
- **`workspaceTypes.ts`** — shared type definitions used by the store (Pane, Terminal, LayoutNode, WorkspaceTab, EditorTab, etc.).
- **`vcsStore.ts`** — VCS provider context and PR state.
- **`INVARIANTS.md`** (in store/) — plain-language documentation of store state contracts.
- **electron-store** persists: last workspace path, fastfetch setting, AI commit config.

### Editor

- `EditorPane.tsx` — CodeMirror-based file editor pane with syntax highlighting via `@codemirror/lang-javascript`, `@codemirror/lang-markdown`.
- `EditorTabBar.tsx` — Tab bar for open editor tabs.
- `DiffViewer.tsx` — Side-by-side git diff display.
- File changes are watched via `editorFileWatcher.ts` which bridges `fileWatcher.ts` (main) to store actions.
- State for editor tabs, active tab, pane visibility lives in `workspaceStore.ts`.

### File Explorer

- `src/renderer/components/FileExplorer/index.tsx` — main explorer component.
- `FileTree.tsx` — recursive directory tree rendering.
- `ContextMenu.tsx` — right-click context menu for file/directory operations.
- `fileTypeConfig.ts` — file type icons and classification.
- Explorer state (expanded paths, selected path, directory entries) lives in `workspaceStore.ts`.

### VCS Providers

- Abstract base class: `src/main/vcs/providers/baseProvider.ts`. Extend this to add a new VCS provider.
- Concrete providers: GitHub (`githubProvider.ts`), GitLab (`gitlabProvider.ts`), Bitbucket (`bitbucketProvider.ts`).
- Provider detection: `providerDetector.ts`; registry: `providerRegistry.ts`; context service: `contextService.ts`.
- VCS types (provider enum, context, PR info, deep links) are in `src/shared/types/vcs.ts`.

### Credentials

- SSH key generation, public key retrieval, deletion: `src/main/credential/sshKeyService.ts`.
- PAT (personal access token) management per VCS provider: `src/main/credential/credentialService.ts`.
- Types: `src/main/credential/types.ts`.
- Public interface is via `src/main/ipc/credentialIpc.ts`.

### Annotation Module

- `annotationController.ts` — Main process controller for annotation lifecycle. Manages enable/disable, injection, and clipboard export.
- `annotationRuntime.ts` — Injected JavaScript runtime as a template string. Renders crosshair cursor, hover highlights, selection popup, and note textarea. Exports structured Markdown to clipboard.
- `annotationIpc.ts` — IPC handlers for annotation operations. Registers all annotation channels and manages escape handlers.
- Context extraction helpers: `findNearestRegionLabel`, `inferRegionType`, `collectNearbyText`, `inferElementRoleInContext`.

## Code Standards

- TypeScript strict mode
- ESLint rules enforced
- Functional React components with hooks
- No `any` types without justification
- Test files colocated or in `tests/` directory

## Validation Pipeline

```bash
npm run lint          # ESLint
npm run typecheck     # TypeScript (main + renderer)
npm run build         # Vite + tsc
npm run test          # Vitest
npm run validate      # All of the above
```

## File Size Guidance

Flag files above ~400 lines for review during code review. Files above ~800 lines require documented justification or a clear reason to remain large.

Currently over size threshold (for reference — do not refactor without a plan):

| File | Lines | Note |
|------|-------|------|
| `src/renderer/store/workspaceStore.ts` | 1532 | Store with 50+ actions; documented with invariants |
| `src/main/gitService.ts` | 1484 | Git CLI wrapper; well-tested |
| `src/renderer/components/GitButton.tsx` | 1252 | Git UI panel; highest-priority split candidate |
| `src/renderer/components/WorkspaceGateContent.tsx` | 647 | Workspace onboarding UI |
| `src/renderer/components/FileExplorer/index.tsx` | 539 | File explorer component |
| `src/main/credential/credentialService.ts` | 502 | Credential management |
| `src/renderer/components/TerminalPane.tsx` | 562 | xterm instance cache, resize lock, startup handshake — stability-first design |

When adding new code to an already-large file, consider whether the change belongs in a new module or an existing helper file instead of growing the file further.

## Testing

| Location | Purpose |
|----------|---------|
| `tests/main/unit/` | Main process unit tests (run in `node` environment) |
| `tests/main/integration/` | Main process integration tests (terminal PTY, git service, IPC registration) |
| `tests/renderer/unit/` | Renderer component tests (run in `jsdom` environment) |
| `tests/renderer/integration/` | Renderer store integration tests |
| `tests/setup/` | Shared mocks, fixtures, and test helpers |

### Test Authoring Rules

- Vitest is split by project (main/renderer), configured in `vitest.config.ts`. The project environment is set by the config, not by `// @vitest-environment` comments.
- `tests/main/**/*.test.ts` runs in `node`; `tests/renderer/**/*.test.ts[x]` runs in `jsdom`.
- Use `installElectronApiMock()` for renderer tests that need `window.electronAPI`; only hand-roll `window.electronAPI` when a test needs a very specific shape.
- Renderer integration tests exist for workspace store (`tests/renderer/integration/workspaceStore.test.ts`) and workspace open flow (`tests/renderer/integration/appWorkspaceOpen.real.test.tsx`). These are not TODO — they are live coverage.

## Reference Repositories

- [node-pty](https://github.com/microsoft/node-pty) — PTY management for Node.js
- [@xterm/xterm](https://github.com/xtermjs/xterm.js) — Terminal emulator for browsers
- [electron-store](https://github.com/sindresorhus/electron-store) — Settings persistence

## Important Notes

- **Harnesses are optional** — The app works with plain shell terminals. AI harnesses enhance but aren't required.
- **Harness spawn is wrapper-based** — Harnesses run via a generated shell wrapper script (`~/.clanker-grid/harness-wrapper.sh`) written and managed by `src/main/harnessLaunch.ts`. The old `bash -i -c '<cmd>; exec "$SHELL" -i'` inline shell command is no longer used for harness spawns. When a harness exits, the wrapper script execs an interactive shell to keep the terminal pane usable.
- **Terminal continuity is via xterm caching** — Workspace/tab switching preserves terminal sessions by caching xterm.js instances in a `xtermCache` Map in `TerminalPane.tsx`. Terminals are NOT remounted blank on switch-back.
- **Flow control is disabled** — `handleFlowControl: false` is set on all PTY spawns to avoid shell startup stalls. Re-enabling it requires a proper post-startup readiness plan and is out of scope for Phase 1.
- **Flag/argument redesign is deferred** — Current flag and argument behavior is preserved. No redesign of the harness spawn argument system is planned.
- **Browser state is polled** — Renderer browser navigation state uses polling rather than event-driven updates.
- **Pane locking** — Users can lock panes to prevent reflow during insertions. Respect lock state in layout operations.
- **Shared type placement** — IPC channel names belong in `src/shared/ipcChannels.ts`; shared data types used across the main/renderer boundary belong in `src/shared/types/`; terminal constants belong in `src/shared/terminal.ts`.
- **Store file ownership** — Actions go in `workspaceStore.ts`; helpers go in `workspaceStoreHelpers.ts`; layout operations go in `workspaceLayout.ts`; types go in `workspaceStoreTypes.ts` or `workspaceTypes.ts`; invariants are documented in `INVARIANTS.md`.
- **Main process exports are internal** — `src/main/main.ts` exports `terminals`, `browserViews`, `gitService`, `store`, and `killAllTerminals` for test access. These are internal; do not build new features on them.
