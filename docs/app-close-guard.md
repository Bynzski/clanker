# Application close guard

Issue #115 uses main-owned live work to intercept both the BrowserWindow `close`
and application `before-quit` events before existing cleanup runs. One pending
confirmation serves repeated requests; an app quit during a window-close prompt
promotes that same request to quitting the application. Keep Clanker Open is the
default and Escape choice. Approval resumes existing cleanup once.

Active work means entries in main's live PTY table (local shells, harnesses and
SSH sessions), pending account sign-in, or a live Clanker-owned Hermes service.
Exited panes and cached xterm instances have no PTY entry. An adopted external
Hermes service survives socket disconnect and does not count. SSH forwards are
transport helpers; the remote preview service is not owned by Clanker. Future
owned dev services (#91) should extend the main ownership predicate.

On macOS, closing the window preserves the owned Hermes service; quitting the
app includes it in the check. Fatal main-process exits are explicitly authorized
and do not wait for a dialog. A destroyed dialog parent aborts its request so a
late answer cannot close a replacement window.

Windows `query-session-end` requests use the same guard. Forced termination and
noncancelable `session-end` cannot promise confirmation; see Electron's
[window events](https://www.electronjs.org/docs/latest/api/browser-window) and
[quit events](https://www.electronjs.org/docs/latest/api/app).

## Verification

`npm run validate` covers close admission, native event wiring, main quit
cleanup, account sign-in and owned/external Assistant service lifecycle.
On Linux, `npx electron scripts/app-close-guard-smoke.cjs` after a build checks
actual Electron close/quit events and real PTYs with controlled dialog answers
and a temporary profile.

Manual smoke in the development app:

1. Open a shell or agent, close the window, and choose Keep Clanker Open (also try
   Escape). Confirm the session still accepts input and produces output.
2. Attempt close repeatedly while the dialog is open: only one dialog appears.
3. Choose Close Anyway: Clanker exits and its sessions stop.
4. Relaunch, run `exit` in the only terminal and leave its scrollback visible.
   Close: no confirmation appears.
5. With an enabled, Clanker-owned Hermes backend, quit with no workspace PTYs:
   confirmation appears. With an external backend only, it does not.
