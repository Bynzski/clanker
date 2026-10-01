# Stage 5B raw-control inventory

Baseline: `fe511064b835d07869f9adbbb9773b683e0c109b` on `ui/64-design-system-alignment`. Counts are JSX source sites, not mounted DOM instances. Every `.tsx` under `src/renderer` was scanned using the TypeScript JSX parser.

Before: **208** sites (34 input, 2 textarea, 7 select, 165 button). **158** ordinary raw controls migrated. Two specialized tab selectors now use semantic div wrappers to avoid nesting shared action buttons inside buttons; two span close controls additionally migrated to IconButton.

Final: **48** raw sites (7 input, 1 textarea, 1 select, 39 button). There are no raw ordinary field implementations outside canonical primitives; the only retained ordinary actions are documented crash recovery and canonical OS caption controls.

## Native semantic controls intentionally retained

| Source | Element / identity | Reason |
|---|---|---|
| [components/HeaderRightControls.tsx:159](../src/renderer/components/HeaderRightControls.tsx#L159) | `input`: checkbox | Native checkbox semantics; checked state and label association remain native. |
| [components/git/GitInitMenu.tsx:63](../src/renderer/components/git/GitInitMenu.tsx#L63) | `input`: radio | Native radio semantics; checked state and label association remain native. |
| [components/git/GitInitMenu.tsx:73](../src/renderer/components/git/GitInitMenu.tsx#L73) | `input`: radio | Native radio semantics; checked state and label association remain native. |
| [components/git/GitStashSection.tsx:54](../src/renderer/components/git/GitStashSection.tsx#L54) | `input`: checkbox | Native checkbox semantics; checked state and label association remain native. |
| [components/settings/HarnessDefaultsSection.tsx:68](../src/renderer/components/settings/HarnessDefaultsSection.tsx#L68) | `input`: checkbox | Native checkbox semantics; checked state and label association remain native. |
| [components/settings/HarnessDefaultsSection.tsx:111](../src/renderer/components/settings/HarnessDefaultsSection.tsx#L111) | `input`: checkbox | Native checkbox semantics; checked state and label association remain native. |
| [components/ui/Button.tsx:11](../src/renderer/components/ui/Button.tsx#L11) | `button`: clanker-button  | Shared primitive implementation: canonical native element behind the public control API. |
| [components/ui/Input.tsx:22](../src/renderer/components/ui/Input.tsx#L22) | `input`: clanker-input  | Shared primitive implementation: canonical native element behind the public control API. |
| [components/ui/Select.tsx:19](../src/renderer/components/ui/Select.tsx#L19) | `select`: clanker-select  | Shared primitive implementation: canonical native element behind the public control API. |
| [components/ui/Textarea.tsx:19](../src/renderer/components/ui/Textarea.tsx#L19) | `textarea`: clanker-textarea  | Shared primitive implementation: canonical native element behind the public control API. |

## Specialized product controls intentionally retained

| Source | Element / identity | Reason |
|---|---|---|
| [App.tsx:362](../src/renderer/App.tsx#L362) | `button`: native element | Crash recovery fallback: deliberately avoids shared UI dependencies so recovery is available if the normal UI fails. |
| [components/BrowserTabStrip.tsx:84](../src/renderer/components/BrowserTabStrip.tsx#L84) | `button`: browser-tab-select | Browser tab selection belongs to the curved draggable tab strip, not a generic action. |
| [components/BrowserUrlInput.tsx:51](../src/renderer/components/BrowserUrlInput.tsx#L51) | `button`: browser-history-suggestion  | URL listbox option with highlighted selection and mouse-down blur suppression. |
| [components/ChatHistoryDropdown.tsx:49](../src/renderer/components/ChatHistoryDropdown.tsx#L49) | `button`: chat-history-harness-header  | Expandable history group row with harness icon, count, and chevron. |
| [components/ChatHistoryDropdown.tsx:70](../src/renderer/components/ChatHistoryDropdown.tsx#L70) | `button`: chat-history-session | Conversation selection row with title/cwd/date composition. |
| [components/ErrorBoundary.tsx:98](../src/renderer/components/ErrorBoundary.tsx#L98) | `button`: error-boundary-retry | Crash recovery fallback: deliberately avoids shared UI dependencies so recovery is available if the normal UI fails. |
| [components/FileExplorer/ContextMenu.tsx:71](../src/renderer/components/FileExplorer/ContextMenu.tsx#L71) | `button`: context-menu-action | Specialized context menu item; the existing menu model owns destructive emphasis and keyboard dismissal. |
| [components/FileExplorer/ContextMenu.tsx:83](../src/renderer/components/FileExplorer/ContextMenu.tsx#L83) | `button`: context-menu-action | Specialized context menu item; the existing menu model owns destructive emphasis and keyboard dismissal. |
| [components/FileExplorer/ContextMenu.tsx:98](../src/renderer/components/FileExplorer/ContextMenu.tsx#L98) | `button`: context-menu-action | Specialized context menu item; the existing menu model owns destructive emphasis and keyboard dismissal. |
| [components/FileExplorer/ContextMenu.tsx:111](../src/renderer/components/FileExplorer/ContextMenu.tsx#L111) | `button`: context-menu-action danger | Specialized context menu item; the existing menu model owns destructive emphasis and keyboard dismissal. |
| [components/FileExplorer/ContextMenu.tsx:126](../src/renderer/components/FileExplorer/ContextMenu.tsx#L126) | `button`: context-menu-action | Specialized context menu item; the existing menu model owns destructive emphasis and keyboard dismissal. |
| [components/FileExplorer/ContextMenu.tsx:139](../src/renderer/components/FileExplorer/ContextMenu.tsx#L139) | `button`: context-menu-action | Specialized context menu item; the existing menu model owns destructive emphasis and keyboard dismissal. |
| [components/FileExplorer/ContextMenu.tsx:153](../src/renderer/components/FileExplorer/ContextMenu.tsx#L153) | `button`: context-menu-action | Specialized context menu item; the existing menu model owns destructive emphasis and keyboard dismissal. |
| [components/FileExplorer/FileTree.tsx:287](../src/renderer/components/FileExplorer/FileTree.tsx#L287) | `button`: tree-node  | Tree entry row with depth indentation, expansion, double-click, context menu and inline editing. |
| [components/Header.tsx:206](../src/renderer/components/Header.tsx#L206) | `button`: harness-pill | Harness launcher pill combines harness identity/icon with launch action in the product header. |
| [components/RemoteDirectoryChooser.tsx:276](../src/renderer/components/RemoteDirectoryChooser.tsx#L276) | `button`: button | Remote directory navigation row displaying folder identity; ordinary retry uses Button. |
| [components/RemoteWorkspacePath.tsx:123](../src/renderer/components/RemoteWorkspacePath.tsx#L123) | `button`: suggestion-item  | Directory autocomplete option with path composition and selected index navigation. |
| [components/TaskRecoverySection.tsx:218](../src/renderer/components/TaskRecoverySection.tsx#L218) | `button`: task-session-picker-item | Session association selection row with conversation metadata. |
| [components/WindowControls.tsx:51](../src/renderer/components/WindowControls.tsx#L51) | `button`: button | Canonical OS caption controls shared by titlebar and gate: caption hit targets and platform close emphasis. |
| [components/WindowControls.tsx:55](../src/renderer/components/WindowControls.tsx#L55) | `button`: button | Canonical OS caption controls shared by titlebar and gate: caption hit targets and platform close emphasis. |
| [components/WindowControls.tsx:59](../src/renderer/components/WindowControls.tsx#L59) | `button`: button | Canonical OS caption controls shared by titlebar and gate: caption hit targets and platform close emphasis. |
| [components/WorkspaceGateContent.tsx:775](../src/renderer/components/WorkspaceGateContent.tsx#L775) | `button`: gate-recipe-chip | Recipe summary chip fills launch counts; paired launch action uses IconButton. |
| [components/gate/ModelPicker.tsx:100](../src/renderer/components/gate/ModelPicker.tsx#L100) | `button`: model-pill  | Model picker trigger displays current model, unresolved state, and harness-specific composition. |
| [components/gate/ModelPicker.tsx:116](../src/renderer/components/gate/ModelPicker.tsx#L116) | `button`: model-choice | Model selection row with metadata, selection marker, and a separate shared favorite IconButton. |
| [components/gate/ModelPicker.tsx:171](../src/renderer/components/gate/ModelPicker.tsx#L171) | `button`: model-choice | Model selection row with metadata, selection marker, and a separate shared favorite IconButton. |
| [components/gate/ModelPicker.tsx:220](../src/renderer/components/gate/ModelPicker.tsx#L220) | `button`: model-pill | Model picker trigger displays current model, unresolved state, and harness-specific composition. |
| [components/gate/WorkspaceTargetPicker.tsx:58](../src/renderer/components/gate/WorkspaceTargetPicker.tsx#L58) | `button`: gate-target-trigger | Composite location picker trigger displays host identity and connection state. |
| [components/gate/WorkspaceTargetPicker.tsx:75](../src/renderer/components/gate/WorkspaceTargetPicker.tsx#L75) | `button`: gate-target-option | Location selection row with host name/details and selection marker. |
| [components/git/GitHistorySection.tsx:64](../src/renderer/components/git/GitHistorySection.tsx#L64) | `button`: git-history-item  | Commit selection row with hash, subject, author/date and active diff state. |
| [components/git/GitRemotesSection.tsx:401](../src/renderer/components/git/GitRemotesSection.tsx#L401) | `button`: git-remotes-suggestion | Remote name suggestion pill; bounded quick-choice composition, not a submit/action variant. |
| [components/git/ProviderBadge.tsx:66](../src/renderer/components/git/ProviderBadge.tsx#L66) | `button`: provider-badge create-pr-badge | Product VCS status badge/PR link with provider and PR state geometry. |
| [components/git/ProviderBadge.tsx:84](../src/renderer/components/git/ProviderBadge.tsx#L84) | `button`: provider-badge create-pr-badge | Product VCS status badge/PR link with provider and PR state geometry. |
| [components/git/ProviderBadge.tsx:102](../src/renderer/components/git/ProviderBadge.tsx#L102) | `button`: provider-badge pr-badge  | Product VCS status badge/PR link with provider and PR state geometry. |
| [components/git/ProviderMenu.tsx:146](../src/renderer/components/git/ProviderMenu.tsx#L146) | `button`: provider-menu-link | Provider deep-link menu row driven by the existing menu item model and link icons. |
| [components/settings/CredentialSettings.tsx:260](../src/renderer/components/settings/CredentialSettings.tsx#L260) | `button`: credential-tab  | Credentials SSH/token tab selector with active panel state. |
| [components/settings/CredentialSettings.tsx:268](../src/renderer/components/settings/CredentialSettings.tsx#L268) | `button`: credential-tab  | Credentials SSH/token tab selector with active panel state. |
| [components/settings/HarnessDefaultsSection.tsx:75](../src/renderer/components/settings/HarnessDefaultsSection.tsx#L75) | `button`: harness-defaults-header  | Expandable harness settings group row with icon and disclosure chevron. |
| [components/ui/SearchablePicker.tsx:102](../src/renderer/components/ui/SearchablePicker.tsx#L102) | `button`: searchable-picker-choice | Shared composite picker choice row; selection state and labels belong to the picker, while search/favorites use Input/IconButton. |

## Before-migration classification of every raw site

These line numbers refer to the baseline commit. Migrations use shared primitives; retained sites are justified in the final inventory above. “Tokenized radius” was not used as an adoption criterion.

| Baseline source | Element / identity | Disposition |
|---|---|---|
| `App.tsx:350` | `button`: button | Migrated to Button |
| `App.tsx:361` | `button`: native element | Crash recovery fallback: deliberately avoids shared UI dependencies so recovery is available if the normal UI fails. |
| `components/BrowserPanel.tsx:98` | `button`: browser-nav-btn | Migrated to IconButton |
| `components/BrowserPanel.tsx:101` | `button`: browser-nav-btn | Migrated to IconButton |
| `components/BrowserPanel.tsx:104` | `button`: browser-nav-btn | Migrated to IconButton |
| `components/BrowserPanel.tsx:107` | `button`: browser-nav-btn browser-stop | Migrated to IconButton |
| `components/BrowserPanel.tsx:123` | `button`: browser-go-btn | Migrated to Button |
| `components/BrowserPanel.tsx:127` | `button`: browser-nav-btn browser-external | Migrated to IconButton |
| `components/BrowserPanel.tsx:131` | `button`: browser-nav-btn  | Migrated to IconButton |
| `components/BrowserTabStrip.tsx:83` | `button`: browser-tab-select | Browser tab selection belongs to the curved draggable tab strip, not a generic action. |
| `components/BrowserTabStrip.tsx:94` | `button`: browser-tab-close | Migrated to IconButton |
| `components/BrowserTabStrip.tsx:107` | `button`: browser-tab-add | Migrated to IconButton |
| `components/BrowserUrlInput.tsx:29` | `input`: browser-url-input | Migrated to Input |
| `components/BrowserUrlInput.tsx:50` | `button`: browser-history-suggestion  | URL listbox option with highlighted selection and mouse-down blur suppression. |
| `components/ChatHistoryDropdown.tsx:49` | `button`: chat-history-harness-header  | Expandable history group row with harness icon, count, and chevron. |
| `components/ChatHistoryDropdown.tsx:70` | `button`: chat-history-session | Conversation selection row with title/cwd/date composition. |
| `components/CommitDialog.tsx:400` | `button`: commit-file-unstage | Migrated to Button |
| `components/EditorPane.tsx:258` | `button`: editor-pane-close-btn | Migrated to IconButton |
| `components/EditorPane.tsx:276` | `button`: editor-reload-banner-btn | Migrated to Button |
| `components/EditorPane.tsx:292` | `button`: editor-reload-banner-btn editor-reload-banner-btn--secondary | Migrated to Button |
| `components/EditorPane.tsx:315` | `button`: editor-reload-banner-btn | Migrated to Button |
| `components/EditorPane.tsx:331` | `button`: editor-reload-banner-btn editor-reload-banner-btn--secondary | Migrated to Button |
| `components/EditorTabBar.tsx:103` | `button`: editor-tab  | Specialized tab selector retained as semantic div; nested close action uses IconButton |
| `components/ErrorBoundary.tsx:98` | `button`: error-boundary-retry | Crash recovery fallback: deliberately avoids shared UI dependencies so recovery is available if the normal UI fails. |
| `components/FileExplorer/ContextMenu.tsx:71` | `button`: context-menu-action | Specialized context menu item; the existing menu model owns destructive emphasis and keyboard dismissal. |
| `components/FileExplorer/ContextMenu.tsx:83` | `button`: context-menu-action | Specialized context menu item; the existing menu model owns destructive emphasis and keyboard dismissal. |
| `components/FileExplorer/ContextMenu.tsx:98` | `button`: context-menu-action | Specialized context menu item; the existing menu model owns destructive emphasis and keyboard dismissal. |
| `components/FileExplorer/ContextMenu.tsx:111` | `button`: context-menu-action danger | Specialized context menu item; the existing menu model owns destructive emphasis and keyboard dismissal. |
| `components/FileExplorer/ContextMenu.tsx:126` | `button`: context-menu-action | Specialized context menu item; the existing menu model owns destructive emphasis and keyboard dismissal. |
| `components/FileExplorer/ContextMenu.tsx:139` | `button`: context-menu-action | Specialized context menu item; the existing menu model owns destructive emphasis and keyboard dismissal. |
| `components/FileExplorer/ContextMenu.tsx:153` | `button`: context-menu-action | Specialized context menu item; the existing menu model owns destructive emphasis and keyboard dismissal. |
| `components/FileExplorer/FileTree.tsx:286` | `button`: tree-node  | Tree entry row with depth indentation, expansion, double-click, context menu and inline editing. |
| `components/FileExplorer/FileTree.tsx:305` | `input`: tree-node-input | Migrated to Input |
| `components/FileExplorer/FileTree.tsx:408` | `input`: tree-node-input | Migrated to Input |
| `components/FileExplorer/index.tsx:566` | `button`: file-explorer-action | Migrated to IconButton |
| `components/FileExplorer/index.tsx:574` | `button`: file-explorer-action | Migrated to IconButton |
| `components/FileExplorer/index.tsx:585` | `button`: file-explorer-action | Migrated to IconButton |
| `components/FileExplorer/index.tsx:596` | `button`: file-explorer-action  | Migrated to Button |
| `components/FileExplorer/index.tsx:604` | `button`: file-explorer-close | Migrated to IconButton |
| `components/FileExplorer/index.tsx:616` | `input`: file-explorer-filter-input | Migrated to Input |
| `components/FileExplorer/index.tsx:627` | `button`: file-explorer-filter-clear | Migrated to IconButton |
| `components/GateHarnessSettings.tsx:22` | `button`: gate-worktree-back | Migrated to Button |
| `components/GitButton.tsx:643` | `button`: header-btn git-btn | Migrated to Button |
| `components/Header.tsx:191` | `button`: header-btn  | Migrated to Button |
| `components/Header.tsx:205` | `button`: harness-pill | Harness launcher pill combines harness identity/icon with launch action in the product header. |
| `components/Header.tsx:219` | `button`: header-btn  | Migrated to Button |
| `components/Header.tsx:224` | `button`: header-btn  | Migrated to Button |
| `components/HeaderRightControls.tsx:95` | `button`: header-btn header-btn-icon | Migrated to IconButton |
| `components/HeaderRightControls.tsx:106` | `button`: header-btn header-btn-icon | Migrated to IconButton |
| `components/HeaderRightControls.tsx:116` | `button`: header-btn header-btn-icon | Migrated to IconButton |
| `components/HeaderRightControls.tsx:158` | `input`: checkbox | Native checkbox semantics; checked state and label association remain native. |
| `components/HeaderRightControls.tsx:168` | `select`: settings-select | Migrated to Select |
| `components/HeaderRightControls.tsx:189` | `select`: settings-select | Migrated to Select |
| `components/HeaderRightControls.tsx:213` | `button`: settings-dropdown-action | Migrated to Button |
| `components/NotesPane.tsx:62` | `button`: notes-pane-close-btn | Migrated to IconButton |
| `components/NotesPane.tsx:72` | `textarea`: notes-editor | Migrated to Textarea |
| `components/RemoteDirectoryChooser.tsx:273` | `button`: button | Migrated to Button |
| `components/RemoteDirectoryChooser.tsx:276` | `button`: button | Remote directory navigation row displaying folder identity; ordinary retry uses Button. |
| `components/RemotePreviewBar.tsx:72` | `input`: number | Migrated to Input |
| `components/RemotePreviewBar.tsx:73` | `input`: number | Migrated to Input |
| `components/RemotePreviewBar.tsx:74` | `button`: button | Migrated to Button |
| `components/RemotePreviewBar.tsx:75` | `button`: button | Migrated to Button |
| `components/RemotePreviewBar.tsx:76` | `button`: button | Migrated to Button |
| `components/RemoteWorkspacePath.tsx:92` | `input`: gate-input | Migrated to Input |
| `components/RemoteWorkspacePath.tsx:113` | `button`: cog-button | Migrated to IconButton |
| `components/RemoteWorkspacePath.tsx:121` | `button`: suggestion-item  | Directory autocomplete option with path composition and selected index navigation. |
| `components/RemoteWorktreeCreate.tsx:41` | `input`: native element | Migrated to Input |
| `components/RemoteWorktreeCreate.tsx:43` | `input`: native element | Migrated to Input |
| `components/RemoteWorktreeCreate.tsx:44` | `button`: button | Migrated to Button |
| `components/RemoteWorktreeInspect.tsx:61` | `button`: button | Migrated to Button |
| `components/RemoteWorktreeInspect.tsx:62` | `button`: button | Migrated to Button |
| `components/RemoteWorktreeInspect.tsx:67` | `button`: button | Migrated to Button |
| `components/RemoteWorktreeInspect.tsx:68` | `button`: button | Migrated to Button |
| `components/RemoteWorktreePicker.tsx:47` | `select`: ssh-env-select | Migrated to Select |
| `components/RemoteWorktreePicker.tsx:50` | `button`: button | Migrated to Button |
| `components/RemoteWorktreePicker.tsx:63` | `button`: button | Migrated to Button |
| `components/SshEnvironmentManager.tsx:121` | `button`: ssh-env-edit-btn | Migrated to IconButton |
| `components/SshEnvironmentManager.tsx:122` | `button`: ssh-env-delete-btn | Migrated to IconButton |
| `components/TaskRecoverySection.tsx:140` | `button`: task-action-btn focus-btn | Migrated to IconButton |
| `components/TaskRecoverySection.tsx:151` | `button`: task-action-btn resume-btn | Migrated to Button |
| `components/TaskRecoverySection.tsx:164` | `button`: task-action-btn resume-btn | Migrated to Button |
| `components/TaskRecoverySection.tsx:176` | `button`: task-action-btn select-session-btn | Migrated to Button |
| `components/TaskRecoverySection.tsx:187` | `button`: task-action-btn delete-btn | Migrated to IconButton |
| `components/TaskRecoverySection.tsx:216` | `button`: task-session-picker-item | Session association selection row with conversation metadata. |
| `components/TerminalPane.tsx:726` | `button`: terminal-close | Migrated to IconButton |
| `components/WindowControls.tsx:51` | `button`: button | Canonical OS caption controls shared by titlebar and gate: caption hit targets and platform close emphasis. |
| `components/WindowControls.tsx:55` | `button`: button | Canonical OS caption controls shared by titlebar and gate: caption hit targets and platform close emphasis. |
| `components/WindowControls.tsx:59` | `button`: button | Canonical OS caption controls shared by titlebar and gate: caption hit targets and platform close emphasis. |
| `components/WorkspaceGateContent.tsx:706` | `input`: gate-input | Migrated to Input |
| `components/WorkspaceGateContent.tsx:724` | `button`: cog-button | Migrated to IconButton |
| `components/WorkspaceGateContent.tsx:772` | `button`: gate-recipe-chip | Recipe summary chip fills launch counts; paired launch action uses IconButton. |
| `components/WorkspaceGateContent.tsx:789` | `button`: gate-recipe-play | Migrated to IconButton |
| `components/WorkspaceGateContent.tsx:815` | `button`: gate-settings-link | Migrated to Button |
| `components/WorkspaceGateContent.tsx:829` | `button`: gate-worktree-back | Migrated to Button |
| `components/WorkspaceGateContent.tsx:852` | `button`: cog-button cog-button-left | Migrated to IconButton |
| `components/WorkspaceGateContent.tsx:855` | `input`: gate-input | Migrated to Input |
| `components/WorkspaceGateContent.tsx:856` | `button`: cog-button | Migrated to IconButton |
| `components/WorkspaceTabs.tsx:185` | `button`: workspace-tab  | Specialized tab selector retained as semantic div; nested close action uses IconButton |
| `components/WorkspaceTabs.tsx:203` | `input`: workspace-tab-edit-input | Migrated to Input |
| `components/WorkspaceTabs.tsx:212` | `button`: workspace-tab-edit-btn | Migrated to IconButton |
| `components/WorkspaceTabs.tsx:229` | `button`: workspace-tab-edit-trigger | Migrated to IconButton |
| `components/WorkspaceTabs.tsx:266` | `button`: workspace-tab-jump | Migrated to IconButton |
| `components/WorkspaceTabs.tsx:280` | `button`: workspace-tab workspace-tab-new | Migrated to IconButton |
| `components/WorktreeLauncher.tsx:116` | `button`: button | Migrated to Button |
| `components/WorktreeLauncher.tsx:120` | `input`: native element | Migrated to Input |
| `components/WorktreeLauncher.tsx:124` | `input`: native element | Migrated to Input |
| `components/WorktreeLauncher.tsx:126` | `button`: button | Migrated to Button |
| `components/WorktreeLauncher.tsx:136` | `button`: button | Migrated to Button |
| `components/WorktreeLauncher.tsx:137` | `button`: button | Migrated to Button |
| `components/WorktreeLauncher.tsx:146` | `button`: button | Migrated to Button |
| `components/WorktreeLauncher.tsx:147` | `button`: button | Migrated to Button |
| `components/gate/HarnessLaunchList.tsx:46` | `button`: button | Migrated to IconButton |
| `components/gate/HarnessLaunchList.tsx:48` | `button`: button | Migrated to IconButton |
| `components/gate/HarnessPicker.tsx:19` | `button`: gate-settings-link | Migrated to Button |
| `components/gate/ModelPicker.tsx:93` | `button`: gate-model-refresh | Migrated to Button |
| `components/gate/ModelPicker.tsx:94` | `input`: settings-select | Migrated to Input |
| `components/gate/ModelPicker.tsx:98` | `button`: model-pill  | Model picker trigger displays current model, unresolved state, and harness-specific composition. |
| `components/gate/ModelPicker.tsx:114` | `button`: model-choice | Model selection row with metadata, selection marker, and a separate shared favorite IconButton. |
| `components/gate/ModelPicker.tsx:122` | `button`: favorites-star-btn favorited | Migrated to IconButton |
| `components/gate/ModelPicker.tsx:133` | `button`: favorites-browse-link | Migrated to Button |
| `components/gate/ModelPicker.tsx:136` | `button`: favorites-browse-link | Migrated to Button |
| `components/gate/ModelPicker.tsx:145` | `input`: settings-select | Migrated to Input |
| `components/gate/ModelPicker.tsx:156` | `button`: discovery-refresh | Migrated to Button |
| `components/gate/ModelPicker.tsx:161` | `input`: discovery-search-input | Migrated to Input |
| `components/gate/ModelPicker.tsx:169` | `button`: model-choice | Model selection row with metadata, selection marker, and a separate shared favorite IconButton. |
| `components/gate/ModelPicker.tsx:175` | `button`: discovery-star-btn  | Migrated to IconButton |
| `components/gate/ModelPicker.tsx:218` | `button`: model-pill | Model picker trigger displays current model, unresolved state, and harness-specific composition. |
| `components/gate/ModelPicker.tsx:226` | `button`: favorites-browse-link | Migrated to Button |
| `components/gate/ModelPicker.tsx:229` | `button`: favorites-browse-link | Migrated to Button |
| `components/gate/WorkspaceTargetPicker.tsx:56` | `button`: gate-target-trigger | Composite location picker trigger displays host identity and connection state. |
| `components/gate/WorkspaceTargetPicker.tsx:67` | `input`: search | Migrated to Input |
| `components/gate/WorkspaceTargetPicker.tsx:73` | `button`: gate-target-option | Location selection row with host name/details and selection marker. |
| `components/gate/WorkspaceTargetPicker.tsx:87` | `button`: gate-target-settings | Migrated to Button |
| `components/gate/WorkspaceTargetPicker.tsx:98` | `button`: gate-target-add | Migrated to Button |
| `components/git/GitBranchesSection.tsx:110` | `input`: git-create-branch-input | Migrated to Input |
| `components/git/GitBranchesSection.tsx:118` | `button`: header-btn git-create-branch-submit | Migrated to Button |
| `components/git/GitBranchesSection.tsx:151` | `button`: git-branch-action | Migrated to Button |
| `components/git/GitBranchesSection.tsx:162` | `button`: git-branch-action danger | Migrated to Button |
| `components/git/GitHistorySection.tsx:38` | `button`: git-history-toggle  | Migrated to Button |
| `components/git/GitHistorySection.tsx:46` | `button`: git-history-toggle  | Migrated to Button |
| `components/git/GitHistorySection.tsx:63` | `button`: git-history-item  | Commit selection row with hash, subject, author/date and active diff state. |
| `components/git/GitInitMenu.tsx:28` | `button`: header-btn git-btn | Migrated to Button |
| `components/git/GitInitMenu.tsx:45` | `button`: git-menu-close | Migrated to IconButton |
| `components/git/GitInitMenu.tsx:61` | `input`: radio | Native radio semantics; checked state and label association remain native. |
| `components/git/GitInitMenu.tsx:71` | `input`: radio | Native radio semantics; checked state and label association remain native. |
| `components/git/GitInitMenu.tsx:87` | `button`: header-btn header-btn-primary git-menu-action | Migrated to Button |
| `components/git/GitMenuHeader.tsx:60` | `button`: git-menu-close | Migrated to IconButton |
| `components/git/GitMenuHeader.tsx:88` | `button`: header-btn header-btn-primary git-menu-action | Migrated to Button |
| `components/git/GitMenuHeader.tsx:95` | `button`: header-btn git-menu-action | Migrated to Button |
| `components/git/GitMergeSection.tsx:55` | `button`: git-operation-abort | Migrated to Button |
| `components/git/GitMergeSection.tsx:66` | `select`: git-merge-select | Migrated to Select |
| `components/git/GitMergeSection.tsx:82` | `button`: header-btn git-create-branch-submit | Migrated to Button |
| `components/git/GitRemoteActionsSection.tsx:33` | `button`: header-btn git-menu-action | Migrated to Button |
| `components/git/GitRemoteActionsSection.tsx:42` | `button`: header-btn git-menu-action | Migrated to Button |
| `components/git/GitRemoteActionsSection.tsx:53` | `button`: header-btn git-menu-action | Migrated to Button |
| `components/git/GitRemoteActionsSection.tsx:64` | `button`: header-btn git-menu-action | Migrated to Button |
| `components/git/GitRemotesSection.tsx:54` | `input`: git-remotes-input | Migrated to Input |
| `components/git/GitRemotesSection.tsx:109` | `button`: git-remotes-empty-add-btn | Migrated to Button |
| `components/git/GitRemotesSection.tsx:124` | `button`: git-remote-action-btn | Migrated to IconButton |
| `components/git/GitRemotesSection.tsx:127` | `button`: git-remote-action-btn git-remote-action-btn-danger | Migrated to IconButton |
| `components/git/GitRemotesSection.tsx:343` | `button`: git-remotes-add-btn | Migrated to IconButton |
| `components/git/GitRemotesSection.tsx:353` | `button`: git-remotes-cancel-btn | Migrated to IconButton |
| `components/git/GitRemotesSection.tsx:396` | `button`: git-remotes-suggestion | Remote name suggestion pill; bounded quick-choice composition, not a submit/action variant. |
| `components/git/GitRemotesSection.tsx:411` | `input`: git-remotes-input | Migrated to Input |
| `components/git/GitRemotesSection.tsx:439` | `button`: git-remotes-submit-btn | Migrated to Button |
| `components/git/GitRemotesSection.tsx:485` | `button`: git-remotes-submit-btn | Migrated to Button |
| `components/git/GitStashSection.tsx:44` | `input`: git-stash-input | Migrated to Input |
| `components/git/GitStashSection.tsx:52` | `input`: checkbox | Native checkbox semantics; checked state and label association remain native. |
| `components/git/GitStashSection.tsx:60` | `button`: header-btn git-create-branch-submit | Migrated to Button |
| `components/git/GitStashSection.tsx:74` | `button`: git-stash-clear | Migrated to Button |
| `components/git/GitStashSection.tsx:98` | `button`: git-branch-action | Migrated to Button |
| `components/git/GitStashSection.tsx:106` | `button`: git-branch-action | Migrated to Button |
| `components/git/GitStashSection.tsx:114` | `button`: git-branch-action danger | Migrated to Button |
| `components/git/ProviderBadge.tsx:66` | `button`: provider-badge create-pr-badge | Product VCS status badge/PR link with provider and PR state geometry. |
| `components/git/ProviderBadge.tsx:84` | `button`: provider-badge create-pr-badge | Product VCS status badge/PR link with provider and PR state geometry. |
| `components/git/ProviderBadge.tsx:102` | `button`: provider-badge pr-badge  | Product VCS status badge/PR link with provider and PR state geometry. |
| `components/git/ProviderMenu.tsx:98` | `button`: provider-menu-trigger | Migrated to Button |
| `components/git/ProviderMenu.tsx:123` | `button`: provider-menu-refresh | Migrated to IconButton |
| `components/git/ProviderMenu.tsx:144` | `button`: provider-menu-link | Provider deep-link menu row driven by the existing menu item model and link icons. |
| `components/settings/AppearanceSettings.tsx:15` | `select`: settings-select | Migrated to Select |
| `components/settings/CredentialSettings.tsx:258` | `button`: credential-tab  | Credentials SSH/token tab selector with active panel state. |
| `components/settings/CredentialSettings.tsx:266` | `button`: credential-tab  | Credentials SSH/token tab selector with active panel state. |
| `components/settings/CredentialSettings.tsx:310` | `button`: credential-copy-btn | Migrated to Button |
| `components/settings/CredentialSettings.tsx:348` | `button`: credential-generate-btn | Migrated to Button |
| `components/settings/CredentialSettings.tsx:367` | `button`: credential-delete-btn | Migrated to Button |
| `components/settings/CredentialSettings.tsx:414` | `input`: credential-token-input | Migrated to Input |
| `components/settings/CredentialSettings.tsx:427` | `button`: credential-token-save-btn | Migrated to Button |
| `components/settings/CredentialSettings.tsx:436` | `button`: credential-token-cancel-btn | Migrated to Button |
| `components/settings/CredentialSettings.tsx:459` | `button`: credential-token-remove-btn | Migrated to Button |
| `components/settings/CredentialSettings.tsx:469` | `button`: credential-token-add-btn | Migrated to Button |
| `components/settings/HarnessDefaultsSection.tsx:64` | `input`: checkbox | Native checkbox semantics; checked state and label association remain native. |
| `components/settings/HarnessDefaultsSection.tsx:71` | `button`: harness-defaults-header  | Expandable harness settings group row with icon and disclosure chevron. |
| `components/settings/HarnessDefaultsSection.tsx:107` | `input`: checkbox | Native checkbox semantics; checked state and label association remain native. |
| `components/settings/HarnessDefaultsSection.tsx:121` | `input`: settings-select | Migrated to Input |
| `components/settings/HarnessDefaultsSection.tsx:133` | `input`: settings-select | Migrated to Input |
| `components/settings/HarnessDefaultsSection.tsx:144` | `input`: settings-select | Migrated to Input |
| `components/settings/HarnessDefaultsSection.tsx:153` | `select`: settings-select | Migrated to Select |
| `components/settings/HarnessDefaultsSection.tsx:178` | `button`: button | Migrated to Button |
| `components/settings/HarnessDefaultsSection.tsx:186` | `button`: button | Migrated to Button |
| `components/settings/HarnessDefaultsSection.tsx:219` | `button`: harness-defaults-remove-fav | Migrated to IconButton |
| `components/settings/HarnessDefaultsSection.tsx:234` | `button`: harness-defaults-add-fav | Migrated to Button |
| `components/ui/Button.tsx:11` | `button`: clanker-button  | Shared primitive implementation: canonical native element behind the public control API. |
| `components/ui/Input.tsx:22` | `input`: clanker-input  | Shared primitive implementation: canonical native element behind the public control API. |
| `components/ui/SearchablePicker.tsx:91` | `input`: text | Migrated to Input |
| `components/ui/SearchablePicker.tsx:100` | `button`: searchable-picker-choice | Shared composite picker choice row; selection state and labels belong to the picker, while search/favorites use Input/IconButton. |
| `components/ui/SearchablePicker.tsx:107` | `button`: searchable-picker-star | Migrated to IconButton |
| `components/ui/Select.tsx:19` | `select`: clanker-select  | Shared primitive implementation: canonical native element behind the public control API. |
| `components/ui/Textarea.tsx:19` | `textarea`: clanker-textarea  | Shared primitive implementation: canonical native element behind the public control API. |
