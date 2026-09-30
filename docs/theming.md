# Clanker Theming

## Overview

Clanker ships `dark` and `light` themes. Appearance is application-global and
independent of workspace, layout, browser tabs, and terminal sessions. One shared
theme identity drives native startup, application CSS, xterm, and CodeMirror.
External webpages in WebContentsView are not recolored. System following and
custom themes are not currently supported.

## Canonical theme model

[`src/shared/types/theme.ts`](../src/shared/types/theme.ts) is the canonical model
shared by main and renderer. It contains identity and lightweight metadata, not
renderer-specific palette implementations:

- `ThemeId`: the supported identity union.
- `THEME_IDS`: registry IDs, including the order used by Appearance.
- `THEME_METADATA`: an exhaustive mapping of IDs to display labels, native form
  `colorScheme`, and `windowBackground`.
- `DEFAULT_THEME_ID`: Dark, used for missing or invalid preferences.
- `isThemeId`: runtime validation at UI/IPC boundaries.
- `normalizeThemeId`: safely resolves unknown values to a supported ID.
- `getThemeMetadata`: resolves metadata after normalization.

Native backgrounds match the CSS application surface: Dark `#121212`, Light
`#f3f4f6`. A future theme's color scheme may be Dark or Light independently of its ID.

## Persistence and IPC

```text
Appearance UI → renderer theme store → preload → settings IPC → electron-store
```

[`themeStore.ts`](../src/renderer/theme/themeStore.ts) owns the renderer's current
ThemeId, root `data-theme`, and metadata-derived `color-scheme`. Components call
its action rather than using IPC directly. The renderer never accesses
electron-store; main owns persistence under the application-global `theme` field.
Channel constants live in `src/shared/ipcChannels.ts`.

`GET_THEME` normalizes invalid persisted values to Dark and repairs the stored
value. `SET_THEME` rejects unsupported IDs, writes synchronously, and updates the
native window background. The renderer applies changes immediately before
awaiting persistence. Ordered rapid requests leave the last ID persisted; late
acknowledgements do not rewrite renderer state. Persistence errors are caught and
logged while retaining the locally applied theme. A failed write cannot guarantee
that preference on restart. No localStorage or workspace theme field is involved.

## Startup / no-flash behavior

```text
persisted ThemeId
→ matching native BrowserWindow background
→ hidden BrowserWindow
→ renderer resolves ThemeId
→ data-theme / color-scheme applied
→ React mounts
→ renderer-ready signal
→ window.show()
```

`resolveInitialWindowBackground` in `src/main/windowManager.ts` reads the saved
identity for both initial creation and later window recreation. The window starts
hidden so it cannot expose a partially initialized renderer in the wrong theme.
`src/renderer/main.tsx` resolves appearance before rendering React and invokes the
preload `windowReadyToShow` handshake. The main window IPC handler shows the window
only after that signal. Failed preference initialization falls back to Dark;
bootstrap error paths still notify readiness rather than leaving the window hidden.

## Semantic CSS tokens

[`global.css`](../src/renderer/styles/global.css) defines shared fonts, spacing,
radii, and transition timing once. Each `:root[data-theme="…"]` implements the same
semantic color contract; bare `:root` also matches the safe Dark fallback.

Token families describe surfaces, text, borders/focus, controls, status/Git states,
overlays/shadows, docking previews, selection, scrollbars, and monochrome logo
presentation. `color-mix()` derives translucent states from these roles. Native
form controls follow `color-scheme`.

Application components consume semantic tokens. Do not add ordinary
Dark/Light conditionals, theme-sensitive color literals, or local palette lists.
Provider branding, file/language icon identities, and content-defined colors may
remain explicit. CodeMirror and xterm colors belong in their respective adapters,
not component CSS overrides.

## Terminal themes

[`terminalTheme.ts`](../src/renderer/theme/terminalTheme.ts) owns an exhaustive,
readonly xterm palette mapping and returns independent options objects. It imports
xterm types and ThemeId, without depending on Zustand or TerminalPane. Both palettes
include default text/background, cursor, selection, and all 16 ANSI roles. Dark
retains its original palette. Light uses readable darker hues, including its
nominal white roles; ANSI applications may still choose explicit backgrounds,
dim text, inverse video, or extended colors outside this default contrast contract.

[`themeRuntime.ts`](../src/renderer/theme/themeRuntime.ts) installs one renderer-wide
Zustand subscription. Every living xterm registers with the adapter. Detached or
cached terminals remain registered; cache restore also reapplies current appearance
defensively. Intentional disposal, eviction, replacement, and cache clearing
unregister before disposal. Subscription cleanup supports tests and hot reload.

New TerminalPane instances read the current ThemeId immediately before construction,
after dynamic imports resolve. Theme propagation assigns `terminal.options.theme`
in place and aligns the outer terminal background with xterm's palette so its
viewport gutter does not remain black. It never recreates an xterm or PTY, resets
buffers/selection, or repeats the terminal-ready lifecycle.

## CodeMirror / diff themes

[`editorTheme.ts`](../src/renderer/theme/editorTheme.ts) owns an exhaustive extension
mapping. Dark uses `oneDark` with Clanker's existing dark editor/gutter surfaces.
Light has dedicated editor UI and syntax highlighting for the existing language
parsers; unsupported languages retain readable default text. Returned extension
lists are independent of the frozen canonical lists.

EditorPane has a theme `Compartment` separate from its language compartment. A
small theme effect reconfigures it through `view.dispatch`, independently of editor
creation and document synchronization. Initial construction uses the current ID.

DiffViewer retains its MergeView and gives public `mergeView.a` and `mergeView.b`
EditorViews separate theme compartments. Both reconfigure in place on appearance
changes. MergeView's installed base theme responds to CodeMirror's Dark/Light facet
for chunks, changed text, gutters, and collapse controls. `MergeView.reconfigure`
manages merge settings, so theme extensions use the side editors' dispatch APIs.
Actual diff input changes retain their separate reconstruction lifecycle.

Theme switching preserves view identity, document text, selections, scroll,
dirty/external flags, language/read-only settings, merge chunks, and collapsed
sections. It does not replace EditorState or reconstruct EditorView/MergeView.
CodeMirror transactions naturally produce a new state; unrelated state fields
remain intact. No global editor registry is needed because mounted components own
these views; cold remounts read the current theme.

Dark diff text/gutter colors use One Dark consistently, and insertion/deletion
underlines use MergeView's supported presentation instead of forced transparent
component overrides. Component CSS retains layout and application integration.
`@codemirror/language` and `@lezer/highlight` are explicit direct dependencies for
syntax highlighting, without relying on undeclared transitive imports.

## Appearance settings

[`AppearanceSettings.tsx`](../src/renderer/components/settings/AppearanceSettings.tsx)
appears first in the existing Header Settings dropdown. Its explicitly labeled
native select derives IDs and display labels from the canonical registry and reads
`useThemeStore`. Selection applies immediately, persists through the existing
bridge, and restyles the open Settings subtree without closing or remounting it.
Adding another registered bundled theme automatically adds its option.

## Adding a bundled theme

For a new bundled theme such as `nord`:

1. Extend `ThemeId`, `THEME_IDS`, and `THEME_METADATA`, including a native color scheme
   and window background matching the application surface.
2. Add a complete semantic CSS palette in `global.css`.
3. Add the exhaustive xterm palette in `terminalTheme.ts`.
4. Add the exhaustive CodeMirror extension palette in `editorTheme.ts`.

Normal application components require no changes. Appearance populates from the
registry automatically. TypeScript requires metadata/terminal/editor entries;
registry-driven CSS tests catch absent palettes and token-contract differences.
Run validation and visually review the new palette on supported platforms.

## Testing / quality boundaries

Regression coverage under `tests/main/unit` and `tests/renderer/unit` checks:

- Theme validation, persistence, and metadata/native-background consistency.
- Hidden-window startup and root appearance before the ready-to-show signal.
- Registry-wide CSS token parity, core tokens, literal boundaries, and Light contrast.
- Initial xterm palettes, async construction races, live/cached propagation,
  original-object restoration, registry disposal, and ANSI contrast.
- EditorPane compartment changes preserving document/selection/scroll/store flags.
- Both MergeView editors changing in place while retaining chunks, collapse state,
  selections, scroll, and read-only settings; actual CodeMirror integration tests
  complement component mocks.
- Appearance's registry options, accessible label, immediate store/DOM/bridge
  updates, open Settings lifecycle, rapid changes, and persistence failure behavior.

Use `npm run validate` for lint, typecheck, security audit, build, and tests.
Platform-specific visual QA remains useful for new palettes: inspect startup,
ANSI output/cursors/selections, syntax/diffs, native controls, hover/focus, and
settings while preserving unsaved content and running sessions.

Dark/Light have been reviewed in real Electron on Linux, including full restarts,
live/cached terminals, unsaved editors, open diffs, and keyboard Appearance switching.
Windows/macOS, packaged-release presentation, IME, connected SSH directory listings,
and a full pointer-driven docking transaction were not manually exercised in that
review. External webpages intentionally remain outside Clanker's theme system.
