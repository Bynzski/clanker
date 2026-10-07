# Checkout-aware Explorer and editor (#134)

File authority stays in main: a workspace ID plus an optional checkout-context ID selects one independently validated root. The renderer cannot authorize sibling paths by changing `workspacePath`. Git's main checkout is never switched by file focus.

Explorer follows the focused terminal's registered launch context, or the context pinned to an explicitly focused editor surface. Editor tabs retain their absolute path, checkout ID and root, regardless of subsequent focus changes. Released/missing contexts fall back to the normal workspace Explorer; their open buffers remain available, with saves refused rather than redirected.

## Local smoke test

Use a disposable repository with a committed `same.txt` and two isolated agents, on branches `alpha` and `beta`.

1. Focus a normal terminal, then alpha, then beta. Explorer must switch roots, label isolated branches and list each checkout's own files. Main Git's branch must remain unchanged.
2. Open `same.txt` in all three copies. Tabs must be distinct; isolated tabs show their branch and full path in the tooltip. Edit/save alpha after focusing beta. Only alpha's physical file must change. Focus alpha's editor tab: Explorer must follow alpha again.
3. Create a file/folder, rename and delete in alpha. Verify the main and beta copies are unchanged. Test context-menu Copy Relative Path and Open Terminal: paths/cwd must be relative to alpha, and the new shell must be bound to alpha's context.
4. Open a second terminal in alpha. Switching between alpha's terminals must not reset expansion/filter state or restart the root watcher. External file creation/removal must refresh the active tree; clean editor buffers reload and dirty buffers stay intact.
5. With an unsaved alpha editor buffer, close alpha's terminals. Use the normal confirmed checkout removal flow (only in this disposable fixture). Explorer must fall back to main, the buffer must remain dirty, and its unavailable-checkout notice must explain that it cannot save into another checkout. Re-adopting a checkout at the same path must not reuse the retired tree cache or rebind that old tab.
6. Separately remove a disposable isolated directory outside Clanker. The root watcher/refresh should trigger authoritative Git reconciliation and fallback. An unreachable path must not be interpreted as permission to browse a parent directory.

## SSH smoke test

Follow `remote-vps-smoke-test.md`; preserve `clanker-test` and use a unique disposable fixture.

Repeat root switching and read/save/create/rename/delete for two SSH worktrees. No remote path should reach desktop watchers. The single batched metadata poll follows the focused checkout; other-checkout editor tabs remain parked until that root is focused again. On return, clean buffers reload and dirty buffers remain preserved. Disconnect/reconnect SSH: failures may request Git reconciliation but must not mark a checkout deleted merely because transport failed. Remove a disposable worktree externally: a scoped poll failure should request Git verification and fall back only when Git confirms its checkout is gone.

Automated coverage: `tests/main/integration/fileCheckout.real.test.ts`, `tests/renderer/integration/fileCheckout.integration.test.tsx`, and the main/renderer remote watcher suites.
