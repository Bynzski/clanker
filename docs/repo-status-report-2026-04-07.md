# Repository Status Report

Date: 2026-04-07
Repository: `clanker-grid`
Scope: static repository audit, dead-code review, maintainability hotspot review, and execution of the locally available validation gates

## Phase 1 Stabilization Update

Phase 1 stabilization has been completed since the initial audit. The work in this phase focused on restoring trustworthy gates, removing low-risk dead paths, and fixing a small but real behavior bug in the commit flow.

Current post-stabilization status:

- `npm run typecheck`: passed
- `npm run build`: passed
- `npm run test`: passed
- `npm run validate`: passed
- `npm run build:dist`: passed when allowed outbound network access for Electron/AppImage downloads

Phase 1 changes completed:

- Added first-class validation scripts in `package.json`:
  - `typecheck`
  - `test`
  - `validate`
- Fixed Linux packaging config by removing the invalid `png` target from `package.json`
- Fixed all renderer/main TypeScript errors that were blocking `tsc -p tsconfig.json`
- Removed clearly dead preload/API surface that had no renderer call sites:
  - `setLastWorkspace`
  - `browserShow`
  - `getBrowserUrl`
  - `gitGetStatus`
  - `gitIsRepo`
- Removed matching dead main-process IPC handlers
- Removed the abandoned iframe browser implementation:
  - `src/renderer/components/BrowserPane.tsx`
  - `src/renderer/components/BrowserPane.css`
- Removed obsolete unused layout helpers from `workspaceStore.ts`
- Removed dead local declarations and stale interfaces flagged by TypeScript
- Fixed the commit dialog so “Stage All & Commit” now actually stages before commit instead of flowing through the plain commit path

What phase 1 did not attempt:

- Large structural refactors of `main.ts`, `workspaceStore.ts`, or `GitButton.tsx`
- Dependency pruning such as removing `react-grid-layout`
- Documentation reconciliation for `SPEC.md`

Residual warnings after stabilization:

- Renderer bundle is still large:
  - `dist/renderer/assets/index-CLQXe2XS.js` = 684.65 kB minified
- `electron-builder` still emits non-blocking warnings:
  - suggestion to move `electron-builder install-app-deps` into `postinstall`
  - duplicate dependency reference warnings during packaging

Phase 1 outcome:

- The repository has moved from “builds but is not trustworthily green” to “core validation is now reliable and passing.”
- The biggest remaining problems are maintainability and code concentration, not broken gates.

## Phase 2 Structural Cleanup Update

Phase 2 focused on reducing drift and duplication in the renderer without disturbing the green validation state established in phase 1.

Current phase 2 status:

- `npm run validate`: passed after the structural cleanup

Phase 2 changes completed:

- Introduced shared renderer contract types in:
  - `src/renderer/types/shared.ts`
- Updated renderer bridge typing in:
  - `src/renderer/electron.d.ts`
  - so shared types are no longer duplicated across multiple components
- Introduced shared harness metadata and availability resolution in:
  - `src/renderer/lib/harnessOptions.ts`
- Updated both major harness-selection surfaces to use the shared source:
  - `src/renderer/components/Header.tsx`
  - `src/renderer/components/WorkspaceGateContent.tsx`
- Introduced shared workspace terminal shutdown logic in:
  - `src/renderer/lib/workspaceLifecycle.ts`
- Reused that lifecycle helper in:
  - `src/renderer/components/Header.tsx`
  - `src/renderer/components/WorkspaceTabs.tsx`

Why this matters:

- Harness metadata no longer drifts between two separate renderer components.
- AI/model-related renderer types no longer need to be redeclared in multiple places.
- Workspace close behavior is now implemented in one place instead of duplicated UI logic.

What phase 2 still did not do:

- Refactor `src/main/main.ts` into separate services
- Collapse the duplicated active-workspace state model in `src/renderer/store/workspaceStore.ts`
- Split `src/renderer/components/GitButton.tsx` into smaller units

Phase 2 outcome:

- The codebase is structurally cleaner than after phase 1, but the main architectural hotspots remain.
- The next highest-value work is still the large-file breakup of `main.ts`, `workspaceStore.ts`, and `GitButton.tsx`.

## Executive Summary

This repository is now in a materially better state than it was at the start of the audit. Phase 1 stabilization restored working validation gates and removed several confirmed dead paths, but the codebase still has concentrated maintainability risk in a few oversized modules.

The most important conclusions:

- The repo did have several confirmed dead code paths and stale interfaces; the clearest phase 1 cases have now been removed.
- The renderer previously lacked a trustworthy TypeScript gate in the normal workflow; that gap is now closed with explicit `typecheck` and `validate` scripts.
- Packaging was previously broken by configuration; that issue is fixed, and packaging now succeeds when network access is available for Electron downloads.
- Renderer contract drift has been reduced by centralizing shared types, harness metadata, and workspace shutdown behavior.
- A small number of files carry a disproportionate amount of responsibility:
  - `src/main/main.ts` at 1888 LOC
  - `src/renderer/store/workspaceStore.ts` at 1389 LOC
  - `src/renderer/components/GitButton.tsx` at 968 LOC
  - `src/renderer/components/GitButton.css` at 836 LOC
  - `src/renderer/components/WorkspaceGateContent.tsx` at 569 LOC
- The codebase shows drift between implementation, types, documentation, and packaging setup. That usually means future changes will cost more than they should.

Bottom line: phase 1 stabilization succeeded. The repo is no longer failing on basic correctness gates, but it is still paying coordination tax from monolithic files, duplicated configuration, and documentation drift.

## Audit Method

I reviewed repository structure, build/test scripts, TypeScript configs, the main Electron process, preload bridge, store, and major renderer components. I also ran the available local gates.

Commands executed:

- `npm run build`
- `npm run build:dist`
- `./node_modules/.bin/tsc -p tsconfig.json`
- `node --test dist/main/*.test.js`

Additional inspection included file-size review, cross-reference searches, and line-level inspection of the largest files.

## Repository Shape

High-level shape:

- Single package repo
- Electron main process in `src/main`
- React renderer in `src/renderer`
- Existing docs in `docs/`
- No explicit CI-style script for linting, typechecking, or tests in `package.json`

Relevant script state from `package.json`:

- Current scripts now include:
  - `build`
  - `typecheck`
  - `test`
  - `validate`
  - `build:dist`
- There is still no `lint` script
- Packaging now works, but still depends on network access when Electron/AppImage assets must be downloaded

This matters because phase 1 fixed the most important gap, but the project still lacks a lint gate and still has maintainability issues that validation alone will not solve.

## Validation Gates

### Gate Summary

- Initial audit state:
  - `npm run build`: passed
  - `node --test dist/main/*.test.js`: passed
  - `./node_modules/.bin/tsc -p tsconfig.json`: failed
  - `npm run build:dist`: failed
- Post phase 1 state:
  - `npm run typecheck`: passed
  - `npm run build`: passed
  - `npm run test`: passed
  - `npm run validate`: passed
  - `npm run build:dist`: passed with network access enabled for packaging downloads

### 1. Build Gate

Command:

```bash
npm run build
```

Result:

- Passed
- Renderer built successfully
- Main process compiled successfully

Notable warning:

- Vite reported a large output chunk:
  - the main renderer JS bundle is still about 685 kB minified and about 190 kB gzip

Implication:

- The project can bundle, but renderer size is already large for a small app.
- This is not a release blocker by itself, but it is a strong signal that the renderer is accumulating too much code into one chunk.

### 2. Renderer Typecheck Gate

Command:

```bash
./node_modules/.bin/tsc -p tsconfig.json
```

Result:

- Failed with 21 errors

Important failures:

- Dead or unused declarations:
  - `src/main/main.ts:200` `parseModelOutput`
  - `src/renderer/App.tsx:14` `browserVisible`
  - `src/renderer/components/CommitDialog.tsx:124` `handleStageAndCommit`
  - `src/renderer/components/GitButton.tsx:56` `BranchState`
  - `src/renderer/store/workspaceStore.ts:230` `normalizePaneEntry`
  - `src/renderer/store/workspaceStore.ts:261` `compactWorkspaceLayout`
  - `src/renderer/store/workspaceStore.ts:297` `findPanePositionById`
  - `src/renderer/store/workspaceStore.ts:301` `getOccupiedPositions`
  - `src/renderer/store/workspaceStore.ts:444` `countLeaves`

- Missing or broken shared types:
  - `src/renderer/components/CommitDialog.tsx:29` cannot find `AiCommitSettings`
  - `src/renderer/components/Header.tsx:42` cannot find `ModelOption`

- Inference breakdowns and implicit `any`:
  - `src/renderer/components/CommitDialog.tsx:30`
  - `src/renderer/components/CommitDialog.tsx:31`
  - `src/renderer/components/Header.tsx:203`
  - `src/renderer/components/WorkspaceGate.tsx:14`
  - `src/renderer/components/WorkspaceGate.tsx:15`
  - `src/renderer/components/WorkspaceTabs.tsx:26`
  - `src/renderer/components/WorkspaceTabs.tsx:71`
  - `src/renderer/store/workspaceStore.ts:783`
  - `src/renderer/store/workspaceStore.ts:1385`
  - `src/renderer/store/workspaceStore.ts:1386`

Implication:

- The current build path is hiding renderer correctness problems.
- Any claim that the repo is “green” is incomplete until renderer typechecking is promoted to a first-class gate.

### 3. Tests

Command:

```bash
node --test dist/main/*.test.js
```

Result:

- Passed
- 2 test files
- 2 passing tests
- 0 failures

Coverage reality:

- Only helper-level main-process tests are present
- There is no renderer test coverage
- There are no integration tests covering IPC, terminal lifecycle, browser lifecycle, or workspace state transitions

Implication:

- Existing tests are useful but narrow.
- They do not protect the parts of the app where most complexity currently lives.

### 4. Packaging

Command:

```bash
npm run build:dist
```

Result:

- Failed deterministically

Failure:

- `electron-builder` reports `Unknown target: png`

Evidence:

- `package.json:63-69` defines Linux targets as `["AppImage", "png"]`

Implication:

- Release packaging is not operational.
- This is a real delivery failure, not a warning.

Priority:

- High. Packaging should be considered broken until fixed.

## Confirmed Dead Code and Stale Paths

The following items are not speculative. They are either unreferenced by the codebase, flagged directly by TypeScript, or both.

### 1. Unused model parser in main process

File:

- `src/main/main.ts:200`

Finding:

- `parseModelOutput` is defined but not used.

Phase 1 status:

- Resolved. The unused parser was removed.

Why it matters:

- It suggests an abandoned or partially replaced model discovery path.
- Dead parsers create maintenance confusion because readers cannot tell which parser is authoritative.

Recommendation:

- Remove it or wire it into the intended discovery path.
- If it exists as an experiment, move that history into docs or tests instead of production code.

### 2. Test-only shell command helpers in production module

File:

- `src/main/harnessLaunch.ts:26`
- `src/main/harnessLaunch.ts:42`

Finding:

- `quoteShellArg` and `buildHarnessCommand` are only referenced by `src/main/modelLaunch.test.ts`.
- They are not used by production runtime paths.

Phase 1 status:

- Not addressed in phase 1. This remains a cleanup candidate rather than a gate issue.

Why it matters:

- Production modules are carrying helpers whose only purpose is test verification.
- That blurs the boundary between runtime API surface and test support.

Recommendation:

- Either remove them and rewrite the test against the runtime helper actually used in production (`buildHarnessSpawnArgs`), or move them into a test utility module.

### 3. Entire unused browser component path

Files:

- `src/renderer/components/BrowserPane.tsx:1`
- `src/renderer/components/BrowserPane.css`

Finding:

- `BrowserPane.tsx` is not referenced by the live renderer tree.
- The active browser implementation is `BrowserPanel.tsx`, used from `src/renderer/components/DynamicPaneLayout.tsx:143`.
- `BrowserPane.tsx` still contains an older iframe-based browser implementation.

Phase 1 status:

- Resolved. `BrowserPane.tsx` and `BrowserPane.css` were removed.

Why it matters:

- This is the cleanest example of dead UI code in the repo.
- It creates confusion because the repository now has two browser-pane implementations with different technical models.

Recommendation:

- Remove `BrowserPane.tsx` and `BrowserPane.css` unless there is a concrete plan to revive them.
- If it is being kept as historical reference, move it out of active source paths.

### 4. Unused preload and IPC bridge methods

Files:

- `src/main/preload.ts:6`
- `src/main/preload.ts:38`
- `src/main/preload.ts:49`
- `src/main/preload.ts:71`
- `src/main/preload.ts:96`
- `src/main/main.ts:1456`
- `src/main/main.ts:1637`
- `src/main/main.ts:1718`
- `src/main/main.ts:1742`
- `src/main/main.ts:1865`

Finding:

- The following renderer bridge methods have no call sites in `src/`:
  - `setLastWorkspace`
  - `browserShow`
  - `getBrowserUrl`
  - `gitGetStatus`
  - `gitIsRepo`

Phase 1 status:

- Resolved. These preload methods and matching IPC handlers were removed.

Why it matters:

- Dead IPC surface is worse than dead local helpers because it expands the contract between renderer and main process.
- It increases maintenance overhead and raises the chance of drift between declaration, preload bridge, and main handlers.

Recommendation:

- Remove unused IPC methods and matching main-process handlers.
- If some are reserved for planned features, document that explicitly and do not expose them until needed.

### 5. Store helpers that no longer participate in the live layout model

Files:

- `src/renderer/store/workspaceStore.ts:131`
- `src/renderer/store/workspaceStore.ts:230`
- `src/renderer/store/workspaceStore.ts:261`
- `src/renderer/store/workspaceStore.ts:297`
- `src/renderer/store/workspaceStore.ts:301`
- `src/renderer/store/workspaceStore.ts:444`

Finding:

- These helpers are flagged as unused by TypeScript:
  - `autoCalculateLayout`
  - `normalizePaneEntry`
  - `compactWorkspaceLayout`
  - `findPanePositionById`
  - `getOccupiedPositions`
  - `countLeaves`

Phase 1 status:

- Resolved for the helpers above. They were removed as part of the store cleanup required to get typecheck green.

Why it matters:

- This looks like residue from an older pane-layout strategy.
- The file mixes current tree-layout logic with unused grid-layout-era helpers.

Recommendation:

- Remove the helpers that are truly obsolete.
- If some are intended for a future reintroduction, move them into a dedicated layout utility module with tests and clear ownership.

### 6. Dead local declarations in renderer components

Files:

- `src/renderer/App.tsx:14`
- `src/renderer/components/CommitDialog.tsx:124`
- `src/renderer/components/GitButton.tsx:56`

Finding:

- `browserVisible` is destructured but unused in `App.tsx`
- `handleStageAndCommit` is declared but unused in `CommitDialog.tsx`
- `BranchState` is declared but unused in `GitButton.tsx`

Phase 1 status:

- Resolved. These dead locals/interfaces were removed, and the commit dialog path was corrected so staged commit behavior matches the UI.

Why it matters:

- These are small issues individually, but together they show low signal-to-noise in critical files.

Recommendation:

- Remove them as part of the first cleanup pass.

### 7. Unused dependency likely left over from previous layout implementation

Files:

- `package.json:29`
- `package.json:38`
- `src/renderer/store/workspaceStore.ts:128`
- `src/renderer/components/DynamicPaneLayout.tsx:2`

Finding:

- `react-grid-layout` and `@types/react-grid-layout` are present in dependencies/devDependencies.
- The only source reference is a comment in `workspaceStore.ts`.
- The live renderer uses `react-resizable-panels`.

Why it matters:

- This is likely a stale dependency pair.
- Stale dependencies increase install size, scanning surface, and cognitive load.

Recommendation:

- Confirm no hidden runtime usage exists, then remove both packages.

## Large and Unorganized Hotspots

### 1. `src/main/main.ts` is over-concentrated

Evidence:

- 1888 LOC
- 52 KB source size
- 56 `ipcMain.handle(...)` registrations

What is happening in this file:

- App bootstrapping
- Browser view lifecycle
- terminal spawn/write/resize/kill
- harness discovery
- AI commit generation
- git IPC surface
- settings persistence
- renderer URL resolution

Why this is a hotspot:

- It is functioning as app entrypoint, service layer, and integration layer at the same time.
- Changes in unrelated features will continue to collide here.
- This file is already large enough that dead code can hide in plain sight.

Recommendation:

- Split by responsibility:
  - `main/window.ts`
  - `main/browserViewService.ts`
  - `main/terminalService.ts`
  - `main/harnessService.ts`
  - `main/gitIpc.ts`
  - `main/settingsIpc.ts`
  - `main/aiCommitService.ts`

Expected payoff:

- Easier testability
- Lower merge conflict risk
- Cleaner ownership boundaries

### 2. `src/renderer/store/workspaceStore.ts` is carrying both algorithms and app state synchronization

Evidence:

- 1389 LOC
- 40 KB source size
- More than 20 state actions
- Repeated `workspaces: state.workspaces.map(...)` synchronization pattern across the file

Representative evidence:

- repeated mirrored updates at `src/renderer/store/workspaceStore.ts:875`, `884`, `894`, `903`, `945`, `977`, `1049`, `1099`, `1230`, `1250`, `1272`, `1295`, and more

Why this is a hotspot:

- The file mixes:
  - state schema
  - layout tree algorithms
  - normalization helpers
  - pane operations
  - browser pane operations
  - workspace switching logic
  - persistence-like mirroring between active workspace fields and `workspaces[]`

Risk:

- High bug probability from state duplication.
- Every action has to update both top-level “active workspace” fields and the entry inside `workspaces`.
- That makes omissions easy and auditing difficult.

Recommendation:

- Pick a single source of truth.
- The cleanest direction is to store only:
  - `workspaces`
  - `activeWorkspaceId`
  - derived selectors for the active workspace

Secondary recommendation:

- Move layout algorithms into `workspaceLayout.ts`.
- Keep the store focused on state transitions, not layout math.

### 3. `src/renderer/components/GitButton.tsx` has become a subsystem

Evidence:

- 968 LOC
- 32 KB source size
- paired with `src/renderer/components/GitButton.css` at 836 LOC

Current responsibilities:

- repo polling
- change status
- branch management
- merge state
- stash state and actions
- history loading
- diff viewing
- commit dialog orchestration

Why this is a hotspot:

- It is too large to reason about locally.
- UI state, data-fetch state, and mutation logic are all coupled together.
- The file is almost certainly where the next git-related regression will land.

Recommendation:

- Break into focused units:
  - `GitStatusButton`
  - `GitBranchPanel`
  - `GitHistoryPanel`
  - `GitStashPanel`
  - `GitDiffPanel`
  - `useGitWorkspaceData`
  - `useGitActions`

CSS recommendation:

- Split `GitButton.css` with the component split.

### 4. `WorkspaceGateContent.tsx` duplicates harness configuration and mixes unrelated concerns

Evidence:

- `src/renderer/components/WorkspaceGateContent.tsx:30`
- `src/renderer/components/Header.tsx:7`
- `src/main/main.ts:50`

Finding:

- Harness option metadata is declared in three places.

Why this is a hotspot:

- UI and main process can drift on labels, availability semantics, and supported harnesses.
- The current typecheck failures around shared types reinforce that the repo does not have a stable shared contracts layer.

Recommendation:

- Move shared harness metadata and shared renderer-visible types into a common typed module.
- Keep runtime-only fields like command/env in main-process modules if needed, but avoid copying label/id lists into multiple UI files.

### 5. Duplicate workspace-closing logic

Files:

- `src/renderer/components/Header.tsx:198`
- `src/renderer/components/WorkspaceTabs.tsx:23`

Finding:

- Both files manually kill all terminals and then close the workspace.

Why this matters:

- It is small duplication now, but lifecycle logic tends to drift.
- Workspace termination should be a store action or a dedicated service action, not copy-pasted UI behavior.

Recommendation:

- Centralize workspace shutdown into one action.

## Documentation and Intent Drift

### 1. `SPEC.md` is stale relative to implementation

Evidence:

- `SPEC.md:6` and `SPEC.md:13` describe `BrowserView`
- `SPEC.md:10` says Electron `31.x`
- `SPEC.md:14` says CSS Grid layout
- Actual implementation uses:
  - `WebContentsView` in `src/main/main.ts`
  - Electron `41.1.1` in `package.json:42`
  - `react-resizable-panels` in `src/renderer/components/DynamicPaneLayout.tsx:2`

Why this matters:

- The spec is no longer reliable as an engineering reference.
- New contributors will form the wrong mental model before reading the code.

Recommendation:

- Either update `SPEC.md` to match reality or demote it to historical reference and say so clearly at the top.

### 2. README understates the project’s actual correctness gates

Evidence:

- `README.md` documents only install, dev, and build
- There is no mention of tests, typecheck, or packaging status

Why this matters:

- Repo consumers do not know how to verify the project properly.

Recommendation:

- Add a “Validation” section documenting:
  - build
  - renderer typecheck
  - main tests
  - packaging

## Risk Assessment

### Highest Risk Areas

- Packaging pipeline
- Renderer type integrity
- Workspace store synchronization complexity
- Git UI/component sprawl
- Main-process monolith

### Moderate Risk Areas

- Stale docs and stale dependencies
- Duplicated harness configuration
- Dead IPC surface

### Lower Risk but Worth Cleaning

- Unused locals and dead helpers
- Legacy browser component leftovers
- oversized CSS modules

## Prioritized Action Plan

### Priority 0: Restore trustworthy gates

- Add a `typecheck` script for renderer and make it mandatory in CI/local workflow
- Add a `test` script for the existing compiled `node:test` suite or migrate tests to a direct TypeScript-aware runner
- Fix packaging by replacing the invalid Linux target in `package.json`
- Add a single `validate` script that runs build, typecheck, and tests

Why first:

- Without this, the repo can continue to regress while still appearing “green.”

### Priority 1: Remove confirmed dead code

- Delete `BrowserPane.tsx` and `BrowserPane.css`
- Remove unused IPC bridge methods and corresponding handlers
- Remove unused store helpers flagged by TypeScript
- Remove `parseModelOutput`
- Remove dead locals and unused interfaces in renderer components
- Verify and remove `react-grid-layout` and its types if truly unused

Why second:

- This is low-risk cleanup with immediate clarity payoff.

### Priority 2: Break apart the biggest hotspots

- Split `main.ts` by service boundary
- Split `workspaceStore.ts` into:
  - store definitions
  - layout helpers
  - workspace selectors
- Split `GitButton.tsx` into focused panels/hooks/components

Why third:

- This is where future bug volume is likely to come from.

### Priority 3: Reduce state duplication

- Refactor the store so active workspace data is derived from `activeWorkspaceId` rather than mirrored at the top level
- Centralize workspace close/cleanup lifecycle in one action

Why:

- This will remove a major class of synchronization bugs.

### Priority 4: Reconcile docs with implementation

- Update `SPEC.md`
- Expand `README.md`
- Document actual supported harnesses and packaging expectations

Why:

- It prevents wrong assumptions from being reintroduced later.

## Suggested Cleanup Sequence

If I were sequencing the work for minimum risk, I would do it in this order:

1. Fix packaging target and add explicit `typecheck`/`test` scripts.
2. Remove confirmed dead files, dead IPC methods, dead helpers, and stale dependency entries.
3. Fix renderer type errors until `tsc -p tsconfig.json` is green.
4. Extract shared types and harness metadata.
5. Refactor `workspaceStore.ts` into a single-source-of-truth model.
6. Split `GitButton.tsx` and `main.ts`.
7. Update docs after the code structure settles.

## Overall Status

Current status assessment:

- Buildability: acceptable
- Type safety: failing
- Packaging readiness: failing
- Test coverage breadth: weak
- Dead code burden: moderate and confirmed
- Maintainability: trending poor in a few concentrated modules

Overall repository status:

- The repo is usable for development work.
- It is not clean enough to be called healthy.
- The immediate objective should not be new features; it should be restoring trustworthy validation and reducing the concentration of complexity in a few oversized files.
