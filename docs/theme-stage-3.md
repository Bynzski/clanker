# Issue #48 — Stage 3: terminal themes

This stage themes xterm only, plus matching native window backgrounds to the
Stage 2 application surfaces. There is still no Appearance selector. CodeMirror,
MergeView, and external browser content are unchanged.

## Architecture and lifecycle

`src/shared/types/theme.ts` continues to own theme identity and metadata. Native
window backgrounds now match the application: Dark `#121212`, Light `#f3f4f6`.
The hidden-window startup and ready handshake are unchanged.

`terminalTheme.ts` owns an exhaustive `Readonly<Record<ThemeId, Readonly<ITheme>>>`
palette mapping, imports xterm types only, and returns independent option objects.
It has no dependency on Zustand or TerminalPane. Its explicit Set holds all living
xterms. `themeRuntime.ts` installs one renderer-wide Zustand subscription before
bootstrap resolves persisted identity. Only identity changes propagate; disposal
of the subscription supports cleanup and hot reload.

TerminalPane reads the current store identity immediately before construction,
after its dynamic imports resolve. Successful instances register with the adapter.
Cache restore reapplies the current palette defensively to the original instance.
DOM detach retains registry membership. Intentional close, cache eviction,
replacement, and clearTerminalCache unregister before disposal. Failed runtime
initialization disposes its unregistered instance. A pending import cannot create
an intentionally disposed terminal.

Propagation assigns `terminal.options.theme`. It neither constructs terminals nor
calls PTY, input, resize, ready, buffer reset, or selection-clear APIs. Cached
instances receive the same updates as mounted ones.

xterm 6 colors its inner scrollable element but leaves the outer viewport black
in stock CSS. The adapter also assigns the terminal root background, and the
scoped viewport inherits it. This removes the exposed black gutter in both
palettes; it is the only deliberate Dark visual normalization. All Dark xterm
palette values are unchanged.

## Palettes

| Role | Dark (unchanged) | Light |
| --- | --- | --- |
| background | `#121212` | `#f3f4f6` |
| foreground | `#e8e8e8` | `#202630` |
| cursor | `#8b949e` | `#46566b` |
| cursorAccent | `#121212` | `#f3f4f6` |
| selectionBackground | `#2f2f2f` | `#bed5f2` |
| selectionInactiveBackground | xterm default | `#d4deeb` |
| selectionForeground | xterm default | `#202630` |
| black | `#121212` | `#202630` |
| red | `#f85149` | `#a32929` |
| green | `#3fb950` | `#236b35` |
| yellow | `#d29922` | `#795600` |
| blue | `#58a6ff` | `#245da8` |
| magenta | `#bc8cff` | `#7840a0` |
| cyan | `#39c5cf` | `#176b78` |
| white | `#e8e8e8` | `#525e6d` |
| brightBlack | `#9b9b9b` | `#626d7b` |
| brightRed | `#ffa198` | `#bc3535` |
| brightGreen | `#56d364` | `#28783d` |
| brightYellow | `#e3b341` | `#886300` |
| brightBlue | `#79c0ff` | `#286bc2` |
| brightMagenta | `#d2a8ff` | `#8b47b3` |
| brightCyan | `#56d4dd` | `#197a86` |
| brightWhite | `#ffffff` | `#657080` |

Light white roles use readable neutral foregrounds rather than near-white.
Every Light ANSI foreground exceeds 4.5:1 against its default background
(minimum 4.56:1); none needs a lower-contrast exception. Default text is 13.81:1.
Tests also check cursor and active/inactive selected-text contrast. Explicit ANSI
backgrounds, dim text, inverse video, and application-defined/extended palettes
remain terminal-application choices; a foreground-on-default-background test
cannot guarantee every such combination.

## Tests and validation

The existing TerminalPane harness is extended to exercise real create/detach/
restore/cache-disposal paths rather than duplicating its lifecycle mocks in a
second harness. Tests cover initial Dark and Light construction, identity changes
before dynamic imports complete, multiple living terminals, Dark/Light/Dark,
no reconstruction or unrelated session calls, cached output and theming,
restoration identity, disposal, cache clearing, and replacement eviction.

New adapter tests verify every ThemeId, all 16 ANSI roles, exact Dark values,
independent options, Light contrast, and matching native backgrounds. Runtime
tests verify idempotent subscription, identity-only propagation, and cleanup/
restart. Bootstrap verifies terminal propagation before ready-to-show. Native
metadata/window/settings tests and session-bridge mocks are updated. CSS contract
tests now verify native backgrounds match each application surface.

Validation: lint, typecheck, build, full test suite, and final `npm run validate`
pass. Full suite: **178 files, 4,101 tests**. Security audit: **0 vulnerabilities**.
The existing Vite bundle-size warning remains.

## Visual and session QA

Real Electron 41 / xterm 6 was run on Linux with an isolated temporary profile,
persisted Light, and a temporary workspace. No saved user workspace was used.
Temporary Electron capture scripts were used; no visual-testing framework was
added to the repository.

- The first actual xterm opened with the Light palette, with no Dark construction.
- Captures reviewed standard 8 and bright 8 ANSI foregrounds, default and bold
  text, cursors, selection, scrollback, scrollbars, and application integration in
  both palettes. Dark ANSI black remains identical to the background, as required
  by the existing production palette.
- Switching while a shell command slept preserved the same object, exact buffer
  lines, cursor coordinates, scrollback position, and selected text. The running
  command was not restarted or killed.
- Four simultaneous panes changed together. Switching through three other
  workspaces made their original workspace cold: all four xterms were confirmed
  detached, updated in both directions, then reattached as the same four objects.
  Constructor count stayed four, disposal count stayed zero, and every instance
  retained its scrollback markers.
- A second capture pass confirmed all four outer viewports matched the palette
  after the black-gutter correction.

Screenshots and temporary QA output are under `/tmp/clanker-stage3-qa` and
`/tmp/clanker-stage3-final-qa` in this workspace environment; these are temporary
artifacts, not a committed test suite. Windows/macOS rendering, IME composition,
and SSH-backed PTYs were not visually exercised. The adapter is transport-agnostic.
CodeMirror and MergeView still use their existing Dark editor themes and remain
explicitly deferred. Theme switching remains programmatic until a later stage.

## Exact changed files

- `docs/theme-stage-3.md`
- `src/renderer/components/TerminalPane.css`
- `src/renderer/components/TerminalPane.tsx`
- `src/renderer/main.tsx`
- `src/renderer/theme/terminalTheme.ts`
- `src/renderer/theme/themeRuntime.ts`
- `src/shared/types/theme.ts`
- `tests/main/unit/settingsIpc.test.ts`
- `tests/main/unit/theme.test.ts`
- `tests/main/unit/windowManager.test.ts`
- `tests/renderer/unit/TerminalPane.test.tsx`
- `tests/renderer/unit/bootstrap.test.tsx`
- `tests/renderer/unit/terminalSessionBridge.test.ts`
- `tests/renderer/unit/terminalTheme.test.ts`
- `tests/renderer/unit/themeRuntime.test.ts`
- `tests/renderer/unit/themeTokens.test.ts`
