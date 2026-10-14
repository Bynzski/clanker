# Issue #182 — profile/cron integration for PRs #183 and #184

## Owner-authorized finalization on the actual main base

The owner explicitly granted visual acceptance after manual smoke testing of
both PRs and the combined implementation. After fetching/rechecking GitHub,
#183 remained at the reviewed `62c3400c643d0f2466680dae52aec6acbd70dcfe`
with green CI, no reviews/comments or conflicts, and no screenshot-path overlap.
It was merged using the repository-supported merge-commit strategy on
2026-10-14: **`991739bebcdabe41df8c1cac712a9e7093bc5427`**.
Issue #182 was found closed afterward and explicitly reopened; it remains
needed for the SSH inventory prerequisite and upstream API limitations.

The local-only rehearsal commit was located and verified as
**`8ddf1c5d5aa6b413a25ad73778c3e15273ce5d6f`** in the integration worktree.
Its parents are the reviewed #183 and original #184 heads. The merged main
has the same tree as the reviewed #183 head. The existing #184 branch
`issue-182-hermes-cron-visibility`, originally
`27cdc6282b05a0493ac0115ea2ca59b51a977fc0`, is updated non-destructively by
merging that actual main commit, retaining its original history.

The ten conflicts below were resolved with the already-reviewed **combined**
blobs, not by selecting either feature wholesale. The auto-merged projections
and appearance/cron CSS were checked, and additional rehearsal fixes/tests
were carried over. Before documentation/changelog updates, a full staged-tree
diff against `8ddf1c5` was empty: all integration code and regressions survive
exactly. The PR diff against merged main adds cron and the narrow integration
fixes, not another copy of #183's avatars/roster/types or screenshot work.
The Unreleased changelog records this follow-up and the merged appearance
behavior; no release/version/tag work was performed.

The refreshed local `origin/main` is the authoritative integration base. The
separate occupied local `main` worktree still owns screenshot commit `b345270`
and was deliberately not reset, rebased or merged as part of this task.
`hermes-glowup`, both original presentation/rehearsal branches and unrelated
worktrees are untouched.

### Actual #184-worktree verification

Full `npm run validate` and the combined installed-Hermes/built-Electron smoke
were rerun in `/home/jay/Projects/clanker-worktrees/hermes-182-cron` on the
actual merged-base implementation, not on the rehearsal branch:
**411 suites / 7,995 tests passed**, and the combined native smoke passed.
The final committed PR head is revalidated and smoke-tested before push;
its exact SHA and GitHub CI/mergeability receipt are recorded in PR #184's
updated description. Logs are `/tmp/hermes-184-final-head-validate.log` and
`/tmp/hermes-184-final-head-smoke.log` (ephemeral).

The existing fixture boundaries below remain: no user backend adoption or
profile modification, no paid/model turn, no executing cron job, no scheduler
start command, and only the intentional isolated Alpha canonical chat. Both
refresh controls, PNG/JPEG normalization, cosmetic save/CAS conflict and
namespace preservation, named/default overlap, ambiguous history withholding,
profile switch, reconnect/old-token refusal and privacy are exercised together.
No production code differs from the validated rehearsal. #184 is left open
and unmerged for final review. SSH discovery is explicitly deferred; the native
avatar read cap, cross-process CAS, repair-free GETs, owner-stamped history and
scheduler-health contracts remain upstream limitations, not solved here.

## Historical rehearsal acceptance gate and scope

GitHub was rechecked on 2026-10-14. Both PRs remain OPEN, CLEAN/mergeable,
with successful `changes`, `ubuntu-validation`, and `validate` checks:

- #183: `62c3400c643d0f2466680dae52aec6acbd70dcfe`
- #184: `27cdc6282b05a0493ac0115ea2ca59b51a977fc0`
- Remote main: `a39bf849b5a2b3d87377f7634e440f702e175ec9`

Neither PR had reviews or comments; the earlier preparation authorization
is not owner visual acceptance. **#183 was not merged. #184 was not updated
or pushed.** No release, issue closure, or GitHub comments were made.

The approved fallback is a local-only rehearsal on
`hermes-182-integration-check`, in
`/home/jay/Projects/clanker-worktrees/hermes-182-integration`, combining
#183 and #184 without modifying their branches. Its local merge is not an
integration into main. The branch must not be pushed as either PR.

`hermes-glowup` remains at `3b32f8c71c8ea3fd56348c5fc791dd915e2ba9fa`;
its screenshot ancestor `b34527094d6117632c2ef9409f56841080877c13` and the
separate screenshot workstream are untouched. Neither PR includes that ancestor.

## Conflict resolution and coexistence

Ten files conflicted: service, IPC registration/preload/constants/declarations,
Settings detail composition, IPC inventories/mocks, and the native smoke.
They were resolved deliberately, retaining both narrow API sets and tests.
Auto-merged projections and CSS were inspected as well: cron preview removal
must not remove appearance styles or weaken credential redaction.

The combined implementation retains:

- Main-owned PNG/JPEG validation, decoding, normalized thumbnails, bounded
  avatar queue/cache, generation rejection, and neutral unsupported fallbacks.
- Native-only cosmetic title/tagline writes with full namespace preservation,
  revisions, fresh preflight, authoritative postflight, opaque edit tokens,
  conflict/unknown-outcome handling, no blind retry, and unchanged profile ID,
  operational description, canonical chat, cwd and Browser ownership.
- Bounded on-demand cron reads, named/default namespaces, before/after job
  ownership checks, explicit owner-stamped execution records, withholding of
  unverified output, independent read states, and scheduler health **Unknown**.
  Default remains a Settings disclosure, never an Assistant/chat/Workspace.

### Narrow integration fixes

1. Cosmetic preflight/postflight roster reads previously collided with #184's
   unconditional detail/cron invalidation. These internal reads now retain
   valid pending cron work when native catalog names/homes agree. Explicit
   user refresh, namespace/home changes, disconnect, disable and shutdown
   still invalidate it. A cron read does not refresh/rebase cosmetic drafts.
2. The old appearance sibling effect could issue a full roster refresh after
   the detail sibling had begun its replacement cron request. The detail
   parent now sequences one native refresh before reloading both sections.
   `Reload values` uses that same coordination; older Assistant refresh
   completions cannot reset the next Assistant's draft or cron view.
3. A superseded roster reply cannot satisfy a cosmetic preflight from cached
   metadata. The private loader reports whether its result was accepted;
   a superseded preflight performs no configure call. Cosmetic fingerprints
   and live bindings also include the native profile home, privately, so a
   changed home cannot reuse an old baseline. These values grant no filesystem
   authority and never cross IPC.
4. The combined profile/history detail reads use the existing display-text
   redaction helper with the connection token and known native profile home
   **before truncation**, including capability names. This closes a partial
   credential/custom-home projection gap without exposing additional metadata.

No new Hermes functionality, scheduler mutations, forwarding, SSH discovery,
profile management, avatar replacement, or operational configuration was added.

## Verification

- Focused combined suites: **12 suites / 432 tests**, including **15 new
  integration regressions** across main and renderer.
- Full `npm run validate`: **411 suites / 7,995 tests**; branding, lint,
  typecheck, Fallow, security audit, build and tests passed. The only accepted
  high audit exception remains the documented dev-only
  `GHSA-ch52-4w7c-c8xp` electron-builder chain. Bundle/localStorage notices
  were non-failing. No Fallow exemption or dependency change was needed.
- The consolidated `scripts/assistant-details-smoke.cjs` passed with the built
  Electron app and real installed Hermes backend, including PNG and native
  JPEG normalization, missing-avatar fallback, Settings cosmetic save and
  native-file-writer CAS conflict, namespace/identity preservation, both
  refresh controls, default/Alpha/Beta overlapping cron IDs, ambiguous output
  withholding, unchanged healthy paused job files, profile switching, hiding,
  zero-workspace canonical fixture chat, focus return, disable/reconnect,
  previous-connection write refusal and privacy checks.
- Native recovery checks explicitly await authenticated read readiness rather
  than treating the first connected snapshot as stable. An earlier smoke
  assertion raced a transient probing state; it was corrected in the harness,
  not by retrying a write or claiming scheduler health. The smoke accepts only
  a conflict/unavailable refusal for an old token, never success; the controlled
  regression specifically verifies conflict after an established reconnect.

The smoke used installed source
`6e7b83a2f1c093e992a8d838ed77ea320fbd8e51` and Electron 41.10.7. A private
`HERMES_SMOKE_BIN_DIR` adapter called the installed Python 3.11
`hermes_cli.web_server.start_server` on loopback/port 0 with isolated HOME,
HERMES_HOME and user-data directories. This is a **backend fixture smoke**,
not verification of the normal user CLI/updater. No real user profile was
modified or backend adopted, no model prompt or paid turn was submitted,
no cron job executed, and no scheduler-start command was issued. The only
chat opened was the intentional isolated canonical Alpha fixture. Fixture
homes, owned backend and adapter were cleaned up.

Logs (ephemeral, not committed):

- `/tmp/hermes-182-integration-focused.log`
- `/tmp/hermes-182-integration-validate.log`
- `/tmp/hermes-182-integration-native-smoke.log`

Screenshots (ephemeral, inspected; **not owner acceptance**):

- `/tmp/clanker-182-assistant-appearance.png`
- `/tmp/clanker-182-cron-visibility.png`

No live SSH or native Windows verification occurred. Native avatar-read and
cross-process CAS limitations, repair/bootstrap side effects of native GETs,
unannotated history withholding and unknown scheduler health remain as
recorded in the Phase 1/2/3 evidence; this rehearsal does not remove them.

## Review disposition

The historical visual-acceptance gate above is superseded by the explicit
owner approval and actual-base finalization receipt at the top. #183 is merged;
#184 and Issue #182 remain open. No additional features or release work are
part of this integration.
