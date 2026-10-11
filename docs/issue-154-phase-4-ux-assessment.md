# Issue #154 — Phase 4 workflow assessment / approved Phase 4A–4D

Original assessment against reviewed Phase 3D `9b9f875051c27ebc8846a6fb456ca10d2a82d63f`.
Phase 4A starts from reviewed correctness commit `50b878b0c6542f79ef386707fb852059af559829`.
**Owner approved Option A and explicit staged-only versus stage-all commit policy.**

## Phase 4D — final polish and focused accuracy corrections

Baseline: reviewed `79dcfa046419e61267646c62c9cfd20a55769d93`.
The functional redesign is complete; this pass does not change navigation,
controllers, authorization, commit policy, diff backend or Browser internals.

### Decisions

- **Long lists:** Go to Commit appears directly after Changes' checkout/count
  summary and before any file action in tab order. It scrolls and focuses the
  existing textarea; it never stages/submits, creates another composer or opens
  another dialog. No fixed footer. Zero-entry sections keep their count and
  disabled All action without repeated empty paragraphs; a fully clean list has
  one clean-state notice. Filenames ellipsize on compact rows, retaining complete
  title/accessibility labels and the existing keyboard-accessible diff controls.
- **History:** the management content is the primary scroller, not a bounded list
  inside another scroller. The summary precedes the commit list, so selecting an
  exact full-SHA commit scrolls/focuses that summary heading without passing all
  loaded commits again. Working/Staged controls select explicitly labelled read-only
  summaries, never file patches or staging. Existing bounded Load More, metadata,
  request generations and error/loading states remain. Legacy non-management
  summary layout remains list-then-summary.
- **Accuracy:** checkout labels describe root identity (Isolated checkout,
  Workspace checkout/worktree), never a cached branch. Current branch comes from
  native status/branch state. Successful Create/Switch uses the existing canonical
  checkout reconciliation path to refresh descriptive metadata without re-keying
  the controller, checkout or draft. Branches explains selected-checkout switching
  and Git's other-worktree/current-branch protections accurately.
- **Remote outcomes:** native errors/rejections remain native failures. A successful
  remote command followed by failed refresh says the command succeeded, status may
  be stale and manual Refresh is needed. The existing canonical Changes refresh is
  reused, so failed status reads mark status unknown. Manual recovery clears the
  warning without executing the remote command again; pending/stale scope guards
  remain intact.
- **Presentation:** headings precede checkout context consistently; page refresh
  controls share the heading row where applicable. Overview retains repository,
  branch/upstream/ahead/behind, operation, provider/PR/CI and sync information but
  drops navigation-repeating copy. Its remote actions wrap at reduced height/zoom.
  Unknown provider/CI states remain explicit, not invented successes. No decorative
  card system or added borders.
- **Settings:** saved SSH roster comes before the editor; Edit still selects the
  exact target and focuses its label. No automatic connections, secret search or
  credential-policy changes. Accounts already retains the explicit harness in the
  one provider; a regression locks this in rather than adding persistence, guessing
  accounts or introducing another selection owner. First direct entry may still
  require an explicit supported-harness choice. Authentication, Harnesses, Search
  and General retain their existing page/control architecture.

### Review evidence and limits

Focused regressions cover 34 long filenames, keyboard composer navigation, exact
History summary focus and selection, isolated branch Create/Switch display plus
reconciliation, remote success/refresh failure for all four operations, SSH roster
ordering and Accounts return selection. Existing checkout/security/worktree,
keyboard/diff focus, destructive confirmation and Browser lease tests remain.

Both native management smoke matrices include Dark/Light/Slate at 1100×760 and
640×480 plus 125% app zoom at 640×480. Large-list and isolated 34-file composer
navigation are exercised without a duplicate form or fixed footer. Native screenshots
use Electron capturePage to avoid Playwright cropping a zoomed physical viewport.
Representative screenshots were inspected for overflow, action visibility, row
alignment, wrapping and composer focus; this is not live assistive-technology testing.
Exact results/logs/screenshots: `issue-154-management-interface.md` Phase 4D.

Remaining gate: independent final review and owner interactive visual/keyboard smoke,
including live SSH/auth/remote operations, OS scaling, Windows/macOS and screen readers.
The native multi-Browser SIGSEGV remains separately reproduced. No new scoped blocker
was found, but owner/final review is not replaced by headless fixtures. No PR or merge.

## Phase 4C implementation — Checkout-Aware Source Control (historical)

Starts from reviewed `a25bdaa94544dc8affc30189d52a5defe665ae84`.
Phase 4C addresses the functional limitation where Source Control was unavailable
for isolated worktree checkouts.

- When an active agent is operating inside a registered isolated worktree, opening
  Source Control operates against that specific checkout. The user can inspect status,
  review file diffs, stage/unstage, commit staged, explicitly Stage All & Commit, inspect
  history, view the worktree branch, and manage operations.
- The parent workspace checkout is never silently substituted.
- An unavailable, missing, foreign, or unregistered checkout continues to fail closed.
- `GitManagementScope` carries `checkoutContextId` along with `workspaceId`, `environmentId`,
  and `path`. Main validates the checkout context via `WorkspaceRegistry.resolveCheckoutContext`.
- Repository-level operations (listing worktrees, pruning, unlocking, remotes, branch
  deletions) execute against the registered repository root.
- A single polling loop in `GitService` tracks `checkoutContextId`; status events are
  checkout-specific, preventing crossover.
- Switching agents or checkouts closes Source Control safely; reopening re-initializes
  the controller with the newly selected checkout.
- A commit that succeeds followed by a failed refresh settles the submitted draft,
  marks status as unavailable, disables commit buttons, and requires a refresh.

## Phase 4B implementation — unified Changes workspace (historical)

Starts from reviewed `34b24caa75ed8ccb18298efd22c333ab671032f6`.
The owner approved consolidating review/staging/message/generation/submission
inside Changes, retaining Option A's existing modal file viewer.

- One compact file workspace, no duplicated staging toolbar/list: each staged or
  unstaged section owns its All action; status/path rows retain review and explicit
  Eye/View Diff plus Stage/Unstage. A permanent multiline composer follows the rows.
- Commit Staged is primary for indexed changes and stages nothing. Explicit Stage
  All & Commit is secondary for mixed changes, primary for working-only changes.
  Empty/clean/unknown status cannot submit; failed staging cannot dispatch commit.
- `GitButton` still owns scope/status/polling/mutations and holds one lock across
  stage-all → commit/hooks → canonical refresh. `useCommitComposer` owns only the
  scope-local draft/inference lifecycle; `CommitComposer` renders the form. Drafts
  survive History/Overview navigation and close/reopen in the same scope, not a
  workspace/environment/checkout replacement. Success clears; failure preserves.
- Local-only optional AI retains existing settings/configured backend IPC. Stale
  scope/status/request/edit results cannot replace a newer draft; failures stay
  visible. Same-scope navigation can receive a result without stealing focus.
  The existing all-change generation context is not a staged-only prompt backend.
- CommitDialog, its CSS, rendering/callback state and competing entry points are
  removed. Overview's Review Changes navigates within the same shell. No second
  commit page, standalone modal, new shortcut or presentation-owned Git command.
- Existing authorized DiffViewer lifecycle/HEAD-to-working-or-index semantics and
  Browser leases are unchanged. Pending mutations guard actions/navigation/close;
  progress/errors are explicit. Nested review returns to its row/page; successful
  submission returns focus to the enabled message field, shell close to its trigger.
- Meaningful old dialog regressions move to composer/Changes/controller/diff
  suites; obsolete modal/cancel/duplicated-list assertions are retired. Native
  smoke covers the single form, drafts/routing, real selective/all commits and
  Browser suppression in Dark/Light/Slate at desktop/reduced sizes.

Results/limits are in `issue-154-management-interface.md`. No inline/hunk diff,
new backend authorization, Settings/Browser redesign, release cleanup, PR or merge.
Stop after Phase 4B for independent review and owner visual testing. Live SSH/AI,
agent edits under load, OS scaling and assistive/native-platform checks remain
owner smoke; separate native multi-Browser SIGSEGV remains independently recorded.

## Phase 4A implementation (historical; composer superseded by Phase 4B)

- Changes is the initial landing page in the existing ManagementShell, followed by
  History, Overview, Branches and Worktrees; Operations stays Stashes/Remotes/Merge.
  Returning from a nested dialog preserves the selected page.
- Compact staged/unstaged groups expose actual file review in two clicks from the
  toolbar, per-file and all-file staging, refresh and the existing commit composer.
  `GitButton` still owns status polling, scope and mutation callbacks.
- `useFileDiffReview` and `FileDiffReview` are shared with CommitDialog and use the
  existing authorized `gitGetFileDiff` and modal DiffViewer. Selection, close,
  status revision and scope changes invalidate requests; no inline viewer or new
  diff engine. HEAD-to-working semantics remain explicit.
- Porcelain index/working sides now both appear for partially staged paths (MM,
  AM, RM, etc.); unique file counts do not hide either review entry.
- Commit Staged is primary when the index has changes and never calls stage-all.
  Stage All & Commit is explicit; ordinary form submission with only unstaged
  files does not stage them. Empty submission is disabled. One composer retains
  message validation, local-only AI generation, Git hooks and failure recovery.
- Overview retains identity/sync/provider/operation information; obsolete migration
  copy is gone. Management History contains commits and commit summaries only.

The findings and alternatives below are retained as the **pre-implementation
assessment**, not a description of current defects. Verification, limitations and
owner smoke are recorded in `issue-154-management-interface.md`. No Phase 4 final
cleanup, Settings redesign, PR or merge.

## 1. Confirmed usability problems

- **Review is hidden behind Commit.** Overview shows only a changed-file count.
  The actual list and file-level diff entry point are in `CommitDialog.tsx`.
  Today: Source Control → Commit Changes → file = three clicks from the toolbar,
  and reviewing another file requires closing the nested DiffViewer first.
- **History mixes two tasks.** `GitHistorySection` offers working/staged statistics
  beside commits. These are truthful summaries, not patches, and cannot substitute
  for pre-commit review. Keep conversation about repository history separate from
  working-tree review.
- **Selective staging and submission are not aligned.** CommitDialog offers Stage
  All, Unstage All and per-file unstage, but no per-file stage. `handleSubmit`
  explicitly stages all unstaged changes before committing. Moving that dialog
  unchanged behind a staged-file review can unexpectedly include excluded files.
  This needs an owner-approved commit policy, not a second commit implementation.
- **Stale migration help remains.** `GitOverview.tsx` still describes Stashes,
  Remotes, Merge and History as being in “Existing Git Tools”, despite the permanent
  navigation. Correct this copy in the approved UX work.
- **Settings Accounts requires a harness choice on direct entry.** There is no
  initial choice; Harnesses → Manage Accounts and search do carry the harness.
  This is safe but adds a step for ordinary direct navigation.
- **SSH target editing puts the form before the saved roster.** At compact heights
  users must scroll to find existing targets; Add Target is visible even though
  an add form is already open. No functional duplication, but unnecessary emphasis
  on creation for a management task.

## 2. Source Control navigation alternatives

Interaction counts start at the toolbar, assume a changed file exists, and count
opening Source Control plus navigation plus file selection (not loading time).
All alternatives retain Branches/Worktrees and Stashes/Remotes/Merge as management
operations rather than duplicating them in the review surface.

| Option | Landing / Changes | Commit placement | History / Overview | Review clicks | Complexity / ownership |
| --- | --- | --- | --- | --- | --- |
| **A — Changes first (recommended)** | Changes is first and default, with changed files and staged/working sections | One Commit action on Changes opens the existing dialog; Overview may retain a shortcut to the same handler | History stays commits-only; Overview stays repository identity, sync and provider status | **2**: open, select file | Low for initial modal diff reuse; controller keeps status and mutations; extract shared list/diff request lifecycle from CommitDialog |
| **B — Overview first + Changes page** | Existing Overview remains default; Changes directly below it, with a changed count and “Review changes” shortcut | Commit action on Changes and existing Overview shortcut, both same handler | History commits-only; Overview unchanged except links/copy | **3**: open, Changes, file | Lowest navigation churn, same extraction/ownership as A; adds a mandatory step to the common workflow |
| **C — Review workspace** | Changes-first split file list / inline DiffViewer content, with compact repository context | Commit action opens existing composer, optionally a collapsible composer later | History separate; Overview remains advanced repository context | **2**: open, select file; next file **1** | Medium: extract DiffViewer's read-only MergeView body from its Dialog wrapper, responsive single-column fallback, shared request state; no new backend but more focus/resize/lease tests |

**Recommend A, initially using the existing modal DiffViewer.** It makes review
available without entering Commit, needs no new diff engine, and avoids the inline
viewer lifecycle changes in C. Reviewing each additional file initially costs
close viewer + select file (two interactions); inline review is a later optional
iteration. B is the conservative fallback if retaining Overview as landing is
more important than minimizing review navigation. Do not add a standalone Commit
navigation page just to duplicate the composer.

Common actions: select/review, stage/unstage, Commit, status refresh. Keep sync
reachable in Overview and repository maintenance on its existing pages. Put
working/staged **summary** statistics on Changes only if useful, explicitly
labelled; never present them as complete file patches. History continues to use
its bounded list and exact-hash summary backend.

## 3. Architecture and capability boundaries

### Possible with existing components and IPC

- Keep `GitButton` as status/change-list owner: reuse its scoped polling,
  `onGitStatusUpdate`, `gitRefresh`, status errors and `isCurrent` boundary.
  Changes receives this snapshot; it must not start its own poller or status store.
- Extract the file list and file-diff request lifecycle from CommitDialog into
  shared review components/hooks used by both surfaces. Reuse `gitGetFileDiff`
  and `DiffViewer` (CodeMirror MergeView), including loading/error/binary/no-change
  states. Invalidate on selection, status version and scope change; discard late
  responses. Stage/unstage must invalidate/reload an affected diff.
- Existing `gitStage` supports a path array; per-file stage requires a shared
  controller callback, not a backend addition. Keep stage/unstage refresh and
  commit execution in the current scoped controller; do not copy mutations into
  Changes. Selection alone must never stage or commit.
- `gitGetFileDiff` accepts workspace identity through preload/IPC. SSH working
  content uses the registered environment's `readFile`, staged content uses Git;
  actual file diffs are not inherently local-only. AI commit generation remains
  local-only. Reuse current failures/capability messaging; no desktop filesystem
  fallback for an SSH file.
- The current file viewer compares **HEAD to working content or index content**.
  Do not relabel working output “unstaged-only” (index → working) without changing
  that contract. Preserve both staged/working identities for partially staged
  files; do not merge them by path into a misleading single row.
- Keep Source Control mounted during nested Commit/DiffViewer handoffs. Existing
  Dialog workspace overlay leases suppress native Browser views; avoid lease
  gaps, competing top-level shells or speculative Browser changes. Retest Escape,
  restored focus and compact windows for both nested surfaces.

### Requires backend capability (not part of the recommended first step)

- **Isolated checkout Source Control:** current `gitManagementScope` refuses a
  selected isolated root rather than substituting its parent. Keep that explicit
  unavailable state. Supporting it needs authoritative checkout-aware Git IPC
  scope/status routing, not merely passing a different path from renderer.
- Index → working diffs with exact unstaged semantics, hunk staging, arbitrary
  commit file patches, or history beyond the existing 50-entry bound require
  reviewed contracts/capabilities. Do not promise them in Changes.
- Commit-only-staged needs **no new Git backend** (gitCommit already exists).
  This decision was approved and implemented in Phase 4A through the one shared
  composer; entering Changes or ordinary staged-only submission never stages all.
  “Stage All & Commit” remains a separately labelled explicit choice.

## 4. Settings assessment

The permanent grouped shell is adequate; **no wholesale redesign recommended**.
Appearance/Layout/Shortcuts, Harnesses/Accounts/Assistants, Git Preferences/
Authentication, and SSH Targets reflect different ownership and capability scopes.
Authentication's Git keys/provider tokens are not harness logins or saved SSH
connections; combining them would obscure important security boundaries.

- Search is navigation-only, multi-term case-insensitive label/keyword matching;
  keyboard arrows/Enter/Escape work and results carry harness/provider focus
  targets. It does not search secrets, current values or saved target labels.
  Keep this distinction explicit; adding more aliases is renderer-only. Dynamic
  saved-target search is optional, not necessary for the first UX pass.
- Harness “Manage Accounts” and the Accounts page are entry points to one mounted
  workflow, not independent account controllers. Preserve environment scope,
  future-launch-only selection and unavailable SSH managed accounts. Optional:
  remember the last explicitly chosen supported harness rather than guessing an
  account/environment; leave Add/sign-in deliberate.
- SSH Targets already reuses one validated manager, explicit Test Connection,
  save, refresh and confirmed deletion; opening it never connects. Prefer saved
  roster above the editor, with Add Target revealing the add form. Maintain busy
  navigation guards and main's active-environment edit/delete refusal.
- Compact shell has separately scrolling navigation/content and wrapped labels;
  keep it. Nine destinations and long account/SSH forms increase scroll cost but
  do not justify replacing navigation. Prioritize roster/action visibility and
  validate at 640×480, keyboard-only and high zoom before further changes.
- Shortcut page search and global Settings search have different scopes, not
  duplicate preference ownership. Keep their labels clear.

## 5. Optional visual polish (not prerequisites)

Smaller identity/help blocks, count badges on Changes, tighter file rows and clear
staged/working headings. Consistent error/loading placement and concise capability
copy matter more than decoration. No new dashboard, activity feed, automatic
staging, auto-commit or speculative features.

## Owner decisions / review gate

1. **Approved and implemented:** A (Changes-first + existing modal diff).
2. **Approved and implemented:** staged-only primary commit with explicit
   Stage All & Commit convenience.
3. **Unchanged boundary:** isolated-checkout Git support is a separate backend
   assignment; no parent-root substitution or new authorization here.

Stop after Phase 4B for independent code review and owner visual testing. Settings
suggestions and inline review remain unimplemented. Validation results are in
`issue-154-management-interface.md`.
