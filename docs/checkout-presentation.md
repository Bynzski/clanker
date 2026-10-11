# Observed checkout presentation (#159)

## Selection, identity and authority

One selector (`renderer/lib/checkoutSelection.ts`) drives Explorer, Source Control,
header dirty counts and status-bar checkout/Git labels:

1. An explicit file/editor-surface pin.
2. The focused terminal's **current authenticated observation**, if its checkout
   is registered to this workspace/environment and usable.
3. Its launch context **only when an observation is absent**.
4. The workspace's registered main root if there is no focused terminal.

Terminal focus clears the explicit pin. Selecting an editor tab pins that tab's
original context. Unknown provenance, historical/unavailable/unregistered reports,
and missing/released/invalid contexts show an unavailable reason; they do not
silently browse main or appear clean. An explicit valid pin can override an
unavailable observation. The implicit main root supports legacy workspace state;
no other root is synthesized or adopted.

The selector is presentation, not authorization. IPC still resolves the registered
workspace/context and confines access independently in main. Observations never
change `terminal.checkoutContextId`, editor identities, credentials, cwd or Git's
main branch. Individual agent labels remain their own last-reported/launch labels,
not the selected editor surface's label.

`locationProvenance` is published by the authenticated broker in the same revision
as lifecycle/location. `current` means matching native session, not instantaneous
cwd, recent wall-clock time or Running. `last-reported` means retained across a
native session boundary. Explicit lifecycle loss is `unavailable` until a new
accepted native location report. Children, mismatched sessions and stale retired
turns cannot refresh it. Idle/Done, history, lifecycle loss and elapsed time never
prove vacancy. Backend occupancy remains conservative and authoritative.

## One active Git snapshot

`checkoutGitStore` has exactly one active snapshot keyed by workspace,
environment, checkout context and canonical root. No historical cache or extra
poller exists. The established `GitButton` controller owns the canonical poller;
Explorer decorations, header counts and status-bar Git metadata consume its
matching snapshot. Successful known-empty status is clean; loading, failure and
unavailable selection are not. Last-known branch metadata is explicitly marked
as such when live Git status is absent. Explorer shows loading/unavailable text
rather than carrying dirty decorations over from another checkout.

Dirty counts deduplicate staged/working entries for the same relative path.
Explorer resolves relative status only under the selected root. Staged indicators
are square (and their tooltip says Staged); other indicators remain round and use
existing status colors, including modified and untracked. Absolute tree caches
and pinned editor buffers keep identical relative filenames isolated.

Selection epochs observe workspace/attention changes synchronously, including
A→B→A transitions batched by React, workspace/root-changing page switches and close/reopen.
A page change that retains the same physical checkout does not restart its poll/watch.
Git notifications carry a main-echoed presentation generation; old status and
old poll cleanup cannot affect a replacement controller. Directory responses
also require the selection epoch and latest per-directory request. Remote batch
notifications echo the selection generation. None of these tokens grant access.
Same-identity agent/source/branch changes do not restart polling or watchers.
Local editor watches remain pinned; SSH still has one bounded non-overlapping
focused-checkout batch, parking other-checkout tabs.

Inactive/Available/In use labels include live terminal launch bindings,
authenticated observed containment (including history/unregistered paths), and
live services. Tombstones/retired snapshots are not permanent occupants. Main's
release/removal/prune guards decide safety, not these labels.

## Read-only MCP

`clanker_context.checkout` still describes launch authority. Its separate
`observedCheckout` describes only the validated caller's broker evidence:
none/current/last-reported/unregistered/missing/released/unavailable, provenance,
a bounded registered branch/kind descriptor and match-versus-launch when known.
No observed absolute path, context/session ID, another caller or credential leaks.
It takes no identity arguments, does not refresh observation and changes no grants.
Later explicit registration of a formerly unregistered root does not rewrite its
old report; a fresh accepted native report supplies the registered identity.

Native location observation, resume in another checkout and same-turn live
relocation are independent. `providerCapabilities` states proven resume/rehome
support; it does not grant a tool or infer relocation from location. Existing
rehome transactions still resume the native conversation through their provider
strategy. Pi remains context-only; #138 remains on hold. No Pi runtime integration,
terminal-text parsing, automatic adoption or SSH MCP was added.

## Smoke procedure

Use only a disposable committed repository and two linked worktrees A/B. Follow
[checkout file smoke](checkout-files-smoke-test.md) for pinned buffers and CRUD,
and [remote VPS smoke](remote-vps-smoke-test.md) for a controlled SSH host (preserve
`clanker-test`; all destructive checks use a unique temporary fixture).

- Test counts/decorations for main/A/B dirty matrices: 3/0/0, 0/2/0, 3/2/0, 1/2/3.
  Include staged, modified and untracked files with identical relative names.
  Focus main→A→B→main, then select explicit editor pins; branch/root/count/decorations
  must describe the same surface, not another agent or the main checkout.
- Open/edit the same relative file in all three roots. Dirty buffers and saves stay
  with their original absolute identity through observed moves and missing/released
  contexts. Two agents sharing a checkout must not duplicate polling/watchers or
  clear expansions. Services and historical observations keep cleanup rows in use.
- Exercise accepted supported root location reports, child/mismatched/stale events,
  session transition without a fresh cwd, lifecycle loss, deleted worktrees and exit.
  Unusable evidence must show unavailable; only an absent observation permits launch
  fallback. Never infer a native cwd move from terminal text.
- Switch roots/workspaces/pages rapidly while Git/provider/directory/SSH responses
  are pending; no old result may become current, even on returning to the same root.
  Disconnect/reconnect SSH: no false deletion/clean status; monitoring must recover.
- Call read-only MCP from two authenticated callers with different launch/observed
  roots. Verify separate authority/description, no paths/foreign IDs/new grants and
  existing invalid-credential/closed-terminal rejection.

## Verification record

On this branch's implementation host:

- Automated renderer integrations cover the four main/A/B matrices, staged/modified/
  untracked decorations, one poll/watch for shared-checkout agents, explicit pin
  versus independent agent labels, dirty same-name buffers, historical/retired
  occupancy, delayed A→B→A status/directory replies and remote selection epochs.
  Common broker tests cover root/child/session/turn ordering, atomic provenance,
  same-path new-session reports and lifecycle-loss recovery. Main/MCP tests cover
  caller-only descriptors, missing/released/unregistered/history, local symlinks,
  untouched launch grants and generation-safe canonical polling/cleanup.
- `node scripts/checkout-presentation-smoke.cjs`: **passed** with the built Electron
  app, real Git/main/two worktrees, real PTYs/IPC/React and all four matrices. History,
  unregistered selection and agent retirement passed. Its location source is an
  **authenticated explicit fixture**, not native provider cwd movement.
- `node scripts/attention-electron-smoke.cjs`: **passed** simultaneous/background/
  four-workspace cold residency, minimized/hidden-page lifecycle, close/PTY exit,
  renderer revisions and persisted-workspace restart. Also an explicit fixture.
- Installed native CLIs with isolated profiles and loopback model fixtures (no paid
  inference): Pi **1.1.0** and OMP **18.4.10** passed ten turns, session replacement/
  resume, failure/interruption; Pi fork/native UI wait and OMP Stop continuation
  passed. Native cwd/provenance are checked on every turn; Pi matched its fixture
  spawn root, while OMP reported its native project parent instead (observation is
  not forced to agree with launch). Neither proves cross-checkout live relocation.
  Claude **2.1.296** passed ten native starts/Stop and same-turn native Read
  continuation; Stop remains provisional, not verified Done. Codex **0.162.0**
  exec/resume passed ten turns and trust-gated native hook delivery. The real-PTY
  Codex TUI smoke also passed ten turns, native approval/denial/cancel/interruption,
  parallel-tool and compaction cases. TUI `/new` lacks a previous-root link and
  visibly degrades rather than accepting an unrelated root; TUI `/quit`/resume and
  same-turn cwd relocation remain owner smoke items. Scripts:
  `native-attention-smoke.cjs`, `claude-attention-smoke.cjs`,
  `codex-attention-smoke.cjs`, `codex-attention-tui-smoke.cjs`.
- `node scripts/source-control-management-smoke.cjs`: **passed** real diffs,
  per-file/all staging, staged-only/explicit-all commits and isolated-worktree scope
  switching, plus three themes/two sizes/125% zoom, keyboard focus and native Browser
  suppression/restoration. Existing authorized mutation flows remain intact.
- **OpenCode gap:** installed **2.0.26** started its native server but the existing
  loopback smoke failed POST `/session` before inference or broker receipts (zero
  model requests/events). This run does not verify OpenCode native lifecycle/location.
  Shared mocked contracts are not a substitute for a successful native rerun.
- **Live SSH/native-location gaps:** no configured SSH smoke target was available.
  Equivalent-host/activity and SSH watcher behavior are automated mocked contracts,
  not live-host proof. Native multi-harness movement between checkouts, remote
  symlink spellings, destructive-dispatch timing and all Antigravity/Hermes behavior
  remain unverified here. No unsupported signal or relocation was fabricated.

Focused integration run: **18 files / 275 tests passed**, including all main real
integrations, file/observed-checkout/isolated-picker renderer integrations and real
editor-operation remote watcher/occupancy presentation regressions.

`npm run validate`: **passed — 390 test files / 7,896 tests**, including branding,
lint, typecheck, Fallow regression, security gate and build. The only audit exception
is the already documented dev-only electron-builder chain; no new dependency or
exception was added.

Run `npm run validate` as the final repository gate. Real-Git file/worktree/lifecycle/
Source Control integrations remain part of the suite; no mutation controller,
backend occupancy guard or host confinement was replaced.
