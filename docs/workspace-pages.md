# Workspace pages

A Workspace owns its agents, terminals, validated checkout contexts, Browser tabs, editor buffers,
notes and services. A page owns **presentation**, not processes or filesystem authority.

## Controls

- The status-bar `1 2 … +` switcher selects or creates pages (maximum nine).
- New pages start empty. The `×` removes only an empty page; the last page and minimized-pane
  restore destinations cannot be removed. Pending launches reserve a pane, so their page is not empty.
- Drag a tiled pane by its existing header onto a numbered page to move it within the same
  workspace, or onto `+` to create a destination (up to nine). Drop selects that page and reveals
  the pane; terminal/conversation/checkout identity, Browser tabs, dirty buffers and notes stay intact.
  Valid targets highlight during dragging. Pending launch/resume placeholders remain reserved, and
  maximized-source topology edits stay disabled. Existing within-page docking remains unchanged.
- The selected page uses a theme-accent inset border/background, without changing button/footer size.
  Usage percentages sit above their bars in the existing 20px widget height; each provider is a
  subtle 18px group with its own icon, meter and clock-labelled reset time. The footer is fixed at
  26px total height. Project, branch and environment labels have no arbitrary width caps; ellipsis
  applies only when the center actually runs out of space between neighboring controls.
- Pane headers offer Minimize and Maximize/Restore size. Maximize is temporary, per-page, and
  leaves the split tree, ratios, revision and undo history untouched. Layout edits are disabled
  until size is restored. Switching pages retains each page's maximize state.
- Minimized chats stay in the workspace's existing left-hand agent list with attention and a
  minimized label. Selecting one restores it and selects its original page. The status-bar
  Minimized menu also provides access in tabs mode and with the sidebar collapsed, including
  minimized Browser/editor/notes panes.
- Restore reuses the original sibling placement hint if its anchor still exists; otherwise it
  inserts safely into the original page. It never rebuilds the whole arrangement.
- Close requests retirement of the captured terminal and removes its pane/membership/cache after
  main accepts the request. That IPC acknowledgment does not prove process exit; the real-PTY smoke
  separately verifies eventual process death. Native conversation history and checkout/worktree/branch/service ownership
  are not deleted. A failed Close keeps the entry and reports a notification.

Keyboard commands use the shared registry/override model in app, editor, terminal and native
Browser contexts: primary+Alt+PageDown/PageUp for next/previous, primary+Alt+1…9 for direct pages.
Here primary is Ctrl (Linux/Windows) or Command (macOS). Missing page slots are harmless no-ops.
Workspace page controls/commands do not act on a parked workspace while an Assistant is selected.

## Implementation

`store/workspacePages.ts` owns normalization/projection and membership operations;
`workspacePageActions.ts` owns the small page action layer. Existing layout writers pass through
`syncActiveWorkspace`/`patchWorkspaceById`, which synchronize the active-page compatibility fields.
The existing split/move/dock/resize algorithms are retained; normalization excludes other pages
and minimized panes, and undo only repairs current page membership. `WorkspacePaneDragProvider`
shares one drag domain with the footer; layout monitors handle their own workspace/page only.
Workspace-edge drop ids are scoped and inactive warm surfaces are disabled. Page drop targets
require a direct pointer hit, so they cannot steal nearest-target fallback from within-page docking.

`lib/terminalRuntimeCache.ts` owns xterm buffers/readiness/disposal independently of UI imports,
so terminal close, replacement and global output delivery do not depend on a mounted pane.
Terminal identity and checkout launch binding do not change on presentation operations. Pending
launches (including ordinary toolbar shells/agents) share `lib/workspaceTerminalLaunch.ts` to
capture/reserve their destination, revalidate ownership and confirm registration after spawn; an
unregistrable returned PTY receives an explicit retirement request. A captured destination page must
still exist, but need not remain selected during asynchronous worktree creation/adoption; reserving,
attaching and cleaning its pane preserve the selected page's layout/history and editor focus.
Measured history resume cancels preparation if its page
becomes unavailable and respects accepted launches after dispatch. Background terminal surfaces
are invisible, inert and non-zero-sized: never-ready hidden/replaced terminals complete their
normal startup handshake without taking focus. Background views exist only until readiness is
confirmed; one readiness subscription per workspace surface removes them immediately. Already-ready
hidden terminals remain cached without pane components/attachments and retain their last PTY geometry. Protocol replies/output continue separately from user-key handling. A newly spawned
or replaced terminal can temporarily keep a cold workspace warm until startup completes; ordinary
workspace residency still uses the three-surface LRU.

Browser visibility is derived from active destination plus `workspaceBrowserPresented`: active
page membership, minimization, maximize occlusion, and overlay suppression all matter. Hiding
never disposes Browser tabs. Bounds/tab-completion calls remain non-authoritative in main and
late renderer completions must not reactivate an invisible Browser. Explorer stays workspace-wide;
file/editor authority remains pinned to validated checkout contexts, not page ids.

## Persistence boundary

`workspacePageStorage.ts` persists bounded V1 page preferences by environment + canonical path:
page order, active page, semantic topology and minimized utility metadata. Runtime pane/PTY/node
ids, focus, maximize and undo are not persisted. Existing runtime single layouts backfill Page 1.
Location-only reopen keeps pages but safely prunes absent resource leaves. Saved terminal slots
**never** bind unrelated future chats, spawn new processes, or resume native conversations.
Already-present utility panes can map by singleton identity. A live workspace is never overwritten
by restored preferences. Invalid/duplicate/deep/oversized records fall back safely.

This is not saved working sessions or conversation resurrection. That feature, durable native
conversation bindings, and automatic resume are deferred. Recipes are temporarily hidden and
blocked at execution/mutation boundaries, with their persisted data retained unchanged; there is
no recipe migration or new multi-page recipe format in this pass.

## Smoke checklist

Use a temporary workspace/profile; do not alter an existing user's saved state.

1. Launch two local shells/agents. Change a split ratio, create Page 2, launch another agent there.
   Switch via status-bar controls and configured shortcuts with focus in terminal, editor and Browser.
   Verify original PTY/native conversation ids and output/attention continue unchanged. Drag terminal,
   Browser, editor and notes headers onto empty/populated pages and `+`; verify unique membership,
   selected destination, dirty text/native Browser state retained, and no new/restarted processes.
   Confirm `+` cannot create a tenth page; stale/foreign/pending/minimized/maximized sources are refused.
2. Minimize an agent, switch pages, select its left-hand entry, and verify prior placement. Repeat
   after closing its sibling anchor. Verify all-minimized pages stay empty after Fit/Undo.
3. Maximize one pane; switch away/back; restore size. Verify exact topology/ratios and independent
   page history. Minimize/close while maximized; no stale maximize reference remains.
4. Open a Browser tab with state (a form field or JS counter). Put Browser on Page 1, switch to
   Page 2, then return. Minimize Browser, restore it, maximize another pane, restore size. The
   native view must not overlay hidden pages; its tab/view/session identity and state must survive.
   Repeat rapid page/workspace/Assistant switches and a late tab/navigation completion.
5. Switch/minimize immediately after starting a terminal, before xterm import/readiness completes.
   Repeat a native checkout replacement on a hidden/minimized page. Verify output does not remain
   stuck until restore and hidden terminal keys do not reach the PTY. Switch enough workspaces to
   make the source cold while a launch is pending; startup must still complete.
6. Delay a toolbar shell/harness spawn, switch pages, and confirm it attaches to the initiating
   page without stealing selection. Repeat with workspace closure: the returned PTY must be killed,
   including silent registration failure or replacement of a workspace with the same id. Repeat over SSH.
   Close a minimized chat while switching workspaces during the kill response. Only its original
   workspace loses the entry. History remains discoverable; worktree/branch/dev server survives.
7. Verify checkout-aware files and dirty buffers across pages, including same-relative-name files
   in two checkouts and SSH focused-checkout polling. SSH launch/attention identity stays unchanged.
8. Reopen the app: page order/selection persists, absent chats are not replaced or resumed. Invalid
   storage does not prevent opening. Recipes are inaccessible; retained records are unchanged.

Run `npm run validate`. Real Electron checks (after build):
`npx electron scripts/workspace-pages-smoke.cjs` and
`npx electron scripts/terminal-geometry-smoke.cjs`, and
`node scripts/workspace-launch-race-smoke.cjs`.
The launch-race check uses the full built app and real local shell PTYs in a disposable profile/HOME.
A test-only gate delays the real main spawn handler's response (not PTY creation); it verifies page
capture, hidden readiness, detached cached output, zero ready background views and process death after
workspace closure. It also performs real pointer drags onto an empty page, `+`, and a populated
page, preserves native Browser form/JS state and notes, and exercises within-page swapping. Active
page dimensions/accent and representative stacked-usage CSS are checked against unchanged footer
geometry, including a fixed 26px footer and last-resort label truncation under space pressure
(this is not live account telemetry). The other checks cover native visibility/state and xterm geometry.
Live SSH/native-harness acceptance remains separate; no automated remote claim is made here.
