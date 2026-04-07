# Testing Strategy

Date: 2026-04-07
Repository: `clanker-grid`

## Current State

The repository currently has only a minimal test setup:

- `package.json` runs tests through `npm run build:main && node --test dist/main/*.test.js`
- Existing tests live only in `src/main/*.test.ts`
- Renderer code has no automated test coverage
- There is no shared test setup, fixture layer, or coverage policy
- The current test command depends on a TypeScript build step before execution

Current covered areas:

- `src/main/security.ts`
- `src/main/aiCommit.ts`
- `src/main/harnessLaunch.ts`

Current uncovered high-risk areas:

- `src/main/gitService.ts`
- `src/main/main.ts`
- `src/renderer/store/workspaceStore.ts`
- `src/renderer/store/workspaceLayout.ts`
- `src/renderer/components/*`

## Problems With The Current Setup

The current setup is enough to keep a few pure helpers honest, but it does not scale well.

- Tests are tied to compiled output instead of running directly from source
- Coverage is limited to a few small main-process utility modules
- There is no renderer test runner, DOM test environment, or component harness
- There is no agreed test taxonomy such as unit, integration, and end-to-end
- There are no shared mocks for Electron APIs, PTY processes, git execution, or browser state
- There is no coverage threshold to keep the test surface expanding over time

## Goal

Centralize test tooling, setup, fixtures, and reporting so new tests can be added consistently across main, renderer, and end-to-end layers.

Centralization here should mean:

- one primary unit/integration runner
- one predictable root test directory
- one shared setup location for mocks and fixtures
- one coverage command and reporting policy
- one documented test pyramid

## Recommended Target Setup

### 1. Standardize unit and integration tests on Vitest

Vitest is the best fit for this repository because the project already uses Vite, React, and TypeScript.

Use it for:

- main-process unit tests for pure modules and service logic
- renderer unit tests
- renderer integration tests with DOM rendering
- fast store and layout tests

This replaces the current `build then node --test dist/main/*.test.js` workflow for day-to-day testing.

### 2. Add a dedicated browser/E2E layer later

Use Playwright for:

- workspace creation flows
- pane layout behavior
- browser panel workflows
- git menu flows

This should be a separate layer from unit/integration testing so the repo keeps a fast local feedback loop.

### 3. Centralize tests under a root `tests/` tree

Recommended structure:

```text
tests/
  setup/
    vitest.setup.ts
    electron.ts
    renderer.ts
    fixtures.ts
  main/
    unit/
    integration/
  renderer/
    unit/
    integration/
  e2e/
    playwright.config.ts
```

Guidance:

- Put all new tests under `tests/`
- Migrate `src/main/*.test.ts` into `tests/main/unit/`
- Keep production code free of scattered test helpers
- Store shared mocks and factories only in `tests/setup/`

## Tooling Plan

### Phase 1: Foundations

Add:

- `vitest`
- `@vitest/coverage-v8`
- `jsdom`
- `@testing-library/react`
- `@testing-library/user-event`
- `@testing-library/jest-dom`

Create:

- `vitest.config.ts`
- `tests/setup/vitest.setup.ts`
- `tests/setup/electron.ts`
- `tests/setup/fixtures.ts`

Update `package.json` scripts to something close to:

- `test`: run unit and integration suites
- `test:watch`: watch mode for local development
- `test:coverage`: coverage report
- `test:e2e`: Playwright suite

### Phase 2: Migrate existing tests

Move the three current test files into `tests/main/unit/` and run them directly from source through Vitest.

This removes:

- the compile-before-test requirement
- the `dist/main/*.test.js` dependency
- the split between source layout and test execution layout

### Phase 3: Add shared mocks

Build reusable test doubles for:

- Electron bridge methods exposed through preload
- `child_process.execFile` for git-related service tests
- PTY terminal creation and lifecycle
- browser panel and window lifecycle callbacks
- persisted settings reads and writes

The rule should be: mock platform boundaries once, reuse them everywhere.

### Phase 4: Add renderer coverage

Start with the lowest-friction, highest-value renderer targets:

1. `src/renderer/store/workspaceLayout.ts`
2. `src/renderer/store/workspaceStore.ts`
3. `src/renderer/lib/workspaceLifecycle.ts`
4. `src/renderer/lib/harnessOptions.ts`
5. `src/renderer/components/WorkspaceGateContent.tsx`
6. `src/renderer/components/Header.tsx`

Why these first:

- they contain a large amount of behavior
- they are cheaper to test than full Electron flows
- they create the base fixtures needed for more UI coverage later

### Phase 5: Add main-process service coverage

Priority order:

1. `src/main/gitService.ts`
2. `src/main/harnessCatalog.ts`
3. `src/main/security.ts`
4. `src/main/aiCommit.ts`
5. targeted seams extracted from `src/main/main.ts`

Important note:

`src/main/main.ts` is still too concentrated for broad direct testing. Instead of testing that file as-is, keep extracting pure helpers and service registration seams from it, then test those seams.

### Phase 6: Add E2E smoke coverage

Start with a very small but reliable E2E suite:

1. launch app
2. create workspace
3. create terminal pane
4. toggle browser
5. open git menu

Keep the first E2E pass intentionally small. The purpose is confidence in critical wiring, not full behavioral coverage.

## Coverage Policy

Do not set an aggressive repo-wide threshold immediately. That encourages low-value tests.

Recommended approach:

- start with reporting enabled and threshold warnings only
- set a modest baseline after the first migration pass
- raise thresholds by area, not only globally

Suggested first thresholds after migration:

- main unit/integration: 70% for statements on covered modules
- renderer store/layout modules: 70%
- overall repo threshold: introduce only after renderer coverage exists

## Test Pyramid For This Repo

Use this shape:

- many unit tests around pure helpers, layout logic, parsing, and state transitions
- fewer integration tests around renderer components and store interactions
- very few E2E tests for cross-process app wiring

This repo should not try to solve low coverage mainly with E2E. The largest gains will come from store, layout, and service tests.

## Immediate Next Steps

1. Install Vitest and renderer test dependencies
2. Add `vitest.config.ts` and `tests/setup/`
3. Migrate the three current main tests into `tests/main/unit/`
4. Add first new suites for `workspaceLayout` and `workspaceStore`
5. Add coverage reporting to CI or local validation

## Proposed Definition Of Done For The First Testing Milestone

The first milestone should be considered complete when:

- all current tests run from source through Vitest
- all new tests live under `tests/`
- renderer tests are supported through a shared setup file
- coverage reports are generated from a single command
- `workspaceLayout` and `workspaceStore` both have initial coverage
- the repo documents where new tests belong and which layer to use
