# Configuration

## Settings Menu

Access via the header toolbar gear icon.

### Appearance

| Setting | Description | Default |
|---------|-------------|---------|
| Theme | Dark, Light, or Slate, shown as a preview of each theme | Dark |
| Workspaces | **Sidebar** lists workspaces in a collapsible left sidebar and docks the toolbar in the title bar; **Tabs** shows workspace tabs in the title bar and the toolbar on its own row | Sidebar on new installs; installs that predate the sidebar keep Tabs |

Keyboard bindings are edited from **Keyboard shortcuts...** in the same menu; see [Keyboard Shortcuts](keyboard-shortcuts.md#customizing-shortcuts).

### AI Commit

| Setting | Description | Default |
|---------|-------------|---------|
| Enable AI Commit | Generate commit messages with AI | Disabled |
| Provider | AI service (Codex, OpenCode, Pi, Oh My Pi, Antigravity) | Codex |
| Model | Model variant per provider | Varies |

### Harness Defaults

Per-harness global preferences for AI harnesses. Configured in the header settings dropdown under **Harness Defaults**. Launch defaults apply when launching a terminal from that harness's header button; **Show in Usage** controls the Usage popover.

Each harness (Codex, OpenCode, Pi, Oh My Pi, Claude, Hermes, Antigravity) has its own settings:

| Setting | Description | Default |
|---------|-------------|---------|
| Visible | Whether this harness appears in launch surfaces | Enabled |
| Extra Flags | Free-text CLI flags (e.g., `--yolo`, `--dangerously-skip-permissions`) | Empty |
| Default Model | Model ID pre-selected when launching with this harness | Empty (harness picks) |
| Favorites | Pinned model IDs shown in the compact model picker | Empty |
| Agent attention | Show supported harness turn and input status on new panes | Disabled |
| Clanker bridge (MCP) | Local authenticated workspace context for Claude, Codex, OpenCode and Pi; eligible providers also offer checkout lifecycle tools with attention enabled | Disabled |
| Show in Usage | Include a supported harness in the Usage popover and its usage requests | Enabled |

**Show in Usage** is available for Codex, Claude, Oh My Pi, Hermes, and Antigravity. It is independent of **Visible**: hiding a launch button does not hide its usage row. Disabling **Show in Usage** removes that provider from usage reads, polling, and manual refresh. See [Subscription usage](terminals.md#subscription-usage).

Hermes discovers provider-aware models from the local Hermes TUI gateway when its standard Python installation is available. Model IDs appear before their providers so subscription variants stay distinguishable. Choose a provider/model in the default picker, or enter a custom model ID; leaving the field empty uses Hermes's own default. Favorites are available in the model picker in Settings. The initial list may be served from Hermes's cache: use **Refresh Hermes models** in Settings to query live connector catalogs. If discovery is unavailable, the manual model field remains usable. Agent attention supports SSH Hermes launches through a host observer plugin; local Hermes attention remains unavailable. Hermes is not an AI commit provider.

Antigravity discovers available models via `agy models`. The model list supports Gemini and Claude variants. Extra flags accept `--dangerously-skip-permissions`, `--effort <level>`, and `--mode <mode>`. Agent attention is supported via native plugin hooks, reporting running, needs input, and turn complete statuses. Antigravity can be selected as an AI commit provider in settings, generating commit messages via piped prompt execution.

#### Managing Harness Defaults

1. Open the settings dropdown from the gear icon
2. Scroll to the **Harness Defaults** section
3. Click a harness row to expand its settings
4. Toggle visibility, agent attention, or **Show in Usage** where supported; edit extra flags text, set a default model, or manage favorites

All changes persist immediately to `electron-store`.

#### Visibility Behavior

- Harnesses are visible by default.
- Hidden harnesses are removed from the Header harness list.
- Hiding a harness does not disable it. Previous chats can still be resumed when the harness command is installed and available.

#### Flags Behavior

- Flags are entered as free text and passed through as-is.
- Placeholders show common examples (`--yolo` for Codex, `--dangerously-skip-permissions` for Claude).
- There is no per-harness boolean toggle UI.
- For Hermes, `--yolo` also sets the TUI backend's process-level approval bypass for the launched session.

#### Default Model Resolution

When spawning a terminal with a harness:

1. **Explicit launch model** — used by an explicit runtime launch, such as a Recipe
2. **Harness default model** — used when no launch model was selected
3. **Harness choice** — if neither is set, the CLI chooses its own model

Plain shells have no model and do not inherit a harness from global defaults.

Favorites are **never** used at spawn time — they only affect the picker/discovery UI.

For SSH workspaces in V1, harness availability is discovered on the host. Extra flags still apply. A locally saved default model is never applied; Header launchers use the remote CLI's own model configuration. Agent attention uses host-side adapters when enabled in harness defaults; see [Remote Agent Attention](workspaces.md#remote-agent-attention) for setup and limits. Locally installed CLIs and desktop attention credentials are not used for remote launches. See [SSH Workspaces](workspaces.md#remote-workspaces-ssh).

### Managed accounts and Hermes Assistants

Codex and Claude can use manually selected managed accounts under **Harness Defaults**. Selection affects future local launches; resume/fork use the account owning the conversation, and there is no automatic fallback. The native/default account remains available without an app-managed home. Managed accounts are unavailable for SSH workspaces.

**Hermes Assistants** is a separate optional setting, hidden when the Hermes CLI is missing. Enable it to connect named profiles to their persistent Bot Chat; **Start Hermes service when needed** permits Clanker to start and stop only its own backend. This does not change the ordinary Hermes launcher. See [Hermes Assistants](terminals.md#hermes-assistants).

### VCS Credentials

Manage authentication for remote VCS operations.

#### SSH Keys

SSH keys are generated as ED25519 and stored in:

- **Linux / macOS:** `~/.ssh/id_ed25519_clanker`
- **Windows:** `%USERPROFILE%\.ssh\id_ed25519_clanker`

On Windows, key file permissions rely on inherited NTFS ACLs under `%USERPROFILE%\.ssh` rather than POSIX `chmod`. See [Windows Notes](windows.md#ssh-key-permissions).

The public key can be copied to your VCS provider for authentication.

#### SSH Host Configuration

The app can automatically configure your SSH config to use the generated key for specific hosts (e.g., `github.com`, `gitlab.com`, `bitbucket.org`).

#### Key Actions

| Action | Description |
|--------|-------------|
| Generate SSH Key | Create ED25519 key pair for VCS authentication |
| Copy Public Key | Copy public key to clipboard for provider setup |
| Delete SSH Key | Remove generated key pair |

#### Access Tokens

| Provider | Description |
|----------|-------------|
| GitHub | Fine-grained PAT with selected-repository Metadata, Pull requests, Checks and Commit statuses read access; classic private-repository PATs typically use `repo` |
| GitLab | Personal Access Token with `read_api` scope |
| Bitbucket | Bearer OAuth/repository/project/workspace access token with appropriate repository/pull-request/pipeline read permissions; not retired app passwords or email+API-token Basic auth |

Saving/decrypting a token, validating identity, and accessing a repository/CI/reviews are separate facts. Declared scopes are metadata, not verified permissions. A repository-scoped Bitbucket token may lack `/user` access while repository reads work.

Self-managed GitLab has main-only exact HTTPS-origin approval and separately encrypted host-bound tokens; ordinary provider settings still manage only SaaS tokens. There is no instance-enrollment UI or renderer approval IPC in this backend phase. SaaS credentials never fall back to another host. See [VCS providers](vcs-providers.md#credentials-and-approved-self-managed-gitlab) for the trusted-main interfaces, origin/port policy and limitations.

## Persistence

Settings are stored locally via `electron-store` (`clanker-grid.json`):
- Starting-directory preferences for workspace opening (the open workspace set/order/active identity is kept separately in renderer localStorage)
- Theme, workspace navigation mode (Sidebar or Tabs), and sidebar width
- Base directory for workspace suggestions
- AI commit configuration
- Harness defaults (visibility, model, favorites, flags, attention, bridge opt-in and usage visibility)
- Main-owned managed-account metadata/selections and optional Hermes Assistant settings
- Saved SSH environment labels and targets (no passwords or private keys)
- Keyboard shortcut overrides (only bindings you changed)

The store schema is defined in `src/shared/types/store.ts`.

Credentials are stored separately from app settings:
- SSH keys in `~/.ssh/id_ed25519_clanker` (Linux/macOS) or `%USERPROFILE%\.ssh\id_ed25519_clanker` (Windows)
- PATs are encrypted with Electron's `safeStorage`. Saving a new PAT fails when OS-backed encryption is unavailable.

## Migration

On first launch after upgrade, the app automatically migrates legacy `localStorage` favorites to `electron-store`. This is a one-time, non-fatal migration:

- **Legacy key:** `clanker-grid-model-favorites` (localStorage)
- **Completion marker:** `clanker-grid-migration-harness-defaults` (localStorage)
- **Merge order:** Existing store favorites preserved first, legacy-only favorites appended in order
- **Failure:** Non-fatal, retried on next launch

## Environment

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | `development` or `production` |
| `SHELL` | User's shell on Linux/macOS (fallback: `bash`); Windows uses `powershell.exe` |
| `CLANKER_GRID_WATCHER_POLLING` | Set to `1` to force polling-based file watching (auto-enabled for UNC paths on Windows). |
