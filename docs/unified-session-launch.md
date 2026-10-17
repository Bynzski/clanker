# Unified session launch (#166)

## Implemented workflow

The toolbar harness pills and isolated-agent picker are replaced by one **New Agent** picker. It starts at the project checkout on every opening, showing its current branch and folder path (the branch need not be named `main`), supports Terminal and the same configured harness list, and retains the existing checkout-bound pane/spawn transaction. An explicit target never reads the focused agent's checkout selection. Git inventory describes choices; main validates/adopts the selected linked root before launch. A second session can share the same validated root.

The sidebar `WorkspaceCheckouts` inventory, main-root pin, selection, removal and repair controls are removed. Agent rows and project services remain. Editor tab pins, absolute file identities, focus routing, Git snapshots and observation provenance remain. Source Control Worktrees keeps the established removal, unlock, prune and recovery implementation. Its manual Create worktree action reuses the launch form in creation-only mode, with no session launch or harness controls.

New worktrees distinguish a new branch from an existing unoccupied branch. The **New branch starts from** selector identifies the project checkout’s current branch or a chosen Git-listed usable worktree as the source of the latest committed HEAD. To use an existing branch such as `main` directly, choose it under **Check out an existing branch in a new worktree**. New branches use a committed HEAD from the project or a chosen Git-listed usable worktree. Main re-reads Git and validates the source, including physical identity for local Git-listed roots; no source branch switch or dirty-file copy is involved. Creation without a session uses the same transaction and keeps its output on failure.

## Compatibility audit

- Recipes use `executeWorkspaceRecipe` and their stored launch configuration, not the toolbar pills. Preserve them.
- Native history/resume routes through `sessionResumeTarget` and `sessionWorktrees`, including explicit recreation offers and main-owned adoption. Preserve them independently of agent relocation.
- Checkout contexts are execution/filesystem grants, not worktree ownership. Retain registration, reservation, containment, occupancy and reconciliation checks.
- `clanker_create_isolated_checkout` and `clanker_complete_isolated_checkout` were registered only by main and granted by terminal/session launch. Their sole execution consumer was `IsolatedCheckoutService`; provider `checkoutRehome` adapters, internal replacement resume, relocation commit and renderer transition events supported that service. This entire chain and its MCP advertisement are removed. Ordinary Git/shell tools remain available to agents.
- `clanker_context`, bridge authentication and attention attachments remain. The read-only response retains `providerCapabilities.checkoutRehome: null` for consumers of the context schema; there is no relocation implementation behind it. The existing read-only `checkout.isolated` booleans still describe `kind: worktree`, preserving the response schema without ownership semantics. Native resume capabilities remain truthful.
- Screenshot and Electron smoke scripts now use New Agent. Explorer folder-terminal actions, explicit dependency-install shells, saved recipes and native history/resume retain their purpose-specific launch configurations.
- Historical assessment documents are evidence of prior behavior, not current API instructions.

## #170 diagnosis and recovery

A current authenticated native location without a registered context supersedes launch identity for file/Git presentation. This intentionally produces `unregistered-observation`; focus clears an editor pin and exposes the observation again. Registrations are runtime-only, so restart or externally created worktrees require explicit main-owned adoption. Discovery and cwd reports must not create grants.

New Agent does not use this presentation selection. Main is independently resolved from the workspace registration; an existing worktree is freshly adopted through Git/main even if it was previously registered. Files and Source Control remain unavailable until a validated agent/editor is focused. Opening a new session in a validated root is the recovery path; it never moves the old process or authorizes its external location.

## Verification

Verified on Linux on 2026-10-12 using disposable repositories and profiles. Owner-smoke follow-up: full validation passed with 391 test files and 7,700 tests.

- `npm run validate`: branding, lint, TypeScript, Fallow regression, security audit, production build and all Vitest tests. The existing documented dev-only audit exception is unchanged.
- Real Git/main IPC tests cover project/worktree committed-HEAD sources, strict new/existing branch modes, fresh validation of existing registrations, changed branches/locks and symlink replacement. Existing removal/recovery, reservations, occupancy, history and editor identity suites remain.
- SSH worktree tests execute the real Python host script against POSIX Git fixtures, including explicit branch modes and committed-HEAD creation. They exercise host logic without a live SSH transport.
- `npm run smoke:new-session`: built Electron, real Git/PTYs and UI; main default, external adoption, two sessions sharing one checkout, both committed-HEAD bases, existing branches, create-only, close retention, saved-profile restart, compact windows and 125% zoom. Screenshots are captured for visual review.
- `npm run smoke:checkout-presentation`: real Electron/Git/PTYs; agent focus, dirty matrices and generation identity, historical/unregistered location refusal, and explicit main launch while the old session retains its binding and unavailable file authority. Location reporting uses an authenticated fixture, not native provider movement.
- `npm run smoke:source-control`: real Electron/Git/Browser; three themes, compact/zoomed layouts, manual worktree creation without launch, checkout-scoped diff/staging/commit, retained drafts and confirmation/browser behavior.

Live SSH repository initialization and worktree creation are verified by the owner-smoke follow-up below. Native harness CLI/account/model acceptance with actual installed versions and credentials remains with the owner. No paid model calls or native Windows smoke were performed. Linux is the verified platform; Windows compatibility paths and tests remain. The issue stays open pending acceptance.

## PR #172 owner-smoke follow-up

The launcher is named **New Agent** throughout the toolbar, accessibility labels, guidance and current documentation. Terminal remains a launch choice; native session/history terminology and internal component/script names are unchanged.

Source Control distinguishes a verified non-repository from unavailable status. `getStatus()` returns `success: true, isRepo: false` only for Git's exact C-locale discovery diagnostic and exit status 128, followed by a main-owned local/host check that the directory is accessible and has no `.git` entry. This includes discovery stopping at a filesystem boundary. Missing Git/directories, permissions, broken gitfiles/corrupt metadata, cancelled commands and SSH transport failures remain errors. A bare repository is not treated as an initializable working directory.

Initialization independently reacquires status in main and rechecks the canonical physical root, live workspace/context identity and removal reservations before mutation. The renderer sends its selected checkout identity and ignores completions after focus/scope changes. Successful initialization sends refreshed, identity-tagged status and refreshes the current Git controller; its existing main-status path updates workspace `gitIsRepo`, enabling worktree choices immediately without reopening. No location observation grants filesystem authority.

Regression coverage includes local and SSH environment/IPC paths with real Git, init failures/retry, missing-root recovery, foreign identities, reservations, replaced registrations, closure during discovery, renderer poll epochs and stale init completions.

`CLANKER_SMOKE_SSH_TARGET=user@host npm run smoke:git-init` runs built Electron with disposable profiles and unique local/remote fixtures. The optional SSH host must meet `docs/remote-vps-smoke-test.md` prerequisites, including an existing `~/workspaces/clanker-test`. It checks real initialization, corrupt metadata refusal, a write-protected failure/retry, immediate create-only worktree creation, inaccessible-root refusal/recovery and saved-profile restart. Only the disposable app's Git polling clock is shortened; acquisition, IPC, validation and Git commands are real. Cleanup confines deletion to its recorded temporary fixture and preserves `clanker-test`.

On 2026-10-12 this smoke passed locally and over the saved g-lab SSH host. Native harness authentication/model execution and native Windows behavior were not exercised by this narrow follow-up.
