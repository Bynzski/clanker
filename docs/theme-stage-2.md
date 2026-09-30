# Issue #48 — Stage 2 renderer tokens

Stage 2 themes application chrome only. Stage 1 persistence, IPC, theme identity,
hidden-window startup and the readiness handshake are unchanged. No appearance
selector is exposed. xterm, CodeMirror, MergeView and external browser pages are
outside this stage.

## Inventory and architecture

All 33 renderer CSS files were inspected before migration (global.css, App.css,
all component CSS, FileExplorer, git and settings). The inventory included color
literals, translucent layers, borders, shadows, hover/active/selected states,
disabled opacity, focus, backdrops, selection, scrollbars, lifecycle/Git states,
docking targets, dialogs and menus. Inline renderer token references were also
searched; StatusBar's SVG fill was migrated.

Structural tokens (fonts, spacing, radii and transition timing) live once in
`:root`. The 60 theme-dependent tokens have matching definitions in
`:root[data-theme="dark"]` and `:root[data-theme="light"]`. The Dark palette also
matches bare `:root`, preserving the startup fallback. The existing theme store
sets the root attribute; CSS immediately propagates changes without component
state changes. Each palette sets its native form-control `color-scheme`.

Token families:

- `surface-*`: app, raised chrome, elevated menus/dialogs, controls, sunken content,
  interaction layers, loading gradients and docking previews.
- `text-*`: primary, secondary, muted, inverse, links and overlay labels.
- `border-*`, `focus-ring`, `accent-interactive*`: boundaries, keyboard focus and
  interactive icons/indicators.
- `control-*`: paired backgrounds/foregrounds for primary and danger actions,
  plus existing success/info action hover colors.
- `status-*` and `git-*`: feedback/lifecycle states and Git file states.
- `overlay-backdrop`, `shadow-*`: scrims and elevation.
- `selection-*`, `scrollbar-*`: global interactions.
- `logo-monochrome-filter`: contrast for white Codex/Pi/OMP/Antigravity artwork.

`color-mix()` derives translucent interaction/status layers from semantic colors
and preserves existing alpha strengths and shadow geometry without creating a
token per selector. `surface-tint` is the neutral interaction wash;
`surface-inset-tint` handles inset code/session backgrounds. Neither depends on
an assumed white/black foreground in component CSS.

## Palettes and Dark normalization

Dark retains the production base: app `#121212`, raised/elevated `#1a1a1a`,
controls `#232323`, default border `#2f2f2f`, text `#e8e8e8`/`#9b9b9b`/`#70757d`,
neutral accent `#8b949e`, and the existing success/warning/error colors
`#3fb950`/`#d29922`/`#f85149`.

Small consistency changes consolidate previously varied red, amber, green/teal,
blue and purple status shades; unify subtle borders around the existing 5% white
value; unify modal backdrops at 60% black; and remove the browser suggestion
surface's small navy mix. Docking and loading foregrounds use shared semantic
roles, and drag grips use the primary text color. Previously undefined hover
variables now resolve consistently. These are color normalizations; layout,
spacing, sizing and animation declarations were preserved.

Light uses cool neutral app `#f3f4f6`, raised `#e9ecf0`, elevated `#fafbfc`, sunken
`#e1e5ea` and control `#f8f9fb` surfaces. Primary text is `#202630`, secondary
`#525e6d`, muted `#606a77`; default borders are `#c9d0d9`. Slate primary actions
use `#526880`, with `#41566f` hover and white text. Focus uses `#2667b0`.
Status foregrounds are dark green `#105a29`, amber `#6d4600`, red `#921e1b`,
blue `#154b83` and purple `#59318c`. Light backdrops and shadows use cool gray
rather than opaque black. Status colors also pass text contrast checks on their
25% tinted backgrounds. White monochrome harness artwork is darkened with a
CSS filter in Light; the source SVGs and colored/multicolor logos are intact.

## Tests and validation

`tests/renderer/unit/themeTokens.test.ts` adds five tests covering:

1. Both palettes exist, expose the core contract and have exact name parity.
2. Structural definitions remain shared and missing-theme startup falls back to Dark.
3. Every CSS token reference resolves and old brightness-based names are absent.
4. Component color literals are restricted to provider identities or `.cm-*` overrides.
5. Light text/status/control contrast (4.5:1), tinted status contrast (4.5:1),
   and focus contrast (3:1).

Existing theme store and main theme tests are unchanged and pass (20 tests).
The full suite passes: 176 files, 4,070 tests including the five new tests.
Lint, typecheck and build pass. Final `npm run validate` passed lint, typecheck,
security audit (zero vulnerabilities), build and tests. Vite retains its existing large-chunk warning.

## Visual QA

Live Electron 41 screenshots were captured in a temporary user-data profile,
using the existing Vite renderer and actual components. Programmatic
`useThemeStore.setTheme()` switched themes during QA. No visual testing dependency
or framework was added.

Both Dark and Light were reviewed for the workspace gate, TitleBar/Header/
StatusBar, workspace tabs, settings dropdown, credentials, file explorer and
context menu, browser chrome, notes, Git menu, commit dialog, confirmation dialog,
recipe form, annotation handoff, remote chooser error/disabled states and docking
presentation states. Focus rings and scrollbars were visible in commit and
annotation dialogs. Hover presentations, selection, disabled actions and
success/warning/error/info/Git colors were checked using existing CSS rules.
Less accessible dialogs were mounted with temporary QA props; docking classes
were forced for presentation inspection without performing a drop.

Limits: Linux Electron was reviewed, not native Windows/macOS rendering. Remote
chooser failure UI was inspected without a live SSH host; successful remote
listings and forwarding states were not exercised. Every transient asynchronous
state and every provider badge combination was not individually screenshot-tested.
The normal workspace showed Dark terminal contents inside Light chrome, as
expected for the explicitly deferred terminal stage. Editor/diff internals were
not assessed for Light-theme correctness.

## Remaining literal audit

Every remaining renderer CSS color literal was reviewed:

- **Theme definitions:** global.css contains the canonical palette values.
- **Theme-independent provider identity:** GitButton.css retains Bitbucket
  `#0052cc` / `rgba(0, 82, 204, 0.12)` and GitLab `#e24329` /
  `rgba(226, 67, 41, 0.12)` branding.
- **Deferred CodeMirror overrides:** EditorPane.css `.cm-*` rules retain
  `#121212` backgrounds and their 5% white gutter border.
- **Deferred MergeView overrides:** DiffViewer.css `.cm-*` rules retain
  `#121212` backgrounds, `#e8e8e8` foreground, `#70757d` gutter text and
  the 5% white gutter border. Freezing their existing resolved Dark values prevents
  accidental partial editor recoloring through the renamed app tokens.
- **Other renderer sources:** fileTypeConfig.ts language/file-type identities and
  source logo artwork stay theme-independent. TerminalPane.tsx retains its entire
  xterm palette, cursor and selection configuration. CodeMirror `oneDark`, editor
  extensions and MergeView configuration remain unchanged.

No accidental ordinary-chrome color literals remain. External WebContentsView
pages receive no theme injection.

## Exact changed files

- `docs/theme-stage-2.md`
- `src/renderer/App.css`
- `src/renderer/components/AnnotationHandoffDialog.css`
- `src/renderer/components/BrowserPanel.css`
- `src/renderer/components/ChatHistoryDropdown.css`
- `src/renderer/components/CommitDialog.css`
- `src/renderer/components/ConfirmCloseDialog.css`
- `src/renderer/components/DiffViewer.css`
- `src/renderer/components/DynamicPaneLayout.css`
- `src/renderer/components/EditorPane.css`
- `src/renderer/components/EditorTabBar.css`
- `src/renderer/components/ErrorBoundary.css`
- `src/renderer/components/FileExplorer/ContextMenu.css`
- `src/renderer/components/FileExplorer/FileExplorer.css`
- `src/renderer/components/GitButton.css`
- `src/renderer/components/Header.css`
- `src/renderer/components/NotesPane.css`
- `src/renderer/components/RecipeModal.css`
- `src/renderer/components/RemoteDirectoryChooser.css`
- `src/renderer/components/StatusBar.css`
- `src/renderer/components/StatusBar.tsx`
- `src/renderer/components/TaskRecoverySection.css`
- `src/renderer/components/TerminalPane.css`
- `src/renderer/components/TitleBar.css`
- `src/renderer/components/WorkspaceGate.css`
- `src/renderer/components/WorkspaceTabs.css`
- `src/renderer/components/git/GitBranchesSection.css`
- `src/renderer/components/git/GitHistorySection.css`
- `src/renderer/components/git/GitMergeSection.css`
- `src/renderer/components/git/GitRemotesSection.css`
- `src/renderer/components/git/GitStashSection.css`
- `src/renderer/components/git/ProviderBadge.css`
- `src/renderer/components/git/ProviderMenu.css`
- `src/renderer/components/settings/CredentialSettings.css`
- `src/renderer/lib/harnessOptions.ts`
- `src/renderer/styles/global.css`
- `tests/renderer/unit/themeTokens.test.ts`
