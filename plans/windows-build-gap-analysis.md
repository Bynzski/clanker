# Windows Build — Gap Analysis (First Pass)

**Status:** Planning only — no code changes yet.
**Scope:** High-level enumeration of areas that must be audited and addressed before a working Windows build can ship. Severities are first-pass estimates; verify each on a real Windows host before scoping work.

---

## Already in good shape

- `electron-builder` config already declares a `win` target (NSIS + portable) and `src/assets/icons/icon.ico` exists.
- Dev scripts use `cross-env` for env-var setting — no rewrite needed.
- Credential storage goes through Electron `safeStorage`, which wraps DPAPI on Windows automatically.
- Keyboard shortcut handling uses `event.metaKey || event.ctrlKey` (cross-platform).
- `harnessCatalog.ts` correctly uses `path.delimiter` when building PATH.

---

## Blockers (must fix before any Windows build is usable)

### 1. POSIX shell wrapper for harness launch
- **Where:** `src/main/harnessLaunch.ts`
- **Problem:** Generates a `#!/usr/bin/env sh` wrapper script (`set -eu`, `$HOME/.local/bin:$PATH`, `/bin/bash` fallback) used to invoke harnesses (e.g. Claude Code). Will not execute on Windows.
- **Direction:** Branch on `process.platform`; emit a `.cmd` or PowerShell wrapper on Windows, or invoke the harness binary directly without a wrapper.

### 2. CI has no Windows runner
- **Where:** `.github/workflows/validate.yml` (currently `ubuntu-latest` only)
- **Problem:** Without a Windows job we cannot detect regressions or even confirm the build succeeds.
- **Direction:** Add a `windows-latest` matrix entry running at minimum `build`, `typecheck`, and a smoke subset of tests.

---

## Likely issues (will break or silently misbehave)

### 3. Inconsistent default-shell detection
- **Where:** `src/main/ipc/sessionIpc.ts` (line ~44) defaults to `'bash'` if `SHELL` is unset; `src/main/ipc/terminalIpc.ts` already branches to `powershell.exe` on win32. Align both.

### 4. Hardcoded PATH separator
- **Where:** `src/main/sessionHistory.ts` (~line 175) uses `:` to join PATH segments. Use `path.delimiter`.

### 5. Hardcoded Unix paths in defaults / UI copy
- **Where:** `src/main/harnessLaunch.ts` (`~/.local/bin`, `/bin/bash`), `src/renderer/components/WorkspaceGateContent.tsx` (`/home/...` shown as default workspace).
- **Direction:** Compute defaults from `os.homedir()` and platform; localize UI copy.

### 6. node-pty on Windows
- **Where:** `src/main/ipc/ptySpawn.ts`, `src/main/ipc/terminalIpc.ts`
- **Problem:** node-pty on Windows requires ConPTY (Win10 1809+) or a winpty fallback. Terminal type `xterm-256color` may need adjustment for cmd.exe. Native binary must be rebuilt for the Windows Electron ABI.
- **Direction:** Verify `@electron/rebuild` covers it for Windows; confirm ConPTY path; sanity-test color/keys.

### 7. POSIX file-mode calls on credential/SSH paths
- **Where:** `src/main/credential/sshKeyService.ts`, `src/main/credential/credentialService.ts` use `mkdirSync({ mode: 0o700 })` and `chmodSync(..., 0o600)`.
- **Problem:** No-ops on Windows — the *security intent* (locking SSH keys to current user) is not enforced.
- **Direction:** Decide whether to set Windows ACLs, accept inherited NTFS permissions, or warn the user. At minimum, gate the calls on `process.platform !== 'win32'`.

### 8. Husky pre-commit hooks
- **Where:** `.husky/`
- **Problem:** Husky relies on a POSIX shell shim. Works under Git for Windows / Git Bash, fails under raw cmd/PowerShell.
- **Direction:** Document the Git-for-Windows requirement, or replace the hook body with a Node entrypoint.

### 9. Tests with hardcoded Unix paths
- **Where:** `tests/main/unit/sessionHistory.regression.test.ts`, `tests/main/unit/harnessCatalog.electron.test.ts`, likely others.
- **Problem:** `/home/jay/...` and `/tmp/test-home` literals will not exist or normalize on Windows.
- **Direction:** Replace with `os.tmpdir()` / `path.join` and platform-neutral fixtures. Required before turning on the Windows CI job.

---

## Minor / verify-only

### 10. Git binary assumptions
- `gitService.ts` shells out via `execFile('git', ...)`. Requires Git for Windows in PATH. No autocrlf handling — confirm diffs/blames still parse correctly when Windows checks out files with CRLF.

### 11. chokidar on Windows (covered in detail below)
- See the **File Explorer / Watcher / File-Mutation** section. Smoke-test on a real Windows workspace before considering this resolved.

### 12. SSH config path lookup
- `process.env.HOME || process.env.USERPROFILE` order in `credentialService.ts` is fine but worth a quick sanity check on Windows where `HOME` is sometimes set by tooling to a path that does not contain `.ssh`.

### 13. Code signing / notarization
- electron-builder is configured but no Windows code-signing certificate is wired in. SmartScreen warnings are expected for unsigned NSIS installers — decide whether to sign for first release or accept warnings.

### 14. App data / install paths
- Confirm `app.getPath('userData')` resolves under `%APPDATA%\Clanker Grid` cleanly and that `electron-store` data round-trips. No code change expected; just verify.

---

---

## File Explorer, File Watchers, and File-Mutation Paths

This area deserves its own section because Windows file semantics diverge from Linux in several ways that affect the explorer UI, the editor's open-file watcher, and any move/rename/delete flow.

### Blockers

#### F1. Cross-drive rename / move
- **Where:** `src/main/fileService.ts` (~line 533) calls `fs.rename` directly.
- **Problem:** On Windows, `fs.rename` between drives (`D:\foo` → `E:\foo`) throws `EXDEV`. The current move/rename API will fail for any drag from one drive to another with a generic error.
- **Direction:** Detect `EXDEV` and fall back to copy + unlink (or use `fs.cp` + `fs.rm`). Required before drag-and-drop between drives is usable.

### Likely issues

#### F2. Path separator drift between main and renderer
- **Where:** `src/main/fileService.ts` uses `path.join` (yields `\` on Windows); `src/renderer/lib/pathUtils.ts` normalizes to `/`. Explorer entries, watcher events, git change paths, and IDs may all carry different separators.
- **Problem:** String-equality checks, Map/Set keys, and tab-to-watcher matching will silently miss when one side has `\` and the other has `/`. Causes ghost tabs, missed reload-on-change, broken selection state.
- **Direction:** Pick one canonical form (POSIX `/`) at the IPC boundary and normalize on entry/exit. Audit every `===` and Map key that holds a path.

#### F3. Case-insensitive filesystem semantics
- **Where:** `src/renderer/lib/editorFileWatcher.ts` (~line 37, watcher key `${workspaceId}:${filePath}`) and any path-keyed Map/Set.
- **Problem:** On Windows, `Foo.txt` and `foo.txt` are the same file but distinct strings. Two tabs for the "same" file can co-exist; rename-to-different-case is a no-op string-wise but should still propagate.
- **Direction:** Decide whether to normalize case for keying on Windows (lowercased) while preserving display case. Special-case rename-only-case (use a two-step rename through a temp name).

#### F4. File locking blocks rename/delete of open files
- **Where:** `src/main/fileService.ts` rename (~533) and delete (~489) paths; the editor holds files open while a tab is active.
- **Problem:** On Windows, an open handle prevents rename/delete and `fs.rm` returns `EBUSY`/`EPERM`. Linux happily renames open files.
- **Direction:** Close editor handles before mutating; on failure, surface a "file is open" message rather than a generic permission error. Coordinate with `editorFileWatcher.ts`.

#### F5. Reserved filenames and trailing-dot/space
- **Where:** rename/create UI in `src/renderer/components/FileExplorer/FileTree.tsx` (CreateInput, ~244–305).
- **Problem:** `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, names ending in `.` or space — all rejected by Windows with cryptic errors.
- **Direction:** Add a validator (only enforced on Windows or for cross-platform safety always) and show the error inline before submit.

#### F6. Atomic-save event sequence differs
- **Where:** `src/main/explorerWatcher.ts` and `src/renderer/lib/editorFileWatcher.ts` chokidar configs.
- **Problem:** Editors that save atomically (write temp + rename) emit `add`/`unlink` on Windows where Linux emits `change`. Without `awaitWriteFinish` and idempotent handlers, the explorer flickers and the editor may show a "file deleted" state mid-save.
- **Direction:** Enable `awaitWriteFinish` on both watchers, dedupe rapid unlink+add into a single change, and treat path-equal unlink+add within a small window as a self-save.

### Minor / verify-only

#### F7. Polling fallback for network shares / mounted drives
- **Where:** `src/main/explorerWatcher.ts` (~line 151) hardcodes `usePolling: false`.
- **Problem:** `ReadDirectoryChangesW` is unreliable on SMB shares and some virtual filesystems. Watchers silently stop firing.
- **Direction:** Allow opt-in polling via setting; consider auto-detecting UNC paths (`\\server\share`) and enabling polling for those.

#### F8. Hard delete instead of trash
- **Where:** `src/main/fileService.ts` (~489) uses `fs.rm`.
- **Direction:** Switch to Electron `shell.trashItem` so deletes are recoverable from the Recycle Bin (also better UX on macOS/Linux).

#### F9. Long-path support (MAX_PATH 260)
- **Where:** any deep workspace (`node_modules`, monorepos).
- **Direction:** Document that Windows long-path support must be enabled (group policy / registry) or prefix paths with `\\?\` internally for fs operations on long paths.

#### F10. Drive letters / UNC paths in the workspace gate
- **Where:** workspace path entry UI / validation.
- **Direction:** Accept `C:\...`, `D:\...`, and `\\server\share\...` formats; the current Linux-rooted assumption (`/...`) needs to broaden.

#### F11. Drag-and-drop from OS into the explorer
- **Direction:** Verify dropped paths arrive correctly (Windows `\` separators, possible UNC) and round-trip through the same normalization layer as F2.

#### F12. Recursive `fs.watch`
- **Direction:** Confirm we route everything through chokidar; raw `fs.watch({ recursive: true })` would behave differently on Windows than on Linux. (No raw uses spotted in the first pass — verify.)

#### F13. CRLF vs LF on save
- **Direction:** If the editor writes back content read from disk, decide whether to preserve original line endings or normalize. Interacts with git `core.autocrlf`.

#### F14. Atomic write temp-file location
- **Where:** `src/main/fileService.ts` (~353) writes `.tmp.*` next to target.
- **Direction:** Fine on Windows but brittle if parent dir permissions change mid-write; low priority.

---

## Suggested order of attack

1. Stand up the `windows-latest` CI job (even if failing) — provides ground truth for everything else.
2. Make tests platform-neutral so the CI job becomes meaningful.
3. Fix harness-launch shell wrapper + shell/PATH detection (items 1, 3, 4, 5).
4. Validate node-pty / ConPTY end-to-end on a real Windows host (item 6).
5. Pick a canonical path form and normalize at the IPC boundary (F2) — unblocks F3/F4/F11 work.
6. Fix cross-drive rename and the open-file-locking error path (F1, F4).
7. Add reserved-name and atomic-save handling to explorer/watcher (F5, F6).
8. Audit credential/SSH permission story (item 7) and document the policy.
9. Husky and minor items.
10. Decide on signing before first public Windows release.

---

## Open questions for the team

- Do we ship a Windows release unsigned for the first cut, or block on a code-signing cert?
- Minimum Windows version we commit to (Win10 1809+ for ConPTY, or Win11 only)?
- Do we support PowerShell, cmd.exe, or both as the default session shell — and is Git Bash a documented option?
- Is WSL a target environment (running the Linux build inside WSL) or strictly native Windows?
