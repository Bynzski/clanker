# Workspace navigation captures — 2026-10-03

Real captures of the packaged Clanker Grid AppImage build (`0.9.0` plus the unreleased
`main` at the `release/0.10-preflight` branch point, `ad7ab92`), intended for the docs and
website. Every PNG is **1920 × 1080** at default zoom, in Dark, Light, and Slate.

Sidebar navigation is the default on new installs; Tabs is the optional alternative
(Settings → Appearance → Workspaces).

| View | Dark | Light | Slate |
| --- | --- | --- | --- |
| Sidebar — four terminals (Codex, Claude, OpenCode, shell), FILES open | [PNG](dark-sidebar-panes.png) | [PNG](light-sidebar-panes.png) | [PNG](slate-sidebar-panes.png) |
| Sidebar — Claude, editor, and embedded Browser | [PNG](dark-sidebar-browser.png) | [PNG](light-sidebar-browser.png) | [PNG](slate-sidebar-browser.png) |
| Sidebar collapsed to the icon rail | [PNG](dark-sidebar-rail.png) | [PNG](light-sidebar-rail.png) | [PNG](slate-sidebar-rail.png) |
| Tabs — four terminals, Explorer dock open | [PNG](dark-tabs-panes.png) | [PNG](light-tabs-panes.png) | [PNG](slate-tabs-panes.png) |
| Tabs — Claude, editor, and embedded Browser | [PNG](dark-tabs-browser.png) | [PNG](light-tabs-browser.png) | [PNG](slate-tabs-browser.png) |

Three workspaces are open in each capture (`docs-site`, `acme-api`, `clanker`); the sidebar
lists each workspace's agents. The harnesses are the real Codex, Claude, and OpenCode CLIs at
their unauthenticated first-run screens; no prompts were submitted. The shell panes ran
`git log` and `ls`. The Browser shows a small local demo page served over HTTP on
`127.0.0.1`, and the editor shows `src/main/platformShell.ts` from a snapshot of this repository.

Capture setup: a fresh user-data profile per capture with only the theme and navigation mode
preset, a blank `HOME` (no accounts, history, or personal paths), neutral demo projects under
`/tmp/demo/projects`, and Playwright's Electron connection with Chromium's headless platform.
Native `WebContentsView` pages are separate surfaces, so each PNG is the renderer capture
composited with the native view capture at its Electron-reported bounds. No mocked bridge,
injected styles, or application source changes were used. Capture tooling and profile data are
outside the repository.

Claude's own first-run preview uses its dark-mode palette, so its diff sample looks faint in
the Light theme; that is the CLI's output, not Clanker's.
