# Workspace Launch Recipes and Task Recovery Architecture

This document describes the unified architecture for reusable workspace launch recipes (#42) and agent task recovery across restarts (#43).

## 1. Core Principles

1. **Shared Durable Foundation**: Both features build on a single persistence mechanism (`electron-store`) and canonical workspace identity normalization (`normalizeWorkspacePath`), rather than disparate storage mechanisms.
2. **Explicit Execution Boundary**: Opening a workspace or inspecting a recipe **never automatically runs arbitrary shell commands**. All execution steps are visible to the user and require an explicit launch action.
3. **No Phantom PTYs**: Clanker does not pretend previous PTY terminal processes survive an app restart. PTYs exit on app close; what survives is persistent metadata and native AI conversation resume capability.
4. **No Prompt Replay**: The user's original task prompt is never stored for the purpose of replaying it. Resuming reconnects to the harness's native conversation session using native CLI resume mechanisms.
5. **Partial Failure Resilience**: Recipe execution never treats failure as all-or-nothing. If a step fails, prior successful terminals remain alive, and the failure is reported clearly.

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

---

## 4. Lifecycle & State Transitions

```
[Harness Spawned / Resumed]
             │
             ▼
      state: 'running'
      terminalId: 'term-xyz'
             │
             ├──────────────────────────────────────────┐
             ▼                                          ▼
     [Terminal Exited]                         [App Restarted]
             │                                          │
    Session Discovered?                         Session Valid?
      ┌──────┴──────┐                            ┌──────┴──────┐
      │             │                            │             │
     Yes            No                          Yes            No
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
[SESSION_INVOKE in new PTY]                [Unavailable if dir deleted
             │                              or harness uninstalled]
             ▼
      state: 'running'
      terminalId: 'term-new'
```

---

## 5. Security & Isolation

- **PTY Execution**: Commands and harnesses funneled strictly through the existing `spawnPtyProcess` machinery. No renderer-side `child_process` execution.
- **Browser URLs**: Validated against `normalizeTrustedAppBrowserUrl` allowing only `http:`, `https:`, and trusted local `file:` schemes.
- **IPC Boundaries**: All inputs crossing IPC are validated, type-checked, and normalized.
