# Issue #48 — Stage 4: editor and diff themes

## Architecture and installed APIs

`src/renderer/theme/editorTheme.ts` owns an exhaustive
`Readonly<Record<ThemeId, readonly Extension[]>>` mapping. It depends on theme
identity and CodeMirror APIs, never persistence, workspace state, or the terminal
runtime. Each call returns a fresh extension list; canonical lists are frozen.
Adding a ThemeId requires an editor palette entry at compile time.

Installed APIs inspected before implementation:

- `@codemirror/state` 6.6.0: `Compartment.of`, `reconfigure`, and `get`.
- `@codemirror/view` 6.41.0: `EditorView.theme`, `darkTheme`, and transaction dispatch.
- `@codemirror/merge` 6.12.1: public `a` and `b` EditorViews, `chunks`, and
  `reconfigure(MergeConfig)`. The latter manages merge settings, not arbitrary
  side-editor extensions. Merge base styling uses `&dark` / `&light`, reacting
  to the editor's dark-theme facet without rebuilding the merge view.
- `@codemirror/theme-one-dark` 6.1.3: existing One Dark UI and syntax extensions.
- `@codemirror/language` 6.12.3: `HighlightStyle` and `syntaxHighlighting`.
- `@lezer/highlight` 1.2.3: standard syntax tags and their modifier functions.

The last two packages were already installed transitively. They are now explicit,
exact-version production dependencies because the adapter imports them directly.
The lockfile's resolved dependency graph is unchanged; only root declarations
were added. No unrelated dependency upgrade was made.

## Dark behavior

Dark uses the existing `oneDark` extension, preserving its syntax, cursor,
selection, active-line, panel, tooltip, and bracket palette. A theme extension
preserves Clanker's existing `#121212` editor/scroller/gutter surfaces and subtle
`rgba(255, 255, 255, 0.05)` gutter border, formerly imposed through component CSS.

Small documented diff-only normalizations:

- Diff default text now uses One Dark `#abb2bf` rather than the old component CSS
  `#e8e8e8`; gutter text uses One Dark `#7d8799` rather than `#70757d`.
- Removing the forced transparent changed-text backgrounds restores MergeView's
  supported insertion/deletion underlines. The One Dark syntax palette is intact.

Both sides now share precisely the same editor adapter as EditorPane.

## Light UI palette

| Purpose | Color |
| --- | --- |
| Editor background / default text | `#f3f4f6` / `#202630` |
| Gutters / line numbers | `#e9edf2` / `#626d7b` |
| Gutter border | `#d1d8e1` |
| Active line | `#e5ecf5` |
| Active gutter background / foreground | `#dce6f3` / `#202630` |
| Cursor / drop cursor | `#245da8` |
| Selection, including focused/native selection | `#bed5f2` |
| Selection matches | `#d6e5d2` |
| Search match / selected match | `#f2e4b9` / `#e6d391` |
| Search outline | `#886300` |
| Matching / nonmatching bracket | `#d4deeb` / `#f2cece` |
| Panels, tooltips, fold placeholder | `#e9edf2`, with `#d1d8e1` borders |

These styles cover the chrome when its corresponding extension is present;
Stage 4 does not add search, folding, autocomplete, or other editor features.
Scrollbars continue to use Stage 2's global semantic palette.

## Light syntax palette

| Categories | Color / treatment |
| --- | --- |
| Comments | `#626d7b`, italic |
| Strings, special strings, regular expressions | `#236b35` |
| Numbers, booleans, null, atoms, literals | `#795600` |
| Keywords, modifiers | `#7840a0` |
| Variables, properties | `#202630` |
| Functions and function properties | `#245da8` |
| Types, classes, namespaces, tags | `#176b78` |
| Attributes, property definitions | `#795600` |
| Operators, punctuation, metadata | `#525e6d` |
| Headings | `#245da8`, bold |
| Links, URLs | `#245da8`, underline |
| Emphasis / strong / strikethrough | italic / bold / line-through |
| Invalid syntax | `#a32929` |

Common syntax foregrounds are tested against the Light editor background with a
4.5:1 contrast floor. Unsupported languages retain readable default text; this
stage adds no new parsers. Existing JavaScript/TypeScript and Markdown language
selection is unchanged.

## Compartments and state preservation

EditorPane has a theme compartment separate from its existing language
compartment. Creation reads the current ThemeId into that compartment directly.
A separate identity-dependent effect dispatches only theme reconfiguration.
The creation effect keeps its existing lifecycle and excludes theme identity.
An applied-theme ref avoids an unnecessary startup reconfiguration.

DiffViewer retains its MergeView in a local ref. Each side has its own theme
compartment initialized from the same current ThemeId. A separate theme effect
reconfigures `mergeView.a` and `mergeView.b` synchronously through their public
`dispatch` APIs. It does not call MergeView.reconfigure, replaceChildren,
EditorState.create, setState, destroy, or a constructor when appearance changes.
Actual diff input changes retain the original reconstruction lifecycle.

Only presentation extensions change. Document objects/text, selections, editor
identity, scroll positions, dirty/external flags, active tab, language, read-only
and editable facets, unrelated state fields, merge chunks, and collapsed sections
remain intact. CodeMirror naturally produces a new state through its transaction
API; no full state replacement or document synchronization is introduced. The
existing editor does not install an undo-history extension, and Stage 4 does not
change that configuration. A retained StateField test checks preservation of
unrelated state data under compartment reconfiguration.

No global editor registry is needed: EditorPane and DiffViewer retain local refs
while mounted; a normal cold remount reads the current identity at construction.
No terminal runtime, xterm registry, session, or persistence behavior changed.
No Appearance selector was added.

## CSS/color audit

EditorPane.css now retains layout/overflow only for CodeMirror. DiffViewer.css
retains sizing, typography, hidden revert controls, and semantic application
backgrounds for the container/gap. Neither has Dark color literals or theme
`!important` overrides. MergeView's own installed base theme handles changed
chunks, text underlines, collapse controls, and change gutters through the dark
facet; no custom second editor theme is necessary.

The CSS token test no longer exempts `.cm-*` literals. Remaining renderer CSS
literals occur only in global.css's central palettes and GitButton.css's GitLab/
Bitbucket brand treatments. Renderer TypeScript hex/rgba literals are centralized
in the editor/xterm adapters or intentional file-type icon identity configuration.
The pre-existing named-white fatal bootstrap error fallback is outside normal
component chrome and remains unchanged with Stage 1.

## Tests and validation

- EditorPane unit tests: direct initial Dark and Light compartments; Dark/Light/
  Dark without construction, destruction, setState, content updates, or dirty/
  external/tab/selection/scroll changes. Existing cold-remount tests remain intact.
- DiffViewer unit tests: direct initial palettes on both sides; real EditorState
  compartment transactions; no reconstruction/destruction on theme changes;
  read-only and editable facet preservation; independent newContent, oldContent,
  and language/path input reconstruction.
- Adapter tests: all ThemeIds, dark facet, preserved One Dark inclusion, complete
  Light syntax roles, independent extension lists, Light UI/syntax contrast, and
  document/selection/unrelated-state preservation in actual state transactions.
- Real CodeMirror/React integration tests: unchanged EditorView identity and
  document/selection references, scroll, store flags; unchanged MergeView identity,
  A/B identity, chunks, collapsed widgets, docs, selections, scroll, and read-only.
- Semantic CSS tests remove the deferred-editor exception.

Lint, typecheck, build, full tests, and final `npm run validate` pass.
Full suite: **180 files, 4,116 tests**. Security audit: **0 vulnerabilities**.
The existing Vite large-bundle warning remains. An earlier full run encountered
one unrelated harnessCatalog test timeout; a subsequent full run and final
validation passed without changing that test or its timeout.

## Real Electron visual QA

Used Electron 41 on Linux, an isolated profile persisted as Light, and files in
`/tmp/clanker-stage4-fixture`. Temporary capture scripts rendered actual application
components and installed CodeMirror/MergeView, not CSS stand-ins. Screenshots and
state checks are in `/tmp/clanker-stage4-cursor-qa`; no testing framework was added.

Reviewed both themes for JavaScript/TypeScript, Markdown, unsupported plain text,
line numbers, active line, cursor/selection, scrolling, long wrapped lines, dirty
tab, external-change banner, and empty-editor transitions. Initial editor state
was Light directly. With unsaved TypeScript text, a mid-document selection and
300px scroll, theme switches retained the same EditorView and exact text,
selection, scroll, dirty flag, external flag, and active tab. React StrictMode's
initial development mount cleanup was distinguished from theme switching; the
editor destroy count did not increase on appearance changes.

A 160-line source diff included additions, deletions, modifications, syntax, and
six initial collapsed widgets. Expanded the middle unchanged section, leaving
four widgets, selected source on both sides, and scrolled the enclosing diff
container 180px. Light/Dark/Light retained both original EditorViews and MergeView
DOM, four widgets, selections, docs, read-only/editable facets, and scroll; MergeView
destroy count stayed zero. Real integration tests additionally assert MergeView
object and chunk-array identity directly. Both editor dark facets changed together.
Reviewed changed-line backgrounds, insertion/deletion underlines, change gutters,
line numbers, collapse controls, divider, and surrounding modal.

Windows/macOS, IME composition, and interactive undo commands were not visually
exercised. Syntax/parser coverage remains limited to the existing languages.

## Exact changed files

- `docs/theme-stage-3.md` — correct Light brightRed documentation to `#bc3535`.
- `docs/theme-stage-4.md`
- `package.json`
- `package-lock.json`
- `src/renderer/theme/editorTheme.ts`
- `src/renderer/components/EditorPane.tsx`
- `src/renderer/components/EditorPane.css`
- `src/renderer/components/DiffViewer.tsx`
- `src/renderer/components/DiffViewer.css`
- `tests/renderer/unit/EditorPane.test.tsx`
- `tests/renderer/unit/DiffViewer.test.tsx`
- `tests/renderer/unit/editorTheme.test.ts`
- `tests/renderer/unit/editorThemeIntegration.test.tsx`
- `tests/renderer/unit/themeTokens.test.ts`
