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

## Persistence

Settings are stored locally via `electron-store`:
- Last workspace path
- Fastfetch preference
- AI commit configuration

## Environment

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | `development` or `production` |
