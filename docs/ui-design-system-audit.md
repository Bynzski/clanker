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
| 1 | **Application Shell** | `App.tsx`, `App.css` | **A** | **Aligned (Stage 5):** Loading placeholder (`.main-content-loading`) and workspace error fallback button normalized to `var(--radius-sm)`. | Completed. | Full shell and error fallback verified. |
| 2 | **Title Bar & Window Controls** | `TitleBar.tsx`, `TitleBar.css`, `WindowControls.tsx`, `WindowControls.css` | **A** | Zero radius literals; uses semantic tokens and shared `WindowControls` across normal titlebar and gate. | Retain as canonical reference. | No risk; already aligned. |
| 3 | **Workspace Tabs** | `WorkspaceTabs.tsx`, `WorkspaceTabs.css` | **A** | **Aligned (Stage 5):** Close button, rename trigger, inline rename input, and save button normalized from 3px to `var(--radius-sm)`; attention badge retained as intentional pill. | Completed. | Fully validated in drag/reorder, rename, and close. |
| 4 | **Status Bar** | `StatusBar.tsx`, `StatusBar.css` | **A** | Minimal, compact chrome. Environment pill uses `border-radius: var(--radius-sm)`. | Retain as canonical reference. | No risk; already aligned. |
| 5 | **Header Controls & Harness Pills** | `Header.tsx`, `Header.css`, `HeaderRightControls.tsx` | **A** | **Aligned (Stage 5):** Harness pills, favorite tags, and add-favorite trigger normalized from 3px to `var(--radius-sm)`. | Completed. | Dropdown triggers and harness pills verified. |
| 6 | **Header Settings Popover** | `HeaderRightControls.tsx`, `Header.css`, `AppearanceSettings.tsx`, `HarnessDefaultsSection.tsx` | **A** | **Aligned (Stage 5):** Uses Radix `Popover` primitive; settings inputs and selects use `var(--radius-sm)`. | Completed. | Theme switching and harness settings verified. |
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
| 17 | **VCS Credentials** | `CredentialSettings.tsx`, `CredentialSettings.css` | **A** | Uses shared `Dialog` and `IconButton`; standard `var(--radius-sm)` on dialog, inputs, tabs, cards; intentional 999px pill for status chip. | Retained as canonical design-system reference. | No risk; already aligned. |
| 18 | **Commit Dialog** | `CommitDialog.tsx`, `CommitDialog.css` | **A** | **Migrated (Stage 4):** Uses shared `Dialog`, `Textarea`, `Button`, `IconButton`; manual lease & Escape lifecycle removed; file status tag remains badge; zero backlog entries remaining. | Completed. | Fully validated including nested DiffViewer interaction. |
| 19 | **Confirmation / Alert Dialogs** | `ConfirmCloseDialog.tsx`, `ConfirmCloseDialog.css` | **A** | **Aligned (Stage 5):** Uses shared `AlertDialog`, `AlertDialogContent`, and shared `Button` variants; redundant button CSS removed. | Completed. | Fully validated in close prompt flows. |
| 20 | **Git Delete Branch Dialog** | `GitDeleteBranchDialog.tsx`, `GitButton.css` | **A** | **Migrated (Stage 4):** Uses shared `AlertDialog`, `Button`, with `onBackdropCancel`; `--radius-lg` shell eliminated; normal->force delete transition preserved. | Completed. | Fully validated in normal and force delete states. |
| 21 | **File Explorer** | `FileExplorer/index.tsx`, `FileTree.tsx`, `FileExplorer.css` | **A** | **Aligned (Stage 5):** Inline rename input normalized from 3px to `var(--radius-sm)`; action buttons use `var(--radius-sm)`; splitter pill and git dot circle retained. | Completed. | Tree node renaming and filtering verified. |
| 22 | **File Explorer Context Menu** | `ContextMenu.tsx`, `ContextMenu.css` | **A** | **Aligned (Stage 5):** Lightweight specialized context menu uses `var(--radius-sm)`, elevated surface, border, and shadow; correct `role="menu"` / `menuitem`, Escape dismissal, and outside click. | Retained as specialized aligned menu. | Low risk; fully tested. |
| 23 | **Browser Panel & Toolbar** | `BrowserPanel.tsx`, `BrowserPanel.css` | **A** | **Aligned (Stage 5):** Panel container, nav buttons, and annotate button normalized to `var(--radius-sm)`; drag handle dot texture retained. | Completed. | WebContentsView frame bounds verified. |
| 24 | **Browser URL Field & Suggestions** | `BrowserUrlInput.tsx`, `BrowserPanel.css` | **A** | **Aligned (Stage 5):** URL input, Go button, suggestions popup, and suggestion items normalized to `var(--radius-sm)`. | Completed. | URL autocomplete and keyboard selection verified. |
| 25 | **Browser Tab Strip** | `BrowserTabStrip.tsx`, `BrowserPanel.css` | **E/A** | **Aligned (Stage 5):** Tab uses intentional curved trapezoid shape (`border-radius: 7px 7px 2px 2px`, Class E); tab add and close buttons normalized to `var(--radius-sm)`. | Completed. | Tab add/close behavior verified. |
| 26 | **Remote Preview Bar** | `RemotePreviewBar.tsx`, `BrowserPanel.css` | **A** | **Aligned (Stage 5):** Port inputs and start/stop/open buttons normalized from 3px to `var(--radius-sm)`. | Completed. | SSH port forwarding preview verified. |
| 27 | **Annotation Handoff Dialog** | `AnnotationHandoffDialog.tsx`, `AnnotationHandoffDialog.css` | **A** | **Migrated (Stage 2):** Uses shared `Dialog`, `Button`, `IconButton`, `Textarea`. `--radius-md` shell and 5px textarea/buttons eliminated; zero exceptions remaining. | Completed. | Fully validated with Escape and focus restoration tests. |
| 28 | **Editor Chrome & Tab Bar** | `EditorPane.tsx`, `EditorPane.css`, `EditorTabBar.tsx`, `EditorTabBar.css` | **A** | **Aligned (Stage 5):** Editor panel container, lock button, close button, reload banner button, tab bar scrollbar thumb, and tab close button normalized to `var(--radius-sm)`; unsaved dot circle retained. | Completed. | Tab switching, saving, and sizing verified. |
| 29 | **Diff Viewer Chrome** | `DiffViewer.tsx`, `DiffViewer.css` | **A** | **Migrated (Stage 4):** Uses single shared `Dialog` shell across all five states, `IconButton`, `workspaceId` wire-through; nested Dialog with topmost Escape validated. | Completed. | Fully validated standalone and inside CommitDialog. |
| 30 | **Terminal Pane Chrome** | `TerminalPane.tsx`, `TerminalPane.css` | **A** | **Aligned (Stage 5):** Terminal action buttons and close button normalized from 4px to `var(--radius-sm)`; status dot circle retained. | Completed. | Terminal layout and xterm instance cache verified. |
| 31 | **Notes Pane** | `NotesPane.tsx`, `NotesPane.css` | **A** | **Aligned (Stage 5):** Notes panel container and close button normalized to `var(--radius-sm)`; drag handle dot texture retained. | Completed. | Note persistence and pane close verified. |
| 32 | **Chat History Popover** | `ChatHistoryDropdown.tsx`, `ChatHistoryDropdown.css` | **A** | Uses Radix `Popover`; shell uses `var(--radius-sm)`; session count badge uses 8px (intentional pill counter). | Retained as aligned popover. | Low risk; already aligned. |
| 33 | **Git Menu & Popover** | `GitButton.tsx`, `GitRepoMenu.tsx`, `GitButton.css` | **A** | **Aligned (Stage 4):** `.git-menu` normalized from `var(--radius-md)` to `var(--radius-sm)`; delete branch dialog migrated to AlertDialog; status pills (999px) retained. | Completed. | Zero backlog entries remaining in GitButton.css. |
| 34 | **Git Sections: Branches, Stash, Merge** | `GitBranchesSection.*`, `GitStashSection.*`, `GitMergeSection.*` | **A** | **Aligned (Stage 5):** Lists, inputs, selects, and merge info use `var(--radius-sm)`; branch tags (999px) retained. | Completed. | Fully validated in branch/stash/merge operations. |
| 35 | **Git Sections: Remotes** | `GitRemotesSection.tsx`, `GitRemotesSection.css` | **A** | **Aligned (Stage 5):** Remote cards, add buttons, item action buttons, form inputs, and submit buttons normalized from 4px to `var(--radius-sm)`; count and suggestion badges retained as pills. | Completed. | Zero backlog entries remaining in GitRemotesSection.css. |
| 36 | **Provider Badge & Menu** | `ProviderBadge.tsx/css`, `ProviderMenu.tsx/css` | **A** | **Aligned (Stage 4):** Menu trigger, dropdown content, refresh button, and link items normalized from 6px/8px/4px to `var(--radius-sm)`; provider status badges (4px/10px) retained. | Completed. | Zero backlog entries remaining in ProviderMenu.css. |
| 37 | **Task Recovery Section** | `TaskRecoverySection.tsx`, `TaskRecoverySection.css` | **A** | **Aligned (Stage 5):** Task items, action buttons, session picker, and session items normalized from 6px/4px/3px to `var(--radius-sm)`; count and status badges retained as pills. | Completed. | Zero backlog entries remaining in TaskRecoverySection.css. |
| 38 | **Dynamic Pane Layout & Dock Targets** | `DynamicPaneLayout.tsx`, `DynamicPaneLayout.css`, `DockEdgeTargets.tsx` | **A/E** | **Aligned (Stage 5):** Drag preview normalized from 8px to `var(--radius-sm)`; dock targets use `var(--radius-md)`; splitter pills (999px) and drag handle dot textures retained as Class E. | Completed. | Docking and drag preview verified. |
| 39 | **Error Boundary** | `ErrorBoundary.tsx`, `ErrorBoundary.css` | **A** | **Aligned (Stage 5):** Error fallback details card and retry button normalized to `var(--radius-sm)`. | Completed. | Crash fallback verified. |

---

## 3. Summary by Alignment Classification

- **Class A (Already aligned / Migrated):** 36 areas
  - Application Shell (#1) — *Aligned in Stage 5*
  - Title Bar & Window Controls (#2)
  - Workspace Tabs (#3) — *Aligned in Stage 5*
  - Status Bar (#4)
  - Header Controls & Harness Pills (#5) — *Aligned in Stage 5*
  - Header Settings Popover (#6) — *Aligned in Stage 5*
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
  - Confirmation / Alert Dialogs (#19) — *Aligned in Stage 5*
  - Git Delete Branch Dialog (#20) — *Migrated in Stage 4*
  - File Explorer (#21) — *Aligned in Stage 5*
  - File Explorer Context Menu (#22) — *Aligned in Stage 5*
  - Browser Panel & Toolbar (#23) — *Aligned in Stage 5*
  - Browser URL Field & Suggestions (#24) — *Aligned in Stage 5*
  - Remote Preview Bar (#26) — *Aligned in Stage 5*
  - Annotation Handoff Dialog (#27) — *Migrated in Stage 2*
  - Editor Chrome & Tab Bar (#28) — *Aligned in Stage 5*
  - Diff Viewer Chrome (#29) — *Migrated in Stage 4*
  - Terminal Pane Chrome (#30) — *Aligned in Stage 5*
  - Notes Pane (#31) — *Aligned in Stage 5*
  - Chat History Popover (#32)
  - Git Menu & Popover (#33) — *Aligned in Stage 4*
  - Git Branches, Stash, Merge (#34) — *Aligned in Stage 5*
  - Git Remotes Section (#35) — *Aligned in Stage 5*
  - Provider Badge & Menu (#36) — *Aligned in Stage 4*
  - Task Recovery Section (#37) — *Aligned in Stage 5*
  - Dynamic Pane Layout & Dock Targets (#38) — *Aligned in Stage 5*
  - Error Boundary (#39) — *Aligned in Stage 5*
- **Class B (Uses primitives/tokens, local styling drift):** 0 areas
- **Class C (Should migrate to shared primitive):** 0 areas
- **Class D (Requires shared form-control primitive):** 0 areas (completed via `ui/Input`, `ui/Textarea`, `ui/Select`, `ui/Field`)
- **Class E (Intentionally bespoke):** 3 distinct patterns
  - Browser tab trapezoid rounding (`border-radius: 7px 7px 2px 2px` in `BrowserPanel.css`, Area #25)
  - Splitter bar grab handles (`border-radius: 999px` in `DynamicPaneLayout.css`, `FileExplorer.css`)
  - Circular status dots / activity pulses (`border-radius: 50%` in `TerminalPane.css`, `EditorTabBar.css`, `FileExplorer.css`, `TaskRecoverySection.css`)
- **STAGED_MIGRATION_BACKLOG:** 0 entries (completely removed from `geometryContract.test.ts`)
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
