# Windows Build Progress

Tracks which phases of the Windows Build plan have been completed.
Updated after each phase commit. Read by agent prompts to determine current state.

## Current Phase

**Phase 8c** — Next to start.

## Phase Status

| Phase | Description | Status | Commit |
|-------|-------------|--------|--------|
| Prereq | Stand up `windows-latest` CI matrix entry (continue-on-error) | ✅ | phase-prereq-windows-ci |
| 0 | Make tests platform-neutral (remove hardcoded Unix paths) | ✅ | phase-0-platform-neutral-tests |
| 1 | Cross-platform harness wrapper + shell/PATH defaults | ✅ | phase-1-cross-platform-shell |
| 2 | node-pty / ConPTY end-to-end validation on real Windows | ✅ | phase-2-smoke-fixes |
| 3 | Canonical path normalization at IPC boundary | ✅ | phase-3-path-normalization |
| 4 | Cross-drive rename + open-file mutation handling | ✅ | uncommitted |
| 5 | Reserved-name validation + atomic-save watcher tuning | ✅ | uncommitted |
| 6 | Credential / SSH permission policy on Windows | ✅ | uncommitted |
| 7 | Husky on Windows — document or replace shim | ✅ | uncommitted |
| 8a | Delete safety + CRLF preservation | ✅ | uncommitted |
| 8b | UNC / drive-letter / polling / long-path handling | ✅ | uncommitted |
| 8c | Case-insensitive path keying + case-only rename | 🔲 | — |
| 8d | Verify-only Windows polish sweep | 🔲 | — |
| 9 | Linux AppImage + unsigned NSIS/portable release smoke and v0.1 prep | 🔲 | — |

## Status Legend

| Symbol | Meaning |
|--------|---------|
| 🔲 | Not started |
| 🔧 | In progress (agent working) |
| ✅ | Complete — committed and verified |
| ❌ | Blocked — see notes |

## Notes

- Plan document: `plans/windows-build/PLAN.md` (v1.3, Approved)
- All phases must pass `npm run validate` before commit (lint → typecheck → build → test).
- Each phase gets one commit on `main` (or its own PR if review is desired).
- Read the full `AGENT-PROMPT.md` for detailed phase instructions.
- CI gate decision is finalized by end of Phase 5; the workflow edit that removes `continue-on-error: true` is implemented in Phase 9.

## Blocking Issues

- (none)

## Phase Details

### Phase Prereq ✅

**Scope:** Add `windows-latest` to the CI matrix in `.github/workflows/validate.yml`. Allow-failure for now.

**Done:** Restructured matrix to `os × node-version` with `os: [ubuntu-latest, windows-latest]`. `continue-on-error` set conditionally for Windows. Gated dependency review, npm audit, and coverage upload to `ubuntu-latest` only. All other steps (lint, typecheck, build, test) run on both platforms. `npm run validate` passes on Linux.

### Phase 0 ✅

**Scope:** Replace hardcoded POSIX path literals in `tests/` with `os.tmpdir()` / `os.homedir()` + `path.join`. Linux test suite must stay green.

**Done:** Created `tests/_helpers/tempPaths.ts` with platform-neutral helpers. Fixed 21 test files: replaced `/home/test` mock returns with `testHome()`, replaced `/tmp/test-home` with `path.join(os.tmpdir(), ...)`, replaced `/home/testuser` and `/home/user` fixtures with `path.join`-derived constants, fixed Claude session encoded-path mock to derive from workspace constant. Left pure string fixtures (`getWorkspaceNameFromPath` POSIX split tests, `file:///tmp/test.txt` URL rejection tests, SSH config data) as-is. All 3192 tests pass. `npm run validate` green.

### Phase 1 ✅

**Scope:** Cross-platform harness wrapper + shared default-shell helper + `path.delimiter` PATH-join fix.

**Done:** Created `src/main/platformShell.ts` with `defaultShell()`, `userLocalBinPath()`, `prependUserLocalBinToPath()`. Updated `sessionIpc.ts` and `terminalIpc.ts` to use shared `defaultShell()`. Fixed `sessionHistory.ts:175` to use `path.delimiter`. Updated `harnessLaunch.ts` to skip wrapper generation on Windows (`WINDOWS_SKIP_WRAPPER` flag); `ensureHarnessWrapperScript` returns `null` on Windows. Updated `buildSessionInvokeArgs` in `sessionHistory.ts` to invoke harness directly on Windows via `wrapOrDirect` helper. Updated `terminalIpc.ts` to handle `null` wrapper path. Verified no `/home/` literals in renderer. All 3192 tests pass. `npm run validate` green.

### Phase 2 ✅

**Scope:** Manual smoke on a real Windows host: PowerShell terminal via ConPTY + harness launch end-to-end.

**Context:** No code changes unless the smoke surfaces real bugs. See PLAN.md "Phase 2" section.

**Done:** Three rounds of smoke testing revealed seven bugs — all fixed:
1. `terminalIpc.ts`: `shellArgs = ['-i']` is a bash-only flag. PowerShell rejects it → terminal fails to start. Fixed: args are now `[]` on `win32`, `['-i']` elsewhere.
2. `settingsIpc.ts`: `OPEN_BASE_DIRECTORY_DIALOG` appended `/` to native Windows paths. Fixed: uses `path.sep`.
3. `WorkspaceGateContent.tsx`: `withTrailingSlash` appended `/` without normalizing backslashes. Fixed: normalizes `\\` → `/` first.
4. `WorkspaceGateContent.tsx`: `handleSubmit` and `fetchSuggestions` only detected POSIX absolute paths (`/...`). Fixed: also detects Windows drive-letter paths (`C:/...`).
5. `harnessLaunch.ts` / `terminalIpc.ts` / `sessionHistory.ts`: On Windows, npm-installed CLI tools are `.cmd` wrapper scripts. `node-pty.spawn('opencode', ...)` fails with "file not found". Fixed: new `resolveHarnessSpawn()` helper wraps harness commands in `cmd.exe /c` on Windows.
6. `terminalIpc.ts`: `pty.kill()` throws on Windows (node-pty SIGTERM warning). Fixed: wrapped kill calls in try-catch.
7. `FileExplorer/index.tsx`: `listDirectory` IPC returns entry paths with backslash separators on Windows, but renderer stores keys with forward slashes. Fixed: normalize entry paths after IPC response.

Created `src/main/harnessLaunch.ts:resolveHarnessSpawn()` — shared helper for cross-platform command resolution. Created `docs/windows-smoke-test.md` — Phase 2 verification checklist. All 3192 tests pass. `npm run validate` green.

### Phase 3 ✅

**Scope:** POSIX paths at the IPC boundary. New renderer-safe `src/shared/pathNormalize.ts` exporting `toPosixPath` / `toNativePath`. Audit every path-bearing IPC handler, including file/session/terminal/settings/git/vcs/aiCommit, and every Map/Set keyed by path.

**Done:** Added `src/shared/pathNormalize.ts` with renderer-safe `toPosixPath` / `toNativePath` helpers and unit tests (`tests/main/unit/pathNormalize.test.ts`) including Windows drive-letter/UNC round-trip cases. Normalized IPC boundaries in `fileIpc.ts`, `settingsIpc.ts`, `sessionIpc.ts`, `terminalIpc.ts`, and shared workspace-path validation in `aiCommitIpc.ts` (used by git/vcs IPC). Normalized outgoing path events in `explorerWatcher.ts` and `fileWatcher.ts`. Normalized renderer path-keying in `editorFileWatcher.ts`. Added canonical IPC path-form rule to `AGENTS.md` Maintainability section. All 3207 tests pass. `npm run validate` green.

### Phase 4 ✅

**Scope:** `EXDEV` fallback for cross-drive rename; structured `FILE_IN_USE` error mapping for `EBUSY`/`EPERM`; `releaseHandle()` in `fileWatcher.ts` so the editor's own watch isn't the source of `EBUSY`.

**Done:** Added structured file-op error codes (`FILE_IN_USE`) in shared types. Implemented `EXDEV` rename fallback in `fileService.ts` (`rename` → `cp/rm` for directories, `copyFile/unlink` for files). Added `FILE_IN_USE` mapping for `EPERM`/`EBUSY` delete/rename errors. Added `releaseHandle(filePath)` to `FileWatcherService` and wired `fileIpc.ts` delete/rename handlers to release watch handles before mutations (and rewatch on failure). Updated `FileExplorer` rename/delete flows to unwatch editor-held file paths before mutation, rewatch on failure, and show a user-facing prompt for `FILE_IN_USE`. Added tests for `releaseHandle` and IPC watcher-release behavior. `npm run validate` green.

**Context:** `src/main/fileService.ts` lines 489 (delete), 533 (rename). `src/main/fileWatcher.ts` holds raw `FSWatcher` per file. See PLAN.md "Phase 4" section.

### Phase 5 ✅

**Scope:** Reserved-name validator (shared module) wired into FileTree `CreateInput` + main `fileService` defense-in-depth. Tune existing `awaitWriteFinish` in `explorerWatcher.ts` for Windows. Verify `fileWatcher.ts` rewatch-on-rename behavior on Windows.

**Done:** Added shared `src/shared/filenameValidation.ts` (`validateFilename`) with reserved-name, trailing dot/space, invalid-character, empty-name, and UTF-8 byte-length checks. Wired validation into renderer create UI (`FileTree` `CreateInput`) with inline errors, and enforced defense-in-depth in `fileService` create/rename paths. Tuned `explorerWatcher.ts` `awaitWriteFinish` to `{ stabilityThreshold: 200, pollInterval: 100 }` on Windows (100 on Linux/macOS). Implemented unlink+add collapse window (300ms) so atomic-save bursts coalesce to a single explorer refresh event. Added unit coverage for filename validation, file-service reserved-name rejection, explorer unlink+add collapse, and fileWatcher rename/rewatch verification for Windows-style atomic save semantics. `npm run validate` green.

**Context:** `awaitWriteFinish` is **already enabled** in `explorerWatcher.ts:156` — Phase 5 tunes it. The renderer `editorFileWatcher.ts` has no chokidar; the real watcher is `src/main/fileWatcher.ts` using raw `fs.watch`. See PLAN.md "Phase 5" section.

### Phase 6 ✅

**Scope:** Decide and apply the Windows policy for SSH-key file permissions. Gate POSIX-mode calls on non-Windows.

**Done:** Chose policy (b): on Windows, rely on inherited NTFS ACLs under `%USERPROFILE%\.ssh`; keep explicit POSIX permission enforcement on non-Windows only. Updated `sshKeyService.ts` to gate `mkdirSync({ mode })` and `chmodSync` behind `process.platform !== 'win32'`. Updated `credentialService.ts` `.ssh` config path resolution to prefer `%USERPROFILE%` on Windows with fallback to `HOME`/`os.homedir()`, and gated `.ssh` directory mode-setting in `configureSshForHost` to non-Windows. Documented policy in `AGENTS.md` Windows Support section. `npm run validate` green.

**Context:** `src/main/credential/sshKeyService.ts`, `src/main/credential/credentialService.ts`. See PLAN.md "Phase 6" section.

### Phase 7 ✅

**Scope:** Document Git-for-Windows requirement, OR replace `.husky/pre-commit` with a Node entrypoint.

**Done:** Kept the existing minimal `.husky/pre-commit` hook (`npm run lint`, `npm run typecheck`) and documented the Windows requirement that Git hooks run through the `sh` bundled with Git for Windows. Added explicit notes to `README.md` and `AGENTS.md` so Windows contributors know Git for Windows is required for pre-commit execution. `npm run validate` green.

**Context:** See PLAN.md "Phase 7" section.

### Phase 8a ✅

**Scope:** Route delete through `shell.trashItem` where possible and preserve CRLF/LF line endings on save.

**Done:** Updated `fileService.deleteEntry` to route deletes through `shell.trashItem` first with a documented fallback to `fs.rm` when native trash integration is unavailable. Added renderer line-ending preservation helper (`preserveOriginalLineEndings`) and wired `workspaceStore.saveEditorFile` to preserve the original file line-ending style on save. Added editor-store tests verifying CRLF-origin files save as CRLF and LF-origin files save as LF. `npm run validate` green.

**Context:** Bounded implementation phase for F8 and F13. See PLAN.md "Phase 8a" section.

### Phase 8b ✅

**Scope:** UNC/drive-letter workspace acceptance, watcher polling fallback for UNC paths, and long-path documentation/targeted fixes.

**Done:** Added shared `src/shared/pathClassify.ts` for absolute path classification (`isAbsoluteWorkspacePath`, UNC + drive-letter helpers). Updated `WorkspaceGateContent` to normalize backslashes in user input and accept UNC-style absolute paths (`//server/share/...`) in submit/suggestion flows. Added `ExplorerWatcherService` UNC polling fallback via `shouldUsePollingForWorkspace()` — on Windows, polling is enabled automatically for UNC workspaces and can be forced with `CLANKER_GRID_WATCHER_POLLING=1`. Added unit coverage for path classification, UNC submit behavior in workspace gate, and polling-strategy logic. Added `docs/windows.md` with Git-for-Windows note, UNC polling behavior, and Windows long-path enablement guidance; linked it from `README.md`. `npm run validate` green.

**Context:** Bounded implementation phase for F7, F9, F10, and F11. See PLAN.md "Phase 8b" section.

### Phase 8c

**Scope:** Case-insensitive path keying on Windows and case-only rename support while preserving display casing.

**Context:** Bounded implementation phase for F3. See PLAN.md "Phase 8c" section.

### Phase 8d

**Scope:** Verify and document Git autocrlf, `.ssh` lookup, app-data/electron-store, and raw `fs.watch` findings.

**Context:** Verify-only sweep for remaining low-risk items. See PLAN.md "Phase 8d" section.

### Phase 9

**Scope:** `npm run build:dist` on Linux and Windows; smoke Linux AppImage and Windows installer/portable on clean hosts; flip CI gate to required in workflow configuration; prepare release notes/checksums. Publish/tag only with explicit maintainer authorization.

**Context:** See PLAN.md "Phase 9" section.

## Completed Phases

| Phase | Commit | Summary |
|-------|--------|---------|
| Prereq | phase-prereq-windows-ci | Added `windows-latest` to CI matrix with `continue-on-error: true`. Gated Linux-only steps. `npm run validate` green on Linux. |
| 0 | phase-0-platform-neutral-tests | Replaced hardcoded Unix path literals in 21 test files. Created `tests/_helpers/tempPaths.ts`. All 3192 tests pass on Linux. |
| 1 | phase-1-cross-platform-shell | Created `platformShell.ts` shared helper. Fixed shell defaults and PATH delimiter. Wrapper skipped on Windows. All 3192 tests pass. |
| 2 | phase-2-smoke-fixes | Fixed 7 bugs from Windows smoke: shell args, path separators, harness cmd.exe wrapping, SIGTERM suppression, explorer path normalization. Created `resolveHarnessSpawn()` helper. All 3192 tests pass. |
| 3 | phase-3-path-normalization | Added shared path normalizers and tests, normalized IPC path boundaries and path-keyed maps, and added canonical IPC path rule to AGENTS.md. All 3207 tests pass. |
| 4 | ef9a4c0 | Added EXDEV rename fallback, FILE_IN_USE mapping for EPERM/EBUSY, file watcher releaseHandle integration, renderer unwatch/rewatch flow, and phase tests. All 3211 tests pass. |
| 5 | uncommitted | Added shared filename validation, renderer/main create+rename enforcement, explorer watcher awaitWriteFinish tuning, unlink+add collapse, and phase tests. All 3222 tests pass. |
