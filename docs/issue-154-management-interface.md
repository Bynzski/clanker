# Issue #154 — Phase 0 inventory / Phase 1 decisions

Scope: application Settings foundation only. Started from `origin/main` at
`c85bec0`; the full issue was read. Source Control migration, settings-wide search
and remaining canonical settings pages belong to later phases. No Git operation,
IPC, credential storage or provider semantics change here.

## Source → destination and ownership

| Existing surface | Scope / state and persistence owner | Destination / extraction decision |
| --- | --- | --- |
| Appearance theme swatches | Application; `theme/themeStore.ts` → preload `setTheme` → main store. `themeRuntime.ts`, `terminalTheme.ts`, `editorTheme.ts` propagate the same identity. `global.css` supplies Dark/Light/Slate semantic roles, including scoped swatch previews. | Appearance reuses `ThemePicker`; no new theme state. |
| Appearance workspace Sidebar/Tabs | Application; `store/workspaceNavigationStore.ts` → `setWorkspaceNavigationMode`, main store. App chooses the toolbar placement. | Workspaces & Layout; extract `WorkspaceLayoutSettings`, keep the same SegmentedControl/store. |
| Keyboard Shortcuts dialog | Application; `store/keybindingStore.ts` → `setKeybindingOverrides`; shared keybindings own effective bindings, safety, formatting and conflict detection. Search/capture/pending conflict are ephemeral editor state. | Keyboard Shortcuts; extract the complete editor into `KeyboardShortcutsContent`, remove the obsolete dialog wrapper. Unmount clears capture listeners/state. |
| Harness Defaults (visibility, default model/favorites, flags, attention, MCP, Usage visibility) | App preferences in main `harnessDefaults`; `useHeaderSettings` loads/saves and discovers environment capabilities/models. `HarnessDefaultsSection` composes per-harness details; existing model picker owns search/favorite interaction. | Legacy Settings for now; directly reuse, later Harnesses. No new probe on opening a page or changing theme. |
| Harness Accounts (default/managed, select/add/reconnect/remove) | Environment + harness; `HarnessAccountsRow`, main `accounts/harnessAccountService.ts` and account IPC own metadata, account homes/auth and selection. SSH managed accounts remain unsupported. | Legacy Settings inside existing harness details; later Accounts. Usage Manage/Add retains exact harness and intent. Existing account controller resets on environment/harness change, cancels old auth and ignores stale results/events. |
| Hermes Assistants enable/autostart/status | Local app service; `assistantsStore` snapshot/configure/refresh and main `assistants/`. Feature availability is still owned by existing component/service. | Reuse `AssistantsSettings` in Legacy Settings; later Assistants. |
| Git AI commit enable/provider/model | App preferences; `useHeaderSettings` → settings IPC/main store; `aiCommit.ts` generation is local-only. | Existing controls in Legacy Settings; later Git Preferences. Not a Git operation redesign. |
| VCS SSH keys / provider PATs | Local credentials, main `credentialService`/`sshKeyService`, credential IPC; `CredentialSettings` and `vcsStore` compose status/action feedback. Secrets never move into renderer persistence. | Existing Credentials dialog reached from Legacy Settings; later Authentication content extraction. |
| SSH target add/edit/test/remove/default root | Saved environment IDs in main; `SshEnvironmentManager` → SSH environment IPC/service. `OpenWorkspaceDialog` owns chooser selection and saved-list refresh, not the target's authoritative configuration. | Original Open Workspace target settings / Add server route retained and explicitly signposted in Legacy Settings; later SSH Targets. No duplicate manager/controller. |

### Git inventory (untouched)

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
controller. GitButton currently has its own outside/Escape handling, viewport
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
- Toolbar and `app.openSettings` (Ctrl/Cmd+,) invoke the existing Header state path.
  New Settings opens Appearance; Usage opens Legacy Settings and expands its harness.
  Settings is now modal: background toolbar controls cannot be activated until it
  closes. Navigation uses native buttons in `nav`, `aria-current="page"` and
  `aria-controls`; Tab/Shift+Tab and Enter/Space work without a new keyboard handler.
- `ManagementShell` is a small DialogContent composition with title/close,
  caller-owned grouped navigation and content, optional header-actions slot,
  independent navigation/content scroll. No settings schema, persistence,
  discovery, action controller or source-control identity logic lives there.
- Credentials still uses the existing acquire-before-close handoff. The outgoing
  Settings lease remains until Credentials autofocus, and outgoing focus return is
  suppressed. Credentials returns to the surviving Settings toolbar trigger.
  Shared Dialog focus restoration also covers triggerless shortcut/account opens.
- Global pages stay open across workspace switches. Legacy accounts explicitly
  display their environment and reuse the controller's existing safe scope reset /
  rebind policy; workspace change clears Usage intent. No old authentication result
  is accepted into the new environment. Phase 2 must retain these safeguards.
- Sidebar/Tabs takes effect immediately through the existing App layout. Switching
  navigation mode repositions/remounts Header and consequently closes Settings,
  as with the old dropdown; reopening shows the saved choice. No durable or duplicate
  settings-open state was introduced to override this existing behavior.

## Contextual surfaces remain contextual

Chat History stays workspace-filtered (`useConversationHistory`, late-result
protection, resume/recovery). Isolated Agent stays a fast checkout-bound launcher
and uses the existing Git management repairs. Workspace/tab/agent selection,
restore, Explorer menus, pane controls, Browser SSH previews/forwarding/dev services,
Usage quick monitor, Notification Center, Launch Recipes and checkout dev-server
configuration remain in their existing scopes and entry points. Open Workspace
remains the chooser, with its SSH target manager reachable there. Nothing routes
these capabilities through global Settings.

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

### Recorded results

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

Phase 2 must eliminate Legacy Settings, replace SSH-manager instructions with its
canonical page/deep-link, consolidate remaining pages and add lightweight control-
level search. No Settings-wide search or Git destination was implemented here.
