# Development UI captures — 2026-09-30

Real Electron development app captures from Clanker Grid v0.8.0, source commit `ece0996`.
Each PNG contains the entire app window at **1200 × 800**, at the default zoom, on Linux.
Dark and light captures use the same window size and matching views.

The app used an isolated temporary Electron user-data profile. The session was opened
against the local Clanker repository with two basic shell terminals. Terminal startup
output was cleared before capturing workspace views. No AI conversation was launched,
recipe saved, or credential created. Paths and installed harness/model availability
reflect the capture machine; these are visual reference artifacts, not pixel-test baselines.

| View | Dark | Light | Description |
| --- | --- | --- | --- |
| Start gate | [PNG](dark/01-start-gate.png) | [PNG](light/01-start-gate.png) | Initial launcher with default Codex and four-terminal selection. |
| Harness configuration | [PNG](dark/02-harness-configuration.png) | [PNG](light/02-harness-configuration.png) | Harness visibility and launch defaults. |
| New session setup | [PNG](dark/03-new-session-ready.png) | [PNG](light/03-new-session-ready.png) | Local Clanker workspace selected with two basic terminals. |
| Running workspace | [PNG](dark/04-workspace-session.png) | [PNG](light/04-workspace-session.png) | Two live PTY terminals after launching the workspace. |
| New workspace dialog | [PNG](dark/05-new-workspace-dialog.png) | [PNG](light/05-new-workspace-dialog.png) | Open another workspace from the title bar. |
| Settings menu | [PNG](dark/06-settings.png) | [PNG](light/06-settings.png) | Appearance, AI commit settings, and harness defaults. |
| Launch recipe editor | [PNG](dark/07-workspace-recipes.png) | [PNG](light/07-workspace-recipes.png) | Unsaved recipe populated from the two-terminal layout. |
| VCS credentials | [PNG](dark/08-vcs-credentials.png) | [PNG](light/08-vcs-credentials.png) | SSH key status and credential management entry point. |

## Slate theme follow-up

The `slate/` captures show the new Slate palette from the working tree based on
commit `b73c0c0`, at the same 1200 × 800 size. Slate was selected through the actual
Appearance control and verified after a full Electron restart.

| View | Slate |
| --- | --- |
| Start gate | [PNG](slate/01-start-gate.png) |
| Harness configuration | [PNG](slate/02-harness-configuration.png) |
| New session setup | [PNG](slate/03-new-session-ready.png) |
| Running workspace | [PNG](slate/04-workspace-session.png) |
| New workspace dialog | [PNG](slate/05-new-workspace-dialog.png) |
| Settings menu | [PNG](slate/06-settings.png) |
| Launch recipe editor | [PNG](slate/07-workspace-recipes.png) |
| VCS credentials | [PNG](slate/08-vcs-credentials.png) |
| Explorer and TypeScript editor | [PNG](slate/09-editor.png) |

## Capture workflow

1. Run `npm run dev:renderer` to serve the renderer on port 1420.
2. Run `npm run build:shared` and `npx tsc -b tsconfig.main.json`.
3. Launch `NODE_ENV=development node_modules/.bin/electron . --user-data-dir=/tmp/clanker-screenshot-profile` with a fresh temporary profile path.
4. Keep the default 1200 × 800 window. Capture the start gate and Configure screen.
5. Select the repository, Terminal, and two terminals; capture setup and launch.
6. Clear shell startup output with Ctrl+L in each terminal. Capture the workspace,
   Open Workspace dialog, Settings, Workspace Launch Recipes, and VCS credentials.
7. Select Light under Settings → Appearance → Theme and repeat. Close the workspace
   to return to the start gate for the remaining light-theme captures.

These PNGs were captured through Playwright connected to a temporary Electron debugging
port bound to loopback. No mocks, renderer style overrides, or application source changes
were used. Capture tooling and profile data live outside the repository.
