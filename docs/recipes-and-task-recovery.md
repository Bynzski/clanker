# Workspace Launch Recipes and Task Recovery Architecture

This document describes the unified architecture for reusable workspace launch recipes (#42) and agent task recovery across restarts (#43).

## 1. Core Principles

1. **Shared Durable Foundation**: Both features build on a single persistence mechanism (`electron-store`) and workspace identity composed of an environment ID and canonical path. Legacy records without an environment ID are local.
2. **Explicit Execution Boundary**: Opening a workspace or inspecting a recipe **never automatically runs arbitrary shell commands**. All execution steps are visible to the user and require an explicit launch action.
3. **No Phantom PTYs**: Clanker does not pretend previous PTY terminal processes survive an app restart. PTYs exit on app close; what survives is persistent metadata and, for local tasks, native AI conversation resume capability.
4. **No Prompt Replay**: The user's original task prompt is never stored for the purpose of replaying it. Local resume reconnects to the harness's native conversation session using native CLI resume mechanisms.
5. **Partial Failure Resilience**: Recipe execution never treats failure as all-or-nothing. If a step fails, prior successful terminals remain alive, and the failure is reported clearly.
6. **Conservative Correlation**: Automatic session correlation operates on a strict false-negative preference. If multiple candidate sessions match a task, Clanker marks the task `needs-selection` rather than guessing or attaching the wrong conversation. A native session ID cannot be assigned to more than one task.

---

## 2. Workspace Identity

Workspaces are uniquely identified across restarts by **environment ID plus canonical POSIX path**. Local workspaces use `local` (also the default for legacy records); SSH workspaces use their saved environment ID. Path normalization then applies within that environment:
- Normalized with forward slashes (`/`).
- Trailing slashes stripped (except roots like `/` or `C:/`).
- Local paths are case-insensitively matched on Windows (`pathKey`); SSH paths remain case-sensitive POSIX paths even when the desktop runs on Windows.

Utilities:
- `src/shared/workspaceIdentity.ts`: `normalizeWorkspacePath`, `workspaceIdentityKey`, `isSameWorkspaceIdentity`.

Runtime requests use `workspaceId` to resolve the registered environment and canonical root in main. A local and an SSH workspace can share the same path without sharing task, recipe, layout, or note identity.

---

## 3. Data Schemas

### 3.1 Workspace Launch Recipe (`WorkspaceRecipe`)

```typescript
interface WorkspaceRecipe {
  id: string;
  name: string;
  workspacePath: string; // Canonical POSIX path
  environmentId?: string; // Absent in legacy local recipes; SSH recipes cannot launch in V1
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
  environmentId?: string; // Absent in legacy local records
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

Recipes are local-only in V1. Saving or launching a recipe for an SSH workspace is rejected before any local command can run. Legacy recipes without `environmentId` remain local. Local recipes capture and restore workspace pane topologies using semantic pane keys rather than runtime pane IDs:

- **Semantic Keys**: `terminal:0`, `terminal:1`, `browser`, `editor`, `notes`.
- **Capture**: When saving a recipe from an active workspace, each terminal contributes an ordered shell or harness launch slot. `serializeWorkspaceLayout()` records the split tree, ratio, terminal count, and explorer visibility.
- **Centralized Restoration**: `executeWorkspaceRecipe()` provisions launch slots in order, including plain shells, before layout restoration. Legacy recipes with `launches: []` still provision `terminalCount` plain shells. `restoreWorkspaceLayoutFromPersisted()` then maps the semantic keys onto newly generated runtime pane IDs with fresh `createNodeId()` nodes.
- **Graceful Fallback**: If the saved layout is incompatible (e.g. terminal counts differ or corrupted structure), layout restoration falls back safely, leaving standard balanced panes without failing the workspace.
- **Occupied Workspace Policy**: Recipes with explicit launch slots require an empty target workspace. If terminals already exist, no recipe command or harness is started and the user sees a clear error. Existing terminals are never terminated. Legacy recipes with `launches: []` retain their fill-to-`terminalCount` behavior.
- **Command Startup Result**: Recipe commands use the normal interactive PTY and wait for the renderer's `TERMINAL_READY` handshake. A shell-specific exit marker reports an immediate zero or nonzero exit; a command still running after 3 seconds is recorded as `started`, not as completed. If the terminal never becomes ready, the wait fails after 6 seconds. Spawned terminals remain available after a command failure.
- **Local Preview**: The configured URL is validated by the existing trusted browser URL validator. For `localhost`, `127.0.0.1`, and `::1`, a TCP connection to the configured port is checked before launch. If a command recipe finds that port already occupied, launch stops with a busy-port error. After terminal launch, an unavailable local port is retried for up to 5 seconds at 200 ms intervals, with each connection capped at 250 ms. Recipe navigation awaits `loadURL()` for at most 10 seconds and reports a failure if it rejects or times out. Remote HTTP/HTTPS URLs and trusted local file URLs use normal navigation without port probing.

---

## 5. Conservative Local Task Correlation & Discovery Caching

Native session discovery and correlation in this section apply only to local workspaces. SSH tasks do not scan local session files and become `unavailable` when their terminal exits or the app shuts down, with reason `Remote session recovery is not supported in this version`.

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

## 6. Local Lifecycle & State Transitions

The diagram below describes local tasks. Remote tasks transition from `running` to `unavailable` on terminal exit or app shutdown; remote native session recovery is not supported in V1.

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
2. `taskSessionCoordinator?.onAppShutdown()` — transitions local `running` tasks to `resumable` or `needs-selection`, remote `running` tasks to `unavailable`, and sets `shuttingDown = true`.
3. `killAllTerminals()` — kills PTY processes. Any resulting synchronous or asynchronous PTY exit callbacks immediately return `null` without launching redundant discovery loops.
4. `agentAttentionBroker.close()` & `removeAttentionAdapterFiles()` — tears down attention adapters.

---

## 9. Security & Isolation

- **PTY Execution**: Commands and harnesses funneled strictly through the existing `spawnPtyProcess` machinery. No renderer-side `child_process` execution.
- **Browser URLs**: Validated against `normalizeTrustedAppBrowserUrl` allowing only `http:`, `https:`, and trusted local `file:` schemes.
- **IPC Boundaries**: All inputs crossing IPC are validated, type-checked, and normalized.
