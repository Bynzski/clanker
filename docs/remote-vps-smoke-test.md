# Remote VPS smoke test

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
