# Git worktree authority (#166)

Owner review: the source-level assessment was approved before implementation. This
change implements the unified launch/inventory/removal boundary below. Provider
relocation and MCP checkout lifecycle controls are retired.

## Authority and dataflow

```text
Git worktree list --porcelain -z -> inventory: path, HEAD/branch, lock, prunable
WorkspaceRegistry             -> environment-validated execution roots
terminals + authenticated cwd + services -> conservative occupancy
workspace/editor selection    -> presentation of an authorized root
worktreeProvenance            -> historical conversation attribution only
```

An inventory entry never grants filesystem, Git or launch access. Adoption still
matches Git's linked entry and validates its canonical path in its environment.
Checkout contexts remain workspace-scoped runtime authority, not task ownership.
Two agents may share a root; closing an agent does not delete or release it.
The existing canonical selector, editor identities/dirty buffers, Git generation
checks, watchers, services and authenticated observation policy remain intact.

## Removal contract

The renderer submits workspace, Git-listed path and expected branch after explicit
confirmation. Main lists Git, matches the exact linked entry, and checks main-root,
branch, lock/missing, workspace and terminal/service occupancy. The same operation
handles an attached and an unattached entry. Only the exact unused worktree
registrations may be excluded from backend *association* blockers; real workspace
roots, live usage and unknown directories are never excluded.

Backend reservation precedes asynchronous inspection. Pending registrations and
launches revalidate reservations. Identity and occupancy are checked again before
destructive dispatch. Existing dirty/staged/untracked/ignored checks, branch
comparison, local Trash staging and SSH host reservations/journals are retained.
No branch is deleted by this operation.

No registration is released before execution. A nonmutating failure retains it.
After confirmed removal or a verified partial mutation, reconciliation uses Git's
actual inventory for every workspace whose registration participated in the removal
(including equivalent SSH environments), scoped to each captured workspace identity.
Occupancy is rechecked before dropping registrations. The renderer applies all
returned updates only to the original workspace instances. A failed listing retains
that workspace's registrations and adds a refresh warning without changing the
removal outcome; other workspaces still reconcile. Unknown SSH outcomes retain
registrations and reservations until journal verification. The host script reports
`unchanged` before checkout movement, `recovery-required` after a verified move with
incomplete cleanup, or `unknown` when movement cannot be verified; a failed Git move
is checked against Git's listing and the original directory identity. Error
presentation never asserts that a directory remains merely because an operation failed. Git-listed staging paths survive desktop restart;
local recovery is explicit, never an automatic destructive retry. SSH completion
continues to require its persisted host journal before reservations are cleared.

## Compatibility inventory and migration

| Consumer/state | Policy |
| --- | --- |
| New Agent | Main by default; fresh create/adopt, committed-HEAD base selection, create-only. |
| Sidebar | Projects, agents/terminals and services; no checkout inventory or selector. |
| Source Control | Git inventory with registrations/occupancy; manual creation with the shared form; established removal/unlock/prune/recovery. |
| Terminal launch/resume | Keep context IDs, environment validation and late identity checks. |
| Explorer/editor/Git/services | Keep canonical selection and checkout-bound resource identity. |
| Read-only MCP context / attention | Keep launch authority separate from observed/historical location. |
| MCP create/complete | Retired; existing clients receive unknown-tool. Use Git and New Agent. |
| Provider rehome adapters / pane handoff | Removed together with their sole lifecycle consumer. |
| Runtime contexts | Rebuild through validated registration/adoption; do not persist access grants. |
| Persisted UI/recipes | No schema migration or synthetic workspace; retain existing restoration. |
| Worktree provenance | Retain for removed-checkout history, never inventory or access authority. |
| SSH removal records | Retain schema, equivalent-host protection, restart verification and recovery. |

Legacy standalone worktree-launcher components are not rendered at startup. Stored recipes,
native history/resume, worktree provenance and remote removal journals retain their existing
formats. `clanker_context.providerCapabilities.checkoutRehome` remains `null` for read-only
response compatibility. No old mutation tool is repurposed with a new meaning.

See [unified-session-launch.md](unified-session-launch.md) for the consumer audit, #170
root cause, explicit launch identity and implementation verification.

## Validation and limits

Real-Git/main-IPC regressions cover attached/external removal, branch retention,
tracked/staged/untracked/ignored refusal, locks/stale branches, late occupancy,
launch/registration reservations, and Trash rollback/partial recovery. SSH
coordinator fixtures cover association exclusion, unknown outcomes and journal
verification; existing equivalent-host and restart safeguards remain covered.
Renderer coverage includes external discovery without implicit adoption, explicit
new-session main default, creation without a process, shared launches, retained
failed-removal diagnostics, and stale response checks.

Local built-Electron smoke checks use disposable repositories/profiles with real
Git, PTYs, IPC and Browser surfaces: `smoke:new-session`, `smoke:checkout-presentation` and
`smoke:source-control`. Location events in the former are authenticated fixtures,
not evidence of native provider movement. No live SSH transport or paid native model calls were performed. The final gate is `npm run validate`.
