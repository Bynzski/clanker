# Workspace State Invariants

This document describes the state contracts that the `workspaceStore` maintains. These invariants must hold true after every state mutation.

> **Note:** These invariants are documented in code as JSDoc `@invariant` tags on the `WorkspaceState` interface in `workspaceStore.ts`. This document provides plain-language explanations for reference during code review.

## Core Invariants

### Workspace Invariants

| Field | Invariant | Explanation |
|-------|-----------|-------------|
| `activeWorkspaceId` | `null` ↔ `workspaces.length === 0` | When no workspaces exist, nothing can be active |
| `activeWorkspaceId` | `activeWorkspaceId !== null` → `workspaces.some(w => w.id === activeWorkspaceId)` | The active workspace ID always references an existing workspace |

**Why:** The active workspace ID is a reference pointer. If the referenced workspace doesn't exist, the UI would be in an inconsistent state with no clear behavior.

### Terminal Invariants

| Field | Invariant | Explanation |
|-------|-----------|-------------|
| `activeTerminalId` | `null` ↔ `terminals.length === 0` | When no terminals exist, no terminal can be active |
| `activeTerminalId` | `activeTerminalId !== null` → `terminals.some(t => t.id === activeTerminalId)` | The active terminal ID always references an existing terminal |

**Why:** Same pattern as workspace. Active terminal is a pointer to the terminal collection.

### Layout Invariants

| Field | Invariant | Explanation |
|-------|-----------|-------------|
| `layoutRoot` | `null` ↔ `panes.length === 0 && !browserVisible && !editorVisible` | Layout only exists when there are visible panes |
| `layoutRoot` | All pane IDs in tree exist in `panes[].id` ∪ `{browserPane?.id}` ∪ `{editorPane?.id}` | The layout tree only references valid pane IDs |

**Why:** The `layoutRoot` is a tree of pane references. If a pane is referenced in the tree but doesn't exist in the panes array, rendering will fail. Conversely, orphaned panes (existing but not in the tree) would be invisible and waste resources.

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
- `closeWorkspace` → clears `activeWorkspaceId` if closing the last workspace, otherwise switches to another
- `addTerminal` → sets `activeTerminalId` to new terminal's ID
- `removeTerminal` → updates `activeTerminalId` if removing the active terminal
- `closeEditorTab` → updates `activeEditorTabId` if closing the active tab
- `setPanes`, `addPane`, `removePane` → rebuilds `layoutRoot` via `buildWorkspaceLayout`

### In Development (Step 10)

A `validateWorkspaceConsistency()` function (see Step 10) will verify these invariants after every layout mutation in development builds, logging warnings if violations are detected.

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
browserPane?.id ──────────┼──→ layoutRoot (tree of references)
editorPane?.id ──────────┘

editorTabs[]
  └── activeEditorTabId (points into editorTabs[])
```

## Glossary

- **Nullability invariant:** `null` ↔ `length === 0` — A field is `null` if and only if its collection is empty. This simplifies null checks in the UI.
- **Reference invariant:** `id !== null` → `collection.some(item => item.id === id)` — An ID field always points to an existing item in its collection.
- **Layout tree invariant:** All IDs referenced in the `layoutRoot` tree exist in the corresponding panes collections.
