# Windows Build Progress

Tracks which phases of the Windows Build plan have been completed.
Updated after each phase commit. Read by agent prompts to determine current state.

## Current Phase

**Phase Prereq** — Not yet started.

## Phase Status

| Phase | Description | Status | Commit |
|-------|-------------|--------|--------|
| Prereq | Stand up `windows-latest` CI matrix entry (continue-on-error) | 🔲 | — |
| 0 | Make tests platform-neutral (remove hardcoded Unix paths) | 🔲 | — |
| 1 | Cross-platform harness wrapper + shell/PATH defaults | 🔲 | — |
| 2 | node-pty / ConPTY end-to-end validation on real Windows | 🔲 | — |
| 3 | Canonical path normalization at IPC boundary | 🔲 | — |
| 4 | Cross-drive rename + open-file mutation handling | 🔲 | — |
| 5 | Reserved-name validation + atomic-save watcher tuning | 🔲 | — |
| 6 | Credential / SSH permission policy on Windows | 🔲 | — |
| 7 | Husky on Windows — document or replace shim | 🔲 | — |
| 8a | Delete safety + CRLF preservation | 🔲 | — |
| 8b | UNC / drive-letter / polling / long-path handling | 🔲 | — |
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

- (none yet)

## Phase Details

### Phase Prereq

**Scope:** Add `windows-latest` to the CI matrix in `.github/workflows/validate.yml`. Allow-failure for now.

**Context:** Workflow-only change. No source edits. See PLAN.md "Phase Prereq" section.

### Phase 0

**Scope:** Replace hardcoded POSIX path literals in `tests/` with `os.tmpdir()` / `os.homedir()` + `path.join`. Linux test suite must stay green.

**Context:** Start with `rg -n "(/home|/tmp|/Users|~/)" tests` and classify every hit as filesystem/mock path, pure string-shape fixture, or Linux-only semantic test. The known list in PLAN.md is intentionally not exhaustive.

### Phase 1

**Scope:** Cross-platform harness wrapper + shared default-shell helper + `path.delimiter` PATH-join fix.

**Context:** Mirror `src/main/ipc/terminalIpc.ts:92` shell branch and `src/main/harnessCatalog.ts:308` `path.delimiter` usage. The renderer has **no `/home/...` literals** (verified) — Phase 1 includes a verify-only re-grep. See PLAN.md "Phase 1" section.

### Phase 2

**Scope:** Manual smoke on a real Windows host: PowerShell terminal via ConPTY + harness launch end-to-end.

**Context:** No code changes unless the smoke surfaces real bugs. See PLAN.md "Phase 2" section.

### Phase 3

**Scope:** POSIX paths at the IPC boundary. New renderer-safe `src/shared/pathNormalize.ts` exporting `toPosixPath` / `toNativePath`. Audit every path-bearing IPC handler, including file/session/terminal/settings/git/vcs/aiCommit, and every Map/Set keyed by path.

**Context:** Foundational for Phases 4, 5, 8. `getSafeWorkspacePath` lives in `src/main/main.ts:158` (not sessionIpc). See PLAN.md "Phase 3" section.

### Phase 4

**Scope:** `EXDEV` fallback for cross-drive rename; structured `FILE_IN_USE` error mapping for `EBUSY`/`EPERM`; `releaseHandle()` in `fileWatcher.ts` so the editor's own watch isn't the source of `EBUSY`.

**Context:** `src/main/fileService.ts` lines 489 (delete), 533 (rename). `src/main/fileWatcher.ts` holds raw `FSWatcher` per file. See PLAN.md "Phase 4" section.

### Phase 5

**Scope:** Reserved-name validator (shared module) wired into FileTree `CreateInput` + main `fileService` defense-in-depth. Tune existing `awaitWriteFinish` in `explorerWatcher.ts` for Windows. Verify `fileWatcher.ts` rewatch-on-rename behavior on Windows.

**Context:** `awaitWriteFinish` is **already enabled** in `explorerWatcher.ts:156` — Phase 5 tunes it. The renderer `editorFileWatcher.ts` has no chokidar; the real watcher is `src/main/fileWatcher.ts` using raw `fs.watch`. See PLAN.md "Phase 5" section.

### Phase 6

**Scope:** Decide and apply the Windows policy for SSH-key file permissions. Gate POSIX-mode calls on non-Windows.

**Context:** `src/main/credential/sshKeyService.ts`, `src/main/credential/credentialService.ts`. See PLAN.md "Phase 6" section.

### Phase 7

**Scope:** Document Git-for-Windows requirement, OR replace `.husky/pre-commit` with a Node entrypoint.

**Context:** See PLAN.md "Phase 7" section.

### Phase 8a

**Scope:** Route delete through `shell.trashItem` where possible and preserve CRLF/LF line endings on save.

**Context:** Bounded implementation phase for F8 and F13. See PLAN.md "Phase 8a" section.

### Phase 8b

**Scope:** UNC/drive-letter workspace acceptance, watcher polling fallback for UNC paths, and long-path documentation/targeted fixes.

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
| — | — | — |
