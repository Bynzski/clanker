# Issue #62 branding review

Real Electron app, built renderer (`file://` URLs), 1200 × 800, default zoom,
default dark theme, isolated temporary user-data profile. No mocked bridge or
injected styles. A temporary empty local directory and one plain terminal were
used to open a workspace; no harness was launched.

- [Start/workspace gate](start-gate.png): detailed 64 px hero and simplified 18 px title mark.
- [Main title bar](titlebar.png), [full workspace](workspace.png): simplified 18 px mark.
- [New Workspace modal](new-workspace.png): simplified 16 px mark.
- [Launcher size preview](launcher-preview.png): generated detailed application PNGs at native sizes on a dark background; this is a contact sheet, not an installed OS launcher screenshot.

The captures were inspected for centering, visible mint eyes, transparency and
frame clarity. Renderer image loading was checked in the real app, including
compact 2x sources. The gate layout and harness/provider assets are unchanged.

The source attachments were downloaded from the sole issue comment and identified
visually (wordmark, mascot, simplified mark, detailed icon), not by upload order.
All four originals are retained unchanged in `src/assets/branding/`; ownership,
source attachment IDs and regeneration instructions are documented there.

Repository-wide audit found branding references only in the title bar, gate,
renderer favicon, README hero, windowManager and Electron Builder configuration.
The unreferenced `robot_window_icon/` copy and the migrated `src/assets/icons/`
set were removed along with the three migrated renderer public copies. The old
README hero was replaced by the approved wordmark and removed after checking its
references. Historical documentation screenshots are retained as historical
captures. No harness/provider artwork was changed.

Linux `npm run build:dist` successfully produced an AppImage. Its extracted
512 px launcher PNG and unpacked `resources/icon.png` were byte-identical to the
canonical generated PNG, and its desktop entry uses `Icon=clanker-grid`.
The unpacked packaged executable was also launched with an isolated profile;
its gate branding loaded successfully from `app.asar` through `file://` URLs.
Windows ICO frames were decoded and verified at 16/24/32/48/64/128/256 px with
alpha transparency. Native Windows NSIS/portable builds, Start Menu rendering,
and macOS DMG/ZIP installation were not exercised on this Linux host.

Verification: `npm run validate` passed lint, typecheck, security audit (zero
vulnerabilities), build and all 194 test files / 4,257 tests. Two successive
regenerations reproduced all 19 generated files byte-for-byte.
