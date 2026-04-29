# Windows Build Plan

**Author:** Jay
**Date:** 2026-04-28
**Status:** In Progress
**Version:** 1.2

---

## Progress Notes

- **2026-04-28 / Phase 9 verification follow-up:** Updated Windows CI/test alignment after the first required `windows-latest` gate failed in GitHub Actions.
  - Fixed null workspace-path guarding in `src/main/ipc/aiCommitIpc.ts`.
  - Hardened Windows path comparisons in `src/main/fileService.ts` to avoid `realpath()` short-path drift during workspace validation.
  - Normalized session discovery workspace handling in `src/main/sessionHistory.ts` and fixed Claude workspace encoding for Windows paths.
  - Updated Windows-sensitive unit tests (path-shape, shell args, wrapper expectations, SSH home/env handling, permission assertions, CRLF-safe git assertions, polling cleanup order, and git test helper cleanup/env behavior).
  - `npm run validate` passes locally after these updates. Next step is push-only verification in GitHub Actions; local smoke tests remain pending.

## Purpose

Close the gaps identified in `plans/windows-build-gap-analysis.md` so Clanker Grid produces a working, testable Windows build (NSIS + portable) on `windows-latest` CI, with feature parity for the core developer workflows (terminal, harness launch, file explorer, editor, credentials) on native Windows 10 1809+.

This iteration must preserve the existing Linux release path. The end state is **both** a working Linux AppImage and working Windows NSIS + portable executables; Windows work must be platform-gated and must not regress Linux validation or packaging.

This plan does **not** target WSL or attempt to ship a code-signed installer for v0.1 — those are explicit out-of-scope items locked in by the team defaults below.

---

## Locked-In Defaults

These were agreed up front and shape phase scope. Revisit if circumstances change.

| Decision | Choice |
|----------|--------|
| Code signing for first Windows release | **Unsigned.** Accept SmartScreen warnings for v0.1. Sign in a follow-up plan. |
| Minimum Windows version | **Windows 10 1809+** (required for ConPTY). |
| Default session shell on Windows | **PowerShell** (`powershell.exe`). Git Bash documented as an option; cmd.exe supported but not recommended. |
| WSL | **Not a target.** Native Windows only. WSL users run the Linux build. |

---

## Scope

### In Scope

| Item | Priority | Notes |
|------|----------|-------|
| Stand up `windows-latest` CI job | P0 | Provides ground truth for every other phase. |
| Make tests platform-neutral | P0 | Required before CI is meaningful. |
| Cross-platform harness wrapper + shell/PATH defaults | P0 | Blocks any Windows harness launch (Claude, Codex, etc.). |
| node-pty / ConPTY end-to-end verification | P0 | Blocks terminal usability on Windows. |
| Canonical path normalization at IPC boundary | P0 | Unblocks reliable explorer, watcher, tabs, drag-drop. |
| Cross-drive rename + open-file mutation handling | P1 | Required for non-broken file ops on Windows. |
| Reserved-name validation + atomic-save watcher tuning | P1 | Prevents cryptic explorer errors and editor flicker. |
| Credential/SSH permission policy on Windows | P1 | Lock down or document the security intent. |
| Husky pre-commit on Windows | P2 | Document Git-for-Windows requirement. |
| Polling fallback, trash-on-delete, long-path, CRLF, drive letters | P2 | Polish + edge cases (F7–F14, item 10, 12, 14). |
| Final Linux + Windows release smoke | P2 | Verify Linux AppImage still builds and Windows NSIS + portable artifacts build. |

### Out of Scope

- Windows code signing / SmartScreen reputation (deferred to a v0.2 plan).
- WSL as a first-class target.
- macOS-specific work (covered by separate plan if/when needed).
- Refactoring beyond what's needed to fix Windows behavior — no opportunistic cleanup.
- ARM64 Windows builds (x64 only for v0.1).

---

## What Already Exists

| Component | Location | Status |
|-----------|----------|--------|
| `electron-builder` Linux config (AppImage) | `package.json` (build.linux) | ✅ Present — must remain working |
| `electron-builder` Windows config (NSIS + portable) | `package.json` (build.win) | ✅ Present |
| Windows installer icon | `src/assets/icons/icon.ico` | ✅ Present |
| `cross-env` in dev scripts | `package.json` (scripts.dev:main, etc.) | ✅ Present |
| Cross-platform credential storage via `safeStorage` (DPAPI on Win) | `src/main/credential/credentialService.ts` | ✅ Present |
| Cross-platform shortcut handling (`metaKey || ctrlKey`) | renderer keyboard handlers | ✅ Present |
| `path.delimiter` usage in PATH building | `src/main/harnessCatalog.ts` | ✅ Present |
| `process.platform === 'win32'` shell branch (terminalIpc) | `src/main/ipc/terminalIpc.ts:92` | ⚠️ Partial — `sessionIpc.ts:44` defaults to `'bash'` and is not aligned |
| `awaitWriteFinish` chokidar option (explorer side) | `src/main/explorerWatcher.ts:156` (stabilityThreshold:100) | ✅ Present (extend to editor-watch path in Phase 5) |
| Editor-file watching uses raw `fs.watch` per-file with rewatch-on-rename | `src/main/fileWatcher.ts` | ⚠️ Already handles atomic-save on Linux/macOS; needs Windows verification |
| `getSafeWorkspacePath` (security boundary helper) | `src/main/main.ts:158` (injected into IPC modules) | ✅ Present |
| Gap analysis source-of-truth document | `plans/windows-build-gap-analysis.md` | ✅ Exists |

### Existing Patterns to Follow

- **Platform branching:** Mirror `src/main/ipc/terminalIpc.ts:92` (`process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : 'bash')`) when picking a shell.
- **PATH joining:** Mirror `src/main/harnessCatalog.ts:308` (`path.delimiter`) when joining PATH segments. Replace the hardcoded `:` in `src/main/sessionHistory.ts:175`.
- **Validate at IPC boundary:** `getSafeWorkspacePath` in `src/main/main.ts:158` is the model — main owns validation/normalization, IPC modules receive it via dependency injection (see `registerSessionIpc` deps in `src/main/ipc/sessionIpc.ts`). Phase 3 normalizers should follow the same DI pattern.

---

## Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| Access to a real Windows 10/11 host (or VM) for Phase 2 sanity testing | Required | GitHub `windows-latest` runner is sufficient for CI but not for interactive PTY/terminal QA. |
| `@electron/rebuild` working for node-pty on Windows ABI | Verify in Phase 2 | electron-builder normally handles this; confirm. |
| Git for Windows installed on the dev/QA host | Required | For `gitService.ts`, husky, and Git Bash option. |

---

## Implementation Plan

### Phase Order

| Phase | Description | Depends On |
|-------|-------------|------------|
| Prereq | Add `windows-latest` CI matrix entry (allowed-to-fail initially) | — |
| 0 | Make tests platform-neutral (remove hardcoded Unix paths) | Prereq |
| 1 | Cross-platform harness wrapper + shell/PATH defaults | Phase 0 |
| 2 | node-pty / ConPTY end-to-end validation on real Windows | Phase 1 |
| 3 | Canonical path normalization at IPC boundary | Phase 0 |
| 4 | Cross-drive rename + open-file locking error paths | Phase 3 |
| 5 | Reserved-name validation + atomic-save watcher tuning | Phase 3 |
| 6 | Credential / SSH permission policy on Windows | Phase 0 |
| 7 | Husky on Windows — document or replace shim | Phase 0 |
| 8a | Delete safety + CRLF preservation | Phases 3–5 |
| 8b | UNC / drive-letter / polling / long-path handling | Phases 3–5 |
| 8c | Case-insensitive path keying + case-only rename | Phase 3 |
| 8d | Verify-only Windows polish sweep | Phases 6, 8a–8c |
| 9 | Linux AppImage + unsigned NSIS/portable release smoke and v0.1 prep | Phases 1, 2, 4, 5, 6, 8a–8d |

CI intent is decided by the end of Phase 5, but the actual workflow edit (`continue-on-error: true` removal) is performed in Phase 9 when release workflow changes are finalized. Making the job a branch-protection-required check is a GitHub repository settings task and must be done manually by a maintainer if desired.

---

### Phase Details

#### Phase Prereq — Stand up `windows-latest` CI job

**Purpose:** Get ground truth on Windows behavior before fixing anything.

**Scope:**
- [ ] Add `windows-latest` to the matrix in `.github/workflows/validate.yml`.
- [ ] Restructure the existing Node-only matrix into an `os × node-version` matrix so `matrix.os` conditions are available (e.g., `os: [ubuntu-latest, windows-latest]`, `node-version: [22]`).
- [ ] Mark the Windows job `continue-on-error: true` for now (flip later).
- [ ] Run lint, typecheck, build, and a smoke subset of tests on Windows.
- [ ] Skip `npm audit` step on the Windows leg (already gated on Linux only).
- [ ] Confirm the normal app build (`npm run build`) works on the Windows runner. Do **not** expect installer artifacts here; `electron-builder` only runs under `npm run build:dist` in Phase 9.

**Out of Scope:**
- Test fixes (Phase 0).
- Any source-code changes — this phase is workflow-only.
- Building the actual NSIS installer in CI (deferred to Phase 9).

**Files to Modify:**
- `.github/workflows/validate.yml` — add matrix `os: [ubuntu-latest, windows-latest]`, gate Linux-only steps with `if: matrix.os == 'ubuntu-latest'`.

**New Files:**
- None.

**Context Files to Read:**
- `.github/workflows/validate.yml` — current workflow.
- `package.json` — script names (`lint`, `typecheck`, `build`, `test`, `validate`).
- `AGENTS.md` — task-completion requirements.

---

#### Phase 0 — Make tests platform-neutral

**Purpose:** Remove the hardcoded `/home/...` and `/tmp/test-home` literals so the Windows CI run is meaningful and the failure surface narrows to real product bugs.

**Audit target:** run `rg -n "(/home|/tmp|/Users|~/)" tests` at the start of the phase and classify every hit as one of:

1. **Filesystem/mock path** — replace with `os.tmpdir()` / `os.homedir()` + `path.join` or a shared temp-path helper.
2. **Pure string-shape fixture** — leave only if the test intentionally asserts POSIX display/parsing behavior and add an inline comment explaining why it is platform-independent.
3. **Linux-only semantic test** — gate with `it.skipIf(process.platform === 'win32')` and add an inline comment explaining why Windows cannot run it.

Known files from the current repo snapshot include, but are not limited to:

- `tests/main/unit/sessionHistory.test.ts`
- `tests/main/unit/sessionHistory.regression.test.ts`
- `tests/main/unit/harnessCatalog.electron.test.ts`
- `tests/main/unit/terminalBuffer.test.ts`
- `tests/main/unit/terminalShutdown.test.ts`
- `tests/main/unit/terminalCleanup.test.ts`
- `tests/main/unit/terminalIpc.test.ts`
- `tests/main/unit/git-debug.test.ts`
- `tests/main/unit/gitIpc.test.ts`
- `tests/main/unit/browserIpc.test.ts`
- `tests/main/unit/settingsIpc.test.ts`
- `tests/main/unit/aiCommitIpc.test.ts`
- `tests/main/unit/windowIpc.test.ts`
- `tests/main/unit/credential/credentialService.test.ts`
- `tests/main/integration/ipcRegistration.test.ts`
- `tests/main/integration/gitService.real.test.ts`
- `tests/renderer/unit/WorkspaceGateContent.test.tsx`
- `tests/renderer/unit/WorkspaceTabs.test.tsx`
- `tests/renderer/unit/StatusBar.test.tsx`
- `tests/renderer/unit/workspaceStoreHelpers.test.ts`
- `tests/renderer/integration/workspaceStore.test.ts`
- `tests/main/unit/aiCommit.test.ts:317` — likely a pure string fixture for `buildCommitPrompt`; leave only with a comment if it never touches the filesystem.

**Scope:**
- [ ] Replace filesystem/mock path literals discovered by the audit with `os.tmpdir()` / `os.homedir()` + `path.join`. For mocked `app.getPath('home')` returns, return a real `os.tmpdir()` subdir per test.
- [ ] Add or reuse `tests/_helpers/tempPaths.ts` if more than three files need the same temp-home/temp-workspace setup.
- [ ] Re-grep `tests/` for `'/home`, `'/tmp`, `'/Users`, `'~/`, and unquoted `/home`, `/tmp`, `/Users`, `~/` after edits. Every remaining hit must have a nearby comment explaining why it is string-only or Linux-only.
- [ ] Where a fixture genuinely requires Linux-only path semantics, gate the test with `it.skipIf(process.platform === 'win32')` and add an inline comment explaining why.
- [ ] Confirm `npm run test` still passes on Linux after the changes.

**Out of Scope:**
- Adding new tests.
- Refactoring test helpers beyond what's needed to remove the path literals.
- Fixing the Windows-only product bugs the tests now expose (those are later phases).

**Files to Modify:**
- Every test file surfaced by the audit whose path literal is a filesystem/mock path. Do not assume the known list above is exhaustive.

**New Files:**
- `tests/_helpers/tempPaths.ts` — create if more than three test files would otherwise duplicate the same `os.tmpdir()` setup. Skip if a one-line per-file change suffices.

**Context Files to Read:**
- `src/main/sessionHistory.ts` — what `sessionHistory.test.ts` and `.regression.test.ts` exercise.
- `src/main/harnessCatalog.ts` — what `harnessCatalog.electron.test.ts` exercises.

---

#### Phase 1 — Cross-platform harness wrapper + shell/PATH defaults

**Purpose:** Fix the POSIX-only assumptions blocking any harness launch on Windows: the shell wrapper, default-shell detection, the hardcoded `:` PATH separator, and Unix path defaults in UI/copy.

**Scope:**
- [ ] In `src/main/harnessLaunch.ts`: branch on `process.platform`. On Windows, choose strategy by this rule: if PATH prepend/shell handoff is required for correct behavior, emit a `.cmd` wrapper; if the harness binary can run directly without PATH mutation, invoke it directly and skip wrapper generation. Document the choice in a code comment.
- [ ] Update both `buildHarnessWrapperScript` and `ensureHarnessWrapperScript` in `src/main/harnessLaunch.ts` together so Windows does not write a POSIX `.sh` wrapper by mistake.
- [ ] In `src/main/ipc/sessionIpc.ts:44`: replace `process.env.SHELL ?? 'bash'` with the same `process.platform === 'win32' ? 'powershell.exe' : ...` branch already used in `terminalIpc.ts`. Extract a single helper if both sites would otherwise diverge again.
- [ ] In `src/main/sessionHistory.ts` (~line 175): replace the hardcoded `:` PATH join with `path.delimiter`.
- [ ] In `src/main/harnessLaunch.ts`: stop hardcoding `~/.local/bin` and `/bin/bash` on Windows. If the Windows path drops the wrapper entirely, this becomes a no-op there; otherwise compute defaults from `os.homedir()` and a platform-aware fallback shell.
- [ ] **Verify-only:** Re-grep the renderer for any user-facing `/home/...` copy. The current snapshot has none (`grep -rn '/home/' src/renderer/` returns empty), and the workspace base directory comes from store via `src/main/ipc/settingsIpc.ts:65` (`defaultPath: currentBase`) — already platform-neutral. Document this verification in the phase commit message; do not invent UI changes if there is nothing to fix.
- [ ] Add unit tests covering the platform branches (mock `process.platform`) for the new wrapper logic and shared `defaultShell` helper, if extracted.

**Out of Scope:**
- node-pty / ConPTY validation (Phase 2).
- Path normalization across IPC for explorer/watcher (Phase 3).
- Removing the wrapper script entirely on Linux.
- Renderer UI copy edits — confirmed not needed.

**Files to Modify:**
- `src/main/harnessLaunch.ts`
- `src/main/ipc/sessionIpc.ts`
- `src/main/sessionHistory.ts`
- `src/main/ipc/terminalIpc.ts` — only if extracting a shared `defaultShell()` helper (preferred: extract once, use in both call sites).

**New Files:**
- `src/main/platformShell.ts` (or similar) — single source of truth for default shell + PATH defaults. Create this if both call sites would otherwise duplicate the platform branch.

**Context Files to Read:**
- `src/main/ipc/terminalIpc.ts` — existing `process.platform === 'win32'` branch to mirror.
- `src/main/harnessCatalog.ts` — existing `path.delimiter` usage.
- `AGENTS.md` — main/renderer separation rule (renderer must not import `os`).

---

#### Phase 2 — node-pty / ConPTY validation on real Windows

**Purpose:** Confirm the terminal actually works on Windows: node-pty rebuilds for the Electron ABI, ConPTY path is taken on Win10 1809+, color and key handling are correct in PowerShell.

**Scope:**
- [ ] Run `npm run build` and `npm run start` on a Windows 10/11 host or VM.
- [ ] Open a terminal pane; verify PowerShell launches via ConPTY (not winpty).
- [ ] Smoke-test: arrow keys, Ctrl+C, resize, 256-color output (`Get-ChildItem`-style), Unicode rendering.
- [ ] Verify `TERM=xterm-256color` does not break PowerShell rendering; if it does, branch the env in `sessionIpc.ts` / `terminalIpc.ts` to a more appropriate value on Windows.
- [ ] Smoke-test harness launch (Claude or Codex) end-to-end through the wrapper from Phase 1.
- [ ] Document any `electron-rebuild` / native-module steps needed in `docs/` or AGENTS.md.

**Out of Scope:**
- Code changes beyond fixing whatever Phase 2 smoke uncovers in node-pty config or env vars.
- Performance tuning.
- Cmd.exe support tuning (PowerShell is the documented default).

**Files to Modify:**
- `src/main/ipc/ptySpawn.ts` — only if smoke shows config bugs.
- `src/main/ipc/terminalIpc.ts` / `src/main/ipc/sessionIpc.ts` — only if `TERM` / `COLORTERM` need platform branching.
- `AGENTS.md` or `docs/windows.md` — capture native-rebuild steps.

**New Files:**
- Possibly `docs/windows.md` for QA notes.

**Context Files to Read:**
- `src/main/ipc/ptySpawn.ts`
- `src/main/ipc/terminalIpc.ts`
- `src/main/ipc/sessionIpc.ts` (env block, lines ~48–57)
- node-pty release notes for Windows ConPTY behavior on the version pinned in `package.json` (`node-pty: ^1.0.0`).

---

#### Phase 3 — Canonical path normalization at IPC boundary

**Purpose:** Pick POSIX `/` as the canonical form for paths crossing main↔renderer, and normalize at every entry/exit point. Eliminates the silent string-equality drift that breaks tabs, watcher matching, selection state, and drag-drop on Windows.

**Scope:**
- [ ] Define the rule in `AGENTS.md` under "Maintainability": "All paths crossing IPC use POSIX separators. Main converts on entry, converts back to native at the fs call. Renderer assumes POSIX everywhere."
- [ ] Create `src/shared/pathNormalize.ts` exporting `toPosixPath(p)` and `toNativePath(p, platform?)`. This shared module must be renderer-safe: pure string transforms only; no Node `path`, `os`, `fs`, or direct main-process imports. Main-side code may wrap these helpers with Node `path` validation where needed.
- [ ] Audit every `ipcMain.handle` site whose payload contains a path; convert incoming paths to native at the boundary before fs/git/process calls, convert outgoing paths to POSIX before returning to the renderer. Existing IPC modules to audit include: `src/main/ipc/fileIpc.ts`, `src/main/ipc/sessionIpc.ts`, `src/main/ipc/terminalIpc.ts`, `src/main/ipc/settingsIpc.ts`, `src/main/ipc/gitIpc.ts`, `src/main/ipc/vcsIpc.ts`, `src/main/ipc/aiCommitIpc.ts`, and any other `src/main/ipc/*.ts` handler that accepts or returns workspace/file paths.
- [ ] Audit every `Map`/`Set` whose keys are paths. Known sites:
  - `src/renderer/lib/editorFileWatcher.ts:37` — `getOwnerKey` returns `${target.workspaceId}:${target.filePath}`.
  - `src/renderer/components/FileExplorer/FileTree.tsx:34–35,318–319` — `Map<string, GitStatus>` and `Set<string>` keyed by relative path.
  - `src/renderer/components/FileExplorer/index.tsx:93` — refresh-timer Map keyed by path.
  - `src/main/fileWatcher.ts` — `watchers`, `recentlyWritten`, `debounceTimers`, `rewatchTimers`, `rewatchAttempts` all keyed by `filePath`.
- [ ] Add unit tests for the normalizers (round-trip `C:\foo\bar` ↔ `C:/foo/bar`, UNC `\\server\share\x` ↔ `//server/share/x`, and POSIX paths unchanged).

**Out of Scope:**
- Case-insensitive keying (covered by Phase 8c — `F3` in the gap analysis).
- File-mutation behavior (Phase 4).
- Renaming the `pathUtils.ts` module.
- Touching the existing `getSafeWorkspacePath` in `src/main/main.ts:158` — leave its contract alone; just feed it native paths.

**Files to Modify:**
- `src/renderer/lib/pathUtils.ts` — re-export from `src/shared/pathNormalize.ts` if it currently has its own normalizer; otherwise add the import.
- `src/renderer/lib/editorFileWatcher.ts` — owner-key generation.
- `src/main/fileService.ts` — IPC entry/exit conversions (paths in/out of `FileOperationResult`).
- `src/main/fileWatcher.ts` — Map keys.
- `src/main/explorerWatcher.ts` — event-emit paths.
- `src/main/ipc/fileIpc.ts`, `src/main/ipc/sessionIpc.ts`, `src/main/ipc/terminalIpc.ts`, `src/main/ipc/settingsIpc.ts`, `src/main/ipc/gitIpc.ts`, `src/main/ipc/vcsIpc.ts`, `src/main/ipc/aiCommitIpc.ts` — boundary conversions for path-bearing handlers.
- `AGENTS.md` — add the canonical-path-form rule under the "Maintainability" section.

**New Files:**
- `src/shared/pathNormalize.ts` — single source of truth for renderer-safe `toPosixPath` / `toNativePath` pure string helpers.

**Context Files to Read:**
- `AGENTS.md` — Maintainability rules (lines 33–41).
- `src/renderer/lib/pathUtils.ts` — existing renderer-side helper.
- `src/main/main.ts` — `getSafeWorkspacePath` reference implementation (validation already happens in main).

---

#### Phase 4 — Cross-drive rename + open-file mutation

**Purpose:** Stop generic-permission errors when the user moves/renames/deletes files on Windows. Handle `EXDEV` (cross-drive) and `EBUSY`/`EPERM` (file held open by editor).

**Scope:**
- [ ] In `src/main/fileService.ts:533` (rename/move): catch `EXDEV` from `fs.rename` and fall back to `fs.cp` + `fs.rm` (or `fs.copyFile` + `fs.unlink` for files). Preserve the existing realpath / inside-workspace validation. Do not add `EXDEV` handling to delete unless a real failing delete path is found; `EXDEV` is a rename/move error.
- [ ] On `EBUSY` / `EPERM` from rename/delete: surface a structured error code (e.g., `FILE_IN_USE`) so the renderer can show "File is open in an editor" instead of a generic permission error.
- [ ] In `src/main/fileWatcher.ts`: add a `releaseHandle(filePath)` method that closes the active `FSWatcher` for a given path before main-side mutation, then re-establishes after success. Without this, the editor's own watch handle is the most likely cause of `EBUSY` on Windows.
- [ ] Coordinate with `src/renderer/lib/editorFileWatcher.ts`: before triggering rename/delete via IPC, signal the editor to release the file (call `editorUnwatchFile`); on `FILE_IN_USE`, prompt the user to close the tab and retry.
- [ ] Add unit tests that mock `fs.rename` to throw `EXDEV` and rename/delete operations to throw `EBUSY`/`EPERM`; assert correct fallback / error mapping. Add a test that `releaseHandle` is called on the active watcher before mutation.

**Out of Scope:**
- Atomic-save watcher tuning (Phase 5).
- Trash-on-delete (Phase 8a).
- Generic refactor of `fileService.ts`.
- Replacing `fs.watch` in `fileWatcher.ts` (Phase 5 verifies Windows behavior; this phase only adds release/reacquire).

**Files to Modify:**
- `src/main/fileService.ts`
- `src/main/fileWatcher.ts`
- `src/renderer/lib/editorFileWatcher.ts` — call unwatch before rename/delete.
- The renderer error-handling site that displays file-op errors (audit via `grep -rn "FileOperationResult\|operation.error" src/renderer/`).
- `src/shared/types/*` if a new error code shape is added.

**New Files:**
- None expected.

**Context Files to Read:**
- `src/main/fileService.ts` — rename/delete sites at 489, 503, 533, plus the atomic-write rename at 355.
- `src/main/fileWatcher.ts` — `FSWatcher` lifecycle (lines ~106–180).
- `src/renderer/lib/editorFileWatcher.ts` — orchestration only; talks to main via `editorWatchFile` / `editorUnwatchFile`.

---

#### Phase 5 — Reserved-name validation + atomic-save watcher tuning

**Purpose:** Prevent cryptic Windows errors when users create files named `CON`, `NUL`, `foo.`, etc., and stop the explorer/editor flicker that happens when atomic-save writes are seen as `unlink + add` on Windows.

**Repo-truth notes for this phase:**

- `src/main/explorerWatcher.ts` already enables `awaitWriteFinish: { stabilityThreshold: 100 }` at line 156. Phase 5 is about *tuning* (add a `pollInterval`, possibly raise the threshold on Windows) and adding the unlink+add collapse, not enabling from scratch.
- `src/renderer/lib/editorFileWatcher.ts` does NOT use chokidar — it only orchestrates watch/unwatch via IPC. The actual watcher is `src/main/fileWatcher.ts`, which uses **raw `fs.watch`** (one watcher per file) with rewatch-on-rename logic. Atomic-save tuning lands there, not in the renderer file.
- `src/renderer/components/FileExplorer/FileTree.tsx` defines `CreateInput` (line numbers may drift; locate by symbol name).

**Scope:**
- [ ] Create `src/shared/filenameValidation.ts` exporting `validateFilename(name)` — rejects reserved device basenames with or without extensions (`CON`, `CON.txt`, `PRN`, `AUX`, `NUL`, `COM1–9`, `LPT1–9`), trailing `.` / space, characters `< > : " / \ | ? *`, names longer than 255 bytes UTF-8, and empty names.
- [ ] Wire the validator into `src/renderer/components/FileExplorer/FileTree.tsx` `CreateInput` — show inline error before submit. Run on all platforms (cross-platform safety).
- [ ] Also enforce in `src/main/fileService.ts` create/rename handlers as a defense-in-depth check before the fs call.
- [ ] In `src/main/explorerWatcher.ts`: tune the existing `awaitWriteFinish` block — keep stabilityThreshold at 100 on Linux/macOS, raise to 200 on Windows; add `pollInterval: 100`. Add an unlink+add collapse: when a path emits `unlink` followed by `add` within 300ms, emit a single `change` event to subscribers.
- [ ] In `src/main/fileWatcher.ts`: review the existing rewatch-on-rename path (line ~106 onward) under Windows semantics. On Windows, atomic-save typically delivers a `rename` event for the temp→target rename; confirm the existing rewatch handles it without flapping. Add a Windows-specific test if behavior diverges.
- [ ] Add unit tests for the filename validator and for the unlink+add collapse.

**Out of Scope:**
- Polling fallback for network shares / UNC (Phase 8b — `F7`).
- Case-insensitive keying (Phase 8c — `F3`).
- File-locking behavior on rename/delete (Phase 4).
- Replacing raw `fs.watch` in `fileWatcher.ts` with chokidar — out of scope; only verify Windows behavior.

**Files to Modify:**
- `src/renderer/components/FileExplorer/FileTree.tsx`
- `src/main/explorerWatcher.ts`
- `src/main/fileWatcher.ts`
- `src/main/fileService.ts` (defense-in-depth filename check at create/rename)

**New Files:**
- `src/shared/filenameValidation.ts` — reserved-name + character validator (shared so main and renderer both use it).

**Context Files to Read:**
- `src/renderer/components/FileExplorer/FileTree.tsx` — `CreateInput` component.
- `src/main/explorerWatcher.ts` — chokidar config at line 147–160.
- `src/main/fileWatcher.ts` — raw `fs.watch` + rewatch logic.
- Microsoft "Naming Files, Paths, and Namespaces" docs for the canonical reserved-name list.

---

#### Phase 6 — Credential / SSH permission policy on Windows

**Purpose:** Decide and document how the security intent behind `mkdirSync({ mode: 0o700 })` and `chmodSync(..., 0o600)` is achieved on Windows, where those modes are no-ops.

**Scope:**
- [ ] Pick one of: (a) set Windows ACLs to current-user-only via `icacls` shelled out post-create; (b) accept inherited NTFS perms from `%USERPROFILE%\.ssh` and rely on user-profile defaults; (c) warn the user on first SSH-key creation and link to MS docs. Document the choice in `AGENTS.md` and in a code comment near the calls.
- [ ] At minimum, gate `chmodSync` / `mkdirSync({ mode })` calls on `process.platform !== 'win32'` to silence the no-op intent.
- [ ] Verify `process.env.HOME || process.env.USERPROFILE` resolves to a sensible `.ssh` parent on Windows in `credentialService.ts`; add a fallback if `HOME` is set by tooling to a path that doesn't contain `.ssh`.
- [ ] Add a smoke-test (manual or scripted) that creates an SSH key on Windows and confirms permissions match the chosen policy.

**Out of Scope:**
- Migrating credential storage off `safeStorage` / DPAPI.
- New credential UI flows.

**Files to Modify:**
- `src/main/credential/sshKeyService.ts`
- `src/main/credential/credentialService.ts`
- `AGENTS.md` — security policy note.

**New Files:**
- Possibly `src/main/credential/windowsAcl.ts` if option (a) is chosen.

**Context Files to Read:**
- `src/main/credential/sshKeyService.ts`
- `src/main/credential/credentialService.ts`

---

#### Phase 7 — Husky pre-commit on Windows

**Purpose:** Make the pre-commit hook usable on a Windows dev machine without forcing every contributor onto Git Bash without warning.

**Scope:**
- [ ] Document the Git-for-Windows requirement in `README.md` / `AGENTS.md`. Note that the husky shim relies on the `sh` provided by Git for Windows.
- [ ] If documenting alone is insufficient, replace the body of `.husky/pre-commit` with a Node entrypoint (`node scripts/pre-commit.mjs`) that runs cross-platform and skips the shell shim entirely.
- [ ] Verify hook execution on Windows with both Git Bash and PowerShell `git commit` flows.

**Out of Scope:**
- Adding new hooks (commit-msg, pre-push, etc.).
- Changing what the pre-commit checks.

**Files to Modify:**
- `.husky/pre-commit`
- `README.md` — Windows dev-setup section.
- `AGENTS.md` — note Git-for-Windows requirement if option (a).

**New Files:**
- Possibly `scripts/pre-commit.mjs` if option (b).

**Context Files to Read:**
- `.husky/pre-commit`

---

#### Phase 8a — Delete safety + CRLF preservation

**Purpose:** Make destructive file operations safer and preserve user line endings on save.

**Scope:**
- [ ] **F8 — Trash on delete:** Replace hard delete in `src/main/fileService.ts` with Electron `shell.trashItem` where possible. Preserve a deliberate fallback only if `trashItem` is unavailable or fails with a documented, user-visible error.
- [ ] Keep existing workspace-boundary validation before trashing paths.
- [ ] **F13 — CRLF on save:** Preserve original line endings on read → edit → write round-trips. Default policy: detect line endings when reading a file and write back using the original convention unless the user explicitly changes content to another convention.
- [ ] Add tests that a CRLF file remains CRLF after save and an LF file remains LF after save.
- [ ] For CRLF tests, create fixtures with explicit `\r\n` bytes in test setup (e.g., direct `fs.writeFileSync`) rather than relying on checkout line endings.

**Out of Scope:**
- UNC/network-share watcher polling (Phase 8b).
- Case-insensitive path keying (Phase 8c).
- Delete-confirmation UX redesign.

**Files to Modify:**
- `src/main/fileService.ts`
- Shared/editor types if read responses need line-ending metadata.
- Renderer editor save path if it currently discards line-ending metadata.

**New Files:**
- None expected.

**Context Files to Read:**
- `src/main/fileService.ts`
- Electron docs for `shell.trashItem`.
- Editor read/write flow in renderer components/lib.

---

#### Phase 8b — UNC / drive-letter / polling / long-path handling

**Purpose:** Make Windows-shaped workspace paths and unreliable watcher backends behave predictably without overreaching into unrelated file-operation work.

**Scope:**
- [ ] **F7 — Polling fallback:** Add a setting or internal option to enable chokidar `usePolling: true`; auto-detect UNC paths (`\\server\share`) on Windows and force polling for those.
- [ ] **F9 — Long paths:** Document the Windows long-path-support requirement (group policy / registry key). Audit `fs` calls in `fileService.ts` for any that demonstrably need a `\\?\` prefix; add targeted prefixes only with tests or documented reproduction. Prefer documentation/audit over blanket prefixing.
- [ ] **F10 — Drive letters / UNC in workspace gate:** `src/main/security.ts:31` (`resolveExistingDirectory`) already uses `path.resolve` which handles `C:\…` and UNC inputs. Audit `src/renderer/components/WorkspaceGateContent.tsx` for any client-side input regex that would reject Windows-shaped paths, then verify the string round-trips through the Phase 3 normalizer when echoed back to the UI.
- [ ] **F11 — Drag-and-drop from OS:** Smoke-test that dropped paths from Explorer arrive correctly and are normalized through Phase 3 helpers.
- [ ] Add unit tests for UNC/drive-letter path classification if helper logic is introduced.

**Out of Scope:**
- Trash/delete behavior (Phase 8a).
- Case-insensitive keying (Phase 8c).
- Code signing or installer work (Phase 9).

**Files to Modify:**
- `src/main/explorerWatcher.ts`
- `src/renderer/components/WorkspaceGateContent.tsx`
- `src/main/fileService.ts` only for targeted long-path fixes justified by audit.
- `README.md` / `docs/windows.md` for long-path notes.

**New Files:**
- Possibly `src/shared/pathClassify.ts` for UNC/drive-letter detection.

**Context Files to Read:**
- `src/main/security.ts`
- `src/main/explorerWatcher.ts`
- `src/renderer/components/WorkspaceGateContent.tsx`
- Microsoft Windows long-path documentation.

---

#### Phase 8c — Case-insensitive path keying + case-only rename

**Purpose:** Prevent duplicate tabs/watchers/selections for the same Windows path while preserving display casing.

**Scope:**
- [ ] **F3 — Case-insensitive keying:** Add a single helper for path map keys. On Windows, key by normalized lowercase POSIX path; on case-sensitive platforms, preserve current behavior. Display/original path casing must be preserved in state and UI.
- [ ] Apply the helper to known path-keyed Maps/Sets from Phase 3: editor watcher owner keys, FileExplorer git-status/selection keys, refresh-timer keys, and main `fileWatcher.ts` maps.
- [ ] Implement case-only rename handling on Windows using a two-step rename through a temporary sibling name when needed.
- [ ] Add unit tests for `Foo.txt` vs `foo.txt` key equality on Windows and distinctness on Linux/macOS, plus a case-only rename test.

**Out of Scope:**
- POSIX separator normalization itself (Phase 3).
- Cross-drive rename fallback (Phase 4).
- Watcher atomic-save collapse (Phase 5).

**Files to Modify:**
- `src/renderer/lib/editorFileWatcher.ts`
- `src/renderer/components/FileExplorer/FileTree.tsx`
- `src/renderer/components/FileExplorer/index.tsx`
- `src/main/fileWatcher.ts`
- `src/main/fileService.ts`
- Shared path helper module from Phase 3 or a new small shared helper.

**New Files:**
- Possibly `src/shared/pathKey.ts` if keying logic does not belong in `pathNormalize.ts`.

**Context Files to Read:**
- All path-keyed Map/Set audit notes from Phase 3.
- `src/main/fileService.ts` rename implementation from Phase 4.

---

#### Phase 8d — Verify-only Windows polish sweep

**Purpose:** Close the remaining low-risk verification items from the gap analysis and document expected Windows contributor/user settings.

**Scope:**
- [ ] **Item 10 — Git autocrlf:** Verify diffs/blames parse correctly when Windows checks out files with CRLF; document recommended contributor setting `core.autocrlf=input` unless the team chooses a different policy.
- [ ] **Item 12 — `.ssh` lookup:** Confirm Phase 6 covered Windows `.ssh` parent resolution; document result.
- [ ] **Item 14 — App data:** Verify `app.getPath('userData')` resolves under `%APPDATA%\Clanker Grid` and `electron-store` round-trips. No code change expected unless verification fails.
- [ ] **F12 — `fs.watch` semantics:** Confirm Phase 5's raw `fs.watch` verification was run and documented.
- [ ] Update `docs/windows.md` or `README.md` with any final Windows-specific notes gathered in Phases 2, 6, 8a, 8b, and 8c.

**Out of Scope:**
- New feature work.
- Installer artifact creation or publishing (Phase 9).
- Code signing.

**Files to Modify:**
- `README.md` / `docs/windows.md` only, unless a verification item fails and requires a small targeted fix.

**New Files:**
- `docs/windows.md` if it does not already exist and Windows notes would otherwise clutter `README.md`.

**Context Files to Read:**
- `plans/windows-build-gap-analysis.md` items 10, 12, 14, F12.
- Docs/notes produced by earlier phases.

---

#### Phase 9 — Linux AppImage + unsigned NSIS/portable release smoke and v0.1 prep

**Purpose:** Produce the existing Linux AppImage plus the new unsigned Windows installer (NSIS + portable), smoke-test them on clean hosts, flip the in-repo Windows CI gate, and prepare publishable v0.1 artifacts. Publishing/tagging only happens if the executor has explicit release authority and required credentials.

**Scope:**
- [ ] Run `npm run build:dist` on Linux and confirm the Linux AppImage artifact still builds successfully.
- [ ] Run `npm run build:dist` on `windows-latest` (or a clean Windows host) and confirm both NSIS installer and portable executable build successfully.
- [ ] Smoke-test the Linux AppImage on a clean/current Linux desktop or VM: app launches, terminal works, harness launches, file explorer works.
- [ ] Install via NSIS on a clean Windows VM; confirm app launches, terminal works, harness launches, file explorer works, credentials persist across restart.
- [ ] Confirm `app.getPath('userData')` resolves to `%APPDATA%\Clanker Grid` and survives upgrade.
- [ ] Document the SmartScreen warning behavior in `README.md` (expected for unsigned NSIS; users click "More info → Run anyway").
- [ ] Flip the Windows CI job from `continue-on-error: true` to required in workflow configuration. This is the implementation of the gate decision made earlier in the rollout; perform the actual workflow edit here. If branch protection is used, list the separate GitHub settings change a maintainer must perform.
- [ ] Prepare release notes and artifact checksums for v0.1 Windows. Tag/publish only when explicitly authorized; otherwise leave clear manual publish instructions.

**Out of Scope:**
- Code signing (separate v0.2 plan).
- Auto-update infrastructure.
- Publishing without maintainer approval/credentials.

**Files to Modify:**
- `.github/workflows/validate.yml` — flip Windows job to required in workflow configuration.
- `README.md` — Windows install instructions + SmartScreen note.
- `package.json` build config only if the artifact build surfaces issues.

**New Files:**
- Release notes / checksum file for v0.1 Linux + Windows artifacts, if the repo stores release notes in-tree.

**Context Files to Read:**
- `package.json` (build.linux, build.win, build.nsis sections).
- All previously modified files for regression awareness.

---

## File Structure

Legend: ✅ exists, 🔧 modify, 🆕 new

```
.github/
└── workflows/
    └── validate.yml                                 🔧 (Prereq, Phase 9)

.husky/
└── pre-commit                                       🔧 (Phase 7)

scripts/
└── pre-commit.mjs                                   🆕 (Phase 7, optional)

src/
├── shared/
│   ├── pathNormalize.ts                             🆕 (Phase 3)
│   ├── filenameValidation.ts                        🆕 (Phase 5)
│   ├── pathClassify.ts                              🆕 (Phase 8b, optional)
│   └── pathKey.ts                                   🆕 (Phase 8c, optional)
├── main/
│   ├── harnessLaunch.ts                             🔧 (Phase 1)
│   ├── sessionHistory.ts                            🔧 (Phase 1)
│   ├── fileService.ts                               🔧 (Phases 3, 4, 5, 8a, 8b, 8c)
│   ├── fileWatcher.ts                               🔧 (Phases 3, 4, 5, 8c)
│   ├── explorerWatcher.ts                           🔧 (Phases 3, 5, 8b)
│   ├── platformShell.ts                             🆕 (Phase 1, conditional)
│   ├── credential/
│   │   ├── sshKeyService.ts                         🔧 (Phase 6)
│   │   ├── credentialService.ts                     🔧 (Phase 6)
│   │   └── windowsAcl.ts                            🆕 (Phase 6, conditional on policy)
│   └── ipc/
│       ├── fileIpc.ts                               🔧 (Phase 3)
│       ├── sessionIpc.ts                            🔧 (Phases 1, 3)
│       ├── terminalIpc.ts                           🔧 (Phases 1, 3)
│       ├── settingsIpc.ts                           🔧 (Phase 3)
│       ├── gitIpc.ts                                🔧 (Phase 3)
│       ├── vcsIpc.ts                                🔧 (Phase 3)
│       ├── aiCommitIpc.ts                           🔧 (Phase 3)
│       └── ptySpawn.ts                              🔧 (Phase 2, conditional)
├── renderer/
│   ├── lib/
│   │   ├── pathUtils.ts                             🔧 (Phase 3)
│   │   └── editorFileWatcher.ts                     🔧 (Phases 3, 4)
│   └── components/
│       ├── WorkspaceGateContent.tsx                 🔧 (Phase 8b — drive letters / UNC only)
│       └── FileExplorer/
│           ├── index.tsx                            🔧 (Phase 3 — Map keys)
│           └── FileTree.tsx                         🔧 (Phases 3, 5, 8c)
└── ...

tests/
└── ...                                              🔧 (Phase 0 audit decides exact files; do not assume the abbreviated list is exhaustive)

docs/
└── windows.md                                       🆕 (Phases 2, 8b, 8d, optional)

AGENTS.md                                            🔧 (Phases 3, 6, 7)
README.md                                            🔧 (Phases 7, 8b, 8d, 9)
```

---

## New Dependencies

| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| (none expected) | — | All needed primitives are already present (chokidar, node-pty, electron, electron-builder). | — |

If Phase 6 takes ACL approach (a), it will shell out to `icacls.exe` (built-in) — no new dep.

---

## Testing Strategy

### Unit Tests

- [ ] **Phase 0:** Existing tests run green on both Linux and Windows after path-literal removal.
- [ ] **Phase 1:** Mock `process.platform` to test wrapper-script generation, default-shell selection, PATH delimiter.
- [ ] **Phase 3:** Round-trip tests for `toPosixPath`/`toNativePath` on Windows-style and POSIX inputs.
- [ ] **Phase 4:** Mock `fs.rename` to throw `EXDEV` and `EBUSY`; assert fallback behavior and error-code mapping.
- [ ] **Phase 5:** Filename validator tests (reserved names, trailing dot/space, illegal chars). Watcher unlink+add collapse test.
- [ ] **Phase 6:** SSH-key permission-application unit test (gated by platform if needed).
- [ ] **Phase 8a:** CRLF/LF preservation tests and trash fallback/error tests.
- [ ] **Phase 8b:** UNC/drive-letter classification tests if helper logic is introduced.
- [ ] **Phase 8c:** Case-insensitive path-key tests and case-only rename test.

### Integration Tests

- [ ] **Phase 0:** Vitest suite passes on `windows-latest` CI.
- [ ] **Phase 4:** End-to-end rename across drives in a temp dir on Windows CI.
- [ ] **Phase 5:** End-to-end create-with-reserved-name → expect inline error.
- [ ] **Phase 8a:** End-to-end delete routes to trash where Electron supports it.
- [ ] **Phase 8b:** Workspace gate accepts `C:\...` and UNC-style inputs on Windows CI/manual host.

### Smoke Tests (Manual on Windows host)

- [ ] **Phase 2:** Terminal in PowerShell — keys, colors, resize, Unicode.
- [ ] **Phase 2:** Harness launch end-to-end (Claude or Codex) through the wrapper.
- [ ] **Phase 6:** SSH key generation produces correctly permissioned key files.
- [ ] **Phase 8d:** App data / electron-store smoke on Windows host.
- [ ] **Phase 9:** Linux AppImage launch smoke on a clean/current Linux desktop or VM.
- [ ] **Phase 9:** NSIS installer install/launch/uninstall on clean Win10 and Win11 VMs.

---

## Rollout Plan

| Phase | Scope | Verification |
|-------|-------|--------------|
| Prereq | CI matrix added | `windows-latest` job appears (red allowed). |
| 0 | Tests platform-neutral | `npm run test` passes on Linux; Windows CI failures shrink to product issues. |
| 1 | Harness wrapper + shell defaults | Unit tests cover both platform branches; harness launch survives Linux regression. |
| 2 | node-pty / ConPTY | Manual smoke on Windows 10 + 11 hosts. |
| 3 | Path normalization | Round-trip tests; tabs/watcher don't ghost on Windows. |
| 4 | File mutations | Cross-drive rename works; open-file errors are user-friendly. |
| 5 | Reserved names + atomic-save | No cryptic name errors; no editor flicker on save. CI gate decision is finalized here. |
| 6 | Credential perms | Documented policy + applied in code. |
| 7 | Husky | Pre-commit fires on Windows dev box. |
| 8a | Delete safety + CRLF | Trash works; CRLF/LF preserved on round-trip. |
| 8b | UNC / drive / polling / long paths | UNC and drive-letter workspaces accepted; polling fallback documented/testable. |
| 8c | Case-insensitive keying | Duplicate Windows path keys prevented; case-only rename works. |
| 8d | Verify-only polish | Remaining Windows contributor/user notes documented. |
| 9 | Release prep | Linux AppImage + unsigned NSIS + portable artifacts built and smoke-tested; Windows `continue-on-error` removed in workflow; publish instructions or authorized release complete. |

---

## Related Documents

- `plans/windows-build-gap-analysis.md` — source-of-truth gap doc this plan implements.
- `AGENTS.md` — architecture principles (main/renderer separation, validation rules).
- `~/.pi/agent/skills/planning/SKILL.md` — planning skill used to author this plan.

---

## Checklist

### Phase Prereq
- [ ] `windows-latest` added to validate.yml matrix
- [ ] Linux-only steps gated on `matrix.os`
- [ ] CI run produces a Windows job (red OK)

### Phase 0
- [ ] `rg -n "(/home|/tmp|/Users|~/)" tests` audit completed
- [ ] Every remaining Unix-path literal in `tests/` has a nearby string-only or Linux-only comment
- [ ] `npm run test` green on Linux

### Phase 1
- [ ] `harnessLaunch.ts` emits Windows-appropriate wrapper or skips wrapper
- [ ] `sessionIpc.ts:44` default-shell branches on `process.platform`
- [ ] `sessionHistory.ts:175` uses `path.delimiter`
- [ ] Verified: no `/home/` literals in renderer (`grep -rn '/home/' src/renderer/` returns empty)
- [ ] Unit tests cover both platform branches

### Phase 2
- [ ] PowerShell terminal smoke OK on Win10
- [ ] PowerShell terminal smoke OK on Win11
- [ ] Harness launch end-to-end OK on Windows
- [ ] Native-rebuild steps documented

### Phase 3
- [ ] `toPosixPath` / `toNativePath` helpers exist in `src/shared/`
- [ ] All IPC path entry/exit normalized
- [ ] Path-keyed Map/Set audit complete
- [ ] AGENTS.md rule added

### Phase 4
- [ ] `EXDEV` fallback in `fileService.ts` rename/move path
- [ ] `EBUSY`/`EPERM` mapped to structured `FILE_IN_USE` error in renderer
- [ ] `fileWatcher.ts` exposes `releaseHandle(filePath)` and editor calls `editorUnwatchFile` before rename/delete

### Phase 5
- [ ] `src/shared/filenameValidation.ts` exists and is enforced in renderer (`FileTree.CreateInput`) and main (`fileService` create/rename)
- [ ] `explorerWatcher.ts` `awaitWriteFinish` tuned (Linux/macOS 100ms, Windows 200ms) + `pollInterval` set
- [ ] unlink+add collapse implemented in `explorerWatcher.ts`
- [ ] `fileWatcher.ts` rewatch-on-rename verified on Windows (no flapping)

### Phase 6
- [ ] Permission policy chosen + documented
- [ ] `chmodSync`/`mkdirSync({ mode })` gated to non-Windows
- [ ] `.ssh` parent dir resolves on Windows

### Phase 7
- [ ] Git-for-Windows documented OR Node entrypoint replacement
- [ ] Pre-commit verified on Windows

### Phase 8a
- [ ] `shell.trashItem` used for delete path with documented fallback/error behavior
- [ ] CRLF preserved on round-trip
- [ ] LF preserved on round-trip

### Phase 8b
- [ ] UNC + drive-letter accepted in workspace gate
- [ ] Polling fallback available and UNC auto-detection implemented if scoped helper is needed
- [ ] Long-path documentation complete; `\\?\` prefix added only where audit proves it is needed
- [ ] Drag-and-drop Windows path smoke documented

### Phase 8c
- [ ] Case-insensitive path keying on Windows
- [ ] Display/original path casing preserved
- [ ] Case-only rename handled on Windows

### Phase 8d
- [ ] Git autocrlf recommendation documented
- [ ] `.ssh` lookup result from Phase 6 documented
- [ ] App data / electron-store Windows smoke documented
- [ ] Raw `fs.watch` verification result from Phase 5 documented

### Phase 9
- [ ] Linux AppImage builds
- [ ] Linux AppImage smoke OK
- [ ] NSIS installer builds
- [ ] Portable executable builds
- [ ] Windows clean-VM install/uninstall smoke OK
- [ ] CI Windows job flipped to required in workflow configuration
- [ ] Branch-protection settings change documented if applicable
- [ ] v0.1 release notes/checksums prepared for Linux AppImage, Windows NSIS, and Windows portable artifacts
- [ ] v0.1 tagged and published only if explicitly authorized

### Verification (run before each phase commit)
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `npm run test` passes
- [ ] (Where applicable) Windows CI job stays green or improves

---

## Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.4 | 2026-04-28 | Pi | Added Phase 9 verification follow-up progress note documenting the Windows CI/test-alignment pass and local `npm run validate` success. |
| 1.3 | 2026-04-28 | Pi | Incorporated review clarifications: explicit CI matrix restructure note, concrete Phase 1 wrapper selection criterion including `ensureHarnessWrapperScript`, CRLF test fixture guidance, CI gate-flip timing clarification, and minor wording cleanup. |
| 1.2 | 2026-04-28 | Pi | Final polish: made Linux AppImage preservation/release verification explicit alongside Windows NSIS + portable output. |
| 1.1 | 2026-04-28 | Pi | Addressed readiness review gaps: expanded test/path audits, completed IPC path scope, split oversized polish phase, clarified release authority and CI/build boundaries. |
| 1.0 | 2026-04-28 | Jay | Initial draft generated from `plans/windows-build-gap-analysis.md` via the `~/.pi` planning skill. |
