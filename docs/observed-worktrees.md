# Observed worktree recovery (#210)

This is not native-launch integration (#181), live rehoming, or worktree ownership.
The Git-first New Agent launcher is unchanged. Agents may also create ordinary Git
worktrees themselves. A reported directory remains descriptive until main validates
and the user explicitly confirms a checkout root.

## Two field-backed cases

Retained development diagnostics distinguished:

- A root agent issuing `git worktree add` and Bash `cd` into same-repository sibling
  checkouts that Clanker had not registered.
- A main-checkout agent issuing Bash commands in temporary scratch/render directories,
  then retaining an unregistered observation even though native session metadata still
  named main. This is relevant to #192, not proof of that original incident's cause.

Claude's `CwdChanged.new_cwd` may describe an outside Bash excursion while subsequent
root hook `cwd` stays at the session directory. Conversely, native `EnterWorktree` and
`ExitWorktree` in tested Claude 2.1.303 changed the session directory without delivering
`CwdChanged`. Root `Stop.cwd` now refreshes the location in its accepted provisional-stop
publication. Stop is still **provisional**, never proof of successful completion. Child,
wrong-session and stale-turn events cannot move the root observation.

## Discovery

`ObservedWorktreeService` runs outside the synchronous attention resolver. The active
workspace surface debounces location changes (350 ms), not tool activity or ordinary
lifecycle revisions, and skips exact already-registered roots and explicit editor/file
pins. It invokes `INSPECT_OBSERVED_WORKTREE` with a terminal ID and expected revision.
The trusted renderer's main frame is required; shutdown refuses new requests.

Main derives workspace, environment and current native session from its live terminal,
registry and broker tables. Historical/unavailable/unknown evidence is rejected. Git
listing always runs in the original registered workspace's environment; desktop Git is
never used for an SSH checkout. Discovery is coalesced per terminal/revision and capped
at 16 concurrent requests and 256 listed worktrees. No persistent inventory, daemon,
per-tool SSH probe or new polling loop is introduced. Up to two bounded retries handle
lifecycle-only revisions racing a lookup; further errors require explicit Retry.

The most specific **Git-listed** containing checkout wins, including nested checkouts.
A `.claude/worktrees/...` checkout can otherwise match main by registered-root
containment, so discovery is not restricted to null context IDs. Normal subdirectories,
scratchpads, unrelated repositories, missing entries and main itself are not adoption
candidates. Provider directory conventions and terminal text are not evidence.

The reported directory is canonicalized through its environment. Only a Git-listed
candidate is probed with fixed Git metadata commands. Its physical top-level must match
Git's listed root and its canonical Git common directory must equal the workspace
repository's. A stale Git entry whose directory was replaced by an unrelated real
repository is rejected, not merely a symlink replacement. Discovery registers nothing.

## Confirmation and authority

The notice offers **Attach and browse…**, followed by confirmation naming the root.
`ATTACH_OBSERVED_WORKTREE` takes terminal/revision plus the displayed path/branch as
**expectations only**. Main rediscovers the candidate from live evidence; expectations
can reject a changed choice, never choose an arbitrary execution root. Duplicate
attachments are refused while one is running (16 globally at most).

Attachment reuses `adoptListedWorktree`. Shared explicit adoption now verifies physical
repository identity and rechecks Git inside a main-only pre-registration validator.
Workspace/observation cancellation and removal reservations are checked again before
publishing the context. Failed validation does not leave a newly registered grant.
Canonical paths, repository membership, branch, lock and environment are revalidated;
SSH unknown-removal reservations still block registration.

**Locked worktrees are described, not unlocked or attached.** In particular, a native
Claude worktree may carry a live-session lock. This PR preserves existing adoption
policy rather than removing that protection. Any future permission to attach a locked
observed root needs a separately explicit policy decision; there is no unlock shortcut.

A successful result is upserted only into the same still-live renderer workspace. Files
and Source Control are explicitly pinned to that registered context; the notice says
**Browsing attached checkout · agent launch unchanged**. **Follow agent** clears this
explicit pin. Normal terminal/page focus also clears it, as with existing editor pins.
Dirty editor tabs retain their original identities and buffers. A newer selection,
workspace/Assistant switch, close or batched A→B→A transition rejects late UI updates.

Registration never rewrites old broker evidence, advances native freshness, changes
`terminal.checkoutContextId`, restarts a harness, creates a Workspace, widens main's
root or deletes anything. A fresh accepted native report resolves against the newly
registered context. Until then, immediate browsing is explicitly selected authority,
not a claim that an old observation has become current registered evidence.

## Regression coverage

- Provider interpreter/broker tests reproduce the temporary-directory → root Stop
  correction and native enter/exit without CwdChanged; child/stale Stop stays ignored.
- Real disposable Git tests exercise sibling/nested checkout discovery, idempotent
  confirmation, normal/scratch/unrelated paths, replaced directories, locks, reservations,
  stale native identity, final-validation races and concurrency bounds. Environment
  fixtures exercise the SSH path too; they are **not** a live SSH smoke.
- IPC tests reject foreign frames/senders, shutdown, unknown terminals, stale revisions
  and caller-selected paths/branches.
- Renderer tests cover explicit confirmation/pins, unchanged launch/broker state, nested
  main matches, lifecycle coalescing, locked/error UI, dirty/editor pin preservation and
  late focus/workspace/Assistant results.
- `npm run smoke:attention:claude-checkout` uses the installed native CLI with isolated
  HOME, real Bash/Git and loopback responses (no paid inference). It asserts the outside
  Bash observation is corrected at root Stop. It is print-mode CLI, not built-Electron
  proof and not a claim about every installed harness version.

Existing bounded `checkout-observation` logs now capture a root correction alongside
its native Stop publication when location changes, so field triage need not reproduce
every affected conversation. They still contain no raw hook payloads or prompts.
