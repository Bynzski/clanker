# Remote VPS smoke test

Use the saved **gyute fiy** SSH environment (`clanker@15.204.255.170`). Keep `/home/clanker/workspaces/clanker-test` as a persistent fixture. Open and read it during testing; never remove it.

1. In **New Workspace → SSH Remote**, select **gyute fiy**. Confirm the default path is `/home/clanker/workspaces`.
2. Open the application-rendered remote chooser over SSH, confirm `clanker-test` appears, open and select it. Launch one plain terminal. Confirm `pwd -P` is `/home/clanker/workspaces/clanker-test`, Explorer shows `README.md`, and Git status loads. Close the workspace.
3. Generate a unique fixture name locally before creating it, such as `clanker-smoke-$(date +%s)-$(openssl rand -hex 4)`. Record the complete expected path under `/home/clanker/workspaces/`.
4. Reopen the chooser and use **New Folder** with that exact name. Navigate into it, select it, launch one plain terminal, and confirm `pwd -P` matches the recorded path. Close the workspace.
5. Remove only that recorded temporary fixture. Before deletion, check that its canonical parent is exactly `/home/clanker/workspaces`, its basename matches `clanker-smoke-[A-Za-z0-9-]+`, and it is not a symlink. Use a literal, checked path as the operand to `rm -rf --`. Never recursively remove `/`, `$HOME`, `/home/clanker`, `/home/clanker/workspaces`, `/home/clanker/workspaces/clanker-test`, or an empty path. Confirm `clanker-test` still exists afterward.
6. Reopen `clanker-test`, select **OpenCode** and **1 terminal**, then launch. Confirm the TUI starts, exit it without using paid inference, and confirm the remaining shell is remote with `pwd -P`.

Example cleanup guard, run on the VPS with the exact path saved in `smoke_path`:

```sh
case "$smoke_path" in
  /home/clanker/workspaces/clanker-smoke-*) ;;
  *) echo 'Refusing unsafe smoke path' >&2; exit 1 ;;
esac
test -n "$smoke_path" || exit 1
test "$(dirname -- "$smoke_path")" = /home/clanker/workspaces || exit 1
printf '%s\n' "$(basename -- "$smoke_path")" | grep -Eq '^clanker-smoke-[A-Za-z0-9-]+$' || exit 1
test ! -L "$smoke_path" || exit 1
test -d "$smoke_path" || exit 1
rm -rf -- "$smoke_path"
test -d /home/clanker/workspaces/clanker-test
```
