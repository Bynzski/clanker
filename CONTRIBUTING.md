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

Clanker Grid is developed and validated on **Linux (x64)** and **Windows 10 1809+ / Windows 11 (x64)**. CI runs the full validation pipeline on both `ubuntu-latest` and `windows-latest`; PRs must pass on both.

When adding code that touches the filesystem, terminals, harness launch, credentials, or paths, follow the platform patterns in [AGENTS.md](AGENTS.md#windows-support) and [docs/windows.md](docs/windows.md). Key rules:

- All paths crossing IPC use POSIX separators (`src/shared/pathNormalize.ts`).
- Default shell selection lives in `src/main/platformShell.ts` — never branch on `process.platform` ad hoc.
- Harness commands spawn through `resolveHarnessSpawn()` so `.cmd` shims resolve on Windows.
- Filesystem-mutating tests must use `os.tmpdir()` / `os.homedir()` via `tests/_helpers/tempPaths.ts` — no hardcoded `/home`, `/tmp`, or `/Users`.

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

## Project Structure

```
src/
├── main/                    # Electron main process
│   ├── main.ts             # Entry point, window lifecycle
│   ├── preload.ts          # Context bridge (window.electronAPI)
│   ├── gitService.ts       # Git CLI wrapper (1484 lines)
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
│   │   └── workspaceStore.ts # Main state (1688 lines)
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

The GPU diagnostic launches the installed Electron runtime with an isolated temporary profile. Run it on a desktop session when investigating browser rendering; it is intentionally not part of headless CI.

**Important:** Always use `npm run test`, not bare `npm test`. The validation pipeline uses `npm run validate` which runs lint → typecheck → build → test.

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
- [ ] CI is green on both `ubuntu-latest` and `windows-latest`
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

This executes: lint → typecheck → build → test
