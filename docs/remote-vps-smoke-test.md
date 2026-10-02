# Remote VPS smoke test

SSH history checks: create a short session in the unique temporary workspace using an installed supported harness (OpenCode is suitable on the existing VPS). Open **Chat history**, expand the harness, and verify the host's session title appears. Click it to resume in a new SSH terminal and confirm the same conversation and host directory. Check attention events when enabled. Check that sessions from unrelated sibling workspaces and desktop history are absent. Switch workspaces while discovery is pending and confirm the old results do not appear in the new menu. Interrupt SSH and confirm an error rather than an empty-history message; restore connectivity, close/reopen history, and retry. Switch to another workspace while resume is pending and confirm the resulting terminal belongs to the original workspace. Close that workspace during a pending resume and verify no orphan terminal remains. Remove a temporary session file before resuming and confirm an error without local fallback. After resuming a known conversation, exit its terminal and reopen history: verify its saved task becomes Resumable and Resume opens the same host conversation. Repeat after restarting Clanker and reopening the SSH workspace. Interrupt SSH during task verification: confirm the ID is retained and a connection error is shown, then restore connectivity and reopen history to recover. Repeat for each installed supported harness. Launch a fresh task through Clanker, complete a short conversation, exit its terminal, and reopen history: verify a unique new host conversation associates with the task and becomes Resumable. Repeat after restarting the app and reopening the SSH workspace, and with a supported fork. Start overlapping tasks in the same directory and harness: if ownership is ambiguous, confirm Needs Session instead of an arbitrary assignment. Update an older conversation during a new task and verify it is excluded. Failed pre-launch scans and legacy tasks require manual association. Host clock differences must not cause the desktop history or a different directory to be selected.

Use a saved SSH environment for a test host you control. Prepare a persistent workspace with a `README.md` and Git repository. Open and read that fixture during testing; never remove it.

```text
SSH environment: <configured smoke-test environment>
SSH target: <user>@<host>
Remote home: $HOME
Workspace root: $HOME/workspaces
Persistent fixture: $HOME/workspaces/clanker-test
Temporary fixture: $HOME/workspaces/clanker-smoke-<unique-id>
```

Before starting, confirm the persistent fixture exists and check OpenCode on the host. Noninteractive OpenSSH commands may not inherit the same `PATH` as an interactive login shell, so include the user CLI directories if needed:

```sh
ssh_target='<user>@<host>' # Replace with the target of your saved SSH environment.
ssh -o BatchMode=yes "$ssh_target" 'test -f "$HOME/workspaces/clanker-test/README.md" && export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:$HOME/.npm-packages/bin:$HOME/bin:$PATH" && command -v opencode && opencode --version'
```

1. In **New Workspace → SSH Remote**, select the configured smoke-test environment. Confirm the default path resolves to `$HOME/workspaces` when that directory is accessible.
2. Open the application-rendered remote chooser over SSH, confirm `clanker-test` appears, open and select it. Launch one plain terminal. Confirm `pwd -P` is the canonical persistent fixture path, Explorer shows `README.md`, and Git status loads. Close the workspace.
3. Generate a unique fixture name *before* creating it, such as `clanker-smoke-$(date +%s)-$(openssl rand -hex 4)`. Record its exact expected absolute path directly under the canonical workspace root.
4. Reopen the chooser and use **New Folder** with that exact name. Navigate into it, select it, launch one plain terminal, and confirm `pwd -P` matches the recorded path. Before closing it, perform the file-monitoring checks below.
5. Remove only that recorded temporary fixture. Run the cleanup guard below on the remote host, setting `smoke_path` to the exact path recorded before creation. Never recursively remove `/`, `$HOME`, the workspace root, the persistent fixture, or an empty path. Confirm the persistent fixture still exists afterward.
6. Reopen `clanker-test`, select **OpenCode** and **1 terminal**, then launch. Confirm the TUI starts on the remote host, exit it without using paid inference, and confirm the remaining shell is remote with `pwd -P`.

File-monitoring checks (use only the unique temporary fixture):

- Keep Explorer visible and create `poll-check.txt` from the remote terminal. Confirm it appears within a few seconds without switching focus or manually refreshing.
- Open that file in the editor, then change its contents from the terminal. Confirm the clean editor tab reloads. Make an unsaved editor change and change the remote file again; confirm the unsaved buffer remains intact and the external-change indicator appears.
- Create and expand a subdirectory, then add, rename, and remove a file inside it from the terminal. Confirm the expanded directory updates. Hide Explorer and confirm an open clean editor file still reloads after a terminal edit.
- Switch to another workspace, edit a watched file in the temporary fixture, then switch back. Confirm monitoring resumes and the file updates. Close the temporary workspace before running cleanup.
- If practical, interrupt the SSH connection and restore it. Confirm monitoring resumes after retry backoff without treating the interruption as file deletion.

Monitoring uses one batch every three seconds for the active SSH workspace, with retries backing off to thirty seconds. Each batch is limited to 128 open files and 128 visible or expanded directories, with at most 2,000 direct children per directory.

Default workspace root checks (close all workspaces using the target before editing it):

- In **Manage SSH Targets**, edit a target and set **Default workspace root** to an existing absolute directory accessible to the SSH account. Confirm selecting that target initializes the path field and remote chooser at its canonical path.
- Set the preference to a nonexistent directory. Confirm selection falls back to `$HOME/workspaces` when accessible, or `$HOME` otherwise.
- Clear the preference and save. Confirm the automatic starting directory is restored. Restore the original target settings after these checks.

Remote worktree discovery checks (use an existing remote repository with linked checkouts, or prepare worktrees inside a unique temporary fixture):

- With two saved SSH aliases whose effective hostname/user/port/proxy route match, open the disposable checkout through one alias and confirm inspection/removal through the other refuses it. Closing that checkout must allow inspection again. Keep same-path workspaces on unrelated SSH hosts independent.

- Keep the SSH repository workspace open. In **New Workspace → SSH Remote**, select its saved target and click **Worktree**. Confirm the repository selector contains only workspaces on that target and discovery shows its worktree paths and branches.
- Open an existing checkout. Confirm the new workspace's terminal is on the same remote host at the canonical checkout path, and its tab shows the repository name and worktree branch. Open it again and confirm Clanker selects the existing tab.
- Confirm missing checkouts have disabled **Open** buttons, and removal refuses missing or locked checkouts. Interrupt SSH during discovery, confirm an error appears, restore connectivity, and use **Refresh worktrees** to recover.
- In a unique temporary repository fixture, enter a new branch and base `HEAD`, then **Create and open worktree**. Confirm the checkout is under `<repository>-worktrees` beside the main fixture repository, the terminal is on the same SSH host, and the tab shows the new branch. Confirm attempting the same branch again fails without altering the existing checkout. Close all fixture workspaces before cleanup.
- Keep the main fixture repository open and close its linked checkout. In **Worktree**, click **Inspect** beside the linked checkout and confirm a clean result. Add an untracked file on the host, inspect again, and confirm changes are reported without altering that file. Open the linked checkout and confirm inspection asks you to close its workspace/terminals. Confirm **Remove…** refuses dirty or active checkouts. Use only the temporary fixture for these checks.
- For a clean temporary checkout without submodules, click **Remove…**, confirm its exact path/branch, and verify the checkout disappears from Git while its branch remains. Verify the reported recovery copy still contains the tracked files and its sibling `recovery.json` records the original path. Use only a unique temporary fixture for removal checks.
- If interrupting SSH during a removal test, restart Clanker before reopening the fixture checkout and confirm reservations still block its open/terminal launch. Open the source repository and use **Refresh worktrees** after reconnection to verify completion. Inspect the exact reported recovery/staging paths on the host if Git cleanup failed. Close all fixture workspaces before cleanup. Keep temporary repositories, checkouts, and recovery copies under the recorded temporary fixture; create the repository in a child directory so its sibling worktrees folder is confined to that fixture.

Remote Agent Attention checks (use installed harnesses in the unique fixture; an authenticated turn can consume model usage):

- Enable **Agent attention** for OpenCode in harness defaults, then launch a new SSH OpenCode terminal. Complete a small manual turn and verify Running → Turn complete badges. Trigger an approval/question if supported and verify Needs input → Running. Confirm normal terminal rendering contains no encoded attention frames.
- Launch a second remote agent (and, if available, a local agent) and confirm attention changes remain scoped to the correct terminal/workspace. Exit OpenCode back to the shell and confirm subsequent shell activity cannot restore agent attention.
- Repeat supported native events for Codex, Claude, Pi, OMP, Antigravity, and Hermes as installed. Codex completion is supported, while start/input events remain unknown; Pi/OMP do not report approval events. Hermes needs its observer hook API and default host profile; confirm enabling its owned plugin preserves existing plugins/settings. Antigravity/Hermes observer plugins remain installed but are inert for launches without Clanker credentials.
- After an attention-enabled Antigravity launch exits, launch Antigravity with attention disabled (including directly on the host). Confirm the persistent hooks return empty responses without Node errors or changed permission decisions.
- Try conflicting hook settings (including Codex `-cnotify=[]` and `--config=notify=[]`) with attention enabled and confirm launch gives a clear error without overwriting configuration. Disable attention and confirm the original launch mode works. Close an agent terminal/workspace and verify its private launch files are cleaned when SSH is reachable. Restore harness defaults after these checks.

SSH browser preview checks (use only servers started in the unique temporary fixture):

- Start a temporary HTTP server from the fixture, for example `python3 -m http.server 3000 --bind 127.0.0.1`. Open that SSH workspace's Browser and confirm the single workspace-owned service is detected, forwarded, and opened automatically at a desktop loopback URL. Only the compact SSH remote-preview toolbar icon should appear; there must be no permanent **Web services** bar or extra preview row.
- Open the remote-preview popup and confirm it offers service selection, **Stop**, **Detect services**, and manual forwarding. Manual fallback asks only for the remote port and HTTP/HTTPS, never the desktop port. Occupy the matching desktop port before opening Browser and confirm another local port is allocated automatically.
- Stop the server without stopping the preview. Confirm the compact control indicates waiting and the same SSH forward remains owned. Restart on the same remote port and confirm recovery without **Retry** or a replacement tunnel. Test manual forwarding before starting a server; it should wait and recover when the server starts.
- Start a second fixture server (for example on 6006) before opening Browser and confirm multiple services require selection rather than an arbitrary automatic choice. Both can be forwarded independently. Test IPv6 loopback and wildcard bindings where supported.
- Print a fixture URL such as `http://localhost:5173/` in its SSH terminal and confirm it accelerates discovery when Browser is active. Hide Browser or switch away, stop or change the service, then reopen Browser: fresh discovery must establish ownership before any automatic reopening. Established forwards may remain alive while hidden; unrelated workspace services must not silently auto-open.
- Where practical, open two SSH workspaces and verify a cookie or local-storage value set by one preview is absent from the other. Tabs within one SSH workspace should share its private session; closing and reopening that workspace should retire the previous session. Local workspace browsing should retain its normal persistent session.
- Test an HTTPS fixture separately. An untrusted or mismatched certificate should produce a Browser preview error under normal Chromium certificate validation, without killing the SSH tunnel. HTTP is the simplest development-preview path.
- If a separate test account/server has forwarding disabled or the fixture destination excluded by `PermitOpen`, confirm **SSH server rejected TCP forwarding** rather than waiting for a service. Do not alter shared VPS SSH policy. Authentication, host-key, or connection loss must likewise remain transport errors, distinct from a stopped development server.
- Use **Stop** inside the popup and confirm the selected local listener is released without stopping another service. Close the workspace during pending startup and verify no late SSH child/listener remains. Test window close/app shutdown and renderer termination similarly. Quit must wait for child termination.
- Interrupt SSH, confirm a friendly transport error, restore connectivity and use **Open** in the popup. Browser URLs may persist but saved tunnels must not restart merely from URL restoration. Stop all fixture servers before cleanup and restore any temporary SSH alias configuration.

Cleanup guard (run on the remote host after closing the temporary workspace). Replace the placeholder with the recorded absolute path; keep that value unchanged through the checks and deletion. The guard requires a canonical workspace root and a direct child with a strict temporary name. It rejects empty paths, symlink targets, and any path outside that root before `rm -rf`:

```sh
workspace_root="$HOME/workspaces"
fixture_path="$workspace_root/clanker-test"
smoke_path='<paste the exact recorded absolute temporary path>'

test -n "$smoke_path" || exit 1
test "$workspace_root" != / || exit 1
test "$workspace_root" != "$HOME" || exit 1
test "$(realpath -e -- "$workspace_root")" = "$workspace_root" || exit 1
test -d "$fixture_path" || exit 1
test "$smoke_path" != / || exit 1
test "$smoke_path" != "$HOME" || exit 1
test "$smoke_path" != "$workspace_root" || exit 1
test "$smoke_path" != "$fixture_path" || exit 1
case "$smoke_path" in
  "$workspace_root"/clanker-smoke-*) ;;
  *) echo 'Refusing unsafe smoke path' >&2; exit 1 ;;
esac
test "$(dirname -- "$smoke_path")" = "$workspace_root" || exit 1
printf '%s\n' "$(basename -- "$smoke_path")" | grep -Eq '^clanker-smoke-[A-Za-z0-9-]+$' || exit 1
test ! -L "$smoke_path" || exit 1
test -d "$smoke_path" || exit 1
rm -rf -- "$smoke_path"
test -d "$fixture_path"
```
