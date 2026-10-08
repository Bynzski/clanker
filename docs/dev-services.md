# Local checkout dev servers

Clanker can run a local checkout's package-manager `dev` script without adding a
terminal pane. Services are shared by conversations in the same checkout; main and
isolated checkouts can each have their own server.

## Run and preview

1. Open a local workspace and launch an agent in the desired checkout.
2. Its sidebar row offers dev-server controls when the registered effective checkout
   has a supported `package.json` with `scripts.dev`.
3. Choose **Run**. Clanker infers a fixed npm/pnpm/yarn/bun command from bounded package
   metadata and lockfile names, then rechecks the command and checkout before launch.
4. Once a printed loopback HTTP(S) endpoint passes readiness checks, use the Browser
   action to open that checkout's preview. Browser does not open automatically.
5. Choose **Stop** to end the server.

Discovery never executes a script. There is no automatic startup, arbitrary command
field, monorepo recursion or fallback to a `start` script. Different checkouts need
different available ports, or a development server that chooses another port itself.

## Checkout launch settings

The **Configure Dev Server** button beside Run opens settings for that conversation’s
registered checkout. Stop its server first. Enter non-secret environment variables as
one `NAME=value` per line, then **Save settings** and choose **Run** separately.
**Clear variables** followed by Save restores the inherited environment. Cancel saves
nothing. Values are literal (no quoting, interpolation or dotenv parsing).

Settings are stored by the canonical local checkout directory, not a conversation,
branch or runtime workspace id. Conversations in the same checkout share them; other
checkouts do not inherit them. Closing/reopening the workspace or restarting Clanker
retains settings, but never starts a server. Re-adopting or reusing the same directory
also retains its configuration; review or clear it when repurposing that directory.
No tracked files or `.env` files are read or rewritten by this feature. Settings apply
only to the headless dev command and its children, never agent terminals or dependency
installation shells. Run/settings tooltips list configured variable names, not values;
runtime snapshots and failure reports do not include configured values. Settings are
plain-text local preferences, **not a credential store**. Project output may itself
print environment values, so never enter secrets.

For a project with a frontend, backend and development proxy, configure a coordinated
port pair. For example, **if the project implements this environment contract**:

```text
PORT=8788
VITE_DEV_PORT=5174
VITE_BACKEND_PORT=8788
```

The backend must read `PORT`, the frontend must read `VITE_DEV_PORT`, and the frontend
proxy must read `VITE_BACKEND_PORT`. These names are illustrative, not special Clanker
variables: a hard-coded Vite config will not change merely because they are set.
Clanker does not infer monorepo topology, append arbitrary flags, allocate ports,
retry on another port or kill an existing listener. Use different pairs for concurrent
checkouts and preserve strict-port errors to avoid silently routing to the wrong app.

Main validates at most 32 variables, 64-character names, 1,024-character single-line
values and 8 KiB total UTF-8 content. Reserved system/toolchain and Clanker credential
variables are refused case-insensitively. Windows overrides inherited project keys
case-insensitively. Settings updates require authoritative checkout/command identity
and the last-discovered configuration fingerprint; stale edits or launches fail
without applying a different configuration. Successful saves publish bounded checkout
path/fingerprint metadata through the existing revision-ordered service bridge. All
rows using the canonical root rediscover (including rows in another workspace);
unrelated configured roots are not invalidated. Clearing settings also invalidates
the root. Run is disabled until stale discovery refreshes; failed launches are never
automatically retried.

An already-open settings dialog stays open if another conversation starts the server.
Its unsaved buffer is preserved, Save is disabled with a Stop-first explanation, and
Save becomes available again after verified cleanup. Explicit Cancel/Close dismisses
it; stopping a server never reopens it. Row refreshes do not rebase a dialog's editing
fingerprint or replace its buffer, so a concurrent save still fails safely. Pending, live or incompletely cleaned-up
services block edits, including a service from another workspace using the same root.
Stored configuration is bounded to 512 checkout roots; invalid persistence fails
closed. SSH configuration is not supported.

**Tracked follow-up: unused settings management.** Deleted worktree directories leave
configuration records behind, and the current UI cannot clear an unavailable root.
Add a bounded preferences view to identify missing local directories and explicitly
remove their settings, without deleting records automatically or discarding settings
for existing but unregistered checkouts. This is separate from service lifecycle and
is not implemented here; regular worktree use can eventually reach the 512-root cap.

## Dependencies and failures

A fresh worktree does not inherit ignored dependencies or `.env` files. If dependencies
are missing, **Install…** shows the exact checkout and inferred install command with an
install-script warning. Confirming opens a visible **Install dependencies** shell in
that checkout. Cancel executes nothing. Installation may run package scripts; it never
starts the dev server automatically. Retry **Run** yourself afterward.

A failed server has an info button opening a diagnostics dialog with status, command,
checkout directory and the captured bounded output tail (up to 32 KiB of recent output, control sequences stripped, memory only). **Copy for agent** copies a
Markdown report. This is not a full/live log viewer; output preceding the retained tail
may be absent (a single over-long row is truncated, never dropped). Changing checkout or command while setup is pending invalidates stale
confirmation rather than running in another directory.

## Lifetime and limits

Servers survive Browser hiding, workspace switching and conversation closure. A server
whose conversation closed remains as a checkout-labelled sidebar row. Pending and live
services block checkout release and removal until stopped.

Closing the owning workspace, renderer loss or app quit stops its services; running
state is not restored after restart. **Current limitation:** a dev server alone does
not trigger the app-close confirmation once other guarded work has ended; see the
[close guard](app-close-guard.md).

## Process lifecycle guarantees

Main owns every service; the renderer only displays snapshots. A service is the PTY
child Clanker spawned **and every process still in that child's process group**. On
POSIX, node-pty starts the child as session and group leader (`pgid === pid`), so the
group contains `npm`, its shell and the actual server, plus anything they start without
leaving the group.

**States**

| Status | Meaning |
| --- | --- |
| `starting` | Launch reserved; discovery, checkout/command recheck and spawn in progress. No process yet. |
| `running` | The process was created and has not terminated. This is *not* readiness: `previewUrl` appears only after a loopback URL passes an HTTP probe. |
| `stopping` | An explicit Stop, or cleanup of descendants after an unexpected exit, is under way. |
| `stopped` | Only after an intentional Stop (or cancelled launch) whose cleanup was **verified**. |
| `failed` | Launch failed, the process exited by itself (any code, including `0`), or cleanup could not be verified. |

A `failed` record with `cleanupIncomplete: true` is the unresolved case: some processes
could not be confirmed terminated. It is still *live* (`isLiveWorkspaceService`): it
blocks new launches for the checkout, checkout release/removal, and is retried by Stop,
Start, workspace close and quit. Other failed records are complete: they are replaced by
the next launch and forgotten when their checkout or conversation goes away.

**How termination is verified (POSIX).** The leader exiting is never treated as the end.
Clanker sends `SIGTERM` to the group, waits up to 2 s, sends `SIGKILL`, waits up to 2 s,
and only then reports success when `kill(-pgid, 0)` says the group is empty. The checks
run only during an operation (no background polling). Once a group is observed empty
Clanker never signals it again, so a recycled PID cannot be hit; it only signals a group
it spawned and still believes it owns. Residual window: the kernel does not reuse a pgid
while the group has members, so the only exposure is a group that empties and whose PID
is recycled within the few milliseconds between exit and Clanker's own check.

**Unexpected exits.** The exit code and signal are recorded, descendants are terminated
as above, then the final state is published with the diagnosis and output. Exit `0` on
its own is `failed` ("exited on its own"), because only a Stop makes `stopped`.

**Start/Stop determinism.** Simultaneous Starts for one checkout yield one service
(sharing conversations get the same record). A Start while the service is stopping or
cleaning up fails with a clear error rather than reporting a launch that did not happen.
A Start after a failure replaces the record once cleanup is verified; after an
incomplete cleanup it retries the cleanup first and only launches if it succeeds.
Repeated Stops are single-flight. Discovery, checkout identity and command are
rechecked before every launch; a saved command is never run against an unverified root.

**Shutdown and close.** Workspace close and quit refuse new launches first, cancel a
launch still being validated (it cannot spawn afterwards), stop every owned service in
parallel with a bounded wait each, keep any unverifiable record visible instead of
forgetting it, and report the failure (`closeWorkspace`, `shutdown` reject; main logs it).

**Port conflicts.** Output rows such as `EADDRINUSE`, `address already in use` or
`Port 5173 is already in use` are remembered. If the service then fails without ever
becoming ready, `portConflict` (`port` when known) and a one-line diagnosis are added to
the error. A warning followed by a successful fallback (`Port 5173 is in use, trying
another one…`) is not a failure, and a later crash of a server that did become ready is
not blamed on the port. Clanker never scans for, identifies or kills the process that
owns the port.

**Platform limits.** Windows has no process-group signaling here: Clanker terminates the
PTY child (best effort, may log a SIGTERM warning) and treats its exit as completion;
descendants that detach from the ConsoleHost can survive and are not detected. Windows
remains best-effort supported without a native CI gate.

**Crash recovery (not implemented).** Service records are memory-only. After a hard
crash the PTY master closes, so the kernel sends `SIGHUP` to the session; ordinary dev
servers die with it, but one that ignores `SIGHUP` or leaves the session survives
unrecorded. A PID alone cannot safely identify it later. Safe recovery would need a
small ownership record (pid, process start time, boot id, command, cwd) verified against
the live process on next launch, and an explicit, user-visible adopt/stop action. That is
a separately scoped follow-up; Clanker does not kill PID-matched processes automatically.

This feature is local-only. For SSH workspaces, start the server manually in an SSH
terminal and use [remote Browser previews](workspaces.md#ssh-browser-previews). Agent
native location reports select only registered checkout contexts; they never authorize
an arbitrary reported path.

For acceptance checks, see the [dev-services smoke test](dev-services-smoke-test.md).
