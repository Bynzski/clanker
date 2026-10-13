# Git Integration

Clanker's **Git** toolbar action opens **Source Control**, a persistent management view scoped to the selected authorized checkout, rather than the retired compact Git menu. The eight pages are **Changes** (default), **History**, **Overview**, **Branches**, **Worktrees**, **Stashes**, **Remotes** and **Merge**. Switching agent/checkout closes the prior scoped view safely; reopen Source Control to inspect the new target. Git operations use the registered checkout, not an inferred terminal directory.

## Changes and commits

**Changes** shows the selected checkout's working and staged files, status and any in-progress merge/rebase. Review files in the diff viewer, stage/unstage individual files or whole sections, and compose a message in the same page. **Go to Commit** scrolls and focuses the existing composer; it does not stage or commit. The commit operation uses the explicit staged set, with a deliberate option to stage all when requested; no silent inclusion of unrelated changes. AI-generated messages can be enabled under **Settings → Git Preferences**, and are available only for local workspaces.

Explorer also shows changed and untracked files. Local changes follow file watching; SSH Explorer/editor refresh uses bounded active-checkout polling, and remote transport failure is never treated as a clean repository.

## History

**History** displays commits with full identity, author/date and a selected read-only summary, with bounded **Load More**. Working/Staged comparisons are explicitly labelled and are not staging actions. The History summary and selection belong to the single Source Control content scroller.

## Overview

**Overview** presents the Git status and any available provider PR/MR, CI and review context. Missing provider data, unavailable reads and unknown status are distinct from confirmed absence or success. Source Control fetches page-specific resources when needed, instead of blocking workspace activation on all Git reads.

## Branches

**Branches** lists the selected checkout's current branch and available alternatives. Create and switch actions operate in that checkout; Git may reject branches already checked out elsewhere. Branch identity is fetched from Git status, not from a stale descriptive checkout label. Delete actions are confirmation-guarded.

## Worktrees

Use **New Agent** to launch Terminal or a harness in the project checkout (the default), a new branch/worktree, an available existing branch or a validated linked worktree. A choice alone starts nothing, and launching does not move another process or transfer uncommitted files. Source Control → **Worktrees** can also **Create worktree…** without a session. The old sidebar checkout inventory and MCP-assisted agent relocation are removed.

The **Worktrees** page displays Git-listed linked roots, including occupied, locked and missing entries. **Remove…** refuses unsafe or occupied targets and checks branch, checkout identity, staged/unstaged/untracked/ignored files, active terminals and dev servers. Removal retains the branch and preserves recovery files where applicable; over SSH, protected recovery/journal folders may require subsequent **Refresh worktrees** verification if transport drops. **Unlock…** confirms the Git lock reason. **Prune missing worktrees…** repairs Git's stale registrations, not checkout files or branches. Do not delete linked checkout folders manually while Clanker is using them.

See [Workspaces](workspaces.md#isolated-agents-and-linked-worktrees) for local and SSH recovery boundaries and [Unified session launch](unified-session-launch.md) for current authorization rules.

## Stashes

**Stashes** lists saved work, supports creation, apply/pop/drop and guarded clearing. Mutations validate current Git identity and decline stale stash selections.

## Remotes and sync

**Remotes** lists, adds, renames and removes Git remote URLs. Examples include `git@github.com:owner/repo.git` and `https://github.com/owner/repo.git`. Sync actions **Fetch**, **Pull**, **Push** and **Publish branch** use actual Git configuration for the selected checkout. Pull/Push require the appropriate upstream; Publish is explicit when absent. A successful remote command followed by a failed UI refresh remains a successful remote operation with stale presentation, not an invitation to retry the push automatically.

SSH Git runs on the configured host and uses its own keys, credential helpers and remotes. Clanker's desktop provider PATs do not configure remote Git authentication.

## Merge

**Merge** allows choosing a supported target branch, starting a merge and handling/aborting conflicts with confirmation and native Git status. In-progress operations and checkout identity are validated rather than inferred.

## VCS Provider Integration

Clanker Grid integrates with remote VCS providers to surface context about your repository.

### Supported Providers

- **GitHub** — PRs, checks status, reviews
- **GitLab** — Merge requests, pipelines, approvals
- **Bitbucket** — Pull requests, pipeline status, participants

Provider detection uses exact hosted origins or explicitly main-approved self-managed GitLab origins, not hostname substrings. Provider context selects the actual registered focused checkout, HEAD and upstream remote; it is not always the first remote or workspace's main checkout. Git operations retain their existing local/SSH execution and credentials.

### Provider Context

When connected to a VCS provider, the Source Control overview and provider controls can display:
- **PR/MR Badge** — Shows current PR number, title, and state
- **Status Indicators** — CI/CD status (pending, success, failure)
- **Review State** — Approval status when available

The backend distinguishes confirmed no PR, empty checks/reviews and unavailable/auth/permission/rate-limit/stale results. Unknown discovery must not become Create PR, and unavailable or incomplete status must not become green/approved. Rich presentation of the new outcomes remains deferred; no new provider UI is added. Observed checks and reviews are not merge-eligibility guarantees. See [VCS providers](vcs-providers.md) for API contracts, bounded transport/cache, checkout races and manual smoke checks.

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

Configure authentication for remote operations in **Settings → Authentication**:

### SSH Keys

1. Open **Settings → Authentication**
2. Click **Generate SSH Key**
3. Copy the public key
4. Add the public key to your VCS provider

### Personal Access Tokens

1. Open **Settings → Authentication → Access Tokens**
2. Select provider (GitHub, GitLab, Bitbucket)
3. Enter your token
4. Click **Save**

New tokens are encrypted with Electron's `safeStorage`; saving fails when OS-backed encryption is unavailable. See [Configuration](configuration.md#persistence).

For Git commands in an SSH workspace, authentication happens on the remote host using that host's SSH keys or Git credential helpers. Keys generated on the desktop are not copied to the remote host automatically. Desktop PATs are used for provider API context, not to configure remote Git authentication.

### Credential Status

Source Control can show credential context for your remote:
- SSH key configured ✓
- PAT stored ✓
- Git credential helper status
