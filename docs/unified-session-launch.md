# Unified session launch (#166)

## Migration map and implementation sequence

The toolbar harness pills and isolated-agent picker become one **New Session** picker. It starts at the project checkout on every opening, supports Terminal and the same configured harness list, and retains the existing checkout-bound pane/spawn transaction. An explicit target never reads the focused agent's checkout selection. Git inventory describes choices; main validates/adopts the selected linked root before launch. A second session can share the same validated root.

The sidebar `WorkspaceCheckouts` inventory, main-root pin, selection, removal and repair controls are removed. Agent rows and project services remain. Editor tab pins, absolute file identities, focus routing, Git snapshots and observation provenance remain. Source Control Worktrees keeps the established removal, unlock, prune and recovery implementation.

New worktrees distinguish a new branch from an existing unoccupied branch. New branches use a committed HEAD from the project or a chosen Git-listed usable worktree. Main re-reads Git and validates the source; no source branch switch or dirty-file copy is involved. Creation without a session uses the same transaction and keeps its output on failure.

## Compatibility audit

- Recipes use `executeWorkspaceRecipe` and their stored launch configuration, not the toolbar pills. Preserve them.
- Native history/resume routes through `sessionResumeTarget` and `sessionWorktrees`, including explicit recreation offers and main-owned adoption. Preserve them independently of agent relocation.
- Checkout contexts are execution/filesystem grants, not worktree ownership. Retain registration, reservation, containment, occupancy and reconciliation checks.
- `clanker_create_isolated_checkout` and `clanker_complete_isolated_checkout` are registered only by main and granted by terminal/session launch. Their only execution consumer is `IsolatedCheckoutService`; provider `checkoutRehome` adapters, internal replacement resume, relocation commit and renderer transition events support that service. Retire this chain, including its MCP advertisement. Ordinary Git/shell tools remain available to agents.
- `clanker_context`, bridge authentication and attention attachments remain. Removed rehome capability metadata must report no relocation support. Native resume capabilities remain truthful.
- Screenshot and Electron smoke scripts call the old controls and must migrate to New Session.
- Historical assessment documents are evidence of prior behavior, not current API instructions.

## #170 diagnosis and recovery

A current authenticated native location without a registered context supersedes launch identity for file/Git presentation. This intentionally produces `unregistered-observation`; focus clears an editor pin and exposes the observation again. Registrations are runtime-only, so restart or externally created worktrees require explicit main-owned adoption. Discovery and cwd reports must not create grants.

New Session does not use this presentation selection. Main is independently resolved from the workspace registration; an existing worktree is freshly adopted through Git/main even if it was previously registered. Files and Source Control remain unavailable until a validated agent/editor is focused. Opening a new session in a validated root is the recovery path; it never moves the old process or authorizes its external location.

## Verification

Implementation and verification results are recorded here before delivery. Native harness and live SSH checks are reported separately from fixture evidence.
