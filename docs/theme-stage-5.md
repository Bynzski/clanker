# Stage 5 — Appearance settings and issue #48 acceptance

This stage exposes the completed theme system through Settings. It follows
[Stage 2](theme-stage-2.md), [Stage 3](theme-stage-3.md), and
[Stage 4](theme-stage-4.md); their palette and lifecycle implementations remain
unchanged. No System/Auto/custom option or additional preference is introduced.

## Appearance UX

`settings/AppearanceSettings.tsx` is the first section of the existing Header
Settings dropdown, above AI commit messages and harness defaults. It reuses
`settings-section`, `settings-row`, `settings-row-label`, and `settings-select`.
A native select has an explicit `Theme` label connected through React `useId`.
Its options come from shared `THEME_IDS` and `THEME_METADATA`, without another
renderer list of IDs or labels. The current value and action come exclusively
from `useThemeStore`; the component never calls the preload bridge directly.

The first settings section omits its leading separator/margin. The dropdown now
uses the common `--shadow-popover` rather than its own shadow calculation. This
is the small remaining practical consistency cleanup; Stage 2 already normalized
pane/header surfaces, controls, tabs, statuses, focus and docking roles. The fatal
React-render fallback also uses `--text-primary`, correcting white text that
would be unreadable on a Light background. Startup sequencing is unchanged.

## Switching, persistence and ordering

The native change handler validates the selected registry ID and invokes the
existing store action. That action applies root `data-theme` and metadata-derived
`color-scheme`, then synchronously updates Zustand. CSS restyles the open Settings
subtree and all chrome. The renderer-wide terminal subscription updates all
registered xterms, including detached cached instances. EditorPane and DiffViewer
reconfigure only their theme compartments. Settings stays open throughout.

The existing path remains:

`Appearance → themeStore → preload SET_THEME → settingsIpc → electron-store`

The main handler validates and writes synchronously, then updates the native
window background. There is no async boundary inside that handler; electron-store's
installed `conf` writer is synchronous. Ordered rapid requests therefore leave the
last requested identity persisted. Renderer state is not rewritten when persistence
acknowledgements resolve, so even delayed/reversed acknowledgements cannot roll it
back. Tests cover both halves, and real Electron rapid changes settled consistently.
No queue, new persistence field, localStorage, or workspace coupling was added.

The existing failure policy is preserved: persistence errors are caught/logged,
the locally applied theme remains selected, and the action resolves without an
unhandled rejection. A failed write cannot guarantee that preference on restart;
this is explicitly different from the normal successful persistence path.

## Automated coverage

New `AppearanceSettings.test.tsx` uses the actual renderer theme store and mocked
preload boundary. It covers both registered initial values, registry labels,
accessible native semantics, rerender stability, keyboard access, immediate
Dark/Light/Dark DOM/store/bridge updates, workspace-store identity preservation,
persistence rejection and reversed acknowledgements during rapid changes.

`Header.test.tsx` proves the section appears first in the real Settings dropdown
and switching leaves the dropdown mounted with neighboring AI settings visible.
Its existing select count now includes Appearance. `settingsIpc.test.ts` adds a
regression for synchronous rapid ordered writes and final native background.
`themeTokens.test.ts` now checks parity/core tokens across **every registered
ThemeId**, and its palette reader accepts the canonical type rather than a
separate Dark/Light union.

Existing bootstrap, window-manager and theme-store tests already cover persisted
Dark/Light initialization before the ready-to-show signal, native background,
hidden startup, fallback, and window recreation. They remain intact. Existing
TerminalPane/terminal adapter/runtime tests cover construction, cache restore,
registry disposal and session preservation. EditorPane/DiffViewer and actual
CodeMirror integration tests retain coverage of view identity, document/selection,
scroll, dirty/external flags, read-only facets, MergeView chunks and collapse state.

## Real Electron QA

Used Electron 41 on Linux with an isolated `/tmp/clanker-stage5-profile` and a
separate Git fixture in `/tmp/clanker-stage5-fixture`. No user workspace or project
Git content was altered by QA. Temporary scripts/screenshots/state captures live
under `/tmp/clanker-stage5-qa` and are not added as a visual-testing framework.
The renderer used the repository's Vite development server with the built Electron
main process. Tests/build also exercise the production bundle; a packaged release
was not visually exercised.

Three fully separate launches used the same profile:

| Launch | First visible native background | Root/scheme/body at first show | Persisted/store after load |
| --- | --- | --- | --- |
| Initial Dark | `#121212` | Dark / Dark / `rgb(18, 18, 18)` | Dark |
| Light restart | `#f3f4f6` | Light / Light / `rgb(243, 244, 246)` | Light |
| Dark restart | `#121212` | Dark / Dark / `rgb(18, 18, 18)` | Dark |

Each window began hidden. First-visible captures and ready-to-show coverage show
no wrong-theme startup flash in these runs. Preference was read through the actual
bridge and persisted profile, not seeded again on restart.

In the first workspace run, two visible xterms and one cold/detached cached xterm
changed together through the Appearance control. Their object count remained
three and disposal count zero. Exact buffers, selections and cursor positions
were preserved. Restoring the cached workspace reused its original xterm, already
Light, with 67 buffer lines and the same selection. Browser tabs and the serialized
workspace/layout state were unchanged during theme changes.

An unsaved TypeScript editor had a selection and 280px scroll position. The same
EditorView retained text, selection, scroll and dirty state through both directions.
Development StrictMode's initial cleanup was distinguished from theme switching:
no switch increased the destroy count. A real 160-line MergeView contained changed
lines, additions/deletions and collapsed sections. After expanding a middle section,
selecting both sides and scrolling 180px, switching retained both original views,
MergeView DOM, documents, selections, collapse widgets, read-only facets and scroll;
MergeView destroy count remained zero. The actual CodeMirror integration test also
asserts MergeView object and chunk-array identity directly. Both dark facets changed
together. The Settings control's change event was exercised while the diff modal
was open; ordinary modal pointer blocking was not changed.

After the Light restart, four terminals were constructed directly in Light. A
12-second shell loop continued through live switches and rapid Light/Dark changes,
printed all 12 entries and returned to the original shell. Terminal object count
stayed four. The native Theme select had an actual keyboard focus-visible ring in
both themes (2px solid Dark `#8b949e`, Light `#2667b0`); Arrow Up changed Light to
Dark and updated the store, root, all four terminals and persisted value. Settings
remained open. The final UI selection was Dark before the full Dark restart.

Representative surface review in both themes:

| Surface/states | Verification |
| --- | --- |
| Shell, title bar, header, status bar, workspace tabs/gate | Actual workspace and startup captures; active/inactive/disabled controls |
| Settings and neighboring AI/harness settings | Open dropdown live changes, native select/label/focus, disabled Provider/Model |
| Terminal chrome/content | Visible/cached terminals, ANSI sample, scrollback and selections; prior Stage 3 full ANSI/cursor review retained |
| Editor/diff | Actual installed CodeMirror and MergeView; dirty tab, source syntax, selections, scroll, collapse and changed chunks |
| Browser toolbar/tabs/URL/annotation controls | Actual BrowserPanel and two tabs; native webpage styling is outside this system |
| Browser history suggestions | Actual BrowserUrlInput mounted with representative history props; highlighted/unselected entries, both themes |
| File explorer/context menu/Git indicators | Actual fixture files, modified/untracked marks, context menu, destructive action |
| Git menu/commit dialog | Actual fixture repository; statuses, empty branches/stash/remotes states, disabled actions and modal |
| Credentials | Actual empty SSH-key and token forms, labels, disabled Save, surfaces/borders |
| Recipe/confirmation/annotation handoff | Actual components with isolated QA props; controls, backdrop, empty-agent state |
| Remote directory chooser | Actual missing-environment error/Retry and disabled selection in both themes; no SSH connection attempted |
| Pane boundaries, handles, docking previews | Existing docking DOM with its active/over presentation classes; visual preview check, no drag transaction committed |
| Hover/active/selected/status/focus/selection/scrollbars | Representative real controls/content and existing token/state/contrast tests; Stage 2 broad state review retained |

Not every application/error/provider combination was individually rendered again.
Markdown, unsupported text, external-change banner and empty-editor transitions
retain Stage 4's real Electron review rather than being separately repeated here.
Remote connected directory listings/creation, a full pointer-driven drag/drop
transaction, Windows/macOS, IME and every platform-native menu remain outside this
manual run. These are testing limits, not claims of visual verification.

## Final color and consistency audit

Reviewed renderer CSS and TS/TSX for hex, RGB/RGBA, named white/black colors and
Dark/Light styling branches. Remaining literal classes are:

- `styles/global.css`: central semantic palettes, including shadows/translucency;
  structural values remain shared once. Dark/Light implement the same contract.
- `theme/terminalTheme.ts`: central xterm default/cursor/selection/ANSI palettes.
- `theme/editorTheme.ts`: central CodeMirror UI/syntax/diff palette extensions;
  upstream One Dark remains the Dark syntax source.
- `GitButton.css`: intentional Bitbucket `#0052cc` and 12% tint; GitLab `#e24329`
  and 12% tint. These are provider identities, not ordinary surfaces.
- `FileExplorer/fileTypeConfig.ts` and source logo artwork: file/language/brand
  identities. `transparent` and `currentColor` are inherited/compositional styling.

No component-level Dark `.cm-*` override or inline xterm palette remains. No
ordinary component branches on `theme === 'dark'` or `theme === 'light'`. The only
runtime theme comparison detects whether the canonical identity changed before
propagating to terminals. No accidental ordinary-chrome color literal remains;
the fatal-render fallback was the one leftover fixed here. External browser pages
receive no theme CSS injection, and no dependencies were changed in this stage.

## Adding a third bundled theme

A developer adds only the theme definitions/registration:

1. Extend shared `ThemeId`, `THEME_IDS`, and exhaustive metadata (label, appropriate
   Dark/Light native color-scheme and application-matching window background).
2. Add a root semantic CSS palette implementing the full token contract.
3. Add the exhaustive xterm palette in `terminalTheme.ts`.
4. Add the exhaustive CodeMirror extension palette in `editorTheme.ts`.

The Settings options populate automatically. Components and their CSS need no
new appearance branches. TypeScript requires the metadata/terminal/editor entries;
the registry-driven CSS tests require a matching palette and contract. CSS cannot
be exhaustively typed by TypeScript, so that boundary is deliberately tested.
Theme contrast and native platform presentation still warrant QA for a new palette.

## Issue #48 acceptance checklist

Re-read [issue #48](https://github.com/Bynzski/clanker/issues/48) in full before
completion. Each original acceptance criterion is mapped below. "Pass" includes
the stated manual coverage limits; it does not mean every platform was exercised.

| Criterion | Implementation / automated evidence | Visual/manual evidence or limit | Result |
| --- | --- | --- | --- |
| Settings switches Dark/Light | Registry-driven Appearance; Appearance/Header tests | Both directions through open Settings | Pass |
| Immediate without restart | Store/root/runtime/compartments; integration tests | Open dropdown and all subsystems update | Pass |
| Preference survives restart | Existing SET_THEME/electron-store/startup tests | Full Light and Dark relaunches, same profile | Pass |
| No wrong-theme startup flash | Hidden window + bootstrap handshake tests | Both first-visible captures match preference | Pass |
| Native startup background matches | Metadata/windowManager/token tests | First-show native colors match renderer | Pass |
| Existing xterms update | Runtime registry; TerminalPane/runtime tests | Two visible, then four visible, no reconstruction | Pass |
| Cached/restored xterms selected theme | Cache registration/lifecycle tests | Detached updates, original reused on restore | Pass |
| Editor keeps document/state | Theme Compartment; real CM integration tests | Same view, unsaved text/selection/scroll/dirty state | Pass |
| Diff current theme | A/B compartments; DiffViewer/real CM tests | Both facets update, no MergeView destruction | Pass |
| Major CSS surfaces avoid Dark literals | Semantic tokens; component literal audit test | Broad surface review above | Pass |
| Same Dark/Light token contract | Registry-wide token parity/core tests | Palettes integrate with normal chrome | Pass |
| Interaction/status states distinct | Shared state tokens; contrast tests | Settings, Git, modal, credentials; not every combination | Pass |
| Dock/drop overlays readable | Shared preview/border/text tokens | Active/over presentation classes; no drag commit | Pass |
| Explorer/Git distinguishable | Git roles and existing icon/text markers | Modified/untracked fixture and menus | Pass |
| Browser chrome/history/annotation readable | Semantic BrowserPanel/annotation CSS | Actual toolbar/tabs; history props; handoff component | Pass |
| Modal/elevated contrast | Shared raised/elevated/backdrop/shadows | Commit, credentials, recipe, confirm, annotation, chooser | Pass |
| Scrollbars/selection appropriate | Global tokens and subsystem themes | Terminal/editor/diff/menu scrolling and selection | Pass |
| Primary/secondary reasonable contrast | Token contrast and editor/ANSI palette tests | Both theme surface reviews | Pass |
| Focus-visible obvious | Global focus ring; accessible native control tests | Real keyboard/select outlines in both themes | Pass |
| Status not color alone | Existing text/icons retained with token migration | Git file labels/icons, disabled labels, chooser error/Retry | Pass |
| No workspace/terminal/editor/browser/layout reset | Store-identity and subsystem state tests | Full workspace snapshot, buffers/selections, views and browser tabs | Pass |
| Existing validation passes | Full normal pipeline, unchanged test strength | See validation below | Pass |
| Third theme principally definitions | Exhaustive typed maps + registry CSS contract | Four-definition audit above | Pass |
| No normal component theme branches | Registry/adapters/token resolution; source audit | No scattered Dark/Light conditionals | Pass |
| CSS/xterm/editor/native share identity | Shared ThemeId/store/metadata; startup/runtime tests | Same store/root/subsystem preference through switches/restarts | Pass |

## Validation and limitations

`npm run lint`, `npm run typecheck`, `npm run build`, `npm run test`, and final
`npm run validate` pass. Full suite: **181 test files, 4,124 tests**. Security audit:
**0 vulnerabilities**. Existing non-blocking Vite warning: a minified bundle exceeds
600 kB. The environment also prints a NO_COLOR/FORCE_COLOR warning; neither warning
was suppressed. Electron QA logged existing Wayland/Vulkan/color-management
messages; the recorded application/theme checks succeeded.

No terminal/session architecture, CodeMirror document synchronization, workspace
persistence, Git behavior, external webpage styling, or theme persistence policy
was changed. Platform/manual limits are listed above. Persistence failures remain
logged/local-only by design. No issue merge or third theme is part of this stage.

## Exact changed files

- `docs/theme-stage-5.md`
- `src/renderer/components/settings/AppearanceSettings.tsx`
- `src/renderer/components/HeaderRightControls.tsx`
- `src/renderer/components/Header.css`
- `src/renderer/main.tsx`
- `tests/renderer/unit/AppearanceSettings.test.tsx`
- `tests/renderer/unit/Header.test.tsx`
- `tests/renderer/unit/themeTokens.test.ts`
- `tests/main/unit/settingsIpc.test.ts`
