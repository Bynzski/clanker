# Configuration

## Settings Menu

Access via the header toolbar gear icon.

### AI Commit

| Setting | Description | Default |
|---------|-------------|---------|
| Enable AI Commit | Generate commit messages with AI | Disabled |
| Provider | AI service (Codex, OpenCode, Pi, Oh My Pi) | Codex |
| Model | Model variant per provider | Varies |

### Harness Defaults

Per-harness global defaults for AI harnesses. Configured in the header settings dropdown under **Harness Defaults**. These apply when launching a terminal from that harness's header button.

Each harness (Codex, OpenCode, Pi, Oh My Pi, Claude, Hermes, Antigravity) has its own settings:

| Setting | Description | Default |
|---------|-------------|---------|
| Visible | Whether this harness appears in launch surfaces | Enabled |
| Extra Flags | Free-text CLI flags (e.g., `--yolo`, `--dangerously-skip-permissions`) | Empty |
| Default Model | Model ID pre-selected when launching with this harness | Empty (harness picks) |
| Favorites | Pinned model IDs shown in the compact model picker | Empty |
| Agent attention | Show supported harness turn and input status on new panes | Disabled |

Hermes discovers provider-aware models from the local Hermes TUI gateway when its standard Python installation is available. Model IDs appear before their providers so subscription variants stay distinguishable. Choose a provider/model in the default picker, or enter a custom model ID; leaving the field empty uses Hermes's own default. Favorites work in the workspace gate. The initial list may be served from Hermes's cache: use **Refresh Hermes models** in settings or the gate to query live connector catalogs. If discovery is unavailable, the manual model field remains usable. Agent attention is unavailable until Hermes lifecycle events are integrated. Hermes is not an AI commit provider.

Antigravity discovers available models via `agy models`. The model list supports Gemini and Claude variants. Extra flags accept `--dangerously-skip-permissions`, `--effort <level>`, and `--mode <mode>`. Agent attention is supported via native plugin hooks, reporting running, needs input, and turn complete statuses. Antigravity can be selected as an AI commit provider in settings, generating commit messages via piped prompt execution.

#### Managing Harness Defaults

1. Open the settings dropdown from the gear icon
2. Scroll to the **Harness Defaults** section
3. Click a harness row to expand its settings
4. Toggle visibility and agent attention, edit extra flags text, set a default model, or manage favorites

All changes persist immediately to `electron-store`.

#### Visibility Behavior

- Harnesses are visible by default.
- Hidden harnesses are removed from the header harness list and workspace gate.
- Hiding a harness does not disable it. Previous chats can still be resumed when the harness command is installed and available.

#### Flags Behavior

- Flags are entered as free text and passed through as-is.
- Placeholders show common examples (`--yolo` for Codex, `--dangerously-skip-permissions` for Claude).
- There is no per-harness boolean toggle UI.
- For Hermes, `--yolo` also sets the TUI backend's process-level approval bypass for the launched session.

#### Default Model Resolution

When spawning a terminal with a harness:

1. **Explicit launch model** — used when selected in the workspace gate or launcher
2. **Harness default model** — used when no launch model was selected
3. **Harness choice** — if neither is set, the CLI chooses its own model

Plain shells have no model and do not inherit a harness from global defaults.

Favorites are **never** used at spawn time — they only affect the picker/discovery UI.

For SSH workspaces in V1, harness availability is discovered on the host. Extra flags still apply, but model discovery and selection and Agent Attention are unavailable; the remote CLI uses its own model configuration. Locally installed CLIs and attention adapters are not used for remote launches. See [SSH Workspaces](workspaces.md#remote-workspaces-ssh).

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
| GitHub | Personal Access Token (PAT) with repo scope |
| GitLab | Personal Access Token with `read_api` scope |
| Bitbucket | App Password with repository access |

## Persistence

Settings are stored locally via `electron-store` (`clanker-grid.json`):
- Last workspace path
- Base directory for workspace suggestions
- AI commit configuration
- Harness defaults (per-harness visibility, model, favorites, flags, agent attention)
- Saved SSH environment labels and targets (no passwords or private keys)

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
