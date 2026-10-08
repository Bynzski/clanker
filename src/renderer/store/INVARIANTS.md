# Workspace State Invariants

This document describes the state contracts that the `workspaceStore` maintains. These invariants must hold true after every state mutation.

> **Note:** These invariants are documented in code as JSDoc `@invariant` tags on the `WorkspaceState` interface in `workspaceStore.ts`. This document provides plain-language explanations for reference during code review.

## Implementation Notes

### gitChanges Storage Location

The `gitChanges` field is stored in the explorer section of workspace state. This is an intentional implementation detail: git changes are logically git-domain state, but they are stored alongside explorer state because the file explorer displays git status indicators and the two domains are tightly coupled in the UI.

### Centralized Store Design

`workspaceStore.ts` is the composition point for workspace UI state. Helper modules (`workspaceStoreHelpers.ts`, `workspaceLayout.ts`) hold pure functions and layout tree operations; review the relevant invariants when changing store actions.

`workspaceLayout.ts` has direct unit test coverage in `tests/renderer/unit/workspaceLayout.test.ts`.

### Workspace Pages

Sanitized workspaces own one to nine `pages` and a valid `activePageId`. Each page owns topology,
revision, undo, focus, and ephemeral maximize state. `workspacePages.ts` synchronizes existing
layout writers at `syncActiveWorkspace`/`patchWorkspaceById`; workspace/top-level layout fields
are the selected page's projection, never a second independent layout. Normalization filters
other-page/minimized membership before using the existing algorithms.

Every terminal pane is tiled exactly once or has one minimized record, whose original page cannot
be removed. Utility panes are workspace-owned singletons; Explorer remains outside the split tree.
Minimize/restore/page switch/maximize do not spawn or terminate resources or change checkout identity.
Undo repairs only the current tiled membership; it cannot resurrect closed/minimized panes.
Maximize never changes the stored tree or ratios and remains per-page until explicitly restored.
Attention is acknowledged only for the presented, focused terminal in the active app destination.
A pending launch reserves its original page's pane before awaiting main; close is bound to the
original workspace/terminal, not whichever workspace is selected when IPC completes.

Page preferences are scoped by environment + canonical path and contain no runtime pane/PTY IDs
or undo/focus/maximize history. Location-only reopening retains pages, not running conversations:
absent terminal slots are pruned and never rebound to unrelated new chats. Recipes are disabled
with their stored records retained. See `docs/workspace-pages.md`.

### Workspace Identity

A workspace's persistent identity is its environment ID plus canonical POSIX path. Legacy records without an environment ID are local. A local and an SSH workspace may have the same path while keeping separate layouts, notes, Explorer state, terminals, and browser tabs. Runtime actions use `workspaceId` to select the workspace; a resource file path does not identify one by itself.

### Checkout Contexts

A workspace owns `checkoutContexts` (validated working roots) and every terminal carries a `checkoutContextId`. The main context's id is `<workspaceId>::main` and its path equals `workspacePath`; `sanitizeWorkspace` adds it (and binds unbound terminals to it) for workspaces created without contexts. A legacy linked-worktree workspace is its own root, so its single context has `kind: 'worktree'`. A terminal's recorded context is never rewritten by backfill. The authoritative, validated copy lives in main's `WorkspaceRegistry`; the renderer's copy is descriptive and cannot change where a terminal may run. An agent's reported location (`AgentAttentionSnapshot.location`, resolved by main) only changes which checkout is *shown* for it; it never rewrites `checkoutContextId`. Main's reconciliation with Git may refresh a worktree context's `branch`, set `missing`, or drop it (`applyCheckoutContextReconciliation`); it never adds a context or changes a root.

### Checkout Dev Service State

`workspaceServiceStore` is runtime-only presentation state, not part of workspace persistence or
layout ownership. Main snapshots have a monotonically increasing global revision; late hydration
cannot overwrite a newer push. A service must reference an open workspace and that workspace's
matching registered `checkoutRoot` (the actual canonical launch `cwd` may resolve a symlink). Every
service is scoped to `workspaceId + checkoutContextId`, not the active
workspace or source terminal's current location. Two conversations in one checkout expose the same
service; a conversation moving or closing never moves/stops it. Orphaned services remain accessible
as checkout-labelled rows. Main counts pending/live service processes as checkout usage, so a
renderer-only inactive checkout row cannot bypass removal protections. Browser handoff re-probes
readiness and respects newer destination/service selections.

## Workspace Lifecycle Model

### Lifecycle Vocabulary

- `active`: the selected workspace, whose snapshot is mirrored into the store's
  top-level fields and rendered in the visible app viewport
- `parked`: an inactive workspace that remains alive without being interactive;
  its renderer surface may be warm-mounted or cold-unmounted
- `disposed`: a fully closed workspace with no retained renderer or main-process
  resources

### Current Behavior

The store and renderer now model `active` and `parked` explicitly.

- Exactly one workspace may be active when `workspaces.length > 0`
- The active workspace and the two most recently used inactive workspaces keep
  mounted renderer trees; older parked workspaces retain state but become cold
- Parked workspaces are hidden and non-interactive
- The active workspace snapshot is still mirrored into top-level store fields as
  compatibility state for existing consumers
- Background behavior is now split by policy:
  - terminal sessions continue through the app-level bridge
  - local editor file watch registration spans active and parked workspaces
  - local explorer watch registration remains active-workspace only
  - browser panel interaction and bounds updates remain active-workspace only

That means the current system preserves inactive workspace data and mounted UI
state, while still keeping active-only ownership for interactive resources.

### Resource Policy Baseline

These rules describe the implemented workspace residency system.

| Resource / behavior | Behavior |
|-------|-----------|
| Workspace layout tree | An LRU cap keeps three workspace trees mounted; newly spawned/replaced terminals temporarily keep their workspace warm until readiness completes |
| Terminal PTY output | Continues via `terminalSessionBridge` global listeners while parked; xterm instances cached in `lib/terminalRuntimeCache.ts` |
| Terminal input/focus | Presented pane on active page and active Workspace destination only; invisible startup surfaces accept protocol responses, never user keys |
| Local checkout dev services | Main-owned headless PTYs; app-scoped `workspaceServiceStore` snapshots continue while parked/cold, independent of agent and pane lifetime; workspace close stops them |
| Editor file watchers | Local watched editor tabs across active and parked workspaces via `editorFileWatcher`; none on SSH workspaces |
| Explorer watcher | Local active-workspace-only; SSH uses one bounded batched poll for the active workspace's visible/expanded directories and open editor files; parked workspaces retain cached contents |
| SSH focus refresh | While the active SSH workspace's Explorer is visible, desktop focus refreshes Explorer contents and reloads clean editor tabs; dirty tabs are not automatically overwritten |
| Browser native view | Retained per workspace; visible only on its active page when not minimized, maximize-occluded, or overlay-suppressed; Assistant destination remains separate |
| Editor `EditorView` | Resident for warm workspaces; destroyed when its workspace becomes cold and recreated from store state on reactivation |
| Global shortcuts | Read the active workspace snapshot via `syncActiveWorkspace` |

### Review Implication

"Parked" describes an inactive workspace, while `runtimeState.residencyState`
distinguishes warm-mounted from cold-unmounted renderer contents. Terminal PTYs,
xterm buffers, and native browser sessions remain warm across both states.

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
| `activeTerminalId` | Null when the selected page presents no terminal | Other-page/minimized terminals may still be alive |
| `activeTerminalId` | `activeTerminalId !== null` → `terminals.some(t => t.id === activeTerminalId)` | The active terminal ID always references an existing terminal |

**Why:** Same pattern as workspace. Active terminal is a pointer to the terminal collection.

### Layout Invariants

> Pane locking has been removed. Layout decisions no longer gate on per-pane `locked` flags.

| Field | Invariant | Explanation |
|-------|-----------|-------------|
| `layoutRoot` | Mirrors the active page; null on empty/all-minimized pages | Running workspace resources are independent of active-page leaves |
| `layoutRoot` | All pane IDs in tree exist in `panes[].id` or the current Explorer/Browser/Editor/Notes pane | The layout tree only references valid pane IDs |
| `layoutUndoStack` | Per-page history reconciled against that page's current tiled membership | Undo cannot resurrect closed/minimized panes or steal other-page panes |

**Why:** The `layoutRoot` is a tree of pane references. If a pane is referenced in the tree but doesn't exist in pane state, rendering can fail. The Explorer UI is rendered as a separate left sidebar even though its ID remains part of layout state for compatibility; it is not a draggable pane in the current UI.

### Browser Pane / Tab Invariants

| Field | Invariant | Explanation |
|-------|-----------|-------------|
| `browserPane.tabs` | `browserPane !== null` → `browserPane.tabs.length >= 1` | Once a browser pane exists, it always has at least one tab. The last tab cannot be closed. |
| `browserPane.tabs[].id` | unique within a workspace | Tab IDs identify a `WebContentsView` in main; duplicates would alias native views. |
| `browserPane.activeTabId` | non-null when `browserPane` exists | An open browser pane always has an active tab. |
| `browserPane.activeTabId` | `activeTabId !== null` → `tabs.some(tab => tab.id === activeTabId)` | The active tab id always references an existing tab. |
| `browserUrl` | mirrors active tab's `url` for the active workspace | `browserUrl` is a compatibility mirror of the active tab url. Updating an inactive tab must NOT mutate `browserUrl`. |
| `browserPane.position` | unchanged by tab actions | Tab create/close/switch/update actions never touch pane geometry. |

**Why:**
- The "at least one tab" rule guarantees that the browser pane always has a renderable target view; UI never has to handle a tabless pane.
- Tab IDs are renderer-generated and must be passed unchanged to main, so duplicates would corrupt the workspace → tab → `WebContentsView` map.
- `browserUrl` predates the tab model; existing consumers (URL input, external links) read it directly. Treating it as the active-tab mirror keeps these consumers correct without forcing all of them to learn about tabs.
- Inactive tab updates (e.g., a background load completing) must not redraw the URL bar or visible browser surface.
- Browser activation explicitly synchronizes the renderer-selected tab with main. Only that workspace may show native views; remembered bounds and background tab actions cannot claim visibility. Bounds updates never replace an established tab selection.
- Tab creation selects the new tab immediately in the store. Async create/navigation completions must respect later selections, closures, and workspace switches; close completions synchronize the current selection rather than a captured fallback.

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
- `addTerminal` → attaches/focuses the new terminal on the captured target page, without stealing active-page selection
- `removeTerminal` → updates `activeTerminalId` if removing the active terminal
- `closeEditorTab` → updates `activeEditorTabId` if closing the active tab
- `setPanes`, `addPane`, `removePane` → update page-scoped topology and reconcile ownership without rebuilding other pages

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

## App Notifications

`notificationStore.ts` is app-level, in-memory presentation state, independent of workspace and
Assistant lifecycles. Features call `useNotificationStore.getState().show({ tone, message, ... })`;
optional workspace identity/name is captured at emission, and closing/switching a workspace never
removes its notices. Checkout transitions are the first consumer. Notification data never authorizes
filesystem, terminal or checkout operations; optional action callbacks are renderer-owned and use the
normal validated IPC paths.

- The three newest pending notifications occupy the toast slots; only that subset is reversed
  for oldest-at-top stacking. Older pending warnings remain in overflow/history.
- Pending warnings/errors persist until explicitly dismissed. Reading history marks notifications
  read but does not dismiss them. A later success cannot replace a warning.
- An optional `dedupeKey` collapses pending notices only within the same workspace and tone. Each
  update receives a new ID so a stale dismissal/timer cannot dismiss its replacement.
- Info/success toasts fade after six seconds, pausing while hovered, focused or running an action.
  Routine messages queued behind the three visible toasts or deferred for a native Browser expire
  into history too, retaining their unread state until explicitly dismissed or read in history.
- History retains the most recent 100 dismissed notices plus all pending notices. Pending warnings
  are intentionally never evicted; callers should use stable keys for recurring events. Clearing
  history removes only dismissed entries. Nothing is persisted across application restarts.
- The single `ToastViewport` floats at the top right below the toolbar, outside the layout flow;
  showing/dismissing it never changes pane geometry. With an active workspace/Assistant native
  Browser, toasts defer to the bell/history rather than hiding or resizing the Browser (native
  views paint above HTML overlays). Pending warnings stay pending, and routine outcomes remain
  unread in history. History uses the shared Popover and its workspace/Assistant Browser
  suppression lease. Both surfaces remain available in the zero-workspace launcher.
