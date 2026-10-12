# Observed checkout presentation (#159)

## Selection, identity and authority

One selector (`renderer/lib/checkoutSelection.ts`) drives Explorer, Source Control,
header dirty counts and status-bar checkout/Git labels:

1. An explicit checkout or file/editor-surface pin.
2. The focused terminal's **current authenticated observation**, if its checkout
   is registered to this workspace/environment and usable.
3. Its launch context when an observation is absent, or when **historical evidence
   names that exact independently registered, usable launch context**. This latter
   case has source `launch`, not `observed`, and displays **Launch checkout · agent
   location last-reported**. The observation remains historical.
4. The workspace's registered main root if there is no focused terminal.

The sidebar lists Git's linked worktrees, including entries created outside Clanker.
Selecting an available row explicitly adopts/validates it before pinning the checkout;
inventory refresh alone grants no authority. The main checkout can be selected again.
Pins survive ordinary updates on the same page; changing page or terminal focus clears them.
The ordinary harness buttons launch in that selected, authorized checkout. The isolated
agent picker can also create a checkout without launching a process.

Terminal focus clears the explicit pin. Selecting an editor tab pins that tab's
original context. Unknown provenance, historical disagreement, unavailable/unregistered
reports, and missing/released/invalid contexts show an unavailable reason; they do not
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
cwd, recent wall-clock time or Running. `last-reported` means evidence has no matching
bound native root (including retention across a native session boundary). A location-only
startup report does not itself bind a session. Explicit lifecycle loss is `unavailable` until a new
accepted native location report. Children, mismatched sessions and stale retired
turns cannot refresh it. Idle/Done, history, lifecycle loss and elapsed time never
prove vacancy. Backend occupancy remains conservative and authoritative.

## One active Git snapshot

`checkoutGitStore` has exactly one active snapshot keyed by workspace,
environment, checkout context and canonical root. No historical cache or extra
poller exists. The established `GitButton` controller owns the canonical poller;
Explorer decorations, header counts and status-bar Git metadata consume its
matching snapshot. Successful known-empty status is clean; loading, failure and
unavailable selection are not. Available checkout + pending/missing snapshot shows
**Git loading…**, never checkout unavailable. A failed refresh shows **Git status
unavailable**, retaining the valid checkout's branch/root metadata. Only genuinely
unavailable selection shows **Checkout unavailable · <reason>**, with full guidance
in the tooltip and Explorer. Last-known branch metadata is identified as such until
matching Git status is ready. All three consumers use the same stateless availability
adapter over the existing snapshot; no status store or poller was added.

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
live services. **In use is not registration or authorization:** an agent's unregistered
worktree can be occupied in the launcher while Explorer/Git/status-bar selection
remains unavailable. This is not a contradiction and must not trigger automatic
adoption. Tombstones/retired snapshots are not permanent occupants. Main's
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
Likewise, registering nested B after a report authenticated as A cannot reinterpret
that report as B. MCP finds the original ID, validates its caller workspace/environment
and symlink-aware containment against **that context alone**, and preserves A. Invalid
containment is unavailable; missing/released original contexts remain missing/released.
Only a new accepted native event can resolve the location to B.

Native location observation and native resume are independent. `providerCapabilities`
reports resume support and keeps `checkoutRehome: null` for response compatibility.
Clanker's MCP create/complete and provider relocation pipeline were retired in #166.
New Session explicitly chooses a validated target without reading this presentation
selection; Explorer/Source Control still refuse unregistered observations. No
terminal-text parsing, automatic adoption or SSH MCP was added.

## PR #160 review corrections and screenshot investigation

Two independent defects were confirmed:

- MCP originally checked that reported A existed, then resolved its path across the
  entire updated registry. Registering nested B could therefore silently reinterpret
  old A evidence. The correction validates **only the authenticated original ID**;
  regressions cover nested registration, fresh reports, missing/released originals,
  foreign workspace/environment, inconsistent paths and retargeted local symlinks.
  Launch authority/grants and broker evidence are unchanged by a read.
- StatusBar used `!status` for both an available checkout with pending/failed Git
  acquisition and a genuinely unavailable selection, rendering the same generic
  message. This was a **Git-status presentation defect**, reproducible even with a
  valid registered `test1` selection and correctly scoped poll controller. Loading,
  failed acquisition and actual unavailable selection are now distinct in StatusBar,
  GitButton and Explorer. Failed main refresh preserves last-known branch metadata,
  never old counts/decorations or current/clean claims.

The exact owner screenshot state is **not recoverable from screenshots/terminal
statuslines**; the owner's dev Electron process had exited when investigated. A
missing/historical/unregistered observation could also legitimately block selection.
No genuine sidebar focus, poll-identity or generation defect was reproduced in the
controlled two-agent scenario. Dozin selected → main is correct; Darling's individual
`test1` label must stay independent, even while both panes are visible.

Trace: sidebar `AgentRow` calls `selectWorkspace(workspaceId, terminalId)` →
`revealTerminal` synchronizes global/workspace active terminal and clears editor pin →
`checkoutSelection` uses that terminal's authenticated snapshot/provenance (or launch
when absent) → `gitManagementScope` passes its registered ID/root to `GitButton` →
main validates the scope and owns the canonical poller → matching identity/epoch/
generation is applied to the single snapshot → StatusBar, Explorer and header counts
consume it. No terminal launch binding is modified.

The extended built Electron smoke checks **actual main and renderer state**, with an
OpenCode fixture in main and a Pi fixture in registered `test1`, in sidebar mode with
both panes visible: Pi without observation selects launch `test1`; a current report
changes only selection source; OpenCode selects main; Pi selects `test1` again. It
asserts active terminal IDs, main poll context/root/generation, renderer snapshot
identity/generation, branch, dirty counts/decorations and independent Pi label.
An authenticated explicit emitter is used, not native-provider relocation proof.

For an owner repeat, launch `CLANKER_DEBUG_ATTENTION=1 npm run dev` and query the
existing gated developer console view (query-only; no timers or authority changes):

```js
await Promise.all((await window.electronAPI.getAgentAttentionSnapshots()).map(async s => {
  const d = await window.clankerAttention.explain(s.terminalId);
  return { terminalId: s.terminalId, presentation: d?.renderer.checkoutPresentation };
}));
```

`checkoutPresentation` distinguishes workspace/global selected terminal, queried
terminal launch context, selected authenticated provenance **state only** (no native
session ID), canonical selection/root/reason and matching Git identity/state/generation.
Compare while selecting Darling then Dozin. A valid root plus Git loading/failure is
not checkout unavailability; a true unavailable selection includes its reason. Native
terminal text and **In use** alone cannot establish current registered selection.

Targeted renderer regressions use named Darling/Pi and Dozin/OpenCode rows, exercise
all ten focus/provenance/polling transitions, failure/recovery for worktree and main,
stale main response rejection, explicit editor override and occupied-but-unregistered
worktree rejection. Existing dirty-buffer, SSH and occupancy guards remain intact.

## Pi managed `test1` startup correction

Read-only inspection of `/home/jay/Projects/worktree-tests` confirmed Git lists main
and linked branch `test1` at
`/home/jay/Projects/worktree-tests-worktrees/test1-1b4f0e9851971998e732`, neither locked
nor prunable, with canonical paths and existing dirty files. Persisted provenance also
contains that exact local/main/test1 relationship. Context registrations and terminal
IDs are runtime-only; the original dev Electron had exited, so its exact IDs and
selection cannot be recovered. No user checkout, branch, Git registration or file was
changed to reproduce this failure.

Before edits, installed Pi **1.1.0** was run in that actual directory with an isolated
session/config directory, the normal attention attachment and zero model requests.
Its accepted native `session_start` emitted **`location_changed`**. The resolved ID
matched the validated launch context, but the broker's bound session was **null** and
provenance **last-reported**, even before any `session_shutdown`. Native `new_session`
then emitted shutdown/start with the same classification. The mapping already exists
on main at `0caf03f`: this is not missing Git registration, a mismatched checkout ID,
TTL expiry or a sidebar focus bug. **#160 introduced the user-visible failure by
rejecting all historical evidence despite independently valid agreeing launch authority.**

Two narrow corrections:

- The existing Pi adapter maps its native `session_start` to common **`session_started`**,
  binding its native root before any prompt/turn. It pins the adapter's root too, so
  unrelated sessions cannot poison startup. Native shutdown still clears the bound
  session and keeps genuine historical evidence; only a new accepted native start
  restores current provenance. No fabricated Running/Done or new observation channel.
- The canonical selector allows historical/launch **ID agreement** only after normal
  workspace/environment/root/missing checks pass. It selects the independent launch ID
  and marks the surface notice; it never promotes that historical report. Disagreeing,
  unregistered, missing/released/foreign, unknown or lifecycle-lost evidence stays
  unavailable (unless an authorized explicit pin selects a usable context). No main
  fallback, terminal rebinding, auto-adoption, grant or occupancy change.

Native built-Electron verification uses the normal existing-worktree launcher twice:
first attach in the isolated app profile, then close its terminal and **relaunch the
same managed context**. Actual launch path, validated local/worktree/test1 context ID,
selected global/workspace terminal, authenticated current provenance and matching
Git snapshot/poll IDs are queried from main and renderer. Main has **3** dirty paths,
test1 **34**; header/status/Explorer and Source Control follow the selected root while
both agent panes remain visible. Native TUI `/new` publishes historical → current,
without rendering checkout unavailable or changing same-checkout Git generation.
Closing the terminal retires its evidence; the retained context becomes Available
and relaunch reuses its ID. A surviving launch shell would still legitimately occupy
it. After app cleanup, hashes of tracked/unignored files, Git status and worktree list
are unchanged; zero inference requests. This verifies native startup/session
replacement, **not cross-checkout relocation**; main OpenCode remains an explicit fixture.

Reproduce without mutating the existing checkout:

```sh
npm run build
node scripts/checkout-presentation-smoke.cjs --native-pi \
  --existing-workspace /home/jay/Projects/worktree-tests
```

The mode fails closed on Git mutation commands, never runs dirty matrices against the
existing roots, and uses disposable HOME/app/Pi configuration and session storage.
Default smoke mode still runs destructive matrices only in its disposable repository.
Renderer regressions separately prove genuine agreeing-history launch selection and
its warning, historical disagreement, missing/released/foreign identities, explicit
pin override, focus switching, unchanged same-root generations, stale-response guards
and conservative occupied checkout labels. Native adapter/broker tests prove no-prompt
startup, mismatched-session rejection, historical shutdown and fresh native rebinding.

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
  Unusable/disagreeing evidence must show unavailable. Absent observation or genuine
  historical agreement with usable registered launch authority permits launch selection;
  agreement never makes historical provenance current. Never infer a native cwd move
  from terminal text.
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

Review-correction focused run: **9 files / 282 tests passed** (MCP observation,
canonical selection/snapshot/polling, StatusBar/GitButton/Source Control, two-agent
presentation and gated diagnostics). Extended `npm run smoke:checkout-presentation`
passed the actual main/renderer/poller identity checks and both-visible-pane focus
sequence, in addition to the existing four dirty matrices.

Initial focused integration run: **18 files / 275 tests passed**, including all main real
integrations, file/observed-checkout/isolated-picker renderer integrations and real
editor-operation remote watcher/occupancy presentation regressions.

Pi startup correction: **13 files / 283 focused tests passed**; both default fixture
and native existing-checkout built Electron smokes passed. Native Pi ten-turn loopback
smoke was re-run after the mapping change: new/resume/fork, native UI wait, failure
and interruption passed without paid inference.

`npm run validate`: **passed — 390 test files / 7,909 tests**, including branding,
lint, typecheck, Fallow regression, security gate and build. The only audit exception
is the already documented dev-only electron-builder chain; no new dependency or
exception was added.

CI follow-up: GitHub coverage run `38144536776` reached the final editor-pin portion
of the nine-dialog Darling/Pi–Dozin/OpenCode journey, then exceeded its aggregate
5-second test deadline; it did not stop at one unresolved async wait. The test now
scopes changed-count queries to its Source Control dialog and supplies a valid active
editor-tab fixture. Only that full journey has a 15-second budget; individual
`waitFor`/`findBy` deadlines, global defaults, assertions and production behavior are
unchanged. Five consecutive coverage runs restricted to two CPUs passed (922–978 ms
for the journey); full local coverage passed all **390 files / 7,909 tests**.

Run `npm run validate` as the final repository gate. Real-Git file/worktree/lifecycle/
Source Control integrations remain part of the suite; no mutation controller,
backend occupancy guard or host confinement was replaced.
