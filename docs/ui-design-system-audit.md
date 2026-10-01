# Renderer-Wide UI Design-System Audit

Comprehensive UI audit for GitHub issue **#64**: *Complete renderer-wide UI design-system alignment and enforce future consistency*.

This audit reviews every user-visible renderer screen, dialog, panel, control, and CSS file in `src/renderer/`, classifying each area into standard alignment categories and defining the migration path.

---

## 1. Classification Criteria

| Class | Definition |
|---|---|
| **A** | **Aligned**: ordinary controls render the appropriate shared primitive and leave its standard appearance/state contract centralized, or have an explicitly documented specialized reason to remain native. Geometry tokens alone do not establish primitive adoption. |
| **B** | **Uses shared primitives or tokens, but still has local styling drift or duplicate control contracts** (e.g. 3px/4px/5px radii, custom button/input styling alongside primitives). |
| **C** | **Should migrate to an existing shared primitive** (e.g. hand-rolled modal overlays, custom dialog backdrops, duplicate button variants). |
| **D** | **Requires a missing shared primitive or canonical control style** (e.g. shared `Input`, `Textarea`, `Select`, `Field`, `InputGroup`). |
| **E** | **Intentionally bespoke and should remain so** (e.g. browser tab trapezoidal curvature, terminal canvas, CodeMirror gutters, splitter pills). |

---

## 2. Comprehensive Inventory of Audited UI Areas

| # | Area / Subsystem | Files | Class | Current Pattern & Finding | Proposed Action | Risk & Behavior Notes |
|---|---|---|:---:|---|---|---|
| 1 | **Application Shell** | `App.tsx`, `App.css` | **A/E** | **Stage 5B actual adoption:** Recipe error dismissal uses Button; Reload in the crash fallback intentionally avoids shared UI dependencies. Shell geometry remains token aligned. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 2 | **Title Bar & Window Controls** | `TitleBar.tsx`, `TitleBar.css`, `WindowControls.tsx`, `WindowControls.css` | **E** | **Stage 5B actual adoption:** Canonical WindowControls intentionally owns OS caption hit targets and close emphasis, shared by titlebar and gate. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 3 | **Workspace Tabs** | `WorkspaceTabs.tsx`, `WorkspaceTabs.css` | **A/E** | **Stage 5B actual adoption:** Input for inline rename; IconButton for save, rename, close, attention jump and new workspace. Specialized draggable tab wrapper owns tab shape and selection. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 4 | **Status Bar** | `StatusBar.tsx`, `StatusBar.css` | **A** | Minimal, compact chrome. Environment pill uses `border-radius: var(--radius-sm)`. | Retain as canonical reference. | No risk; already aligned. |
| 5 | **Header Controls & Harness Pills** | `Header.tsx`, `Header.css`, `HeaderRightControls.tsx` | **A/E** | **Stage 5B actual adoption:** Header actions use Button/IconButton. Harness identity/launch pills remain specialized product controls with documented composition. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 6 | **Header Settings Popover** | `HeaderRightControls.tsx`, `Header.css`, `AppearanceSettings.tsx`, `HarnessDefaultsSection.tsx` | **A/E** | **Stage 5B actual adoption:** AI provider/model and theme render Select. Harness flags and manual models render Input; model refresh/browse and favorites actions use Button/IconButton. Native checkboxes and harness disclosure rows are intentional. Radix Popover retains focus ownership. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 7 | **Workspace Gate: Fullscreen Launcher** | `WorkspaceGate.tsx`, `WorkspaceGateContent.tsx`, `WorkspaceGate.css`, `WorkspaceLauncher.css` | **A/E** | **Stage 5B actual adoption:** Directory fields render Input; browsing/launch actions render IconButton/Button. Recipe summary chips and directory suggestion rows remain product owned. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 8 | **Workspace Gate: Modal Flow** | `WorkspaceGate.tsx` (`WorkspaceGateModal`), `WorkspaceGate.css` | **A** | **Aligned (Stage 3):** Composes shared `DialogContent.modal-content`; normalized entrance and shell to `var(--radius-sm)`. | Completed. | Fully validated with Escape and backdrop dismissal. |
| 9 | **Workspace Gate: Location Selector** | `WorkspaceLocationPicker.tsx`, `WorkspaceTargetPicker.tsx`, `WorkspaceTargetPicker.css` | **A/E** | **Stage 5B actual adoption:** Location search renders Input; settings/add actions use Button. Composite location trigger and identity/detail option rows are specialized. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 10 | **Workspace Gate: Worktree Subflows** | `WorktreeLauncher.tsx`, `RemoteWorktreePicker.tsx`, `RemoteWorktreeCreate.tsx`, `RemoteWorktreeInspect.tsx`, `WorkspaceGate.css` | **A** | **Stage 5B actual adoption:** Local and remote worktree base/branch fields use Input; repository selection uses Select; load/refresh/open/create/remove/cancel actions use Button. No worktree lifecycle logic changed. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 11 | **SSH Environment Manager** | `SshEnvironmentManager.tsx`, `WorkspaceGate.css` | **A** | **Stage 5B actual adoption:** SSH editor retains shared form primitives; environment edit/delete actions now render IconButton. Environment card layout remains product owned. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 12 | **Remote Directory Chooser** | `RemoteDirectoryChooser.tsx`, `RemoteDirectoryChooser.css` | **A/E** | **Stage 5B actual adoption:** Remote chooser retry renders Button; directory navigation rows remain specialized. Dialog/form controls retain existing shared primitives. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 13 | **Model Picker & Favorites** | `ModelPicker.tsx`, `WorkspaceGate.css` | **A/E** | **Stage 5B actual adoption:** Manual model/search fields use Input; refresh/browse actions use Button and favorite actions use IconButton. Composite model trigger and metadata option rows intentionally remain native. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 14 | **Model Discovery Modal** | `ModelPicker.tsx`, `WorkspaceGate.css` | **A** | **Aligned (Stage 3):** Uses shared `Dialog`; content shell, discovery items, close button, and star buttons normalized to `var(--radius-sm)`. | Completed. | Fully validated in model search and selection. |
| 15 | **Searchable Choices** | `SearchablePicker.tsx`, `SearchablePicker.css` | **A/E** | **Stage 5B actual adoption:** SearchablePicker composes Input and IconButton for search/favorites. Its native choice row is a shared composite picker implementation with selected state and label composition. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 16 | **Launch Recipe Modal** | `RecipeModal.tsx`, `RecipeModal.css` | **A** | **Migrated (Stage 2):** Uses shared `Dialog`, `Button`, `IconButton`, `Input`, `Select`, `Field`, `FieldLabel`. 8px shell, 6px fields/buttons/cards, and 4px step controls eliminated; intentional 12px pill badge retained. | Completed. | Fully validated in create, edit, preview, launch, and delete states. |
| 17 | **VCS Credentials** | `CredentialSettings.tsx`, `CredentialSettings.css` | **A** | Uses shared `Dialog` and `IconButton`; standard `var(--radius-sm)` on dialog, inputs, tabs, cards; intentional 999px pill for status chip. | Retained as canonical design-system reference. | No risk; already aligned. |
| 18 | **Commit Dialog** | `CommitDialog.tsx`, `CommitDialog.css` | **A** | **Migrated (Stage 4):** Uses shared `Dialog`, `Textarea`, `Button`, `IconButton`; manual lease & Escape lifecycle removed; file status tag remains badge; zero backlog entries remaining. | Completed. | Fully validated including nested DiffViewer interaction. |
| 19 | **Confirmation / Alert Dialogs** | `ConfirmCloseDialog.tsx`, `ConfirmCloseDialog.css` | **A** | **Aligned (Stage 5):** Uses shared `AlertDialog`, `AlertDialogContent`, and shared `Button` variants; redundant button CSS removed. | Completed. | Fully validated in close prompt flows. |
| 20 | **Git Delete Branch Dialog** | `GitDeleteBranchDialog.tsx`, `GitButton.css` | **A** | **Migrated (Stage 4):** Uses shared `AlertDialog`, `Button`, with `onBackdropCancel`; `--radius-lg` shell eliminated; normal->force delete transition preserved. | Completed. | Fully validated in normal and force delete states. |
| 21 | **File Explorer** | `FileExplorer/index.tsx`, `FileTree.tsx`, `FileExplorer.css` | **A/E** | **Stage 5B actual adoption:** Inline rename/create and filter render Input; toolbar and clear/close actions render IconButton. Tree entry rows retain indentation, expansion, context menu and inline editing. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 22 | **File Explorer Context Menu** | `ContextMenu.tsx`, `ContextMenu.css` | **E** | **Stage 5B actual adoption:** Existing context menu item model owns menuitem semantics, destructive emphasis, keyboard/outside dismissal and compact row composition. Intentionally specialized; not ordinary buttons. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 23 | **Browser Panel & Toolbar** | `BrowserPanel.tsx`, `BrowserPanel.css` | **A** | **Stage 5B actual adoption:** Browser navigation/external/annotation actions use IconButton and Go uses primary Button. CSS retains toolbar dimensions and annotation active emphasis. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 24 | **Browser URL Field & Suggestions** | `BrowserUrlInput.tsx`, `BrowserPanel.css` | **A/E** | **Stage 5B actual adoption:** BrowserUrlInput actually imports/renders mono Input. URL listbox options remain native specialized selection rows; autocomplete handlers and relationships are unchanged. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 25 | **Browser Tab Strip** | `BrowserTabStrip.tsx`, `BrowserPanel.css` | **A/E** | **Stage 5B actual adoption:** Browser tab close/add render IconButton. Native selection and curved draggable tab geometry remain specialized. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 26 | **Remote Preview Bar** | `RemotePreviewBar.tsx`, `BrowserPanel.css` | **A** | **Stage 5B actual adoption:** Remote/local ports actually render number Input; start/retry, stop and open render Button. Port bounds, validation, busy/locked states and forwarding lifecycle remain unchanged. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 27 | **Annotation Handoff Dialog** | `AnnotationHandoffDialog.tsx`, `AnnotationHandoffDialog.css` | **A** | **Migrated (Stage 2):** Uses shared `Dialog`, `Button`, `IconButton`, `Textarea`. `--radius-md` shell and 5px textarea/buttons eliminated; zero exceptions remaining. | Completed. | Fully validated with Escape and focus restoration tests. |
| 28 | **Editor Chrome & Tab Bar** | `EditorPane.tsx`, `EditorPane.css`, `EditorTabBar.tsx`, `EditorTabBar.css` | **A/E** | **Stage 5B actual adoption:** Editor close/reload actions and tab close render IconButton/Button. Specialized tab wrapper keeps file selection, dirty marker and geometry; CodeMirror remains independent. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 29 | **Diff Viewer Chrome** | `DiffViewer.tsx`, `DiffViewer.css` | **A** | **Migrated (Stage 4):** Uses single shared `Dialog` shell across all five states, `IconButton`, `workspaceId` wire-through; nested Dialog with topmost Escape validated. | Completed. | Fully validated standalone and inside CommitDialog. |
| 30 | **Terminal Pane Chrome** | `TerminalPane.tsx`, `TerminalPane.css` | **A/E** | **Stage 5B actual adoption:** Terminal close renders IconButton; terminal header, drag texture, status indicator and xterm remain specialized product composition. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 31 | **Notes Pane** | `NotesPane.tsx`, `NotesPane.css` | **A** | **Stage 5B actual adoption:** Notes actually renders mono Textarea and close IconButton. CSS keeps pane sizing, resize policy, writing-area padding and borderless composition; typography, placeholder, focus and disabled/read-only contract are shared. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 32 | **Chat History Popover** | `ChatHistoryDropdown.tsx`, `ChatHistoryDropdown.css` | **A/E** | **Stage 5B actual adoption:** Radix Popover owns overlay/focus; expandable harness groups and conversation metadata rows intentionally remain specialized native selection controls. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 33 | **Git Menu & Popover** | `GitButton.tsx`, `GitRepoMenu.tsx`, `GitButton.css` | **A/E** | **Stage 5B actual adoption:** Git trigger and ordinary menu actions use Button/IconButton; shared Popover/AlertDialog remains. Git status badges and section/list composition remain product owned. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 34 | **Git Sections: Branches, Stash, Merge** | `GitBranchesSection.*`, `GitStashSection.*`, `GitMergeSection.*` | **A/E** | **Stage 5B actual adoption:** Branch/stash fields render Input; merge selection renders Select; standard actions render Button/IconButton. Native stash checkbox and commit selection rows remain specialized. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 35 | **Git Sections: Remotes** | `GitRemotesSection.tsx`, `GitRemotesSection.css` | **A/E** | **Stage 5B actual adoption:** RemoteNameInput and URL render mono Input; Field/FieldLabel/InputGroup/FormMessage compose forms. Submit/add use Button and rename/remove/add/cancel glyph actions use IconButton. Remote cards, validation icons and quick-name suggestion pills remain product owned. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 36 | **Provider Badge & Menu** | `ProviderBadge.tsx/css`, `ProviderMenu.tsx/css` | **A/E** | **Stage 5B actual adoption:** Provider trigger/refresh use Button/IconButton. PR status badges and deep-link menu rows remain specialized existing product/menu models. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 37 | **Task Recovery Section** | `TaskRecoverySection.tsx`, `TaskRecoverySection.css` | **A/E** | **Stage 5B actual adoption:** Task actions use Button/IconButton; conversation association option rows and task metadata/status badges remain specialized. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |
| 38 | **Dynamic Pane Layout & Dock Targets** | `DynamicPaneLayout.tsx`, `DynamicPaneLayout.css`, `DockEdgeTargets.tsx` | **A/E** | **Aligned (Stage 5):** Drag preview normalized from 8px to `var(--radius-sm)`; dock targets use `var(--radius-md)`; splitter pills (999px) and drag handle dot textures retained as Class E. | Completed. | Docking and drag preview verified. |
| 39 | **Error Boundary** | `ErrorBoundary.tsx`, `ErrorBoundary.css` | **E** | **Stage 5B actual adoption:** Crash recovery retry intentionally retains native button markup and tokenized CSS to avoid shared-control dependencies during UI failure. This is an explicit exception, not shared Button adoption. | Complete; specialized controls documented in raw-control inventory. | Focused behavior suites and final validation. |

---

## 3. Stage 5B correction and final control inventory

Stage 5 completed geometry alignment. Its previous Class A findings overstated shared-control adoption by treating tokenized radii as sufficient. The table above now distinguishes actual shared primitives (A) from explicitly specialized composition (E). Mixed areas are A/E; no ordinary feature field is justified merely because it looks aligned.

The baseline scan found **208 raw JSX sites**: 34 inputs, 2 textareas, 7 selects, and 165 buttons. **158 ordinary sites** migrated to existing shared primitives. Two tab selectors now use semantic div wrappers to avoid nested buttons, and two former span close actions additionally render IconButton.

The final scan has **48 raw sites**: 7 inputs, 1 textarea, 1 select, and 39 buttons. This includes four canonical primitive implementations, six native checkbox/radio sites, three canonical OS caption buttons, two crash fallback buttons, and 33 specialized product/menu/picker buttons. Every source site and reason, including the before-migration classification, appears in [the raw-control inventory](ui-raw-control-inventory.md).

Standard field surface, border, radius, typography, placeholder, focus, disabled/read-only styling and standard button appearance now come from the shared control layer. Feature CSS retains required dimensions, flex/grid composition, spacing, positioning and explicit product selection emphasis. Notes retains borderless pane composition. Product rows, cards, badges, tabs and context menu models remain feature owned.

A focused CSS contract test guards the known ordinary field classes against reintroducing standard appearance/state declarations. Behavior tests verify actual shared class rendering alongside existing event/ref behavior. There is no raw-tag ban. The geometry enforcement and its intentional-exception list remain unchanged; no radius exception was added.

---

## 4. Historical pre-migration inventory of hard-coded radius patterns

This section records the original geometry findings, not current source locations or outstanding work. The current geometry contract passes; Stage 5B does not reopen the geometry migration.

A systematic sweep of all `.css` files under `src/renderer/` identified the following non-standard radius patterns:

| Value | Occurrences in Renderer CSS | Contexts / Selectors | Assessment & Policy |
|---|---|---|---|
| `2px` | `EditorTabBar.css:26` | `.editor-tabs` | Literal for standard `--radius-sm`. Replace with `var(--radius-sm)`. |
| `3px` | `BrowserPanel.css` (33, 246, 321, 353, 354)<br>`CommitDialog.css:196`<br>`DynamicPaneLayout.css:353`<br>`EditorPane.css:33`<br>`FileExplorer.css` (65, 262)<br>`Header.css` (126, 437, 485)<br>`NotesPane.css:33`<br>`TaskRecoverySection.css:253`<br>`WorkspaceGate.css` (395, 454, 573, 605, 644, 691, 748, 776)<br>`WorkspaceTabs.css` (153, 195, 226, 242) | Browser URL input, remote preview controls, annotate button; Git status tag; rename inputs; harness pills; favorite tags; workspace tab close/edit buttons; gate history/model items; drag handles. | **Drift from 2px.** Most rectangular controls should normalize to `var(--radius-sm)`. Drag handle radial dots (33) can be replaced or kept if purely visual dot pattern. |
| `4px` | `CommitDialog.css:103`<br>`DynamicPaneLayout.css:265`<br>`EditorPane.css` (67, 88, 171)<br>`EditorTabBar.css:80`<br>`ErrorBoundary.css:13`<br>`GitRemotesSection.css` (41, 86, 105, 150, 174, 212, 277, 289)<br>`NotesPane.css:67`<br>`ProviderBadge.css:12`<br>`ProviderMenu.css` (84, 121)<br>`RecipeModal.css` (63, 219, 280, 385)<br>`RemoteDirectoryChooser.css:18`<br>`TaskRecoverySection.css` (98, 174, 218, 283)<br>`TerminalPane.css:133`<br>`WorkspaceTabs.css:103`<br>`global.css:296` | Close buttons, secondary buttons, remote forms, recipe step controls, new folder input, recovery cards, provider menu items, scrollbar thumb. | **Drift from 2px.** Replace rectangular controls with `var(--radius-sm)`. Scrollbar thumb (`global.css`) is standard OS styling. Status pills (ProviderBadge, TaskRecovery) can use pill tokens. |
| `5px` | `AnnotationHandoffDialog.css` (41, 52)<br>`BrowserPanel.css:218`<br>`RemoteDirectoryChooser.css:10`<br>`WorkspaceGate.css` (111, 163, 181) | Annotation textarea & buttons; browser tab close; remote chooser buttons; worktree base/branch inputs and confirm box. | **Drift from 2px.** Eliminate all 5px literals; migrate to `var(--radius-sm)`. |
| `6px` | `App.css:129`<br>`BrowserPanel.css:105`<br>`ErrorBoundary.css:66`<br>`ProviderMenu.css:14`<br>`RecipeModal.css` (92, 99, 172, 317, 348, 402, 442)<br>`TaskRecoverySection.css:47` | Error fallback button; browser nav buttons; error retry button; provider menu trigger; Recipe modal inputs, selects, cards, banners, buttons; task recovery cards. | **Drift from 2px.** Eliminate all 6px literals; migrate to `var(--radius-sm)`. |
| `7px 7px 2px 2px` | `BrowserPanel.css:158` | `.browser-tab` | **Intentional bespoke tab geometry (Class E).** Document as intentional exception. |
| `8px` | `ChatHistoryDropdown.css:68`<br>`DynamicPaneLayout.css:294`<br>`ProviderBadge.css:133`<br>`ProviderMenu.css:52`<br>`RecipeModal.css:18`<br>`RemoteDirectoryChooser.css:5`<br>`WorkspaceGate.css:330` | Chat history session count; drag ghost; review state pill; provider menu shell; recipe modal shell; remote chooser shell; gate directory badge. | Modal shells (Recipe, RemoteChooser) must migrate to `var(--radius-sm)` via Dialog. Chat count & directory badges are intentional pill counters. |
| `9px` | `BrowserPanel.css:283`<br>`GitButton.css:243` | Browser URL suggestion items; ahead badge. | Suggestion items normalize to `var(--radius-sm)`. Ahead badge is an intentional pill. |
| `10px` | `GitRemotesSection.css:30`<br>`ProviderBadge.css:76`<br>`TaskRecoverySection.css:29` | Remote count badge; provider badge tag; task recovery count. | **Intentional pill counters/badges.** Keep as pill geometry. |
| `12px` | `App.css:45`<br>`BrowserPanel.css:268`<br>`GitRemotesSection.css:258`<br>`RecipeModal.css:53` | Loading placeholder border; URL suggestions popover; remote tag; recipe badge. | Loading placeholder and URL suggestions should normalize to design system; badges are intentional pills. |
| `999px` / `50%` | `DynamicPaneLayout.css:70`<br>`FileExplorer.css` (33, 246)<br>`GitBranchesSection.css:101`<br>`GitButton.css` (82, 122, 199)<br>`GitHistorySection.css:55`<br>`CredentialSettings.css:327`<br>`TerminalPane.css:41`<br>`EditorTabBar.css:63`<br>`TaskRecoverySection.css:130` | Splitter handles, git branch pills, commit hash pills, credential status pills, terminal status dots, tab modified dots, pulse circles. | **Legitimate pill/circle affordances.** Permitted under design system contract. |

---

## 5. Historical architectural recommendations for Stage 1 foundation

1. **Geometry Contract in `README.md`**:
   - Establish `--radius-sm` (2px) as the authoritative default for all rectangular Clanker UI.
   - Document `--radius-md` (4px) and `--radius-lg` (8px) as exceptional.
   - Formalize the pill/circle exception rule (`999px`, `50%`, and explicit status badge radii).
   - Prohibit raw feature-level pixel radius literals (`3px`, `4px`, `5px`, `6px`, `8px`).

2. **Shared Form-Control Layer (`src/renderer/components/ui/`)**:
   - `Input`: standard text/search/password input owning surface (`--surface-control`), border (`--border-default`), radius (`--radius-sm`), typography, placeholder (`--text-muted`), focus-visible (`--focus-ring`), disabled, and error styling (`aria-invalid="true"`).
   - `Textarea`: multiline text input sharing the same visual contract as `Input`.
   - `Select`: standardized select trigger and native select wrapper with custom arrow icon.
   - `Field` & `FieldLabel`: semantic form field wrapper owning label typography, description, and validation message.

3. **Geometry Enforcement Guardrail (`tests/renderer/unit/geometryContract.test.ts`)**:
   - Parse all renderer CSS files.
   - Flag any `border-radius` declaration with raw pixel literals (`3px`, `4px`, `5px`, `6px`, `8px`, etc.).
   - Allow `var(--radius-*)` tokens.
   - Allow intentional pills/circles (`50%`, `999px`, `100%`) or documented selectors in a strict, minimal allowlist.
   - Provide informative test failure messages explaining the Clanker geometry contract.

---

## 6. Historical migration sequence

1. **Stage 2: Foundation proof & obvious dialog outliers**
   - Migrate `RecipeModal` (Class C/D) to shared `Dialog`, `Button`, and shared form controls.
   - Migrate `AnnotationHandoffDialog` (Class C/D) to shared `Dialog`, `Button`, and `Textarea`.
   - Migrate `RemoteDirectoryChooser` (Class C/D) to shared `Dialog`, `Button`, and `Input`.
2. **Stage 3: Workspace Gate & secondary flows**
   - Normalize `WorkspaceGateContent.tsx` / `WorkspaceGate.css` (worktree 5px, history 3px, models 3px).
   - Normalize `SshEnvironmentManager.tsx` (shell `--radius-sm`, shared `Input` and `Button`).
   - Normalize `WorkspaceTargetPicker.css` (2px instead of `--radius-md`).
3. **Stage 4: Overlays, git dialogs, and chrome modals**
   - Migrate `CommitDialog` (Class C/D) to shared `Dialog`.
   - Migrate `GitDeleteBranchDialog` (Class C) to shared `AlertDialog`.
   - Migrate `DiffViewer` (Class C) overlay to shared `Dialog`.
   - Normalize `GitButton.css` / `ProviderMenu.css`.
4. **Stage 5: Browser, editor, terminal, and pane chrome**
   - Normalize `BrowserPanel.css` (URL input, nav buttons, suggestions).
   - Normalize `EditorPane.css`, `EditorTabBar.css`, `TerminalPane.css`, `NotesPane.css`.
   - Normalize `WorkspaceTabs.css` and `Header.css` (tab buttons, harness pills).
5. **Stage 6: Final sweep & validation**
   - Run geometry enforcement test across all CSS files.
   - Full test suite, lint, typecheck, build, and theme contrast checks.
