# Changelog

All notable changes to Clanker Grid are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- **Unused test helper exports** — deleted 27 unused exports across 5 test infrastructure files. In `gitTestHelpers.ts`, removed 13 dead-code functions (`getCurrentBranch`, `getBranches`, `branchExists`, `createBranch`, `switchBranch`, `deleteBranch`, `getStatus`, `stash`, `listStashes`, `applyStash`, `dropStash`, `createConflict`, `abortMerge`) and inlined the `getStatus` call in `getWorkingTreeFiles`. In `tempPaths.ts`, deleted 5 unused path helpers (`testWorkspace`, `testClankerGridDir`, `testPiSessionsDir`, `testSshKey`, `testPath`). In `httpContractHelpers.ts`, deleted 5 response factory functions (`jsonResponse`, `rateLimitResponse`, `emptyResponse`, `malformedJsonResponse`, `serverErrorResponse`). Dropped `export` on `createElectronApiMock` (electron.ts, internal-only), `createBrowserTabFixture`, `createBrowserPaneFixture`, `createPaneFixture` (fixtures.ts, internal-only). Resolves #12.

### Added

- **`.fallowrc.json`** — fallow configuration teaching it about the Electron architecture: Vite entry points (`main.tsx`, `index.html`), the renderer ambient declaration `electron.d.ts`, and `shared/types/credentials.ts` (whose IPC types are only consumed via the ambient declaration). An override turns off `unresolved-imports` for `electron.d.ts` since fallow can't resolve relative imports out of `.d.ts` files. Drops unresolved-import noise from 45 to 0 and unused-file noise from 5 to 2 (both genuine). Resolves #8.

### Changed

- **Drag-handle context extracted to its own module** — moved `DragHandleContext` and the `useDragHandle` hook out of `DynamicPaneLayout.tsx` into `dragHandleContext.ts`. Pane components and the file explorer now import the hook from the new module instead of from `DynamicPaneLayout`, breaking three circular import edges (`DynamicPaneLayout` ↔ `BrowserPanel` / `EditorPane` / `TerminalPane`). Pure refactor, no behavior change. Resolves #9.
- **`validateWorkspaceConsistency` decomposed** — split the 130-line invariant checker into five focused sub-validators (workspace, terminal, layout, browser, editor) along its existing `[W*][T*][L*][B*][E*]` section markers. The public function is now an 8-line orchestrator that concatenates their results. Cyclomatic complexity drops from 59 to ≤19 per sub-validator (largest is the layout block); behavior is identical and all 136 existing tests pass unchanged. Resolves #10.

### Removed

- **Unused vcsStore selector hooks** — deleted `usePat`, `useSshKey`, `useCredentialsLoading`, `useCredentialsError`, and `useProviderContext` from `vcsStore.ts`. These were one-line Zustand selectors written speculatively with full test coverage but never consumed — the only renderer using vcsStore (`CredentialSettings`) calls `useVcsStore` directly. Also dropped the matching `describe('selectors')` block (10 tests) which exercised store state already covered by the per-action `describe` blocks above and didn't actually call any of the hooks. Continuing #11.
- **Unused renderer path-normalizer re-export and workspace-scope hook export** — deleted the `toPosixPath`/`toNativePath` re-export from `src/renderer/lib/pathUtils.ts` (no renderer code imported it; main and tests import directly from `shared/pathNormalize`). Dropped `export` on `useScopedWorkspaceId` in `WorkspaceScope.tsx` — only its sibling `useScopedWorkspace` calls it. Continuing #11.
- **Unused exports in workspace store helpers** — dropped the `export` keyword on `generateBrowserTabId`, `sanitizeBrowserPane`, and `withWorkspaceLifecycle` (still used internally by their modules), and deleted `syncBrowserUrlFromActiveTab` and `getActiveBrowserTab` outright (no callers anywhere). Also removed `getEdgeGaps` from the `workspaceStore` re-export surface — its tests already import it directly from `workspaceLayout`.
- **Remaining unused production exports** — dropped `export` on `evictCachedTerminal` and `isTerminalDisposed` in `TerminalPane.tsx` (internal-only), `HARNESS_FLAG_MAP` in `harnessFlags.ts` (internal-only), and `HARNESS_SVG_ICONS` in `harnessOptions.ts` (internal-only). Deleted dead-code `endSwitch` and `terminalReattach` debug helpers from `workspaceSwitchDebug.ts` along with their orphaned module-level variables and doc entries — zero callers anywhere. Unused production exports now at 0. Resolves #11.
- **Debug console statements** — removed 25 `console.log`, `console.debug`, and `console.info` statements from the annotation module, session history discovery, and IPC handlers that were development/debug leftovers. Resolves #5.
- **Pane locking feature** — removed `locked` pane state, lock toggles/icons in terminal/browser/editor panes, and lock-based insertion guards. This also resolves issue #4 where lock controls were non-functional.
- **Bring-to-front actions** — removed `bringPaneIntoView`, `bringBrowserIntoView`, and `bringEditorIntoView` store actions and corresponding UI controls.
- **`canAddPane` gating** — removed lock-based add-pane gating from header and file explorer terminal creation paths.

### Changed

- **Pane insertion fallback** — layout insertion now falls back to the largest leaf by area (without lock gating) when there is no active terminal target.

## [0.2.0] - 2026-04-29

First release with native Windows support alongside Linux. The Linux AppImage build remains supported and unchanged for end users.

### Added

- **Windows builds** — unsigned NSIS installer and portable executable produced via `electron-builder`, alongside the existing Linux AppImage. Targets Windows 10 1809+ on x64.
- **Cross-platform shell defaults** — `powershell.exe` is the default session shell on Windows; `bash`/`$SHELL` remains the default elsewhere.
- **Cross-platform harness launch** — npm-installed CLI tools (`.cmd` shims) on Windows are spawned through `cmd.exe /c` so harnesses like Codex, Claude, OpenCode, and Pi launch reliably.
- **Reserved-name validation** — file/folder creation rejects Windows-reserved names (`CON`, `NUL`, `COM1–9`, `LPT1–9`, etc.), trailing dots/spaces, and illegal characters before they reach the filesystem. Enforced on every platform.
- **Trash on delete** — file and folder deletion routes through the OS recycle bin (`shell.trashItem`) where supported, falling back to permanent delete with a clear error otherwise.
- **Line-ending preservation** — files originally saved as CRLF stay CRLF on save; LF stays LF. No silent line-ending rewrites.
- **UNC and drive-letter workspaces** — workspace paths accept `\\server\share\...` and `C:\...` inputs; backslashes are normalized at the boundary.
- **UNC watcher polling** — explorer file watching automatically uses polling on UNC workspaces. Force polling anywhere by setting `CLANKER_GRID_WATCHER_POLLING=1`.
- **`docs/windows.md`** — Windows reference doc covering Git for Windows, long-path support, line endings, SSH lookup, app-data location, and watcher behavior.
- **Windows CI** — `windows-latest` is part of the validate matrix and required for merges.

### Changed

- **IPC paths are POSIX-canonical** — paths crossing the main↔renderer boundary use forward slashes; main converts to native `path.sep` on entry and back to POSIX on return. Renderer code no longer needs to handle backslashes.
- **Case-insensitive path keying on Windows** — explorer git-status, watcher maps, and editor-watch owner keys treat `Foo.txt` and `foo.txt` as the same path on Windows while preserving display casing.
- **Cross-drive rename fallback** — moving a file across drives on Windows (`EXDEV`) now falls back to copy + remove instead of failing.
- **File-in-use errors are user-facing** — rename/delete operations that fail because a file is held open (`EBUSY`/`EPERM`) surface a `FILE_IN_USE` prompt instead of a generic permission error. Editor file handles release before mutation and re-acquire on failure.
- **SSH permissions on Windows** — Windows now relies on inherited NTFS ACLs under `%USERPROFILE%\.ssh` for SSH keys; POSIX `chmod` calls are no-ops and are skipped on Windows. Behavior on Linux/macOS is unchanged.
- **Atomic-save handling** — explorer watcher tunes `awaitWriteFinish` per platform and collapses unlink+add bursts into a single change event so the editor and explorer don't flicker on save.

### Fixed

- PowerShell terminals no longer fail to start because of a stray `bash`-only `-i` flag.
- Workspace gate accepts native Windows paths in autocomplete and submit.
- Trailing-slash normalization no longer corrupts native Windows paths in the open-directory dialog.
- File explorer no longer creates duplicate keys when `listDirectory` returns backslash-separated entries on Windows.
- `node-pty.kill()` no longer surfaces a SIGTERM warning on Windows; kill calls are wrapped and fall back to `TerminateProcess`.

### Known limitations

- **Unsigned installer.** Windows SmartScreen will display "Windows protected your PC" on first run. Choose **More info → Run anyway** to continue. Code signing is planned for a follow-up release.
- **macOS** is not produced or tested in this release.
- **ARM64 Windows** is not produced; x64 only.
- **WSL** is not a supported target — WSL users should run the Linux AppImage.

## [0.1.0] - 2026-04-27

Initial public release.

### Added

- **Workspace tabs** — multi-workspace UI with per-workspace working directory and pane layout.
- **Workspace gate** — startup picker for working directory and initial layout / harness with single-key shortcuts.
- **Terminal grid** — multiple xterm.js terminal panes in flexible split layouts, backed by node-pty.
- **Terminal clipboard** — `Ctrl+Shift+C` to copy, mouse-selection auto-copy, paste via IPC bridge.
- **AI harness launchers** — start Claude, Codex, OpenCode, or Pi directly inside a terminal pane.
- **Harness catalog** — auto-detection of installed harnesses and their available models.
- **Harness defaults** — per-harness model selection, command flags, and favourites.
- **Session history** — resume past harness sessions from a searchable chat history dropdown.
- **Git tools** — branches, stash, merge, history, and remotes, all from inside the app.
- **AI-assisted commits** — generate commit messages from the commit dialog.
- **Diff viewer** — side-by-side diffs using CodeMirror MergeView.
- **VCS provider integration** — PR status, CI checks, and quick links for GitHub, GitLab, and Bitbucket.
- **Embedded browser panel** — browser tab alongside terminals, with zoom and DevTools controls.
- **Browser annotation** — select page elements to capture structured descriptions for AI agents.
- **Editor pane** — CodeMirror editor with syntax highlighting and tabbed buffers.
- **External change detection** — file watcher prompts to reload edited files when changed on disk.
- **File explorer** — tree view with context menu for create, rename, and delete operations.
- **Credential management** — SSH key generation and encrypted personal-access-token storage.
- **Linux AppImage build** — distributable produced via electron-builder.

### Known limitations

- macOS and Windows packaging targets are configured but not produced or tested in this release.

[Unreleased]: https://github.com/Bynzski/clanker/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Bynzski/clanker/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Bynzski/clanker/releases/tag/v0.1.0
