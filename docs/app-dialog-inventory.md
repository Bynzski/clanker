# App-owned dialog audit (#168)

Audited main, preload, renderer and feature flows on 2026-10-12. Searches included
`alert`, `confirm`, `prompt`, `showMessageBox` (including sync), `showErrorBox`,
`dialog.*`, `createPortal`, `role="dialog"`, `role="alertdialog"`, modal/overlay
classes and shared `Dialog`, `AlertDialog`, `ConfirmCloseDialog` consumers.
Domain callbacks named `confirm` (isolated checkout relocation) and harness prompt
text are not user-facing dialog APIs.

## Inventory and disposition

Paths below are relative to `src/`; grouped rows enumerate feature pathways that
share the same foundation. Inline feedback remains inline: this audit does not
turn ordinary validation or asynchronous notifications into blocking decisions.

| Pathway / implementation | Before | Disposition |
| --- | --- | --- |
| Close window, titlebar close IPC, application quit/menu/accelerator, Windows session-end (`main/main.ts`, `main/appCloseGuard.ts`, `main/ipc/windowIpc.ts`) | Electron `showMessageBox`, safe default | Migrated to `AppClosePrompt` → preload → always-mounted `AppPromptHost` → shared `PromptDialog`/`AlertDialog`. Main resource predicate and teardown retained. |
| Recipe deletion (`renderer/components/RecipeModal.tsx`) | `window.confirm` | Migrated to `requestAppPrompt`, explicit danger action and cancel default. Recipe save, launch, unavailable target and partial-launch errors stay inline inside shared `Dialog`. |
| Local/SSH File Explorer create, rename and delete failures (`FileExplorer/index.tsx`, `explorerActionHandlers.ts`) | Three `window.alert` calls | Migrated to `showAppError` → shared alert, with original error text and existing watch restoration. |
| Local/SSH file and directory deletion (`FileExplorer/index.tsx`) | `ConfirmCloseDialog` | Already shared `AlertDialog`. Existing consequences, dirty-tab handling, main confinement, Trash/remote delete and failure outcomes retained. |
| Unsaved editor tab and whole editor close (`EditorTabBar.tsx`, `EditorPane.tsx`) | `ConfirmCloseDialog`, Save / Don't Save / Cancel | Already compliant; Cancel receives initial focus, saves own asynchronous closing. |
| Workspace and terminal/session close (`lib/workspaceClose.ts`, `lib/workspaceTerminalClose.ts`, tabs/sidebar/pane consumers) | Explicit immediate close; no confirmation popup | No stock prompt. Existing disposal and failure notification behavior retained; adding new guards is outside this presentation audit. |
| Checkout remove, unlock, prune and stale-context forgetting (`WorkspaceCheckouts.tsx`, `git/GitWorktreesSection.tsx`, isolated picker repair) | `ConfirmCloseDialog` | Already compliant, shared across local/SSH operations; modal-open reporting to parent retained. No release-before-removal or safety changes. |
| Legacy local/SSH launcher worktree removal (`WorktreeLauncher.tsx`, `RemoteWorktreeInspect.tsx`) | Feature-owned inline `role="dialog"` without shared focus lifecycle | Migrated to `PromptDialog`, preserving clean inspection, captured path/branch, mutation guards and failure feedback. These legacy launcher components are not currently rendered by the startup flow, but remain tested. |
| Removed-worktree session recreation (`ChatHistoryDropdown.tsx`) | Feature-owned inline `role="alertdialog"` | Migrated to `PromptDialog`, explicit Recreate and resume choice; authoritative resume/recreation logic unchanged. |
| Branch deletion, drop stash, clear stashes, remove Git remote, abort merge/rebase (`git/Git*Dialog.tsx`) | Shared `AlertDialog` with safe cancel | Already compliant; existing busy/identity checks, consequences and inline errors retained. |
| Source Control, create commit, Git initialization/repository/provider menus, diff loading/binary/error (`GitButton.tsx`, `git/*`, `DiffViewer.tsx`) | Shared `Dialog` management shell or ordinary menu/inline status | Already compliant. No stock popup; menus are not confirmations. |
| Settings navigation/close (`settings/ApplicationSettingsProvider.tsx`, `SettingsManagement.tsx`) | Shared `Dialog` management shell; busy checks and SSH chooser handoff | Already styled; no native popup. |
| SSH key and PAT deletion; saved SSH target deletion (`settings/AuthenticationSettings.tsx`, `SshTargetsSettings.tsx`, `SettingsDeleteConfirmation.tsx`) | Shared `AlertDialog` | Already compliant; main credential/target ownership checks retained. Connection test, validation, save and permission failures stay themed `FormMessage`/inline feedback. |
| Managed harness account add/select/sign-in/cancel/remove/recovery (`HarnessAccountsRow.tsx`, `useHarnessAccounts.ts`) | Styled settings controls and inline feedback; external sign-in URL | No stock app prompt. Main account binding and active sign-in/launch checks retained. Browser/provider authentication is externally owned. |
| Assistant enable/autostart/refresh, profile/details/history/routines and connection failures (`settings/AssistantsSettings.tsx`, `assistants/*`) | Styled settings/surface controls and inline states | No stock prompt. Ordinary terminal interactions belong to Hermes. No dummy workspace introduced. |
| Local folder/open workspace, SSH folder browse/create, path validation (`OpenWorkspaceDialog.tsx`, `RemoteDirectoryChooser.tsx`) | Shared `Dialog` / management shell with inline feedback | Already compliant. Main path and SSH capability validation retained. |
| Launch recipe creation/edit/preview/launch (`RecipeModal.tsx`) | Shared `Dialog` | Already compliant except deletion migrated above. |
| Dev service settings, diagnostics and dependency installation (`DevServerSettingsDialog.tsx`, `DevServerDiagnosticsDialog.tsx`, `DevServerRow.tsx`) | Shared `Dialog` and `ConfirmCloseDialog` | Already compliant. Explicit install confirmation retained. Diagnostics include bounded output and Copy for agent. |
| Annotation handoff selection, send and error (`AnnotationHandoffDialog.tsx`) | Shared `Dialog` | Already compliant; native Browser suppression and broker eligibility retained. |
| Operational errors/warnings/recovery actions (`NotificationCenter.tsx`, `store/notificationStore.ts` and producers) | Themed notifications, Browser header slot and shared `Popover` history | Already styled nonblocking feedback, not destructive confirmations. Persistent warnings remain readable; no new modal required. |
| Editor/workspace render failure (`ErrorBoundary.tsx`, `App.tsx`); remote previews, session discovery/resume, harness discovery/launch, services, browser navigation errors | In-surface themed error/retry/status and notification feedback | Already styled; no stock user-choice popup. Fatal main exceptions log and execute existing fatal-exit handling, without an error message box. |
| File context menu, directory suggestions, harness/model pickers, docking/drag targets, terminal search, Browser toolbars and Assistant status overlays | Menus, suggestions, geometry/status overlays | Ordinary controls, not app confirmation dialogs. Shared popover foundations used where applicable. |

## Native and external exceptions

* `main/ipc/settingsIpc.ts`: `OPEN_DIRECTORY_DIALOG` and
  `OPEN_BASE_DIRECTORY_DIALOG` call Electron `showOpenDialog` for the OS folder
  picker. Platform filesystem selection belongs to the OS; cancellation still
  returns no selection. These are the only native dialog calls in app source.
* OS keychain/authorization, OpenSSH host-key/authentication, external browser
  OAuth/device sign-in, and prompts rendered by launched harnesses or visited web
  pages belong to those platforms/providers. They are not Clanker-owned choices.
  No Clanker `showMessageBox` / `showErrorBox` exception is required.

## Shared contract and lifecycle

`ui/PromptDialog` is a small presentation variant of existing `AlertDialog`, not a
new modal implementation. It uses the existing semantic colors, spacing, button
variants, focus trap/return and Browser overlay leases (workspace and Assistant).
The safe action receives focus. Enter on that action cancels, Escape cancels and
backdrop interaction does nothing. Explicit action focus/click is required to
confirm. Feature-owned asynchronous guards can disable both actions while busy.
Imperative feature prompts use a bounded FIFO (16 pending requests); quit takes
presentation priority. Existing specialized multi-choice guards remain on the
same shared AlertDialog foundation.

The close handshake has an opaque per-attempt ID and accepts only literal `true`
from the current window's main frame. Renderer readiness is declared only after
subscribing. Unsolicited/stale IDs, foreign frames/windows, and replacement-window
responses grant nothing. Abort, renderer unmount, reload, crash/destruction,
send failure or a two-minute deadline settle as cancellation. When there is no
ready renderer the app stays open; a later close attempt can retry. There is no
native fallback or forced quit on presentation failure. Main still intercepts
all existing close/quit paths, reserves one prompt, shares repeated intents and
owns resource checks and cleanup. Standalone dev service admission and fatal exit
policy are unchanged from #115.

## Verification

* `npm run smoke:dialogs` launches the built app in disposable profiles with real
  shell PTYs. It checks native window close, `app.quit()` and titlebar close IPC;
  repeated requests, backdrop, safe Enter, cancellation, approval, actual app
  exit and PTY termination. It also checks Dark/Light/Slate at normal and compact
  window sizes, native Browser suppression/restoration, safe focus, geometry and
  screenshots. No user's profile, shell or checkout is used as a fixture.
* Main tests cover close admission/cleanup plus the presentation handshake's
  sender/frame/ID validation, deadline, abort, reload, crash and retry.
* Renderer tests cover safe focus, focus return, cancel/confirm, queued errors,
  recipe deletion, create/delete/rename permission failures, local/SSH removal,
  shared dialog nesting and overlay lifecycle.
* ESLint rejects global/window `alert/confirm/prompt` and Electron
  `showMessageBox`, `showMessageBoxSync`, `showErrorBox` calls in application
  source. Native OS pickers are deliberately permitted.
