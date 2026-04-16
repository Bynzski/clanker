# Status Bar Git Branch Indicator

## Goal

Display the current git branch name in the status bar footer, next to the working directory path. Only visible when the workspace is inside a git repository. Updates automatically as branches change during a session.

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Git Polling Pipeline (already exists)                          │
│                                                                 │
│  GitButton.tsx                                                 │
│    └─ gitStartPolling(workspacePath)  ──►  GIT_START_POLLING  │
│    └─ onGitStatusUpdate(callback)     ◄──  GIT_STATUS_UPDATE   │
│         └─ callback receives GitStatusResult:                   │
│              { isRepo, currentBranch, isDetached, changes, ...}│
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ StatusBar.tsx                                                   │
│    └─ Shows: terminal count | workspace path | Ready status    │
│    └─ NO git information currently                              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ workspaceStore.ts                                               │
│    └─ setGitChanges(changes)     ← tracked at global level     │
│    └─ gitChanges: GitStatus[]    ← only file changes tracked   │
│    └─ NO branch info at global level                            │
└─────────────────────────────────────────────────────────────────┘
```

## Key Insight

`GitStatusResult` (in `src/shared/types/git.ts`) already contains everything needed:

```typescript
interface GitStatusResult {
  success: boolean;
  isRepo: boolean;
  currentBranch: string | null;  // ← what we need
  isDetached: boolean;          // ← useful for detached HEAD state
  changes: GitStatus[];
  upstream: string | null;
  ahead: number;
  behind: number;
  // ...
}
```

The polling already fires every 30 seconds and also triggers on file changes. No new IPC channels or handlers are needed.

## Approach: Store-Centric

Add branch info to the global workspace store (mirroring the existing `gitChanges` pattern) so StatusBar can read it as a selector.

**Why not just subscribe StatusBar directly to `onGitStatusUpdate`?**

Two subscribers to the same event would work, but a store-centric approach keeps a single source of truth and follows the existing convention where `gitChanges` is already global state. The cost is negligible (~15 extra lines in the store).

## File Changes

| File | Change Type | Lines Added |
|------|-------------|-------------|
| `src/renderer/store/workspaceStoreTypes.ts` | Add interface fields + setter | ~5 |
| `src/renderer/store/workspaceStore.ts` | Add state fields + setter impl | ~15 |
| `src/renderer/components/GitButton.tsx` | Add store update calls in existing effect | ~4 |
| `src/renderer/components/StatusBar.tsx` | Add branch display | ~15 |
| `src/renderer/components/StatusBar.css` | Add branch styling | ~12 |
| **Total** | | **~51 lines** |

No changes to: `src/main/`, `src/shared/`, `src/renderer/electron.d.ts`, `src/main/preload.ts`.

---

### Step 1: `src/renderer/store/workspaceStoreTypes.ts`

Add three new fields and one setter to `WorkspaceState`:

```typescript
// New fields
gitCurrentBranch: string | null;
gitIsRepo: boolean;
gitIsDetached: boolean;

// New setter
setGitBranchInfo: (branch: string | null, isDetached: boolean) => void;
```

Also add the fields to `ActiveWorkspaceSnapshot` so they persist across workspace switches.

### Step 2: `src/renderer/store/workspaceStore.ts`

Add initial state and setter implementation:

```typescript
// Initial state
gitCurrentBranch: null,
gitIsRepo: false,
gitIsDetached: false,

// Setter
setGitBranchInfo: (branch, isDetached) => set((state) => ({
  gitCurrentBranch: branch,
  gitIsRepo: branch !== null || isDetached,
  gitIsDetached: isDetached,
  ...syncActiveWorkspace(state, (workspace) => ({
    ...workspace,
    gitCurrentBranch: branch,
    gitIsRepo: branch !== null || isDetached,
    gitIsDetached: isDetached,
  })),
})),
```

### Step 3: `src/renderer/components/GitButton.tsx`

In the existing `onGitStatusUpdate` effect (~line 402), add store update calls:

**On success:**
```typescript
useWorkspaceStore.getState().setGitBranchInfo(
  status.currentBranch,
  status.isDetached
);
```

**On failure / non-repo:**
```typescript
useWorkspaceStore.getState().setGitBranchInfo(null, false);
```

**On workspace path cleanup** (~line 362, the `if (!workspacePath)` block):
```typescript
useWorkspaceStore.getState().setGitBranchInfo(null, false);
```

### Step 4: `src/renderer/components/StatusBar.tsx`

Read branch from store, render conditionally:

```tsx
import { Terminal, Circle, GitBranch } from 'lucide-react';

export default function StatusBar() {
  const focusedWorkspace = useWorkspaceStore((state) => selectFocusedWorkspace(state));
  const workspacePath = focusedWorkspace?.workspacePath ?? '';
  const terminalCount = focusedWorkspace?.terminals.length ?? 0;

  // NEW
  const currentBranch = useWorkspaceStore((state) => state.gitCurrentBranch);
  const isDetached = useWorkspaceStore((state) => state.gitIsDetached);
  const isRepo = useWorkspaceStore((state) => state.gitIsRepo);

  const displayPath = workspacePath.length > 60
    ? '...' + workspacePath.slice(-57)
    : workspacePath || 'No workspace selected';

  return (
    <footer className="status-bar">
      <div className="status-left">
        <span className="status-item">
          <Terminal size={12} strokeWidth={2} />
          {terminalCount} terminal{terminalCount !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="status-center">
        <span className="status-path" title={workspacePath}>
          {displayPath}
        </span>
        {isRepo && (
          <span className="status-branch" title={isDetached ? 'Detached HEAD' : currentBranch ?? ''}>
            <GitBranch size={12} strokeWidth={2} />
            {isDetached ? 'HEAD' : currentBranch}
          </span>
        )}
      </div>

      <div className="status-right">
        <span className="status-item">
          <Circle size={8} fill="var(--accent-success)" strokeWidth={0} />
          Ready
        </span>
      </div>
    </footer>
  );
}
```

### Step 5: `src/renderer/components/StatusBar.css`

```css
.status-branch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: var(--space-md);
  padding: 2px 6px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
}

.status-branch svg {
  opacity: 0.7;
}
```

---

## Branch Change Scenarios

| Scenario | Behavior |
|----------|----------|
| Open workspace (git repo) | Poll fires → branch shown immediately |
| Open workspace (not git repo) | `isRepo: false` → branch hidden |
| `git checkout feature` | Next poll detects change → branch updates |
| `git checkout --detach` | `isDetached: true` → shows "HEAD" |
| `git checkout main` from detached | `isDetached: false, currentBranch: main` → shows "main" |
| Switch workspaces | GitButton resets + re-polls for new workspace |
| Close workspace | GitButton cleanup → branch info cleared |
| Branch changes via terminal commands | Next poll (≤30s) picks it up; also triggered by file watcher events |

## Why This Is the Smallest Patch

1. **No new IPC channels** — uses existing `GIT_STATUS_UPDATE` event
2. **No new IPC handlers** — uses existing `gitStartPolling`
3. **No changes to main process** — pure renderer-side change
4. **No new preload bridges** — all APIs already exposed
5. **Minimal store changes** — 3 fields, 1 setter
6. **Follows existing patterns** — mirrors `gitChanges` flow
7. **Reuses existing types** — `GitStatusResult` has everything

## Future Enhancements (Out of Scope)

- Ahead/behind counts: `main ↑2 ↓1`
- Merge/rebase status indicator
- Click branch label to open GitButton dropdown
- Upstream name: `main → origin/main`
