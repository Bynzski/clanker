# Git Integration Extended Feature Report

## Local Git Operations: Branching, Merging, Stashing, and Beyond

**Date:** 2026-04-07  
**Status:** Research & Planning Document  
**Scope:** Local Git Operations (no remote integration yet)  
**Future Extensibility:** Designed for GitHub/GitLab/Bitbucket integration without rewrite

---

## Executive Summary

This document outlines the research and planning for extending the current Git integration in Clanker Grid beyond the existing commit functionality to support:

1. **Branching Operations** - List, create, switch, delete branches
2. **Merge Operations** - Merge branches, handle conflicts
3. **Stash Operations** - Stash, list stashes, apply/pop/drop stashes
4. **Additional Operations** - Log, diff, reset, clean, tag

**Key Design Principles:**
- Extensible architecture that won't require rewrite for remote operations
- Minimal UI footprint with context menus and popovers
- All operations execute in the main process via `git` CLI
- Event-driven updates to the UI

---

## Implementation Scope

The current implementation stays close to the app style while expanding the git experience into a compact local-git hub.

### Implemented Now

- Local commit flow remains in place
- Git button opens a compact popover instead of a large dashboard
- Current branch is shown in the popover
- Branch create, switch, and delete are supported
- Stash save, list, apply, pop, drop, and clear are supported
- Merge state is detected and can be aborted
- Recent history is visible with a lightweight diff viewer
- Branch, stash, merge, and history state are pulled from the main process
- The existing commit dialog remains the commit workflow

### Explicitly Out of Scope For This Pass

- Force branch delete
- Reset, clean, and tag management
- Push, pull, fetch, and remote provider integrations
- Pull request creation or review flows
- Full conflict editor or automated conflict resolution

### Remaining Proposal

The next implementation pass should focus on remote-ready structure:

1. Add a small provider seam that can support GitHub/GitLab later without forcing remote behavior into the local flow
2. Decide whether PR actions should be a separate remote-integration surface or a lightweight branch-context action
3. Add only the remote actions that are genuinely needed after local workflows are stable

That keeps the app feature-rich while still grounded in a local-first workflow.

The sections below are the original planning notes and are now historical reference unless they are consistent with the implementation scope above.

---

## Current State Analysis

### What's Implemented (v1.0)

| Feature | Status | Location |
|---------|--------|----------|
| Git status polling | ✅ Complete | `GitService` class in `main.ts` |
| Commit dialog | ✅ Complete | `CommitDialog.tsx` |
| Stage/unstage | ✅ Complete | `GitService.stage()` |
| Status badge | ✅ Complete | `GitButton.tsx` |

### Current GitService Methods

```typescript
class GitService {
  // Status & Polling
  getStatus(workspacePath: string): Promise<GitStatusResult>
  startPolling(workspacePath: string): void
  stopPolling(): void
  refresh(): Promise<GitStatusResult | null>
  
  // Commit Operations
  stage(workspacePath: string, files?: string[]): Promise<StageResult>
  commit(workspacePath: string, message: string): Promise<CommitResult>
  isRepo(workspacePath: string): Promise<boolean>
}
```

### Gaps Identified

| Category | Missing Operations |
|----------|-------------------|
| **Branching** | `git branch`, `git checkout`, `git switch`, `git branch -d` |
| **Merging** | `git merge`, conflict detection, conflict resolution |
| **Stashing** | `git stash`, `git stash list`, `git stash pop`, `git stash apply`, `git stash drop` |
| **History** | `git log`, `git diff`, `git show` |
| **Reset** | `git reset`, `git clean` |
| **Tags** | `git tag`, `git tag -d` |

---

## Architecture Design

### Design Philosophy

```
┌─────────────────────────────────────────────────────────────────┐
│                     GitService (Main Process)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              GitOperationExecutor                         │    │
│  │  - execGit(args): Promise<GitResult>                    │    │
│  │  - parseOutput(format): ParsedResult                    │    │
│  │  - Error handling & sanitization                        │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐  │
│  │ BranchOps    │ MergeOps     │ StashOps     │ HistoryOps   │  │
│  │ - list()     │ - merge()    │ - save()     │ - log()      │  │
│  │ - create()   │ - abort()    │ - list()     │ - diff()     │  │
│  │ - switch()    │ - continue() | - apply()    │ - show()     │  │
│  │ - delete()   │ - status()   │ - pop()      │              │  │
│  └──────────────┴──────────────┴──────────────┴──────────────┘  │
│                              │                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              GitProvider Interface (Future)              │    │
│  │  - Used by: LocalGit, GitHubProvider, GitLabProvider    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Future-Proof Interface Design

The key to avoiding a rewrite is defining a `GitProvider` interface that both local git and remote providers can implement:

```typescript
// Future extensibility point - implemented by LocalGitProvider and RemoteGitProvider
interface GitProvider {
  // Core operations
  getStatus(): Promise<GitStatusResult>;
  getBranches(): Promise<Branch[]>;
  getCurrentBranch(): Promise<string>;
  
  // Branch operations
  createBranch(name: string, baseBranch?: string): Promise<BranchResult>;
  switchBranch(name: string): Promise<SwitchResult>;
  deleteBranch(name: string, force?: boolean): Promise<DeleteResult>;
  
  // Merge operations  
  merge(branch: string, message?: string): Promise<MergeResult>;
  abortMerge(): Promise<AbortResult>;
  getMergeStatus(): Promise<MergeStatus>;
  
  // Stash operations
  stash(message?: string): Promise<StashResult>;
  listStashes(): Promise<Stash[]>;
  applyStash(index: number): Promise<ApplyResult>;
  popStash(index: number): Promise<PopResult>;
  dropStash(index: number): Promise<DropResult>;
  
  // History operations
  getLog(limit?: number): Promise<Commit[]>;
  diff(branch?: string): Promise<DiffResult>;
  show(ref: string): Promise<ShowResult>;
  
  // Remote operations (future)
  push(options?: PushOptions): Promise<PushResult>;
  pull(options?: PullOptions): Promise<PullResult>;
  fetch(options?: FetchOptions): Promise<FetchResult>;
}

// Local git implementation uses git CLI
class LocalGitProvider implements GitProvider { ... }

// Future: GitHub API implementation
class GitHubProvider implements GitProvider { ... }
```

---

## Implementation Plan

### Phase 1: Branching Operations

#### UI Components (Minimal Footprint)

```
GitButton (header icon)
├── Badge (change count)
└── Popover Menu (on click)
    ├── Current Branch: main
    ├── ─────────────────
    ├── 📋 Switch Branch...
    ├── 🔀 Create Branch...
    ├── 🗑️ Delete Branch...
    ├── ─────────────────
    ├── ✅ Commit (existing)
    └── ⚙️ Git Settings
```

#### Component Design

**Branch Popover** - A compact popover from the GitButton showing:
- Current branch name (prominent)
- Quick switch dropdown
- Create branch input
- Delete branch (with confirmation)

#### Methods to Implement

| Method | Git Command | Purpose |
|--------|-------------|---------|
| `getBranches()` | `git branch -a --format="..."` | List all branches |
| `getCurrentBranch()` | `git rev-parse --abbrev-ref HEAD` | Get current branch name |
| `createBranch(name, base?)` | `git checkout -b name [base]` | Create and switch |
| `switchBranch(name)` | `git checkout name` or `git switch name` | Switch branches |
| `deleteBranch(name, force)` | `git branch -d name` or `git branch -D name` | Delete branch |

#### Implementation Notes

- Use `git switch` when available (Git 2.23+), fallback to `git checkout`
- Parse branch output with `--format` for machine-readable output
- Track HEAD state to update UI immediately after branch operations

---

### Phase 2: Stash Operations

#### UI Components

```
Stash Section in Branch Popover
├── 💾 Stash Changes (with optional message)
├── ─────────────────────────
├── 📋 Stash List (if any exist)
│   ├── stash@{0}: WIP on main: abc123 "commit message"
│   ├── stash@{1}: WIP on feature: def456 "another stash"
│   └── Apply | Pop | Drop actions per item
└── 🧹 Clean Working Directory (dangerous)
```

#### Methods to Implement

| Method | Git Command | Purpose |
|--------|-------------|---------|
| `stash(message?)` | `git stash push -m "message"` | Save current changes |
| `listStashes()` | `git stash list --format="..."` | List all stashes |
| `applyStash(index)` | `git stash apply stash@{n}` | Apply without removing |
| `popStash(index)` | `git stash pop stash@{n}` | Apply and remove |
| `dropStash(index)` | `git stash drop stash@{n}` | Remove without applying |
| `clearStashes()` | `git stash clear` | Remove all stashes |

#### Implementation Notes

- Stash with message preferred but optional (defaults to "WIP on branch: hash")
- Warn user before `drop` (can't be undone easily)
- Consider `git stash -u` for untracked files option

---

### Phase 3: Merge Operations

#### UI Components

```
Merge Section in Branch Popover
├── 🔀 Merge "feature-branch" into "main"
│   ├── ✅ Fast-forward (if possible)
│   ├── 🔄 Regular merge
│   └── ⚠️ Conflicts (needs resolution)
├── ─────────────────────────
├── 🚫 Abort Merge (if in progress)
└── ✓ Resolve & Continue (after fixing conflicts)
```

#### Merge Status Detection

```typescript
// Check for merge in progress
async isMerging(): Promise<boolean> {
  try {
    await execAsync('git rev-parse --verify MERGE_HEAD', { cwd: this.workspacePath });
    return true;
  } catch {
    return false;
  }
}

// Get conflicting files
async getConflictingFiles(): Promise<string[]> {
  const { stdout } = await execAsync('git diff --name-only --diff-filter=U', 
    { cwd: this.workspacePath });
  return stdout.trim().split('\n').filter(Boolean);
}
```

#### Methods to Implement

| Method | Git Command | Purpose |
|--------|-------------|---------|
| `merge(branch, noFF?)` | `git merge branch` | Merge branch |
| `abortMerge()` | `git merge --abort` | Cancel in-progress merge |
| `getConflictingFiles()` | `git diff --name-only --diff-filter=U` | List conflicts |
| `addResolved(file)` | `git add file` | Mark conflict resolved |

#### Implementation Notes

- Detect fast-forward scenarios and offer as option
- Show conflict count in UI
- "Resolve" just runs `git add` after user edits files
- Don't implement a full conflict editor (user does that in terminal)

---

### Phase 4: Additional Operations

#### Log/Diff Panel (Optional Expansion)

```
Git Log Popover (separate component)
├── 🔍 Filter: [all branches ▼] [author] [since/until]
├── ─────────────────────────
├── a1b2c3d - feat: add user auth
│   Jay Dev - 2 hours ago
│   
├── d4e5f6g - fix: login redirect
│   Jay Dev - yesterday
│   
└── Show Diff | Copy Hash
```

#### Methods for History

| Method | Git Command | Purpose |
|--------|-------------|---------|
| `getLog(limit, options?)` | `git log --format="..." -n limit` | Commit history |
| `diff(ref?, ref?)` | `git diff [ref] [ref]` | Changes between refs |
| `show(ref)` | `git show --stat ref` | Single commit details |
| `reset(mode, ref)` | `git reset [--soft\|--mixed\|--hard]` | Undo commits |
| `clean(options)` | `git clean -fd` | Remove untracked files |

---

## UI Design: Small Footprint Approach

### Design Principles

1. **Single Entry Point** - One Git button, everything else in popovers
2. **Progressive Disclosure** - Show basic info by default, details on demand
3. **Contextual Actions** - Only show relevant options based on state
4. **Terminal Fallback** - Complex operations still accessible via terminal

### Popover Hierarchy

```
GitButton (always visible in repo)
│
└──▶ Branch Popover (default view)
    ├── Current branch indicator
    ├── Change count badge
    ├── Quick actions (stash, commit)
    │
    ├── ▼ Switch Branch (dropdown)
    │   └── Branch list with current highlighted
    │
    ├── + Create Branch
    │   └── Name input + base branch selector
    │
    ├── 🗑️ Delete Branch
    │   └── Confirmation + force option
    │
    ├── 💾 Stash (expandable)
    │   ├── Stash with message
    │   └── Stash list with actions
    │
    ├── 🔀 Merge
    │   └── Target branch selector
    │
    └── 📜 History (expandable)
        ├── Recent commits
        └── Diff view option
```

### Visual States

| State | UI Indicator |
|-------|--------------|
| Clean working dir | Green checkmark or no badge |
| Uncommitted changes | Badge with count |
| Merging | Orange indicator |
| Rebasing | Purple indicator |
| Conflicts | Red warning badge |
| Stashes available | Stash icon with count |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+G` then `c` | Open commit dialog |
| `Ctrl+G` then `b` | Open branch menu |
| `Ctrl+G` then `s` | Stash changes |
| `Ctrl+G` then `m` | Open merge dialog |
| `Ctrl+G` then `l` | Open log viewer |

---

## Technical Implementation Details

### Git CLI Parsing

#### Branch List Parsing

```typescript
async getBranches(): Promise<Branch[]> {
  // Get all branches with current branch highlighted
  const { stdout } = await execAsync(
    'git branch -a --format="%(refname:short)|%(HEAD)|%(upstream:short)"',
    { cwd: this.workspacePath }
  );
  
  return stdout.trim().split('\n').map(line => {
    const [name, current, upstream] = line.split('|');
    return { name, isCurrent: current === '*', upstream: upstream || null };
  });
}
```

#### Stash List Parsing

```typescript
async listStashes(): Promise<Stash[]> {
  const { stdout } = await execAsync(
    'git stash list --format="%H|%gd|%s"',
    { cwd: this.workspacePath }
  );
  
  if (!stdout.trim()) return [];
  
  return stdout.trim().split('\n').map(line => {
    const [hash, ref, message] = line.split('|');
    const match = ref.match(/stash@\{(\d+)\}/);
    return {
      index: match ? parseInt(match[1]) : 0,
      hash,
      message,
    };
  });
}
```

#### Merge Conflict Detection

```typescript
async getMergeStatus(): Promise<MergeStatus> {
  try {
    // Check if MERGE_HEAD exists
    await execAsync('git rev-parse --verify MERGE_HEAD', { cwd: this.workspacePath });
    
    const conflicts = await this.getConflictingFiles();
    
    return {
      inProgress: true,
      isMerge: true,
      conflicts,
      message: conflicts.length > 0 
        ? `${conflicts.length} file(s) with conflicts`
        : 'Merge in progress...'
    };
  } catch {
    // Check for rebase
    try {
      await execAsync('git rev-parse --verify REBASE_HEAD', { cwd: this.workspacePath });
      return { inProgress: true, isRebase: true, conflicts: [], message: 'Rebasing...' };
    } catch {
      return { inProgress: false };
    }
  }
}
```

### Error Handling

| Error Type | User Message | Recovery |
|------------|--------------|----------|
| Not a git repo | (button hidden) | N/A |
| Detached HEAD | "You're not on a branch" | Offer `git checkout` to branch |
| Merge conflict | "Conflicts must be resolved" | Show conflict list |
| Branch not found | "Branch doesn't exist" | Refresh branch list |
| Delete current branch | "Cannot delete current branch" | Switch first |
| Stash failed | "Nothing to stash" | Show clean status |

### Security Considerations

1. **Path Validation** - Ensure workspace path is valid before git operations
2. **Command Injection** - Sanitize all user inputs (branch names, messages)
3. **Process Isolation** - All git operations in main process
4. **Timeout Handling** - Set reasonable timeouts for git commands
5. **Cancellation** - Support cancelling long-running operations

---

## File Structure Changes

### New Files

```
src/
├── main/
│   └── git/
│       ├── GitService.ts          # Main orchestrator (renamed from inline)
│       ├── BranchOperations.ts    # Branch-specific logic
│       ├── MergeOperations.ts     # Merge/rebase logic
│       ├── StashOperations.ts     # Stash management
│       ├── HistoryOperations.ts   # Log/diff/show
│       └── types.ts               # Shared type definitions
└── renderer/
    └── components/
        ├── GitPopover.tsx         # Main git popover container
        ├── BranchSelector.tsx     # Branch list & switch
        ├── CreateBranchDialog.tsx # New branch form
        ├── StashPanel.tsx         # Stash list & actions
        ├── MergeDialog.tsx        # Merge interface
        └── ConflictIndicator.tsx # Conflict status display
```

### Modified Files

| File | Changes |
|------|---------|
| `src/main/main.ts` | Import new GitService, remove inline GitService |
| `src/main/preload.ts` | Add new IPC methods for branches, stash, merge |
| `src/renderer/electron.d.ts` | Add type definitions for new operations |
| `src/renderer/components/GitButton.tsx` | Extend to open full GitPopover |
| `src/renderer/store/workspaceStore.ts` | Optional: Add git-related state |

---

## Problems & Gaps Analysis

### Technical Challenges

| Challenge | Description | Solution Approach |
|-----------|-------------|-------------------|
| **Conflict Resolution** | Users need to edit files to resolve conflicts | Show conflicts list, user edits in terminal, then marks resolved |
| **Detached HEAD** | `git checkout <commit>` puts in detached HEAD | Detect state, warn user, offer to create branch |
| **Rebase vs Merge** | Both are valid workflows | Support both, show current state clearly |
| **Large Repositories** | `git log` can be slow on large repos | Paginate, lazy-load history |
| **Branch Name Validation** | Invalid names can cause errors | Validate with regex before executing |

### Missing Error Handling

| Scenario | Current | Needed |
|----------|---------|--------|
| Git not installed | Error logged | Graceful message, disable feature |
| Permission denied | Error in console | User-friendly error in UI |
| Network timeout (future) | N/A | Retry logic, cancel option |
| Concurrent operations | Could cause issues | Lock/unlock mechanism |

### UX Gaps

| Gap | Description | Recommendation |
|-----|-------------|----------------|
| **No Undo** | Can't easily undo operations | Add "Undo Last Action" for commits, stash |
| **No Progress** | Long operations show nothing | Add spinner/progress indicator |
| **No Confirmation** | Destructive ops like delete branch | Always confirm |
| **No History** | Can't see what was done | Log panel with recent git actions |

---

## Implementation Priority

### Must Have (MVP)

1. **Branch Operations**
   - List branches (local + remote)
   - Current branch indicator
   - Switch branches (dropdown)
   - Create branch
   - Delete branch (with confirmation)

2. **Stash Operations**
   - Stash changes
   - List stashes
   - Apply stash
   - Pop stash
   - Drop stash (with confirmation)

3. **Status Improvements**
   - Merge/rebase state detection
   - Conflict count indicator
   - Better error messages

### Should Have

4. **Merge Operations**
   - Merge branch into current
   - Abort merge
   - Conflict file list

5. **History (Light)**
   - Recent commits list (last 10)
   - Commit diff view

### Nice to Have (Future)

6. **Advanced History**
   - Full log with pagination
   - Branch graph visualization
   - Search/filter commits

7. **Remote Operations**
   - Push/Pull/Fetch
   - Remote branch management
   - See GitHub in report

---

## Testing Checklist

### Branch Operations
- [ ] Branch list shows all local and remote branches
- [ ] Current branch is highlighted
- [ ] Switch branch updates working directory
- [ ] Create branch creates and switches
- [ ] Delete branch removes from list
- [ ] Cannot delete current branch
- [ ] Invalid branch names are rejected

### Stash Operations
- [ ] Stash saves current changes
- [ ] Stash list shows all stashes with messages
- [ ] Apply stash keeps stash in list
- [ ] Pop stash applies and removes
- [ ] Drop stash removes from list
- [ ] "Nothing to stash" shown when clean

### Merge Operations
- [ ] Merge dialog shows available branches
- [ ] Fast-forward merge succeeds
- [ ] Regular merge creates merge commit
- [ ] Merge conflict detected and shown
- [ ] Abort merge resets state

### Error Handling
- [ ] Git not installed shows graceful error
- [ ] Permission errors are user-friendly
- [ ] Invalid operations are prevented
- [ ] Timeout errors are handled

---

## Dependencies

### Required Packages

None required - using existing Node.js `child_process`.

### Optional Enhancements (Future)

| Package | Purpose |
|---------|---------|
| `simple-git` | Abstraction over git CLI (but adds dependency) |
| `diff` | Better diff visualization |
| `marked` | Render commit messages |

---

## Conclusion

The existing Git integration provides a solid foundation. The extension plan:

1. **Maintains Architecture** - GitService pattern already extensible
2. **Adds Incremental Value** - Branching, stashing, merging are essential
3. **Keeps UI Minimal** - Single entry point, popover-based UI
4. **Future-Proofs** - `GitProvider` interface enables remote integrations

### Next Steps

1. **Immediate**: Implement `BranchOperations.ts` and `StashOperations.ts`
2. **Short-term**: Create `GitPopover.tsx` component
3. **Medium-term**: Add merge operations and conflict detection
4. **Long-term**: Consider `GitProvider` interface for remote integrations

---

*Document Version: 1.0*  
*Last Updated: 2026-04-07*
