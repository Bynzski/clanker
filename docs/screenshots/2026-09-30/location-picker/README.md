# Unified Start Gate location picker

These are historical captures from the earlier iterations described below. The
current Start Gate and New Workspace dialog use one shared launcher form and
stylesheet, with per-harness terminal counts, searchable models, recipe Play
buttons, Worktree beside the directory, and Settings below Launch. Blank workspace
input opens the displayed local or SSH base directory. No new screenshot round
was captured for the later iterations.

These captures document the earlier full-width selector iteration. The current
implementation uses a compact This PC/server chip attached to the workspace
input section, with settings and Add server inside its menu. The separate
Location heading and full-width selector have been removed. No new screenshot
round was taken for this active iteration, as requested.

Follow-up on `ui/start-gate-polish`, using the supplied searchable dropdown reference
while preserving Clanker's compact fullscreen launcher and directory-based workflow.

One location selector replaces the Local/SSH toggle plus separate server selector.
It lists **This PC** and saved SSH servers, supports searching by name/address,
and keeps **Add server…** available beneath the list. The settings action inside the menu
sets the local working directory or opens the selected server's existing settings
directly, including its default workspace root. Local directory input survives
switching targets; remote roots continue through the existing host-validated
initial-directory flow. Saving a server selects it, and deleting the selected
server returns to This PC. No project catalog or new persistence schema was added.

The new UI is fullscreen-only. The New Workspace dialog retains its current location
flow. The SSH settings surface now uses the existing Dialog primitive for focus
containment, Escape, and focus return; its layout and main-process validation/in-use
restrictions remain unchanged. Shared Button, SegmentedControl, and theme palettes
were not modified. The chooser uses existing theme tokens.

Real Electron captures at **1200 × 800**, default zoom, using an isolated temporary
profile, with no mocked APIs or injected styles. The open-picker images include a
saved visual fixture, `Development server`, at the deliberately nonexistent address
`dev@dev-server.invalid`. It was saved through the real preload bridge in that
isolated profile and removed after verifying settings persistence and deletion.
No live SSH host or workspace session was launched.

| Theme | Start Gate | Open location picker |
| --- | --- | --- |
| Dark | [PNG](dark.png) | [PNG](dark-open.png) |
| Light | [PNG](light.png) | [PNG](light-open.png) |
| Slate | [PNG](slate.png) | [PNG](slate-open.png) |

[Selected server settings, Slate](slate-server-settings.png)

Visual inspection covered all three themes. Electron interaction checks covered
popover focus/Escape, add-server dialog focus containment/restoration, reduced
motion, direct selected-server settings, persisting its workspace root, and returning
to This PC after deletion. Tests cover filtering, keyboard selection, switching
and retaining local input, local root resolution, adding/selecting servers,
remote root edits, existing asynchronous discovery guards, and save/delete refusals.

Deferred: named collections of multiple local directories and wider adoption of
this picker in other screens. This pass uses the existing This PC base directory
and saved SSH target model rather than introducing project management.


SSH alignment follow-up: the fullscreen header now shows the host-resolved starting
directory at the top right, including the fallback root when no custom root is saved.
The input starts empty like This PC, accepts names relative to that directory, and
still accepts absolute paths. Browse selection and inline suggestions use compact
relative labels; submitted paths remain absolute and host validation is unchanged.
Entering a relative name while the root is loading waits for that authoritative
root; stale replies from another target cannot change the displayed root or input.
The New Workspace modal retains its absolute remote-path entry behavior.

Live verification used the saved g-lab SSH target. The actual root resolved to
`/home/clanker/workspaces/`; its label aligned to the input's right edge. Browsing
selected `clanker-test`, inline suggestions used `clanker-test/`, and switching back
to This PC worked. The existing persistent fixture was only read, with no remote
file changes or workspace launch. No additional screenshots were captured.
