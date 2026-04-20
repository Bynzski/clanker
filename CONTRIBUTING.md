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
```

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

- [ ] `npm run validate` passes
- [ ] Tests added/updated for new features
- [ ] No TypeScript errors
- [ ] No ESLint warnings
- [ ] Commit messages follow conventional format

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
