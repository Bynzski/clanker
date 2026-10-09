# Usage identity and coordinator (issue #149)

Usage readings are nonpersistent, environment-scoped renderer state. Managed account
identity, credentials and selection remain owned by the account service. Provider
adapters, TTLs, minimum refresh intervals and failure backoff remain unchanged.

## Environment identity

Main is the sole authority for `(environmentId, environmentGeneration)`:

- `environmentId` identifies a configured execution environment, not its host address.
- `environmentGeneration` is a nonnegative integer identifying an incarnation of
  that environment within the main-process lifetime. `EnvironmentManager` advances
  it on SSH save/reconfiguration/deletion. Deleting an ID does not delete its
  counter; recreating that ID cannot reuse an old incarnation. Local is stable at 0.
- Every successful Usage response requires both identity fields and `entries`.
  SSH invalidation events carry the new authoritative generation. No host address,
  credentials or filesystem path is exposed for identity reconciliation.
- Main captures identity before any asynchronous work and rejects completion if
  its generation changed or its registered workspace closed/was replaced.
- Renderer starts with **unknown** generation (absent), not SSH generation 0.
  Its first valid response establishes identity. Concurrent requests started while
  unknown remain owned, but must return the same or a newer authoritative identity.
- Responses must match the requested environment. Older generations are discarded.
  An owned response with a newer generation clears the previous incarnation's
  readings, selection and operations before publishing its entries. An event with
  a newer generation performs the same invalidation without publishing readings.
  Equal/older events are no-ops, so a response preceding its notification is safe.
  Retired operations cannot publish results/errors or clear replacement indicators.

Counters are process-lifetime identities, not durable IDs. No separate epoch is
needed under the Electron lifecycle: a main-process restart destroys its window
and renderer; the next renderer starts with an empty, unknown-generation store.
Renderer reloads also lose all Usage cache/operations. A future architecture that
reconnects a surviving renderer to a restarted main would require an epoch; that
is not supported here. Tests cover fresh-store acceptance of restarted counters,
monotonic invalidation, notification reordering and delete/recreate.

## Account authority and ordering

`App` owns the account and SSH subscriptions, independently of workspaces, widgets
or Assistant destinations. The subscription initializer shares registrations and
returns idempotent disposers, supporting Strict Mode setup/cleanup/remount. Preload
removes the exact registered handler on disposal.

A confirmed account broadcast is the only selection update path for Usage and
Settings. Usage calls selection IPC but never replays its completion into state:
completion can arrive before its event or after a newer confirmed selection. A
failed call leaves authoritative selection untouched. Electron broadcasts on the
same channel preserve main's confirmed-change order.

Each account change advances a renderer request version for that environment and
harness and retires its operation. Both success and failure from an older version
are discarded entirely. Removal/reconnection drops only that account's readings;
other account/provider caches remain. Active consumers may request the new version
immediately, subject to freshness. Main also versions removed/reconnected account
probes: a new credential incarnation cannot join an old flight, and an old probe
cannot restore cache or report account status after retirement. Account invalidation
addresses the canonical local environment's cache directly; visiting any number of
SSH environments cannot evict it from an auxiliary invalidation index. No strong
list of remote cache maps is retained.

## Operation and consumer ownership

There is one owned operation per environment/provider, carrying the main generation,
account request version, effective workspace and promise identity. Local workspace
IDs normalize to `null`, sharing IPC and readings with other local workspaces and
Assistant-only surfaces. SSH keeps its workspace-scoped execution context.

Ordinary requests join an equivalent owned operation; a forced request can replace
an ordinary one. Ordinary requests join an already forced operation. Pending and
forcing are projections of owned operations, not independently decremented counters.
Only an operation still owning its slot can publish or clean up. Retiring a request
does not cancel another consumer's work or weaken main's rate limits.

The store alone schedules initial reads, cancellable idle warm-up and polling.
`useHarnessUsage` projects shared readings and owns only presentation timing for the
manual-refresh cooldown. Last active consumer removal stops environment polling;
remaining consumers retain updates. Reset cancels warm-ups/timers and retires all
promises. SSH has no unattended polling: the existing widget enables remote polling
only while Usage is open. Invalidation does not create a polling owner.

Passive local warm-up checks selected readings' `nextRefreshAt` on registration and
again at idle execution. Expired readings can warm on a later consumer registration;
fresh readings do not re-fetch on workspace/Assistant navigation. Requests still
deduplicate in the shared coordinator. Missing/empty results or an IPC failure with
no new authoritative deadline get a one-minute, per-provider navigation throttle;
a successful response with a refresh deadline supersedes that fallback. This is
not a second scheduler: no expiry timers or unattended passive/SSH polling are
added, and pending warm-ups remain cancellable.

## Compact scope and stale presentation

The dropdown header shows `Local` or `SSH · <environment display name>`, using the
existing display-safe workspace metadata, never its connection target. Assistant
Usage is always local even with a parked SSH workspace. Pinned tooltips/accessibility
descriptions include the same scope. On a failed refresh, retained measurements
keep their percentage/remaining-capacity color and gain a small status icon and the
panel's existing stale/error description. Successful readings remove the warning;
merely reaching `nextRefreshAt` does not label a measurement stale.

## Manual pre-PR smoke checklist

1. Open Usage and pin a provider. Navigate between two local workspaces and a Hermes
   Assistant; readings/chips should remain consistent, without extra refreshes.
   Also test Assistant-only Usage with zero registered workspaces. Confirm the
   dropdown/chip tooltip says Local for Assistants and the saved SSH name remotely.
2. Select accounts through Usage and Settings, including rapid A/B/A selection and
   a failed selection. The latest confirmed selection wins; failure preserves it.
3. With a refresh pending, remove or reconnect its account. Old measurements must
   not return, and a rejected old refresh must not mark another account failed.
4. Refresh while initial reads are pending; navigate or change an account during
   refresh. Checking/refreshing indicators must follow the replacement operation
   and finish normally. Force a provider failure: the pinned percentage stays, with
   a warning and stale/error tooltip; recovery clears it. Close one consumer while
   another remains pinned. Navigate locally before/after cache expiry: idle warming
   skips fresh data but refreshes expired data after the idle delay.
5. Close SSH workspaces, reconfigure an environment from host A to B, reopen Usage,
   then delete/recreate the same saved ID. No previous host reading may return.
6. Switch local/SSH repeatedly; SSH readings stay isolated. Close remote Usage and
   confirm remote polling stops; open it again and confirm refresh works.
7. Restart the app and confirm Usage starts empty and repopulates normally. Check
   dropdown, pinned chips and status-bar appearance remain unchanged.

Manual live-host testing remains a pre-PR checkpoint; automated tests do not replace
credentialed SSH and provider smoke tests. No PR or merge is part of this work.
