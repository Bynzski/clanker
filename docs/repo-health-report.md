# Repository health review

Reviewed 2026-10-07 at commit `f063195`, using lockfile-installed Fallow **2.56.0**, Node **26.10.0**, npm **12.2.0**, on Linux. This is a static-analysis and automated-validation review, not a desktop/SSH live smoke test or a security certification. No application code or analyzer configuration was changed.

## Targeted cleanup follow-up (2026-10-07)

The original measurements below are retained as review evidence. Follow-up changes explicitly unmount bootstrap-test React roots; extract provider-independent attention environment sanitization (all consumers migrated); and extract terminal launch target resolution without moving either final pre-spawn identity check or changing rollback. Existing launch/context race tests and targeted attention tests pass.

After cleanup, uncached Fallow reports **93.2/A full**, **90.7/A production**, **zero circular dependencies**, and `spawnTerminal` complexity **95 cyclomatic / 73 cognitive** (previously 113/88). Calibrating smoke-script entries and known MCP/builtin resolution noise reduces raw dead-code findings to **57 full / 104 production**; this reduction is partly configuration correction, not deleted code. The 57 full-mode backlog identities are recorded in a reviewed baseline. `npm run fallow:check` accepts those identities and rejects new findings (verified with a temporary unused-file probe); it is included in validation and Ubuntu CI. See [Fallow maintenance checks](fallow.md) for exceptions, commands and baseline review policy.

Follow-up validation: targeted tests passed (182 assertions across 6 files), then two consecutive full-suite runs passed (336 files / 7,124 tests) without unhandled errors. The second full run was the final `npm run validate`, which also passed branding, lint, typecheck, the Fallow baseline gate, security and build. Validation used Node 26 locally; Node 22 Ubuntu CI was configured but not executed here. The pre-existing build chunk-size warning and documented dev-only security exception remain.

Large launch/session functions still need incremental refactoring; this pass intentionally extracts only the terminal identity-resolution phase. Obsolete launcher removal, duplicate type consolidation and bundle-size changes remain deferred.

## Verdict

**Generally healthy, with concentrated maintainability debt and an observed validation flake.** Fallow grades the full repository **A, 91.1/100** and production mode **A, 88.6/100**. These scores do not establish runtime correctness. Prioritize reliable test teardown, terminal/session launch complexity, and the confirmed dependency cycle before broad cosmetic cleanup.

## Validation

The first `npm run validate` run:

| Check | Result |
| --- | --- |
| Branding | Passed: 19 generated assets match |
| Lint | Passed |
| Typecheck | Passed |
| Security audit gate | Passed with the existing documented `GHSA-ch52-4w7c-c8xp` dev-only electron-builder exception; no other high/critical findings |
| Build | Passed, with a renderer chunk-size warning |
| Tests | 335 files / 7,122 tests passed, but one unhandled error made the command fail |

**Final full validation rerun passed:** branding, lint, typecheck, security, build, and all 335 test files / 7,122 tests, with no unhandled errors. The initial failure remains worth investigating because a rerun does not fix intermittent teardown behavior.

The error was `ReferenceError: window is not defined` in React's scheduler after a run attributed to `tests/renderer/unit/bootstrap.test.tsx`. Running that file alone passed. Treat this as an observed intermittent teardown issue, not a failing assertion or proven production bug. `bootstrap()` creates a React root directly (`src/renderer/main.tsx:39`), while the test's teardown invokes Testing Library `cleanup()` without explicitly retaining/unmounting that root (`tests/renderer/unit/bootstrap.test.tsx:56`). This is a plausible investigation lead, not a confirmed root cause. Reproduce under the project's Node 22 CI runtime as well; this review used Node 26.

The main renderer bundle is **1,027.75 kB minified / 335.91 kB gzip**. Several panels and xterm are already separate chunks. Inspect the remaining initial bundle before adding more lazy-loading boundaries; do not merely increase the warning limit.

## Fallow results

Both scans disabled incremental caching and used the existing `.fallowrc.json` and default thresholds.

| Metric | Full repository | Production mode |
| --- | ---: | ---: |
| Health score | 91.1 (A) | 88.6 (A) |
| Files analyzed for health | 862 | 505 |
| Functions analyzed | 21,025 | 5,691 |
| Average maintainability | 87.5 | 85.7 |
| Dead-code/dependency issues (raw) | 74 | 115 |
| Unused files | 6 | 8 |
| Unused value exports | 18 | 63 |
| Unused type exports | 37 | 37 |
| Unused dependencies | 1 | 1 |
| Unresolved import findings | 10 | 4 |
| Unlisted dependencies | 1 | 1 |
| Circular dependency groups | 1 | 1 |
| Clone groups | 804 | 72 |
| Duplicated lines | 16,900 | 1,609 |
| Duplication percentage | 10.16% | 2.51% |

Duplication denominators are the clone analyzer's 166,331 lines (full) and 63,984 lines (production), not the health analyzer's LOC count. Production mode excludes tests/development files and changes entry-point reachability; the full scan's larger duplication count is not a production-code duplication rate.

Full-mode health reports 305 above-threshold functions (67 critical, 79 high, 159 moderate). Production mode reports 1,024 (327 critical, 324 high, 373 moderate). **These counts are not directly comparable:** Fallow reports `coverage_model: static_estimated`; removing test roots changes inferred coverage and therefore CRAP-based findings. No measured coverage report was supplied. Do not interpret these figures as measured test coverage or as 1,024 independently confirmed complexity defects.

## Prioritized findings

### 1. Stabilize the validation gate

Investigate the late React scheduler error described above. Ensure bootstrap-created roots are explicitly unmounted and pending work is drained before jsdom teardown. Keep the unhandled-error failure enabled. An all-green assertion count is insufficient if the suite exits nonzero.

### 2. Reduce complexity at launch and resume boundaries

These functions combine security-sensitive identity checks, asynchronous resource acquisition, lifecycle handling and branching. Fallow's full-mode metrics:

| Function | Location | Cyclomatic | Cognitive | Lines |
| --- | --- | ---: | ---: | ---: |
| `spawnTerminal` | `src/main/ipc/terminalIpc.ts:135` | 113 | 88 | 265 |
| `invokeSession` | `src/main/ipc/sessionIpc.ts:195` | 93 | 73 | 259 |
| `invokeRemoteSession` | `src/main/ipc/remoteSessionInvocation.ts:23` | 59 | 44 | 108 |
| `executeWorkspaceRecipe` | `src/renderer/lib/recipeExecution.ts:29` | 53 | 108 | 195 |
| `executeAfterTurn` | `src/main/isolatedCheckout/isolatedCheckoutService.ts:744` | 45 | 35 | 96 |

Extract explicit phases/collaborators with tests for cancellation, resource rollback, stale workspace/context identity and local/SSH divergence. Preserve the final authority rechecks before spawn; moving them earlier to simplify a function would weaken correctness.

Churn-weighted hotspots rank `src/main/main.ts`, `src/main/preload.ts`, `src/main/ipc/terminalIpc.ts`, and `src/main/ipc/sessionIpc.ts` highest. This makes terminal/session boundaries better first targets than mechanically splitting every large file. Fallow also counts enclosing Zustand factories and test `describe` callbacks as large functions, so size alone is not sufficient evidence for a refactor.

### 3. Break the confirmed five-module import cycle

```
agentAttentionAdapters.ts
  -> harnesses/registry.ts
  -> harnesses/opencode/index.ts
  -> harnesses/opencode/rehome.ts
  -> environment/localCommandExecutor.ts
  -> agentAttentionAdapters.ts
```

The local executor imports `withoutAttentionEnvironment` from the provider-aware adapter module. A focused provider-independent environment-sanitizing module is a likely way to remove this edge without duplicating credential-stripping rules. Verify initialization and credential filtering with existing launch/attention tests. The cycle is confirmed; a runtime failure caused by it was not observed.

### 4. Calibrate analyzer noise before deleting code

- **Do not remove `@modelcontextprotocol/sdk`.** `src/main/agentBridge/server.ts:3-5` imports it directly. Node resolves its server/types subpaths, and typecheck/build pass. Fallow's unresolved-subpath findings and unused-dependency recommendation are false positives.
- **Do not install `node:sqlite`.** It is a Node builtin, used by Antigravity history and its tests. The unlisted-dependency finding is analyzer noise.
- Four reported unused smoke scripts are intentional standalone commands: app-close guard, Pi bridge, SSH preview sessions and terminal geometry. Their headers/docs show invocation instructions. Their generated `dist/main/...` imports are not missing source modules. Register these scripts as intentional analyzer entries and narrowly handle generated-output resolution rather than deleting them.
- Full mode reports `tests/setup/node.ts` and `tests/setup/childProcess.ts` as unused; neither is referenced by the current Vitest setup configuration. Review whether these are obsolete helpers before removal.
- Production mode additionally flags `WorktreeLauncher.tsx`, `RemoteWorktreePicker.tsx`, `RemoteWorktreeCreate.tsx` and `RemoteWorktreeInspect.tsx`. Project instructions explicitly say those launcher surfaces are no longer rendered. They remain reachable from tests, explaining why the full scan does not flag them. These are credible retirement candidates, but delete/update the associated tests and imports together after confirming no intended support remains.
- The 18 value-export and 37 type-export findings are API-surface cleanup candidates, not proof their underlying implementation is unused. Removing an `export` is different from deleting the declaration. Shared Git types overlap with main/renderer definitions; consolidate canonical contracts instead of indiscriminately deleting shared types.

### 5. Keep duplication work targeted

Production duplication is modest. The largest detected family is Pi/OMP attention adapters (`src/main/harnesses/{pi,omp}/attention.ts`), and Fallow identifies those directories as mirrored. Consider sharing verified common mechanics while preserving provider-native events and configuration differences. Other candidates include duplicated Git result contracts across main/shared/renderer and repeated VCS HTTP error handling. Similar provider code and raw/validated annotation types may intentionally have different semantics; token similarity alone does not justify merging them.

## Analyzer integration recommendations

Fallow is installed but has no package script or validation/CI gate in the inspected package configuration. The current config has four manual entries and one narrow unresolved-import override. Automatic Electron/Vite/Vitest discovery is active, so the manual list alone is not the complete analysis root set.

1. Correct/narrowly document the confirmed resolution and builtin false positives; make intentional standalone smoke entry points explicit.
2. Add reproducible full and production report commands using the lockfile-installed version.
3. Save a reviewed baseline and gate regressions, not all existing findings at once.
4. If architecture enforcement is desired, explicitly configure main/renderer boundary rules. Zero reported boundary violations without configured rules does not prove architectural compliance.
5. Supply measured Istanbul-compatible coverage before using CRAP or coverage claims as a quality gate.

No earlier snapshot was used, so this report does **not** claim improvement or regression versus a previous review. Hotspot trends are Fallow's git-history estimates, not a comparison against a prior report.

## Reproduction and local evidence

```bash
npm ci
npx --no-install fallow --version
npx --no-install fallow --no-cache --format json --score
npx --no-install fallow --no-cache --production --format json --score
npm run test -- tests/renderer/unit/bootstrap.test.tsx
npm run validate
```

Raw local outputs from this review (temporary, not versioned): `/tmp/clanker-fallow.json`, `/tmp/clanker-fallow-production.json`, `/tmp/clanker-health-validate.log`, `/tmp/clanker-health-validate-final.log`, `/tmp/clanker-bootstrap-retest.log`. Re-run the commands to regenerate evidence on another checkout.
