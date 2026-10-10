# Issue #154 — Inventory and Phase 0–3B decisions

## Phase 3B — permanent Branches and Worktrees

Starts from reviewed `a93b5e376d0e096603af61462a2856ed2838eccd` on
`feat/154-management-settings`. No Phase 3C/3D, PR, merge or unrelated Browser work.

### Navigation and ownership

Repository now contains **Overview / Branches / Worktrees**. **Advanced —
Transitional → Existing Git Tools** contains **only Stashes, Remotes, Merge and
History**, using their unchanged implementations. Branches and Worktrees have no
copies in that destination. Later Phase 3C/3D work must migrate those remaining
sections and perform final cleanup/polish, not create another Git controller.

`GitButton` still owns polling, branch/status lists, action hooks, errors, busy
state and scoped VCS metadata. `GitRepoMenu` owns page selection only. Branches
reuses `GitBranchesSection` and `useGitBranchActions`; Worktrees mounts one
`GitWorktreesSection`, only on that page. Navigation dispatches no mutation, adds
no polling or reconciliation subscription, and retains the app's one existing
reconciliation owner. Loading/empty/error states are explicit. Lists use the
shell's content scroll, not a tiny dropdown-height list; long names and paths wrap.

### Branch guards

- The page identifies the native current branch / detached HEAD, shows all local
  branches and contextual Switch/Delete controls, and explains the current-branch
  and other-worktree restrictions. Create retains main's branch-name validation;
  failed drafts and Git errors remain available. Pending actions never manufacture
  a current branch: successful operations refresh native status and branch state.
- The existing `GitDeleteBranchDialog` still separates ordinary deletion from
  explicit force escalation. Only `blockedByUnmergedCommits` offers force; Cancel
  never mutates, and a worktree-protected branch cannot be forced by the UI. Both
  entry and confirmation refuse the current branch, including one that became
  current while confirmation was open. Git remains the authoritative last check.
- The hook prevents overlapping dispatches, checks scope after awaited calls and
  never refreshes or publishes a late old-scope acknowledgement. Provider badges,
  validated deep links and provider refresh stay on Branches; unknown/loading or
  authorization failures do not offer a guessed Create PR action.

### Worktree guards and reconciliation

- The permanent page includes Git's **main checkout** as a protected inspection
  row, plus linked managed/unmanaged/in-use/locked/missing checkouts. The compact
  isolated-agent repair consumer still excludes main. No creation UI was added;
  creation remains New isolated agent. Renderer usage is advisory: main rechecks
  terminals, agents, dev services, open roots and equivalent SSH hosts.
- Managed removal remains `removeWorktreeCheckout`: release acknowledged by main,
  remove the renderer context, inspect, then remove with native branch identity.
  A failure after release leaves files/branch intact and the checkout unmanaged;
  no automatic adoption or rollback. Unmanaged removal remains
  `removeUnmanagedWorktree`, which refuses attached contexts and main. Dirty,
  untracked/ignored files, reservations/journals/recovery and backend ownership
  restrictions remain intact. No force removal or permission widening.
- Unlock is separately confirmed, with the lock reason and intentional-lock
  warning. It never automatically removes anything. Prune removes Git's stale
  repository records, not branches/files; Forget re-runs main reconciliation and
  only forgets unused, still-gone Clanker registrations. The confirmations keep
  their existing exact semantics and default Cancel focus.
- Each local worktree operation re-lists once and requests the existing coalesced
  reconciliation. Its parent refreshes authoritative Git data **without** bumping
  the worktree reload key again. Explicit Refresh worktrees uses that same section
  loader. No unattended SSH poll was introduced. Unmounted/superseded list results
  cannot publish data or launch a follow-up reconciliation.
- Sequential removal helpers now recheck the workspace environment/root between
  release, inspection and removal so an old acknowledgement cannot dispatch the
  next step into a replacement root. Central reconciliation similarly rejects
  results for a replaced environment/root. Main authorization is unchanged.

### Scope distinctions and remaining restriction

| Operation / location | Authoritative scope and Phase 3B behavior |
| --- | --- |
| Repository-level worktree inspection | Git lists the repository relationship via a registered workspace ID and scoped Git executor; listed paths select entries, never grant filesystem authority. Main checkout is inspection-only. |
| Workspace checkout branch/commit/switch operations | Existing Git IPC resolves the registered workspace's own root/environment. The displayed path is descriptive only. |
| Selected isolated checkout | `gitManagementScope` continues explicit fail-closed restriction, including Worktrees navigation. This intentionally does not substitute parent-repository inspection or mutations. Open the checkout as a workspace to use the existing authorized path. |
| Agent-specific directory | Main-reported registered checkout identity influences selection, not execution binding. Arbitrary reported cwd, launcher choice, `mainCheckoutPath` or branch name never authorizes Git or removal. |

Direct selected-checkout operations require a separately reviewed IPC contract:
resolve `workspaceId + checkoutContextId` in main to the exact registered context,
validate its own canonical root/environment and reservations, preserve that identity
across async execution/status/polling, and distinguish repository inspection from
checkout mutations. Agent location must not silently rebind the transaction. This
phase adds no such contract, broadens no IPC permissions, and installs no remote
helper/daemon. Scope changes retain Phase 3A's close/reset policy.

### Management lifecycle and verification

The shared Dialog/AlertDialog still owns focus, topmost Escape and Browser leases.
Navigation/close/outside dismissal is blocked while a branch confirmation or
worktree confirmation/operation is active; scope changes still close/reset and
never retarget requests. Nested confirmations keep the parent mounted/suppressed,
Cancel returns to its page, and normal close restores the live toolbar trigger.

- Final `env PATH=/usr/bin:/bin npm run validate`: **372 files / 7,708 tests
  passed**; branding, lint, typecheck, Fallow, security and build passed
  (`/tmp/154-3b-validate-final.log`). Existing audit exception and bundle warning
  remain unchanged. The normal inherited-PATH run passed all checks except three
  real session-history test timeouts: its globally installed OpenCode CLI invokes
  bounded native history discovery under an isolated HOME. A diagnostic 60-second
  timeout run passed in 97 seconds; the same tests at their **unchanged default
  timeout** passed with system-only PATH in under one second. No unrelated test,
  timeout, session-discovery code or installed CLI was modified to conceal this.
  Final validation excludes optional global harness CLIs, as ordinary CI does.
- Focused Git/VCS/checkout/Source Control/CommitDialog/Header/Settings regressions:
  **60 files / 1,382 tests passed** with the same isolated PATH
  (`/tmp/154-3b-focused-final.log`). New tests cover navigation/single polling,
  branch validation/current/detached/switch acknowledgement, delete/cancel/force
  escalation/errors/late scope changes, PR deep links, protected main/managed/
  unmanaged/in-use rows, one unlock reload, stale lists, cross-root sequential
  removal and reconciliation. Existing dirty/untracked/ignored, release/refusal,
  unlock/prune/forget and SSH ownership tests retain their destructive assertions.
  Isolated **real Git** fixtures additionally check normal-vs-force deletion,
  current/other-worktree protection, validation and switching failures.
- Source Control Electron smoke passes all four destinations, long names/paths,
  main/unmanaged/locked/missing rows, nested branch/worktree Cancel, real
  CommitDialog, native Browser suppression/restoration and trigger focus in
  Dark/Light/Slate at 1100×760 and 640×480. Reviewed screenshots in
  `/tmp/clanker-source-control-visual-hzN6iY`; content scrolls independently and
  controls remain reachable without horizontal overflow. Log:
  `/tmp/154-3b-source-smoke-final.log`. Native fixture mutations are confined to
  its temporary repository; UI destructive confirmations are cancel-only.
- Unchanged Settings Electron smoke and full-renderer Browser smoke pass
  (`/tmp/154-3b-settings-smoke.log`, `/tmp/154-3b-browser.log`).
- Separate native multi-Browser runner still exits **SIGSEGV**
  (`/tmp/154-3b-multi.log`); it is not counted as a passing smoke.

Real authenticated provider PR/CI, live SSH mutations/recovery, Windows/macOS
desktop focus, high zoom/OS scaling and screen readers remain owner smoke. No
unrelated Browser internals were changed. No Phase 3C/3D, PR or merge is included.

## Reviewed Phase 3A

Scope: application Settings through Phase 2B and Source Control foundation / Overview through Phase 3A. Phase 3A starts from reviewed
`18348cabfebd6bb4aa11d7973a35348ad1205e1c` on `feat/154-management-settings`.
No Phase 3B, PR or merge was included in that reviewed commit.

## Phase 3A — Source Control foundation

- The toolbar's **Source Control** opens a separate shared Dialog / ManagementShell,
  initially **Overview**. It is not a Settings page. Git Preferences and
  Authentication remain application preferences / credential management in Settings.
- `GitButton` remains the sole Git controller: existing polling, action hooks,
  scoped VCS snapshot and main Git APIs remain authoritative. There is no new Git
  store, persistence, service, IPC, subprocess or authorization path. Removed
  `GitMenuHeader` and the dropdown's outside/Escape/viewport/suppression ownership;
  shared Dialog owns those responsibilities. The ManagementShell type now omits
  native DOM `onSelect` so its navigation callback has one unambiguous signature.
- Overview presents the actual working root, environment ID, checkout context,
  current branch / detached HEAD, upstream, ahead/behind, file count, operation,
  provider repository and native PR/CI metadata. Commit / Refresh and the existing
  Fetch / Pull / Push / Publish controls are prominent. Unavailable status,
  authorization errors, unsupported providers and failed discovery never become
  confirmed PR absence or guessed checks. No new provider action is synthesized.
- **Existing Git Tools** is the explicit transitional destination for the complete
  existing branches, worktrees, stashes, remotes, merge/abort and history/diff
  implementations. It is intentionally not the Phase 3B page redesign. Destructive
  confirmations, notifications, validated external links, checkout removal guards,
  SSH host/reservation protections and main-owned execution remain unchanged.
- `gitManagementScope` is descriptive, not authority. Git IPC currently authorizes
  the registered **workspace root**, while provider metadata can target a checkout.
  For a selected isolated checkout this phase fails closed with an explanation:
  it does **not** silently run parent-repository Git operations. Opening that
  checkout as its own workspace remains supported. Unregistered/missing selections
  and inactive workspaces are also refused. `mainCheckoutPath` grants no access.
- Scope identity includes workspace, environment, canonical selected root and
  selected checkout. A changed scope remounts the controller and closes all its
  dialogs; old async results cannot update the new UI or scoped VCS snapshot.
  Action entry points and post-action refresh recheck liveness/scope. Request
  generations discard superseded metadata/diff responses. Initial remote discovery
  uses the existing single loader rather than a second startup read.
- Non-repositories retain explicit initialization and main/master selection through
  the existing `gitInit` path. Unknown status disables initialization. Existing
  CommitDialog is nested over Source Control, preserving continuous Browser
  suppression and returning to Overview on cancel. Shared primitives trap focus,
  own topmost Escape and portal confirmation dismissal; closing returns focus to
  the live Source Control trigger. There is no custom Browser visibility code.
- New `SourceControl.test.tsx` covers truthful metadata, actual remote-hook calls,
  publish failure, init, nested real CommitDialog leases, focus, scope reset and
  rejection of parent substitution. Existing GitButton and real worktree ownership
  tests navigate the transitional destination; inspect/remove/unlock/prune/stale
  checkout assertions are preserved.
- `npm run smoke:source-control` uses an isolated local Git repository/profile and
  a real native Browser. It checks Dark/Light/Slate at 1100×760 and 640×480,
  Overview geometry, transitional worktree confirmation (Cancel only), real
  CommitDialog, continuous native suppression/restoration and trigger focus.
  It neither authenticates nor exercises real network fetch/pull/push.

### Phase 3A verification and remaining owner checks

- Full `npm run validate`: **372 files / 7,681 tests passed**, including branding,
  lint, typecheck, Fallow, security and build (final log:
  `/tmp/154-3a-validate-final.log`).
- Focused Git/VCS/checkout/renderer regression suite: **60 files / 1,355 tests
  passed** (`/tmp/154-3a-focused-final.log`). An initial parallel run timed out in
  the real session-worktree history test; its isolated retry and subsequent complete
  focused run passed without changing that test or its timeout.
- Source Control Electron smoke, unchanged Settings Electron smoke and full-renderer
  Browser smoke passed. Reviewed responsive theme screenshots in
  `/tmp/clanker-source-control-visual-W7Mt2p` (primary actions remain visible at
  640×480). Logs: `/tmp/154-3a-source-smoke-final.log`,
  `/tmp/154-3a-settings-smoke.log`, `/tmp/154-3a-browser-renderer-final.log`.
- Separate native multi-Browser smoke: **SIGSEGV**, reproduced again
  (`/tmp/154-3a-multi-browser.log`); not counted as a passing smoke.

Real authenticated provider PR/CI, local/SSH network Git operations, Windows/macOS
focus, high zoom / OS scaling and screen-reader checks remain owner tests. The
separate multi-Browser native smoke remains an independently reproduced SIGSEGV;
this phase does not alter unrelated Browser internals to conceal it.

## Earlier Settings phases

Scope: application Settings foundation through Phase 2B. Phase 2B starts from reviewed
`2c9a207787111e4961606a478096a51583b168a9` on `feat/154-management-settings`.
Authentication, SSH Targets and control-level search are canonical Settings surfaces;
Legacy Settings and the competing credential/SSH dialogs are removed. Git operation
redesign remains a later phase. No main IPC, credential storage, SSH persistence,
provider API, instance authorization or launch-capability semantics change here.

## Source → destination and ownership

| Existing surface | Scope / state and persistence owner | Destination / extraction decision |
| --- | --- | --- |
| Appearance theme swatches | Application; `theme/themeStore.ts` → preload `setTheme` → main store. `themeRuntime.ts`, `terminalTheme.ts`, `editorTheme.ts` propagate the same identity. `global.css` supplies Dark/Light/Slate semantic roles, including scoped swatch previews. | Appearance reuses `ThemePicker`; no new theme state. |
| Appearance workspace Sidebar/Tabs | Application; `store/workspaceNavigationStore.ts` → `setWorkspaceNavigationMode`, main store. App chooses the toolbar placement. | Workspaces & Layout; extract `WorkspaceLayoutSettings`, keep the same SegmentedControl/store. |
| Keyboard Shortcuts dialog | Application; `store/keybindingStore.ts` → `setKeybindingOverrides`; shared keybindings own effective bindings, safety, formatting and conflict detection. Search/capture/pending conflict are ephemeral editor state. | Keyboard Shortcuts; extract the complete editor into `KeyboardShortcutsContent`, remove the obsolete dialog wrapper. Unmount clears capture listeners/state. |
| Harness Defaults (visibility, default model/favorites, flags, attention, MCP, Usage visibility) | App preferences in main `harnessDefaults`; `useHeaderSettings` loads/saves and discovers environment capabilities/models. `HarnessDefaultsSection` composes per-harness details; existing model picker owns search/favorite interaction. | Canonical Harnesses selector/detail view. `HarnessDefaultsSection` retains the existing model picker and saves; no account controller or accordion. No remote catalog probe on opening a page or changing theme. |
| Harness Accounts (default/managed, select/add/reconnect/remove) | Environment + harness; `HarnessAccountsRow`, main `accounts/harnessAccountService.ts` and account IPC own metadata, account homes/auth and selection. SSH managed accounts remain unsupported. | Canonical Accounts page only. Harnesses and Usage navigate there with exact harness/intent. No account controller remains in Harnesses or Legacy Settings. Existing account controller resets on environment/harness change, cancels old auth and ignores stale results/events. |
| Hermes Assistants enable/autostart/status | Local app service; `assistantsStore` snapshot/configure/refresh and main `assistants/`. Feature availability is still owned by existing component/service. | Reuse `AssistantsSettings` on the availability-gated Assistants page. |
| Git AI commit enable/provider/model | App preferences; `useHeaderSettings` → settings IPC/main store; `aiCommit.ts` generation is local-only. | Existing controls extracted into canonical Git Preferences. Not a Git operation redesign. |
| VCS SSH keys / provider PATs | Local credentials, main `credentialService`/`sshKeyService`, credential IPC; `CredentialSettings` and `vcsStore` compose status/action feedback. Secrets never move into renderer persistence. | Canonical Source Control → Authentication, composed by `AuthenticationSettings`; main owns all key/token operations and secret storage. Only public-key/status/validation metadata enters the shared VCS store; an entered token is temporary component state. |
| SSH target add/edit/test/remove/default root | Saved environment IDs in main; `SshEnvironmentManager` → SSH environment IPC/service. `OpenWorkspaceDialog` owns chooser selection and saved-list refresh, not the target's authoritative configuration. | Canonical Connections → SSH Targets, composed by `SshTargetsSettings` with the same validated configuration shape and main APIs. Open Workspace add/edit/server-root affordances deep-link here; no standalone manager remains. |

### Original Git inventory (Phase 0–2B; Phase 3A changes documented above)

All operations go through existing preload Git methods and main `gitIpc` /
`gitService`, with workspace/checkout validation and local/SSH execution. The
menu's scope comes from `GitButton`, `vcsCheckout` and authoritative agent location,
not a newly derived display path. `mainCheckoutPath` is not access authority.

| Current composition | Owner / behavior to preserve in eventual Source Control |
| --- | --- |
| `GitInitMenu` | GitButton init/default-branch state, non-repository empty state. |
| `GitMenuHeader`, `ProviderBadge`, `ProviderMenu`, `GitRemoteActionsSection` | GitButton status/branch/upstream/ahead/behind/errors/refresh; `useGitRemoteActions` owns fetch/pull/push/publish. VCS scoped snapshot/generation guards and truthful unknown/error provider states remain authoritative (#145). Commit opens existing `CommitDialog`. |
| `GitBranchesSection`, `GitDeleteBranchDialog` | `useGitBranchActions` plus GitButton listing/selection; create/switch/delete and destructive confirmations. |
| `GitWorktreesSection` | Its own reload/inspection/confirmation composition; checkout reconciliation and existing removal/release helpers, unlock/prune guards, context/terminal/service usage and SSH reservations remain unchanged. Its portal confirmation reports `onModalOpenChange` to the menu owner. |
| `GitStashSection` | `useGitStashActions`, GitButton list state; create with untracked/apply/pop/drop/clear and confirmations. |
| `GitRemotesSection` | Existing scoped preload operations, local edit/list feedback and callbacks; add/edit/rename/remove. |
| `GitMergeSection` | GitButton merge-target/operation/conflict/error state and existing merge/abort handlers. |
| `GitHistorySection` | GitButton history/diff state and loaders; working/commit diffs, loading/errors. |

`GitRepoMenu` is the section composition extraction point, not a second Git
controller. Before Phase 3A, GitButton had its own outside/Escape handling, viewport
placement, suppression count and modal-count guard. Those need deliberate review
in the Git phase, **not** changes during Phase 1.

## Overlay and interaction contracts

- `ui/README.md`, `Dialog`, `AlertDialog`, `Popover`, their CSS and
  `dialogLifecycle.tsx` are authoritative. Radix owns traps, topmost Escape,
  dismissal and nested portals; shared layer is 1000. Feature CSS owns composition,
  not a second palette/radius/control styling system.
- `BrowserOverlayLease` uses `useBrowserOverlaySuppression` and Assistant browser
  suppression. Store counts are the sole suppression owner. Global Settings omits
  an explicit workspace ID so its one lease follows the current workspace; closing
  or unmounting releases only that lease. Assistant-native views are also covered
  by the existing primitive. No force-mounted hidden content.
- `ApplicationSettingsProvider`, mounted once beneath App's stable
  WorkspacePaneDragProvider, owns the Settings dialog, page, Usage intent, search
  destination context and bounded Open Workspace handoff. It invokes the existing `useHeaderSettings` preference /
  discovery controller exactly once; Header reads launcher visibility and invokes
  the same entry point through a small React context. The hook no longer owns
  dialog presentation state. Page selection and account-harness intent live in that
  same provider. Authentication and SSH Targets are content, not competing modal
  owners; credential/key/target deletion uses the existing nested AlertDialog.
- Toolbar and `app.openSettings` (Ctrl/Cmd+,) invoke this stable app-owned state path.
  A fresh opening starts at Appearance; an already-open Settings keeps its page.
  Usage opens Accounts and selects its harness and requested Manage/Add intent.
  Settings is now modal: background toolbar controls cannot be activated until it
  closes. Navigation uses native buttons in `nav`, `aria-current="page"` and
  `aria-controls`; Tab/Shift+Tab and Enter/Space work without a new keyboard handler.
- `ManagementShell` is a small DialogContent composition with title/close,
  caller-owned grouped navigation and content, optional header-actions slot,
  independent navigation/content scroll. No settings schema, persistence,
  discovery, action controller or source-control identity logic lives there.
- Open Workspace → Settings acquires the incoming Settings lease before suspending
  chooser content. Return refreshes saved targets and mounts/focuses the same live
  chooser before releasing Settings. The local draft lives outside suspended Dialog
  content and is also retained when selecting a newly saved remote target and then
  returning to This PC. Exact IDs, not labels/order, identify targets; a removed
  target or refresh error safely falls back to local. A removed originating chooser
  is never reopened. Repeated returns and busy operation retargets are refused.
  Settings otherwise restores the provider's live toolbar ref, never a disconnected
  Header trigger. Shared Dialog primitives own traps/autofocus/dismissal; no manual
  native Browser visibility manipulation is introduced. Chat History and recipes
  remain Header-owned.
- Global pages stay open across workspace switches. Canonical accounts explicitly
  display their environment and reuse the controller's existing safe scope reset /
  rebind policy; workspace change clears Usage intent. No old authentication result
  is accepted into the new environment. These safeguards remain unchanged.
- Sidebar/Tabs takes effect immediately through the existing App layout. Header
  still remounts in its new location, but Settings and its navigation remain mounted
  under their independent app owner. Workspaces & Layout stays selected with the
  saved choice reflected immediately; the same Browser lease remains held until
  actual dismissal. No extra mounted dialog, persistent open-state storage, generic
  routing framework, second preference controller or new keyboard handler exists.

## Contextual surfaces remain contextual

Chat History stays workspace-filtered (`useConversationHistory`, late-result
protection, resume/recovery). Isolated Agent stays a fast checkout-bound launcher
and uses the existing Git management repairs. Workspace/tab/agent selection,
restore, Explorer menus, pane controls, Browser SSH previews/forwarding/dev services,
Usage quick monitor, Notification Center, Launch Recipes and checkout dev-server
configuration remain in their existing scopes and entry points. Open Workspace
remains the chooser; only its target-configuration affordances navigate to canonical
SSH Targets. None of its workspace browsing/opening capabilities become Settings actions.

## Verification and remaining owner smoke

Baseline was source/test behavior inspection, not pre-change screenshots. Reviewed
Header/HeaderRightControls/useHeaderSettings, Settings and Git compositions,
primitive/overlay/token/theme files and focused tests. Phase 1 screenshots come
from the isolated built-app `npm run smoke:settings` fixture (1100×760 and 640×480,
all four pages, all three themes). It asserts viewport bounds/no horizontal
content overflow, real native Browser hiding/restoration and trigger focus, plus
Ctrl+, and Escape. Screenshots are written to a reported temporary directory,
not production profiles. Run after build.

Automated interaction coverage includes theme DOM/persistence, navigation-mode
persistence, shortcut search/capture/safe binding/conflicts/reset/save errors,
page changes clearing capture, workspace-switch leases, account local/SSH scope
and auth cancellation, Usage Add/Manage, nested model pickers and credentials.
The existing full renderer/native Browser smoke remains applicable.

Owner interactive smoke still required: real SSH connections and real-account
sign-in/reconnect/cancel, Usage handoff with live readings, Windows/macOS key and
focus behavior, OS/display scaling and high zoom, screen reader use, and Assistant
native Browser with real Hermes. These are not claimed by fixture tests.

### Original Phase 0–1 results (reviewed commit `48ac61b`)

- `npm run validate`: passed (branding, lint, typecheck, Fallow, security, build,
  **368 test files / 7,605 tests**). Security retains only the project's existing
  documented dev-only electron-builder exception; Vite reports its existing large
  bundle warning.
- Focused Vitest run: **10 files / 217 tests passed** — SettingsManagement,
  HeaderOverlays, HeaderAccounts, KeyboardShortcutsContent, AppearanceSettings,
  Header, HeaderUsage, AssistantWithoutWorkspace, HarnessDefaultsSection, Dialog.
- `npm run smoke:settings`: passed, including immediate navigation-mode relocation
  and reopening with the saved choice. Visually inspected representative captured
  screenshots across Dark/Light/Slate and desktop/reduced dimensions; no horizontal
  overflow or overlapping controls observed. This is headless Electron screenshot
  review, not a live human OS/display or real SSH/account smoke.
- `node scripts/workspace-page-browser-renderer-smoke.cjs`: passed — real renderer
  leases/native views, 24 page transitions, stale geometry/delayed creation,
  overlay cleanup, minimize/restore/maximize/hide and workspace disposal.
- Existing `electron --ozone-platform=headless scripts/workspace-multi-browser-smoke.cjs`
  could not complete in this environment: Electron exited with SIGSEGV. Retries
  with GPU flags/clean environment also failed; the clean attempt logged X display /
  EGL initialization errors. No edits were made to that runner. Owner must rerun
  it on a supported desktop. The full built-app native Browser runner above and
  the new Settings-native fixture both passed.

### Focused ownership correction

Regression tests mirror App's conditional Header locations beneath one stable
provider and assert the actual TitleBar navigation mode/Header placement, the same
single dialog DOM node/page, selected radio, unchanged preference loading and
balanced suppression. They cover Tabs → Sidebar → Tabs with and without Browser,
close-time focus to the replacement trigger, Credentials handoff and Usage
Manage/Add after relocation. Existing local/SSH account tests remain in place.
The real Electron Settings smoke now verifies that relocation retains the same
dialog/page and hides the same native Browser, then restores that Browser and the
new toolbar trigger on close. It also tests Credentials after relocation and the
existing Ctrl+, route.

Correction verification:
- `npm run validate`: **368 files / 7,609 tests passed**, including lint,
  typecheck, build, Fallow, branding and the existing security policy.
- Focused component/integration run: **15 files / 306 tests passed** (App,
  SettingsManagement, Header/Accounts/Overlays/Usage/LaunchOwnership, Assistants,
  Appearance, Dialog, preference controller, shortcuts and isolated-agent integration).
- `npm run smoke:settings`: passed, including real native Browser suppression,
  same-dialog identity across both toolbar relocations, close-time focus and
  Credentials after relocation.
- `node scripts/workspace-page-browser-renderer-smoke.cjs`: passed again.
- The separate `electron --ozone-platform=headless scripts/workspace-multi-browser-smoke.cjs`
  was retried and still exits with SIGSEGV in this environment; owner desktop rerun
  remains required. No real account authentication or SSH connection was performed.

## Phase 2A — permanent agent and Git preference pages

- **Harnesses:** compact, wrapping selector with one detail panel. Visibility,
  model/favorites, flags, attention, supported MCP and Usage preferences use the
  existing `useHeaderSettings` owner. Missing/unavailable selection shows an inert
  fallback, not a substituted harness. Local/SSH scope is explicit. Remote catalogs
  are not probed here; saved selections/favorites and existing provider-native
  text/custom model entry remain available.
- **Accounts:** `AccountsSettings` mounts only the selected, available capability's
  existing `HarnessAccountsRow` / `useHarnessAccounts` workflow. Harness details
  contain only a Manage Accounts navigation action. Usage goes directly to Accounts;
  Add enters the existing form without starting auth, Manage focuses account info.
  A page/environment/harness change unmounts the old workflow and cancels its auth.
  Lifetime tokens also cancel an auth-start response arriving after unmount and
  reject stale list/mutation acknowledgements (including an A → B → A scope cycle).
  Loading failures are visible and expose an explicit Retry.
- **Assistants:** appears only for an available snapshot from the existing shared
  Assistants store; disappearance falls back to Appearance. Configuration, retry,
  status and lifecycle stay store/main-owned. Navigating the page configures or
  starts nothing. Ordinary Hermes harness configuration remains independent.
- **Git Preferences:** existing AI-commit enable/provider/model persistence only;
  saved unavailable models remain visible, and failures are reported. Generation
  stays local-only; no Git operation, repository, VCS credential or provider API
  implementation was changed.
- Serialisable harness descriptors now describe existing model presentation and
  attention transports, with registry parity tests against provider implementations.
  The renderer gates capabilities through descriptors, not a local harness-ID policy.
  The existing model loader ignores responses from old environment epochs and
  reports catalog/save failures; favorites return save rejections to the picker
  without rolling back a newer acknowledged preference snapshot.
- A minimal shared native `Checkbox` replaces repeated boolean-control styling in
  Harnesses, Assistants and Git Preferences; geometry/colors/focus remain centrally
  token-owned. Feature CSS adds layout/wrapping only. Obsolete accordion CSS removed.
- Legacy Settings now offers **Authentication (existing Credentials dialog)** and
  **SSH Targets (original Open Workspace manager route)** only. Phase 2B must move
  those to canonical pages/deep-links, eliminate Legacy Settings, and complete
  the lightweight control-level search specified by the issue. Neither Phase 2B
  nor the Source Control redesign was begun.

Phase 2A verification:
- `npm run validate`: **369 files / 7,623 tests passed** (branding, lint, typecheck,
  Fallow, security, build, full tests; existing dev-only audit exception unchanged).
- Focused regression suite: **19 files / 398 tests passed**, including permanent
  pages, account ownership/stale auth, remote saved favorites, descriptor parity,
  dialogs/focus, Usage routing, relocation and isolated-agent integration.
- `npm run smoke:settings`: all eight pages across Dark/Light/Slate at 1100×760 and
  640×480; native Browser hide/restore, viewport/overflow, independent scrolling,
  Sidebar/Tabs relocation, focus, Credentials and Ctrl+, route. Assistants uses an
  explicitly synthetic availability snapshot for presentation; no service launch
  or real auth is claimed. Accounts reads the isolated fixture profile's default.
- Screenshot review covered new destinations at both sizes and all three themes.
  The reduced-height navigation scrolls independently; controls remain reachable.
- `node scripts/workspace-page-browser-renderer-smoke.cjs`: passed again.
- Separate native multi-Browser runner still exits with SIGSEGV on this environment;
  owner desktop rerun is required. Real SSH and account auth/reconnect/removal,
  real Hermes startup, high zoom, platform focus and screen-reader smoke remain
  owner checks. Automated auth/account tests use safe mocked IPC projections.

## Phase 2A review corrections (after `5ee43b8`)

- Capability preferences are application-wide configuration, not permission to
  activate a capability in the focused workspace. Hermes attention is editable
  from Local and SSH Settings, with explicit SSH-only support guidance. Descriptor
  attention transport metadata determines the explanation and whether any launch
  supports it. The MCP preference is editable from both contexts for descriptor-
  eligible providers, with the existing local-only launch explanation. No per-host
  preference copies, extra toggles, or runtime attention/MCP gate changes.
- AI commit availability now has its own **local** capability snapshot inside the
  existing settings controller. Initial desktop discovery shares an in-flight
  `getHarnessOptions` request with local launcher discovery. Focus changes never
  substitute an SSH result or clear that snapshot. Existing launcher discovery on
  returning to Local can refresh it; equal provider availability does not refetch
  models. There is no new polling, global cache, or remote discovery path.
- AI commit models still use desktop `getHarnessModels` only. Saved provider/model
  values remain intact on discovery/model failures and unavailable providers; local
  discovery failure is reported explicitly. Persistence and its error reporting
  are unchanged. Regression coverage checks both opposite Local/SSH Codex
  availability combinations, pending SSH focus transitions, single initial local
  discovery, stable models, unavailable saved selections, and no remote model probe.
- Correction verification: `npm run validate` **369 files / 7,631 tests**; focused
  renderer/integration/descriptor regressions **19 files / 406 tests**. Settings
  Electron and full-renderer Browser smokes pass; separate native multi-Browser
  SIGSEGV and the previously documented live/platform coverage limits remain.

The preceding results describe the reviewed Phase 2A state. Phase 2B below adds
Settings search and the final configuration destinations; Git redesign remains untouched.

## Phase 2B — final Settings configuration surfaces

- **Authentication:** one embedded SSH-key or provider-token workflow. Existing
  credential IPC/services still own generation/deletion, encrypted tokens,
  supported-provider validation and public-key reads. Fingerprints are displayed
  when supplied by the existing API. Copy copies only the public key. Tokens are
  password inputs held only by the selected provider's temporary component state;
  Cancel, page/provider change and closing clear that entry. Save/remove results
  cannot update another provider or an unmounted workflow. Main-returned scopes
  and validation metadata are displayed as such, never guessed as `repo` or
  treated as repository authorization. Provider help/docs use the existing
  validated external-open path; GitLab explicitly distinguishes gitlab.com from
  separately authorized self-managed origins (#145). Git's SSH/credential helper
  remains separate from provider API tokens.
- The existing global credential status API performs provider validation. The
  Authentication content shares only an **in-flight metadata promise**, including
  across page/provider remounts, and drains it before a credential write. This
  avoids concurrent stale validation publications without changing main services
  or adding a persisted cache/controller. Failed retrieval is unknown/error, not
  an invented empty credential list; failed writes retain the entered draft.
- **SSH Targets:** single canonical list/add/edit/delete/test/default-root content.
  Shared SSH validation and the existing main endpoints retain the configuration
  format, transport/security policy, exact IDs and authoritative in-use rejection.
  Loading and mutation errors are explicit; failed edits retain their draft,
  refreshing the list does not reset it, and only explicit Test initiates SSH.
  Mutations disable navigation/search/close until complete; late results after
  unmount publish nothing. Duplicate labels have target descriptions for accessible
  disambiguation. The selected opaque ID is remembered for search navigation, not
  used as backend authority or copied into another configuration store.
- **Destructive actions:** key/token/target removal uses the shared AlertDialog,
  default Cancel focus and explicit confirmation. Cancel, Escape and opted-in
  backdrop dismissal never mutate. No JavaScript confirm/alert is introduced.
- **Search:** a small Popover/Input/Button composition, with static semantic
  control descriptors composed from existing harness and keybinding metadata.
  It spans theme/layout, individual shortcut editors, harness controls/accounts,
  available Assistants, Git preferences, keys/provider tokens and SSH target/root
  controls. No token, account name, saved target label/address/path or private
  configuration value is indexed. Results retain harness/provider/current
  environment and selected SSH entity context. Selecting reveals, scrolls and
  focuses stable IDs; it never clicks a control, changes a preference or starts
  auth, a process, service, SSH test or Git operation. Search-based Authentication
  navigation defers credential retrieval/validation until explicit refresh. Existing
  lightweight account/saved-target metadata loading remains with its page owner.
  Disabled/unavailable controls retain gating explanations rather than being forced
  interactive. A bounded observer stops on success, navigation or user focus movement.
  Arrow keys/Enter navigate; Escape first dismisses search without closing Settings.
- **Cleanup:** `LegacySettingsContent`, `CredentialSettings` and its lookalike CSS,
  `SshEnvironmentManager` and obsolete styles/tests are removed. No alternative
  workflow, new dependency, settings schema, Git controller or backend policy exists.
  The original Git inventory and Phase 2A local discovery/capability contracts above
  remain intact.

Phase 2B verification:
- Final `npm run validate`: **371 files / 7,666 tests passed**; branding, lint,
  typecheck, Fallow, security and build all passed. The existing documented
  dev-only electron-builder audit exception and Vite bundle-size warning remain.
- Focused component/integration/backend-policy tests: **32 files / 743 tests passed**.
  This includes credential and SSH IPC/service safety, provider origin boundaries,
  stale responses, pending validation/write cancellation, explicit confirmations,
  chooser drafts/IDs/return ownership, search focus/no-actions, shortcuts, toolbar
  relocation, account/Usage routing and prior settings/discovery regressions.
- Settings Electron smoke and full-renderer native Browser smoke passed. Settings
  covers all nine available pages, three token providers and search in Dark/Light/
  Slate at 1100×760 and 640×480; independent scrolling/viewport/overflow, same-dialog
  relocation, exact search focus, chooser acquire/return leases/focus, Ctrl+, and
  Browser restoration are asserted. Representative final screenshots reviewed in
  `/tmp/clanker-settings-visual-jNs9Uu`; no overlap/horizontal overflow observed.
  Assistants availability remains a synthetic presentation snapshot, not real service
  startup. Credential/target mutations and real authentication are not exercised by
  that isolated native fixture.
- Separate native multi-Browser runner retried and still exits with **SIGSEGV**;
  `/tmp/154-2b-multi-browser.log`. No unrelated Browser internals changed to hide it.
- Owner checks remain: real SSH test/save/in-use rejection against a live host,
  real credential save/remove/OS keychain and key generation, account auth, real
  Hermes, Windows/macOS desktop focus/key behavior, high zoom/OS scaling and screen
  readers. Main security/backend tests simulate boundaries; they do not establish
  live platform/credential correctness.
- No PR, merge or Git redesign. Stop here for independent architectural review.
