# Changelog

All notable changes to Clanker Grid are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.5] - 2026-07-21

### Added

- **First-class pane docking** — terminals, Browser, Editor, Notes, and Explorer can be moved to workspace edges or split beside a specific pane, with center-drop swapping and an exact destination preview.
- **Layout undo and persistence** — pane moves and splitter resizing can be undone, while layout topology and split ratios are restored per workspace path across app launches.

### Changed

- **Larger pane drag surfaces** — pane headers now provide a generous, consistent drag target while preserving interactive controls.
- **Linux-only release artifact** — `0.2.5` is released as a Linux AppImage. Windows remains covered by the shared validation workflow, but no Windows binary is produced for this patch release.

### Fixed

- **Browser alignment while zoomed** — native browser bounds now account for renderer zoom independently from monitor scaling, keeping embedded content aligned with its placeholder.
- **Explorer layout consistency** — legacy workspace restoration, state resets, and layout normalization preserve Explorer visibility without orphaned or missing leaves.
- **Persisted utility-pane layouts** — reopening a workspace regenerates runtime state for saved Browser, Explorer, Editor, and Notes leaves instead of destructively collapsing their topology.
- **Splitter undo rendering** — restoring a saved split ratio now updates mounted panel groups without generating phantom undo entries.
- **Windows layout keys** — workspace paths with equivalent casing map to the same persisted-layout key on Windows.

### Security

- **Dependency audit cleanup** — refreshed vulnerable transitive dependencies so `npm audit --audit-level=high` reports zero vulnerabilities.

## [0.2.4] - 2026-07-17

### Added

- **GPU diagnostic** — added `npm run diagnose:gpu` to report Electron/Chromium GPU feature status and verify WebGL 1 and WebGL 2 context creation inside a sandboxed `WebContentsView`.
- **Clickable terminal links** — HTTP(S) URLs in terminal output open in a new in-app browser tab, while file references contained within the active workspace open directly in the editor.

### Changed

- **Linux-only release artifacts** — `0.2.4` is released as a Linux AppImage. Windows targets remain configured and covered by the shared validation workflow, but Windows binaries are not produced for this patch release.

### Fixed

- **Browser WebGL and hardware acceleration** — removed the legacy global hardware-acceleration disablement and redundant `--disable-gpu` switch so embedded browser tabs can use WebGL, WebGPU, GPU compositing, and accelerated rendering when supported by Chromium.

## [0.2.3] - 2026-07-03

### Added

- **Explorer typing filter** — a filter input above the file tree narrows the visible entries by name as the user types. Matching is case-insensitive and substring-based; ancestor directories of matches stay visible, and a collapsed directory with a matching descendant is force-expanded for the duration of the filter without mutating the persistent expansion state. Empty filter restores the original view; a non-matching filter shows "No matches". Press `/` while the tree is focused to jump to the filter; press `Escape` inside the filter to clear (or blur when already empty). The filter only sees entries currently loaded into the tree (consistent with the explorer's lazy loading) — unloaded subdirectories are not crawled. Resolves #3.
- **Local notes pane** — added a workspace-scoped Notes pane that can be toggled from the header, dragged into the pane layout, and persisted locally by workspace path.
- **Harness visibility controls** — harness defaults now include a visibility toggle. Harnesses remain visible by default, and hidden harnesses are removed from the top bar and workspace gate without disabling previous-chat resume for installed harnesses.

### Changed

- **Linux-only release artifacts** — `0.2.3` is prepared as a Linux AppImage release. Windows build targets remain configured and tested on a best-effort basis, but Windows artifacts are not produced for this patch release.

### Fixed

- **Folder picker directory creation on KDE/Linux** — native workspace/base-directory pickers now allow creating a new directory from the picker dialog where the platform file chooser supports it.
- **New terminal focus** — newly created or activated terminal panes now focus xterm directly once the runtime is ready, so mouse and keyboard input work without an extra click.
- **Harness PATH precedence** — harness command discovery and spawning now prefer user CLI bin paths before system PATH entries, matching common npm/global CLI installs.
- **Previous-chat availability** — previous chat discovery now returns only sessions whose harness command is currently available, and session invocation rejects stale sessions if the harness has been removed.
- **Explorer file/folder creation in empty directories** — clicking "New File" or "New Folder" on an empty workspace silently failed because `FileTree` returned the "No files" placeholder before the inline create input could render. The early-return now defers to an in-progress root-level create so the input appears and the IPC fires. Resolves #34.
- **Silent failures on explorer file operations** — `fileCreate`, `fileDelete`, and `fileRename` failures other than `FILE_IN_USE` previously only logged to the console. All failures now surface via `window.alert` with the underlying error message so the user knows the action did not complete.
- **Create-in-collapsed-folder edge** — selecting a previously-loaded but currently-collapsed subdirectory and clicking "New File" used to silently fail because the create input only renders inside expanded directories. `startCreating` now auto-expands the parent before opening the input.

### Removed

- **Fastfetch launch-screen setting** — removed the unused fastfetch setting and related IPC/test plumbing.

### Security

- **Dependency audit cleanup** — refreshed vulnerable transitive dependencies so `npm audit --audit-level=high` reports zero vulnerabilities.

## [0.2.2] - 2026-05-13

### Changed

- **Codex model discovery uses CLI** — replaced the `~/.codex/config.toml` read + hardcoded fallback list with a call to `codex debug models`, which returns a live JSON catalog from the running binary. Only models with `visibility: "list"` are surfaced. Results are cached with the existing 1-hour TTL; discovery failure returns an empty list rather than stale hardcoded data.
- **Claude model selector replaced with free-text input** — the Claude harness has no model-listing command, so the dropdown (which previously showed four hardcoded model IDs) has been replaced with a plain text input. Users can type any model identifier accepted by the CLI (e.g. `claude-sonnet-4-6`, `opus`).
- **Harness flags replaced with free-text input** — the per-harness boolean toggle (yolo / pure / dangerously-skip) has been replaced with a free-text "Extra flags" field. Any flags the CLI accepts can be entered. Codex and Claude show their conventional flags as placeholder text (`--yolo` and `--dangerously-skip-permissions` respectively). The `--pure` mode for OpenCode is removed; users who want it can type it manually. Existing stored flag strings carry forward without migration.

### Fixed

- **Validation pipeline restored** — updated stale IPC/settings tests, removed a jsdom form-submission warning in the git branch form, refreshed vulnerable transitive lockfile entries, and aligned workspace-tab tests with the intentionally count-free tab UI so `npm run validate` passes cleanly.
- **Browser local-file navigation** — the browser address bar now preserves explicit `file://` URLs and converts absolute POSIX/Windows file paths into file URLs instead of incorrectly prefixing them with `https://`. The main-process navigation pipeline now allows local files only for trusted app-initiated navigation while keeping web-initiated navigation and external-open handling restricted to safe remote protocols. Resolves #33.

### Removed

- **`MODEL_DISCOVERY_FALLBACKS` entries for codex and claude** — codex now discovers models from the CLI; claude intentionally returns no models. The hardcoded fallback lists for both harnesses are gone.
- **`harnessFlags` toggle abstraction** — `harnessFlagsFromToggle`, `harnessToggleFromFlags`, and `HARNESS_FLAG_MAP` have been removed. The `harnessFlags` module now only exports `HARNESS_FLAGS_PLACEHOLDER` for placeholder hint text.

## [0.2.1] - 2026-04-30

All 30 commits since v0.2.0 have been included. Notable changes include major decomposition of Header and BrowserPanel into focused modules, annotation controller refactoring, Windows CI test hardening, and removal of the pane-locking feature set.

### Added

- **HarnessDefaultsSection component** — extracted settings UI for managing per-harness model defaults and command flags into its own component.
- **BrowserUrlInput component** — extracted URL bar rendering and autocomplete into its own component, replacing inline JSX in BrowserPanel.
- **useBrowserBoundsLifecycle hook** — extracted browser WebContentsView bounds management into its own hook.
- **useBrowserPanelActions hook** — extracted browser toolbar actions (back, forward, reload, zoom) into its own hook.
- **useBrowserUrlAutocomplete hook** — extracted URL history autocomplete logic into its own hook.
- **useDropdownBehavior hook** — extracted dropdown open/close state and keyboard handling into its own hook.
- **useHeaderSettings hook** — extracted settings panel state and logic from Header into its own hook.
- **annotationCaptureParser module** — extracted annotation capture parsing from the controller into a focused module with its own unit tests.
- **annotationMarkdownFormatter module** — extracted annotation markdown formatting from the controller into a focused module with its own unit tests.
- **explorerActionHandlers module** — extracted file-explorer action handlers (create, rename, delete, move) into a dedicated module.
- **contractTestFactory for VCS providers** — shared test factory reducing 600+ lines of duplication across GitHub, GitLab, and Bitbucket contract tests.
- **`.fallowrc.json`** — fallow configuration teaching it about the Electron architecture: Vite entry points (`main.tsx`, `index.html`), the renderer ambient declaration `electron.d.ts`, and `shared/types/credentials.ts` (whose IPC types are only consumed via the ambient declaration). An override turns off `unresolved-imports` for `electron.d.ts` since fallow can't resolve relative imports out of `.d.ts` files. Drops unresolved-import noise from 45 to 0 and unused-file noise from 5 to 2 (both genuine). Resolves #8.

### Changed

- **Header decomposed** — extracted settings state logic and dropdown UI into `HeaderRightControls.tsx`, `HarnessDefaultsSection.tsx`, `useDropdownBehavior.ts`, and `useHeaderSettings.ts`. Header surface complexity reduced by ~600 lines with behavior preserved.
- **BrowserPanel decomposed** — extracted URL autocomplete, toolbar actions, and bounds lifecycle into focused modules (`BrowserUrlInput.tsx`, `useBrowserBoundsLifecycle.ts`, `useBrowserPanelActions.ts`, `useBrowserUrlAutocomplete.ts`). BrowserPanel surface complexity reduced by ~450 lines with behavior preserved.
- **FileExplorer decomposed** — extracted action handlers into `explorerActionHandlers.ts` and TreeNode render helpers from `FileTree.tsx`. Keyboard action mapping refined.
- **GitRemotesSection decomposed** — extracted list rendering and form-input helpers into focused sub-modules.
- **WorkspaceGate keyboard actions mapped** — keyboard shortcuts in the workspace gate are now properly wired to their handlers.
- **Session history discovery refactored** — `discoverCodexSessions` and `discoverPiSessionFile` decomposed into focused helpers while preserving behavior.
- **Annotation runtime refactored** — `inferElementRoleInContext` decomposed; region/tag mapping and collection classification extracted into helper functions.
- **Annotation controller refactored** — capture parsing and markdown formatting moved to dedicated modules (`annotationCaptureParser.ts`, `annotationMarkdownFormatter.ts`), reducing controller complexity.
- **Drag-handle context extracted to its own module** — moved `DragHandleContext` and the `useDragHandle` hook out of `DynamicPaneLayout.tsx` into `dragHandleContext.ts`. Pane components and the file explorer now import the hook from the new module instead of from `DynamicPaneLayout`, breaking three circular import edges (`DynamicPaneLayout` ↔ `BrowserPanel` / `EditorPane` / `TerminalPane`). Pure refactor, no behavior change. Resolves #9.
- **`validateWorkspaceConsistency` decomposed** — split the 130-line invariant checker into five focused sub-validators (workspace, terminal, layout, browser, editor) along its existing `[W*][T*][L*][B*][E*]` section markers. The public function is now an 8-line orchestrator that concatenates their results. Cyclomatic complexity drops from 59 to ≤19 per sub-validator (largest is the layout block); behavior is identical and all 136 existing tests pass unchanged. Resolves #10.
- **Pane insertion fallback** — layout insertion now falls back to the largest leaf by area (without lock gating) when there is no active terminal target.

### Fixed

- **Windows CI test cleanup hardened** — git service tests on `windows-latest` no longer fail with `EBUSY` handle-lock errors during temp-directory teardown after `@vscode/git` operations hold locks on `.git/index.lock`. Tests now use retry loops with exponential backoff for the final `fs.rm` call and skip the lock file removal step on Windows. Resolves #3.

### Removed

- **Unused VCS selector hooks** — deleted `usePat`, `useSshKey`, `useCredentialsLoading`, `useCredentialsError`, and `useProviderContext` from `vcsStore.ts`. These were one-line Zustand selectors written speculatively with full test coverage but never consumed — the only renderer using vcsStore (`CredentialSettings`) calls `useVcsStore` directly. Also dropped the matching `describe('selectors')` block (10 tests). Continuing #11.
- **Unused renderer path-normalizer re-export and workspace-scope hook export** — deleted the `toPosixPath`/`toNativePath` re-export from `src/renderer/lib/pathUtils.ts` (no renderer code imported it; main and tests import directly from `shared/pathNormalize`). Dropped `export` on `useScopedWorkspaceId` in `WorkspaceScope.tsx` — only its sibling `useScopedWorkspace` calls it. Continuing #11.
- **Unused exports in workspace store helpers** — dropped the `export` keyword on `generateBrowserTabId`, `sanitizeBrowserPane`, and `withWorkspaceLifecycle` (still used internally by their modules), and deleted `syncBrowserUrlFromActiveTab` and `getActiveBrowserTab` outright (no callers anywhere). Also removed `getEdgeGaps` from the `workspaceStore` re-export surface — its tests already import it directly from `workspaceLayout`.
- **Remaining unused production exports** — dropped `export` on `evictCachedTerminal` and `isTerminalDisposed` in `TerminalPane.tsx` (internal-only), `HARNESS_FLAG_MAP` in `harnessFlags.ts` (internal-only), and `HARNESS_SVG_ICONS` in `harnessOptions.ts` (internal-only). Deleted dead-code `endSwitch` and `terminalReattach` debug helpers from `workspaceSwitchDebug.ts` along with their orphaned module-level variables and doc entries — zero callers anywhere. Unused production exports now at 0. Resolves #11.
- **Debug console statements** — removed 25 `console.log`, `console.debug`, and `console.info` statements from the annotation module, session history discovery, and IPC handlers that were development/debug leftovers. Resolves #5.
- **Pane locking feature** — removed `locked` pane state, lock toggles/icons in terminal/browser/editor panes, and lock-based insertion guards. This also resolves issue #4 where lock controls were non-functional.
- **Bring-to-front actions** — removed `bringPaneIntoView`, `bringBrowserIntoView`, and `bringEditorIntoView` store actions and corresponding UI controls.
- **`canAddPane` gating** — removed lock-based add-pane gating from header and file explorer terminal creation paths.
- **Unused test helper exports** — deleted 27 unused exports across 5 test infrastructure files. In `gitTestHelpers.ts`, removed 13 dead-code functions (`getCurrentBranch`, `getBranches`, `branchExists`, `createBranch`, `switchBranch`, `deleteBranch`, `getStatus`, `stash`, `listStashes`, `applyStash`, `dropStash`, `createConflict`, `abortMerge`) and inlined the `getStatus` call in `getWorkingTreeFiles`. In `tempPaths.ts`, deleted 5 unused path helpers (`testWorkspace`, `testClankerGridDir`, `testPiSessionsDir`, `testSshKey`, `testPath`). In `httpContractHelpers.ts`, deleted 5 response factory functions (`jsonResponse`, `rateLimitResponse`, `emptyResponse`, `malformedJsonResponse`, `serverErrorResponse`). Dropped `export` on `createElectronApiMock` (electron.ts, internal-only), `createBrowserTabFixture`, `createBrowserPaneFixture`, `createPaneFixture` (fixtures.ts, internal-only). Resolves #12.

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

[Unreleased]: https://github.com/Bynzski/clanker/compare/v0.2.4...HEAD
[0.2.4]: https://github.com/Bynzski/clanker/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/Bynzski/clanker/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/Bynzski/clanker/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Bynzski/clanker/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Bynzski/clanker/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Bynzski/clanker/releases/tag/v0.1.0
