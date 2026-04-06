# Git Integration Feature Report

## Overview

This document outlines the implementation plan for adding a simple git integration feature to Clanker Grid with:
1. A git button displaying the count of modified files
2. A commit dialog with a message input box

**Scope:** This is a lightweight **local git** integration—not a full git UI and **NOT a GitHub integration**. It provides quick visibility into workspace changes and a simple way to create local commits. No GitHub API, authentication, push/pull, or remote operations are included.

### What's Included (Local Git Only)
- ✅ View count of modified/staged/untracked files
- ✅ Stage files for commit
- ✅ Create local commits with a message

### What's NOT Included
- ❌ GitHub/GitLab/Bitbucket authentication
- ❌ Push/Pull to remote repositories
- ❌ Pull Requests / Merge Requests
- ❌ Issues, PR comments, or any GitHub API features
- ❌ Repository browsing or remote sync

---

## Architecture

### Design Principles

The git integration follows a **service-oriented architecture** where:
1. **Main Process** acts as the "Git Service" - handles all git operations and polling
2. **Renderer** only displays state - receives updates via IPC events
3. This pattern makes it easy to add GitHub API or other providers later

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        Main Process                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                     GitService                            │   │
│  │  - getStatus()      - commit()                          │   │
│  │  - stage()          - isRepo()                          │   │
│  │  - startPolling()   - stopPolling()                     │   │
│  │  - refresh()        - emitStatusUpdate()                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│         IPC Events: 'git-status-update'                        │
│                              │                                   │
└──────────────────────────────┼───────────────────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │     Preload         │
                    │   contextBridge     │
                    └──────────┬──────────┘
                               │
┌──────────────────────────────┼───────────────────────────────────┐
│                        Renderer                                  │
│                              │                                   │
│  ┌──────────────────────────┴──────────────────────────────┐   │
│  │                      GitButton                            │   │
│  │  - Subscribes to status updates (no polling!)          │   │
│  │  - Displays change count badge                          │   │
│  │  - Opens CommitDialog on click                          │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### Benefits of This Architecture

1. **No UI flickering** - Backend handles polling, no direct fetches from renderer
2. **Single source of truth** - GitService maintains workspace context
3. **Easy to extend** - Can add GitHub API as a separate provider class
4. **Clean separation** - Renderer doesn't need to know about git internals
5. **Event-driven** - Status updates flow automatically to all listeners

---

## Implementation Details

### GitService Class (Main Process)

```typescript
class GitService {
  private pollingInterval: NodeJS.Timeout | null = null;
  private currentWorkspacePath: string | null = null;
  private pollIntervalMs = 30000; // 30 seconds

  async getStatus(workspacePath: string): Promise<GitStatusResult>
  async stage(workspacePath: string, files?: string[]): Promise<...>
  async commit(workspacePath: string, message: string): Promise<...>
  async isRepo(workspacePath: string): Promise<boolean>

  startPolling(workspacePath: string): void  // Emits events to renderer
  stopPolling(): void
  async refresh(): Promise<GitStatusResult | null>
  private async emitStatusUpdate(workspacePath: string): void
}
```

### IPC Methods

| Method | Direction | Purpose |
|--------|-----------|---------|
| `gitStartPolling` | Renderer → Main | Start polling for workspace |
| `gitStopPolling` | Renderer → Main | Stop polling |
| `gitGetStatus` | Renderer → Main | Get current status (one-time) |
| `gitStage` | Renderer → Main | Stage files |
| `gitCommit` | Renderer → Main | Create commit |
| `gitIsRepo` | Renderer → Main | Check if git repo |
| `gitRefresh` | Renderer → Main | Force status refresh |
| `git-status-update` | Main → Renderer | Event: status changed |

### Future Extension: Adding GitHub API

To add GitHub integration later, you could:

```typescript
// Create a GitProvider interface
interface GitProvider {
  getStatus(): Promise<GitStatusResult>;
  commit(message: string): Promise<CommitResult>;
  push(): Promise<PushResult>;
  pull(): Promise<PullResult>;
  getBranches(): Promise<Branch[]>;
  // etc.
}

// Implement providers
class LocalGitProvider implements GitProvider { ... }
class GitHubProvider implements GitProvider { ... }

// GitService becomes a router
class GitService {
  constructor(private provider: GitProvider) { ... }
}
```

---

## File Structure

| File | Status | Description |
|------|--------|-------------|
| `src/main/main.ts` | ✅ Modified | Added GitService class with polling, IPC handlers |
| `src/main/preload.ts` | ✅ Modified | Exposed git methods + onGitStatusUpdate event |
| `src/renderer/electron.d.ts` | ✅ Modified | Type definitions for GitService API |
| `src/renderer/components/GitButton.tsx` | ✅ Modified | Simplified, listens to events only |
| `src/renderer/components/GitButton.css` | ✅ Created | Styles for button badge and commit dialog |
| `src/renderer/components/CommitDialog.tsx` | ✅ Created | Modal with message input, file list, stage/commit |
| `src/renderer/components/Header.tsx` | ✅ Modified | Integrated GitButton component |

---

## Technical Considerations

### 1. Polling Strategy
- Backend polls every 30 seconds via `setInterval`
- Initial status fetched immediately on `startPolling()`
- Status also refreshed after stage/commit operations
- Window focus refresh can be added if needed

### 2. Error Handling
- Not a git repository: Button hidden entirely
- Git not installed: Graceful failure via `gitIsRepo`
- Commit fails: Error shown in dialog
- Network errors (future): Handled by specific provider

### 3. Performance
- Uses `--porcelain` flag for fast status parsing
- Minimal IPC payload (only changed files list)
- Polling isolated to main process

### 4. Security
- All git operations in main process (sandboxed)
- Commit messages sanitized for injection
- Workspace path validated before git commands

---

## Future Enhancements (Out of Scope)

If more git features are needed later, consider:
- **GitHub Provider**: Authenticate with GitHub API, create PRs
- **Branch selector**: Switch between branches
- **Push/Pull buttons**: Sync with remotes
- **Diff viewer**: See changes inline
- **Commit history**: Browse past commits
- **Git stash support**: Temporarily stash changes

---

## Dependencies

No new npm packages required. Git operations use existing Node.js capabilities via `child_process`.

Existing packages used:
- `lucide-react`: Already installed, provides `GitBranch` icon

---

## Testing Checklist

- [ ] Git button appears when workspace is opened (if git repo)
- [ ] Change count badge displays correctly
- [ ] Badge updates automatically (every 30s)
- [ ] Commit dialog opens on button click
- [ ] Stage All stages all changes
- [ ] Commit creates git commit with message
- [ ] Status refreshes after commit
- [ ] Button hidden for non-git directories
- [ ] Polling stops when workspace changes
- [ ] No flickering/loading states in button

---

## Build Status

- ✅ `npm run build:renderer` - Success
- ✅ `npm run build:main` - Success
- ✅ `npm run build` - Success
