# Git worktree authority (#166)

Owner review: the source-level assessment was approved before implementation. This
change implements the routine launch/inventory/removal boundary below; native
provider relocation remains a compatibility feature, not a prerequisite.

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
| Isolated-agent picker | Keep create/adopt/reuse; also allow creation without a process. |
| Sidebar and Source Control | Join Git inventory with registrations/occupancy; one removal route. |
| Terminal launch/resume | Keep context IDs, environment validation and late identity checks. |
| Explorer/editor/Git/services | Keep canonical selection and checkout-bound resource identity. |
| Read-only MCP context / attention | Keep launch authority separate from observed/historical location. |
| MCP create/complete | Preserve names, arguments, grants and provider behavior for existing callers; explicitly describe as optional conversation relocation with cleanup, not ordinary worktree management. |
| Provider rehome adapters / pane handoff | Retain behind the existing compatibility tools; add no provider relocation support. |
| Runtime contexts | Rebuild through validated registration/adoption; do not persist access grants. |
| Persisted UI/recipes | No schema migration or synthetic workspace; retain existing restoration. |
| Worktree provenance | Retain for removed-checkout history, never inventory or access authority. |
| SSH removal records | Retain schema, equivalent-host protection, restart verification and recovery. |

The legacy standalone worktree-launcher components remain compatibility code and
are not reintroduced into startup. Existing MCP clients are not silently broken
or given a different meaning for `complete`. Removing those APIs and their
provider orchestration requires a later consumer migration, not a same-name
semantic replacement in this change.

## Review/PR sequence

1. Inventory and authority contract (this document).
2. Main-owned removal, truthful outcomes and race/real-Git regression coverage.
3. Shared Git presentation, explicit precreation and compatibility guidance.
4. Validate and open the implementation PR. Retire provider orchestration only
   after its remaining consumers explicitly migrate; do not claim native live
   continuity or live SSH coverage from fixture tests.

## Validation and limits

Real-Git/main-IPC regressions cover attached/external removal, branch retention,
tracked/staged/untracked/ignored refusal, locks/stale branches, late occupancy,
launch/registration reservations, and Trash rollback/partial recovery. SSH
coordinator fixtures cover association exclusion, unknown outcomes and journal
verification; existing equivalent-host and restart safeguards remain covered.
Renderer coverage includes external discovery without implicit adoption, explicit
selection/main return, precreation without a process, shared launches, retained
failed-removal rows, and stale inventory responses.

Local built-Electron smoke checks use disposable repositories/profiles with real
Git, PTYs, IPC and Browser surfaces: `smoke:checkout-presentation` and
`smoke:source-control`. Location events in the former are authenticated fixtures,
not evidence of native provider movement. No live SSH, native relocation or user
checkout recovery was performed. The final gate is `npm run validate`.
