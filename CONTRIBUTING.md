# Contributing to Clanker Grid

## Development Setup

```bash
# Clone and install
git clone <repo-url>
cd <repo-directory>
npm install

# Run in development mode
npm run dev

# Run tests (always use npm run test, not bare npm test)
npm run test

# Type checking
npm run typecheck

# Validation pipeline (run before submitting PR)
npm run validate
```

### Platform support

Clanker Grid's primary development and required CI platform is **Linux (x64)**. **Windows 10 1809+ / Windows 11 (x64)** remains **best-effort supported, not CI-gated**. Preserve Windows platform abstractions, packaging and useful regression tests, review new filesystem/process/path code for Windows assumptions, and fix reproducible Windows bugs when practical. Windows artifacts may lag Linux releases; native Windows runner availability or test status does not automatically block PRs or releases.

The `ubuntu-validation` job runs dependency review (PRs only), an informational `npm audit` report (uploaded as an artifact), lint, typecheck, the Fallow dead-code regression check, build, and the full Vitest suite with coverage. This includes deterministic Windows compatibility tests using `path.win32`, mocked platforms and injected subprocess/path seams, plus the jsdom renderer suite. There is no automatic per-PR Windows runner. The final `validate` job is the stable check to require in branch protection: code changes require Ubuntu success; docs-only changes require the heavy job to be skipped. A failed/cancelled Ubuntu job or invalid change-detection result fails the gate. CI does not run `npm run branding:check` or the `security-check` policy gate, so run `npm run validate` locally, where high/critical audit findings fail the run apart from the documented exception in [RELEASING.md](RELEASING.md#security-gate).

When adding code that touches the filesystem, terminals, harness launch, credentials, or paths, follow the platform patterns in [AGENTS.md](AGENTS.md#windows-support) and [docs/windows.md](docs/windows.md). Key rules:

- All paths crossing IPC use POSIX separators (`src/shared/pathNormalize.ts`).
- Default shell selection lives in `src/main/platformShell.ts` — never branch on `process.platform` ad hoc.
- Harness commands spawn through `resolveHarnessPtySpawn()` for PTYs and the shared bounded spawn planner for command execution, so `.cmd` shims resolve safely on Windows.
- Filesystem-mutating tests must use `os.tmpdir()` / `os.homedir()` via `tests/_helpers/tempPaths.ts` — no hardcoded `/home`, `/tmp`, or `/Users`.
- Remote runtime operations must resolve `workspaceId` through `WorkspaceRegistry`; treat `environmentId` plus canonical path as the persistent identity. Keep remote pre-workspace browsing separate from root-confined workspace file operations.

### Windows development

- **Install Git for Windows.** Husky pre-commit hooks (`.husky/pre-commit`) execute through the `sh` bundled with Git for Windows. Without it, hooks silently skip and lint/typecheck are not enforced locally.
- **Recommended:** `git config --global core.autocrlf input` so working trees stay LF on disk while Windows tooling sees what it expects.
- **Native modules:** `node-pty` is rebuilt against the Electron ABI on `npm install` via `electron-builder` / `@electron/rebuild`. If `npm run dev` errors with a node-pty load failure, run `npx electron-rebuild -f -w node-pty` and retry.
- **Polling watchers:** to test the UNC polling fallback locally (or to debug watcher issues on any path), set `CLANKER_GRID_WATCHER_POLLING=1` before launching.

## Code Standards

- TypeScript strict mode enabled
- ESLint rules enforced
- Prefer functional components with hooks
- Use Zustand for renderer state management
- Main/renderer communication via preload bridge only
- IPC channel names from `src/shared/ipcChannels.ts` — never hard-code strings
- Path validation before file system access
- Duplicate logic is a code smell — check existing modules before adding local logic

For appearance changes, follow the [theming architecture guide](docs/theming.md), including the semantic token contract and state-preserving subsystem adapters. Use the [documentation index](docs/README.md) for current developer references and smoke tests; [Fallow maintenance checks](docs/fallow.md) explains baseline review and narrow analyzer exceptions.

Keep user-facing changes in `CHANGELOG.md` under **Unreleased** until a release is prepared. Update the corresponding user guide, distinguish deferred designs from available features, and avoid adding completed issue reports, transient test counts or implementation inventories to the current docs. Git history and PRs retain that historical material.

## Project Structure

```
src/
├── main/                    # Electron main process
│   ├── main.ts             # Entry point, window lifecycle
│   ├── preload.ts          # Context bridge (window.electronAPI)
│   ├── gitService.ts       # Git CLI wrapper
│   ├── harnessLaunch.ts    # Harness spawn argument construction
│   ├── sessionHistory.ts   # Chat history discovery
│   ├── harnessCatalog.ts   # Harness availability detection
│   ├── fileService.ts     # File read/write operations
│   ├── fileWatcher.ts     # File system watching
│   ├── ipc/               # IPC handler registrations by domain
│   │   ├── terminalIpc.ts # PTY spawn, write, resize, clipboard
│   │   ├── gitIpc.ts       # Git operations, remotes
│   │   ├── browserIpc.ts   # WebContentsView navigation
│   │   └── ...
│   ├── annotation/          # Browser annotation feature
│   ├── credential/         # SSH key and PAT management
│   └── vcs/                # VCS provider abstraction
│       └── providers/      # GitHub, GitLab, Bitbucket
├── renderer/                # React frontend
│   ├── components/        # UI components
│   │   ├── git/            # Modular git components
│   │   ├── FileExplorer/   # File tree explorer
│   │   └── *.tsx
│   ├── store/              # Zustand stores
│   │   └── workspaceStore.ts # Main state
│   └── lib/                # Utilities
├── shared/                  # Cross-boundary types
│   ├── ipcChannels.ts      # IPC channel constants
│   └── types/              # Shared data types
└── dist/                    # Build output (generated)
```

## Testing

```bash
npm run test          # Run all tests (Vitest)
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
npm run diagnose:gpu  # Check hardware acceleration and sandboxed WebGL support
```

For documentation screenshots and short feature clips, run `npm run capture:features`
on Linux (clips require `ffmpeg`). The [capture guide](scripts/screenshots/README.md)
explains the disposable demo repositories, privacy boundaries and offline asset gallery.
This does not modify or deploy the website.

The GPU diagnostic launches the installed Electron runtime with an isolated temporary profile. Run it on a desktop session when investigating browser rendering; it is intentionally not part of headless CI.

For a live SSH workspace check, use the guarded [remote VPS smoke procedure](docs/remote-vps-smoke-test.md). Create a unique temporary directory for any destructive test and leave the persistent fixture intact.

**Important:** Always use `npm run test`, not bare `npm test`. `npm run validate` runs branding check → lint → typecheck → Fallow dead-code regression check → security check → build → test. CI runs the full suite with coverage on Ubuntu, including Windows simulation tests; see [Platform support](#platform-support).

Test directories:
- `tests/main/unit/` — Main process unit tests
- `tests/renderer/unit/` — Renderer component tests
- `tests/renderer/integration/` — Renderer store integration tests
- `tests/main/integration/` — Main process integration tests

Tests are split by environment:
- `tests/main/**/*.test.ts` → Node.js environment
- `tests/renderer/**/*.test.tsx` → jsdom environment

## Pull Request Checklist

- [ ] `npm run validate` passes locally
- [ ] The CI `validate` check is green (canonical Ubuntu validation; docs-only changes skip the heavy job)
- [ ] Tests added/updated for new features
- [ ] No TypeScript errors
- [ ] No ESLint warnings
- [ ] Commit messages follow conventional format
- [ ] CHANGELOG entry added under `## [Unreleased]` if user-visible behavior changed

## Commit Format

```
<type>(<scope>): <description>

Types: feat, fix, docs, refactor, test, chore
Scopes: terminal, git, browser, editor, explorer, vcs, credential, annotation, session, harness, ui
```

## Validation Pipeline

Before submitting, run:

```bash
npm run validate
```

This executes: branding check → lint → typecheck → Fallow dead-code regression check → security check (`node scripts/security-audit.cjs`: `npm audit` at the high threshold, plus one documented dev-only exception) → build → test.
