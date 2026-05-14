# Configuration

## Settings Menu

Access via the header toolbar gear icon.

### General

| Setting | Description | Default |
|---------|-------------|---------|
| Fastfetch Suppress | Hide fastfetch on launch | Enabled |

### AI Commit

| Setting | Description | Default |
|---------|-------------|---------|
| Enable AI Commit | Generate commit messages with AI | Disabled |
| Provider | AI service (Codex, OpenCode, Pi) | Codex |
| Model | Model variant per provider | Varies |

### Harness Defaults

Per-harness global defaults for AI harnesses. Configured in the header settings dropdown under **Harness Defaults**. These apply when spawning new terminals with a harness selected.

Each harness (Codex, OpenCode, Pi, Claude) has its own settings:

| Setting | Description | Default |
|---------|-------------|---------|
| Extra Flags | Free-text CLI flags (e.g., `--yolo`, `--dangerously-skip-permissions`) | Empty |
| Default Model | Model ID pre-selected when launching with this harness | Empty (harness picks) |
| Favorites | Pinned model IDs shown in the compact model picker | Empty |

#### Managing Harness Defaults

1. Open the settings dropdown from the gear icon
2. Scroll to the **Harness Defaults** section
3. Click a harness row to expand its settings
4. Edit extra flags text, set a default model, or manage favorites

All changes persist immediately to `electron-store`.

#### Flags Behavior

- Flags are entered as free text and passed through as-is.
- Placeholders show common examples (`--yolo` for Codex, `--dangerously-skip-permissions` for Claude).
- There is no per-harness boolean toggle UI.

#### Default Model Resolution

When spawning a terminal with a harness:

1. **Workspace harness + model** — highest priority, set per-workspace in the gate or header
2. **Plain shell** — if no workspace harness is set, no harness is inferred from global defaults

Favorites are **never** used at spawn time — they only affect the picker/discovery UI.

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

#### SSH Keys

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
- Fastfetch preference
- AI commit configuration
- Harness defaults (per-harness model, favorites, flags)

The store schema is defined in `src/shared/types/store.ts`.

Credentials are stored separately with encryption:
- SSH keys in `~/.ssh/id_ed25519_clanker` (Linux/macOS) or `%USERPROFILE%\.ssh\id_ed25519_clanker` (Windows)
- PATs encrypted via Electron's `safeStorage` API (DPAPI on Windows, libsecret/Keychain on Linux/macOS)

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
| `SHELL` | User's default shell (fallback: `bash` on Linux/macOS, `powershell.exe` on Windows) |
| `CLANKER_GRID_WATCHER_POLLING` | Set to `1` to force polling-based file watching (auto-enabled for UNC paths on Windows). |
