# Checkout dev services / sidebar smoke (#91, #109)

Run the development app (`npm run dev`). Use a disposable local Node repository with
`package.json` containing a `dev` script that starts a server and prints its HTTP(S)
localhost URL (Vite is a good fixture). Do not use the running Clanker source tree's
own `npm run dev` as the fixture: that starts another Electron application.

## Sidebar hierarchy

1. Open the fixture and launch a main-checkout agent and an isolated worktree agent.
2. Confirm the main-checkout agent has one primary line; the isolated agent has a
   compact muted branch line below its name. Selection/hover/focus covers both lines.
3. Try long branch names, missing checkout state, attention spinner/check/question,
   and narrow/wide sidebar widths. Name/attention and branch glyph must remain usable.
4. Collapse the sidebar to the rail: existing agent/branch tooltips remain intact;
   full service controls intentionally live in the expanded sidebar only.

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
  never silently install dependencies. Install manually in the checkout terminal,
  then retry Run.
- Failed script / unavailable package manager: failed state, with an expandable
  `Why it failed` diagnostic (bounded 2 KiB output tail); another checkout's service
  must remain unaffected.
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
