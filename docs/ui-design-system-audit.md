# Renderer-Wide UI Design-System Audit

Comprehensive UI audit for GitHub issue **#64**: *Complete renderer-wide UI design-system alignment and enforce future consistency*.

This audit reviews every user-visible renderer screen, dialog, panel, control, and CSS file in `src/renderer/`, classifying each area into standard alignment categories and defining the migration path.

---

## 1. Classification Criteria

| Class | Definition |
|---|---|
| **A** | **Already aligned** with shared design system (uses shared tokens/primitives, `--radius-sm` geometry, no local drift). |
| **B** | **Uses shared primitives or tokens, but still has local styling drift** (e.g. 3px/4px/5px radii, custom button/input styling alongside primitives). |
| **C** | **Should migrate to an existing shared primitive** (e.g. hand-rolled modal overlays, custom dialog backdrops, duplicate button variants). |
| **D** | **Requires a missing shared primitive or canonical control style** (e.g. shared `Input`, `Textarea`, `Select`, `Field`, `InputGroup`). |
| **E** | **Intentionally bespoke and should remain so** (e.g. browser tab trapezoidal curvature, terminal canvas, CodeMirror gutters, splitter pills). |

---

## 2. Comprehensive Inventory of Audited UI Areas

| # | Area / Subsystem | Files | Class | Current Pattern & Finding | Proposed Action | Risk & Behavior Notes |
|---|---|---|:---:|---|---|---|
| 1 | **Application Shell** | `App.tsx`, `App.css` | **B** | Loading placeholder has `border-radius: 12px`; error fallback button has hardcoded 6px radius and custom button styles. | Normalize `.main-content-loading` to `--radius-sm` (or `--radius-md`); migrate error fallback button to shared `Button`. | Low risk; purely visual shell styling. |
| 2 | **Title Bar & Window Controls** | `TitleBar.tsx`, `TitleBar.css`, `WindowControls.tsx`, `WindowControls.css` | **A** | Zero radius literals; uses semantic tokens and shared `WindowControls` across normal titlebar and gate. | Retain as canonical reference. | No risk; already aligned. |
| 3 | **Workspace Tabs** | `WorkspaceTabs.tsx`, `WorkspaceTabs.css` | **B** | Tab remote pill uses `--radius-sm`; attention badge uses 4px; tab close button has 3px radius; inline rename input & save button have 3px radius. | Normalize tab close and edit controls to `--radius-sm` / `IconButton`; keep attention badge as intentional pill or `--radius-sm`. | Low risk; test tab drag-and-drop and double-click rename. |
| 4 | **Status Bar** | `StatusBar.tsx`, `StatusBar.css` | **A** | Minimal, compact chrome. Environment pill uses `border-radius: var(--radius-sm)`. | Retain as canonical reference. | No risk; already aligned. |
| 5 | **Header Controls & Harness Pills** | `Header.tsx`, `Header.css`, `HeaderRightControls.tsx` | **B** | Harness pills group uses `--radius-sm`, but individual pills use 3px; `.header-btn` defines local primary/danger variants that duplicate `Button`; favorite tags use 3px. | Normalize `.harness-pill`, favorite tags, and add-fav trigger to `--radius-sm`; migrate duplicate button rules to `Button`. | Low risk; verify header dropdown triggers remain aligned. |
| 6 | **Header Settings Popover** | `HeaderRightControls.tsx`, `Header.css`, `AppearanceSettings.tsx`, `HarnessDefaultsSection.tsx` | **B/D** | Uses Radix `Popover` primitive and `--radius-sm`. Contains raw `<select>` and `<input>` with local `.settings-select` / `.settings-input` classes. | Adopt shared `Select` / `Input` styling from form-control layer; retain Popover shell. | Low risk; test theme switching and harness flags. |
| 7 | **Workspace Gate: Fullscreen Launcher** | `WorkspaceGate.tsx`, `WorkspaceGateContent.tsx`, `WorkspaceGate.css`, `WorkspaceLauncher.css` | **A** | **Aligned (Stage 3):** Standardized directory cards, suggestion items, harness options, grid options to `var(--radius-sm)`; intentional pill counters retained. | Completed. | Fully validated across launcher layouts and terminal selection. |
| 8 | **Workspace Gate: Modal Flow** | `WorkspaceGate.tsx` (`WorkspaceGateModal`), `WorkspaceGate.css` | **A** | **Aligned (Stage 3):** Composes shared `DialogContent.modal-content`; normalized entrance and shell to `var(--radius-sm)`. | Completed. | Fully validated with Escape and backdrop dismissal. |
| 9 | **Workspace Gate: Location Selector** | `WorkspaceLocationPicker.tsx`, `WorkspaceTargetPicker.tsx`, `WorkspaceTargetPicker.css` | **A** | **Aligned (Stage 3):** `.gate-location-selector` and `WorkspaceTargetPicker` trigger/content normalized to `var(--radius-sm)`. | Completed. | Retains headless Popover and segmented choice behavior. |
| 10 | **Workspace Gate: Worktree Subflows** | `WorktreeLauncher.tsx`, `RemoteWorktreePicker.tsx`, `RemoteWorktreeCreate.tsx`, `RemoteWorktreeInspect.tsx`, `WorkspaceGate.css` | **A** | **Aligned (Stage 3):** Inputs, action buttons, forward button, and confirmation boxes normalized from 5px to `var(--radius-sm)`. | Completed. | Fully validated in creation, inspection, and removal flows. |
| 11 | **SSH Environment Manager** | `SshEnvironmentManager.tsx`, `WorkspaceGate.css` | **A** | **Migrated (Stage 3):** Uses shared `Dialog` (shell normalized to `var(--radius-sm)`), shared `Input`, `Field`, `FieldLabel`, `Button`, `IconButton`. | Completed. | Fully validated with add, edit, test, delete, and focus restoration. |
| 12 | **Remote Directory Chooser** | `RemoteDirectoryChooser.tsx`, `RemoteDirectoryChooser.css` | **A** | **Migrated (Stage 2):** Uses shared `Dialog`, `Input`, `Button`, `IconButton`. 8px shell, 5px button, and 4px input eliminated; zero exceptions remaining. | Completed. | Fully validated with dedicated interaction test suite. |
| 13 | **Model Picker & Favorites** | `ModelPicker.tsx`, `WorkspaceGate.css` | **A** | **Aligned (Stage 3):** Popover items, browse link, and star buttons normalized to `var(--radius-sm)`. | Completed. | Fully validated in favorite toggle and navigation. |
| 14 | **Model Discovery Modal** | `ModelPicker.tsx`, `WorkspaceGate.css` | **A** | **Aligned (Stage 3):** Uses shared `Dialog`; content shell, discovery items, close button, and star buttons normalized to `var(--radius-sm)`. | Completed. | Fully validated in model search and selection. |
| 15 | **Searchable Choices** | `SearchablePicker.tsx`, `SearchablePicker.css` | **A** | Uses shared `Popover`, `--radius-sm` on rows/choices, token-based surfaces and focus rings. | Retain as canonical primitive reference. | No risk; already aligned. |
| 16 | **Launch Recipe Modal** | `RecipeModal.tsx`, `RecipeModal.css` | **A** | **Migrated (Stage 2):** Uses shared `Dialog`, `Button`, `IconButton`, `Input`, `Select`, `Field`, `FieldLabel`. 8px shell, 6px fields/buttons/cards, and 4px step controls eliminated; intentional 12px pill badge retained. | Completed. | Fully validated in create, edit, preview, launch, and delete states. |
| 17 | **VCS Credentials** | `CredentialSettings.tsx`, `CredentialSettings.css` | **A/B** | Uses shared `Dialog` and `IconButton`; standard `--radius-sm` on dialog, inputs, tabs, cards; intentional 999px pill for status chip. | Retain as canonical design-system reference; normalize minor input styling to shared `Input`. | Low risk; already mostly aligned. |
| 18 | **Commit Dialog** | `CommitDialog.tsx`, `CommitDialog.css` | **A** | **Migrated (Stage 4):** Uses shared `Dialog`, `Textarea`, `Button`, `IconButton`; manual lease & Escape lifecycle removed; file status tag remains badge; zero backlog entries remaining. | Completed. | Fully validated including nested DiffViewer interaction. |
| 19 | **Confirmation / Alert Dialogs** | `ConfirmCloseDialog.tsx`, `ConfirmCloseDialog.css` | **A/B** | Uses shared `AlertDialog`; dialog and buttons use `--radius-sm`; minor duplicate button CSS (`.confirm-close-btn-*`). | Retain AlertDialog foundation; migrate buttons to shared `Button` variants (`variant="danger"`, etc.). | Low risk; verify close workspace / app prompt. |
| 20 | **Git Delete Branch Dialog** | `GitDeleteBranchDialog.tsx`, `GitButton.css` | **A** | **Migrated (Stage 4):** Uses shared `AlertDialog`, `Button`, with `onBackdropCancel`; `--radius-lg` shell eliminated; normal->force delete transition preserved. | Completed. | Fully validated in normal and force delete states. |
| 21 | **File Explorer** | `FileExplorer/index.tsx`, `FileTree.tsx`, `FileExplorer.css` | **B** | Action buttons and filter clear use `--radius-sm`; splitter uses 999px (intentional pill); git dot uses 50% (circle); inline rename input uses 3px. | Normalize inline rename input to `--radius-sm` (shared `Input`); retain splitter pill and git circle. | Low risk; verify tree node renaming and drag-and-drop. |
| 22 | **File Explorer Context Menu** | `ContextMenu.tsx`, `ContextMenu.css` | **B/C** | Hand-rolled `.context-menu-overlay`; menu shell uses `--radius-sm`; items use token-based hover. | Retain `--radius-sm`; verify whether headless Radix Menu is needed or if current lightweight component suffices with normalized styling. | Low risk; verify outside click and sub-options. |
| 23 | **Browser Panel & Toolbar** | `BrowserPanel.tsx`, `BrowserPanel.css` | **B** | Panel container uses `border-radius: var(--radius-md)`; nav buttons use 6px radius; drag handle uses 3px dots; annotate button uses 3px. | Normalize panel container and toolbar buttons to `--radius-sm` (or `IconButton`); drag handle dot pattern is intentional. | Medium risk; verify native `WebContentsView` bounds and clipping. |
| 24 | **Browser URL Field & Suggestions** | `BrowserUrlInput.tsx`, `BrowserPanel.css` | **B/D** | URL input uses 3px radius; suggestions dropdown uses 12px; suggestion items use 9px. | Normalize URL input to shared `Input` (`--radius-sm`); normalize suggestions dropdown and items to `--radius-sm`. | Low risk; test URL autocomplete and keyboard navigation. |
| 25 | **Browser Tab Strip** | `BrowserTabStrip.tsx`, `BrowserPanel.css` | **E/B** | Tab uses intentional curved tab shape (`border-radius: 7px 7px 2px 2px`); tab close button uses 5px. | Document browser tab geometry as intentional bespoke tab design (Class E); normalize close button to standard `IconButton` / `--radius-sm`. | Low risk; tab drag/close behavior must remain intact. |
| 26 | **Remote Preview Bar** | `RemotePreviewBar.tsx`, `BrowserPanel.css` | **B/D** | Port inputs and start/stop buttons use hardcoded 3px radius. | Normalize inputs to shared `Input` and buttons to shared `Button` (`--radius-sm`). | Low risk; verify SSH port forwarding preview lifecycle. |
| 27 | **Annotation Handoff Dialog** | `AnnotationHandoffDialog.tsx`, `AnnotationHandoffDialog.css` | **A** | **Migrated (Stage 2):** Uses shared `Dialog`, `Button`, `IconButton`, `Textarea`. `--radius-md` shell and 5px textarea/buttons eliminated; zero exceptions remaining. | Completed. | Fully validated with Escape and focus restoration tests. |
| 28 | **Editor Chrome & Tab Bar** | `EditorPane.tsx`, `EditorPane.css`, `EditorTabBar.tsx`, `EditorTabBar.css` | **B** | Editor pane uses `border-radius: var(--radius-md)`; action buttons use 4px; fallback close uses 4px; tab bar uses 2px; tab close uses 4px; unsaved dot uses 50%. | Normalize pane border to `--radius-sm` (or keep consistent with terminal pane); normalize action and close buttons to `--radius-sm`; retain unsaved dot as circle. | Low risk; test tab switching and CodeMirror sizing. |
| 29 | **Diff Viewer Chrome** | `DiffViewer.tsx`, `DiffViewer.css` | **A** | **Migrated (Stage 4):** Uses single shared `Dialog` shell across all five states, `IconButton`, `workspaceId` wire-through; nested Dialog with topmost Escape validated. | Completed. | Fully validated standalone and inside CommitDialog. |
| 30 | **Terminal Pane Chrome** | `TerminalPane.tsx`, `TerminalPane.css` | **B** | Status dot uses 50% (circle); close button uses 4px. | Normalize close button to `--radius-sm` (`IconButton`); retain status dot circle. | Low risk; verify xterm instance layout. |
| 31 | **Notes Pane** | `NotesPane.tsx`, `NotesPane.css` | **B/D** | Notes pane uses `border-radius: var(--radius-md)`; action buttons use 4px; raw `<textarea className="notes-editor">`. | Normalize pane border and buttons to `--radius-sm`; normalize textarea to shared `Textarea` styling. | Low risk; verify note persistence. |
| 32 | **Chat History Popover** | `ChatHistoryDropdown.tsx`, `ChatHistoryDropdown.css` | **A/B** | Uses Radix `Popover`; shell uses `--radius-sm`; session count badge uses 8px (intentional pill counter). | Retain Popover shell and `--radius-sm`; document 8px session count badge as intentional pill counter. | Low risk; already aligned. |
| 33 | **Git Menu & Popover** | `GitButton.tsx`, `GitRepoMenu.tsx`, `GitButton.css` | **A/B** | **Aligned (Stage 4):** `.git-menu` normalized from `var(--radius-md)` to `var(--radius-sm)`; delete branch dialog migrated to AlertDialog; status pills (999px) retained. | Completed. | Zero backlog entries remaining in GitButton.css. |
| 34 | **Git Sections: Branches, Stash, Merge** | `GitBranchesSection.*`, `GitStashSection.*`, `GitMergeSection.*` | **A/B** | Lists and inputs use `--radius-sm`; branch tags use 999px (pills); merge info uses `--radius-sm`. | Mostly aligned; normalize raw `<select>` and inputs to shared form primitives. | Low risk; already close to canonical geometry. |
| 35 | **Git Sections: Remotes** | `GitRemotesSection.tsx`, `GitRemotesSection.css` | **B/D** | Remote count badge uses 10px (pill); add button uses 4px; remote items use 4px; form inputs use 4px; actions use 4px; tag uses 12px (pill). | Normalize rectangular cards, buttons, and inputs from 4px to `--radius-sm` (2px); retain 10px/12px badges as intentional pills. | Low risk; verify remote URL add/edit. |
| 36 | **Provider Badge & Menu** | `ProviderBadge.tsx/css`, `ProviderMenu.tsx/css` | **A/B** | **Aligned (Stage 4):** Menu trigger, dropdown content, refresh button, and link items normalized from 6px/8px/4px to `var(--radius-sm)`; provider status badges (4px/10px) retained. | Completed. | Zero backlog entries remaining in ProviderMenu.css. |
| 37 | **Task Recovery Section** | `TaskRecoverySection.tsx`, `TaskRecoverySection.css` | **B** | Badge uses 10px (pill); card uses 6px; status chip uses 4px (pill); pulse uses 50% (circle); fork button uses 4px; item uses 4px. | Normalize cards, fork buttons, and items from 4px/6px to `--radius-sm`; retain badge/status pills and pulse circle. | Low risk; verify remote task resumption. |
| 38 | **Dynamic Pane Layout & Dock Targets** | `DynamicPaneLayout.tsx`, `DynamicPaneLayout.css`, `DockEdgeTargets.tsx` | **B/E** | Splitter handles use 999px (intentional pill); pane tag uses 4px (pill); dock targets and previews use `var(--radius-md)`; drag ghost uses 8px. | Retain splitter pills (Class E); normalize dock targets and drag ghost to `--radius-sm` / `--radius-md` tokens. | Low risk; verify pane drag and drop docking. |
| 39 | **Error Boundary** | `ErrorBoundary.tsx`, `ErrorBoundary.css` | **B** | Error details card uses `var(--radius-md, 8px)`; retry button uses 6px. | Normalize details card to `--radius-sm` and button to shared `Button` (`--radius-sm`). | Low risk; unhandled crash fallback screen. |

---

## 3. Summary by Alignment Classification

- **Class A (Already aligned / Migrated):** 17 areas (grew from 14 in Stage 3)
  - Title Bar & Window Controls (#2)
  - Status Bar (#4)
  - Workspace Gate Fullscreen Launcher (#7) — *Aligned in Stage 3*
  - Workspace Gate Modal Flow (#8) — *Aligned in Stage 3*
  - Workspace Gate Location Selector (#9) — *Aligned in Stage 3*
  - Workspace Gate Worktree Subflows (#10) — *Aligned in Stage 3*
  - SSH Environment Manager (#11) — *Migrated in Stage 3*
  - Remote Directory Chooser (#12) — *Migrated in Stage 2*
  - Model Picker & Favorites (#13) — *Aligned in Stage 3*
  - Model Discovery Modal (#14) — *Aligned in Stage 3*
  - Searchable Choices primitive (#15)
  - Launch Recipe Modal (#16) — *Migrated in Stage 2*
  - VCS Credentials (#17)
  - Commit Dialog (#18) — *Migrated in Stage 4*
  - Git Delete Branch Dialog (#20) — *Migrated in Stage 4*
  - Annotation Handoff Dialog (#27) — *Migrated in Stage 2*
  - Diff Viewer Chrome (#29) — *Migrated in Stage 4*
- **Class B (Uses primitives/tokens, local styling drift):** 15 areas (reduced from 17 in Stage 4)
  - Application Shell (#1)
  - Workspace Tabs (#3)
  - Header Controls & Harness Pills (#5)
  - Header Settings Popover (#6)
  - Confirmation / Alert Dialogs (#19)
  - File Explorer (#21)
  - File Explorer Context Menu (#22)
  - Browser Panel & Toolbar (#23)
  - Browser URL Field & Suggestions (#24)
  - Remote Preview Bar (#26)
  - Editor Chrome & Tab Bar (#28)
  - Terminal Pane Chrome (#30)
  - Notes Pane (#31)
  - Chat History Popover (#32)
  - Git Branches, Stash, Merge (#34)
  - Git Remotes Section (#35)
  - Task Recovery Section (#37)
  - Dynamic Pane Layout (#38)
  - Error Boundary (#39)
- **Class C (Should migrate to shared primitive):** 1 area (reduced from 4 in Stage 4)
  - File Explorer Context Menu (#22) → evaluate shared Menu / Popover
- **Class D (Requires shared form-control primitive):** Recurring across 12 areas
  - Standard `Input`: RecipeModal, RemoteDirectoryChooser, SshEnvironmentManager, WorktreeLauncher, BrowserUrlInput, NotesPane, GitRemotes, HeaderSettings, WorkspaceTabs, CommitDialog
  - Standard `Textarea`: AnnotationHandoffDialog, CommitDialog, NotesPane
  - Standard `Select`: RecipeModal, HeaderSettings, GitMerge, RemoteWorktreePicker
  - Standard `Field` / `FieldLabel`: Form rows across settings, credentials, recipes, SSH manager
- **Class E (Intentionally bespoke):** 3 distinct patterns
  - Browser tab trapezoid rounding (`border-radius: 7px 7px 2px 2px` in `BrowserPanel.css`)
  - Splitter bar grab handles (`border-radius: 999px` in `DynamicPaneLayout.css`, `FileExplorer.css`)
  - Circular status dots / activity pulses (`border-radius: 50%` in `TerminalPane.css`, `EditorTabBar.css`, `FileExplorer.css`, `TaskRecoverySection.css`)

---

## 4. Complete Inventory of Hard-Coded Radius Patterns

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

## 5. Architectural Recommendations for Stage 1 Foundation

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

## 6. Recommended Migration Sequence for Subsequent Stages

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
