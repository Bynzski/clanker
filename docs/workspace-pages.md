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
- Minimized agents stay in the workspace's left-hand agent list and collapsed rail with a compact,
  subdued minimized icon (`Minus`). Clicking the agent row or rail icon automatically restores it to its
  previous layout position and selects its original page. In tabs navigation mode (where the sidebar is
  not displayed), each workspace tab provides a compact agent dropdown trigger (`▾`) that indicates
  minimized agents with a subdued `Minus` icon; opening the dropdown lists all workspace agents and
  allows clicking any agent to restore it to its original page and layout placement.
- Minimized utility panes (Browser, Editor, Notes) are restored by clicking their existing toolbar
  toggle buttons (or opening/focusing an open file in FileExplorer for the Editor), distinguishing a
  minimized pane from a genuinely closed pane while preserving underlying state. Empty Editor panes
  can be minimized and restored via the Editor toolbar button without requiring open file tabs.
  The footer `Minimized · N` dropdown mechanism has been removed.
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

### Independent Browser implementation checkpoint

Browser state is now canonical on `WorkspacePage.browser`: a stable pane with its tabs,
selected tab, URL, visibility and hidden-placement hint. Workspace-level Browser fields are
only the selected-page compatibility projection, committed by the same normalization boundary
as layout fields. Tab-identified events and mutations resolve the owning page even when parked;
unknown/closed tab ids cannot create Browser state. Legacy singleton state backfills its original
page, and a page owning a hidden Browser cannot be removed. Moving a Browser transfers this
association without replacing its pane or tabs; an occupied destination is refused.

This is an incremental implementation checkpoint, **not yet the completed Browser-per-page
feature**. Stages 1 (canonical state) and 2 (native protocol) are implemented. Renderer lease
adoption, asynchronous preview routing, V2 persistence and occupied-drop feedback remain
outstanding. Existing renderer calls still use the compatible legacy native protocol; the
end-to-end multi-Browser race guarantees do **not** apply until Stage 3 adopts leases.

`browserPresentationAuthority.ts` owns one native viewport lease: workspace owner, pane id,
selected tab and a monotonically increasing epoch across all owners. Scoped Activate only
accepts an existing tab belonging to that pane. A new lease clears remembered geometry; the
view stays hidden until matching fresh bounds arrive. Hide, Switch, Move, geometry and native
navigation controls reject stale leases, including old unmount cleanup. Hiding/closing retires
the lease without resetting the epoch high-water mark. Background tab navigation does not
select a scoped foreground view. Closed tab ids are tombstoned until workspace disposal, so
late navigation cannot recreate them. Workspace ids remain the native security/session boundary;
pane ids are associations, never synthetic workspace ids or new Chromium partitions.

Run `npx electron scripts/workspace-multi-browser-smoke.cjs` after build. This real-native IPC
smoke verifies two panes plus a background tab, 30 switches, JS/form/native identity retention,
stale Activate/Hide/Bounds/Switch/Refresh rejection, closed-tab navigation, local shared sessions,
shared SSH-workspace sessions, separate SSH-workspace isolation and private-session disposal.
It is not a full-app multi-page visual acceptance test.

Continuation order:
1. Stage 3: make one renderer coordinator issue global epochs for the active destination's
   presented pane/tab (including overlay suppression). Bounds/panel/tab actions must carry that
   captured lease; components must not independently mint foreground authority. Ensure native
   tabs are created with their pane id before scoped activation, and do not reload existing views.
2. Stage 4: add invalid-drop feedback for occupied (including hidden/minimized) Browser pages;
   capture terminal-to-page preview targets before probing, revalidate them afterwards, and never
   reclaim focus after the user changes destination.
3. Stage 5: replace singleton V1 utility keys with bounded V2 Browser identities/associations,
   while retaining V1 migration and existing resource restoration semantics.
4. Stage 6: extend full-app/race smokes to use the renderer lease path, finish documentation,
   run full validation and perform interactive multi-page visual acceptance before a PR.

`store/workspacePages.ts` owns normalization/projection and membership operations;
`workspacePageActions.ts` owns the small page action layer. Existing layout writers pass through
`syncActiveWorkspace`/`patchWorkspaceById`, which synchronize the active-page compatibility fields.
The existing split/move/dock/resize algorithms are retained; normalization excludes other pages
and minimized panes, and undo only repairs current page membership. `WorkspacePaneDragProvider`
shares one drag domain with the footer; layout monitors handle their own workspace/page only.
Workspace-edge drop ids are scoped and inactive warm surfaces are disabled. Page drop targets
require a direct pointer hit, so they cannot steal nearest-target fallback from within-page docking.
Pointer drops elsewhere in the status bar (including disabled `+` at nine pages) cancel instead of
falling back to a nearby docking target. Keyboard and within-layout collision behavior is unchanged.

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
page, preserves native Browser form/JS state and notes, and exercises within-page swapping.
At nine pages, real drops onto disabled `+` and the non-target Ready footer region leave topology,
page selection and resource identity unchanged. Representative pinned usage CSS also fits an 800px footer. Active
page dimensions/accent and representative stacked-usage CSS are checked against unchanged footer
geometry, including a fixed 26px footer and last-resort label truncation under space pressure
(this is not live account telemetry). The other checks cover native visibility/state and xterm geometry.
Live SSH/native-harness acceptance remains separate; no automated remote claim is made here.
