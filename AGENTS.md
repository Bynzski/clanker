# AGENTS.md

## Task Completion Requirements

- All `npm run lint`, `npm run typecheck`, and `npm run build` must pass before considering tasks completed.
- NEVER run bare `npm test`. Always use `npm run test` (runs Vitest).
- Run `npm run validate` as the final check — it runs lint → typecheck → build → test.

## Project Snapshot

Clanker Grid is a desktop developer workspace combining:
- Multi-pane terminal grid with PTY-backed shells
- AI harness launcher (Codex, Claude, OpenCode, Pi)
- Integrated native browser panel
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
├── main/                      # Electron main process
│   ├── main.ts               # Entry point, window lifecycle
│   ├── preload.ts            # Context bridge (IPC only)
│   ├── gitService.ts         # Git CLI wrapper
│   ├── harnessLaunch.ts      # AI harness process spawning
│   ├── harnessCatalog.ts     # Harness availability detection
│   ├── aiCommit.ts           # AI commit message generation
│   └── security.ts           # URL/path validation
│
├── renderer/                  # React frontend
│   ├── App.tsx              # Root component
│   ├── main.tsx             # React entry
│   ├── components/          # UI components
│   │   ├── git/             # Git UI (branches, stash, merge, history)
│   │   ├── TerminalPane.tsx # xterm.js integration
│   │   ├── DynamicPaneLayout.tsx  # Resizable pane tree
│   │   ├── WorkspaceGate.tsx     # First-launch directory picker
│   │   └── *.tsx            # Other components
│   ├── store/               # Zustand state
│   │   ├── workspaceStore.ts     # Workspace/terminal state
│   │   ├── workspaceLayout.ts    # Pane tree operations
│   │   └── workspaceTypes.ts     # Type definitions
│   └── lib/                 # Utilities
│       ├── harnessOptions.ts     # Harness UI helpers
│       └── workspaceLifecycle.ts # Workspace creation logic
│
└── dist/                     # Build output (generated)
    ├── main/                 # Compiled main process
    └── renderer/             # Vite production bundle
```

## Key Implementation Details

### IPC Communication

Main ↔ Renderer communication via preload bridge (`src/main/preload.ts`):

| Module | Channels |
|--------|----------|
| Terminal | `terminal:spawn`, `terminal:write`, `terminal:resize`, `terminal:kill`, `terminal:data`, `terminal:exit` |
| Git | `git:status`, `git:commit`, `git:stage`, `git:branch`, `git:stash`, `git:merge`, `git:history` |
| Browser | `browser:navigate`, `browser:back`, `browser:forward` |
| Harness | `harness:list`, `harness:models` |

### Terminal Architecture

- PTY processes spawn in `src/main/main.ts` via `node-pty`
- Output streams to renderer via IPC
- Renderer renders with `@xterm/xterm`
- Terminal pane sizing syncs back to PTY on resize

### Browser Architecture

- Native `WebContentsView` managed in main process
- Renderer only controls toolbar state and bounds
- Security: only `http:`/`https:` URLs allowed
- New windows denied, redirected to system browser

### Git Integration

- All git operations via `src/main/gitService.ts`
- Uses Node.js `child_process.spawn` with argument-safe arrays
- Polling for status changes
- AI commit message generation in `src/main/aiCommit.ts`

### State Management

- **Zustand store** (`src/renderer/store/workspaceStore.ts`) owns:
  - Active workspace
  - All workspaces collection
  - Pane layouts
  - Terminal list
  - Browser state
- **electron-store** persists:
  - Last workspace path
  - Settings (fastfetch, AI commit config)

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

## Testing

| Location | Purpose |
|----------|---------|
| `tests/main/unit/` | Main process unit tests |
| `tests/renderer/` | Renderer component/integration tests |
| `tests/setup/` | Shared mocks and fixtures |

## Reference Repositories

- [node-pty](https://github.com/microsoft/node-pty) — PTY management for Node.js
- [@xterm/xterm](https://github.com/xtermjs/xterm.js) — Terminal emulator for browsers
- [electron-store](https://github.com/sindresorhus/electron-store) — Settings persistence

## Important Notes

- **Harnesses are optional** — The app works with plain shell terminals. AI harnesses enhance but aren't required.
- **No renderer tests for UI flows** — Current test coverage is unit-level. Integration tests for workspace/pane/git UI are TODO.
- **Browser state is polled** — Renderer browser navigation state uses polling rather than event-driven updates.
- **Pane locking** — Users can lock panes to prevent reflow during insertions. Respect lock state in layout operations.
