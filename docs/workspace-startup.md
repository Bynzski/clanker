# Workspace shell startup

Workspace identity is separate from runtime work. The renderer always mounts the normal app shell. With no destination it shows navigation, Open Workspace, Settings and the app-level Assistants roster; workspace capabilities are unavailable.

## Persistence

Renderer localStorage key: `clanker-grid:open-workspaces:v1`.

```ts
interface PersistedOpenWorkspaceState {
  version: 1;
  workspaces: { environmentId: string; path: string }[];
  activeWorkspace?: { environmentId: string; path: string };
}
```

Array order is current workspace order. Paths are main-returned canonical paths. Runtime UUIDs, checkout authority, terminal identities, credentials and presentation are excluded. Parsing normalizes/deduplicates with shared workspace identity semantics and rejects malformed entries. Reads/writes fail safely. Old historical tab-order, automatic layout and Notes-visibility keys are ignored without migration. Notes content retains its existing storage and migration behavior.

## Opening and hydration

`openWorkspace.ts` prepares an empty shell through `registerOpenWorkspace`, verifies the returned environment/context, checks local generated-worktree containers, and reads Git worktree metadata through the registered workspace ID. Main validates roots and removal reservations for local and SSH workspaces. Metadata never broadens the registered root. Interactive opening selects obvious or canonical duplicates and releases temporary registrations.

`workspaceStartup.ts` prepares saved identities independently in order, then calls `hydrateWorkspaceShells` once. The store assigns one active lifecycle and parked backgrounds without calling `addWorkspace`/`selectWorkspace` repeatedly or clearing an Assistant destination. WorkspaceHost applies its existing warm/cold residency policy. Saved active identity selects its surviving canonical shell; otherwise the first survivor wins.

Live persistence is suppressed until hydration commits. User-opened shells win duplicate races; their active selection is preserved. Workspaces explicitly closed during hydration are not resurrected. An Assistant selection remains independent. Unmount cancels the commit and releases uncommitted registrations; canonical duplicates and failed preparations release their temporary authority too. After commit, failed identities are removed from storage and a compact aggregated app notification reports failures. Navigation changes continuously update the open set; runtime-only changes do not cause writes.

Startup invokes no terminal/harness launch, session resume, Browser creation, or editor reopening. The bounded workspace-page preferences can preserve page order and semantic pane slots, but missing resources are pruned rather than recreated or rebound to new processes. Notes and Explorer do not automatically reopen. Runtime work starts from normal controls. Recipe controls and execution/mutation routes are temporarily disabled; persisted recipe records are retained without an ordinary-workspace recipe migration. See [Workspace pages](workspace-pages.md) and [Recipes](recipes.md).

## Progressive restoration assessment

The #176 investigation retained atomic publication of saved workspace shells. Local fixture measurements alone did not establish a reason to change it. An injected slow, unrelated workspace can delay presentation of the active workspace, but representative packaged cold-process, live slow-SSH and user-visible readiness data are missing. Progressive restoration is **not implemented**; it would require separate identity, selection, cleanup and persistence safety review before adoption. Historical stage measurements and experiment scripts remain in Git history, not as current runtime instructions.
