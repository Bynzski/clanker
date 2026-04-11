# Configuration

## Settings Menu

Access via header toolbar gear icon or `Ctrl+,`.

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

### VCS Credentials

Manage authentication for remote VCS operations.

#### SSH Keys

SSH keys are generated as ED25519 and stored in `~/.ssh/id_ed25519_clanker`. The public key can be copied to your VCS provider for authentication.

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

Settings are stored locally via `electron-store`:
- Last workspace path
- Fastfetch preference
- AI commit configuration

Credentials are stored separately with encryption:
- SSH keys in `~/.ssh/id_ed25519_clanker`
- PATs encrypted via Electron's `safeStorage` API

## Environment

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | `development` or `production` |
| `SHELL` | User's default shell (fallback: `bash`) |
