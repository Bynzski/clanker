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
- Run `npm run validate` as the final check — it runs branding check → lint → typecheck → security-check → build → test. `security-check` (`scripts/security-audit.cjs`) fails on any high/critical `npm audit` finding except the single documented dev-only electron-builder chain (`GHSA-ch52-4w7c-c8xp`); see `RELEASING.md`.

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
- **Harness spawn:** npm-installed CLI tools are `.cmd` wrappers on Windows. PTY launches use `resolveHarnessPtySpawn()` from `harnessLaunch.ts`, which resolves through `PATH`/`PATHEXT` via the shared `planBoundedSpawn()` (`.exe` direct, `.cmd`/`.bat` through escaped `cmd.exe /d /s /c`, `%`/CR/LF and unresolvable commands fail closed). Never hand-build `cmd.exe /c` lines for PTY harness launches.
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
│   ├── accounts/           # Optional Codex/Claude managed accounts (main-owned)
│   │   ├── harnessAccountService.ts # IDs, selection, persistence, auth flows, launch binding
│   │   ├── accountHomes.ts         # Owned account directories + path safety
│   │   └── accountExecution.ts     # Account-bound command executors
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
- **Transport:** System OpenSSH; the remote host must be Linux/POSIX with Python 3 for filesystem operations. SSH environments are saved by ID, and a target with an open or registering workspace or pending removal cannot be edited or deleted.
- **Pre-workspace browsing:** The application-rendered remote chooser lists directories the SSH account may access, prefers an accessible saved `defaultWorkspaceRoot`, falls back to `$HOME/workspaces` then `$HOME`, and can create a direct child folder. This broader browsing scope does not change root confinement after workspace registration.
- **V1 limits:** No remote recipes, submodule worktree removal, Claude/Hermes model discovery, remote process persistence, AI commit generation, or native push file watchers. Remote checkouts are created, adopted, inspected and removed from an open SSH repository workspace (the isolated-agent picker and the Git menu), never from the startup launcher; the former launcher components (`WorktreeLauncher`, `RemoteWorktreePicker`, `RemoteWorktreeCreate`, `RemoteWorktreeInspect`) are no longer rendered. Read-only inspection verifies repository membership and canonical paths, includes ignored/untracked files in initialized submodules recursively (overriding submodule ignore settings, with a 128-repository limit), and derives active paths from registered workspaces and remote terminal launch directories sharing the effective OpenSSH hostname, user, port, and proxy route (including equivalent aliases and duplicate saved environments). Creation uses a focused SSH collaborator with exclusive destination reservation and preserves partial output on failure. Remote removal (`worktrees: true`) rechecks branch, cleanliness, and activity; it reserves original/staging/recovery paths, preserves checkout files in a private host recovery folder, and keeps the branch. Submodule removal fails closed. Removal reservations are persisted before host dispatch and restored after restart. Unknown SSH outcomes keep reservations until the host completion journal is verified; changing external SSH configuration cannot move a saved reservation to a different host. Registration rechecks reservations after SSH validation; pending terminal spawns recheck registration and reservations before PTY creation. The active SSH workspace uses one batched metadata poll for up to 128 editor files and 128 visible/expanded directories, with at most 2,000 direct children per directory. Polls run about every three seconds without overlap and back off on SSH failures. Clean tabs reload safely; dirty buffers are preserved and flagged. Focus/manual refresh remains available. Clanker records no durable task state for SSH launches; native conversations stay discoverable through the registered SSH environment only.
- **Remote Agent Attention:** Optional per-harness launch hooks carry bounded lifecycle-only OSC frames over the existing SSH PTY. Main creates fresh remote-only credentials and validates both the terminal and credential; desktop listener credentials are never forwarded. Codex, Claude, OpenCode, Pi, OMP, Antigravity, and Hermes have adapters, with only their native events supported. Conflicting hook/profile configuration fails closed. Node.js is needed for Codex/Claude/Pi/OMP/Antigravity hooks; OpenCode uses its own runtime and Hermes uses Python. Antigravity and Hermes install owned, inert-without-launch-credentials observer plugins; Hermes enables its plugin using the native CLI. Launch files are cleaned on harness/terminal exit where SSH remains reachable. Local Hermes attention remains unsupported. Remote annotation handoff writes into the live SSH PTY only for broker-eligible agent terminals whose registered workspace, environment and remote working directory match; it opens no connection.
- **SSH browser previews:** Browser leases trigger bounded workspace-aware HTTP/HTTPS listener discovery, shared across resolved SSH hosts, with a short adaptive startup burst then minute-scale backoff. Trusted remote terminal loopback URLs accelerate active discovery. One workspace-owned service opens automatically; multiple/unscoped services require selection. Main allocates loopback-only desktop ports and owns up to four forwards per workspace/sixteen globally. Remote IPv4/IPv6 loopback and wildcard listeners are normalized; ports remain 1024–65535. SSH transport readiness is separate from service health, so delayed startup/restarts recover on the same tunnel. Owned system OpenSSH `-N` children preserve host-key checks and strip attention credentials; policy rejection/disconnect is a distinct transport error. No helper installation or remote daemon. Configured SSH forwards are rejected. Stop/workspace close/window close/renderer loss/shutdown clean up; switching/hiding suspends discovery and keeps forwards alive. Quit waits for child termination and terminal resource cleanup. Forwarding rules are not persisted.
- **Live testing:** Follow `docs/remote-vps-smoke-test.md`; destructive checks use a unique temporary fixture and preserve `clanker-test`.
- **Remote session history:** Read-only discovery uses the registered SSH environment and host-installed harnesses, never desktop history. Codex/Claude/Pi/OMP JSONL metadata and Antigravity's read-only SQLite database are scanned on-host; OpenCode uses its native JSON/JSONL session-list command with an explicit 4,097-row request, rejecting results above 4,096 rather than accepting its default page. Conflicting duplicate session metadata fails discovery. Canonical workspace containment applies to session cwd, including symlink resolution. Scans are bounded to 16 MiB of JSONL metadata (256 KiB per session file, 4 MiB for Codex's title index), 4,096 directories/8,192 entries per store, 4,096 database/CLI rows, 512 matching results, and 1 MiB per SSH response. Discovery errors are shown; late responses from closed/replaced/switched workspaces are discarded. Remote resume rediscovers the selected ID/harness on the host and uses only authoritative metadata; conflicting selection flags fail closed. A pure CLI argument builder is shared with local invocation. Before PTY creation main rechecks registration/shutdown/removal reservations; the remote launch script rechecks canonical root/cwd and Pi/OMP session-store files. Resume preserves remote attention filtering/cleanup and environment-scoped identity. Supported native forks create a new host conversation; Antigravity forking fails closed. Hermes history and remote process persistence remain unsupported.

### Checkout Contexts (issue #90, in progress)

A *checkout context* (`src/shared/types/checkoutContext.ts`) is one validated working root inside an environment; the workspace owns one or more (`id`, `workspaceId`, `environmentId`, canonical POSIX `path`, `kind: 'main' | 'worktree'`, optional `branch`/`mainCheckoutPath`). It describes root identity only, never UI state.

- **Authority:** `WorkspaceRegistry` in main holds the validated contexts. Registration creates the workspace's `main` context (id `<workspaceId>::main`, derivable by both processes so legacy data backfills without migration). `registerCheckoutContext()` validates an additional root through the same environment checks and removal reservations as a workspace, independently of the workspace root; it is main-only and not exposed to the renderer yet. Unregistering a workspace drops all its contexts.
- **Terminals:** `SPAWN_TERMINAL` takes an optional `checkoutContextId` (default: the workspace's main context) and resolves `workspace -> context -> root`. SSH launches are confined to *that context's* root (fail-closed); local launches are confined to the resolved context's root too, whether it was requested or implicitly the main context (only a launch resolving no workspace/context stays unbound legacy behavior). Terminals record `checkoutContextId`; resumed sessions bind to the main context. A context from another workspace never resolves.
- **Existing worktrees live in the Git menu, management only:** `GitWorktreesSection` lists the linked worktrees (never the main checkout; reloads with the menu's own refresh, no polling) and tags each by path identity: *In use* / *Managed* (attached context) or *Unmanaged* (made outside Clanker, by the old launcher, or released). Managed removal goes through `removeWorktreeCheckout`; unmanaged removal through `removeUnmanagedWorktree` (existing inspect/remove with local open workspace paths; SSH activity is derived in main), which refuses a path that has an attached context so the lifecycles cannot be mixed. The workspace's own checkout, in-use, locked and missing ones offer no Remove. A *Locked* row (tagged with its ownership, e.g. `Managed · Locked`) offers `Unlock` (`GIT_UNLOCK_WORKTREE`): main matches the path against `git worktree list` (linked, not main, currently locked) and unlocks Git's own listed path, nothing more; removal stays a separate step. *Missing* rows (`isPrunable`) have no row action; a section-level `Prune missing worktrees…` (`GIT_PRUNE_WORKTREES`, `git worktree prune --expire now`) cleans Git's stale records for the whole repository, deletes no branch or directory, refuses while a removal is in flight, and on SSH reconciles/blocks on pending removals first. Both run through the same scoped Git execution as listing. The section reports its open confirmation to `GitButton` (`onModalOpenChange`), because that dialog renders in a portal outside the menu and would otherwise count as an outside click that unmounts the menu before the action runs. Nothing there creates a worktree; that is only `New isolated agent`.
- **Creation attaches a context (Phase 2):** `gitCreateWorktree(path, base, branch, workspaceId, { attachCheckoutContext: true })` creates the worktree, then `worktreeContextAttachment.ts` confirms Git lists it as a linked worktree, registers it through `registerCheckoutContext()` (environment-validated, removal reservations honored) and returns `checkoutContext`. Path, branch and `mainCheckoutPath` come from Git/main, never the renderer. A workspace id alone only routes the call and attaches nothing: the New Workspace flows pass the id of an open repository workspace and then open the checkout as a separate workspace. If attaching fails the result is `{ success: false, created: true, worktree }`; the checkout and branch are kept, never auto-deleted, and a normal worktree refresh lists them.
- **No generic registration IPC.** The renderer cannot ask main to turn an arbitrary directory into a root; `registerCheckoutContext()` stays main-only. The one renderer-reachable route is explicit adoption: `adoptWorktreeCheckoutContext(workspaceId, worktreePath)` (`ADOPT_WORKTREE_CHECKOUT_CONTEXT`, `adoptListedWorktree` in `worktreeContextAttachment.ts`). Main lists `git worktree list` for the workspace's repository (scoped, local or SSH), requires the path to match a listed *linked* entry (not main, not the workspace's own root, not missing/prunable, not locked), registers Git's listed path through `registerCheckoutContext()` (environment-validated, reservations honored, idempotent) and derives branch/`mainCheckoutPath` from Git. The renderer sends only the workspace id and the path.
- **Renderer:** `upsertCheckoutContext(workspaceId, ctx)` records a returned context on its owning workspace (descriptive; idempotent; rejects other workspaces/environments, a second main context, relative paths, duplicate roots, or re-pointing an id). `launchTerminalInCheckoutContext(workspace, ctx, opts)` (`lib/checkoutContextLaunch.ts`) spawns into a specific context and adds the terminal to that same workspace.
- **Lifecycle:** a worktree context is never released implicitly (closing its last terminal does not). `releaseCheckoutContext(workspaceId, contextId)` (`RELEASE_CHECKOUT_CONTEXT`, `checkoutContextRelease.ts`) only unregisters a `worktree` context owned by that workspace; the main context, unknown ids and other workspaces' contexts are refused identically. Main refuses while any live Clanker terminal uses it, judged from main's terminal table: launched into the context, or its local `cwd` / SSH `remoteWorkingDir` inside the root (equivalent hosts count; an unverifiable directory blocks). It never kills terminals, removes the worktree, or deletes a branch, and the check-and-unregister is one synchronous step. Renderer `removeWorktreeCheckout(workspace, ctx)` (`lib/worktreeCheckoutRemoval.ts`) is the single helper for finishing a checkout: release, then `removeCheckoutContext` in the store only after main confirms, then the existing inspect and remove calls with all their protections (dirty/untracked/ignored, branch identity, open paths, SSH reservations/journaling/recovery). A failure after release leaves the checkout on disk with the context released; nothing re-registers it.
- **Launch races:** `SPAWN_TERMINAL` revalidates the resolved workspace and context (exact registered objects) after its async steps and before the PTY exists, for SSH and local alike; a launch that resolved neither stays unbound legacy behavior. `launchTerminalInCheckoutContext` re-reads the live store after the spawn resolves and kills the terminal if the workspace or context is gone or changed, or if the store did not record it, so a spawned PTY is never left untracked.
- **Assistants are main-checkout launches:** the main-only `spawnAssistant()` resolves the workspace's `main` context (never a requested/selected worktree), pins its filesystem identity, rechecks the exact workspace and context objects plus that identity synchronously before PTY creation, and returns the authoritative `checkoutContextId` in `AssistantLaunchResult`.
- **UI (deliberately small):** the harness pills still launch one-click into the current checkout. One `GitBranch` button beside them (`IsolatedAgentButton`) opens a compact two-pane popover: *Harness* (the toolbar's visible harnesses, with icons; no model settings) and *Working copy*: a New branch input, Existing branches (local branches with no worktree; main's current branch and any branch that already has a worktree are not repeated there), and Existing worktrees (`lib/isolatedAgentChoices.ts`; branch plus a state: Available / In use / Unmanaged / Missing / Locked; paths only in tooltips). Selecting only selects; a `Launch` button runs `launchIsolatedAgent` (`lib/isolatedAgentLaunch.ts`): re-check focus, then `new-branch` (base read from Git, `HEAD` when detached) or `existing-branch` (branch re-verified, no switch of the main checkout) call `gitCreateWorktree(..., { attachCheckoutContext: true })`, while `worktree` reuses an attached context as is (a second agent shares it; never duplicated) or has main adopt it; then `upsertCheckoutContext` and `launchTerminalInCheckoutContext`; nothing is rolled back on failure. Missing and locked worktrees are disabled there: repair (Unlock, Prune) and Remove live in the Git menu only. It is hidden for legacy linked-worktree workspaces and disabled for non-Git ones. Agent rows show their branch via `worktreeAgents.ts` (an isolated worktree is a worktree context other than the workspace's own root, so a legacy worktree workspace's root never counts). `WorkspaceCheckouts` lists worktree contexts no terminal references as quiet inactive rows with a confirmed `Remove…` that calls `removeWorktreeCheckout`; a context shared by several agents stays active until its last agent closes; failure messages stay visible after the row is gone. The collapsed rail only labels worktree agents.
- **Safeguards:** local open-path and remote activity checks for worktree removal include context roots, not only workspace roots/terminals.
- **`mainCheckoutPath` is descriptive only.** It records the repository relationship for display and must never authorize filesystem, Git, or terminal access; any root that is reachable must be its own environment-validated context.
- **Never** widen a workspace root (e.g. `/projects/app` to `/projects`) to make sibling worktrees reachable; register the worktree as its own context.
- **Transitional:** linked-worktree workspaces are still top-level workspaces. Their renderer-side context is annotated `kind: 'worktree'`; main still registers the root as `main` because it does not classify checkouts yet. Renderer `WorkspaceTab.checkoutContexts` and `Terminal.checkoutContextId` are backfilled in `sanitizeWorkspace`/`addTerminal` (`lib/checkoutContexts.ts`).

### Harness Accounts (optional)

Codex and Claude may have manually selected *managed accounts* (`provider.accounts`, see `docs/harness-integration.md` "Accounts capability"). The native/default account is synthetic and sets no environment variable. Account metadata lives in main's own store (never `harnessDefaults`); homes are derived in main under `<userData>/harness-accounts/`; the renderer only sends opaque IDs over `harness-accounts:*` IPC. Selection is `environment + harness` and affects future launches only; resume/fork use the account that owns the session (re-verified in main). No automatic routing or fallback. SSH environments report managed accounts as unavailable in v1.

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
npm run security-check # scripts/security-audit.cjs (npm audit, high threshold, one documented exception)
npm run validate   # branding check, lint, typecheck, security-check, build, test
```

CI (`.github/workflows/validate.yml`): `changes` → `ubuntu-validation` (dependency review on PRs, informational audit artifact, lint, typecheck, build, full tests with coverage) and `windows-compat` (`vitest --project main`, no coverage) → final `validate` aggregate, the stable required check. Windows does not repeat lint, typecheck, or build.

## File Size Thresholds

Files over ~800 lines need justification. Keep new behavior in focused modules where possible; `workspaceStore.ts` and `gitService.ts` are large, established integration points.

## Testing

Tests split by environment (node vs jsdom) in config:
- `tests/main/**/*.test.ts` → node
- `tests/renderer/**/*.test.tsx` → jsdom

Use `installElectronApiMock()` for renderer tests. Renderer integration tests live in `workspaceStore.test.ts` and `appWorkspaceOpen.real.test.tsx`.

## Key Constraints

- **Harness wrapper** — Local POSIX harnesses spawn via `~/.clanker-grid/harness-wrapper.sh` (generated by `harnessLaunch.ts`). Remote harnesses use SSH and return to a remote login shell on exit. Windows local harnesses use `resolveHarnessPtySpawn()` (direct `.exe`, escaped `cmd.exe /d /s /c` for shims).
- **Terminal continuity** — xterm instances cached in `TerminalPane.tsx` across workspace/tab switches.
- **Flow control disabled** — `handleFlowControl: false` on all PTY spawns to avoid startup stalls.
- **Harness flags** — Stored in `electron-store` under `harnessDefaults[harness].flags`, applied at spawn time.
- **Pane locking** — Removed from the product; do not add lock-state gating to layout or pane actions.
- **Shared types** — IPC channels in `ipcChannels.ts`, types in `src/shared/types/`, store schema in `store.ts`.
- **Main exports internal** — `terminals`, `browserViews`, `gitService`, `store` exported for tests only.
