# Checkout dev services / sidebar smoke (#91, #109)

Run the development app (`npm run dev`). Use a disposable local Node repository with
`package.json` containing a `dev` script that starts a server and prints its HTTP(S)
localhost URL (Vite is a good fixture). Do not use the running Clanker source tree's
own `npm run dev` as the fixture: that starts another Electron application.

## Sidebar hierarchy

1. Open the fixture and launch a main-checkout agent and an isolated worktree agent.
2. Confirm agent rows use one compact line with inline dev-server controls;
   isolated agents retain a muted checkout branch label without hiding the name.
3. Try long branch names, missing checkout state, attention spinner/check/question,
   and narrow/wide sidebar widths. Name/attention and branch glyph must remain usable.
4. Collapse the sidebar to the rail: existing agent/branch tooltips remain intact;
   full service controls intentionally live in the expanded sidebar only.

## Checkout settings

Use a fixture whose dev script reads explicit frontend/backend/proxy port variables.

1. Open Configure Dev Server for the main checkout. Save one available port pair.
   Repeat for the isolated checkout with a different pair. Run both and verify each
   Browser preview reaches its own backend (not just the matching frontend).
2. Confirm Save alone starts nothing and changes no repository files. Cancel an edit;
   reopen and verify it was not saved. Clear variables and Save to reset defaults.
3. Restart Clanker and reopen/re-adopt the same checkouts. Settings should remain;
   services must remain stopped until explicitly run.
4. Try PATH, NODE_OPTIONS and CLANKER_MCP_TOKEN, a duplicate key, a multiline/control
   value, and too many variables. All should be refused. Do not use real secrets.
5. Two agents in the same checkout share configuration. Open settings from both;
   save one, then try saving the other stale dialog. The second save must fail without
   overwriting the first. Its typed buffer remains visible.
6. Start the checkout while its settings dialog is open elsewhere. The dialog must
   stay open with its unsaved buffer intact; Save is disabled with a Stop-first message
   throughout starting/running/stopping and incomplete cleanup. Stop the service and
   confirm Save becomes available without changing the text. Explicitly Cancel,
   start/stop again and verify the dialog does not reappear. A native location change or released context
   must also invalidate the old settings action. No settings may move to another root.
7. Save from one agent and verify another agent in the same canonical checkout
   (also via a second workspace pointing there) refreshes its discovery before Run.
   During delayed rediscovery, Run is disabled. The next explicit Run confirms the
   new fingerprint without a stale-settings error. Clearing variables must propagate
   too. Unrelated checkouts keep their discovery; an already-open sibling dialog keeps
   its own editing fingerprint and buffer. Never retry a failed launch automatically.
8. Run a hard-coded strict-port fixture twice: it still fails clearly. Settings are an
   explicit project contract, not generic automatic port assignment.

## Independent checkout services

1. Each eligible conversation shows `Dev Server · npm run dev` (or its inferred
   pnpm/yarn/bun command) beneath its agent row. Opening the workspace must not run it.
2. Run the main-checkout service. No terminal pane should be added; status moves
   through starting to running, then shows the printed loopback endpoint when ready.
3. Run the isolated checkout's service too. Ensure the fixture uses a different port
   or automatically chooses the next free port. Both must remain independently usable.
4. Open each Browser preview and verify that it serves the matching checkout's code.
5. Stop one service: its endpoint stops responding; the other keeps serving.
6. Two conversations sharing one checkout expose the same service, not duplicate
   servers. Different checkout contexts may run concurrently.
7. Switch workspaces and hide the Browser/sidebar: both process/status lifetimes
   remain independent of rendering. Return and check the correct status.
8. Close the originating agent. The service should remain available in a separate
   checkout-labelled sidebar row with Stop/Browser controls. It should block checkout
   release/removal until stopped; the safety message should explicitly say to stop the
   dev server, rather than asking you to close an already-closed agent.
9. If a harness reports moving to another registered checkout, verify its Run action
   follows that checkout. An already-running service keeps its original root and
   appears separately if no conversation now points there.
10. Close the owning workspace, then quit with another service running. Confirm no
    fixture servers remain listening. Restart: no service is restored as running.

## Failure / environment checks

- No `scripts.dev`: no automatically guessed Run action (a `start`-only package is
  deliberately not offered in V1).
- Invalid package metadata: compact unavailable state with a retry action and error
  tooltip. No scripts run during inspection.
- Fresh isolated checkout with missing dependencies: an advisory recommends the
  selected package manager's install command **in that checkout**. Detection and Run
  never silently install dependencies. Click `Install…`, verify the exact command
  and checkout in the confirmation (including the install-script warning), and
  confirm. A visible `Install dependencies` shell opens in that checkout with the
  fixed npm/pnpm/yarn/bun install command. Watch its output, then retry Run yourself;
  there is no automatic server launch. Cancel must open no shell or execute anything.
  You can still install manually in an existing checkout terminal instead.
- Failed script / unavailable package manager: failed state with an info button
  opening a diagnostics dialog (status, command, checkout directory and bounded
  output tail). **Copy for agent** copies a Markdown report; no stack trace expands
  inside the sidebar. Another checkout's service must remain unaffected. If the package manager or effective checkout changes
  while the install confirmation is open, setup must refuse the stale confirmation
  rather than executing in another checkout. Switching to another destination during
  setup discovery must not launch a shell there or reclaim focus.
- Close a conversation after its service stops/fails, or remove its released checkout:
  no stale stopped-service row should remain. A still-running service must remain
  accessible and protected until explicitly stopped.
- Printed URL before the server binds: readiness retries eventually enable Browser.
- Failed Browser readiness: show an error, do not pretend navigation succeeded.
- Switch workspace or to an Assistant while Browser readiness is pending: the late
  result must not redirect the new destination.
- SSH workspace: one `Dev Server · local only` note explains the limitation; no local
  dev-server discovery/launch (existing SSH previews unchanged). Start remote servers
  manually in their SSH terminal and use the Browser's remote preview discovery.

V1 inspects only the registered effective checkout root. It does not recurse into
monorepos, offer arbitrary commands, retain full/live output for Show Output, reconstruct
processes across restart, or automatically open the Browser.

Automated coverage includes real npm/PTY fixtures with two concurrent servers,
validated file reads, TCP readiness and process-group teardown, plus startup races,
shared-checkout identity, sidebar controls and late Browser/IPC responses.

## Lifecycle hardening checks

1. Fixture script `node server.cjs & sleep 1` (server in the background, npm exits first):
   the service ends as `failed` ("exited on its own") and the server stops listening.
2. Occupy the fixture's port with another process, then Run: the failure names the port
   and says Clanker did not stop the other process, which keeps running.
3. Fixture that logs `Port N is in use, trying another one...` and listens elsewhere:
   stays `running` with a preview URL, no failure.
4. Run, then Stop twice quickly: one termination, no duplicate or stray process (`ps`).
5. After a failed run, fix the script and Run again without reopening the workspace.
6. Quit with a server running: nothing listens afterwards (`ss -ltnp`).
