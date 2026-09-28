# Workspace Launch Recipes and Task Recovery Architecture

This document describes the unified architecture for reusable workspace launch recipes (#42) and agent task recovery across restarts (#43).

## 1. Core Principles

1. **Shared Durable Foundation**: Both features build on a single persistence mechanism (`electron-store`) and canonical workspace identity normalization (`normalizeWorkspacePath`), rather than disparate storage mechanisms.
2. **Explicit Execution Boundary**: Opening a workspace or inspecting a recipe **never automatically runs arbitrary shell commands**. All execution steps are visible to the user and require an explicit launch action.
3. **No Phantom PTYs**: Clanker does not pretend previous PTY terminal processes survive an app restart. PTYs exit on app close; what survives is persistent metadata and native AI conversation resume capability.
4. **No Prompt Replay**: The user's original task prompt is never stored for the purpose of replaying it. Resuming reconnects to the harness's native conversation session using native CLI resume mechanisms.
5. **Partial Failure Resilience**: Recipe execution never treats failure as all-or-nothing. If a step fails, prior successful terminals remain alive, and the failure is reported clearly.

6. **Conservative Correlation**: Automatic session correlation operates on a strict false-negative preference. If multiple candidate sessions match a task, Clanker marks the task `needs-selection` rather than guessing or attaching the wrong conversation. A native session ID cannot be assigned to more than one task.
---

## 2. Workspace Identity

Workspaces are uniquely identified across restarts by their **canonical POSIX path**:
- Normalized with forward slashes (`/`).
- Trailing slashes stripped (except roots like `/` or `C:/`).
- Case-insensitively matched on Windows (`pathKey`) and case-sensitively matched on POSIX platforms.

Utilities:
- `src/shared/workspaceIdentity.ts`: `normalizeWorkspacePath`, `workspaceIdentityKey`, `isSameWorkspaceIdentity`.

---

## 3. Data Schemas

### 3.1 Workspace Launch Recipe (`WorkspaceRecipe`)

```typescript
interface WorkspaceRecipe {
  id: string;
  name: string;
  workspacePath: string; // Canonical POSIX path
  description?: string;
  terminalCount?: number;
  launches: RecipeLaunchStep[];
  browser?: {
    url: string; // Validated http/https/file URL
  };
  layout?: PersistedRecipeLayout;
  createdAt: number;
  updatedAt: number;
  version: 1;
}

type RecipeLaunchStep =
  | { id: string; type: 'shell'; title?: string }
  | { id: string; type: 'command'; command: string; title?: string }
  | { id: string; type: 'harness'; harnessId: string; modelId?: string; title?: string };
```

### 3.2 Task Session Record (`TaskSessionRecord`)

```typescript
type TaskRecoveryState = 'running' | 'resumable' | 'needs-selection' | 'unavailable';

interface TaskSessionRecord {
  id: string;
  workspacePath: string; // Canonical POSIX path
  harnessId: string;
  modelId?: string;
  title: string;
  terminalId?: string; // Live PTY identifier in current process
  nativeSessionId?: string; // e.g. Codex thread ID, Claude session UUID
  nativeSessionPath?: string; // e.g. OMP/Pi session file path
  state: TaskRecoveryState;
  stateReason?: string;
  createdAt: number;
  updatedAt: number;
  stoppedAt?: number;
  version: 1;
}
```

## 4. Recipe Layout Capture & Restoration

Recipes capture and restore workspace pane topologies using semantic pane keys rather than runtime pane IDs:

- **Semantic Keys**: `terminal:0`, `terminal:1`, `browser`, `editor`, `notes`.
- **Capture**: When saving a recipe from an active workspace, each terminal contributes an ordered shell or harness launch slot. `serializeWorkspaceLayout()` records the split tree, ratio, terminal count, and explorer visibility.
- **Centralized Restoration**: `executeWorkspaceRecipe()` provisions launch slots in order, including plain shells, before layout restoration. Legacy recipes with `launches: []` still provision `terminalCount` plain shells. `restoreWorkspaceLayoutFromPersisted()` then maps the semantic keys onto newly generated runtime pane IDs with fresh `createNodeId()` nodes.
- **Graceful Fallback**: If the saved layout is incompatible (e.g. terminal counts differ or corrupted structure), layout restoration falls back safely, leaving standard balanced panes without failing the workspace.

---

## 5. Conservative Task Correlation & Discovery Caching

### 5.1 Correlation Rules
The `findUnambiguousSessionCandidate()` algorithm associates a native session with a task record only when all conditions are satisfied:
1. Candidate matches the task's `harnessId`.
2. Candidate matches the workspace identity (`isSameWorkspaceIdentity()`).
3. Candidate falls within the task's lifetime window:
   `task.createdAt - 60_000 <= session.timestamp <= (task.stoppedAt ?? observedExitTime ?? task.updatedAt) + 120_000`. This prevents an old unresolved task from auto-claiming an unrelated session created days later.
4. Candidate session ID is **not** already associated with any other task in the store, nor claimed by another task earlier in the same evaluation pass.
5. **Strictly Unambiguous**: Exactly one matching candidate exists. If 0 or >1 candidates match, the function returns `null`, leaving the task in `needs-selection`.

### 5.2 Cache Bypass on Recovery Retry
Normal chat-history browsing utilizes a 60-second in-memory session cache (`discoverSessions`). However, harnesses often flush session files to disk a few hundred milliseconds after PTY termination.
- During terminal-exit recovery and restart-time correlation, `discoverSessions(workspacePath, { forceRefresh: true })` explicitly bypasses the cache to read fresh disk state on each retry attempt.

### 5.3 Explicit Discovery Results
Discovery distinguishes between successful scans and transient I/O failures using `SessionDiscoveryResult`:
- **Success with zero sessions**: If discovery completes successfully and the stored `nativeSessionId` is not found, the session was deleted from disk. The task transitions to `unavailable` with `stateReason: 'Native conversation session was not found on disk'`.
- **Discovery error**: If `discoverSessions()` throws (e.g. transient file system error), Clanker does **not** falsely declare the session deleted. A dead running task with a known native session ID becomes resumable; an unavailable task keeps its reason until a successful scan provides new evidence.
- **Manual reassociation**: Unavailable tasks with missing sessions or failed resume attempts can select an unclaimed discovered session. Main-process validation rejects duplicate ownership within the same harness and workspace. A successful reassociation clears the stale failure reason.

---

## 6. Lifecycle & State Transitions

```
(Harness Spawned / Resumed)
             │
             ▼
      state: 'running'
      terminalId: 'term-xyz'
             │
             ├──────────────────────────────────────────┐
             ▼                                          ▼
     (Terminal Exited)                         (App Restarted)
             │                                          │
   Unambiguous Session?                       Unambiguous Session?
      ┌──────┴──────┐                            ┌──────┴──────┐
      │             │                            │             │
     Yes       No / Ambiguous                   Yes       No / Ambiguous
      │             │                            │             │
      ▼             ▼                            ▼             ▼
'resumable'   'needs-selection'            'resumable'   'needs-selection'
      │             │                            │
      │       User Picks Session                 │
      │             │                            │
      └──────┬──────┘                            │
             │                                   │
      User Clicks Resume                         │
             │                                   │
             ▼                                   ▼
SESSION_INVOKE in new PTY                  Unavailable if dir deleted,
             │                             harness uninstalled,
             ▼                             session file deleted from disk,
      state: 'running'                     or resume invocation failed
      terminalId: 'term-new'               (Retry button offered in UI)
```

---

## 7. Resume Failure vs. Missing Session

Clanker distinguishes between two different kinds of failure:
1. **Session Missing on Disk**: Discovery successfully executes, but the file is absent from disk. The task is marked `unavailable` with `Native conversation session was not found on disk`.
2. **Resume Invocation Failure**: The session file exists on disk, but `SESSION_INVOKE` fails (e.g., corrupted conversation JSON, CLI runtime error, or incompatible model flags). In this case, the task is marked `unavailable` with `Failed to resume: <error>`. Automatic listing/evaluation respects this explicit failure state rather than immediately reverting it to `resumable`. The UI provides an explicit **Retry** button so the user can retry resuming or attach a different session.

---

## 8. Shutdown Ordering

In `src/main/main.ts`, the `app.on('before-quit')` sequence is strictly ordered:
1. `setAppShuttingDown(true)` — blocks late PTY data and exit IPC emissions to closing windows.
2. `taskSessionCoordinator?.onAppShutdown()` — transitions all `running` tasks to their persistent state (`resumable` or `needs-selection`) and sets `shuttingDown = true`.
3. `killAllTerminals()` — kills PTY processes. Any resulting synchronous or asynchronous PTY exit callbacks immediately return `null` without launching redundant discovery loops.
4. `agentAttentionBroker.close()` & `removeAttentionAdapterFiles()` — tears down attention adapters.

---

## 9. Security & Isolation

- **PTY Execution**: Commands and harnesses funneled strictly through the existing `spawnPtyProcess` machinery. No renderer-side `child_process` execution.
- **Browser URLs**: Validated against `normalizeTrustedAppBrowserUrl` allowing only `http:`, `https:`, and trusted local `file:` schemes.
- **IPC Boundaries**: All inputs crossing IPC are validated, type-checked, and normalized.
