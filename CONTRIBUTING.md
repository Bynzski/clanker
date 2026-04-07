# Contributing to Clanker Grid

## Development Setup

```bash
# Clone and install
git clone https://github.com/clanker-grid/clanker-grid.git
cd clanker-grid
npm install

# Run in development mode
npm run dev

# Run tests
npm test

# Type checking
npm run typecheck
```

## Code Standards

- TypeScript strict mode enabled
- ESLint rules enforced
- Prefer functional components with hooks
- Use Zustand for renderer state management
- Main/renderer communication via preload bridge only

## Project Structure

```
src/
├── main/                    # Electron main process
│   ├── main.ts             # Entry point
│   ├── preload.ts          # Context bridge
│   ├── gitService.ts       # Git operations
│   ├── harnessLaunch.ts    # AI harness spawning
│   └── security.ts         # Security constraints
├── renderer/                # React frontend
│   ├── components/         # UI components
│   │   ├── git/            # Git UI components
│   │   └── *.tsx
│   ├── store/              # Zustand stores
│   └── lib/                # Utilities
└── dist/                    # Build output
```

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

Test directories:
- `tests/main/unit/` — Main process unit tests
- `tests/renderer/` — Renderer tests

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
```

## Validation Pipeline

Before submitting, run:

```bash
npm run validate
```

This executes: lint → typecheck → build → test
