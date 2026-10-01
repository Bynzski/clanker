# Fullscreen app captures — 2026-10-01

Real Electron app captures from Clanker Grid v0.9.0, source commit `617556e`,
using the built renderer on Linux and an isolated temporary user-data profile.
Every PNG is **1920 × 1080**, at default zoom. Electron's `isFullScreen()` and
window bounds were checked; the workspace harness toolbar stays on one line.

| View | Dark | Light | Slate |
| --- | --- | --- | --- |
| Launcher with four terminals selected | [PNG](01-launcher.png) | [PNG](09-light-launcher.png) | [PNG](10-slate-launcher.png) |
| Harnesses, explorer, and native browser | [PNG](03-dark-harnesses-browser.png) | [PNG](04-light-harnesses-browser.png) | [PNG](05-slate-harnesses-browser.png) |
| TypeScript editor, explorer, harnesses, and browser | [PNG](08-dark-editor-browser.png) | [PNG](07-light-editor-browser.png) | [PNG](06-slate-editor-browser.png) |

[Additional Dark workspace](02-multi-harness-explorer.png): Codex, Claude,
OpenCode, and a shell with unequal pane sizes and the source tree expanded.

The browser captures show the public Clanker GitHub repository alongside Codex,
Claude, and Oh My Pi startup screens, plus a shell listing `src`. Editor captures
show `src/main/platformShell.ts` alongside Codex and Claude, with different
terminal heights and column widths. Harnesses are actual running CLIs; no AI
task prompts were submitted. Claude displays its unauthenticated startup state.

Themes were selected through the app's Appearance control for workspace shots.
Launcher follow-ups used the real preload theme preference API and reloaded the
renderer to initialize the saved theme. No mocked bridge, injected styles, or
application source changes were used.

Capture tooling used Playwright's Electron connection. The native browser is a
separate WebContentsView, so browser-inclusive PNGs combine the actual renderer
capture with actual native view captures at their Electron-reported bounds.
These preserve the visible app layout without omitting the browser surface.
Capture tooling and profile data are outside the repository.

All ten captures were checked for dimensions, theme appearance, visible pane
content, and a single-line workspace toolbar. `npm run validate` passed branding,
lint, typecheck, security audit, build, and all 202 test files / 4,335 tests.
