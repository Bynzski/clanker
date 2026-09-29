# Git Integration

Built-in git tools for common operations without leaving the app.

## Git Menu

Click the **Git** button in the header to access:
- Status summary (with change count)
- Branch operations
- Merge tools
- Stash management
- Commit history
- Remote operations

## File Explorer Git Integration

The file explorer shows git status indicators:
- Modified files display with an indicator
- Untracked files are visually distinguished
- Local Git changes are reflected via local file watching. SSH workspaces have no remote file watcher in V1; remote Explorer contents refresh after Clanker-managed mutations and on desktop focus while the active workspace's Explorer is visible.

## Status

Current status shows:
- Current branch
- Unstaged changes
- Staged changes
- Merge/rebase state
- Ahead/behind upstream tracking

## Branching

From the Git menu → **Branches**:
- View current branch
- Switch branches
- Create new branch
- Delete branch

## Stashing

**Stashes** section provides:
- List stashes with descriptions
- Create stash
- Apply, pop, or drop stashes
- Clear all stashes

## Merging

**Merge** section:
- Select target branch
- Initiate merge
- Abort in-progress merge
- Status indicators for conflicts

## Remote Operations

Access via the Git menu header:
- **Fetch** — Download refs from remote
- **Pull** — Fetch and merge (supports rebase)
- **Push** — Upload local commits to remote

Remote operations use Git and configured remotes; they do not require provider API integration. Pull and Push require an upstream branch. If the current branch has no upstream, **Publish branch** is available when a remote exists.

For an SSH workspace, Clanker runs Git on the workspace host over SSH in the registered remote repository. Git authentication and remotes for that repository use the remote host's configuration. The desktop never treats a same-path local checkout as the remote repository.

## Remotes

The **Remotes** section allows you to manage git remote connections:

- **View remotes** — See all configured remotes with their URLs
- **Add remote** — Connect to a new remote repository (SSH or HTTPS URLs)
- **Rename remote** — Change the name of an existing remote
- **Remove remote** — Disconnect a remote

### Adding a Remote

1. Open the Git menu
2. Click the **+** button in the Remotes section
3. Enter a name (e.g., `origin`, `upstream`)
4. Enter the remote URL:
   - SSH: `git@github.com:owner/repo.git`
   - HTTPS: `https://github.com/owner/repo.git`
5. Click **Add Remote**

### Workflow Example: Connect to GitHub

1. Create a new repository on GitHub (github.com)
2. Copy the remote URL from GitHub
3. In Clanker Grid, open the Git menu → Remotes
4. Click **Add remote**, name it `origin`, paste the URL
5. The selected repository is now connected to the GitHub remote; for an SSH workspace, that configuration is stored in the remote repository

## Committing

### Commit Dialog

1. Open Git menu → **Commit**
2. Stage files (individual or all)
3. Enter commit message
4. Click **Commit**

### AI Commit Messages

Optional AI-assisted commit messages:

1. Enable in **Settings** → **AI Commit**
2. Select provider (Codex, OpenCode, or Pi)
3. Select model
4. In commit dialog, click **Generate Message**

The AI analyzes your changes and generates a commit message.

AI commit message generation is unavailable for SSH workspaces in V1. Manual staging and commits run on the remote host.

## History

View commit history with:
- Commit hash
- Author
- Date
- Message
- Diff summary for each commit

## VCS Provider Integration

Clanker Grid integrates with remote VCS providers to surface context about your repository.

### Supported Providers

- **GitHub** — PRs, checks status, reviews
- **GitLab** — Merge requests, pipelines, approvals
- **Bitbucket** — Pull requests, pipeline status, participants

Provider detection is automatic based on your git remote URL.

### Provider Context

When connected to a VCS provider, the Git menu displays:
- **PR/MR Badge** — Shows current PR number, title, and state
- **Status Indicators** — CI/CD status (pending, success, failure)
- **Review State** — Approval status when available

### Quick Navigation

Access provider links via the dropdown menu:
- Repository
- Pull/Merge Request
- Create Pull/Merge Request
- Branches
- Issues
- Releases
- Actions/Pipelines

Links open in your default browser.

## Credential Management

Configure authentication for remote operations:

### SSH Keys

1. Open **Settings** → **Credentials**
2. Click **Generate SSH Key**
3. Copy the public key
4. Add to your VCS provider (Settings → SSH Keys)

### Personal Access Tokens

1. Open **Settings** → **Credentials** → **Access Tokens**
2. Select provider (GitHub, GitLab, Bitbucket)
3. Enter your token
4. Click **Save**

New tokens are encrypted with Electron's `safeStorage`; saving fails when OS-backed encryption is unavailable. See [Configuration](configuration.md#persistence).

For Git commands in an SSH workspace, authentication happens on the remote host using that host's SSH keys or Git credential helpers. Keys generated on the desktop are not copied to the remote host automatically. Desktop PATs are used for provider API context, not to configure remote Git authentication.

### Credential Status

The Git menu shows credential status for your remote:
- SSH key configured ✓
- PAT stored ✓
- Git credential helper status
