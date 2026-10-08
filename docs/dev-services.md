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

## Dependencies and failures

A fresh worktree does not inherit ignored dependencies or `.env` files. If dependencies
are missing, **Install…** shows the exact checkout and inferred install command with an
install-script warning. Confirming opens a visible **Install dependencies** shell in
that checkout. Cancel executes nothing. Installation may run package scripts; it never
starts the dev server automatically. Retry **Run** yourself afterward.

A failed server has an info button opening a diagnostics dialog with status, command,
checkout directory and the captured bounded output tail. **Copy for agent** copies a
Markdown report. This is not a full/live log viewer; output preceding the retained tail
may be absent. Changing checkout or command while setup is pending invalidates stale
confirmation rather than running in another directory.

## Lifetime and limits

Servers survive Browser hiding, workspace switching and conversation closure. A server
whose conversation closed remains as a checkout-labelled sidebar row. Pending and live
services block checkout release and removal until stopped.

Closing the owning workspace, renderer loss or app quit stops its services; running
state is not restored after restart. **Current limitation:** a dev server alone does
not trigger the app-close confirmation once other guarded work has ended; see the
[close guard](app-close-guard.md).

This feature is local-only. For SSH workspaces, start the server manually in an SSH
terminal and use [remote Browser previews](workspaces.md#ssh-browser-previews). Agent
native location reports select only registered checkout contexts; they never authorize
an arbitrary reported path.

For acceptance checks, see the [dev-services smoke test](dev-services-smoke-test.md).
