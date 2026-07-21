# Workspace State Invariants

This document describes the state contracts that the `workspaceStore` maintains. These invariants must hold true after every state mutation.

> **Note:** These invariants are documented in code as JSDoc `@invariant` tags on the `WorkspaceState` interface in `workspaceStore.ts`. This document provides plain-language explanations for reference during code review.

## Implementation Notes

### gitChanges Storage Location

The `gitChanges` field is stored in the explorer section of workspace state. This is an intentional implementation detail: git changes are logically git-domain state, but they are stored alongside explorer state because the file explorer displays git status indicators and the two domains are tightly coupled in the UI.

### Centralized Store Design

The `workspaceStore.ts` file was reviewed during a documentation alignment pass and intentionally kept centralized. While the file is large (~1688 lines), it serves as the central composition point for all UI state. The complexity lives in the invariants, not in the file organization. Helper modules (`workspaceStoreHelpers.ts`, `workspaceLayout.ts`) already extract pure functions and layout tree operations.

The `workspaceLayout.ts` module now has direct unit test coverage (`tests/renderer/unit/workspaceLayout.test.ts`), providing safe refactoring surface for layout operations.

## Core Invariants

## Workspace Lifecycle Model

### Lifecycle Vocabulary

- `active`: the selected workspace, whose snapshot is mirrored into the store's
  top-level fields and rendered in the visible app viewport
- `parked`: a mounted-but-hidden workspace that remains alive without being
  interactive
- `disposed`: a fully closed workspace with no retained renderer or main-process
  resources

### Current Behavior

The store and renderer now model `active` and `parked` explicitly.

- Exactly one workspace may be active when `workspaces.length > 0`
- Inactive workspaces remain mounted as parked React workspace trees
- Parked workspaces are hidden and non-interactive
- The active workspace snapshot is still mirrored into top-level store fields as
  compatibility state for existing consumers
- Background behavior is now split by policy:
  - terminal sessions continue through the app-level bridge
  - editor file watch registration spans active and parked workspaces
  - explorer watch registration remains active-workspace only
  - browser panel interaction and bounds updates remain active-workspace only

That means the current system preserves inactive workspace data and mounted UI
state, while still keeping active-only ownership for interactive resources.

### Resource Policy Baseline

These rules describe the implemented workspace residency system.

| Resource / behavior | Behavior |
|-------|-----------|
| Workspace layout tree | All workspaces render in a single shared container; parked workspaces are `visibility: hidden` but remain mounted — no pane component remounts on switch |
| Terminal PTY output | Continues via `terminalSessionBridge` global listeners while parked; xterm instances cached in `xtermCache` |
| Terminal input/focus | Active workspace only |
| Editor file watchers | Active-workspace-only via `WorkspaceTabs.syncExplorerWatcher` |
| Explorer watcher | Active-workspace-only; parked workspaces retain cached directory contents |
| Browser native view | Retained per workspace; visible only for active; `lastBoundsRef` preserved across switch; `browserSetBounds` IPC sent immediately on reactivate |
| Editor `EditorView` | Permanently resident per workspace; `useEffect` with `[]` deps means destroy only on React unmount |
| Global shortcuts | Active workspace snapshot via `syncActiveWorkspace` (Phase 1 migration to workspace-scoped reads is deferred) |

### Review Implication

"Parked" describes a mounted-but-hidden workspace. All the behaviors in the
Resource Policy Baseline table are currently implemented. Remaining deferred
work (Phase 4 task 3 bounds pre-warming, Phase 4 task 4 warmth cap, Phase 1
migration off `syncActiveWorkspace`) is noted in `plans/workspace-residency-plan.md`.

### Workspace Invariants

| Field | Invariant | Explanation |
|-------|-----------|-------------|
| `activeWorkspaceId` | `null` ↔ `workspaces.length === 0` | When no workspaces exist, nothing can be active |
| `activeWorkspaceId` | `activeWorkspaceId !== null` → `workspaces.some(w => w.id === activeWorkspaceId)` | The active workspace ID always references an existing workspace |
| `workspaces[].lifecycle` | `workspaces.length > 0` → exactly one workspace has `lifecycle === 'active'` | Lifecycle state is explicit and drives active vs parked rendering |
| `activeWorkspaceId` + `workspaces[].lifecycle` | `activeWorkspaceId !== null` → the referenced workspace has `lifecycle === 'active'` | The active pointer and lifecycle state must agree |

**Why:** The active workspace ID is a reference pointer. If the referenced workspace doesn't exist, the UI would be in an inconsistent state with no clear behavior.

### Terminal Invariants

| Field | Invariant | Explanation |
|-------|-----------|-------------|
| `activeTerminalId` | `null` ↔ `terminals.length === 0` | When no terminals exist, no terminal can be active |
| `activeTerminalId` | `activeTerminalId !== null` → `terminals.some(t => t.id === activeTerminalId)` | The active terminal ID always references an existing terminal |

**Why:** Same pattern as workspace. Active terminal is a pointer to the terminal collection.

### Layout Invariants

> Pane locking has been removed. Layout decisions no longer gate on per-pane `locked` flags.

| Field | Invariant | Explanation |
|-------|-----------|-------------|
| `layoutRoot` | `null` ↔ no terminal or Explorer/Browser/Editor/Notes pane is visible | Layout only exists when there are visible panes |
| `layoutRoot` | All pane IDs in tree exist in `panes[].id` or the current Explorer/Browser/Editor/Notes pane | The layout tree only references valid pane IDs |
| `layoutUndoStack` | Restored roots are reconciled with the current visible pane set | Undo cannot resurrect closed panes or orphan newly opened panes |

**Why:** The `layoutRoot` is a tree of pane references. If a pane is referenced in the tree but doesn't exist in the panes array, rendering will fail. Conversely, orphaned panes (existing but not in the tree) would be invisible and waste resources.

### Browser Pane / Tab Invariants

| Field | Invariant | Explanation |
|-------|-----------|-------------|
| `browserPane.tabs` | `browserPane !== null` → `browserPane.tabs.length >= 1` | Once a browser pane exists, it always has at least one tab. The last tab cannot be closed. |
| `browserPane.tabs[].id` | unique within a workspace | Tab IDs identify a `WebContentsView` in main; duplicates would alias native views. |
| `browserPane.activeTabId` | `null` ↔ `browserPane === null` | When a pane exists the active tab id always references one of its tabs; when no pane exists, no tab is active. |
| `browserPane.activeTabId` | `activeTabId !== null` → `tabs.some(tab => tab.id === activeTabId)` | The active tab id always references an existing tab. |
| `browserUrl` | mirrors active tab's `url` for the active workspace | `browserUrl` is a compatibility mirror of the active tab url. Updating an inactive tab must NOT mutate `browserUrl`. |
| `browserPane.position` | unchanged by tab actions | Tab create/close/switch/update actions never touch pane geometry. |

**Why:**
- The "at least one tab" rule guarantees that the browser pane always has a renderable target view; UI never has to handle a tabless pane.
- Tab IDs are renderer-generated and must be passed unchanged to main, so duplicates would corrupt the workspace → tab → `WebContentsView` map.
- `browserUrl` predates the tab model; existing consumers (URL input, external links) read it directly. Treating it as the active-tab mirror keeps these consumers correct without forcing all of them to learn about tabs.
- Inactive tab updates (e.g., a background load completing) must not redraw the URL bar or visible browser surface.

### Editor Invariants

| Field | Invariant | Explanation |
|-------|-----------|-------------|
| `activeEditorTabId` | `null` ↔ `editorTabs.length === 0` | When no editor tabs are open, no tab can be active |
| `activeEditorTabId` | `activeEditorTabId !== null` → `editorTabs.some(t => t.id === activeEditorTabId)` | The active editor tab ID always references an existing tab |

**Why:** Same reference-pointer pattern as workspace and terminal invariants.

## How Invariants Are Enforced

### At the Store Level

The store's actions maintain these invariants internally:

- `addWorkspace` → sets `activeWorkspaceId` to new workspace's ID
- `selectWorkspace` → moves the top-level snapshot to the selected workspace
- `addWorkspace` / `selectWorkspace` / `closeWorkspace` → also normalize workspace lifecycle so exactly one workspace is `active`
- `closeWorkspace` → clears `activeWorkspaceId` if closing the last workspace, otherwise switches to another
- `addTerminal` → sets `activeTerminalId` to new terminal's ID
- `removeTerminal` → updates `activeTerminalId` if removing the active terminal
- `closeEditorTab` → updates `activeEditorTabId` if closing the active tab
- `setPanes`, `addPane`, `removePane` → rebuilds `layoutRoot` via `buildWorkspaceLayout`

### In Development

`validateWorkspaceConsistency()` verifies these invariants after layout mutations in development builds, logging warnings if violations are detected.

## Code Review Checklist

When reviewing code that modifies the workspace store:

1. **Adding a workspace?** Ensure `activeWorkspaceId` is set correctly
2. **Closing a workspace?** Handle the case where it's the active workspace
3. **Adding a terminal?** Ensure `activeTerminalId` is set (unless intentionally not)
4. **Removing a terminal?** Update `activeTerminalId` if removing the active one
5. **Modifying panes?** Verify `layoutRoot` stays in sync
6. **Closing an editor tab?** Update `activeEditorTabId` if closing the active tab

## Relationship Between Invariants

```
workspaces[]
  └── activeWorkspaceId (points into workspaces[])

terminals[]
  └── activeTerminalId (points into terminals[])

panes[] ─────────────────┐
explorerPane?.id ─────────┤
browserPane?.id ──────────┼──→ layoutRoot (tree of references)
editorPane?.id ───────────┤
notesPane?.id ────────────┘

editorTabs[]
  └── activeEditorTabId (points into editorTabs[])

browserPane?.tabs[]
  ├── activeTabId (points into tabs[])
  └── tabs[active].url ──→ workspace.browserUrl (compatibility mirror)
```

## Glossary

- **Nullability invariant:** `null` ↔ `length === 0` — A field is `null` if and only if its collection is empty. This simplifies null checks in the UI.
- **Reference invariant:** `id !== null` → `collection.some(item => item.id === id)` — An ID field always points to an existing item in its collection.
- **Layout tree invariant:** All IDs referenced in the `layoutRoot` tree exist in the corresponding panes collections.
