# Issue #154 — Phase 4 workflow assessment (owner review)

Assessment against reviewed Phase 3D `9b9f875051c27ebc8846a6fb456ca10d2a82d63f`.
**Proposal only: no Phase 4 UX implementation, PR or merge.**

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
- Commit-only-staged needs **no new Git backend** (gitCommit already exists), but
  does require an explicit product decision and a shared composer behavior change:
  do not silently stage all on entering Changes or submitting a staged-only
  workflow. Preserve any “stage all and commit” convenience only as an explicit,
  separately understood choice. No such change is implemented here.

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

## Owner decisions requested

1. Approve A (Changes-first + existing modal diff), B, or C.
2. Approve staged-only commit semantics versus an explicitly labelled stage-all
   convenience before selective staging UI is implemented.
3. Confirm isolated-checkout Git support remains a separate backend assignment.

Validation/correctness delivery results are recorded in the companion architecture
log: `issue-154-management-interface.md`. Stop for review before Phase 4 code.
