# Start Gate first-pass polish

These are historical captures from the earlier iterations described below. The
current Start Gate and New Workspace dialog use one shared launcher form and
stylesheet, with per-harness terminal counts, searchable models, recipe Play
buttons, Worktree beside the directory, and Settings below Launch. Blank workspace
input opens the displayed local or SSH base directory. No new screenshot round
was captured for the later iterations.

Branch: `ui/start-gate-polish`.

Real Electron development app captures at **1200 × 800**, default zoom, using an
isolated temporary user-data profile. Themes were persisted through the preload
bridge and loaded by the application after renderer reload. No mocks or injected
styles were used. Original reference captures remain in the parent directory.

| Dark | Light | Slate |
| --- | --- | --- |
| [Start Gate](dark.png) | [Start Gate](light.png) | [Start Gate](slate.png) |

The pass addresses uneven 30–35px controls, competing utility-action emphasis,
nested selection outlines, tiny stacked Worktree text, and large horizontal
worktree entrance motion. Fullscreen-only CSS aligns the single-row controls at
34px (matching the existing small Button), uses existing semantic surface tokens
for selected states, retains the compact layout, and gives utility actions quieter
treatment. Worktree remains secondary. Opening a workspace now has stable inline
progress and duplicate-submit protection in the fullscreen gate.

Motion uses 140–160ms, 3px entrances for suggestions, status, model favorites, and
worktree navigation. Reduced motion removes these entrances, transitions, and
launcher spinner rotation. Shared Button, SegmentedControl, theme tokens, and
New Workspace modal styles were not changed.

Intentionally deferred: height interpolation when conditional sections appear
or change rows (requires lifecycle/layout coordination); shared modal and settings
control inconsistencies; broader model-discovery dialog polish. No live SSH host
or saved recipe was added for this visual pass.

Verification: all three captures were visually inspected at the reference window
size. Electron checks covered matching control heights, model favorites and Escape
focus return, terminal keyboard shortcut, worktree entry/return, failed-open error
and retry availability, empty SSH-target state, and reduced-motion popover/status
animation suppression. Targeted gate tests cover pending opens, duplicate submits,
stale-target errors, and retry. Final `npm run validate` covers lint, typecheck,
security audit, production build, and the full test suite.
