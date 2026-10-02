# Workspace Launch Recipes and Native Conversation History

This document describes the architecture for reusable workspace launch recipes (#42) and the native conversation history that backs Chat History.

Workspace Tasks — the durable per-launch "task record" introduced in #43 — were removed. Clanker no longer persists application-level task records for ordinary harness launches; see [Conversation history](#6-conversation-history) for what remains.

## 1. Core Principles

1. **Shared Durable Foundation**: Recipes build on `electron-store` and workspace identity composed of an environment ID and canonical path. Legacy records without an environment ID are local.
2. **Explicit Execution Boundary**: Opening a workspace or inspecting a recipe **never automatically runs arbitrary shell commands**. All execution steps are visible to the user and require an explicit launch action.
3. **No Phantom PTYs**: Clanker does not pretend previous PTY terminal processes survive an app restart. PTYs exit on app close; what survives is native AI conversation metadata owned by each harness.
4. **No Prompt Replay**: The user's original task prompt is never stored for the purpose of replaying it. Resume reconnects to the harness's native conversation session using native CLI resume mechanisms on the owning environment.
5. **Partial Failure Resilience**: Recipe execution never treats failure as all-or-nothing. If a step fails, prior successful terminals remain alive, and the failure is reported clearly.

---

## 2. Workspace Identity

Workspaces are uniquely identified across restarts by **environment ID plus canonical POSIX path**. Local workspaces use `local` (also the default for legacy records); SSH workspaces use their saved environment ID. Path normalization then applies within that environment:
- Normalized with forward slashes (`/`).
- Trailing slashes stripped (except roots like `/` or `C:/`).
- Local paths are case-insensitively matched on Windows (`pathKey`); SSH paths remain case-sensitive POSIX paths even when the desktop runs on Windows.

Utilities:
- `src/shared/workspaceIdentity.ts`: `normalizeWorkspacePath`, `workspaceIdentityKey`, `isSameWorkspaceIdentity`.

Runtime requests use `workspaceId` to resolve the registered environment and canonical root in main. A local and an SSH workspace can share the same path without sharing recipe, layout, or note identity.

---

## 3. Data Schema

### Workspace Launch Recipe (`WorkspaceRecipe`)

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

## 5. Security & Isolation

- **PTY Execution**: Commands and harnesses funneled strictly through the existing `spawnPtyProcess` machinery. No renderer-side `child_process` execution.
- **Browser URLs**: Validated against `normalizeTrustedAppBrowserUrl` allowing only `http:`, `https:`, and trusted local `file:` schemes.
- **IPC Boundaries**: All inputs crossing IPC are validated, type-checked, and normalized.

---

## 6. Conversation History

Chat History lists the harness's own conversations. Nothing about a launch is stored by Clanker: the records shown are the harness-native session files that already exist on the environment that owns them.

### 6.1 Local discovery

`SESSION_DISCOVER` calls `discoverSessions()` (`src/main/sessionHistory.ts`) for the selected local workspace. Discovery scans each supported harness's native store, keeps only sessions whose canonical `cwd` belongs to the workspace, filters to currently available harnesses, sorts by timestamp, and returns the combined list. The renderer groups the returned sessions by harness and renders one collapsible group per harness with discovered sessions; an installed harness with no discovered sessions has no group. Local discovery uses a short-lived in-memory cache; harness sessions are re-read when the cache expires or when discovery is forced.

### 6.2 Resume

`SESSION_INVOKE` starts a new PTY that attaches to the harness-native conversation (for example `codex resume <id>`, `claude --resume <id>`, `opencode --session <id>`, `pi --session <path>`, `omp --resume <path>`, `agy --conversation <id>`). It never replays a prompt.

Validation happens in main before any process starts:
- The workspace must be registered and its canonical root must contain the session `cwd`.
- The harness must be installed, available, and support the requested operation; the installed CLI alone never implies an integrated session format or resume command.
- Per-harness session validation (for example Antigravity's UUID requirement) runs on the resolved metadata.
- Supported native forks create a new conversation on the host; unsupported forks are refused.

The renderer attaches the returned terminal to the owning workspace. If the workspace switched while the resume was pending, the terminal still lands in the original workspace and the dropdown stays open; if that workspace closed, the orphaned terminal is killed and the failure is reported in place.

### 6.3 SSH discovery and resume

SSH workspaces read host-installed Codex, Claude, OpenCode, Pi, OMP, and Antigravity metadata through the registered environment. Desktop session history is never used for an SSH workspace, and Hermes history remains unsupported. See [SSH session history](workspaces.md#ssh-session-history) for scan bounds.

Remote resume re-reads the host session and never trusts renderer-supplied paths, models, or IDs. It validates host harness availability, canonical session containment, removal reservations, and conflicts between saved harness flags and the harness's own session-selection flags, then rechecks registration before spawning the SSH PTY. Pi/OMP session files and the launch directory are validated again on the host.

### 6.4 Provider capabilities

Harness session support is expressed through provider capabilities (`src/main/harnesses/`), introduced in #60: `sessions.validateLocal`, `sessions.validateRemote`, `sessions.remote`, `sessions.selectionFlags`, and `supportsSessionOperation()`. Shared identity and descriptor contracts (`src/shared/harnessIds.ts`, `src/shared/harnessDescriptors.ts`) stay authoritative; a new harness is assembled in `src/main/harnesses/<id>/index.ts` and registered in the canonical registry `src/main/harnesses/registry.ts` rather than through a central feature switch in the IPC layer. See [Harness integration playbook](harness-integration.md#adding-a-harness-or-capability).

---

## 7. Removed Workspace Tasks

The former task-session subsystem — `TaskSessionRecord`, `TaskSessionCoordinator`, `remoteTaskRecovery`, remote session correlation, `taskSessionIpc`, and `TaskRecoverySection` — was removed together with its UI.

- Local and SSH harness launches and native resumes write no task records.
- `taskSessions` was removed from `StoreSchema`. Because electron-store keeps unknown keys in the persisted JSON, `purgeLegacyTaskSessions()` (`src/main/storeMigrations.ts`) deletes the legacy key once at startup rather than leaving an ever-growing dead store on disk.
- The `TASK_SESSION_LIST` / `TASK_SESSION_DELETE` / `TASK_SESSION_UPDATE` channels, their preload methods, and the renderer typings were removed.

Future SSH persistent-process or reconnect work ([proposal](remote-process-persistence-design.md)) will model only explicitly detached processes. It must not reintroduce blanket per-launch task tracking.
